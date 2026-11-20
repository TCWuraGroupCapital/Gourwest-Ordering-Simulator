/**
 * Gourwest menu catalogue — the single source of truth for names, prices and modifiers.
 * Imported by the static pages, the browser cart and the server-side order/concierge functions,
 * so the price a guest sees is the price the server recomputes. All prices are integer cents (AUD).
 * Demo simulator: every dish, price and nutrition figure is synthetic.
 */

export type CategoryId = 'bowls' | 'wraps' | 'grill' | 'sides' | 'drinks';
export type Dietary = 'plant-based' | 'vegetarian' | 'high-protein' | 'dairy-free' | 'spicy';
export type Allergen = 'gluten' | 'soy' | 'sesame' | 'egg' | 'milk' | 'mustard' | 'fish';

export interface Option {
  id: string;
  name: string;
  note?: string;
  /** Surcharge in cents relative to the cheapest choice; the item's default choice is always free. */
  price: number;
}

export interface ModifierGroup {
  id: string;
  title: string;
  hint: string;
  kind: 'single' | 'multi';
  required: boolean;
  options: Option[];
}

export interface Photo {
  /** Basename under /images/food/, served as `${src}-640.webp` and `${src}-1200.webp`. */
  src: string;
  width: number;
  height: number;
  alt: string;
}

export interface MenuItem {
  slug: string;
  name: string;
  category: CategoryId;
  blurb: string;
  description: string;
  price: number;
  kcal: number;
  proteinG: number;
  dietary: Dietary[];
  allergens: Allergen[];
  badge?: string;
  photo?: Photo;
  groups: ModifierGroup[];
  /** Default option per single-choice group id. */
  defaults: Record<string, string>;
}

export const CATEGORIES: { id: CategoryId; title: string; kicker: string }[] = [
  { id: 'bowls', title: 'Signature Bowls', kicker: 'Built over grains and fresh produce' },
  { id: 'wraps', title: 'Handheld Wraps', kicker: 'Warm flatbread, rolled to order' },
  { id: 'grill', title: 'From the Grill', kicker: 'Charred over open flame, served hearty' },
  { id: 'sides', title: 'Sides', kicker: 'For the table' },
  { id: 'drinks', title: 'Drinks', kicker: 'Cold and made in house' },
];

export const DIETARY_LABELS: Record<Dietary, string> = {
  'plant-based': 'Plant-based',
  vegetarian: 'Vegetarian',
  'high-protein': 'High protein',
  'dairy-free': 'Dairy-free',
  spicy: 'Spicy',
};

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  gluten: 'Gluten',
  soy: 'Soy',
  sesame: 'Sesame',
  egg: 'Egg',
  milk: 'Milk',
  mustard: 'Mustard',
  fish: 'Fish',
};

/* ---------- Shared modifier groups ---------- */

const bowlBase: ModifierGroup = {
  id: 'base',
  title: 'Choose your base',
  hint: 'Pick one foundation for your bowl.',
  kind: 'single',
  required: true,
  options: [
    { id: 'sushi-rice', name: 'Fragrant sushi rice', note: 'Steamed, lightly seasoned koshihikari', price: 0 },
    { id: 'ancient-grains', name: 'Ancient grains & brown rice', note: 'High fibre, nutty spelt and quinoa', price: 0 },
    { id: 'greens', name: 'Mixed crisp greens', note: 'Baby spinach, kale and tatsoi', price: 0 },
    { id: 'half-half', name: 'Half rice, half greens', note: 'Balanced everyday energy', price: 0 },
  ],
};

const bowlProtein: ModifierGroup = {
  id: 'protein',
  title: 'Protein',
  hint: 'Keep the classic or swap to suit you.',
  kind: 'single',
  required: true,
  options: [
    { id: 'bbq-chicken', name: 'Korean BBQ charred chicken', note: 'Free-range breast, dark soy, sesame and garlic', price: 0 },
    { id: 'double-bbq-chicken', name: 'Double Korean BBQ chicken', note: '+80 g for active days, +28 g protein', price: 550 },
    { id: 'lemon-herb-chicken', name: 'Lemon herb grilled chicken', note: 'Mediterranean-style chicken cutlet', price: 0 },
    { id: 'chipotle-beef', name: 'Smoky chipotle beef', note: 'Slow-braised grass-fed beef', price: 100 },
    { id: 'teriyaki-tofu', name: 'Crispy teriyaki tofu', note: 'Plant-based, sweet tamari glaze', price: 0 },
    { id: 'falafel', name: 'Handmade falafel', note: 'Plant-based, herb and chickpea', price: 0 },
  ],
};

const bowlExtras: ModifierGroup = {
  id: 'extras',
  title: 'Extras',
  hint: 'Optional — add as many as you like.',
  kind: 'multi',
  required: false,
  options: [
    { id: 'avocado', name: 'Sliced Hass avocado', note: 'Half avocado, sliced daily', price: 300 },
    { id: 'egg', name: 'Soft free-range egg', note: 'Jammy yolk', price: 200 },
    { id: 'kimchi', name: 'House kimchi', note: 'Fermented wombok cabbage', price: 250 },
    { id: 'shallots', name: 'Crispy shallots & furikake', note: 'Nori and sesame crunch', price: 150 },
  ],
};

const bowlSauce: ModifierGroup = {
  id: 'sauce',
  title: 'Sauce',
  hint: 'Pick one.',
  kind: 'single',
  required: true,
  options: [
    { id: 'sesame', name: 'Roasted sesame dressing', note: 'Creamy and fragrant', price: 0 },
    { id: 'gochujang', name: 'House gochujang kick', note: 'Medium heat chilli and honey', price: 0 },
    { id: 'sweet-soy', name: 'Sweet soy glaze', note: 'Caramelised tamari, mild', price: 0 },
    { id: 'chipotle-crema', name: 'Chipotle crema', note: 'Smoky, gently spiced', price: 0 },
    { id: 'lemon-tahini', name: 'Lemon tahini', note: 'Bright and nutty', price: 0 },
    { id: 'none', name: 'No sauce', note: 'Just the ingredients', price: 0 },
  ],
};

const wrapExtras: ModifierGroup = {
  id: 'extras',
  title: 'Extras',
  hint: 'Optional — add as many as you like.',
  kind: 'multi',
  required: false,
  options: [
    { id: 'avocado', name: 'Sliced Hass avocado', price: 300 },
    { id: 'cheese', name: 'Melted cheese blend', price: 150 },
    { id: 'jalapenos', name: 'Pickled jalapeños', price: 100 },
  ],
};

const plateSide: ModifierGroup = {
  id: 'side',
  title: 'Side',
  hint: 'Pick one to go with your plate.',
  kind: 'single',
  required: true,
  options: [
    { id: 'grains-salad', name: 'Ancient grains & chopped salad', price: 0 },
    { id: 'fries-slaw', name: 'Seasoned fries & crunchy slaw', price: 0 },
    { id: 'greens', name: 'Mixed crisp greens', price: 0 },
  ],
};

const plateHeat: ModifierGroup = {
  id: 'heat',
  title: 'Heat',
  hint: 'How hot should the grill go?',
  kind: 'single',
  required: true,
  options: [
    { id: 'mild', name: 'Mild', note: 'Lemon and herb', price: 0 },
    { id: 'medium', name: 'Medium', note: 'Gentle chilli warmth', price: 0 },
    { id: 'hot', name: 'Hot', note: "Bird's eye chilli", price: 0 },
  ],
};

function leaveOut(...ingredients: string[]): ModifierGroup {
  return {
    id: 'remove',
    title: 'Leave anything out?',
    hint: 'Optional — the kitchen will hold these.',
    kind: 'multi',
    required: false,
    options: ingredients.map((name) => ({ id: name.toLowerCase().replace(/[^a-z]+/g, '-'), name: `No ${name.toLowerCase()}`, price: 0 })),
  };
}

const photo = (src: string, width: number, height: number, alt: string): Photo => ({ src, width, height, alt });

/* ---------- Catalogue ---------- */

export const MENU: MenuItem[] = [
  {
    slug: 'seoul-bbq-chicken-bowl',
    name: 'Seoul BBQ Chicken Bowl',
    category: 'bowls',
    badge: "Chef's pick",
    blurb: 'Korean BBQ chicken, sushi rice, rainbow slaw, cucumber and roasted sesame dressing.',
    description:
      'Free-range chicken glazed twice over open flame with gochugaru and wildflower honey, on fragrant sushi rice with crunchy rainbow slaw, Lebanese cucumber and roasted sesame dressing.',
    price: 1790,
    kcal: 580,
    proteinG: 42,
    dietary: ['high-protein', 'dairy-free'],
    allergens: ['soy', 'sesame', 'gluten'],
    photo: photo('seoul-bbq-bowl', 1408, 768, 'Seoul BBQ chicken bowl with charred glazed chicken, sesame, slaw and rice in a stoneware bowl'),
    groups: [bowlBase, bowlProtein, bowlExtras, bowlSauce, leaveOut('Cucumber', 'Rainbow slaw', 'Sesame seeds')],
    defaults: { base: 'sushi-rice', protein: 'bbq-chicken', sauce: 'sesame' },
  },
  {
    slug: 'mediterranean-falafel-bowl',
    name: 'Mediterranean Falafel Bowl',
    category: 'bowls',
    blurb: 'Golden falafel, ancient grains, vine tomato, pickled onion and lemon tahini.',
    description:
      'Handmade herb falafel over ancient grains with vine tomato, Lebanese cucumber, pickled red onion, hummus and a velvety lemon tahini.',
    price: 1690,
    kcal: 520,
    proteinG: 21,
    dietary: ['vegetarian', 'plant-based', 'dairy-free'],
    allergens: ['sesame', 'gluten'],
    photo: photo('falafel-bowl', 1006, 691, 'Mediterranean falafel bowl with hummus, tomato, cucumber and pickled onion'),
    groups: [bowlBase, bowlProtein, bowlExtras, bowlSauce, leaveOut('Pickled onion', 'Tomato', 'Hummus')],
    defaults: { base: 'ancient-grains', protein: 'falafel', sauce: 'lemon-tahini' },
  },
  {
    slug: 'smoky-chipotle-beef-bowl',
    name: 'Smoky Chipotle Beef Bowl',
    category: 'bowls',
    badge: 'Spicy favourite',
    blurb: 'Slow-braised beef, brown rice, black beans, charred corn salsa and chipotle crema.',
    description:
      'Smoky slow-braised beef on seasoned brown rice with black turtle beans, fire-roasted corn salsa, avocado and house chipotle crema.',
    price: 1890,
    kcal: 640,
    proteinG: 44,
    dietary: ['high-protein', 'spicy'],
    allergens: ['milk', 'mustard'],
    photo: photo('chipotle-beef-bowl', 760, 280, 'Chipotle beef bowl with shredded beef, black beans, corn salsa and avocado'),
    groups: [bowlBase, bowlProtein, bowlExtras, bowlSauce, leaveOut('Black beans', 'Corn salsa', 'Coriander')],
    defaults: { base: 'ancient-grains', protein: 'chipotle-beef', sauce: 'chipotle-crema' },
  },
  {
    slug: 'teriyaki-tofu-bowl',
    name: 'Crispy Teriyaki Tofu Bowl',
    category: 'bowls',
    blurb: 'Glazed tofu, jasmine rice, wok-tossed greens, edamame and toasted sesame.',
    description:
      'Crispy organic tofu in sweet tamari glaze on jasmine rice with wok-tossed seasonal greens, broccoli, edamame and toasted sesame.',
    price: 1690,
    kcal: 490,
    proteinG: 24,
    dietary: ['plant-based', 'vegetarian', 'dairy-free'],
    allergens: ['soy', 'sesame', 'gluten'],
    photo: photo('teriyaki-tofu-bowl', 1098, 768, 'Teriyaki tofu bowl with broccoli, edamame and cucumber on rice'),
    groups: [bowlBase, bowlProtein, bowlExtras, bowlSauce, leaveOut('Edamame', 'Broccoli', 'Sesame seeds')],
    defaults: { base: 'sushi-rice', protein: 'teriyaki-tofu', sauce: 'sweet-soy' },
  },
  {
    slug: 'peri-peri-chicken-wrap',
    name: 'Peri-Peri Chicken Wrap',
    category: 'wraps',
    badge: 'Popular',
    blurb: 'Flame-grilled peri-peri chicken, mixed leaves, tomato and herb mayo.',
    description: 'Flame-grilled peri-peri chicken with mixed leaves, vine tomato and zesty herb mayo, rolled in warm flatbread.',
    price: 1590,
    kcal: 560,
    proteinG: 38,
    dietary: ['high-protein', 'spicy'],
    allergens: ['gluten', 'egg', 'mustard'],
    photo: photo('peri-peri-wrap', 1027, 587, 'Peri-peri chicken wrap cut in half showing charred chicken and leaves'),
    groups: [wrapExtras, leaveOut('Tomato', 'Herb mayo', 'Leaves')],
    defaults: {},
  },
  {
    slug: 'falafel-tahini-wrap',
    name: 'Falafel & Tahini Wrap',
    category: 'wraps',
    blurb: 'Herb falafel, pickled vegetables, parsley and garlic tahini.',
    description: 'Golden herb falafel with pickled vegetables, fresh parsley and garlic tahini in toasted flatbread.',
    price: 1490,
    kcal: 510,
    proteinG: 17,
    dietary: ['vegetarian', 'plant-based', 'dairy-free'],
    allergens: ['gluten', 'sesame'],
    photo: photo('falafel-wrap', 1005, 645, 'Falafel and tahini wrap with pickled vegetables'),
    groups: [wrapExtras, leaveOut('Pickles', 'Parsley', 'Tahini')],
    defaults: {},
  },
  {
    slug: 'smoky-beef-wrap',
    name: 'Smoky Beef Wrap',
    category: 'wraps',
    blurb: 'Braised smoky beef, cheese blend, slaw and roasted pepper aioli.',
    description: 'Tender braised smoky beef with a melted cheese blend, crunchy slaw and roasted pepper aioli.',
    price: 1690,
    kcal: 690,
    proteinG: 41,
    dietary: ['high-protein'],
    allergens: ['gluten', 'milk', 'egg'],
    photo: photo('smoky-beef-wrap', 1182, 768, 'Smoky beef wrap with melted cheese and slaw, sweet potato fries on the side'),
    groups: [wrapExtras, leaveOut('Cheese', 'Slaw', 'Aioli')],
    defaults: {},
  },
  {
    slug: 'lemon-herb-chicken-plate',
    name: 'Lemon Herb Chicken Plate',
    category: 'grill',
    badge: 'Signature plate',
    blurb: 'Double grilled lemon herb chicken, ancient grains, chopped salad and hummus.',
    description: 'Double grilled lemon herb chicken breast with warm ancient grains, Mediterranean chopped salad and house hummus.',
    price: 2290,
    kcal: 520,
    proteinG: 48,
    dietary: ['high-protein', 'dairy-free'],
    allergens: ['sesame'],
    photo: photo('lemon-herb-plate', 1408, 630, 'Lemon herb chicken plate with grains, chopped salad and hummus'),
    groups: [plateSide, plateHeat, leaveOut('Hummus', 'Onion')],
    defaults: { side: 'grains-salad', heat: 'mild' },
  },
  {
    slug: 'peri-peri-chicken-plate',
    name: 'Peri-Peri Chicken Plate',
    category: 'grill',
    badge: 'Spicy favourite',
    blurb: 'Flame-grilled peri-peri chicken, seasoned fries, slaw and house peri-peri sauce.',
    description: 'Spicy flame-grilled chicken with seasoned fries, crunchy slaw and house peri-peri sauce.',
    price: 2290,
    kcal: 610,
    proteinG: 52,
    dietary: ['high-protein', 'spicy'],
    allergens: ['mustard'],
    photo: photo('peri-peri-plate', 1126, 768, 'Peri-peri chicken with fries, slaw and chilli sauce'),
    groups: [plateSide, plateHeat, leaveOut('Slaw', 'Sauce')],
    defaults: { side: 'fries-slaw', heat: 'medium' },
  },
  {
    slug: 'seasoned-fries',
    name: 'Seasoned Fries',
    category: 'sides',
    blurb: 'Crisp fries tossed in smoky spiced sea salt.',
    description: 'Crisp golden fries tossed in our smoky spiced sea salt, with herb dip.',
    price: 650,
    kcal: 380,
    proteinG: 5,
    dietary: ['vegetarian', 'plant-based'],
    allergens: [],
    photo: photo('fries', 1408, 768, 'Bowl of seasoned fries with a herb dip'),
    groups: [],
    defaults: {},
  },
  {
    slug: 'crunchy-slaw',
    name: 'Crunchy Slaw',
    category: 'sides',
    blurb: 'Purple and white cabbage, carrot and herbs in citrus vinaigrette.',
    description: 'Shredded purple and white cabbage with carrot and herbs in a light citrus vinaigrette.',
    price: 550,
    kcal: 140,
    proteinG: 2,
    dietary: ['vegetarian', 'plant-based', 'dairy-free'],
    allergens: ['mustard'],
    photo: photo('slaw', 1071, 768, 'Bowl of crunchy rainbow slaw with lime'),
    groups: [],
    defaults: {},
  },
  {
    slug: 'falafel-bites',
    name: 'Falafel Bites',
    category: 'sides',
    blurb: 'Four crisp falafel with lemon tahini dip.',
    description: 'Four crisp falafel bites with lemon tahini dip.',
    price: 750,
    kcal: 290,
    proteinG: 9,
    dietary: ['vegetarian', 'plant-based', 'dairy-free'],
    allergens: ['sesame'],
    photo: photo('falafel-bites', 908, 672, 'Four falafel bites with tahini dip'),
    groups: [],
    defaults: {},
  },
  {
    slug: 'house-lemonade',
    name: 'House Lemonade',
    category: 'drinks',
    blurb: 'Fresh-squeezed lemon, mint and sparkling soda.',
    description: 'Freshly squeezed lemons with a mint sprig and sparkling soda.',
    price: 550,
    kcal: 120,
    proteinG: 0,
    dietary: ['vegetarian', 'plant-based', 'dairy-free'],
    allergens: [],
    groups: [],
    defaults: {},
  },
  {
    slug: 'yuzu-sparkling-brew',
    name: 'Yuzu Sparkling Brew',
    category: 'drinks',
    blurb: 'Cold-pressed yuzu with sparkling spring water.',
    description: 'Cold-pressed Japanese yuzu with sparkling Victorian spring water.',
    price: 520,
    kcal: 70,
    proteinG: 0,
    dietary: ['vegetarian', 'plant-based', 'dairy-free'],
    allergens: [],
    groups: [],
    defaults: {},
  },
  {
    slug: 'peach-iced-tea',
    name: 'Peach Iced Tea',
    category: 'drinks',
    blurb: 'Cold-brewed black tea with peach and lemon.',
    description: 'Cold-brewed organic black tea infused with peach and lemon.',
    price: 500,
    kcal: 90,
    proteinG: 0,
    dietary: ['vegetarian', 'plant-based', 'dairy-free'],
    allergens: [],
    groups: [],
    defaults: {},
  },
  {
    slug: 'sparkling-water',
    name: 'Sparkling Water',
    category: 'drinks',
    blurb: 'Chilled sparkling mineral water, 500 ml.',
    description: 'Chilled sparkling mineral water, 500 ml.',
    price: 450,
    kcal: 0,
    proteinG: 0,
    dietary: ['vegetarian', 'plant-based', 'dairy-free'],
    allergens: [],
    groups: [],
    defaults: {},
  },
];

const bySlug = new Map(MENU.map((item) => [item.slug, item]));

export function findItem(slug: string): MenuItem | undefined {
  return bySlug.get(slug);
}

export const isCustomisable = (item: MenuItem): boolean => item.groups.length > 0;
