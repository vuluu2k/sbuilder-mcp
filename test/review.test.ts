import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree, setKeys } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';

/**
 * These are defects a VISITOR sees. A document can pass every structural check
 * and still publish as a blank band saying "Enter your text here".
 */

function emptyDoc() {
  return PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
}

function codes(d: PageDoc): string[] {
  return reviewDesign(d).map((f) => f.code);
}

describe('reviewDesign()', () => {
  it('reports a page with nothing on it', () => {
    const findings = reviewDesign(emptyDoc());
    expect(findings.map((f) => f.code)).toEqual(['empty_page']);
    expect(findings[0].fix).toMatch(/sb_add|sb_template_use/);
  });

  it('reports a container nobody put anything in', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section' }).patches);
    const f = reviewDesign(d).find((x) => x.code === 'empty_container');
    expect(f).toBeDefined();
    // The fix names the node, so it can be acted on without a second lookup.
    expect(f!.fix).toContain(f!.nodeId);
  });

  it('reports the PLACEHOLDER the element ships with, still published', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'text' }] }).patches);
    const f = reviewDesign(d).find((x) => x.code === 'placeholder_content');
    expect(f).toBeDefined();
    expect(f!.problem).toContain('Enter your text here');
  });

  it('stops reporting it once real copy is written', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'heading' }] }).patches);
    const headingId = d.node(d.node('ROOT').data.nodes[0]).data.nodes[0];
    expect(codes(d)).toContain('placeholder_content');
    d.apply(setKeys(d, headingId, { text: 'Autumn sale' }, { namespace: 'specials' }));
    expect(codes(d)).not.toContain('placeholder_content');
  });

  it('reports an element left empty', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'heading' }] }).patches);
    const headingId = d.node(d.node('ROOT').data.nodes[0]).data.nodes[0];
    d.apply(setKeys(d, headingId, { text: '   ' }, { namespace: 'specials' }));
    const f = reviewDesign(d).find((x) => x.code === 'empty_text');
    expect(f).toBeDefined();
    expect(f!.fix).toContain('sb_set');
  });

  it('reports an image with no source — it ships blank by default', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'image' }] }).patches);
    expect(codes(d)).toContain('missing_media');
  });

  it('reports a binding the renderer cannot resolve', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'heading' }] }).patches);
    const id = d.node(d.node('ROOT').data.nodes[0]).data.nodes[0];
    d.apply([
      {
        op: 'insert',
        path: ['nodes', id, 'bindings'],
        index: 0,
        value: { id: 'b1', source: 'product.nonsense', field: 'specials.text' },
      },
    ]);
    const f = reviewDesign(d).find((x) => x.code === 'dead_binding_source');
    expect(f).toBeDefined();
    expect(f!.problem).toContain('product.nonsense');
    // The fix lists what IS available, so it can be acted on immediately.
    expect(f!.fix).toContain('product.title');
  });

  it('reports a binding aimed outside specials', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'heading' }] }).patches);
    const id = d.node(d.node('ROOT').data.nodes[0]).data.nodes[0];
    d.apply([
      {
        op: 'insert',
        path: ['nodes', id, 'bindings'],
        index: 0,
        value: { id: 'b1', source: 'product.title', field: 'style.color' },
      },
    ]);
    expect(reviewDesign(d).some((f) => f.problem.includes('specials'))).toBe(true);
  });

  it('reports a node whose element the catalog does not know', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section' }).patches);
    const sectionId = d.node('ROOT').data.nodes[0];
    d.apply([{ op: 'set', path: ['nodes', sectionId, 'data', 'type'], value: 'from-the-future' }]);
    const f = reviewDesign(d).find((x) => x.code === 'unknown_element');
    expect(f).toBeDefined();
    expect(f!.fix).toMatch(/codegen/);
  });

  it('says nothing about a page that is actually finished', () => {
    const d = emptyDoc();
    d.apply(
      addSubtree(d, 'ROOT', {
        type: 'flex-section',
        children: [
          { type: 'heading', specials: { text: 'Autumn sale' } },
          { type: 'text', specials: { text: 'Up to 50% off, this week only.' } },
          { type: 'button', specials: { text: 'Shop now' } },
        ],
      }).patches,
    );
    expect(reviewDesign(d)).toEqual([]);
  });

  it('ignores a site overlay — the cart drawer is not this page to fix', () => {
    const d = PageDoc.from({
      schema_version: 2,
      root_node_id: 'rt',
      nodes: {
        rt: { id: 'rt', data: { type: 'root', parent: null, nodes: ['fs', 'cart'], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
        fs: { id: 'fs', data: { type: 'flex-section', parent: 'rt', nodes: ['he'], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
        he: { id: 'he', data: { type: 'heading', parent: 'fs', nodes: [], isCanvas: false, hidden: false, custom: {} }, style: {}, config: {}, specials: { text: 'Real copy' }, responsive: {}, events: [], bindings: [] },
        // An empty container that WOULD be reported if it were part of the page.
        cart: { id: 'cart', data: { type: 'flex-section', parent: 'rt', nodes: [], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: { overlayId: 'ov_1' }, responsive: {}, events: [], bindings: [] },
      },
    });
    expect(reviewDesign(d)).toEqual([]);
  });

  it('reports in document order, so a caller works top-down', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', name: 'first' }).patches);
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', name: 'second' }).patches);
    const [first, second] = d.node('ROOT').data.nodes;
    const ids = reviewDesign(d).map((f) => f.nodeId);
    expect(ids.indexOf(first)).toBeLessThan(ids.indexOf(second));
  });
});
