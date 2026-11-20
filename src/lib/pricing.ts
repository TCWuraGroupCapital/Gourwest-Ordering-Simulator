/**
 * Pure cart pricing and validation shared by the browser and the Cloudflare Functions.
 * The server never trusts client totals: it re-runs priceCart() on the submitted lines.
 */
import { findItem, type MenuItem, type ModifierGroup } from '../data/menu';

export const MAX_QTY = 20;
export const MAX_LINES = 30;
/** Largest online order (A$600): bigger orders go through catering. */
export const MAX_ORDER_CENTS = 60_000;
export const MAX_NOTE = 140;
/** Demo earn rule from the CRM integration spec: 10 points per A$1. */
export const POINTS_PER_DOLLAR = 10;

export type Choices = Record<string, string[]>;

export interface LineInput {
  slug: string;
  qty: number;
  choices: Choices;
  note?: string;
}

export interface PricedLine {
  slug: string;
  name: string;
  qty: number;
  choices: Choices;
  note: string;
  /** Human-readable modifier summary, e.g. ["Ancient grains & brown rice", "+ Sliced Hass avocado"]. */
  summary: string[];
  unit: number;
  total: number;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotal: number;
  points: number;
}

export class CartError extends Error {}

export function defaultChoices(item: MenuItem): Choices {
  const choices: Choices = {};
  for (const group of item.groups) {
    const fallback = group.kind === 'single' && group.required ? group.options[0].id : undefined;
    const pick = item.defaults[group.id] ?? fallback;
    choices[group.id] = pick ? [pick] : [];
  }
  return choices;
}

/** What an option adds to the dish price: single choices are priced relative to the dish's default. */
export function surcharge(item: MenuItem, group: ModifierGroup, optionId: string): number {
  const option = group.options.find((o) => o.id === optionId);
  if (!option) throw new CartError(`Unknown option "${optionId}" for ${item.name}.`);
  if (group.kind === 'multi') return option.price;
  const defaultId = item.defaults[group.id] ?? group.options[0].id;
  const base = group.options.find((o) => o.id === defaultId)?.price ?? 0;
  return Math.max(0, option.price - base);
}

export function cleanNote(note: unknown): string {
  if (typeof note !== 'string') return '';
  // Drop control characters and collapse whitespace before it reaches a kitchen ticket.
  return note.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);
}

export function priceLine(input: LineInput): PricedLine {
  if (!input || typeof input !== 'object') throw new CartError('An item in your bag could not be read.');
  const item = findItem(String(input.slug ?? ''));
  if (!item) throw new CartError('An item in your bag is no longer on the menu.');
  const qty = Number(input.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new CartError(`Quantity for ${item.name} must be 1–${MAX_QTY}.`);

  const raw: Choices = input.choices && typeof input.choices === 'object' ? input.choices : {};
  for (const key of Object.keys(raw)) {
    if (!item.groups.some((g) => g.id === key)) throw new CartError(`Unknown option group "${key}" for ${item.name}.`);
  }

  const choices: Choices = {};
  const summary: string[] = [];
  let unit = item.price;

  for (const group of item.groups) {
    const picked = Array.isArray(raw[group.id]) ? raw[group.id].map(String) : [];
    if (new Set(picked).size !== picked.length) throw new CartError(`Duplicate choice in ${group.title}.`);
    if (group.kind === 'single' && picked.length > 1) throw new CartError(`Choose one ${group.title.toLowerCase()} for ${item.name}.`);
    if (group.required && picked.length === 0) throw new CartError(`Choose a ${group.title.toLowerCase()} for ${item.name}.`);

    for (const id of picked) {
      unit += surcharge(item, group, id);
      const option = group.options.find((o) => o.id === id)!;
      const isDefault = item.defaults[group.id] === id;
      if (group.kind === 'multi') summary.push(group.id === 'remove' ? option.name : `+ ${option.name}`);
      else if (!isDefault) summary.push(option.name);
    }
    choices[group.id] = picked;
  }

  const note = cleanNote(input.note);
  return { slug: item.slug, name: item.name, qty, choices, note, summary, unit, total: unit * qty };
}

export function priceCart(lines: unknown): PricedCart {
  if (!Array.isArray(lines) || lines.length === 0) throw new CartError('Your bag is empty.');
  if (lines.length > MAX_LINES) throw new CartError(`A single order can hold up to ${MAX_LINES} lines.`);
  const priced = lines.map((line) => priceLine(line as LineInput));
  const subtotal = priced.reduce((sum, line) => sum + line.total, 0);
  if (subtotal > MAX_ORDER_CENTS) throw new CartError(`Online orders are limited to ${formatAUD(MAX_ORDER_CENTS)} — for larger orders, use catering.`);
  return { lines: priced, subtotal, points: Math.floor((subtotal * POINTS_PER_DOLLAR) / 100) };
}

/** Stable identity so the same dish with the same choices merges into one cart line. */
export function lineKey(line: Pick<LineInput, 'slug' | 'choices' | 'note'>): string {
  const choices = Object.keys(line.choices ?? {})
    .sort()
    .map((k) => `${k}=${[...line.choices[k]].sort().join(',')}`)
    .join(';');
  return `${line.slug}|${choices}|${cleanNote(line.note)}`;
}

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2 });

export function formatAUD(cents: number): string {
  return AUD.format(cents / 100);
}
