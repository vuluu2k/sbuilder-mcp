import { describe, it, expect } from 'vitest';
import { layoutDocument, layoutNames, seedDocument, seededTypes } from '../src/domains/site/storepage.js';
import { STORE_PAGE_SEEDS } from '../src/catalog/storepages.generated.js';

type Doc = { root_node_id: string; nodes: Record<string, any> };

/**
 * Two pages created from the same seed must be as unrelated as two built by
 * hand: the generated seeds carry STABLE placeholder ids (`spcat_3`), and
 * shipping them verbatim gave every category page the same node ids.
 */
describe('every page create mints fresh node ids', () => {
  const makers: Array<[string, () => Doc]> = [
    ...seededTypes().map((t) => [`seed ${t}`, () => seedDocument(t) as Doc] as [string, () => Doc]),
    ...layoutNames().map((l) => [`layout ${l}`, () => layoutDocument(l) as Doc] as [string, () => Doc]),
  ];

  it.each(makers)('%s: two creates share no id but ROOT', (_name, make) => {
    const a = make();
    const b = make();
    expect(a.root_node_id).toBe('ROOT');
    const shared = Object.keys(a.nodes).filter((id) => id in b.nodes);
    expect(shared).toEqual(['ROOT']);
  });

  it('a satellite ref follows its node', () => {
    const doc = seedDocument('product') as Doc;
    const placeholders = new Set(Object.keys(STORE_PAGE_SEEDS.product.nodes));
    const refs = Object.values(doc.nodes).flatMap((n) =>
      Object.entries(n.config ?? {}).filter(([k]) =>
        ['emptyStateId', 'variantLabelId', 'variantOptionId', 'quantityButtonId', 'quantityInputId'].includes(k),
      ),
    );
    expect(refs.length).toBe(5);
    for (const [, v] of refs) {
      expect(placeholders.has(v as string)).toBe(false);
      expect(doc.nodes[v as string]).toBeTruthy();
    }
  });

  it('text that equals or quotes an id is left alone', () => {
    // `spcom_3` IS a node id in the completion seed: a headline spelling it
    // exactly is still text, and only id-carrying fields may be renamed.
    for (const headline of ['spcom_3', 'Order spcom_3 received']) {
      const doc = seedDocument('complete', { headline }) as Doc;
      const texts = Object.values(doc.nodes).map((n) => n.specials?.text);
      expect(texts).toContain(headline);
    }
  });
});
