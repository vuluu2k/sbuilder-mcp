import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree, moveNode } from '../src/domains/site/builder.js';
import { bindingsForConfig, createNode } from '../src/domains/site/node.js';
import { PATTERN_BY_ID, THEME_TOKENS } from '../src/domains/site/patterns.js';
import { ELEMENTS, ELEMENT_SEEDS } from '../src/catalog/elements.generated.js';
import { bindings, emptyDoc, type Bound } from './helpers/doc.js';

type N = { id: string; data: { type: string; parent: string | null; nodes: string[] }; config: Record<string, unknown>; style: Record<string, unknown>; bindings: Bound[] };
const node = (d: PageDoc, id: string) => d.node(id) as unknown as N;

/**
 * THE DATA AXIS'S KINDS COME FROM THE FACTORY, and an unknown one refuses.
 *
 * A hand list of twelve kinds missed `tags`, so `{kind:'tags'}` found no row
 * and fell back to the source's FIRST row — `product.title` — and a spec-tags
 * line showed the product name through save, publish and render.
 */
describe('bindingsForConfig: every factory kind, and no sibling fallback', () => {
  it('binds product.tags for a tags text, through sb_add', () => {
    const n = createNode('text-dataset', { config: { datasetSource: 'product', kind: 'tags' } });
    expect(bindings(n)[0].source).toBe('product.tags');
    expect(bindings(createNode('text-dataset', { config: { datasetSource: 'course', kind: 'level' } }))[0].source).toBe('course.level');
    expect(bindings(createNode('text-dataset', { config: { datasetSource: 'product', kind: 'rating_count' } }))[0].source).toBe('product.ratingCount');
  });

  it('refuses a kind the factory does not know, rather than binding another field', () => {
    expect(() => bindingsForConfig('text-dataset', { datasetSource: 'product', kind: 'spec_tags' })).toThrow(/no "spec_tags" kind.*Known kinds:.*tags/);
    expect(() => addSubtree(emptyDoc(), 'ROOT', { type: 'text-dataset', config: { kind: 'spec_tags' } })).toThrow(/spec_tags/);
  });

  it('an element with no kind axis still falls back by source', () => {
    expect(JSON.stringify(bindingsForConfig('list-dataset', { datasetSource: 'category', kind: 'whatever' }))).toContain('collection_list');
  });
});

/**
 * THE PRICE DISPLAY IS A `prices` PARENT OVER TWO LEAVES, as the editor's picker
 * builds it — each leaf owns its typography, so the struck compare price can be
 * styled on its own. The meta's isContainer:false is about DROPPING, not about
 * this pair; sb_add used to refuse it and build the childless legacy node.
 */
describe('pricing-dataset: the picker shape', () => {
  it('a bare price display arrives as the picker builds it: price + compare_price leaves', () => {
    const d = emptyDoc();
    const { patches, ids } = addSubtree(d, 'ROOT', { type: 'pricing-dataset' });
    d.apply(patches);
    const parent = node(d, ids[0]);
    expect(parent.config.kind).toBe('prices');
    const leaves = parent.data.nodes.map((id) => node(d, id));
    expect(leaves.map((l) => l.config.kind)).toEqual(['price', 'compare_price']);
    expect(leaves.every((l) => l.data.type === 'pricing-dataset')).toBe(true);
    // Each leaf's binding target is its OWN kind, as datasetBindings derives it.
    expect(leaves.map((l) => (l.bindings[0] as { target?: { kind?: string } }).target?.kind)).toEqual(['price', 'compare_price']);
    // The compare leaf carries its own typography — the point of the split.
    expect(leaves[1].style.color).toBeDefined();
    expect(leaves[1].style).not.toEqual(leaves[0].style);
    // Seeded from codegen's capture of the preset, not a hand copy.
    expect(ELEMENT_SEEDS['pricing-dataset'].map((s) => s.config?.kind)).toEqual(['price', 'compare_price']);
    expect(ELEMENTS['pricing-dataset'].isContainer).toBe(false);
  });

  it('a leaf arrives bare — the seed is the parent\'s shape, not every kind\'s', () => {
    const d = emptyDoc();
    const { patches, ids } = addSubtree(d, 'ROOT', { type: 'pricing-dataset', config: { kind: 'price' } });
    d.apply(patches);
    expect(node(d, ids[0]).data.nodes).toEqual([]);
  });

  it('accepts a price leaf under a prices parent, and nothing else under any pricing node', () => {
    const d = emptyDoc();
    const made = addSubtree(d, 'ROOT', { type: 'pricing-dataset', children: [{ type: 'pricing-dataset', config: { kind: 'price' } }] });
    d.apply(made.patches);
    const [parent, leaf] = made.ids;
    const more = addSubtree(d, parent, { type: 'pricing-dataset', config: { kind: 'compare_price' } });
    d.apply(more.patches);
    expect(node(d, parent).data.nodes).toEqual([leaf, more.ids[0]]);

    expect(() => addSubtree(d, parent, { type: 'heading' })).toThrow(/not a container/);
    expect(() => addSubtree(d, parent, { type: 'pricing-dataset', config: { kind: 'prices' } })).toThrow(/not a container/);
    expect(() => addSubtree(d, leaf, { type: 'pricing-dataset', config: { kind: 'price' } })).toThrow(/not a container/);

    // A move into the parent takes the same exception, and only for a leaf.
    const loose = addSubtree(d, 'ROOT', { type: 'pricing-dataset', config: { kind: 'price' } });
    d.apply(loose.patches);
    expect(() => moveNode(d, loose.ids[0], parent, 0)).not.toThrow();
  });

  it('sb_product_shelf builds the picker shape, not the childless legacy node', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    d.apply(addSubtree(d, 'ROOT', PATTERN_BY_ID.get('sb_product_shelf')!.build(THEME_TOKENS)!).patches);
    const prices = (Object.values(d.doc.nodes) as unknown as N[]).filter((n) => n.data.type === 'pricing-dataset');
    const parent = prices.find((n) => n.config.kind === 'prices')!;
    expect(parent.data.nodes.map((id) => node(d, id).config.kind)).toEqual(['price', 'compare_price']);
  });
});
