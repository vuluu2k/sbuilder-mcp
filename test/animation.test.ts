import { describe, it, expect } from 'vitest';
import { ANIMATION, BASE_ONLY_CONFIG, ELEMENTS } from '../src/catalog/elements.generated.js';
import { animationNote, animationVocabulary } from '../src/domains/site/vocabulary.js';
import { isBaseOnlyConfig } from '../src/domains/site/baseonly.js';

/**
 * THE ENTRANCE ANIMATION — 73 of 111 element types offer it, and nothing in
 * this catalog described it.
 *
 * FOUR ways to miss, and all four are silent. Three are answered by the
 * vocabulary below; the fourth is answered by routing, because the platform's
 * ledger names the key and sb_set can simply write it to the layer the renderer
 * reads.
 */
describe('the entrance animation vocabulary', () => {
  it('is read from the platform, not hand-kept', () => {
    // The four keyframe keys and the four easings, off animation.go. If the
    // platform adds a fifth, the next codegen brings it and these stay true.
    expect(ANIMATION.types).toContain('fade_in');
    expect(ANIMATION.types.length).toBeGreaterThanOrEqual(4);
    expect(ANIMATION.easings).toContain('ease');
    expect(ANIMATION.easingFallback).toBe('ease');
  });

  it('is offered to the many elements that actually have the control', () => {
    const offering = Object.keys(ELEMENTS).filter((t) => ELEMENTS[t].controls.includes('animation'));
    expect(offering.length).toBeGreaterThan(50);
  });

  it('IS BASE-ONLY, which is the miss no warning could fix', () => {
    // render/css.go emits the rule into the base lane — "Base-only, because the
    // config object is base-only" — and readAnimConfig indexes
    // node.Config["animation"] with no responsive merge. Written per
    // breakpoint, as sb_set does by default, it lands where nothing looks.
    expect(BASE_ONLY_CONFIG).toContain('animation');
    expect(isBaseOnlyConfig('flex-section', 'animation')).toBe(true);
  });
});

describe('what sb_set says about a bad animation', () => {
  const ok = { active: true, type: 'fade_in' };

  it('says nothing at all about a correct one', () => {
    expect(animationNote(ok)).toBeNull();
    expect(animationNote({ ...ok, easing: 'ease-out', delay: 0.2, duration: 1 })).toBeNull();
  });

  it('catches the string, which is what the control NAME invites', () => {
    // readAnimConfig asserts map[string]interface{}, so a bare string is the
    // zero value and the node never animates.
    const n = animationNote('fade_in')!;
    expect(n).toMatch(/OBJECT, not a string/);
    expect(n).toMatch(/will not animate/);
  });

  it('catches the missing gate, and says why a type alone is not consent', () => {
    const n = animationNote({ type: 'fade_in' })!;
    expect(n).toMatch(/active:true is missing/);
    expect(n).toMatch(/switch goes off/);
  });

  it('catches the HYPHEN and names the underscored spelling to use', () => {
    // "fade-in" is what every other web tool spells it, and AnimKeyframes's own
    // comment flags the trap: keyed by the STORED value, fade_in not fade-in.
    const n = animationNote({ active: true, type: 'fade-in' })!;
    expect(n).toMatch(/UNDERSCORES/);
    expect(n).toMatch(/"fade_in"/);
  });

  it('reports a bad EASING differently, because that one still runs', () => {
    const n = animationNote({ active: true, type: 'fade_in', easing: 'bouncy' })!;
    expect(n).toMatch(/the animation runs/);
    expect(n).not.toMatch(/will not animate/);
  });

  it('hands sb_traits_for all four facts in ONE LINE', () => {
    // It rides on 73 of 111 elements, in the result an agent reads before every
    // styling decision — the six-field object this started as was 400 bytes of
    // dilution across two thirds of the catalog, and the budget test said so.
    const v = animationVocabulary();
    expect(v).toMatch(/active: true/);
    expect(v).toMatch(/REQUIRED/);
    expect(v).toMatch(/UNDERSCORED/);
    expect(v).toMatch(/base-only/);
    for (const t of ANIMATION.types) expect(v).toContain(t);
    expect(v.length).toBeLessThan(320);
  });
});
