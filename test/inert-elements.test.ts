import { describe, it, expect } from 'vitest';
import { inertHint, inertHintsFor, INERT_ON_ADD } from '../src/domains/site/inert.js';
import { ELEMENTS } from '../src/catalog/elements.generated.js';

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

  it("warns that a spline-scene is born pointing at SOMEBODY ELSE'S scene", () => {
    // The seed is not a placeholder — specials.sceneUrl defaults to a live
    // prod.spline.design link, so an unset one loads, moves, responds to the
    // mouse and publishes. It is the only entry in this table where the element
    // is not merely unfinished but is another party's work on the merchant's
    // domain, and it is the one a screenshot most convincingly endorses.
    const n = inertHint('spline-scene')!;
    expect(n).toMatch(/sceneUrl/);
    expect(n).toMatch(/scene\.splinecode/);
    expect(n).toMatch(/posterUrl/);
  });

  it('pins the seeded scene against the catalog, so a real default cannot go quiet', () => {
    // If the platform ever seeds an EMPTY sceneUrl, this hint becomes a lie in
    // the direction this repo keeps paying for — a warning about a trap that is
    // gone, steering a caller away from a working default.
    const seeded = ELEMENTS['spline-scene']?.defaults?.specials?.sceneUrl;
    expect(typeof seeded).toBe('string');
    expect(seeded).toMatch(/spline\.design/);
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

  // The audit that grew the table from 3 to 20. Every entry earns its place
  // by the file's own test: the first write succeeds completely, and the
  // element still does nothing useful until a second, nameable write happens.
  // A list with no products yet, or a field an author merely typed badly, is
  // NOT this — those are excluded on purpose (see the report for the full
  // pass/reject reasoning); every element below renders zero pixels, or a
  // control that visibly does nothing, with no error at any step.

  it('warns that a quickview panel renders through nothing until a list points at it', () => {
    const n = inertHint('quickview')!;
    expect(n).toMatch(/quickviewId/);
    expect(n).toMatch(/site/i);
  });

  it('warns that bundle-items renders nothing on a non-bundle product', () => {
    const n = inertHint('bundle-items')!;
    expect(n).toMatch(/bundle-kind/);
  });

  it('warns that a chat-widget is invisible without the app and a key', () => {
    const n = inertHint('chat-widget')!;
    expect(n).toMatch(/Chat app/);
    expect(n).toMatch(/API key/);
  });

  it('warns that a currency-switcher is inert on a single-currency store', () => {
    const n = inertHint('currency-switcher')!;
    expect(n).toMatch(/single-currency/);
  });

  it('warns that a theme-switcher can render and change nothing on screen', () => {
    const n = inertHint('theme-switcher')!;
    expect(n).toMatch(/dark/i);
    expect(n).toMatch(/changes nothing|change nothing/);
  });

  it('warns that a form-step-count is an empty box forever outside a step bar', () => {
    const n = inertHint('form-step-count')!;
    expect(n).toMatch(/form-step-nav/);
    expect(n).toMatch(/empty box forever/);
  });

  it('warns that a form-step-button does nothing when pressed outside a step bar', () => {
    const n = inertHint('form-step-button')!;
    expect(n).toMatch(/form-step-nav/);
    expect(n).toMatch(/does nothing/);
  });

  it('warns that order-receipt and a wrong placement look identical', () => {
    const n = inertHint('order-receipt')!;
    expect(n).toMatch(/completion page/);
    expect(n).toMatch(/signed grant/);
  });

  it('warns that payment-status needs a real payment, not a preview', () => {
    const n = inertHint('payment-status')!;
    expect(n).toMatch(/completion page/);
  });

  it('warns that points-card and points-prompt need the Loyalty app on', () => {
    expect(inertHint('points-card')).toMatch(/Loyalty app/);
    expect(inertHint('points-prompt')).toMatch(/Loyalty app/);
  });

  it('warns that a fresh list-empty or list-loading attaches to nothing', () => {
    expect(inertHint('list-empty')).toMatch(/emptyStateId/);
    expect(inertHint('list-loading')).toMatch(/loadingStateId/);
  });

  it('warns that rating-stars renders zero pixels, not an empty state, with no config fix', () => {
    const n = inertHint('rating-stars')!;
    expect(n).toMatch(/no published reviews/);
    expect(n).toMatch(/no config fix/i);
  });

  it('warns that accordion-content is accepted anywhere but only renders in an accordion', () => {
    const n = inertHint('accordion-content')!;
    expect(n).toMatch(/accordion/);
  });

  it('warns that a menu-drawer must be added as its hamburger-menu\'s own child', () => {
    const n = inertHint('menu-drawer')!;
    expect(n).toMatch(/hamburger-menu/);
  });

  it('warns that a menu-panel is wired from its menu entry, not the page tree', () => {
    const n = inertHint('menu-panel')!;
    expect(n).toMatch(/menu entry/);
  });

  it('has a non-empty note for every entry, and every key is a real catalog element', () => {
    // A typo'd key is a warning that can never fire, silently — nothing else
    // in this repo would catch it, since ELEMENTS is generated and this table
    // is hand-kept against it.
    for (const [type, hint] of Object.entries(INERT_ON_ADD)) {
      expect(ELEMENTS[type], `"${type}" is not a real element type`).toBeDefined();
      expect(hint.note.length, type).toBeGreaterThan(0);
    }
  });

  it('grew from 3 to 20 entries', () => {
    expect(Object.keys(INERT_ON_ADD).length).toBe(20);
  });
});
