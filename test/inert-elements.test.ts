import { describe, it, expect } from 'vitest';
import { inertHint, inertHintsFor } from '../src/domains/site/inert.js';

/**
 * The other silent-failure shape: not a value stored where nothing reads it, but
 * an element that RENDERS convincingly while wired to nothing. sb_review reads
 * the tree and the tree is correct; sb_look photographs the page and the page
 * looks right. Only the moment of adding is cheap.
 */
describe('elements that render convincingly while doing nothing', () => {
  it('warns that a locale-switcher fabricates its chip below two locales', () => {
    // render/nodes/locale-switcher/html.go: `sample` is a hardcoded
    // "🌐 Tiếng Việt / VND", chosen so the element is never an empty box.
    const n = inertHint('locale-switcher');
    expect(n).toMatch(/FABRICATED/);
    expect(n).toMatch(/two or more/);
    expect(n).toMatch(/defaultLocale/);
  });

  it("names the breadcrumb's root label as the one word that is not derived", () => {
    // NOT "breadcrumb ships hardcoded English": the trail IS derived and the
    // root label IS authorable. The hardcoded "Home" / "Product detail" in
    // html.go is the PRE-TRAIL branch, kept byte-for-byte so adding the trail
    // republished nobody's page differently. The real gap is narrower and real:
    // homeLabel defaults to English.
    const n = inertHint('breadcrumb');
    expect(n).toMatch(/homeLabel/);
    expect(n).toMatch(/derives its trail from the page/);
    expect(n).not.toMatch(/Product detail/);
  });

  it('says nothing about an element with no such trap', () => {
    expect(inertHint('heading')).toBeNull();
    expect(inertHint('flex-block')).toBeNull();
  });

  it('dedupes across a subtree, so one section does not carry three copies', () => {
    const hints = inertHintsFor(['flex-section', 'breadcrumb', 'heading', 'breadcrumb']);
    expect(hints.map((h) => h.type)).toEqual(['breadcrumb']);
  });

  it('keeps add order when a subtree carries two different ones', () => {
    const hints = inertHintsFor(['locale-switcher', 'text', 'breadcrumb']);
    expect(hints.map((h) => h.type)).toEqual(['locale-switcher', 'breadcrumb']);
  });
});
