import { describe, expect, it } from 'vitest';
import { MENU, findItem } from '../src/data/menu';
import { STORES } from '../src/data/stores';
import { breadcrumbNode, dishFaqs, dishNode, ldJson, menuNode, restaurantNode, siteNodes, type Node } from '../src/lib/seo';

const site = new URL('https://example.test/');
/** The answer whose question mentions `topic`, e.g. 'allergens', 'vegan', 'spicy'. */
const answer = (slug: string, topic: string) => dishFaqs(findItem(slug)!).find((f) => f.q.includes(topic))!.a;

/** Every {"@id": …} reference inside a node, excluding the node's own @id. */
function refs(value: unknown, own?: string): string[] {
  if (!value || typeof value !== 'object') return [];
  const obj = value as Record<string, unknown>;
  const id = typeof obj['@id'] === 'string' && Object.keys(obj).length === 1 && obj['@id'] !== own ? [obj['@id'] as string] : [];
  return [...id, ...Object.values(obj).flatMap((v) => refs(v, own))];
}

describe('structured data graph', () => {
  it('resolves every @id reference within each page graph', () => {
    const pages: Node[][] = [STORES.map((s) => restaurantNode(s, site)), [menuNode(site)], [dishNode(MENU[0], site)]];
    for (const nodes of pages) {
      const graph = [...siteNodes(site), ...nodes];
      const defined = new Set(graph.map((n) => n['@id']));
      expect(graph.flatMap((n) => refs(n, n['@id'] as string)).filter((id) => !defined.has(id))).toEqual([]);
    }
  });

  it('gives kitchens a city but no street address or coordinates', () => {
    for (const node of STORES.map((s) => restaurantNode(s, site))) {
      expect(node.address).toEqual({ '@type': 'PostalAddress', addressLocality: expect.any(String), addressCountry: expect.any(String) });
      expect(node).not.toHaveProperty('geo');
    }
  });

  it('lists every dish once in the menu, each with its own page URL', () => {
    const items = (menuNode(site).hasMenuSection as { hasMenuItem: Node[] }[]).flatMap((s) => s.hasMenuItem);
    expect(items.map((i) => i.url)).toEqual(expect.arrayContaining(MENU.map((m) => `https://example.test/menu/${m.slug}/`)));
    expect(items).toHaveLength(MENU.length);
  });

  it('builds Home > Menu > dish breadcrumbs and none for the home page', () => {
    const crumbs = breadcrumbNode(site, '/menu/teriyaki-tofu-bowl/', 'Teriyaki tofu bowl')!;
    expect((crumbs.itemListElement as { name: string }[]).map((c) => c.name)).toEqual(['Home', 'Menu', 'Teriyaki tofu bowl']);
    expect(breadcrumbNode(site, '/', 'Gourwest')).toBeNull();
  });

  it('escapes "<" so data can never close the script tag', () => {
    expect(ldJson({ a: '</script><script>alert(1)</script>' })).not.toContain('<');
  });
});

describe('dish FAQs', () => {
  it('answer from the menu data', () => {
    expect(answer('teriyaki-tofu-bowl', 'vegan')).toMatch(/^Yes\. .*plant-based/);
    expect(answer('seoul-bbq-chicken-bowl', 'vegetarian')).toMatch(/^No\..*try the /);
    expect(answer('seoul-bbq-chicken-bowl', 'allergens')).toMatch(/contains soy, sesame and gluten\./);
    expect(answer('house-lemonade', 'allergens')).toMatch(/none of the major allergens/);
    // The default protein is free on its own dish, so it must never be quoted as a surcharge.
    expect(answer('smoky-chipotle-beef-bowl', 'How much')).not.toMatch(/Smoky chipotle beef is \+/);
  });

  it('always carries the shared-equipment caution on allergen answers', () => {
    for (const item of MENU) expect(answer(item.slug, 'allergens')).toMatch(/call the kitchen before ordering/);
  });

  it('asks about heat and customising only where it applies', () => {
    const drink = dishFaqs(findItem('house-lemonade')!).map((f) => f.q);
    expect(drink.some((q) => q.includes('spicy') || q.includes('customise'))).toBe(false);
    expect(answer('peri-peri-chicken-plate', 'spicy')).toMatch(/^Yes/);
  });
});
