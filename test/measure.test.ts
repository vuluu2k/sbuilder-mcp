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
