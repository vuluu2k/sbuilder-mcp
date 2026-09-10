import { describe, it, expect } from 'vitest';
import { LAYOUT_PATTERNS, PATTERN_BY_ID, THEME_TOKENS, type MediaPick } from '../src/domains/site/patterns.js';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { validateForSave } from '../src/domains/site/validate.js';

/**
 * THE COMPOSITIONS A PAGE IS MADE OF.
 *
 * An agent asked for "a hero" had 111 ELEMENTS and no LAYOUT, so every band was
 * invented from flex-blocks on the spot — which is why a generated page reads
 * as generated: the elements are right, the composition is a guess, and the
 * guess is different on every section of the same site.
 *
 * These are built as `Captured` trees through `toSpecs`, never hand-assembled,
 * so each one inherits the mapper's own answers to rules 0, 1 and 3. That is
 * the property worth testing: not the shape of any one pattern, but that all of
 * them come out storable, responsive and token-aware without saying so.
 */
const tokens = { headingColor: '#2E2A3B', buttonBg: '#E8557A', sectionPadding: '80px 24px' };

describe('every layout pattern', () => {
  it('builds, and builds something', () => {
    expect(LAYOUT_PATTERNS.length).toBeGreaterThan(0);
    for (const p of LAYOUT_PATTERNS) {
      const spec = p.build(tokens);
      expect(spec, p.id).not.toBeNull();
      expect(spec!.type, p.id).toBe('flex-section');
    }
  });

  it('is STORABLE — the platform refuses a document, not a section', () => {
    for (const p of LAYOUT_PATTERNS) {
      const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
      d.apply(addSubtree(d, 'ROOT', p.build(tokens)!).patches);
      expect(validateForSave(d), p.id).toEqual([]);
    }
  });

  it('wears the page it lands on, and never a colour of its own', () => {
    // Rule 0, and the one thing a pattern library could get catastrophically
    // wrong: a band that answers the accent differently does not read as a new
    // section, it reads as a different website.
    for (const p of LAYOUT_PATTERNS) {
      const json = JSON.stringify(p.build(tokens));
      const hexes = json.match(/#[0-9a-fA-F]{6}/g) ?? [];
      for (const hex of hexes) {
        expect([tokens.headingColor, tokens.buttonBg], `${p.id} invented ${hex}`).toContain(hex);
      }
    }
  });

  it('gives every row it contains a mobile answer', () => {
    // Rule 3: nothing catches a too-narrow column for you — the columns SHRINK,
    // so no box overflows and `measure` stays silent.
    const rows: Array<Record<string, unknown>> = [];
    const walk = (n: Record<string, unknown>): void => {
      const style = n.style as Record<string, unknown> | undefined;
      if (style?.flexDirection === 'row') rows.push(n);
      for (const k of (n.children as Array<Record<string, unknown>>) ?? []) walk(k);
    };
    for (const p of LAYOUT_PATTERNS) walk(p.build(tokens) as unknown as Record<string, unknown>);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const res = r.responsive as { mobile?: { style?: Record<string, unknown> } } | undefined;
      expect(res?.mobile?.style?.flexDirection).toBe('column');
    }
  });
});

describe('the look a page has before it has anything', () => {
  it('is the site THEME, carried as a variable and never as a hex', () => {
    // A literal on a node OUTRANKS the style preset beneath it permanently, so a
    // pattern that baked today's colour in would stop following the theme the
    // moment the merchant changed it — the same detachment this repo records
    // for imported icons. The variable is what the theme's own scheme roles use.
    expect(THEME_TOKENS.headingColor).toMatch(/^var\(--wb-color-/);
    expect(THEME_TOKENS.buttonBg).toMatch(/^var\(--wb-color-/);
    expect(THEME_TOKENS.textColor).toMatch(/^var\(--wb-color-/);
  });

  it('still produces a storable band', () => {
    for (const p of LAYOUT_PATTERNS) {
      const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
      d.apply(addSubtree(d, 'ROOT', p.build(THEME_TOKENS)!).patches);
      expect(validateForSave(d), p.id).toEqual([]);
    }
  });
});

describe('a centred band centres its BUTTON too', () => {
  it('sets alignItems on the inner block, not only textAlign on the section', () => {
    // `textAlign` moves the words and leaves a `width: fit-content` button where
    // it was, so a centred band came out with its call to action against the
    // left margin.
    const band = PATTERN_BY_ID.get('sb_cta_band')!.build(tokens)!;
    expect(band.style?.alignItems).toBe('center');
    expect(band.children![0].style?.alignItems).toBe('center');
  });
});

/**
 * A REAL IMAGE, OR WORDS — never a grey box and never stock.
 *
 * The instinct a pattern library invites is a placeholder, and both kinds are
 * worse than an empty slot: this repo already records that keyword stock is not
 * a source (`loremflickr` answered "kids,clothing" with a cat statue), and a
 * grey box reads as unfinished because it is. The site's own library is the
 * honest source — measured on a live store, 164 assets, 50 of them images.
 */
describe('the picture slot', () => {
  const wide: MediaPick = { url: 'https://cdn/wide.jpg', name: 'Bờ biển', width: 1200, height: 600 };
  const tall: MediaPick = { url: 'https://cdn/tall.jpg', name: 'Chân dung', width: 600, height: 1200 };
  const hero = () => PATTERN_BY_ID.get('sb_hero_split')!;
  const gallery = () => PATTERN_BY_ID.get('sb_gallery')!;

  it("uses an image the site owns, with the library's own name as its alt", () => {
    const json = JSON.stringify(hero().build(tokens, [wide]));
    expect(json).toContain('https://cdn/wide.jpg');
    expect(json).toContain('Bờ biển');
  });

  it('prefers a LANDSCAPE for a hero panel, which is rule 6 before the fact', () => {
    // A hero panel filled with a portrait crop is the aspect-ratio mistake, so
    // the shape is asked for — and it degrades to any unused image rather than
    // to none.
    expect(JSON.stringify(hero().build(tokens, [tall, wide]))).toContain('wide.jpg');
    expect(JSON.stringify(hero().build(tokens, [tall]))).toContain('tall.jpg');
  });

  it('says so IN WORDS when the library is empty, rather than shipping a grey box', () => {
    const json = JSON.stringify(hero().build(tokens, []));
    expect(json).not.toContain('"image"');
    expect(json).toMatch(/sb_media_upload/);
  });

  it('never shows the same photo twice in one band', () => {
    const pool: MediaPick[] = Array.from({ length: 6 }, (_, i) => ({
      url: `https://cdn/${i}.jpg`,
      width: 800,
      height: 600,
    }));
    const json = JSON.stringify(gallery().build(tokens, pool));
    const used = (json.match(/https:\/\/cdn\/\d\.jpg/g) ?? []);
    expect(used.length).toBe(new Set(used).size);
    expect(used.length).toBeGreaterThan(1);
  });

  it('bounds the gallery — a merchant with 164 assets does not want 164 in one band', () => {
    const pool: MediaPick[] = Array.from({ length: 40 }, (_, i) => ({ url: `https://cdn/${i}.jpg` }));
    const used = JSON.stringify(gallery().build(tokens, pool)).match(/https:\/\/cdn\//g) ?? [];
    expect(used.length).toBeLessThanOrEqual(6);
  });

  it('a gallery with nothing to show is a sentence, not an empty band', () => {
    const json = JSON.stringify(gallery().build(tokens, []));
    expect(json).toMatch(/sb_media_upload/);
    expect(json).not.toContain('"image"');
  });
});

/**
 * THE DECLARED COUNT IS A PROMISE TO THE CALLER, and the only thing that keeps
 * it honest is asking the band itself.
 *
 * `images` exists so an agent knows how many photographs to go and get BEFORE
 * it builds — a site this server has just built has an empty library, so
 * without the number it discovers how short it was by reading a sentence where
 * a photo should be. A declared number that drifts from what `build` actually
 * consumes is worse than none: it sends the caller to fetch six for a band that
 * takes three, or three for a band that takes six and still shows a sentence.
 *
 * Saturated with a pool far larger than any slot count, so the answer is the
 * band's own appetite rather than the pool's size.
 */
describe('a pattern that declares picture slots', () => {
  const saturated: MediaPick[] = Array.from({ length: 40 }, (_, i) => ({
    url: `https://cdn/sat-${i}.jpg`,
    width: 1200,
    height: 600,
  }));

  it('fills exactly as many as it says it can', () => {
    for (const p of LAYOUT_PATTERNS) {
      if (!p.images) continue;
      const used = JSON.stringify(p.build(tokens, saturated)).match(/https:\/\/cdn\/sat-\d+\.jpg/g) ?? [];
      expect(new Set(used).size, `${p.id} declares ${p.images}`).toBe(p.images);
    }
  });

  it('is declared by every pattern that takes a picture at all, and by no other', () => {
    // The negative half is the one that rots quietly: a new band with a picture
    // slot and no `images` reports nothing to fill, so the agent is never told
    // to go and get anything and the slot ships as a sentence forever.
    for (const p of LAYOUT_PATTERNS) {
      const takesOne = JSON.stringify(p.build(tokens, saturated)).includes('https://cdn/sat-');
      expect(Boolean(p.images), `${p.id}`).toBe(takesOne);
    }
  });
});
