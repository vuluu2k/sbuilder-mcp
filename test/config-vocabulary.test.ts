import { describe, it, expect } from 'vitest';
import {
  elementVocabularies,
  unknownValueNote,
  unknownWriteNote,
  vocabulariesForWrites,
  vocabularyFor,
  vocabularyForWrite,
  vocabularyKeys,
} from '../src/domains/site/vocabulary.js';
import { ELEMENT_VALUES } from '../src/catalog/elements.generated.js';
import { traitsFor } from '../src/catalog/element-search.js';

/**
 * Every trait in the platform's registry declares `schema: { type: 'string' }`,
 * so a control's legal values live in the Vue picker — a place no agent can
 * read. The guess fails SILENTLY, and the platform's own test pins it:
 * EffectiveCollectionType("bestseller") === "all_products".
 */
describe('what a config key is allowed to hold', () => {
  it('reads the renderer vocabulary, including the values with no picker entry', () => {
    const v = vocabularyFor('collectionType')!;
    // ASSERTED AS A PROPERTY, NOT AS A LIST. This pinned the exact five values
    // and went red the day the platform added a sixth (`page_collection`) —
    // which is noise, not a finding: the vocabulary is GENERATED precisely so it
    // can grow with the renderer, and a test that fails on every addition
    // teaches the next reader to update the array without looking at it.
    //
    // What is worth holding is what the entry was written for: this table
    // recovers values that exist in the renderer and in NO picker, so an agent
    // can name them at all. `slot` (curated shelves) and `featured` were
    // unreachable through any tool before it.
    for (const must of ['all_products', 'collection', 'featured', 'related', 'slot']) {
      expect(v.values).toContain(must);
    }
    expect(v.values).toEqual([...v.values].sort());
    expect(v.fallback).toBe('all_products');
    expect(v.readBy).toBe('EffectiveCollectionType');
    expect(vocabularyKeys().sort()).toEqual(
      ['articleSourceType', 'collectionListType', 'collectionType'].sort(),
    );
  });

  /**
   * THE VALUE THAT MAKES ONE TEMPLATE SERVE EVERY COLLECTION.
   *
   * `page_collection` renders the collection the PAGE IS — the one
   * `/collections/{slug}` named — so a single collection template is correct for
   * all of them. It arrived after the scoping work this repo already records
   * (where `all_products` on a collection template narrows itself), and it is
   * the explicit spelling of the same idea: reach for it when a repeater must
   * follow the URL rather than name a collection of its own.
   *
   * Pinned by NAME rather than by position, because the one thing that must not
   * happen is it quietly disappearing from the table: a repeater set to a value
   * the renderer no longer knows falls back to `all_products` and lists the
   * whole catalogue under whatever heading the author wrote, with no error.
   */
  it('carries the value that scopes a repeater to the page own collection', () => {
    expect(vocabularyFor('collectionType')!.values).toContain('page_collection');
  });

  // AN ALIAS IS NOT A MISTAKE. `category` is a working spelling of `collection`
  // that the picker never writes, so a document holding it is CORRECT — an agent
  // told otherwise would "fix" a working page.
  it('keeps the compatibility spelling the picker never writes', () => {
    expect(vocabularyFor('collectionType')!.aliases).toEqual({ category: 'collection' });
    expect(unknownValueNote('collectionType', 'category')).toBeNull();
  });

  it('says what a guess will actually render as', () => {
    const n = unknownValueNote('collectionType', 'bestseller')!;
    expect(n).toMatch(/EffectiveCollectionType/);
    expect(n).toMatch(/renders as "all_products"/);
    expect(n).toMatch(/slot/); // the values that do something are listed
  });

  it('is silent for a legal value, an unknown key, and a non-string', () => {
    expect(unknownValueNote('collectionType', 'related')).toBeNull();
    expect(unknownValueNote('gap', 'anything')).toBeNull();
    expect(unknownValueNote('collectionType', 42)).toBeNull();
  });

  // NOISE IN A RESULT AN AGENT READS BEFORE EVERY STYLING DECISION IS ITS OWN
  // KIND OF DILUTION — the vocabularies attach to the control that writes the
  // key, never wholesale.
  it('attaches a vocabulary only to the control that writes the key', () => {
    expect(Object.keys(vocabulariesForWrites(['collectionType', 'gap']))).toEqual([
      'collectionType',
    ]);
    expect(vocabulariesForWrites(['fontSize'])).toEqual({});
  });

  // THE KEYS THAT MOST NEED THIS ARE THE UNDECLARED ONES. `collectionType` is in
  // list-dataset's defaults AND its control list, and no TRAIT_WRITES entry
  // names it — so attaching per declared control reached none of them, which is
  // exactly how the first version of this was wrong.
  it('rides inside sb_traits_for rather than growing the tool list', () => {
    const out = traitsFor('list-dataset') as { config_values?: Record<string, unknown> };
    expect(out.config_values).toBeDefined();
    // `articleSourceType` joined the other two once the platform DECLARED it.
    // It was always normalised by Go and always had a vocabulary here — and the
    // element never listed the key, so the vocabulary reached nobody. That is
    // the shape this table exists for, caught on the element that owns all
    // three.
    // ASSERTED AS A PROPERTY, for the reason the first test in this file already
    // gives: this pinned exactly three keys and went red the day the element
    // gained a fourth vocabulary (`list_loading_mode`, from the editor's own
    // picker), which is the table growing as designed rather than a finding.
    for (const must of ['articleSourceType', 'collectionListType', 'collectionType']) {
      expect(Object.keys(out.config_values!)).toContain(must);
    }
    expect(JSON.stringify(out.config_values)).toMatch(/slot/);
  });

  it('leaves an element with no such key untouched', () => {
    const out = traitsFor('heading') as { config_values?: unknown };
    expect(out.config_values).toBeUndefined();
  });
});

/**
 * THE OTHER 75 STRING KEYS, AND WHY THE TABLE ABOVE COULD NOT SIMPLY GROW.
 *
 * `CONFIG_VALUES` is keyed by the config key and is right only because its three
 * names are globally unique. The rest are not, and each assertion here pins one
 * of the three findings that shaped the element-scoped table — as a PROPERTY,
 * never as a snapshot of today's count, because the whole point of generating it
 * is that it moves with the platform.
 */
describe('what a key is allowed to hold, scoped to the element', () => {
  // FINDING 1: NEVER DERIVE THE WRITE KEY FROM THE CONTROL NAME. The obvious
  // snake_case→camelCase guess was tested against all 13 joined controls and was
  // wrong for 11 — `divider_orientation` writes `config.orientation`, not
  // `dividerOrientation`, and a table built on the guess would attach eleven
  // vocabularies to keys nothing reads.
  it('takes the write key from the registry, never from the control name', () => {
    const v = elementVocabularies('divider').divider_orientation;
    expect(v.target).toBe('config');
    expect(v.writeKey).toBe('orientation');
    expect(v.values).toContain('horizontal');
    // The same table, reached the way `sb_set` reaches it: by namespace and key.
    expect(vocabularyForWrite('divider', 'config', 'orientation')?.values).toContain('vertical');
    expect(vocabularyForWrite('divider', 'config', 'dividerOrientation')).toBeNull();
  });

  // FINDING 2: TWO CONTROLS SHARE ONE WRITE KEY. `breadcrumb_source` and
  // `qr_source` both write `specials.source`, with different words — a
  // write-key-keyed table hands one element the other's vocabulary, which is the
  // exact silent-wrong-answer this catalog exists to prevent, arriving through
  // the thing meant to fix it.
  it('never lets two elements sharing a write key see each other vocabulary', () => {
    expect(vocabularyForWrite('breadcrumb', 'specials', 'source')!.values.sort()).toEqual([
      'auto',
      'manual',
    ]);
    expect(vocabularyForWrite('qr-code', 'specials', 'source')!.values.sort()).toEqual([
      'page',
      'text',
    ]);
    // And the general form, over the whole table: an entry is never reachable
    // from an element that does not own it.
    expect(vocabularyForWrite('heading', 'specials', 'source')).toBeNull();
  });

  // FINDING 3: AN EQUALITY-ONLY GO COMPARISON IS NOT PROOF OF COMPLETENESS.
  // `ConfigString(n, "mainImageSource", "first_variant") == "product_image"`
  // yields one value where the picker offers two, and `dataset-block`'s
  // `case "product", "category": return true` is a PREDICATE over a key with
  // many more legal values. Publishing either half-list calls a working value
  // invalid. `datasetSource` is the one to watch: it is read by a switch, in a
  // renderer, and is still absent because that switch proves nothing.
  it('publishes nothing from a source that does not prove completeness', () => {
    expect(vocabularyForWrite('dataset-block', 'config', 'datasetSource')).toBeNull();
    // The same key, read the other way: no element anywhere claims a
    // datasetSource vocabulary.
    for (const table of Object.values(ELEMENT_VALUES)) {
      for (const v of Object.values(table)) expect(v.writeKey).not.toBe('datasetSource');
    }
    // And where the editor's picker DOES cover the equality key, the picker's
    // complete list is what ships.
    expect(vocabularyForWrite('product-image-feature', 'config', 'mainImageSource')!.values).toEqual(
      ['first_variant', 'product_image'],
    );
  });

  // A CLOSED VOCABULARY NAMES ITS FALLBACK; AN OPEN ONE HAS NONE TO NAME.
  // `mediaRatioCss` ends `default: return mode`, so an unlisted value goes
  // straight to CSS and `mediaImageRatio: "4 / 5"` is CORRECT — reporting it
  // would send a caller to fix a working page, which is the cost this repo
  // already records for the `category` alias.
  it('says nothing about a value an open vocabulary passes through', () => {
    const v = elementVocabularies('media-dataset').mediaImageRatio;
    expect(v.open).toBe(true);
    expect(v.fallback).toBeUndefined();
    expect(unknownWriteNote('media-dataset', 'config', 'mediaImageRatio', '4 / 5')).toBeNull();
    // Its closed sibling on the same element does answer, and names what the
    // renderer will actually draw.
    const note = unknownWriteNote('media-dataset', 'config', 'layout', 'carousel')!;
    expect(note).toMatch(/renders as that/);
    expect(note).toMatch(/"bottom"/);
    expect(note).toMatch(/grid-2/);
  });

  // A FALLBACK IS CLAIMED ONLY WHERE THE SOURCE SAYS ONE. The editor's picker
  // proves what an author may CHOOSE and is silent on what the renderer does
  // with anything else; naming a fallback there would be the invention this
  // table exists to remove. Every Go-read vocabulary carries one, because the
  // `default:` arm IS that answer.
  it('claims a fallback only where the source states one', () => {
    for (const [type, table] of Object.entries(ELEMENT_VALUES)) {
      for (const [key, v] of Object.entries(table)) {
        const where = `${type}.${key}`;
        if (v.open) expect(v.fallback, where).toBeUndefined();
        else if (v.readBy.endsWith('(editor picker)')) expect(v.fallback, where).toBeUndefined();
        else expect(typeof v.fallback, where).toBe('string');
        // A partial list is worse than none, so an empty one must never ship.
        expect(v.values.length, where).toBeGreaterThan(1);
        expect(v.target === 'config' || v.target === 'specials', where).toBe(true);
      }
    }
  });

  // The picker's own list is silent on the renderer's fallback, so the note has
  // to say what it knows and stop rather than inventing the missing half.
  it('warns without a fallback when the picker is the only source', () => {
    const note = unknownWriteNote('cart-total', 'specials', 'part', 'grand_total')!;
    expect(note).toMatch(/is not a value cart-total's renderer knows/);
    expect(note).not.toMatch(/renders as/);
    expect(note).toMatch(/subtotal/);
    expect(unknownWriteNote('cart-total', 'specials', 'part', 'total')).toBeNull();
    expect(unknownWriteNote('cart-total', 'specials', 'part', 42)).toBeNull();
  });

  // A KEY A SHARED HELPER READS BELONGS TO WHICHEVER ELEMENTS STORE IT. The
  // platform's 3D section background is seeded by three elements and read by
  // `nodes/helpers.go`, so it has no element of its own to hang off — and
  // offering it on all 113 would be the dilution the token budget exists for.
  it('offers a shared-helper vocabulary only to the elements that seed the key', () => {
    expect(vocabularyForWrite('flex-section', 'config', 'backgroundSceneSource')!.values).toContain(
      'gallery',
    );
    const section = traitsFor('flex-section') as { config_values?: Record<string, unknown> };
    expect(Object.keys(section.config_values ?? {})).toContain('backgroundSceneSource');
    const heading = traitsFor('heading') as { config_values?: Record<string, unknown> };
    expect(Object.keys(heading.config_values ?? {})).not.toContain('backgroundSceneSource');
  });

  // A `specials` vocabulary needs its own home in the result: the field name is
  // the namespace, which is what lets every entry drop its own `target`.
  it('splits the result by the namespace the caller writes to', () => {
    const out = traitsFor('divider') as {
      config_values?: Record<string, { writeKey: string }>;
      specials_values?: Record<string, { writeKey: string }>;
    };
    expect(out.config_values!.divider_orientation.writeKey).toBe('orientation');
    expect(out.specials_values!.divider_type.writeKey).toBe('contentType');
    // `target` is dropped from every entry: the field it landed in IS the
    // namespace, and a key restated on each one is the dilution this result's
    // token budget has already caught twice. (`declared` carries its own
    // `target`, which is the trait registry's shape and not this table's.)
    expect(JSON.stringify(out.config_values)).not.toMatch(/"target"/);
    expect(JSON.stringify(out.specials_values)).not.toMatch(/"target"/);
  });
});
