import { describe, it, expect } from 'vitest';
import { LAYOUT_PATTERNS, PATTERN_BY_ID, THEME_TOKENS } from '../src/domains/site/patterns.js';
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
