/**
 * GET /api/health — deploy smoke test. Reports which integrations are configured, never their values.
 * Also nudges the order outbox, so an uptime monitor on this URL resends parked orders without waiting for traffic.
 */
import { json, type Env } from '../_lib/http';
import { drainOutbox } from '../_lib/outbox';

export const onRequestGet: PagesFunction<Env> = (context) => {
  const { env } = context;
  context.waitUntil(drainOutbox(env));
  return json({
    ok: true,
    crm: Boolean(env.CRM_BASE_URL?.trim() && env.GOURWEST_WEBHOOK_SECRET),
    leadForm: Boolean(env.CRM_WEB_FORM_ID?.trim()),
    concierge: env.GROQ_API_KEY || env.NVIDIA_API_KEY ? 'ai' : 'house',
    idempotency: Boolean(env.ORDERS_KV),
    botCheck: Boolean(env.TURNSTILE_SECRET_KEY),
  });
};
