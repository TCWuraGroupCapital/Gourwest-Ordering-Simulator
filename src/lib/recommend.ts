/**
 * House recommender: a deterministic, menu-grounded fallback for the concierge when no
 * AI provider key is configured (or every provider fails). Pure — safe to unit test.
 */
import { DIETARY_LABELS, MENU, type Allergen, type CategoryId, type Dietary, type MenuItem } from '../data/menu';
import { formatAUD } from './pricing';

export interface Intent {
  dietary: Dietary[];
  avoid: Allergen[];
  categories: CategoryId[];
  maxPrice?: number;
  light: boolean;
  groupSize?: number;
}

const has = (text: string, ...words: string[]) => words.some((w) => new RegExp(`\\b${w}`, 'i').test(text));

export function readIntent(text: string): Intent {
  const dietary: Dietary[] = [];
  if (has(text, 'vegan', 'plant')) dietary.push('plant-based');
  else if (has(text, 'vegetarian', 'veggie', 'no meat', 'meat-free', 'meatless')) dietary.push('vegetarian');
  if (has(text, 'protein', 'gym', 'bulk', 'workout', 'macro')) dietary.push('high-protein');
  if (has(text, 'spicy', 'spice', 'hot', 'chilli', 'chili', 'kick', 'heat')) dietary.push('spicy');
  if (has(text, 'dairy', 'lactose')) dietary.push('dairy-free');

  const avoid: Allergen[] = [];
  const allergens: Allergen[] = ['gluten', 'soy', 'sesame', 'egg', 'milk', 'mustard', 'fish'];
  for (const a of allergens) {
    if (new RegExp(`(no|free|without|avoid|allerg\\w*|intoleran\\w*|coeliac|celiac)[^.?!]{0,24}${a}|${a}[- ]free`, 'i').test(text)) avoid.push(a);
  }
  if (has(text, 'coeliac', 'celiac') && !avoid.includes('gluten')) avoid.push('gluten');
  if (dietary.includes('dairy-free') && !avoid.includes('milk')) avoid.push('milk');

  const categories: CategoryId[] = [];
  if (has(text, 'bowl')) categories.push('bowls');
  if (has(text, 'wrap')) categories.push('wraps');
  if (has(text, 'plate', 'grill', 'hearty', 'dinner')) categories.push('grill');
  if (has(text, 'side', 'snack', 'share')) categories.push('sides');
  if (has(text, 'drink', 'thirsty', 'lemonade', 'tea')) categories.push('drinks');

  const money = text.match(/(?:under|below|less than|max|budget|up to)?\s*\$\s?(\d{1,3}(?:\.\d{1,2})?)/i);
  const maxPrice = money ? Math.round(Number(money[1]) * 100) : undefined;
  const group = text.match(/\b(?:for|feed|team of|group of)\s+(\d{1,3})\b/i);

  return {
    dietary,
    avoid,
    categories,
    maxPrice,
    light: has(text, 'light', 'low cal', 'lean', 'healthy', 'diet'),
    groupSize: group ? Number(group[1]) : undefined,
  };
}

function score(item: MenuItem, intent: Intent, includeSides: boolean): number {
  if (intent.avoid.some((a) => item.allergens.includes(a))) return -Infinity;
  if (intent.maxPrice !== undefined && item.price > intent.maxPrice) return -Infinity;
  if (intent.dietary.includes('plant-based') && !item.dietary.includes('plant-based')) return -Infinity;
  if (intent.dietary.includes('vegetarian') && !item.dietary.includes('vegetarian')) return -Infinity;
  const allowed = intent.categories.length ? intent.categories : (['bowls', 'wraps', 'grill', ...(includeSides ? ['sides'] : [])] as CategoryId[]);
  if (!allowed.includes(item.category)) return -Infinity;

  let s = 0;
  for (const d of intent.dietary) if (item.dietary.includes(d)) s += 3;
  // A stated preference (protein, heat, dairy-free) must be met by at least one tag.
  if (intent.dietary.length && s === 0) return -Infinity;
  if (intent.light) s += item.kcal <= 520 ? 2 : -1;
  if (item.badge) s += 1;
  return s;
}

export function recommend(text: string, limit = 3): { reply: string; items: string[] } {
  const intent = readIntent(text);
  const rank = (includeSides: boolean) =>
    MENU.map((item) => ({ item, s: score(item, intent, includeSides) }))
      .filter((r) => r.s > -Infinity)
      .sort((a, b) => b.s - a.s || a.item.price - b.item.price)
      .slice(0, limit)
      .map((r) => r.item);
  // Mains first; if none fit, sides are better than an empty answer.
  let ranked = rank(false);
  const sidesOnly = ranked.length === 0 && !intent.categories.length;
  if (sidesOnly) ranked = rank(true);

  if (intent.groupSize && intent.groupSize >= 8) {
    return {
      reply: `For ${intent.groupSize} people, our catering team builds platters and bowl bars to order — send a quick enquiry on the Catering page and we'll reply within one business day. Here are crowd favourites to start with:`,
      items: ranked.map((i) => i.slug),
    };
  }

  if (ranked.length === 0) {
    return {
      reply:
        "I couldn't find a dish that meets all of that. Try loosening one requirement, or check the allergen guide for the full ingredient matrix. For a severe allergy, please call the kitchen before ordering.",
      items: [],
    };
  }

  const reasons: string[] = [];
  if (intent.dietary.length) reasons.push(intent.dietary.map((d) => DIETARY_LABELS[d].toLowerCase()).join(', '));
  if (intent.avoid.length) reasons.push(`no ${intent.avoid.join(' or ')}`);
  if (intent.maxPrice !== undefined) reasons.push(`under ${formatAUD(intent.maxPrice)}`);
  if (intent.light) reasons.push('on the lighter side');

  const lead = sidesOnly
    ? `No main fits all of that as standard${reasons.length ? ` (${reasons.join(', ')})` : ''}, but these sides do. You can also customise a bowl’s sauce or toppings to remove an allergen.`
    : reasons.length
      ? `Here’s what fits — ${reasons.join(', ')}.`
      : 'Here are guest favourites right now.';
  const caution = intent.avoid.length
    ? ' Our kitchens share equipment, so we can’t guarantee zero traces — call the kitchen if your allergy is severe.'
    : '';
  return { reply: `${lead}${caution}`, items: ranked.map((i) => i.slug) };
}
