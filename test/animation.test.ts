import { describe, it, expect } from 'vitest';
import { ANIMATION, BASE_ONLY_CONFIG, ELEMENTS } from '../src/catalog/elements.generated.js';
import { animationNote, animationValues, animationVocabulary } from '../src/domains/site/vocabulary.js';
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

  it('IS NO LONGER BASE-ONLY, and this is the tripwire for that', () => {
    // IT USED TO BE, and this assertion used to say so. readAnimConfig indexed
    // node.Config["animation"] with no responsive merge, so a per-breakpoint
    // write landed where nothing looked and baseonly.ts ROUTED it to base.
    //
    // Adding an intensity ended that defence — a distance is a QUANTITY, and a
    // quantity reaches the page per breakpoint — so the compiler took a `bp`,
    // the key left the platform's ledger, and the routing stopped on its own
    // because the table is generated rather than copied.
    //
    // Pinned in the NEW direction rather than deleted: if `animation` ever
    // reappears in the ledger, sb_set would start forcing every animation to
    // base and silently drop the mobile answer, which is the feature this
    // change exists to give. The lie is caught from either side.
    expect(BASE_ONLY_CONFIG).not.toContain('animation');
    expect(isBaseOnlyConfig('flex-section', 'animation')).toBe(false);
  });

  it('carries the keys the object grew, read from the platform', () => {
    // Five new fields on 2026-09-11. A catalog describing five of ten is worse
    // than one describing none: an agent reads it, sees the shape it names, and
    // concludes the rest does not exist.
    expect(ANIMATION.intensities).toContain('medium');
    expect(ANIMATION.intensityDurations.medium).toBeGreaterThan(0);
    expect(ANIMATION.repeatMax).toBeGreaterThan(1);
    expect(ANIMATION.rangeDefault).toBeGreaterThan(0);
  });

  it('KNOWS REVEAL-ON-SCROLL EXISTS, which this repo recorded as impossible', () => {
    // "A section that fades in as the visitor reaches it cannot be authored by
    // any tool here, because the platform has nowhere to put it." It has one
    // now — animation-timeline: view() in an @supports override — and a note
    // that says "you cannot" outlives the thing that made it true.
    expect(ANIMATION.triggers).toContain('view');
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

  it('catches an unknown INTENSITY, which is quieter than a bad easing', () => {
    // It still runs: no variables are emitted and the keyframes fall back to
    // their own literals, so the node moves a distance nobody chose.
    const n = animationNote({ active: true, type: 'fade_in', intensity: 'huge' })!;
    expect(n).toMatch(/intensity/);
    expect(n).toMatch(/built-in distances/);
  });

  it('catches a trigger that is not the scroll one, since it is silent', () => {
    const n = animationNote({ active: true, type: 'fade_in', trigger: 'scroll' })!;
    expect(n).toMatch(/first paint/);
  });

  it('CATCHES THE COMBINATION THAT PUBLISHES AN INVISIBLE NODE', () => {
    // alternate with an even finite count finishes on the `from` keyframe, and
    // every entrance keyframe starts at opacity:0. The author watches it play
    // on the canvas; the visitor gets a node that is never shown. The renderer
    // refuses it — so the write is stored, accepted, and does not do what it
    // says, which is exactly the family this note exists for.
    const n = animationNote({ active: true, type: 'fade_in', repeat: 2, alternate: true })!;
    expect(n).toMatch(/alternate:true is DROPPED/);
    expect(n).toMatch(/no visitor can see/);
    // The legal spelling says nothing at all.
    expect(animationNote({ active: true, type: 'fade_in', repeat: 'infinite', alternate: true })).toBeNull();
  });

  it('says nothing about the new keys when they are right', () => {
    expect(
      animationNote({
        active: true,
        type: 'slide_in_up',
        easing: 'spring',
        intensity: 'strong',
        trigger: 'view',
        range: 40,
      }),
    ).toBeNull();
  });

  it('keeps the TRAPS in one line and moves the 46 names out of the prose', () => {
    // This assertion used to require every type name IN the sentence, which was
    // true at four and became 848 bytes at forty-six — the budget test caught
    // it, for the second time on this same field. The first catch moved the
    // long form out of the trait sheet; this one moves the ENUMERATION out of
    // the prose. What stays in the sentence is what decides whether a write
    // does anything at all.
    const v = animationVocabulary();
    expect(v).toMatch(/active: true/);
    expect(v).toMatch(/REQUIRED/);
    expect(v).toMatch(/UNDERSCORED/);
    // The fact that replaced "base-only", and the reason the change was worth
    // making: an animation that is off on mobile.
    expect(v).toMatch(/per breakpoint/);
    expect(v).not.toMatch(/base-only/);
    expect(v.length).toBeLessThan(480);

    // The names live here instead, as data, generated from the Go that renders.
    const vals = animationValues() as Record<string, any>;
    expect(vals.type).toEqual(ANIMATION.types);
    expect(vals.trigger.values).toContain('view');
    expect(vals.alternate).toMatch(/infinite/);
  });
});
