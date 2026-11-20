/**
 * Luminara CRM client for the Gourwest integration contract
 * (Luminara-CRM/docs/gourwest-ordering-simulator-spec.md):
 *   POST {CRM_BASE_URL}/api/gourwest/webhooks/{system}
 *   X-Gourwest-Signature: sha256=<hex HMAC-SHA256 of the exact raw body>
 * The secret lives only in the Pages Function environment; the browser never sees it.
 */
import { HttpError, type Env } from './http';

export type CrmSystem = 'online_ordering' | 'customer_support';

export interface CrmWebhookReply {
  status: 'processed';
  data: {
    system_code: string;
    event_id: number | string;
    external_ref: string;
    latency_ms: number;
    customer_updated: boolean;
    /** The member's balance and tier after this event; sent only when customer_updated, and absent from older CRMs. */
    points_balance?: number | null;
    tier?: string | null;
  };
}

const TIMEOUT_MS = 10_000;

/**
 * Failures that a later resend can fix: the CRM was down, slow, busy or garbled its reply. It may already
 * have recorded the event, which is fine to resend because it keeps one event per external_ref (DEF-01).
 * Not included: crm_rejected and crm_unconfigured, configuration faults a resend would only repeat.
 */
export const TRANSIENT = new Set(['crm_timeout', 'crm_error', 'crm_bad_reply', 'crm_unreachable', 'crm_busy']);

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Order/enquiry reference, e.g. WEB-AU-MI3K9Z4F7QX: time-ordered plus 5 random base-36 characters. */
export function makeRef(prefix: string, region: string): string {
  const rand = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase().padStart(7, '0').slice(-5);
  return `${prefix}-${region}-${Date.now().toString(36).toUpperCase()}${rand}`;
}

function crmBase(env: Env): string {
  const base = env.CRM_BASE_URL?.trim().replace(/\/+$/, '');
  if (!base || !env.GOURWEST_WEBHOOK_SECRET) {
    throw new HttpError(503, 'crm_unconfigured', 'Online ordering is temporarily unavailable. Please order at the counter.');
  }
  return base;
}

/** Sends one signed webhook, once. Orders that hit a TRANSIENT failure are resent through the outbox. */
export async function sendWebhook(env: Env, system: CrmSystem, payload: Record<string, unknown>): Promise<CrmWebhookReply> {
  const base = crmBase(env);
  const body = JSON.stringify(payload);
  const signature = await hmacHex(env.GOURWEST_WEBHOOK_SECRET!, body);

  let response: Response;
  try {
    response = await fetch(`${base}/api/gourwest/webhooks/${system}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Gourwest-Signature': `sha256=${signature}` },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    console.error('CRM webhook transport failure', { system, timedOut });
    if (timedOut) {
      throw new HttpError(504, 'crm_timeout', 'The kitchen system is slow to respond. Your order may still have been received — please check with the kitchen before ordering again.');
    }
    throw new HttpError(502, 'crm_unreachable', 'We could not reach the kitchen system. Nothing was sent; please try again in a minute.');
  }

  if (response.status === 429) throw new HttpError(429, 'crm_busy', 'The kitchen system is busy. Please wait a moment and try again.');
  if (response.status >= 500) {
    console.error('CRM webhook server error', { system, status: response.status });
    throw new HttpError(502, 'crm_error', 'The kitchen system had a problem and may not have saved this. Please check with the kitchen before ordering again.');
  }
  if (!response.ok) {
    // 401 = secret mismatch, 404 = wrong system code: configuration faults, nothing was recorded.
    console.error('CRM webhook rejected', { system, status: response.status });
    throw new HttpError(502, 'crm_rejected', 'The kitchen system declined the request. Our team has been notified.');
  }

  const reply = (await response.json().catch(() => null)) as CrmWebhookReply | null;
  if (reply?.status !== 'processed' || !reply.data) {
    throw new HttpError(502, 'crm_bad_reply', 'The kitchen system sent an unexpected reply and may have saved this. Please check before trying again.');
  }
  return reply;
}

/** Numeric Krayin web form id, or null when lead capture is not configured. */
export function webFormId(env: Env): string | null {
  const id = env.CRM_WEB_FORM_ID?.trim();
  return id && /^\d+$/.test(id) && env.CRM_BASE_URL?.trim() ? id : null;
}

/**
 * Creates a person + lead through a Krayin web form (Settings → Web Forms, "create lead" on, with the
 * name, email, phone, lead title and description attributes on the form). Server-to-server, so no CORS
 * entry is needed. Throws if the CRM does not confirm, so an enquiry is never reported as sent when it wasn't.
 */
export async function submitWebForm(
  env: Env,
  person: { name: string; email: string; phone?: string },
  lead: { title: string; description: string },
): Promise<void> {
  const id = webFormId(env);
  if (!id) throw new HttpError(503, 'enquiries_unconfigured', 'Online enquiries are unavailable right now. Please contact your nearest kitchen.');
  const form = new FormData();
  form.set('persons[name]', person.name);
  form.set('persons[emails][0][value]', person.email);
  form.set('persons[emails][0][label]', 'work');
  if (person.phone) {
    form.set('persons[contact_numbers][0][value]', person.phone);
    form.set('persons[contact_numbers][0][label]', 'work');
  }
  form.set('leads[title]', lead.title);
  form.set('leads[description]', lead.description);

  let res: Response;
  try {
    res = await fetch(`${env.CRM_BASE_URL!.trim().replace(/\/+$/, '')}/web-forms/forms/${id}`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error('CRM web form transport failure', error);
    throw new HttpError(502, 'lead_unreachable', 'We could not send your enquiry. Please try again in a minute.');
  }
  if (!res.ok) {
    console.error('CRM web form rejected', { status: res.status });
    throw new HttpError(502, 'lead_rejected', 'We could not save your enquiry. Please try again, or contact your nearest kitchen.');
  }
}
