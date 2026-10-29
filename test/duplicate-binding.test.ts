import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { bindNode } from '../src/tools/live.js';
import { PRESENT_ONLY_SOURCES } from '../src/catalog/elements.generated.js';

/**
 * GAP #62 (TTG, 2026-10-29): a related-product card's text carried BOTH
 * `bind-text → specials.boundText ← product.title` and a second binding on the
 * same field. The platform's ApplyBindings (render/scope/scope.go) walks
 * `node.bindings` IN ORDER, SKIPS a source the context does not hold, and each
 * resolved source overwrites the special — so the LAST source THE CONTEXT
 * RESOLVES renders. A later PRESENT-ONLY source (product.tags, product.summary,
 * the rating keys, record.*) is absent on a product without one, so the earlier
 * binding is a FALLBACK, not dead weight (verifier review of v0.100.4).
 */
function bound(...sources: string[]) {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'heading' }] }).patches);
  const id = d.node(d.node('ROOT').data.nodes[0]).data.nodes[0];
  sources.forEach((source, i) =>
    d.apply([{ op: 'insert', path: ['nodes', id, 'bindings'], index: d.node(id).bindings.length, value: { id: i ? `b${i}` : 'bind-text', source, field: 'specials.text' } }]),
  );
  return { d, id };
}
const dup = (d: PageDoc) => reviewDesign(d, { pageType: 'product' }).find((x) => x.code === 'duplicate_binding_field');

describe('two bindings on one field', () => {
  it('the present-only set is read off the platform', () => {
    for (const k of ['product.id', 'product.tags', 'product.summary', 'product.ratingCount', 'product.ratingAverage', 'product.variations', 'product.brandLogo', 'site.supportEmail']) {
      expect(PRESENT_ONLY_SOURCES).toContain(k);
    }
    expect(PRESENT_ONLY_SOURCES).not.toContain('product.title');
    expect(PRESENT_ONLY_SOURCES).not.toContain('product.price');
  });

  it('reports an earlier source a later ALWAYS-present one in the same context shadows, naming who wins', () => {
    const { d, id } = bound('product.tags', 'product.title');
    const f = dup(d);
    expect(f).toBeDefined();
    expect(f!.nodeId).toBe(id);
    expect(f!.problem).toContain('the last source the context resolves wins');
    expect(f!.problem).toMatch(/product\.tags never renders/);
    expect(f!.fix).toContain('sb_bind');
  });

  it('is silent on a fallback chain: the later source is present-only', () => {
    expect(dup(bound('product.title', 'product.tags').d)).toBeUndefined();
    expect(dup(bound('product.description', 'product.summary').d)).toBeUndefined();
    expect(dup(bound('product.title', 'record.fld_0123456789abcdef').d)).toBeUndefined();
  });

  it('is silent across contexts: a later source from another entity may be outside the scope', () => {
    expect(dup(bound('product.title', 'category.title').d)).toBeUndefined();
  });

  it('is silent on one binding per field', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'heading' }] }).patches);
    const id = d.node(d.node('ROOT').data.nodes[0]).data.nodes[0];
    d.apply(bindNode(d, id, 'product.title', 'specials.text'));
    expect(dup(d)).toBeUndefined();
  });

  it('sb_bind on that field leaves exactly one binding, so the fix it names works', () => {
    const { d, id } = bound('product.tags', 'product.title');
    d.apply(bindNode(d, id, 'product.title', 'specials.text'));
    expect(d.node(id).bindings).toEqual([{ id: 'bind-text', source: 'product.title', field: 'specials.text' }]);
    expect(dup(d)).toBeUndefined();
  });
});
