import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { measure } from '../src/vision/measure.js';

/**
 * FALSE POSITIVES THE FINDINGS LIST CANNOT AFFORD.
 *
 * A list two dozen entries long, none of them fixable from the page they are
 * reported on, is a list a reader learns to skip — and the real defect goes with
 * it. Both cases here were measured on a storefront that rendered correctly.
 */

/**
 * An element that PAINTS THE RECORD needs no children, and calling it empty is
 * the false positive that teaches a reader to skip the findings list. Found on a
 * product page that rendered its photo and thumbnail strip correctly.
 */
describe('reviewDesign() and the self-drawing container', () => {
  const page = (type: string, bindings: unknown[]) => ({
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: {
      ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['n1'] }, specials: {} },
      n1: { id: 'n1', data: { type, parent: 'ROOT', nodes: [] }, specials: {}, bindings },
    },
  });
  const bound = [
    { id: 'bind-image', source: 'product.image', field: 'specials.boundImage' },
  ];
  const codes = (doc: unknown) =>
    reviewDesign(PageDoc.from(doc as never)).map((f: { code: string }) => f.code);

  it('does not call a bound media-dataset an empty band', () => {
    expect(codes(page('media-dataset', bound))).not.toContain('empty_container');
  });

  it('still reports an UNBOUND media-dataset', () => {
    expect(codes(page('media-dataset', []))).toContain('empty_container');
  });

  it('still reports an empty dataset-block — its binding is only the link', () => {
    const linkOnly = [
      { id: 'bind-href', source: 'product.url', field: 'specials.boundHref' },
    ];
    expect(codes(page('dataset-block', linkOnly))).toContain('empty_container');
  });

  it('still reports an empty ordinary section', () => {
    expect(codes(page('flex-section', []))).toContain('empty_container');
  });

  it('does not call a childless search-input empty — it draws its own field', () => {
    // The platform's search page seed ships it exactly like this.
    expect(codes(page('search-input', []))).not.toContain('empty_container');
  });

  it('still reports a childless select — its face lives in its zones', () => {
    expect(codes(page('select', []))).toContain('empty_container');
  });

  it("does not call a select's empty trigger/panel empty — the host prints its rows from filterValues", () => {
    const zones = (hostType: string, hostSpecials: Record<string, unknown>) => ({
      schema_version: 2,
      root_node_id: 'ROOT',
      nodes: {
        ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['h'] }, specials: {} },
        h: { id: 'h', data: { type: hostType, parent: 'ROOT', nodes: ['t', 'p'] }, specials: hostSpecials },
        t: { id: 't', data: { type: 'dropdown-trigger', parent: 'h', nodes: [] }, specials: {} },
        p: { id: 'p', data: { type: 'dropdown-panel', parent: 'h', nodes: [] }, specials: {} },
      },
    });
    const empties = (doc: unknown) =>
      reviewDesign(PageDoc.from(doc as never)).filter((f: { code: string }) => f.code === 'empty_container').length;
    expect(empties(zones('select', {}))).toBe(0);
    expect(empties(zones('dropdown', { selectMode: 'select' }))).toBe(0);
    // a PANEL dropdown's zones hold the author's own content — empty is a real blank
    expect(empties(zones('dropdown', {}))).toBe(2);
  });
});

/**
 * AN OVERLAY IS OFF-SCREEN ON PURPOSE. The cart drawer is parked outside the
 * viewport until a shopper opens it, so every node inside it measures as
 * off-canvas — 24 findings on one real page, on every page carrying the drawer,
 * at every width, none of them fixable from this page (trap 1 strips overlays on
 * write). A findings list that long is one nobody reads.

/**
 * AN OVERLAY IS OFF-SCREEN ON PURPOSE. The cart drawer is parked outside the
 * viewport until a shopper opens it, so every node inside it measures as
 * off-canvas — 24 findings on one real page, on every page carrying the drawer,
 * at every width, none of them fixable from this page (trap 1 strips overlays on
 * write). A findings list that long is one nobody reads.
 */
describe('measure() and the parked overlay', () => {
  const box = (id: string, x: number, w = 100) => ({ id, type: '', x, y: 0, w, h: 50 });
  const shot = {
    width: 390,
    imageBase64: '',
    mimeType: 'image/jpeg' as const,
    boxes: [
      box('ROOT', 0, 390),
      box('fs_00000001', 0, 390),
      box('ca_0ba4a56a', 410, 400),
      box('bt_7c4dd72a', 434, 350),
    ],
  };

  it('reports the drawer when nothing says it is an overlay', () => {
    const codes = measure([shot]).map((f) => f.nodeId);
    expect(codes).toContain('ca_0ba4a56a');
    expect(codes).toContain('bt_7c4dd72a');
  });

  it('is silent once the overlay subtree is named', () => {
    const skip = new Set(['ca_0ba4a56a', 'bt_7c4dd72a']);
    expect(measure([shot], skip)).toHaveLength(0);
  });

  it('still reports a real off-canvas node beside a skipped overlay', () => {
    const withSpill = { ...shot, boxes: [...shot.boxes, box('bu_00000002', 300, 200)] };
    const found = measure([withSpill], new Set(['ca_0ba4a56a', 'bt_7c4dd72a']));
    // It spills past 390 AND lands on the section, which are two defects on one
    // node — the point here is that both name the page's own node, never the drawer.
    expect(new Set(found.map((f) => f.nodeId))).toEqual(new Set(['bu_00000002']));
    expect(found.map((f) => f.code)).toContain('off_canvas');
  });
});

describe('reviewDesign() and a page that is only its chrome', () => {
  const doc = (kids: Record<string, unknown>) => ({
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: {
      ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: Object.keys(kids) }, specials: {} },
      ...kids,
    },
  });
  const ref = (id: string, kind: string) => ({
    id, data: { type: 'flex-section', parent: 'ROOT', nodes: [] }, specials: { globalRef: `gs_${kind}`, globalKind: kind },
  });
  const codes = (d: unknown) => reviewDesign(PageDoc.from(d as never)).map((f: { code: string }) => f.code);

  it('calls a page with nothing but the shared header and footer empty', () => {
    expect(codes(doc({ h: ref('h', 'header'), f: ref('f', 'footer') }))).toContain('empty_page');
  });

  it('does not call a shared CUSTOM section chrome — it is body content', () => {
    expect(codes(doc({ h: ref('h', 'header'), m: ref('m', 'custom'), f: ref('f', 'footer') }))).not.toContain('empty_page');
  });

  it('is quiet once a body section exists between them', () => {
    const body = { id: 'b', data: { type: 'flex-section', parent: 'ROOT', nodes: ['t'] }, specials: {} };
    const t = { id: 't', data: { type: 'text', parent: 'b', nodes: [] }, specials: { text: 'Xin chào' } };
    expect(codes(doc({ h: ref('h', 'header'), b: body, t, f: ref('f', 'footer') }))).not.toContain('empty_page');
  });
});

