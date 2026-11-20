import { describe, expect, it } from 'vitest';
import { MENU, findItem } from '../src/data/menu';
import { CartError, defaultChoices, formatAUD, lineKey, priceCart, priceLine } from '../src/lib/pricing';

const seoul = findItem('seoul-bbq-chicken-bowl')!;

describe('priceLine', () => {
  it('prices a default bowl at its menu price', () => {
    const line = priceLine({ slug: seoul.slug, qty: 1, choices: defaultChoices(seoul) });
    expect(line.unit).toBe(1790);
    expect(line.summary).toEqual([]);
  });

  it('adds protein upgrades and multiple extras', () => {
    const choices = { ...defaultChoices(seoul), protein: ['double-bbq-chicken'], extras: ['avocado', 'egg'] };
    const line = priceLine({ slug: seoul.slug, qty: 2, choices });
    expect(line.unit).toBe(1790 + 550 + 300 + 200);
    expect(line.total).toBe(line.unit * 2);
    expect(line.summary).toContain('+ Sliced Hass avocado');
  });

  it("never charges for an item's own default protein", () => {
    const beef = findItem('smoky-chipotle-beef-bowl')!;
    expect(priceLine({ slug: beef.slug, qty: 1, choices: defaultChoices(beef) }).unit).toBe(beef.price);
    const swapped = priceLine({ slug: beef.slug, qty: 1, choices: { ...defaultChoices(beef), protein: ['bbq-chicken'] } });
    expect(swapped.unit).toBe(beef.price);
  });

  it.each([
    ['unknown dish', { slug: 'nope', qty: 1, choices: {} }],
    ['zero quantity', { slug: seoul.slug, qty: 0, choices: defaultChoices(seoul) }],
    ['fractional quantity', { slug: seoul.slug, qty: 1.5, choices: defaultChoices(seoul) }],
    ['over max quantity', { slug: seoul.slug, qty: 21, choices: defaultChoices(seoul) }],
    ['missing required group', { slug: seoul.slug, qty: 1, choices: { ...defaultChoices(seoul), base: [] } }],
    ['two choices in a single group', { slug: seoul.slug, qty: 1, choices: { ...defaultChoices(seoul), sauce: ['sesame', 'gochujang'] } }],
    ['unknown option', { slug: seoul.slug, qty: 1, choices: { ...defaultChoices(seoul), extras: ['gold-leaf'] } }],
    ['unknown group', { slug: seoul.slug, qty: 1, choices: { ...defaultChoices(seoul), hack: ['x'] } }],
    ['duplicate extras', { slug: seoul.slug, qty: 1, choices: { ...defaultChoices(seoul), extras: ['egg', 'egg'] } }],
  ])('rejects %s', (_label, input) => {
    expect(() => priceLine(input)).toThrow(CartError);
  });

  it('cleans control characters and caps the kitchen note', () => {
    const line = priceLine({ slug: seoul.slug, qty: 1, choices: defaultChoices(seoul), note: `no\u0000onion\n${'x'.repeat(300)}` });
    expect(line.note.startsWith('no onion ')).toBe(true);
    expect(line.note.length).toBe(140);
  });
});

describe('priceCart', () => {
  it('sums lines and earns 10 points per dollar, rounded down', () => {
    const fries = findItem('seasoned-fries')!;
    const cart = priceCart([
      { slug: seoul.slug, qty: 1, choices: defaultChoices(seoul) },
      { slug: fries.slug, qty: 2, choices: {} },
    ]);
    expect(cart.subtotal).toBe(1790 + 1300);
    expect(cart.points).toBe(309);
  });

  it('rejects empty and oversized carts', () => {
    expect(() => priceCart([])).toThrow(CartError);
    expect(() => priceCart('nope')).toThrow(CartError);
    const line = { slug: 'sparkling-water', qty: 1, choices: {} };
    expect(() => priceCart(Array.from({ length: 31 }, () => line))).toThrow(CartError);
  });
});

describe('catalogue integrity', () => {
  it('has unique slugs, positive prices and valid defaults', () => {
    expect(new Set(MENU.map((m) => m.slug)).size).toBe(MENU.length);
    for (const item of MENU) {
      expect(item.price).toBeGreaterThan(0);
      expect(() => priceLine({ slug: item.slug, qty: 1, choices: defaultChoices(item) })).not.toThrow();
      for (const [group, option] of Object.entries(item.defaults)) {
        expect(item.groups.find((g) => g.id === group)?.options.some((o) => o.id === option)).toBe(true);
      }
    }
  });
});

describe('helpers', () => {
  it('merges identical lines regardless of choice order', () => {
    const a = lineKey({ slug: 'x', choices: { extras: ['egg', 'avocado'], base: ['greens'] }, note: '' });
    const b = lineKey({ slug: 'x', choices: { base: ['greens'], extras: ['avocado', 'egg'] }, note: ' ' });
    expect(a).toBe(b);
  });

  it('formats AUD', () => {
    expect(formatAUD(1790)).toBe('$17.90');
  });
});
