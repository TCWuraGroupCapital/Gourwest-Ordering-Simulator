/**
 * Structured data and answer-first FAQs, generated from the menu, kitchens and Club data so search
 * engines and AI answer engines read the same facts the pages show. Pure — safe to unit test.
 * Every node has a stable @id, so the per-page JSON-LD blocks join into one graph.
 */
import { TIERS } from '../data/club';
import { ALLERGEN_LABELS, CATEGORIES, MENU, type MenuItem } from '../data/menu';
import { STORES, formatHours, type Store } from '../data/stores';
import { MAX_NOTE, POINTS_PER_DOLLAR, formatAUD, surcharge } from './pricing';

export type Node = Record<string, unknown>;
export interface Faq {
  q: string;
  a: string;
}

const abs = (path: string, site: URL) => new URL(path, site).href;
const ref = (id: string) => ({ '@id': id });
export const list = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const CUISINES = ['Korean', 'Mediterranean', 'Mexican', 'Japanese'];

export const ids = (site: URL) => ({
  org: abs('/#org', site),
  website: abs('/#website', site),
  menu: abs('/menu/#menu', site),
  store: (id: string) => abs(`/locations/#${id}`, site),
  dish: (slug: string) => abs(`/menu/${slug}/#dish`, site),
});

/** JSON for a <script type="application/ld+json">, with "<" escaped so content can never close the tag. */
export const ldJson = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

/** WebSite + Organization: on every page, so each page's nodes resolve against the same entity. */
export function siteNodes(site: URL): Node[] {
  const id = ids(site);
  return [
    { '@type': 'WebSite', '@id': id.website, url: site.href, name: 'Gourwest', inLanguage: 'en-AU', publisher: ref(id.org) },
    {
      '@type': 'Organization',
      '@id': id.org,
      name: 'Gourwest',
      url: site.href,
      slogan: 'Flavours united. Worldwide.',
      logo: abs('/brand/icon-512.png', site),
      areaServed: [...new Set(STORES.map((s) => s.country))],
    },
  ];
}

export function breadcrumbNode(site: URL, path: string, title: string): Node | null {
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return null;
  const crumbs = [{ name: 'Home', path: '/' }];
  if (parts.length > 1) crumbs.push({ name: parts[0][0].toUpperCase() + parts[0].slice(1), path: `/${parts[0]}/` });
  crumbs.push({ name: title, path });
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: abs(c.path, site) })),
  };
}

export function restaurantNode(store: Store, site: URL): Node {
  const id = ids(site);
  return {
    '@type': 'Restaurant',
    '@id': id.store(store.id),
    name: `Gourwest ${store.name}`,
    url: id.store(store.id),
    image: abs('/images/food/kitchen-1200.webp', site),
    parentOrganization: ref(id.org),
    servesCuisine: CUISINES,
    priceRange: '$$',
    currenciesAccepted: 'AUD',
    hasMenu: abs('/menu/', site),
    // City only: the kitchens are fictional, so no street address or coordinates that would pin them to a real venue.
    address: { '@type': 'PostalAddress', addressLocality: store.city, addressCountry: store.region },
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      opens: store.opens,
      closes: store.closes,
    },
  };
}

const DIETS: Partial<Record<MenuItem['dietary'][number], string>> = {
  'plant-based': 'https://schema.org/VeganDiet',
  vegetarian: 'https://schema.org/VegetarianDiet',
};

export function dishNode(item: MenuItem, site: URL): Node {
  const diets = item.dietary.flatMap((d) => DIETS[d] ?? []);
  return {
    '@type': 'MenuItem',
    '@id': ids(site).dish(item.slug),
    name: item.name,
    description: item.description,
    url: abs(`/menu/${item.slug}/`, site),
    ...(item.photo && { image: abs(`/images/food/${item.photo.src}-1200.webp`, site) }),
    offers: { '@type': 'Offer', price: (item.price / 100).toFixed(2), priceCurrency: 'AUD' },
    nutrition: { '@type': 'NutritionInformation', calories: `${item.kcal} kcal`, proteinContent: `${item.proteinG} g` },
    ...(diets.length && { suitableForDiet: diets }),
  };
}

export function menuNode(site: URL): Node {
  return {
    '@type': 'Menu',
    '@id': ids(site).menu,
    name: 'Gourwest menu',
    url: abs('/menu/', site),
    inLanguage: 'en-AU',
    hasMenuSection: CATEGORIES.map((c) => ({
      '@type': 'MenuSection',
      name: c.title,
      description: c.kicker,
      hasMenuItem: MENU.filter((m) => m.category === c.id).map((m) => dishNode(m, site)),
    })),
  };
}

export function faqNode(faqs: Faq[], pageUrl: URL): Node {
  return {
    '@type': 'FAQPage',
    '@id': `${pageUrl.href}#faq`,
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

/* ---------- Answer-first FAQs (each answer leads with the fact) ---------- */

const NOUN: Record<MenuItem['category'], string> = { bowls: 'bowl', wraps: 'wrap', grill: 'plate', sides: 'side', drinks: 'drink' };
const isMain = (item: MenuItem) => item.category !== 'sides' && item.category !== 'drinks';
const ALLERGY_CAUTION = 'Options can change this, and our kitchens share equipment, so we can’t rule out traces. For a severe allergy, call the kitchen before ordering.';

export function dishFaqs(item: MenuItem): Faq[] {
  const { name } = item;
  const faqs: Faq[] = [];

  const [cheapest] = item.groups
    .flatMap((g) => g.options.map((o) => ({ name: o.name, cost: surcharge(item, g, o.id) })))
    .filter((o) => o.cost > 0)
    .sort((a, b) => a.cost - b.cost);
  faqs.push({
    q: `How much is the ${name}?`,
    a: `${formatAUD(item.price)} AUD for the standard recipe.${cheapest ? ` Some swaps and extras cost more (${cheapest.name} is +${formatAUD(cheapest.cost)}), and the total updates before you add it to your bag.` : ''}`,
  });

  faqs.push({
    q: `How many calories are in the ${name}?`,
    a: `${item.kcal} kcal and ${item.proteinG} g of protein in the standard recipe.${item.groups.length ? ' Swaps and extras change both figures.' : ''}`,
  });

  if (item.dietary.includes('plant-based')) {
    faqs.push({ q: `Is the ${name} vegan?`, a: `Yes. The ${name} is plant-based as standard.` });
  } else {
    const alt = MENU.find((m) => m.category === item.category && m.dietary.includes('plant-based')) ?? MENU.find((m) => isMain(m) && m.dietary.includes('plant-based'));
    const lead = item.dietary.includes('vegetarian') ? 'It is vegetarian but not plant-based.' : `No. The ${name} is not vegetarian.`;
    faqs.push({ q: `Is the ${name} vegetarian or vegan?`, a: `${lead}${alt ? ` For a plant-based ${NOUN[alt.category]}, try the ${alt.name}.` : ''}` });
  }

  const allergens = item.allergens.map((a) => ALLERGEN_LABELS[a].toLowerCase());
  faqs.push({
    q: `What allergens are in the ${name}?`,
    a: `${allergens.length ? `The standard recipe contains ${list(allergens)}.` : 'The standard recipe contains none of the major allergens we track.'} ${ALLERGY_CAUTION}`,
  });

  if (isMain(item)) {
    faqs.push({
      q: `Is the ${name} spicy?`,
      a: item.dietary.includes('spicy') ? 'Yes. It is one of our spicy dishes.' : 'No. It is not one of our spicy dishes.',
    });
  }

  if (item.groups.length) {
    faqs.push({
      q: `Can I customise the ${name}?`,
      a: `Yes. Choose your ${list(item.groups.filter((g) => g.id !== 'remove').map((g) => g.title.replace(/^Choose your /, '').toLowerCase()))}. You can also ${item.groups.some((g) => g.id === 'remove') ? 'leave out ingredients and ' : ''}add a note of up to ${MAX_NOTE} characters for the kitchen.`,
    });
  }
  return faqs;
}

const prep = STORES.map((s) => s.prepMinutes);
const [minPrep, maxPrep] = [Math.min(...prep), Math.max(...prep)];
const cities = [...new Set(STORES.map((s) => s.city))];
const plantMains = MENU.filter((m) => isMain(m) && m.dietary.includes('plant-based'));

export const FOOD_FAQ: Faq = {
  q: 'What food does Gourwest serve?',
  a: `Global street-food classics, cooked to order: ${list(CUISINES)}-inspired bowls, wraps and grill plates, plus sides and drinks. Mains start at ${formatAUD(Math.min(...MENU.filter(isMain).map((m) => m.price)))} AUD and every bowl can be customised.`,
};

export const PICKUP_FAQ: Faq = {
  q: 'How quickly is a Gourwest pickup order ready?',
  a: `Most orders are ready about ${minPrep === maxPrep ? minPrep : `${minPrep}–${maxPrep}`} minutes after you order. Choose your kitchen, order online and collect from the pickup shelf under your name.`,
};

export const KITCHENS_FAQ: Faq = {
  q: 'Where are Gourwest kitchens?',
  a: `Gourwest has ${plural(STORES.length, 'kitchen')} in ${list(cities)}: ${list(STORES.map((s) => s.name))}.`,
};

export const HOURS_FAQ: Faq = {
  q: 'What are Gourwest’s opening hours?',
  a: `Every kitchen opens daily, in local time: ${STORES.map((s) => `${s.name} ${formatHours(s)}`).join('; ')}.`,
};

export const PLANT_FAQ: Faq = {
  q: 'Does Gourwest have vegan or vegetarian food?',
  a: `Yes. ${plural(plantMains.length, 'main')} ${plantMains.length === 1 ? 'is' : 'are'} plant-based as standard — the ${list(plantMains.map((m) => m.name))} — and every side and drink is vegetarian. Filter the menu by plant-based or vegetarian to see them all.`,
};

export const CLUB_FAQ: Faq = {
  q: 'How does Gourwest Club work?',
  a: `You earn ${POINTS_PER_DOLLAR} points for every A$1 when you add your member number at checkout. ${TIERS.map((t) => (t.from === 0 ? `${t.name} starts from your first order` : `${t.name} at ${t.from.toLocaleString('en-AU')} points`)).join(', ')}.`,
};

export const POINTS_FAQ: Faq = {
  q: 'How many points does an order earn?',
  a: `${POINTS_PER_DOLLAR} points per A$1 of the order total, rounded down: a ${formatAUD(2000)} order earns ${(20 * POINTS_PER_DOLLAR).toLocaleString('en-AU')} points. They reach your profile as soon as the order is placed.`,
};

export const CATERING_FAQ: Faq = {
  q: 'Does Gourwest cater for groups?',
  a: 'Yes. Gourwest catering serves 8 to 500 guests with bowl bars, wrap platters and grill feasts. Send an enquiry on the Catering page and the team replies within one business day.',
};
