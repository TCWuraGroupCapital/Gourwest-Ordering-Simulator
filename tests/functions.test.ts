import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultChoices } from '../src/lib/pricing';
import { findItem } from '../src/data/menu';
import { hmacHex } from '../functions/_lib/crm';
import { onRequestPost as postOrder } from '../functions/api/orders';
import { onRequestPost as postEnquiry, parseEnquiry } from '../functions/api/enquiries';
import { onRequestPost as postConcierge } from '../functions/api/concierge';
import type { Env } from '../functions/_lib/http';

const SECRET = 'test-secret-value';
const CRM = 'https://crm.example.test';

class MemoryKV {
  store = new Map<string, string>();
  failPuts = false;
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string) {
    if (this.failPuts && value !== 'pending') throw new Error('KV unavailable');
    this.store.set(key, value);
  }
  async delete(key: string) {
    this.store.delete(key);
  }
  async list({ prefix }: { prefix: string }) {
    return { keys: [...this.store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
  }
}

/** Work handed to waitUntil; await it to see background effects such as the outbox resend. */
let background: Promise<unknown>[] = [];
const settle = () => Promise.all(background.splice(0));

type Handler = (ctx: { request: Request; env: Env; waitUntil(p: Promise<unknown>): void }) => Promise<Response> | Response;
const call = (handler: unknown, body: unknown, env: Env, headers: Record<string, string> = {}) =>
  (handler as Handler)({
    request: new Request('https://gourwest.test/api/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://gourwest.test', ...headers },
      body: JSON.stringify(body),
    }),
    env,
    waitUntil: (p) => background.push(p),
  });

const seoul = findItem('seoul-bbq-chicken-bowl')!;
const order = (overrides: Record<string, unknown> = {}) => ({
  checkoutId: 'checkout-0001',
  storeId: 'melbourne-central',
  pickupName: 'Noah',
  memberNumber: 'gw-au-1006',
  lines: [{ slug: seoul.slug, qty: 2, choices: defaultChoices(seoul) }],
  ...overrides,
});

const crmReply = (externalRef: string, customerUpdated = true, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({ status: 'processed', data: { system_code: 'online_ordering', event_id: 42, external_ref: externalRef, latency_ms: 7, customer_updated: customerUpdated, ...extra } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes('/web-forms/forms/')) return new Response('{"message":"Thanks"}', { status: 200 });
    if (url.includes('turnstile/v0/siteverify')) {
      return new Response(JSON.stringify({ success: (init.body as FormData).get('response') === 'human-token' }), { status: 200 });
    }
    return crmReply(JSON.parse(String(init.body)).external_ref);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await settle();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CRM signature', () => {
  it('matches the HMAC-SHA256 the CRM computes over the raw body', async () => {
    const body = '{"event_type":"online_order.completed","spend_aud":119.8}';
    expect(await hmacHex(SECRET, body)).toBe(createHmac('sha256', SECRET).update(body).digest('hex'));
  });
});

describe('POST /api/orders', () => {
  let kv: MemoryKV;
  let env: Env;
  beforeEach(() => {
    kv = new MemoryKV();
    env = { CRM_BASE_URL: `${CRM}/`, GOURWEST_WEBHOOK_SECRET: SECRET, ORDERS_KV: kv as unknown as Env['ORDERS_KV'] };
  });

  it('reprices server-side and sends one signed webhook', async () => {
    const res = await call(postOrder, order({ subtotal: 1 }), env);
    expect(res.status).toBe(201);
    const result = await res.json<any>();
    expect(result.subtotal).toBe(3580);
    expect(result.member).toEqual({ number: 'GW-AU-1006', pointsEarned: 358, updated: true, balance: null, tier: null });
    expect(result.crm.eventId).toBe(42);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${CRM}/api/gourwest/webhooks/online_ordering`);
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({ event_type: 'online_order.completed', region_code: 'AU', loyalty_member_number: 'GW-AU-1006', points_delta: 358, spend_aud: 35.8 });
    expect(sent.external_ref).toMatch(/^WEB-AU-[A-Z0-9]+$/);
    expect(sent).not.toHaveProperty('pickupName');
    expect(init.headers['X-Gourwest-Signature']).toBe(`sha256=${createHmac('sha256', SECRET).update(init.body).digest('hex')}`);
  });

  it('omits loyalty fields for guest orders', async () => {
    await call(postOrder, order({ memberNumber: '' }), env);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).not.toHaveProperty('loyalty_member_number');
    expect(sent).not.toHaveProperty('points_delta');
  });

  it('reports zero points when the CRM does not recognise the member', async () => {
    fetchMock.mockImplementationOnce(async (_u: string, init: RequestInit) => crmReply(JSON.parse(String(init.body)).external_ref, false));
    const result = await (await call(postOrder, order(), env)).json<any>();
    expect(result.member).toEqual({ number: 'GW-AU-1006', pointsEarned: 0, updated: false, balance: null, tier: null });
  });

  it('passes the new balance and tier back to the orderer when the CRM sends them', async () => {
    fetchMock.mockImplementationOnce(async (_u: string, init: RequestInit) =>
      crmReply(JSON.parse(String(init.body)).external_ref, true, { points_balance: 1180, tier: 'Silver' }),
    );
    const result = await (await call(postOrder, order(), env)).json<any>();
    expect(result.member).toEqual({ number: 'GW-AU-1006', pointsEarned: 358, updated: true, balance: 1180, tier: 'Silver' });
  });

  it('ignores a balance the CRM sends for a member it did not update, or one that is not a whole number', async () => {
    fetchMock.mockImplementationOnce(async (_u: string, init: RequestInit) =>
      crmReply(JSON.parse(String(init.body)).external_ref, false, { points_balance: 1180, tier: 'Silver' }),
    );
    expect((await (await call(postOrder, order(), env)).json<any>()).member).toMatchObject({ balance: null, tier: null });
    fetchMock.mockImplementationOnce(async (_u: string, init: RequestInit) =>
      crmReply(JSON.parse(String(init.body)).external_ref, true, { points_balance: '1180', tier: 7 }),
    );
    expect((await (await call(postOrder, order({ checkoutId: 'checkout-0002' }), env)).json<any>()).member).toMatchObject({ balance: null, tier: null });
  });

  it.each([
    ['bad member number', { memberNumber: 'ABC' }, 'invalid_member'],
    ['unknown store', { storeId: 'mars' }, 'invalid_store'],
    ['blank name', { pickupName: '  ' }, 'invalid_name'],
    ['tampered option', { lines: [{ slug: seoul.slug, qty: 1, choices: { ...defaultChoices(seoul), extras: ['free-lobster'] } }] }, 'invalid_cart'],
    ['null line', { lines: [null] }, 'invalid_cart'],
    ['oversized order', { lines: [{ slug: 'lemon-herb-chicken-plate', qty: 20, choices: { side: ['grains-salad'], heat: ['mild'] } }, { slug: 'peri-peri-chicken-plate', qty: 20, choices: { side: ['fries-slaw'], heat: ['medium'] } }] }, 'invalid_cart'],
    ['bad checkout id', { checkoutId: 'x' }, 'invalid_checkout'],
  ])('rejects %s with 422 and never calls the CRM', async (_label, overrides, code) => {
    const res = await call(postOrder, order(overrides), env);
    expect(res.status).toBe(422);
    expect((await res.json<any>()).error.code).toBe(code);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['another site', { Origin: 'https://evil.test' }],
    ['an opaque origin', { Origin: 'null' }],
    ['no origin (non-browser client)', { Origin: '' }],
  ])('refuses requests from %s', async (_label, headers) => {
    expect((await call(postOrder, order(), env, headers)).status).toBe(403);
  });

  it('rejects non-JSON and non-object bodies', async () => {
    const res = await (postOrder as Handler)({
      request: new Request('https://gourwest.test/api/orders', { method: 'POST', body: 'a=b', headers: { 'Content-Type': 'text/plain', Origin: 'https://gourwest.test' } }),
      env,
      waitUntil: () => {},
    });
    expect(res.status).toBe(415);
    expect((await call(postOrder, null, env)).status).toBe(400);
    expect((await call(postOrder, [1], env)).status).toBe(400);
  });

  it('silently refuses honeypot submissions', async () => {
    expect((await call(postOrder, order({ website: 'http://spam' }), env)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 503 when the CRM or the replay store is not configured', async () => {
    expect((await (await call(postOrder, order(), { ORDERS_KV: env.ORDERS_KV })).json<any>()).error.code).toBe('crm_unconfigured');
    expect((await (await call(postOrder, order(), { CRM_BASE_URL: CRM, GOURWEST_WEBHOOK_SECRET: SECRET })).json<any>()).error.code).toBe('orders_unconfigured');
  });

  it('maps a rejected signature to 502, releases the lock and leaks no CRM detail', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"message":"Invalid or missing X-Gourwest-Signature"}', { status: 401 }));
    const res = await call(postOrder, order(), env);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json<any>())).not.toMatch(/Signature/);
    expect(kv.store.has('order:checkout-0001')).toBe(false);
  });


  it('replays the stored result instead of double-sending the same checkout', async () => {
    const first = await (await call(postOrder, order(), env)).json<any>();
    const second = await call(postOrder, order(), env);
    expect(second.status).toBe(200);
    expect((await second.json<any>()).orderRef).toBe(first.orderRef);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the CRM is unreachable', () => Promise.reject(new TypeError('tunnel down'))],
    ['a timeout', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
    ['a CRM server error', () => Promise.resolve(new Response('oops', { status: 500 }))],
    ['CRM rate limiting', () => Promise.resolve(new Response('', { status: 429 }))],
    ['an unreadable success reply', () => Promise.resolve(new Response('<html>', { status: 200 }))],
  ])('takes the order and parks its event when %s', async (_label, outcome) => {
    fetchMock.mockImplementationOnce(outcome);
    const res = await call(postOrder, order(), env);
    expect(res.status).toBe(202);
    const result = await res.json<any>();
    expect(result.crm).toBeNull();
    expect(result.member).toEqual({ number: 'GW-AU-1006', pointsEarned: 358, updated: false, balance: null, tier: null });

    const parked = JSON.parse(kv.store.get(`outbox:${result.orderRef}`)!);
    expect(parked).toEqual(JSON.parse(fetchMock.mock.calls[0][1].body));
    // A resubmit of the same checkout replays the accepted order rather than sending it again.
    const retry = await call(postOrder, order(), env);
    expect(retry.status).toBe(200);
    expect((await retry.json<any>()).orderRef).toBe(result.orderRef);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resends a parked order with the same reference once the CRM is back', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('tunnel down'));
    const queued = await (await call(postOrder, order(), env)).json<any>();

    // Too soon: the next order goes through but does not retry yet.
    await call(postOrder, order({ checkoutId: 'checkout-0002' }), env);
    await settle();
    expect(kv.store.has(`outbox:${queued.orderRef}`)).toBe(true);

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3 * 60_000);
    await call(postOrder, order({ checkoutId: 'checkout-0003' }), env);
    await settle();
    expect(kv.store.has(`outbox:${queued.orderRef}`)).toBe(false);
    const resent = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body)).filter((b) => b.external_ref === queued.orderRef);
    expect(resent).toHaveLength(2);
    expect(resent[1]).toEqual(resent[0]);
  });

  it('keeps a parked order while the CRM stays down', async () => {
    fetchMock.mockRejectedValue(new TypeError('tunnel down'));
    const queued = await (await call(postOrder, order(), env)).json<any>();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3 * 60_000);
    await call(postOrder, order({ checkoutId: 'checkout-0002' }), env);
    await settle();
    expect(kv.store.has(`outbox:${queued.orderRef}`)).toBe(true);
  });

  it('fails and releases the lock when the CRM is down and the outbox cannot be written', async () => {
    kv.failPuts = true;
    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    expect((await call(postOrder, order(), env)).status).toBe(502);
    expect(kv.store.has('order:checkout-0001')).toBe(false);
  });

  describe('with the bot check enabled', () => {
    const withBotCheck = () => ({ ...env, TURNSTILE_SECRET_KEY: 'turnstile-secret' });

    it('accepts a verified token and checks it with Cloudflare before the CRM', async () => {
      const res = await call(postOrder, order({ turnstileToken: 'human-token' }), withBotCheck());
      expect(res.status).toBe(201);
      expect(fetchMock.mock.calls[0][0]).toMatch(/siteverify$/);
      expect((fetchMock.mock.calls[0][1].body as FormData).get('secret')).toBe('turnstile-secret');
      expect(fetchMock.mock.calls[1][0]).toMatch(/online_ordering$/);
    });

    it.each([
      ['a missing token', {}],
      ['a rejected token', { turnstileToken: 'bot-token' }],
    ])('refuses %s with 403 and never calls the CRM or locks the checkout', async (_label, extra) => {
      const res = await call(postOrder, order(extra), withBotCheck());
      expect(res.status).toBe(403);
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/webhooks/'))).toBe(false);
      expect(kv.store.size).toBe(0);
    });

    it('answers 503 when Cloudflare cannot be reached', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('network down'));
      expect((await call(postOrder, order({ turnstileToken: 'human-token' }), withBotCheck())).status).toBe(503);
    });
  });

  it('still confirms the order when storing the replay copy fails', async () => {
    kv.failPuts = true;
    expect((await call(postOrder, order(), env)).status).toBe(201);
  });
});

describe('enquiries', () => {
  const today = new Date('2026-11-18T00:00:00Z');
  const base = { kind: 'catering', name: 'Ada Lovelace', email: 'ADA@example.com', message: 'Lunch for the whole team please', consent: true, storeId: 'southbank', guests: 24, eventDate: '2026-12-01' };
  const env: Env = { CRM_BASE_URL: CRM, GOURWEST_WEBHOOK_SECRET: SECRET, CRM_WEB_FORM_ID: '3' };

  it('normalises a valid catering enquiry', () => {
    expect(parseEnquiry(base, today)).toMatchObject({ email: 'ada@example.com', guests: 24, storeId: 'southbank' });
  });

  it.each([
    ['too few guests', { guests: 4 }],
    ['date too soon', { eventDate: '2026-11-19' }],
    ['date too far', { eventDate: '2027-12-01' }],
    ['bad email', { email: 'nope' }],
    ['no consent', { consent: false }],
    ['short message', { message: 'hi' }],
    ['unknown store', { storeId: 'mars' }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => parseEnquiry({ ...base, ...overrides }, today)).toThrow();
  });

  it('creates the lead with personal data and a sync event without it', async () => {
    const res = await call(postEnquiry, { ...base, kind: 'contact', topic: 'allergens', phone: '+61 400-000 000' }, env);
    expect(res.status).toBe(201);
    const [leadUrl, leadInit] = fetchMock.mock.calls[0];
    expect(leadUrl).toBe(`${CRM}/web-forms/forms/3`);
    expect((leadInit.body as FormData).get('persons[emails][0][value]')).toBe('ada@example.com');
    // The CRM's PhoneNumber rule only accepts `^\+?\d+$`.
    expect((leadInit.body as FormData).get('persons[contact_numbers][0][value]')).toBe('+61400000000');
    const [hookUrl, hookInit] = fetchMock.mock.calls[1];
    expect(hookUrl).toBe(`${CRM}/api/gourwest/webhooks/customer_support`);
    expect(hookInit.body).not.toMatch(/Ada|example\.com/);
    expect(JSON.parse(hookInit.body).event_type).toBe('contact.allergens.submitted');
  });

  it('refuses enquiries that fail the bot check before creating a lead', async () => {
    const res = await call(postEnquiry, { ...base, turnstileToken: 'bot-token' }, { ...env, TURNSTILE_SECRET_KEY: 'turnstile-secret' });
    expect(res.status).toBe(403);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/web-forms/'))).toBe(false);
  });

  it('refuses enquiries when no lead form is configured, so nothing is silently dropped', async () => {
    const res = await call(postEnquiry, base, { CRM_BASE_URL: CRM, GOURWEST_WEBHOOK_SECRET: SECRET });
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tells the guest when the CRM does not save the lead', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 422 }));
    expect((await call(postEnquiry, base, env)).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still succeeds when only the sync event fails', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.includes('/web-forms/') ? new Response('{}', { status: 200 }) : new Response('', { status: 500 })));
    expect((await call(postEnquiry, base, env)).status).toBe(201);
  });
});

describe('POST /api/concierge', () => {
  it('falls back to the house recommender without an API key', async () => {
    const res = await call(postConcierge, { messages: [{ role: 'user', content: 'something vegan' }] }, {});
    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.source).toBe('house');
    expect(body.items.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a trimmed history that starts with an assistant turn', async () => {
    const res = await call(postConcierge, { messages: [{ role: 'assistant', content: 'Hi!' }, { role: 'user', content: 'spicy please' }] }, {});
    expect(res.status).toBe(200);
  });

  const modelReply = (content: unknown) =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
  const keys = { GROQ_API_KEY: 'gsk-test', NVIDIA_API_KEY: 'nvapi-test' };

  it('answers with Groq and keeps only real menu slugs', async () => {
    fetchMock.mockImplementation(async () => modelReply({ reply: 'Go the tofu bowl.', item_slugs: ['teriyaki-tofu-bowl', 'made-up-dish', 'teriyaki-tofu-bowl'] }));
    const res = await call(postConcierge, { messages: [{ role: 'user', content: 'vegan' }], storeId: 'melbourne-central', bag: [seoul.slug, 'nope'] }, keys);
    const body = await res.json<any>();
    expect(body).toEqual({ reply: 'Go the tofu bowl.', items: ['teriyaki-tofu-bowl'], source: 'ai' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('api.groq.com');
    const system = JSON.parse(init.body).messages.filter((m: any) => m.role === 'system').map((m: any) => m.content).join(' ');
    // The guest's bag and kitchen reach the model; unknown slugs don't.
    expect(system).toContain(`Already in their bag: ${seoul.name}`);
    expect(system).toContain('Melbourne Central, Melbourne, where it is');
    expect(system).not.toContain('nope');
  });

  it('falls back to NVIDIA when Groq fails, then to the house recommender', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('groq') ? new Response('', { status: 503 }) : modelReply({ reply: 'Try the fries.', item_slugs: ['seasoned-fries'] }),
    );
    const viaNim = await (await call(postConcierge, { messages: [{ role: 'user', content: 'a side' }] }, keys)).json<any>();
    expect(viaNim).toMatchObject({ source: 'ai', items: ['seasoned-fries'] });

    fetchMock.mockImplementation(async () => modelReply({ not: 'the schema' }));
    const viaHouse = await (await call(postConcierge, { messages: [{ role: 'user', content: 'something vegan' }] }, keys)).json<any>();
    expect(viaHouse.source).toBe('house');
    expect(viaHouse.items.length).toBeGreaterThan(0);
  });

  it('validates the conversation shape', async () => {
    expect((await call(postConcierge, { messages: [] }, {})).status).toBe(422);
    expect((await call(postConcierge, { messages: [{ role: 'user', content: 'x'.repeat(601) }] }, {})).status).toBe(422);
    expect((await call(postConcierge, { messages: [{ role: 'assistant', content: 'hi' }] }, {})).status).toBe(422);
  });
});
