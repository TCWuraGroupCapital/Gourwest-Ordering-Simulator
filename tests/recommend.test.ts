import { describe, expect, it } from 'vitest';
import { findItem } from '../src/data/menu';
import { readIntent, recommend } from '../src/lib/recommend';

const items = (text: string) => recommend(text).items.map((slug) => findItem(slug)!);

describe('readIntent', () => {
  it('reads diet, allergens, budget and group size', () => {
    const intent = readIntent('Vegan, no sesame please, under $17 for 12 people');
    expect(intent.dietary).toContain('plant-based');
    expect(intent.avoid).toEqual(['sesame']);
    expect(intent.maxPrice).toBe(1700);
    expect(intent.groupSize).toBe(12);
  });

  it('treats coeliac as gluten-free', () => {
    expect(readIntent("I'm coeliac").avoid).toContain('gluten');
  });
});

describe('recommend', () => {
  it('only returns plant-based dishes for vegans', () => {
    const picks = items('something vegan and filling');
    expect(picks.length).toBeGreaterThan(0);
    picks.forEach((p) => expect(p.dietary).toContain('plant-based'));
  });

  it('excludes dishes containing an allergen to avoid', () => {
    items('high protein, gluten free').forEach((p) => expect(p.allergens).not.toContain('gluten'));
    expect(recommend('high protein, gluten free').reply).toMatch(/call the kitchen/);
  });

  it('never pads results with sides or drinks unless asked', () => {
    const picks = items('high protein under $20, no gluten');
    expect(picks.map((p) => p.slug)).toEqual(['smoky-chipotle-beef-bowl']);
    const drinks = items('a cold drink');
    expect(drinks.length).toBeGreaterThan(0);
    expect(drinks.every((p) => p.category === 'drinks')).toBe(true);
  });

  it('respects a budget', () => {
    items('lunch under $16').forEach((p) => expect(p.price).toBeLessThanOrEqual(1600));
  });

  it('points large groups to catering', () => {
    expect(recommend('lunch for 20 at the office').reply).toMatch(/catering/i);
  });

  it('offers sides rather than nothing when no main fits', () => {
    const result = recommend('plant-based, no sesame');
    expect(result.items.length).toBeGreaterThan(0);
    result.items.map((s) => findItem(s)!).forEach((p) => {
      expect(p.category).toBe('sides');
      expect(p.allergens).not.toContain('sesame');
    });
    expect(result.reply).toMatch(/sides/);
  });

  it('says so when nothing fits', () => {
    const result = recommend('vegan wrap under $5');
    expect(result.items).toEqual([]);
    expect(result.reply).toMatch(/couldn't find/);
  });
});
