/**
 * Order outbox: when the CRM can't be reached, /api/orders still takes the order, parks its event in KV
 * and resends it here once the CRM answers again. Resending is safe because the CRM keeps one event per
 * external_ref (DEF-01, 2026-11-18): an event it already recorded is replayed, never counted twice.
 *
 * Pages Functions have no cron, so draining rides on API traffic (orders and /api/health) via waitUntil,
 * throttled by one "due" key so an outage costs at most one KV list per RETRY_MS.
 */
import { sendWebhook } from './crm';
import type { Env } from './http';

const PREFIX = 'outbox:';
const DUE_KEY = 'outbox-due'; // deliberately outside PREFIX
const RETRY_MS = 2 * 60_000;
const KEEP_SECONDS = 14 * 24 * 60 * 60;
const BATCH = 20;

export type OrderEvent = { external_ref: string } & Record<string, unknown>;

export async function enqueue(kv: KVNamespace, event: OrderEvent): Promise<void> {
  await kv.put(PREFIX + event.external_ref, JSON.stringify(event), { expirationTtl: KEEP_SECONDS });
  await kv.put(DUE_KEY, String(Date.now() + RETRY_MS));
}

/** Resends parked events, stopping at the first failure (the CRM is still down). Never throws. */
export async function drainOutbox(env: Env): Promise<void> {
  const kv = env.ORDERS_KV;
  if (!kv) return;
  try {
    const due = await kv.get(DUE_KEY);
    if (due === null || Number(due) > Date.now()) return;
    await kv.put(DUE_KEY, String(Date.now() + RETRY_MS));

    const { keys } = await kv.list({ prefix: PREFIX, limit: BATCH });
    // Nothing left: stop checking until the next enqueue.
    if (!keys.length) return void (await kv.delete(DUE_KEY));
    for (const { name } of keys) {
      const event = await kv.get(name);
      if (event !== null) await sendWebhook(env, 'online_ordering', JSON.parse(event));
      await kv.delete(name);
    }
    // This batch went through, so the CRM is up: check again on the next request.
    await kv.put(DUE_KEY, '0');
  } catch (error) {
    console.error('Outbox resend stopped', error instanceof Error ? error.message : error);
  }
}
