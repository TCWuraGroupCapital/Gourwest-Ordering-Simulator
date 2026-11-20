/**
 * Shared handler for `form[data-enquiry]` (catering and contact): inline validation on blur,
 * one POST to /api/enquiries, then a success panel that replaces the form.
 */
import { LIMITS, RULES, isoDay, type Field } from '../lib/rules';

const isField = (name: string): name is Field => name in RULES;

/** Turnstile tokens are single-use: get a fresh one after any failed submit. */
const resetBotCheck = () => (window as Window & { turnstile?: { reset(): void } }).turnstile?.reset();

function showError(form: HTMLFormElement, name: string, message: string) {
  const input = form.elements.namedItem(name) as HTMLInputElement | null;
  const box = form.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
  if (!input || !box) return;
  input.setAttribute('aria-invalid', String(Boolean(message)));
  box.textContent = message;
  box.hidden = !message;
}

function validate(form: HTMLFormElement, name: string): boolean {
  const input = form.elements.namedItem(name) as HTMLInputElement | null;
  if (!isField(name) || !input) return true;
  const message = RULES[name](input.value);
  showError(form, name, message);
  return !message;
}

for (const form of document.querySelectorAll<HTMLFormElement>('form[data-enquiry]')) {
  const dateInput = form.elements.namedItem('eventDate') as HTMLInputElement | null;
  if (dateInput) {
    dateInput.min = isoDay(LIMITS.leadDaysMin);
    dateInput.max = isoDay(LIMITS.leadDaysMax);
  }

  form.addEventListener('focusout', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.name && target.value) validate(form, target.name);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const names = Object.keys(RULES).filter((n) => form.querySelector(`[data-error-for="${n}"]`));
    const results = names.map((n) => validate(form, n));
    const consent = form.elements.namedItem('consent') as HTMLInputElement;
    const consentBox = form.querySelector<HTMLElement>('[data-error-for="consent"]')!;
    consentBox.hidden = consent.checked;
    consentBox.textContent = consent.checked ? '' : 'Please agree so we can reply to you.';
    if (results.includes(false) || !consent.checked) {
      form.querySelector<HTMLElement>('[aria-invalid="true"], [name="consent"]:not(:checked)')?.focus();
      return;
    }

    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    const status = form.querySelector<HTMLElement>('[data-status]')!;
    const label = submit.textContent;
    submit.disabled = true;
    submit.textContent = 'Sending…';
    status.hidden = true;

    const { 'cf-turnstile-response': turnstileToken, ...data } = Object.fromEntries(new FormData(form));
    try {
      const res = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, guests: data.guests ? Number(data.guests) : undefined, consent: consent.checked, turnstileToken }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? 'We could not send your enquiry. Please try again.');
      const done = form.parentElement!.querySelector<HTMLElement>('[data-done]')!;
      done.querySelector('[data-ref]')!.textContent = body.ref;
      form.hidden = true;
      done.hidden = false;
      done.focus();
    } catch (error) {
      resetBotCheck();
      status.textContent = error instanceof Error ? error.message : 'Network problem — please try again.';
      status.hidden = false;
      submit.disabled = false;
      submit.textContent = label;
    }
  });
}
