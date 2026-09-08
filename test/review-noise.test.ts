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
