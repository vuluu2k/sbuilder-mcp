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

  /**
   * THE PRODUCT CARD WITH ONE PICTURE ON EVERY ROW.
   *
   * A `list-dataset` repeats its `dataset-block` once per record. A plain
   * `image` inside it renders `specials.src` — the one the DOCUMENT holds — so
   * every card shows the same picture and the product's own photo can never
   * appear. Nothing structural is wrong: the tree saves, publishes and renders.
   * This was shipped on a real storefront before the check existed.
   */
  it('reports a static element inside a repeater, and does NOT tell the author to set it', () => {
    const d = emptyDoc();
    d.apply(
      addSubtree(d, 'ROOT', {
        type: 'flex-section',
        children: [{ type: 'list-dataset', children: [{ type: 'dataset-block', children: [{ type: 'image' }] }] }],
      }).patches,
    );
    const section = d.node('ROOT').data.nodes[0];
    const list = d.node(section).data.nodes[0];
    const block = d.node(list).data.nodes[0];
    const image = d.node(block).data.nodes[0];

    const f = reviewDesign(d).find((x) => x.nodeId === image);
    expect(f?.code).toBe('static_in_dataset');
    // It names the repeater, so the reader can see WHY this one is different.
    expect(f!.problem).toContain(list);
    // The generic advice would be actively wrong here.
    expect(f!.fix).not.toMatch(/sb_set/);
    expect(f!.fix).toContain('collection-media');
  });

  it('leaves the same element alone outside a repeater', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'image' }] }).patches);
    const codesOut = codes(d);
    expect(codesOut).toContain('missing_media');
    expect(codesOut).not.toContain('static_in_dataset');
  });

  it('reports a dataset element that carries no binding at all', () => {
    const d = emptyDoc();
    d.apply(
      addSubtree(d, 'ROOT', {
        type: 'flex-section',
        children: [
          { type: 'list-dataset', children: [{ type: 'dataset-block', children: [{ type: 'collection-media' }] }] },
        ],
      }).patches,
    );
    const section = d.node('ROOT').data.nodes[0];
    const list = d.node(section).data.nodes[0];
    const block = d.node(list).data.nodes[0];
    const media = d.node(block).data.nodes[0];
    // Whatever the catalog seeds, this test is about the UNBOUND case.
    d.apply([{ op: 'set', path: ['nodes', media, 'bindings'], value: [] }]);

    const f = reviewDesign(d).find((x) => x.nodeId === media && x.code === 'unbound_dataset_element');
    expect(f).toBeDefined();
    expect(f!.problem).toContain('boundImage');
    expect(f!.fix).toContain('sb_bind');
  });

  it('says nothing about a BOUND element whose authored value is empty', () => {
    const d = emptyDoc();
    d.apply(
      addSubtree(d, 'ROOT', {
        type: 'flex-section',
        children: [
          { type: 'list-dataset', children: [{ type: 'dataset-block', children: [{ type: 'collection-media' }] }] },
        ],
      }).patches,
    );
    const section = d.node('ROOT').data.nodes[0];
    const list = d.node(section).data.nodes[0];
    const block = d.node(list).data.nodes[0];
    const media = d.node(block).data.nodes[0];
    d.apply([
      {
        op: 'set',
        path: ['nodes', media, 'bindings'],
        value: [{ id: 'b1', source: 'product.image', field: 'specials.boundImage' }],
      },
    ]);
    // A bound tile with an empty specials.src is FINISHED, not unfinished: the
    // renderer prefers the bound key. Reporting it is the false positive that
    // teaches a reader to ignore the whole list.
    expect(reviewDesign(d).filter((f) => f.nodeId === media)).toEqual([]);
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

describe('the render rules a document can satisfy and still publish wrong', () => {
  it('reports a form nobody linked, which publishes as an empty box', () => {
    // `form` seeds specials.formId: "" and form.go:221 skips an empty one with
    // an explicit comment that this is deliberately NOT a warning. Forms compose
    // on the RENDER path only, so the canvas looks identical either way — an
    // unlinked form is the DEFAULT outcome of sb_add.
    const d = emptyDoc();
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'form' }] }).patches);
    const f = reviewDesign(d).find((x) => x.code === 'unlinked_form');
    expect(f).toBeDefined();
    expect(f!.fix).toContain(f!.nodeId);
  });

  it('stops reporting the form once it names one', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'form' }] }).patches);
    const formId = d.node(d.node('ROOT').data.nodes[0]).data.nodes[0];
    d.apply(setKeys(d, formId, { formId: 'frm_1' }, { namespace: 'specials' }));
    expect(codes(d)).not.toContain('unlinked_form');
  });

  it('reports a menu whose entries lead nowhere', () => {
    // menu seeds menuItems: [{ id, label: 'Home', href: '' }], and the Go
    // renderer reads menuItems and never menuId — so a freshly added menu
    // publishes a nav whose one link goes nowhere.
    const d = emptyDoc();
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'menu' }] }).patches);
    expect(codes(d)).toContain('dead_menu_link');
  });

  it('stops reporting the menu once its entries resolve', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'menu' }] }).patches);
    const menuId = d.node(d.node('ROOT').data.nodes[0]).data.nodes[0];
    d.apply(
      setKeys(d, menuId, { menuItems: [{ id: 'mi-1', label: 'Home', href: '/' }] }, { namespace: 'specials' }),
    );
    expect(codes(d)).not.toContain('dead_menu_link');
  });

  it('reports a repeater holding more than the one child it renders', () => {
    // templateID returns Data.Nodes[0] and list-dataset is the ONLY renderer
    // that does; every sibling after the first is valid, saves fine, and never
    // appears in the published HTML.
    const d = emptyDoc();
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section' }).patches);
    const section = d.node('ROOT').data.nodes[0];
    const list = addSubtree(d, section, { type: 'list-dataset', children: [{ type: 'dataset-block' }] });
    d.apply(list.patches);
    // A REAL second template, re-parented by raw patch. Every write path now
    // refuses this — add, move and duplicate — so the only way to hold one is a
    // document written somewhere else, which is exactly the case review exists
    // for. Built as a genuine second node rather than the same id listed twice:
    // that shortcut exercises the same branch but produces a document the
    // platform would never serve.
    const stray = addSubtree(d, section, { type: 'dataset-block' });
    d.apply(stray.patches);
    const at = d.node(section).data.nodes.indexOf(stray.ids[0]);
    d.apply([
      { op: 'remove', path: ['nodes', section, 'data', 'nodes'], index: at },
      { op: 'insert', path: ['nodes', list.ids[0], 'data', 'nodes'], index: 1, value: stray.ids[0] },
      { op: 'set', path: ['nodes', stray.ids[0], 'data', 'parent'], value: list.ids[0] },
    ]);
    expect(codes(d)).toContain('extra_repeater_child');
  });
});
