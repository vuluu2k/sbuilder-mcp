import { describe, it, expect, beforeEach } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { tokensFromPage } from '../src/domains/site/importmap.js';
import { clearThemeCache } from '../src/domains/site/theme-fetch.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { STARTER_THEME } from '../src/domains/site/theme.js';
import { measureShot } from '../src/vision/measure.js';
import type { Box, Shot } from '../src/vision/shoot.js';

/**
 * TTG GAPS #64–#81, found building a blog and a landing page on a Vietnamese
 * store (2026-10-29, sbuilder-mcp v0.100.5). Each block names its gap.
 */

beforeEach(() => clearThemeCache());

function page(...sections: unknown[]) {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  for (const s of sections) d.apply(addSubtree(d, 'ROOT', s as never).patches);
  return d;
}

/* #64 ---------------------------------------------------------------------- */

describe('#64 a page\'s tokens are not read off a hero on a picture', () => {
  // The landing page's hand-built hero: gradient + photo ground, NO
  // backgroundColor, white h1, a pale-blue 13px label, a 620px copy column.
  const hero = {
    type: 'flex-section',
    style: { backgroundImage: 'linear-gradient(rgba(0,0,0,.6), rgba(0,0,0,.6)), url(https://x/hero.jpg)' },
    children: [
      {
        type: 'flex-block',
        style: { maxWidth: '620px' },
        children: [
          { type: 'heading', style: { color: '#ffffff' } },
          { type: 'text', style: { color: '#7cc3e3', fontSize: '13px' } },
        ],
      },
    ],
  };

  it('a background image is an inverted ground: its white type is not the page\'s ink', () => {
    const t = tokensFromPage(page(hero).doc);
    expect(t.headingColor).toBeUndefined();
    expect(t.textColor).toBeUndefined();
    expect(t.textSize).toBeUndefined();
    expect(t.sectionMaxWidth).toBeUndefined();
  });

  it('a light band after the hero is read, and the hero colours do not leak into it', () => {
    const light = {
      type: 'flex-section',
      children: [
        { type: 'flex-block', style: { maxWidth: '1200px' }, children: [{ type: 'heading', style: { color: '#191c1e' } }] },
      ],
    };
    const t = tokensFromPage(page(hero, light).doc);
    expect(t.headingColor).toBe('#191c1e');
    expect(t.sectionMaxWidth).toBe('1200px');
  });

  it('the section width is the band\'s content container, never a nested column', () => {
    const band = {
      type: 'flex-section',
      children: [
        {
          type: 'flex-block',
          style: { maxWidth: '1200px' },
          children: [{ type: 'flex-block', style: { maxWidth: '620px' }, children: [{ type: 'text' }] }],
        },
      ],
    };
    const nestedFirst = {
      type: 'flex-section',
      children: [{ type: 'flex-block', children: [{ type: 'flex-block', style: { maxWidth: '480px' }, children: [{ type: 'text' }] }] }],
    };
    expect(tokensFromPage(page(nestedFirst, band).doc).sectionMaxWidth).toBe('1200px');
    expect(tokensFromPage(page(nestedFirst).doc).sectionMaxWidth).toBeUndefined();
  });

  it('a bg video or scene is a picture ground too', () => {
    const vid = { ...hero, style: {}, config: { backgroundSceneSource: 'effect' } };
    expect(tokensFromPage(page(vid).doc).headingColor).toBeUndefined();
  });
});

/* #65 ---------------------------------------------------------------------- */

describe('#65 sb_review reads a preset-painted ground', () => {
  const band = (kids: unknown[], style: Record<string, unknown> = {}) => ({
    type: 'flex-section',
    style,
    children: [{ type: 'flex-block', children: kids }],
  });
  const codes = (d: PageDoc, theme?: typeof STARTER_THEME) =>
    reviewDesign(d, theme ? { theme } : {}).filter((f) => f.code === 'invisible_text' || f.code === 'low_contrast');

  it('white type on the container-section preset ground is invisible_text, pale blue is low_contrast', () => {
    const d = page(band([
      { type: 'heading', specials: { text: 'Câu hỏi' }, style: { color: '#ffffff' } },
      { type: 'text', specials: { text: 'Trả lời' }, style: { color: '#7cc3e3' } },
    ]));
    expect(codes(d)).toEqual([]); // no theme: the ground is unknown, say nothing
    const found = codes(d, STARTER_THEME);
    expect(found.map((f) => f.code).sort()).toEqual(['invisible_text', 'low_contrast']);
  });

  it('type on a picture ground is not judged from the tree, and theme-on-theme is the theme\'s design', () => {
    const hero = band([{ type: 'heading', specials: { text: 'Hero' }, style: { color: '#ffffff' } }], {
      backgroundImage: 'url(https://x/a.jpg)',
    });
    const plain = band([{ type: 'heading', specials: { text: 'Plain' } }]);
    expect(codes(page(hero, plain), STARTER_THEME)).toEqual([]);
  });
});

/* #65 sb_look -------------------------------------------------------------- */

describe('#65 sb_look measures contrast on the render', () => {
  const box = (id: string, extra: Partial<Box>): Box => ({ id, type: 'text', x: 0, y: 0, w: 100, h: 20, hasText: true, fontPx: 16, ...extra });
  const shot = (boxes: Box[]): Shot => ({ width: 1440, imageBase64: '', mimeType: 'image/jpeg', boxes });

  it('a computed colour against the nearest opaque ground under 3:1 is low_contrast', () => {
    const f = measureShot(shot([box('tx_00000001', { fg: 'rgb(255, 255, 255)', bg: 'rgb(247, 249, 251)' })]));
    expect(f.map((x) => x.code)).toContain('low_contrast');
  });

  it('readable text and text over a picture are silent', () => {
    const f = measureShot(shot([
      box('tx_00000001', { fg: 'rgb(25, 28, 30)', bg: 'rgb(247, 249, 251)' }),
      box('tx_00000002', { fg: 'rgb(255, 255, 255)', bg: 'rgb(255, 255, 255)', overImage: true }),
    ]));
    expect(f.filter((x) => x.code === 'low_contrast')).toEqual([]);
  });
});
