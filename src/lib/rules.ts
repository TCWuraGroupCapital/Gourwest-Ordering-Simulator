/**
 * Field rules shared by the browser forms and the Pages Functions, so the message a guest sees on blur
 * is exactly the rule the server enforces. Each rule returns '' when valid, otherwise the error to show.
 */
export const LIMITS = {
  nameMax: 80,
  pickupNameMax: 40,
  messageMin: 10,
  messageMax: 2000,
  guestsMin: 8,
  guestsMax: 500,
  leadDaysMin: 2,
  leadDaysMax: 365,
} as const;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const PHONE = /^[+()\d\s.-]{6,24}$/;
const MEMBER = /^GW-[A-Z]{2}-\d{4}$/;

/**
 * "+61 (0)400 000-000" → "+610400000000". Luminara CRM's web form only accepts `^\+?\d+$`,
 * so numbers are typed freely and sent as a leading + and digits.
 */
export function normalisePhone(value: string): string {
  const trimmed = value.trim();
  return (trimmed.startsWith('+') ? '+' : '') + trimmed.replace(/\D/g, '');
}

/** YYYY-MM-DD for `days` after `from` (UTC calendar day). */
export function isoDay(days: number, from = new Date()): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export const RULES = {
  name: (v: string) => (v.trim().length >= 2 ? '' : 'Enter your name.'),
  email: (v: string) => (EMAIL.test(v.trim()) ? '' : 'Enter a valid email address.'),
  phone: (v: string) => {
    if (!v.trim()) return '';
    const digits = normalisePhone(v).replace('+', '').length;
    return PHONE.test(v.trim()) && digits >= 6 && digits <= 15 ? '' : 'Enter a valid phone number, or leave it blank.';
  },
  message: (v: string) => (v.trim().length >= LIMITS.messageMin ? '' : `Tell us a little more (at least ${LIMITS.messageMin} characters).`),
  guests: (v: string) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= LIMITS.guestsMin && n <= LIMITS.guestsMax
      ? ''
      : `Catering starts at ${LIMITS.guestsMin} guests (up to ${LIMITS.guestsMax}).`;
  },
  eventDate: (v: string, today = new Date()) =>
    /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= isoDay(LIMITS.leadDaysMin, today) && v <= isoDay(LIMITS.leadDaysMax, today)
      ? ''
      : `Choose an event date at least ${LIMITS.leadDaysMin} days away and within a year.`,
  pickupName: (v: string) =>
    v.trim().length >= 1 && v.trim().length <= LIMITS.pickupNameMax ? '' : `Enter a name for the pickup shelf (up to ${LIMITS.pickupNameMax} characters).`,
  memberNumber: (v: string) => (!v || MEMBER.test(v) ? '' : 'Member numbers look like GW-AU-1006.'),
} satisfies Record<string, (value: string, today?: Date) => string>;

export type Field = keyof typeof RULES;
