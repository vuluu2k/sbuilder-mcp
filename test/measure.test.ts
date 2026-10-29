import { describe, it, expect } from 'vitest';
import { measure, measureShot } from '../src/vision/measure.js';
import type { Box, Shot } from '../src/vision/shoot.js';

/**
 * These defects exist only after the browser has laid the page out. Reading the
 * document cannot find any of them.
 */

function box(id: string, x: number, y: number, w: number, h: number, extra: Partial<Box> = {}): Box {
  return { id, type: 'flex-block', x, y, w, h, ...extra };
}
function shot(width: number, boxes: Box[]): Shot {
  return { width, imageBase64: '', mimeType: 'image/jpeg', boxes };
}

describe('measureShot()', () => {
  it('finds content that spills past the viewport', () => {
    const f = measureShot(shot(390, [box('fs_1', 0, 0, 640, 100)]));
    expect(f.map((x) => x.code)).toEqual(['off_canvas']);
    expect(f[0].problem).toContain('390px viewport');
    expect(f[0].fix).toContain('fs_1');
  });

  it('finds text too small to read on a phone', () => {
    const f = measureShot(shot(390, [box('tx_1', 0, 0, 300, 20, { fontPx: 9, hasText: true })]));
    expect(f.map((x) => x.code)).toEqual(['text_too_small']);
    expect(f[0].problem).toContain('9px');
  });

  it('ignores a small font on an element that renders no text of its own', () => {
    // A container inherits a size it never shows; reporting it would be noise.
    const f = measureShot(shot(390, [box('fs_1', 0, 0, 300, 20, { fontPx: 9, hasText: false })]));
    expect(f).toEqual([]);
  });

  it('finds two elements sitting on top of each other', () => {
    const f = measureShot(shot(1440, [box('a_1', 0, 0, 200, 100), box('b_1', 50, 50, 200, 100)]));
    expect(f.map((x) => x.code)).toEqual(['overlap']);
    expect(f[0].problem).toContain('b_1');
  });

  it('does NOT call nesting an overlap — a parent contains its children', () => {
    const f = measureShot(shot(1440, [box('a_1', 0, 0, 400, 300), box('b_1', 20, 20, 100, 50)]));
    expect(f).toEqual([]);
  });

  it('tolerates a pixel of rounding rather than crying wolf', () => {
    const f = measureShot(shot(1440, [box('a_1', 0, 0, 200, 100), box('b_1', 199, 0, 200, 100)]));
    expect(f).toEqual([]);
  });

  // AN OVERLAY IS A DESIGN, NOT A COLLISION — and this rule's own comment said
  // so long before anything checked it. Every quickview badge, sale ribbon and
  // wishlist heart on a product card sits over its image BY CONSTRUCTION, so
  // the rule fired on storefronts that were built correctly. Measured on a live
  // home page: a `collection-media` reported against the `icon` in its corner.
  it('does NOT call an absolutely-positioned overlay a collision', () => {
    const f = measureShot(
      shot(390, [
        box('co_1', 41, 0, 308, 308),
        box('ic_1', 300, 8, 32, 32, { position: 'absolute' }),
      ]),
    );
    expect(f).toEqual([]);
  });

  it('still reports two IN-FLOW boxes on top of each other', () => {
    // `relative` keeps its space in the flow, so a relative box overlapping a
    // sibling is the negative-margin defect this check exists to find — the
    // exemption must not widen into "anything that is not static".
    const f = measureShot(
      shot(390, [
        box('a_1', 0, 0, 200, 100, { position: 'relative' }),
        box('b_1', 50, 50, 200, 100, { position: 'static' }),
      ]),
    );
    expect(f.map((x) => x.code)).toEqual(['overlap']);
  });

  // GAP #29 (TTG, 2026-10-29): a floating CTA (`fb_633c5307`, position:fixed,
  // bottom-right, in the footer global) — its BUTTON is static, so the old
  // per-box exemption did not reach it, and `bt_… overlaps fb_…` fired against
  // whatever sat under the viewport corner on every page.
  it('does NOT compare a box inside a fixed/sticky/absolute layer with one outside it', () => {
    const f = measureShot(
      shot(1440, [
        box('fb_fixed01', 1300, 700, 120, 48, { position: 'fixed', layer: 'fb_fixed01' }),
        box('bt_cta0001', 1304, 704, 112, 40, { position: 'static', layer: 'fb_fixed01' }),
        box('fb_content', 1000, 650, 400, 200, { position: 'static' }),
      ]),
    );
    expect(f).toEqual([]);
  });

  it('still compares two boxes inside the SAME floating layer', () => {
    const f = measureShot(
      shot(1440, [
        box('bt_a000001', 0, 0, 200, 100, { layer: 'hd_sticky1' }),
        box('bt_b000001', 50, 50, 200, 100, { layer: 'hd_sticky1' }),
      ]),
    );
    expect(f.map((x) => x.code)).toEqual(['overlap']);
  });

  // GAP #60 (TTG, 2026-10-29): the cart drawer carried `width:400px` and no
  // max-width, so at 390 it overhung the left edge by 10px — "Giỏ hàng" sat
  // flush at x=0, and the 24px padding hid most of it in the picture.
  it('names a floating box wider than the viewport, with its width and a mobile fix', () => {
    const f = measureShot(shot(390, [box('ca_f29bbf6a', -10, 0, 400, 900, { position: 'fixed' })]));
    expect(f.map((x) => x.code)).toEqual(['wider_than_viewport']);
    expect(f[0].problem).toContain('400px wide');
    expect(f[0].problem).toContain('390px viewport');
    expect(f[0].fix).toContain('ca_f29bbf6a');
    expect(f[0].fix).toContain('maxWidth');
  });

  it('reports a floating box that merely overhangs, by more than a pixel', () => {
    const f = measureShot(shot(390, [box('fb_1', 300, 0, 100, 48, { position: 'absolute' })]));
    expect(f.map((x) => x.code)).toEqual(['wider_than_viewport']);
    expect(measureShot(shot(390, [box('fb_1', 291, 0, 100, 48, { position: 'fixed' })]))).toEqual([]);
  });

  // A CLOSED drawer is `visibility:hidden` + translated off-screen by design
  // (`cart-drawer/static_css.go`); only an open one is a visitor's problem.
  it('says nothing about a box the browser does not show', () => {
    const f = measureShot(shot(390, [box('ca_1', 400, 0, 400, 900, { position: 'fixed', hidden: true })]));
    expect(f).toEqual([]);
    // Its static interior, hidden by inheritance, rides the same fixed layer.
    expect(measureShot(shot(390, [box('he_1', 424, 24, 352, 30, { hidden: true, inFixed: true, fontPx: 9, hasText: true })]))).toEqual([]);
  });

  // Review of v0.100.4: visibility:hidden still takes part in layout, so a CLOSED
  // absolute dropdown panel (320px at x=200 on 390) made scrollWidth 520 — a
  // horizontal scroll on a phone. Only a FIXED layer is out of the page's
  // scrollable overflow; hidden still never counts as an overlap or as small text.
  it('reports a hidden box outside a fixed layer that still widens the page', () => {
    const f = measureShot(shot(390, [box('dp_1', 200, 40, 320, 200, { position: 'absolute', hidden: true, fontPx: 9, hasText: true })]));
    expect(f.map((x) => x.code)).toEqual(['off_canvas']);
    expect(f[0].problem).toMatch(/hidden/i);
    expect(f[0].problem).toContain('200 → 520');
    const pair = measureShot(shot(1440, [box('a_1', 0, 0, 200, 100, { hidden: true }), box('b_1', 50, 50, 200, 100)]));
    expect(pair).toEqual([]);
  });

  it('reports each overlapping pair once, not twice', () => {
    const f = measureShot(shot(1440, [box('a_1', 0, 0, 200, 100), box('b_1', 50, 50, 200, 100)]));
    expect(f.length).toBe(1);
  });

  it('says nothing about a page that lays out cleanly', () => {
    const f = measureShot(
      shot(1440, [
        box('ROOT', 0, 0, 1440, 400),
        box('a_1', 0, 0, 1440, 200, { fontPx: 16, hasText: true }),
        box('b_1', 0, 200, 1440, 200, { fontPx: 16, hasText: true }),
      ]),
    );
    expect(f).toEqual([]);
  });
});

describe('measure()', () => {
  it('collects the widths a defect happens at, instead of repeating it', () => {
    const wide = shot(1440, [box('fs_1', 0, 0, 300, 100)]);
    const narrow = shot(390, [box('fs_1', 0, 0, 640, 100)]);
    const mobile = shot(320, [box('fs_1', 0, 0, 640, 100)]);
    const f = measure([wide, narrow, mobile]);
    expect(f.length).toBe(1);
    // Which widths it fails at IS the diagnosis: fine wide, broken narrow is a
    // responsive failure, not a broken element.
    expect(f[0].widths).toEqual([390, 320]);
  });
});
