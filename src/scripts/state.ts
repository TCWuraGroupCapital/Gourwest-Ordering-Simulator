/**
 * Browser-side state: the bag and the chosen pickup kitchen, persisted in localStorage
 * under `gourwest:*` keys. Every change dispatches `gourwest:change` so the header,
 * cart page and concierge stay in sync across components and tabs.
 */
import { DEFAULT_STORE_ID, findStore, type Store } from '../data/stores';
import { MAX_QTY, lineKey, priceLine, CartError, type LineInput, type PricedLine } from '../lib/pricing';
import { trackOrder } from '../lib/tracking';

const CART_KEY = 'gourwest:cart';
const STORE_KEY = 'gourwest:store';
const LAST_ORDER_KEY = 'gourwest:last-order';
const USUAL_KEY = 'gourwest:usual';
const CLUB_KEY = 'gourwest:club';
export const EVENT = 'gourwest:change';

function read<T>(key: string, fallback: T, storage: Storage | undefined = safeLocal()): T {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown, storage: Storage | undefined = safeLocal()): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(value));
  } catch {
    /* Private mode or quota: the session still works in memory for this page view. */
  }
}

function safeLocal(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function safeSession(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

const notify = () => window.dispatchEvent(new CustomEvent(EVENT));

/** Stored lines that still price correctly against the current menu; stale lines are dropped. */
function priceStored(key: string): PricedLine[] {
  const raw = read<LineInput[]>(key, []);
  const priced: PricedLine[] = [];
  for (const line of Array.isArray(raw) ? raw : []) {
    try {
      priced.push(priceLine(line));
    } catch (error) {
      if (!(error instanceof CartError)) throw error;
    }
  }
  return priced;
}

export const getCart = () => priceStored(CART_KEY);

function saveCart(lines: LineInput[]): void {
  write(
    CART_KEY,
    lines.map(({ slug, qty, choices, note }) => ({ slug, qty, choices, note })),
  );
  notify();
}

export function addToCart(input: LineInput): PricedLine {
  const added = priceLine(input);
  const lines = getCart();
  const key = lineKey(added);
  const existing = lines.find((line) => lineKey(line) === key);
  if (existing) existing.qty = Math.min(MAX_QTY, existing.qty + added.qty);
  else lines.push(added);
  saveCart(lines);
  return added;
}

export function setQty(index: number, qty: number): void {
  const lines = getCart();
  if (!lines[index]) return;
  if (qty <= 0) lines.splice(index, 1);
  else lines[index].qty = Math.min(MAX_QTY, qty);
  saveCart(lines);
}

export function clearCart(): void {
  saveCart([]);
}

export function cartSummary(): { count: number; subtotal: number } {
  return getCart().reduce((acc, line) => ({ count: acc.count + line.qty, subtotal: acc.subtotal + line.total }), { count: 0, subtotal: 0 });
}

/**
 * "Your usual": the dishes of the last order placed on this device, for a one-tap reorder.
 * Only dishes, options and quantities are kept — never the pickup name, member number or kitchen note.
 */
export const getUsual = () => priceStored(USUAL_KEY);

export function saveUsual(lines: PricedLine[]): void {
  write(USUAL_KEY, lines.map(({ slug, qty, choices }) => ({ slug, qty, choices })));
  notify();
}

export function forgetUsual(): void {
  write(USUAL_KEY, null);
  notify();
}

export function getStore(): Store {
  return findStore(read<string>(STORE_KEY, DEFAULT_STORE_ID)) ?? findStore(DEFAULT_STORE_ID)!;
}

export function setStore(id: string): void {
  if (!findStore(id)) return;
  write(STORE_KEY, id);
  notify();
}

/** The /api/orders reply, kept on this device so the pickup tracker survives new tabs and reloads. */
export interface PlacedOrder {
  orderRef: string;
  placedAt: string;
  store: { id: string; name: string; city: string; prepMinutes: number };
  pickupName: string;
  lines: { name: string; qty: number; summary: string[]; note: string; total: number }[];
  subtotal: number;
  /** balance/tier are absent on orders stored before they existed, and null when the CRM didn't send them. */
  member: { number: string; pointsEarned: number; updated: boolean; balance?: number | null; tier?: string | null } | null;
  /** null while the order waits on the server to reach the CRM. */
  crm: { eventId: number | string; latencyMs: number } | null;
}

/**
 * Stamped with this device's clock on receipt, so a fast or slow device clock can't skew the countdown.
 * A member order also replaces the stored Club balance, which is only ever kept paired with its member number.
 */
export function saveLastOrder(order: PlacedOrder): void {
  write(LAST_ORDER_KEY, { ...order, placedAt: new Date().toISOString() });
  const m = order.member;
  if (m) write(CLUB_KEY, typeof m.balance === 'number' ? { number: m.number, balance: m.balance } : null);
  notify();
}

/** The balance from this device's last order with exactly this member number, or null. */
export function clubBalance(memberNumber: string): number | null {
  const club = read<{ number?: unknown; balance?: unknown } | null>(CLUB_KEY, null);
  return memberNumber && club?.number === memberNumber && typeof club.balance === 'number' ? club.balance : null;
}

const isPlacedOrder = (o: Partial<PlacedOrder> | null): o is PlacedOrder =>
  typeof o?.orderRef === 'string' &&
  typeof o.placedAt === 'string' &&
  typeof o.pickupName === 'string' &&
  typeof o.subtotal === 'number' &&
  typeof o.store?.prepMinutes === 'number' &&
  Array.isArray(o.lines) &&
  typeof o.crm === 'object';

/** The order in progress, or null. Malformed or collected orders are deleted so a shared device forgets them. */
export function lastOrder(): PlacedOrder | null {
  const order = read<Partial<PlacedOrder> | null>(LAST_ORDER_KEY, null);
  if (isPlacedOrder(order) && trackOrder(order.placedAt, order.store.prepMinutes)?.active) return order;
  if (order) write(LAST_ORDER_KEY, null);
  return null;
}

// Keep tabs in sync when another tab edits the bag, store or last order.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if ([CART_KEY, STORE_KEY, LAST_ORDER_KEY, USUAL_KEY, CLUB_KEY].includes(event.key ?? '')) notify();
  });
  // A page restored from the back/forward cache missed changes made on the page you came back from.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) notify();
  });
}
