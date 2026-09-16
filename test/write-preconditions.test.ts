import { describe, it, expect } from 'vitest';
import {
  preconditionNotes,
  unsupportedSettingNote,
  unknownWriteNote,
} from '../src/domains/site/vocabulary.js';
import { WRITE_PRECONDITIONS } from '../src/catalog/elements.generated.js';

/**
 * THE WARNING A PER-KEY VOCABULARY CANNOT GIVE.
 *
 * Every other table in this catalog publishes ONE key's legal values, so a
 * write whose values are each legal passed in silence — and several
 * combinations are legal apart and meaningless together. The pair below stored,
 * saved, published and rendered an EMPTY filter with no error at any layer, and
 * a caller had no way to see it coming.
 */
describe('a combination that is legal key by key and does nothing', () => {
  it('still says nothing about each value on its own', () => {
    // THE PREMISE, asserted rather than assumed: if the per-key table had
    // caught either of these, the whole mechanism below would be redundant and
    // these tests would be green for the wrong reason.
    expect(unknownWriteNote('filter-checkbox', 'specials', 'filterValueMode', 'auto')).toBeNull();
    expect(
      unknownWriteNote('filter-checkbox', 'specials', 'filterSource', 'blog_category'),
    ).toBeNull();
  });

  it('names the pair, what it renders as, and which key to change', () => {
    const [note, ...rest] = preconditionNotes('filter-checkbox', {
      filterSource: 'blog_category',
      filterValueMode: 'auto',
    });
    expect(rest, 'one root cause, not a cascade').toEqual([]);
    expect(note).toContain('filterValueMode');
    expect(note).toContain('filterSource');
    expect(note).toContain('blog_category');
    // The CONSEQUENCE, not a verdict: the platform stores what it is given.
    expect(note).toContain('renders nothing');
    expect(note, 'never a refusal').not.toMatch(/invalid|not allowed|rejected/i);
  });

  it('says nothing about a node that holds together', () => {
    // THE LIVENESS ANCHOR for every assertion in this file. A function that
    // warned about everything would satisfy each "contains" above, and this is
    // the shape a caller meets most often.
    expect(
      preconditionNotes('filter-checkbox', {
        filterSource: 'category',
        filterValueMode: 'auto',
        filterBehavior: 'navigate',
        filterShowAll: true,
      }),
    ).toEqual([]);
  });

  it('reads an ABSENT neighbour as unset rather than as null', () => {
    // A caller who never wrote the key would otherwise go looking for a null
    // they did not write. What applies there is the platform's own default,
    // which is a different thing to fix than a wrong value.
    const [note] = preconditionNotes('filter-checkbox', {
      filterValueMode: 'auto',
      filterSource: 'category',
      filterShowAll: true,
    });
    expect(note).toContain('filterBehavior is not set');
    expect(note).not.toContain('null');
  });

  it('reads an ABSENT neighbour as the state the renderers infer', () => {
    // THE CASE THAT SEPARATED THE TWO COPIES. `holdsClause` here mirrors
    // `holds` in schema/src/filters/preconditions.ts, and within an hour of
    // being written this one lacked the absent→null mapping and called a
    // perfectly good tag filter broken. A FALSE POSITIVE is worse than the
    // silence this mechanism replaced: a caller warned about correct work stops
    // reading the warnings.
    //
    // `filterBehavior` unset is not "event", so a match mode applies exactly as
    // it would on a stored "filter".
    expect(
      preconditionNotes('filter-checkbox', { filterSource: 'tag', filterMatch: 'all' }),
    ).toEqual([]);
    // …and one key apart, the case it must still catch.
    expect(
      preconditionNotes('filter-checkbox', {
        filterSource: 'tag',
        filterMatch: 'all',
        filterBehavior: 'event',
      }),
    ).toHaveLength(1);
  });

  it('catches a match mode on a source where a product holds ONE value', () => {
    // The config dialog hides this row where it is meaningless, so an AUTHOR
    // cannot reach it — which is why it belongs in the table. This catalog
    // publishes `all | any` for every filter element and says nothing about
    // where the mode means something, so the surface with no picker to hide is
    // the one that could write it.
    const [note] = preconditionNotes('filter-checkbox', {
      filterSource: 'brand',
      filterMatch: 'all',
    });
    expect(note).toContain('filterMatch');
    expect(note).toContain('brand');
    expect(note).toContain('OR');
  });

  it('spells an accepted "not set" in words, never as the null token', () => {
    // THE CLAUSE HAS TO BE ONE THAT IS ACTUALLY REPORTED. The brand case above
    // reports the SOURCE clause, which carries no null, so asserting there
    // proved nothing — it stayed green with the wording reverted. This case
    // reports the BEHAVIOUR clause, whose accepted states include "not set",
    // and "needs … or null" would send a caller looking for a null to write.
    const [note] = preconditionNotes('filter-checkbox', {
      filterSource: 'tag',
      filterMatch: 'all',
      filterBehavior: 'event',
    });
    expect(note).toContain('filterBehavior');
    expect(note).toContain('left unset');
    expect(note).not.toContain('null');
  });

  it('tells a shape that will never read the setting from one missing a neighbour', () => {
    const shape = unsupportedSettingNote('select', 'filterValueMode', 'auto');
    expect(shape).toContain('not a setting select reads');
    expect(shape).toContain('filter-checkbox');
    // NOT the neighbour-missing sentence. Borrowing it would hand a caller the
    // wrong diagnosis — fix a sibling key on a shape that will never read this
    // one however the rest of the node is arranged.
    expect(shape).not.toContain('PRODUCT collection');
    // …and a shape that DOES read it gets nothing, which is what makes the
    // above a statement about the shape.
    expect(unsupportedSettingNote('filter-checkbox', 'filterValueMode', 'auto')).toBeNull();
  });

  it('carries the platform’s own declarations rather than a list of its own', () => {
    // The table is imported from the schema, so a precondition added there
    // arrives here on the next codegen with no edit in this repo. The count is
    // the liveness anchor: an empty table satisfies every "no note" assertion
    // in this file.
    expect(WRITE_PRECONDITIONS.length).toBeGreaterThan(0);
    for (const p of WRITE_PRECONDITIONS) {
      expect(p.types.length, `${p.key} honoured by nothing`).toBeGreaterThan(0);
      expect(p.requires.length, `${p.key} requires nothing`).toBeGreaterThan(0);
      expect(p.otherwise, `${p.key} does not say what the page does`).not.toBe('');
    }
  });
});
