import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { isOffscreenOverlay, offscreenNodes, offscreenRootOf } from '../src/domains/site/offscreen.js';
import { isOverlay, overlayRoot } from '../src/core/tree.js';
import { measure } from '../src/vision/measure.js';
import type { Shot } from '../src/vision/shoot.js';

/**
 * THE SKIP ASKED A COMPOSITION QUESTION ABOUT A RENDER FACT.
 *
 * `measure` skips overlays so a parked drawer is not reported as off-canvas,
 * and built the skip from `isOverlay` — "does this node carry `overlayId` and
 * sit under ROOT". That is the right test for trap 1 and the wrong one here: a
 * `cart-drawer` authored straight into a page document carries no stamp and
 * parks itself off-screen exactly the same way, because its own CSS does it.
 *
 * MEASURED on a live storefront: every page carried an unstamped `cart-drawer`
 * as a ROOT child, so the skip came out EMPTY and `sb_look` reported THIRTEEN
 * off-canvas findings per page at every width, on pages that were correct.
 * With the render-side test the same pages report ONE finding — a real overlap
 * in the shared header, which had been buried under the noise.
 *
 * The same blind spot made `sb_look node_id:<inside the drawer>` fail outright:
 * nothing was opened, the clip landed outside the image, and Playwright
 * answered "Clipped area is either empty or outside the resulting image".
 */

function pageWithDrawer(stamped: boolean): { doc: PageDoc; drawer: string; inside: string } {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  d.apply(addSubtree(d, 'ROOT', { type: 'flex-section' }).patches);
  const made = addSubtree(d, 'ROOT', {
    type: 'cart-drawer',
    children: [{ type: 'heading', specials: { text: 'Giỏ hàng' } }],
  });
  d.apply(made.patches);
  if (stamped) {
    d.apply([{ op: 'set', path: ['nodes', made.ids[0], 'specials', 'overlayId'], value: 'ov_1' }]);
  }
  return { doc: d, drawer: made.ids[0], inside: made.ids[1] };
}

describe('an overlay is recognised by what its renderer does, not only by its stamp', () => {
  it('still recognises a composed overlay', () => {
    const { doc, drawer } = pageWithDrawer(true);
    expect(isOverlay(doc.doc, drawer)).toBe(true);
    expect(isOffscreenOverlay(doc.doc, drawer)).toBe(true);
  });

  /** The case the stamp-based test missed, and the one every real page had. */
  it('recognises a drawer authored straight into the page, which carries no stamp', () => {
    const { doc, drawer } = pageWithDrawer(false);
    expect(isOverlay(doc.doc, drawer)).toBe(false);
    expect(isOffscreenOverlay(doc.doc, drawer)).toBe(true);
  });

  it('collects the whole subtree, so nothing inside is judged either', () => {
    const { doc, drawer, inside } = pageWithDrawer(false);
    const skip = offscreenNodes(doc.doc);
    expect(skip.has(drawer)).toBe(true);
    expect(skip.has(inside)).toBe(true);
    // And an ordinary band is NOT swept up — the point is to keep the real
    // findings, not to silence the page.
    expect(skip.has(doc.node('ROOT').data.nodes[0])).toBe(false);
  });

  it('answers for a node anywhere inside one, which is what a framed shot needs', () => {
    const { doc, drawer, inside } = pageWithDrawer(false);
    expect(offscreenRootOf(doc.doc, inside)).toBe(drawer);
    expect(overlayRoot(doc.doc, inside)).toBeNull(); // the old test, unchanged
  });

  /**
   * `overlayRoot` MUST NOT be widened to match. It answers the COMPOSITION
   * question every write guard asks — "is this node inside a subtree the save
   * will strip" — and an authored drawer is a node this page genuinely owns
   * and may edit. Widening it would make `refuseOverlay` start refusing those
   * writes. Two questions, two functions, and this pins them apart.
   */
  it('leaves the composition test alone', () => {
    const { doc, drawer } = pageWithDrawer(false);
    expect(overlayRoot(doc.doc, drawer)).toBeNull();
    expect(isOverlay(doc.doc, drawer)).toBe(false);
  });

  it('does not sweep up an overlay element nested below ROOT', () => {
    // A popup inside a section is a document the platform refuses on save, so
    // hiding it here would hide that — and `addSubtree` will not even build
    // one, because `popup` is root-only. The shape therefore has to arrive the
    // way a damaged document does, which is the population this guards.
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', { type: 'flex-section' });
    d.apply(sec.patches);
    expect(() => addSubtree(d, sec.ids[0], { type: 'popup' })).toThrow(/root-only/);
    d.apply([
      {
        op: 'set',
        path: ['nodes', 'po_x'],
        value: {
          id: 'po_x',
          data: { type: 'popup', parent: sec.ids[0], nodes: [] },
          specials: {},
        },
      },
      { op: 'insert', path: ['nodes', sec.ids[0], 'data', 'nodes'], index: 0, value: 'po_x' },
    ]);
    expect(offscreenNodes(d.doc).has('po_x')).toBe(false);
  });
});

describe('what the widened skip does to a measurement', () => {
  const shot = (boxes: Shot['boxes']): Shot =>
    ({ width: 1440, imageBase64: '', mimeType: 'image/png', boxes }) as Shot;

  it('stops reporting a parked drawer as content past the viewport', () => {
    const { doc, drawer, inside } = pageWithDrawer(false);
    const boxes = [
      { id: drawer, x: 1461, y: 0, w: 420, h: 800 },
      { id: inside, x: 1487, y: 24, w: 368, h: 40 },
    ] as unknown as Shot['boxes'];
    expect(measure([shot(boxes)])).toHaveLength(2);
    expect(measure([shot(boxes)], offscreenNodes(doc.doc))).toEqual([]);
  });

  it('and leaves a real off-canvas node reported', () => {
    const { doc } = pageWithDrawer(false);
    const band = doc.node('ROOT').data.nodes[0];
    const boxes = [{ id: band, x: 0, y: 0, w: 1600, h: 200 }] as unknown as Shot['boxes'];
    const found = measure([shot(boxes)], offscreenNodes(doc.doc));
    expect(found.map((f) => f.code)).toEqual(['off_canvas']);
  });
});
