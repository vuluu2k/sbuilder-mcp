import { describe, it, expect } from 'vitest';
import {
  STARTER_THEME,
  detachNote,
  presetForType,
  presetIdOf,
  presetLayer,
  resolveVars,
} from '../src/domains/site/theme.js';
import { ELEMENT_PRESETS, THEME_SOURCE } from '../src/catalog/theme.generated.js';

/**
 * Design rule 0 — "read the page's pattern off what is there" — assumes a node's
 * style holds what it paints. Since THEME_VERSION 6 that is false for nine
 * element types, whose defaults live in a theme PRESET rather than the meta.
 * icon/meta.ts says so outright: "The COLOUR lives in the icon-default style
 * preset, not here."
 */
const node = (type: string, style: Record<string, unknown> = {}, specials = {}) =>
  ({ data: { type }, style, specials }) as never;

describe('the style layer a node does not contain', () => {
  it('knows which elements wear one', () => {
    expect(THEME_SOURCE.themeVersion).toBeGreaterThanOrEqual(6);
    expect(presetForType('icon')).toBe('icon-default');
    expect(presetForType('button')).toBe('button-default');
    // An element with no preset must answer null, not a guess.
    expect(presetForType('flex-block')).toBeNull();
    expect(Object.keys(ELEMENT_PRESETS).length).toBe(THEME_SOURCE.elementsWearingOne);
  });

  it("lets a node's own specials override its type's default", () => {
    expect(presetIdOf(node('button'))).toBe('button-default');
    expect(presetIdOf(node('button', {}, { stylePreset: 'button-pill' }))).toBe('button-pill');
  });

  // THE CHAIN IS THE POINT. icon-default paints
  // `var(--wb-sc-heading, var(--wb-color-heading))` — a scheme role, whose value
  // is a palette token, whose value is a hex. Reporting the raw string answers
  // "what colour is this" with a variable name, which is the same non-answer the
  // node's own style already gave.
  it('flattens a var chain down to something a person could read', () => {
    expect(resolveVars(STARTER_THEME, 'var(--wb-color-heading)')).toBe('#111827');
    expect(resolveVars(STARTER_THEME, 'var(--wb-sc-heading, var(--wb-color-heading))')).toBe(
      '#111827',
    );
    // A literal is already the answer.
    expect(resolveVars(STARTER_THEME, '#abcdef')).toBe('#abcdef');
  });

  it('keeps an unresolvable reference rather than inventing a colour', () => {
    // A deleted token, or a theme older than the preset. Returning the fallback
    // is information; returning a made-up hex is the failure this prevents.
    expect(resolveVars(STARTER_THEME, 'var(--wb-color-gone, #ff0000)')).toBe('#ff0000');
    expect(resolveVars(STARTER_THEME, 'var(--wb-color-gone)')).toBe('var(--wb-color-gone)');
  });

  it('answers what an icon actually paints, which its style never held', () => {
    const layer = presetLayer(STARTER_THEME, 'site', node('icon'));
    expect(layer?.id).toBe('icon-default');
    expect(layer?.paints.color).toBe('#111827');
    expect(layer?.overridden).toEqual([]);
  });

  it('says which preset keys the node has already replaced', () => {
    const layer = presetLayer(STARTER_THEME, 'site', node('icon', { color: '#e11d48' }));
    // The preset still paints its value; the node's own slot outranks it, so
    // the page shows the node's. A caller must be able to tell those apart.
    expect(layer?.paints.color).toBe('#111827');
    expect(layer?.overridden).toEqual(['color']);
  });

  it('names a preset the theme does not hold instead of resolving to nothing', () => {
    // The exact failure THEME_VERSION 6 was bumped for: a v5 theme holds none
    // of the starters, so the element renders unstyled with nothing to explain it.
    const layer = presetLayer(STARTER_THEME, 'site', node('icon', {}, { stylePreset: 'nope' }));
    expect(layer?.id).toBe('nope');
    expect(layer?.name).toMatch(/not in this theme/);
    expect(layer?.paints).toEqual({});
  });

  it('warns before a literal detaches the node from the theme', () => {
    const layer = presetLayer(STARTER_THEME, 'site', node('icon'))!;
    const n = detachNote(layer, ['color']);
    expect(n).toMatch(/outranks the preset permanently/i);
    expect(n).toMatch(/#111827/);
    // A key the preset does not paint is not a detachment.
    expect(detachNote(layer, ['marginTop'])).toBeNull();
    // Nor is one the node already overrode — that horse has gone.
    const already = presetLayer(STARTER_THEME, 'site', node('icon', { color: '#e11d48' }))!;
    expect(detachNote(already, ['color'])).toBeNull();
  });

  // A STARTER ANSWER IS A GUESS ABOUT A LIVE SITE, and must say so. Handing an
  // agent the starter's #111827 for a site whose heading token is rose is a
  // confident wrong colour, which is worse than none.
  it('marks a starter-derived answer as one', () => {
    const layer = presetLayer(STARTER_THEME, 'starter', node('icon'))!;
    expect(layer.from).toBe('starter');
    expect(detachNote(layer, ['color'])).toMatch(/could not be read/);
    const real = presetLayer(STARTER_THEME, 'site', node('icon'))!;
    expect(detachNote(real, ['color'])).not.toMatch(/could not be read/);
  });
});
