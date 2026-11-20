/**
 * POST /api/enquiries — catering and contact enquiries.
 * Creates a person + lead in Luminara CRM through the Krayin web form (CRM_WEB_FORM_ID, required),
 * then records a signed sync event without personal data for the Gourwest hub.
 */
import { findStore } from '../../src/data/stores';
import { makeRef, sendWebhook, submitWebForm } from '../_lib/crm';
import { verifyTurnstile } from '../_lib/turnstile';
import { LIMITS, RULES, normalisePhone, type Field } from '../../src/lib/rules';
import { handle, HttpError, json, methodNotAllowed, readJsonPost, type Env } from '../_lib/http';

interface EnquiryInput {
  kind: 'catering' | 'contact';
  name: string;
  email: string;
  phone?: string;
  message: string;
  storeId?: string;
  eventDate?: string;
  guests?: number;
  topic?: string;
}

const TOPICS = ['feedback', 'order', 'allergens', 'privacy', 'other'] as const;

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max) : '');

/** Validates and normalises an enquiry with the shared field rules; throws HttpError(422) naming the first bad field. */
export function parseEnquiry(body: Record<string, unknown>, today = new Date()): EnquiryInput {
  const fail = (field: string, message: string): never => {
    throw new HttpError(422, `invalid_${field}`, message);
  };
  const check = (field: Field, value: string) => {
    const message = RULES[field](value, today);
    if (message) fail(field, message);
    return value;
  };

  const kind = body.kind === 'catering' || body.kind === 'contact' ? body.kind : fail('kind', 'Unknown enquiry type.');
  const input: EnquiryInput = {
    kind,
    name: check('name', text(body.name, LIMITS.nameMax)),
    email: check('email', text(body.email, 254).toLowerCase()),
    phone: normalisePhone(check('phone', text(body.phone, 24))) || undefined,
    message: check('message', text(body.message, LIMITS.messageMax)),
  };
  if (body.consent !== true) fail('consent', 'Please agree to be contacted about this enquiry.');

  if (kind === 'catering') {
    const store = findStore(String(body.storeId ?? '')) ?? fail('store', 'Choose the kitchen nearest your event.');
    input.storeId = store.id;
    input.guests = Number(check('guests', String(body.guests ?? '')));
    input.eventDate = check('eventDate', String(body.eventDate ?? ''));
  } else {
    input.topic = TOPICS.find((t) => t === body.topic) ?? 'other';
  }
  return input;
}

export const onRequestPost: PagesFunction<Env> = ({ request, env }) =>
  handle(async () => {
    const body = await readJsonPost(request);
    const enquiry = parseEnquiry(body);
    await verifyTurnstile(env, request, body.turnstileToken);
    const store = enquiry.storeId ? findStore(enquiry.storeId) : undefined;
    const ref = makeRef(enquiry.kind === 'catering' ? 'CAT' : 'MSG', store?.region ?? 'AU');

    // 1. The lead (with the guest's details) is the record that matters: if it fails, the guest is told.
    await submitWebForm(
      env,
      { name: enquiry.name, email: enquiry.email, phone: enquiry.phone },
      enquiry.kind === 'catering'
        ? { title: `Catering: ${enquiry.guests} guests on ${enquiry.eventDate} (${store?.name})`, description: `${enquiry.message}\n\nRef ${ref}` }
        : { title: `Website enquiry (${enquiry.topic}) — ${enquiry.name}`, description: `${enquiry.message}\n\nRef ${ref}` },
    );

    // 2. A signed sync event (no personal data) for the Gourwest hub's integration log. Best effort:
    //    the lead already exists, so a failure here is logged rather than shown to the guest.
    try {
      await sendWebhook(env, enquiry.kind === 'catering' ? 'online_ordering' : 'customer_support', {
        event_type: enquiry.kind === 'catering' ? 'catering.enquiry.submitted' : `contact.${enquiry.topic}.submitted`,
        external_ref: ref,
        region_code: store?.region ?? 'AU',
      });
    } catch (error) {
      console.error('Enquiry sync event failed after lead was created', { ref, code: error instanceof HttpError ? error.code : 'unknown' });
    }

    return json({ ref }, 201);
  });

export const onRequest: PagesFunction<Env> = () => methodNotAllowed();
