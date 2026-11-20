/**
 * /llms.txt (llmstxt.org): a plain-Markdown brief for AI assistants, built from the same menu,
 * kitchen and Club data as the pages, so answers about Gourwest match the site.
 */
import type { APIRoute } from 'astro';
import { ALLERGEN_LABELS, CATEGORIES, DIETARY_LABELS, MENU } from '../data/menu';
import { STORES, formatHours } from '../data/stores';
import { formatAUD } from '../lib/pricing';
import { CATERING_FAQ, CLUB_FAQ, PICKUP_FAQ, list } from '../lib/seo';

export const GET: APIRoute = ({ site }) => {
  const url = (path: string) => new URL(path, site).href;
  const menu = CATEGORIES.map((c) =>
    [
      `### ${c.title}`,
      ...MENU.filter((m) => m.category === c.id).map((m) => {
        const tags = m.dietary.map((d) => DIETARY_LABELS[d]).join(', ');
        const contains = m.allergens.length ? m.allergens.map((a) => ALLERGEN_LABELS[a]).join(', ') : 'none of the major allergens';
        return `- [${m.name}](${url(`/menu/${m.slug}/`)}): ${formatAUD(m.price)} AUD, ${m.kcal} kcal, ${m.proteinG} g protein.${tags ? ` ${tags}.` : ''} Contains ${contains}. ${m.description}`;
      }),
    ].join('\n'),
  ).join('\n\n');

  const body = `# Gourwest

> Gourwest is a fast-casual kitchen serving global bowls, wraps and flame-grilled plates for online pickup, with ${STORES.length} kitchens in ${list([...new Set(STORES.map((s) => s.city))])}. Prices are in AUD.

Note: this site is a demonstration ordering simulator. Gourwest is a fictional brand and the menu, prices, kitchens and history are synthetic demo data; no real payments are taken.

## Key pages

- [Menu](${url('/menu/')}): every dish with price, calories, protein, dietary tags and options
- [Allergen guide](${url('/allergens/')}): the allergen matrix for the standard recipes
- [Locations](${url('/locations/')}): addresses, opening hours and pickup times
- [Gourwest Club](${url('/rewards/')}): points and tiers
- [Catering](${url('/catering/')}): packages for 8 to 500 guests
- [Contact](${url('/contact/')}): questions about orders, allergens or data

## Ordering

${PICKUP_FAQ.a}

${CLUB_FAQ.a}

${CATERING_FAQ.a}

## Kitchens

${STORES.map((s) => `- [${s.name}, ${s.city}](${url(`/locations/#${s.id}`)}): open daily ${formatHours(s)} local time; ready in about ${s.prepMinutes} minutes.`).join('\n')}

## Menu

${menu}

Kitchens share equipment, so no dish is certified allergen-free. Guests with a severe allergy should call the kitchen before ordering.
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
