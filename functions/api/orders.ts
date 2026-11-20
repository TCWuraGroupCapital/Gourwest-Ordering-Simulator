/**
 * POST /api/orders — validates and prices the bag server-side, then posts one signed
 * `online_order.completed` event to Luminara CRM's online_ordering webhook. If the CRM is down the
 * order is still taken (202, crm: null) and its event is resent later through the outbox.
 */
import { CartError, priceCart } from '../../src/lib/pricing';
import { findStore } from '../../src/data/stores';
import { TRANSIENT, makeRef, sendWebhook, type CrmWebhookReply } from '../_lib/crm';
import { drainOutbox, enqueue } from '../_lib/outbox';
import { verifyTurnstile } from '../_lib/turnstile';
import { RULES } from '../../src/lib/rules';
import { handle, HttpError, json, methodNotAllowed, readJsonPost, type Env } from '../_lib/http';

const CHECKOUT_ID = /^[A-Za-z0-9-]{8,64}$/;
const REPLAY_TTL_SECONDS = 60 * 60 * 24;

interface OrderResult {
  orderRef: string;
  placedAt: string;
  store: { id: string; name: string; city: string; prepMinutes: number };
  pickupName: string;
  lines: { name: string; qty: number; summary: string[]; note: string; total: number }[];
  subtotal: number;
  /** balance/tier come back only to whoever placed this order; there is no lookup by member number. */
  member: { number: string; pointsEarned: number; updated: boolean; balance: number | null; tier: string | null } | null;
  /** null while the order waits in the outbox for the CRM. */
  crm: { eventId: number | string; latencyMs: number } | null;
}

/** Replay lock value while a send is in flight; afterwards the key holds the OrderResult JSON. */
const PENDING = 'pending';

export const onRequestPost: PagesFunction<Env> = (context) =>
  handle(async () => {
    const { request, env } = context;
    const body = await readJsonPost(request);

    // KV holds the per-checkout replay copy and the outbox, so production must have it before taking orders.
    const kv = env.ORDERS_KV;
    if (!kv) throw new HttpError(503, 'orders_unconfigured', 'Online ordering is temporarily unavailable. Please order at the counter.');

    const checkoutId = String(body.checkoutId ?? '');
    if (!CHECKOUT_ID.test(checkoutId)) throw new HttpError(422, 'invalid_checkout', 'Please refresh the page and try again.');

    const store = findStore(String(body.storeId ?? ''));
    if (!store) throw new HttpError(422, 'invalid_store', 'Choose a kitchen for pickup.');

    const pickupName = String(body.pickupName ?? '').trim().replace(/\s+/g, ' ');
    const nameError = RULES.pickupName(pickupName);
    if (nameError) throw new HttpError(422, 'invalid_name', nameError);

    const rawMember = String(body.memberNumber ?? '').trim().toUpperCase();
    const memberError = RULES.memberNumber(rawMember);
    if (memberError) throw new HttpError(422, 'invalid_member', memberError);

    let cart;
    try {
      cart = priceCart(body.lines);
    } catch (error) {
      if (error instanceof CartError) throw new HttpError(422, 'invalid_cart', error.message);
      throw error;
    }

    // Bot check after the cheap validation, before anything is locked or sent to the CRM.
    await verifyTurnstile(env, request, body.turnstileToken);

    // Best-effort de-duplication (KV is eventually consistent across locations; the CRM also keeps
    // one event per external_ref since 2026-11-18). Same checkout id → replay the first result instead of sending again.
    const replayKey = `order:${checkoutId}`;
    const prior = await kv.get(replayKey);
    if (prior === PENDING) throw new HttpError(409, 'in_progress', 'This order is already being placed. Please wait a moment.');
    if (prior) return json({ ...JSON.parse(prior), replayed: true }, 200);
    await kv.put(replayKey, PENDING, { expirationTtl: 120 });

    const ref = makeRef('WEB', store.region);
    const event = {
      event_type: 'online_order.completed',
      external_ref: ref,
      region_code: store.region,
      ...(rawMember ? { loyalty_member_number: rawMember, points_delta: cart.points } : {}),
      spend_aud: cart.subtotal / 100,
    };
    let reply: CrmWebhookReply | null = null;
    try {
      reply = await sendWebhook(env, 'online_ordering', event);
      context.waitUntil(drainOutbox(env)); // the CRM answers again: flush anything parked during an outage
    } catch (error) {
      // A CRM outage must not cost the sale: park the event for a resend. Anything else releases the lock and fails.
      const parked =
        error instanceof HttpError &&
        TRANSIENT.has(error.code) &&
        (await enqueue(kv, event).then(
          () => true,
          (e) => (console.error('Outbox store failed', e), false),
        ));
      if (!parked) {
        await kv.delete(replayKey).catch((e) => console.error('Replay lock release failed', e));
        throw error;
      }
    }

    const { customer_updated: updated = false, points_balance: balance, tier } = reply?.data ?? ({} as Partial<CrmWebhookReply['data']>);
    const result: OrderResult = {
      orderRef: reply?.data.external_ref || ref,
      placedAt: new Date().toISOString(),
      store: { id: store.id, name: store.name, city: store.city, prepMinutes: store.prepMinutes },
      pickupName,
      lines: cart.lines.map(({ name, qty, summary, note, total }) => ({ name, qty, summary, note, total })),
      subtotal: cart.subtotal,
      member: rawMember
        ? {
            number: rawMember,
            // A queued order shows the points it will earn once the CRM confirms the member.
            pointsEarned: updated || !reply ? cart.points : 0,
            updated,
            balance: updated && Number.isSafeInteger(balance) ? (balance as number) : null,
            tier: updated && typeof tier === 'string' ? tier : null,
          }
        : null,
      crm: reply ? { eventId: reply.data.event_id, latencyMs: reply.data.latency_ms } : null,
    };
    // The order is placed: a failure to store the replay copy must not turn success into an error.
    await kv.put(replayKey, JSON.stringify(result), { expirationTtl: REPLAY_TTL_SECONDS }).catch((e) => console.error('Replay store failed', e));
    return json(result, reply ? 201 : 202);
  });

export const onRequest: PagesFunction<Env> = () => methodNotAllowed();
