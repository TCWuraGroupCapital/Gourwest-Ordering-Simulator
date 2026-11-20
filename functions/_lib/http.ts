/** Small HTTP helpers shared by the Pages Functions. */

export interface Env {
  CRM_BASE_URL?: string;
  GOURWEST_WEBHOOK_SECRET?: string;
  CRM_WEB_FORM_ID?: string;
  GROQ_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  ORDERS_KV?: KVNamespace;
}

const MAX_BODY_BYTES = 32_000;

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export const problem = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Validates an incoming POST at the edge: same-origin browser requests only (a cheap CSRF and
 * hot-link guard for a cookie-less JSON API), JSON content type, bounded size, a JSON object body,
 * and an empty `website` honeypot (bots fill every field). Returns the parsed object.
 */
export async function readJsonPost(request: Request): Promise<Record<string, unknown>> {
  // Browsers always send Origin on POST; anything else (missing, "null", another site) is refused.
  let sameOrigin = false;
  try {
    sameOrigin = new URL(request.headers.get('Origin') ?? '').host === new URL(request.url).host;
  } catch {
    /* missing or opaque origin */
  }
  if (!sameOrigin) throw new HttpError(403, 'forbidden_origin', 'Cross-origin requests are not allowed.');
  if (!(request.headers.get('Content-Type') ?? '').includes('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Send JSON.');
  }
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'Request body is too large.');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'too_large', 'Request body is too large.');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_json', 'Send a JSON object.');
  const record = body as Record<string, unknown>;
  if (typeof record.website === 'string' && record.website !== '') throw new HttpError(400, 'rejected', 'Request could not be processed.');
  return record;
}

/** Turns thrown HttpErrors into problem responses; anything else is logged and hidden. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) return problem(error.status, error.code, error.message);
    console.error('Unhandled function error', error);
    return problem(500, 'internal_error', 'Something went wrong on our side. Please try again.');
  }
}

export const methodNotAllowed = () => json({ error: { code: 'method_not_allowed', message: 'Use POST.' } }, 405, { Allow: 'POST' });
