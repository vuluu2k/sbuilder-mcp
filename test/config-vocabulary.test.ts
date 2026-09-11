import { describe, it, expect } from 'vitest';
import {
  unknownValueNote,
  vocabulariesForWrites,
  vocabularyFor,
  vocabularyKeys,
} from '../src/domains/site/vocabulary.js';
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
    expect(Object.keys(out.config_values!).sort()).toEqual(
      ['articleSourceType', 'collectionListType', 'collectionType'].sort(),
    );
    expect(JSON.stringify(out.config_values)).toMatch(/slot/);
  });

  it('leaves an element with no such key untouched', () => {
    const out = traitsFor('heading') as { config_values?: unknown };
    expect(out.config_values).toBeUndefined();
  });
});
