import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { bindNode } from '../src/tools/live.js';

/**
 * GAP #62 (TTG, 2026-10-29): a related-product card's text carried BOTH
 * `bind-text → specials.boundText ← product.title` and a second binding on the
 * same field ← product.tags. The platform's ApplyBindings
 * (render/scope/scope.go) walks `node.bindings` IN ORDER and each resolved
 * source OVERWRITES the special, so the LAST one renders (the tags) and the
 * title binding is dead weight — and sb_review said nothing.
 */
function twiceBound() {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'heading' }] }).patches);
  const id = d.node(d.node('ROOT').data.nodes[0]).data.nodes[0];
  const bind = (bid: string, source: string) =>
    d.apply([{ op: 'insert', path: ['nodes', id, 'bindings'], index: d.node(id).bindings.length, value: { id: bid, source, field: 'specials.text' } }]);
  bind('bind-text', 'product.title');
  bind('49790f7e289d', 'product.tags');
  return { d, id };
}

describe('two bindings on one field', () => {
  it('sb_review reports it, naming the binding that renders and sb_bind as the fix', () => {
    const { d, id } = twiceBound();
    const f = reviewDesign(d, { pageType: 'product' }).find((x) => x.code === 'duplicate_binding_field');
    expect(f).toBeDefined();
    expect(f!.nodeId).toBe(id);
    expect(f!.problem).toContain('product.title');
    expect(f!.problem).toMatch(/product\.tags.*renders/);
    expect(f!.fix).toContain('sb_bind');
  });

  it('is silent on one binding per field', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'heading' }] }).patches);
    const id = d.node(d.node('ROOT').data.nodes[0]).data.nodes[0];
    d.apply(bindNode(d, id, 'product.title', 'specials.text'));
    expect(reviewDesign(d, { pageType: 'product' }).map((x) => x.code)).not.toContain('duplicate_binding_field');
  });

  it('sb_bind on that field leaves exactly one binding, so the fix it names works', () => {
    const { d, id } = twiceBound();
    d.apply(bindNode(d, id, 'product.title', 'specials.text'));
    expect(d.node(id).bindings).toEqual([{ id: 'bind-text', source: 'product.title', field: 'specials.text' }]);
    expect(reviewDesign(d, { pageType: 'product' }).map((x) => x.code)).not.toContain('duplicate_binding_field');
  });
});
