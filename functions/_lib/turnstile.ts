/**
 * Cloudflare Turnstile server-side check for the public write endpoints (orders, enquiries).
 * Without TURNSTILE_SECRET_KEY (local development) the check is skipped; in production a missing
 * or invalid token is refused before anything reaches the CRM.
 */
import { HttpError, type Env } from './http';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(env: Env, request: Request, token: unknown): Promise<void> {
  if (!env.TURNSTILE_SECRET_KEY) return;
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    throw new HttpError(403, 'bot_check_failed', 'Please complete the security check and try again.');
  }
  const form = new FormData();
  form.set('secret', env.TURNSTILE_SECRET_KEY);
  form.set('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.set('remoteip', ip);

  let outcome: { success?: boolean; 'error-codes'?: string[] } | null;
  try {
    const res = await fetch(SITEVERIFY, { method: 'POST', body: form, signal: AbortSignal.timeout(5_000) });
    outcome = await res.json();
  } catch (error) {
    console.error('Turnstile verification unavailable', error);
    throw new HttpError(503, 'bot_check_unavailable', 'Our security check is unavailable. Please try again in a minute.');
  }
  if (!outcome?.success) {
    console.error('Turnstile rejected', { codes: outcome?.['error-codes'] });
    throw new HttpError(403, 'bot_check_failed', 'Please complete the security check and try again.');
  }
}
