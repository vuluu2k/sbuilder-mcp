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
    // `slot` (curated shelves) and `featured` were unnameable through any tool.
    expect(v.values).toEqual(['all_products', 'collection', 'featured', 'related', 'slot']);
    expect(v.fallback).toBe('all_products');
    expect(v.readBy).toBe('EffectiveCollectionType');
    expect(vocabularyKeys().sort()).toEqual(
      ['articleSourceType', 'collectionListType', 'collectionType'].sort(),
    );
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
