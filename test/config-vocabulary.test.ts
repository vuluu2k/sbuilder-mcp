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

  // A FALLBACK IS CLAIMED ONLY WHERE THE SOURCE SAYS ONE, AND ONLY THE GO
  // `default:` ARM SAYS ONE. The editor's picker proves what an author may
  // CHOOSE and the platform's own `as const` declarations prove what the key
  // may HOLD; both are silent on what the renderer does with anything else, and
  // naming a fallback there would be the invention this table exists to remove.
  // So the rule is the READER, not a list of exceptions to it: a Go site
  // (`<file>.go:<func>`) carries a fallback unless it is open, and nothing else
  // ever does.
  //
  // THE READER IS NOT ALWAYS `readBy` ANY MORE, and that is the whole of the
  // clause below rather than a loosening of the rule. A schema declaration
  // SUPERSEDES a Go reading for a key — the list says which words mean
  // something, which a renderer's enumeration only under-reports — and the
  // renderer's `default:` arm survives underneath it, because nothing else can
  // say what an unknown word renders as. The two halves then come from two
  // places, so the entry carries `fallbackReadBy` naming the Go site it really
  // came from, and the rule holds against THAT: still a Go site, still never a
  // picker or a bare declaration, and `unknownWriteNote` credits the normalising
  // to it rather than to a list that normalises nothing.
  it('claims a fallback only where the source states one', () => {
    for (const [type, table] of Object.entries(ELEMENT_VALUES)) {
      for (const [key, v] of Object.entries(table)) {
        const where = `${type}.${key}`;
        const states = v.fallbackReadBy ?? v.readBy;
        // Set ONLY where it differs, so it can never be a second name for the
        // same source and can never appear without the fallback it explains.
        if (v.fallbackReadBy !== undefined) {
          expect(v.fallbackReadBy, where).not.toBe(v.readBy);
          expect(typeof v.fallback, where).toBe('string');
        }
        if (v.open) expect(v.fallback, where).toBeUndefined();
        else if (/\.go:/.test(states)) expect(typeof v.fallback, where).toBe('string');
        else expect(v.fallback, where).toBeUndefined();
        // A partial list is worse than none, so an empty one must never ship —
        // and a list of ONE is the shape a half-read source produces, so it is
        // refused too, by NAME rather than by loosening the rule.
        //
        // `filter-slider.filterSource` is the one legitimate singleton and it
        // is a singleton by DERIVATION, not by truncation: the element's own
        // meta says "Its SOURCE is fixed to `price`, and that is identity
        // rather than a setting … AND THEREFORE IT IS THE ONE FILTER THAT
        // CANNOT SORT", and codegen reads the ids whose `valueMode` is `range`
        // rather than copying the word, so a second range source would make it
        // two on the next run. Saying it here instead of relaxing the bound
        // keeps the guard for every other reader.
        expect(v.values.length, where).toBeGreaterThan(
          where === 'filter-slider.filterSource' ? 0 : 1,
        );
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

  // A GUARD IS NOT A VOCABULARY, AND THIS ONE SHIPPED ON npm AS IF IT WERE.
  //
  // `bgSceneColorRule` asks "does this source support custom colours" —
  // `case "effect", "gallery":` with an EMPTY arm, falling through to the code
  // after the switch, and a `default: return ""` that is an early exit
  // returning a CSS string. The Go reader's rule ("a `default:` arm proves
  // completeness") read that as a two-word vocabulary and published
  // `['', 'effect', 'gallery']` for a key that holds five values, calling
  // `spline` and `model` invalid on a live release.
  //
  // Both halves are pinned, because either alone would pass with the defect
  // half-fixed: the guard must not be the source, AND the list must be whole.
  it('reads the 3D background source from the declaration, never from the guard', () => {
    const v = vocabularyForWrite('flex-section', 'config', 'backgroundSceneSource')!;
    expect(v.readBy).not.toMatch(/bgSceneColorRule/);
    expect(v.values).toEqual(['', 'effect', 'gallery', 'model', 'spline']);
    // `''` is OFF — the seeded default every carrier stores — so a list built
    // from "which sources DRAW something" would call every unconfigured
    // section in the shop invalid.
    expect(unknownWriteNote('flex-section', 'config', 'backgroundSceneSource', '')).toBeNull();
    expect(unknownWriteNote('flex-section', 'config', 'backgroundSceneSource', 'spline')).toBeNull();
    const note = unknownWriteNote('flex-section', 'config', 'backgroundSceneSource', 'threejs')!;
    expect(note).toMatch(/"" \(unset\)/);
    expect(note).toMatch(/model/);
    // The guard states no fallback about this key, so none is claimed.
    expect(note).not.toMatch(/renders as that/);
  });

  // THE 3D FEATURE'S OTHER TEN KEYS WERE IN NO CATALOG AT ALL, because both
  // readers read an IMPLEMENTATION and this feature's lists live in the browser
  // island and in `as const` declarations. Every one is a NAME an agent cannot
  // author without the list.
  it('names every 3D vocabulary on both surfaces', () => {
    const bg = (key: string) => vocabularyForWrite('flex-section', 'config', key)!.values;
    expect(bg('backgroundSceneEffect')).toEqual(['aurora', 'gradient-mesh', 'particles', 'waves']);
    expect(bg('backgroundSceneGallery')).toContain('podium');
    expect(bg('backgroundSceneSpeed')).toEqual(['fast', 'normal', 'slow']);
    expect(bg('backgroundSceneIntensity')).toEqual(['normal', 'soft', 'strong']);
    expect(bg('backgroundSceneColors')).toEqual(['custom', 'theme']);
    // THE SAME KEY FAMILY UNDER SHORTER NAMES on the inline element, and in a
    // different NAMESPACE for two of them — the mapping is read off
    // `sceneKeys.ts` rather than guessed from the background spelling, which is
    // the mistake a name-mangling shortcut would make here.
    const inline = elementVocabularies('spline-scene');
    expect(inline.source.target).toBe('specials');
    expect(inline.source.values).toEqual(['effect', 'gallery', 'model', 'spline']);
    expect(inline.sceneGallery.target).toBe('specials');
    expect(inline.effect.values).toEqual(bg('backgroundSceneEffect'));
    expect(inline.speed.values).toEqual(bg('backgroundSceneSpeed'));
    expect(inline.intensity.values).toEqual(bg('backgroundSceneIntensity'));
    expect(inline.effectColors.values).toEqual(bg('backgroundSceneColors'));
    // The inline element's source list does NOT carry `''`: an unset `source`
    // there means Spline (back-compat), where on the layer it means OFF.
    expect(inline.source.values).not.toContain('');
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

  // THE STOREFRONT FILTER SURFACE — six elements, and the catalog named
  // between 0 and 5 of the thirteen legal sources on any of them. The miss is
  // silent and total: `getFilterSource` returns `undefined` without throwing,
  // `filtershared.go` writes the stored word into `data-filter-source`
  // verbatim, and the island hydrates owning a query parameter the server
  // answers for nobody — a filter control that narrows nothing.
  it('names every source a filter control may be pointed at', () => {
    const src = (type: string) => vocabularyForWrite(type, 'specials', 'filterSource')!;
    const facets = [
      'attribute',
      'availability',
      'blog_category',
      'brand',
      'category',
      'course_level',
      'course_tag',
      'custom',
      'price',
      'purchase_history',
      'search',
      'tag',
    ];
    for (const type of ['filter-checkbox', 'filter-color', 'filter-radio', 'filter-tag', 'select']) {
      // ASSERTED AS A PROPERTY, not as an exact array: a row plus two i18n keys
      // is the whole cost of a new source, and a test that goes red on every
      // addition teaches the next reader to update the list without looking.
      for (const id of facets) expect(src(type).values, type).toContain(id);
      // THE THIRTEENTH. `sort` is deliberately NOT in `FILTER_SOURCES` —
      // every consumer of that table would be wrong about it, since a sort
      // writes `s=` rather than `f.<source>=` — and it is still a value this
      // key legally holds: the config dialog's Sort | Filter tab writes it,
      // and `select` SEEDS it. A twelve-value list would declare that
      // element's own default invalid.
      expect(src(type).values, type).toContain('sort');
      expect(unknownWriteNote(type, 'specials', 'filterSource', 'sort')).toBeNull();
    }
    expect(src('select').values).toEqual(src('filter-checkbox').values);
    // The seeded default of each carrier is in its own list, by construction.
    expect(unknownWriteNote('filter-checkbox', 'specials', 'filterSource', 'category')).toBeNull();
    const note = unknownWriteNote('filter-tag', 'specials', 'filterSource', 'bestseller')!;
    expect(note).toMatch(/is not a value filter-tag's renderer knows/);
    expect(note).toMatch(/purchase_history/);
    // The registry proves what the platform HAS and is silent on what the
    // renderer does with anything else, so no fallback is invented.
    expect(note).not.toMatch(/renders as that/);
  });

  // THE SLIDER IS THE ONE FILTER THAT CANNOT SORT, and the one whose source is
  // identity rather than a setting — it has no config dialog to put a choice
  // in. Handing it the other five's thirteen would say a two-handle continuous
  // control can be pointed at a colour swatch axis.
  it('gives the slider only the sources it can express', () => {
    const v = vocabularyForWrite('filter-slider', 'specials', 'filterSource')!;
    expect(v.values).toEqual(['price']);
    expect(v.readBy).toMatch(/valueMode:"range"/);
    expect(unknownWriteNote('filter-slider', 'specials', 'filterSource', 'category')).toMatch(
      /price/,
    );
    // And the keys it does not SEED are keys it does not have: a slider has no
    // value list, so no match mode, no arity and no value mode.
    for (const k of ['filterMatch', 'filterArity', 'filterValueMode']) {
      expect(vocabularyForWrite('filter-slider', 'specials', k), k).toBeNull();
    }
  });

  // THE FOUR SIBLING KEYS, whose vocabularies are joined to the dialog's own
  // writes rather than derived from their names — nothing about `filterMatch`
  // produces the draft field `matchMode`.
  it('names the four keys the filter config dialog writes', () => {
    const v = (type: string, key: string) => vocabularyForWrite(type, 'specials', key)!;
    // `auto` and `navigate` are the two the platform grew on 2026-09-16: a
    // category filter that FOLLOWS the page it is on, and one whose rows LEAVE
    // for the category's own page instead of narrowing a list. Both are offered
    // by the dialog for the catalogue-tree sources only, and both reach this
    // table the way every other value does — read from the picker, not listed
    // here — so a third one arrives without anybody editing this file.
    expect(v('filter-checkbox', 'filterValueMode').values).toEqual(['all', 'auto', 'manual']);
    expect(v('filter-checkbox', 'filterMatch').values).toEqual(['all', 'any']);
    expect(v('filter-checkbox', 'filterBehavior').values).toEqual(['event', 'filter', 'navigate']);
    // `''` IS LOAD-BEARING AND THE DIALOG NEVER WRITES IT. It means "follow the
    // SHAPE" — a radio holds one value, everything else holds many — and it is
    // what all four option-list filters SEED, while `FilterConfig.arity`
    // resolves it away and names only the two an author picks. A list built
    // from the union alone would call every filter in every shop invalid,
    // which is the `backgroundSceneSource` defect one value smaller.
    expect(v('filter-checkbox', 'filterArity').values).toEqual(['', 'multi', 'single']);
    expect(unknownWriteNote('filter-checkbox', 'specials', 'filterArity', '')).toBeNull();
    // A SELECT HOLDS ONE VALUE BY CONSTRUCTION, so it seeds no arity and no
    // match mode and hears about neither; it does seed the behaviour.
    expect(vocabularyForWrite('select', 'specials', 'filterArity')).toBeNull();
    expect(vocabularyForWrite('select', 'specials', 'filterMatch')).toBeNull();
    // BUT IT HEARS ONLY TWO OF THE BEHAVIOUR'S THREE, and this line is the one
    // that caught the defect the day `navigate` landed. The key is seeded, so
    // the rule this table already applied — "a key an element does not SEED is
    // a key it does not have" — passed it through whole. The missing half is
    // that a VALUE no renderer reads is a value the element does not have
    // either: the four option-list filters draw a row per value and a row can
    // become an `<a href>`, while a select draws `<option>`, which no href can
    // live on. `dropdown/html.go` reads `"event"` and nothing else, so a select
    // set to navigate publishes an ordinary dropdown and the setting changes
    // nothing — an agent could pick it, the write would be accepted, and the
    // page would look exactly as it did before.
    //
    // DERIVED, not excluded here: `readNavigableFilters` takes the set from the
    // `nodes.Register*(… filtershared.WriteHTML …)` calls, the only navigate
    // branch in the tree. Mutating ONE of those registrations away from
    // filtershared moves that element and no other (measured 2026-09-16:
    // filter-tag lost the value, the other three kept it), which is what makes
    // the four assertions above this one the liveness anchor for this one —
    // every one of them is also satisfied by a reader that excluded everything.
    expect(v('select', 'filterBehavior').values).toEqual(['event', 'filter']);
    // THE NAME COLLISION THE JOIN AVOIDS: `sources.ts` exports a type called
    // `FilterValueMode` whose members are catalog | fixed | range | authored |
    // text — a property of the SOURCE, not the value of
    // `specials.filterValueMode`, whose seeded default is not one of them.
    for (const wrong of ['catalog', 'fixed', 'range', 'authored', 'text']) {
      expect(v('filter-checkbox', 'filterValueMode').values).not.toContain(wrong);
    }
    // A KEY WHOSE WRITE NAMES TWO DRAFT FIELDS SAYS NOTHING. `filterTargets` is
    // written as `draft.value.behavior === 'event' ? [] : draft.value.targets`,
    // and joining it to the first field it mentions would publish
    // `filter | event` as the legal values of a list of node ids.
    expect(vocabularyForWrite('filter-checkbox', 'specials', 'filterTargets')).toBeNull();
    // Neither does a field the dialog writes that is not a closed union.
    expect(vocabularyForWrite('filter-checkbox', 'specials', 'filterAxis')).toBeNull();
    expect(vocabularyForWrite('filter-checkbox', 'specials', 'customName')).toBeNull();
  });

  // It rides in the RESULT an agent already reads, not in a new tool or a new
  // argument — and the element the token budget measures is untouched, because
  // a filter element is not a repeater.
  it('reaches sb_traits_for without moving the budget', () => {
    const out = traitsFor('filter-checkbox') as {
      specials_values?: Record<string, { values: string[] }>;
    };
    expect(out.specials_values!.filterSource.values).toContain('sort');
    expect(out.specials_values!.filterArity.values).toContain('');
    expect(JSON.stringify(traitsFor('filter-checkbox')).length).toBeLessThan(16_000);
    expect(JSON.stringify(traitsFor('list-dataset')).length).toBeLessThan(16_000);
  });
});

/**
 * A DECLARATION OUTRANKS A RENDERER, and nothing but this test says so.
 *
 * `gen-catalog.ts` establishes the rule by the ORDER it runs its readers in —
 * Source A (Go) first, Source C (declarations) after, so the declaration
 * overwrites. That is correct and it is INVISIBLE: reordering two loops would
 * invert it with every test still green and the catalog quietly under-reporting.
 *
 * The platform's own owner states why, and the sentence is the whole reason
 * this test exists: "the schema is the vocabulary and `server/render` is only
 * ever an emitter of it. Anything in `render/nodes/*.go` that looks like it
 * enumerates a vocabulary is enumerating what it can DRAW, which is a SUBSET
 * and drifts on purpose — `gallery` and `model` each spent a wave as
 * declared-but-not-drawable."
 *
 * `backgroundSceneSource` is the case that proves it rather than an example
 * chosen to fit: 0.42.0 shipped it with three values read off a Go GUARD, and
 * the declared answer is five. It is asserted here by VALUE and by SOURCE,
 * because a list that happened to be right while being read from the renderer
 * would pass a values-only check and fail the next time the platform declared
 * something it had not drawn yet.
 */
describe('a declared vocabulary outranks the renderer that draws it', () => {
  it('backgroundSceneSource comes from the declaration, not from the Go', () => {
    const v = vocabularyForWrite('flex-section', 'config', 'backgroundSceneSource');
    expect(v).not.toBeNull();
    // The five the platform DECLARES. `''` is the OFF state and the seeded
    // default of every carrier, so a list without it calls every unconfigured
    // section invalid — the defect 0.42.0 shipped, one value smaller.
    expect(v!.values).toEqual(expect.arrayContaining(['', 'effect', 'gallery', 'model', 'spline']));
    // `model` and `spline` are exactly the two a renderer-derived list loses.
    expect(v!.readBy).not.toMatch(/\.go\b/);
    expect(v!.readBy).toMatch(/backgroundScene\.ts/);
  });

  it('no Go-sourced entry is contradicted by a declaration for the same key', () => {
    // The rule as a PROPERTY rather than one fixture: wherever a key has a
    // vocabulary at all, it must not be the renderer's copy if a declaration
    // was available. A declaration-sourced entry naming a `.go` file as its
    // origin is the inversion this test exists to catch.
    const goSourced: string[] = [];
    for (const [scope, table] of Object.entries(ELEMENT_VALUES)) {
      for (const [key, v] of Object.entries(table)) {
        if (/\.go\b/.test(v.readBy)) goSourced.push(`${scope}.${key}`);
      }
    }
    // A floor, not a ceiling: Go entries are legitimate where nothing declares
    // the key. What must never appear is a 3D or filter key among them, because
    // both of those surfaces DO declare and the declaration must have won.
    for (const id of goSourced) {
      expect(id, `${id} is read from the renderer though its surface declares`).not.toMatch(
        /backgroundScene|filterSource|filterBehavior|filterMatch|filterValueMode|filterArity/i,
      );
    }
  });
});

/**
 * THE READER THAT COSTS NOTHING FOR THE NEXT DECLARATION.
 *
 * The two Source C readers above are HAND-WRITTEN, one per feature, and the
 * platform declares faster than this repo writes readers: `schema/src` exports
 * 22 `as const` string lists and those two name FOUR of them. `form-calendar`
 * alone declares three and seeds a key against each, and `sb_traits_for
 * form-calendar` said nothing about any of them — a reader gap on this side,
 * not a declaration gap on theirs.
 *
 * `declaredVocab` scans for the shape and joins each list to the key it governs
 * on EVIDENCE. The join is the whole difficulty, and every assertion here pins
 * one of its four parts — as a PROPERTY where it can be, because the point of
 * generating the table is that it grows with the platform.
 */
describe('a declaration the schema makes reaches the key it governs', () => {
  // THE HEADLINE CASE. Three declarations in one file, three seeded keys, and
  // the catalog was silent on all three.
  it('names the calendar keys the platform declares', () => {
    const v = (key: string) => vocabularyForWrite('form-calendar', 'specials', key)!;
    expect(v('defaultMode').values).toEqual(['specific', 'today', 'unset']);
    expect(v('acceptedDates').values).toEqual(['all', 'future', 'past']);
    expect(v('picker').values).toEqual(['grid', 'native']);
    expect(vocabularyForWrite('form-date', 'specials', 'format')!.values).toContain('day-month-year');
    // The declaration is the source, so no fallback is invented: it proves what
    // the key may HOLD and is silent on what the renderer does with anything
    // else. Same rule the editor's picker gets.
    const note = unknownWriteNote('form-calendar', 'specials', 'picker', 'calendar')!;
    expect(note).toMatch(/DATE_PICKERS/);
    expect(note).toMatch(/grid, native/);
    expect(note).not.toMatch(/renders as that/);
    expect(unknownWriteNote('form-calendar', 'specials', 'picker', 'grid')).toBeNull();
  });

  // THE SECOND DECLARATION SHAPE, AND THE ONE THE `as const` SCAN COULD NOT
  // SEE. `OPTION_SOURCES: OptionSource[] = [OPTION_SOURCE.MANUAL, …]` spells its
  // members through an `as const` OBJECT, and `form-select`, `form-radio` and
  // `form-checkbox` all seed the key it governs. The platform declared it all
  // along; this catalog simply was not reading that shape.
  it('reads a typed array whose members are enum references', () => {
    for (const type of ['form-select', 'form-radio', 'form-checkbox']) {
      const v = vocabularyForWrite(type, 'config', 'optionSource')!;
      expect(v.values, type).toEqual(['article', 'category', 'manual', 'product']);
      expect(v.readBy, type).toMatch(/OPTION_SOURCES/);
    }
    // A MEMBER THAT CANNOT BE RESOLVED DROPS THE WHOLE LIST rather than
    // shortening it — a vocabulary missing a value tells an agent that a working
    // word is invalid. So a list of OBJECTS resolves to nothing and is turned
    // away whole, which is what keeps `FIELD_SKIN_KNOBS`, `STARTER_PRESETS` and
    // the `*_TARGET_FIELDS` set out with no name being special-cased. Pinned by
    // the values, because what must never appear is one of their members as a
    // legal VALUE of a key.
    for (const table of Object.values(ELEMENT_VALUES)) {
      for (const [key, v] of Object.entries(table)) {
        for (const word of ['fieldBorderColor', 'payCardBg', 'boundHtml', 'tabId']) {
          expect(v.values, key).not.toContain(word);
        }
      }
    }
    // `product-variant` IS NOT A SOURCE, and the platform's own note says that
    // is a decision rather than an oversight: a variant list belongs to one
    // product and a form field pins no product. A reader that widened the list
    // on its own would offer a feed with nothing to be a list of.
    expect(vocabularyForWrite('form-select', 'config', 'optionSource')!.values).not.toContain(
      'product-variant',
    );
  });

  // RULE 2b, MEASURED RATHER THAN ASSUMED. Letting a SHARED declaration join on
  // the seeded value ALONE produced 17 joins on this tree and every one was
  // wrong: `filterBehavior: "filter"` joined `HOVER_PRESET_STYLE_KEYS` (a list
  // of CSS PROPERTY names), `qr-code`'s `source: "text"` joined `SCHEME_ROLES`,
  // and `datasetSource: "product"` and `filterSource: "category"` both joined
  // `TRANSLATION_ENTITY_TYPES` — four of them over correct entries another
  // reader already publishes. An ordinary English word in an unrelated
  // subsystem's list is indistinguishable from a governing vocabulary, so a
  // shared list must ALSO be NAMED for the key (`OPTION_SOURCES` /
  // `optionSource`). That is a refusal and never a derivation: it can only
  // reject a value match the name contradicts, never invent a key.
  //
  // Pinned by the VALUES rather than by the reader, because what must never
  // happen is one of those lists reaching a key — however it got there.
  it('never hands a key another subsystem list', () => {
    const foreign = [
      'blogCategory', // TRANSLATION_ENTITY_TYPES
      'uiString',
      'mailString',
      'backgroundGradient', // SCHEME_ROLES
      'buttonBgGradient',
      'textDecoration', // HOVER_PRESET_STYLE_KEYS
      'boxShadow',
      'backgroundSceneColor1', // BACKGROUND_SCENE_RESPONSIVE_KEYS
      'backgroundSceneModelUrl', // BACKGROUND_SCENE_BASE_ONLY_KEYS
    ];
    for (const [type, table] of Object.entries(ELEMENT_VALUES)) {
      for (const [key, v] of Object.entries(table)) {
        for (const word of foreign) {
          expect(v.values, `${type}.${key}`).not.toContain(word);
        }
      }
    }
    // The live cases the wrong join produced, each still answered by the reader
    // that actually knows the key — or by nothing at all.
    expect(vocabularyForWrite('qr-code', 'specials', 'source')!.values.sort()).toEqual([
      'page',
      'text',
    ]);
    expect(vocabularyForWrite('list-dataset', 'config', 'datasetSource')).toBeNull();
    expect(vocabularyForWrite('form-text', 'specials', 'patternPreset')).toBeNull();
  });

  // RULES 3 AND 4, both of which keep a key SILENT rather than guessing.
  it('says nothing where two lists could answer, or where the seed proves nothing', () => {
    // `spline-scene` seeds speed:"normal" AND intensity:"normal", and
    // SCENE_SPEEDS and SCENE_INTENSITIES both carry `normal` — a coin flip
    // this reader refuses. Both keys are answered by `sceneVocab`, which reads
    // the editor's own key mapping instead of inferring from the seed.
    for (const key of ['speed', 'intensity']) {
      const v = vocabularyForWrite('spline-scene', 'config', key)!;
      expect(v.readBy, key).toMatch(/sceneKeys|SCENE_(SPEEDS|INTENSITIES)/);
    }
    // `''` is seeded by 119 elements on some key, so it discriminates nothing —
    // and `BACKGROUND_SCENE_SOURCES` carries it as a REAL value, which is the
    // shape that would attach a scene vocabulary to every empty URL and label.
    for (const key of ['modelUrl', 'posterUrl']) {
      expect(vocabularyForWrite('spline-scene', 'specials', key), key).toBeNull();
    }
  });

  // THE OVERLAP, AND THE ORDER THAT RESOLVES IT. `spline-scene.source` is
  // reachable by both the general reader (SCENE_SOURCES is local to that
  // element) and by `sceneVocab` (which reads the key mapping `sceneKeys.ts`
  // declares). The general reader runs FIRST so the read mapping outranks the
  // inferred one; the values are the same list either way, which is why the
  // catalog did not move when the general reader landed.
  it('leaves the hand-written readers the last word where they overlap', () => {
    const v = vocabularyForWrite('spline-scene', 'specials', 'source')!;
    expect(v.values).toEqual(['effect', 'gallery', 'model', 'spline']);
    expect(v.readBy).toMatch(/SCENE_SOURCES/);
    // Neither hand-written reader is subsumed: the general one reaches 1 of
    // sceneVocab's 12 vocabularies and 0 of filterVocab's 23, so both stay.
    expect(vocabularyForWrite('flex-section', 'config', 'backgroundSceneSource')).not.toBeNull();
    expect(vocabularyForWrite('filter-checkbox', 'specials', 'filterSource')).not.toBeNull();
  });
});

/**
 * SOURCE D — THE MAPPING THE PLATFORM DECLARES OUTRIGHT.
 *
 * Every reader above this one either INFERS which key a list governs (from the
 * seeded value, the declaration's name, its locality) or reads it off a surface
 * that WRITES the key. Both are exact where they reach and neither reaches
 * everything: a shared list whose name does not correspond to the key is
 * refused, and two lists that intersect at an element's seed are both dropped.
 *
 * `VOCAB` on an element's meta states the mapping — `'<namespace>.<key>': LIST`
 * against that meta's own `meta.type` — so there is no join to get wrong, and
 * the platform's own suite guards it four ways (the seed is a member, the
 * inspector row RENDERS from the list, every member is reachable, and it is the
 * right list by array identity).
 *
 * Asserted as REACH — this key is answered, by this declaration — rather than
 * as a snapshot of the table, for the reason the `collectionType` entry at the
 * top of this file records: these vocabularies are generated so they can grow,
 * and a test that goes red on every platform addition teaches the next reader
 * to update an array without looking at it.
 */
describe('the vocabularies a meta declares outright', () => {
  /**
   * `DRAWER_EDGES` is SHARED by two elements and is named for the idea rather
   * than for the key it governs, so the inferring reader refuses it by rule —
   * nothing turns `DRAWER_EDGES` into `direct`. Which edge the cart drawer
   * slides in from is not an exotic key, and it was unreachable through any
   * tool here until the declaration was read.
   */
  it('answers a key whose shared list is named for the idea, not for the key', () => {
    for (const type of ['cart-drawer', 'hamburger-menu']) {
      const v = vocabularyForWrite(type, 'config', 'direct');
      expect(v, type).not.toBeNull();
      for (const edge of ['left', 'right', 'top', 'bottom']) expect(v!.values, type).toContain(edge);
      expect(v!.readBy, type).toMatch(/DRAWER_EDGES/);
      expect(v!.readBy, type).toMatch(/VOCAB/);
    }
  });

  /**
   * `tab` carries TAB_ALIGNS and TAB_POSITIONS, which intersect at `left`, so
   * the seed proves nothing about which list governs `tabAlign` and the
   * inferring reader drops both candidates. The platform's own guard names this
   * exact pair as why it added an identity check.
   *
   * The two must stay DISTINCT: `tabAlign` has no `top`/`bottom` and
   * `tabPosition` has no `center`, so answering one with the other's list would
   * tell an agent a working word is invalid and an invalid one works.
   */
  it('separates two lists on one element that intersect at each other seeds', () => {
    const align = vocabularyForWrite('tab', 'config', 'tabAlign')!;
    const position = vocabularyForWrite('tab', 'config', 'tabPosition')!;
    expect(align.values).toContain('center');
    expect(align.values).not.toContain('top');
    expect(position.values).toContain('top');
    expect(position.values).not.toContain('center');
    expect(align.readBy).toMatch(/TAB_ALIGNS/);
  });

  /**
   * THE SKIP THAT KEEPS THE TABLE HONEST RATHER THAN LARGE. The three carriers
   * of the background-scene layer declare its keys in their own `VOCAB`, and
   * `sceneVocab` already publishes them at `*`, which `vocabularyForWrite`
   * falls through to for every element. Twelve identical element-scoped copies
   * would answer nothing the table did not already answer.
   *
   * Asserted through the CONSUMER: the key is still answered for a carrier, and
   * the answer is the shared one.
   */
  it('does not re-state per element what is already answered for every element', () => {
    expect(vocabularyForWrite('flex-section', 'config', 'backgroundSceneSource')).not.toBeNull();
    expect(ELEMENT_VALUES['flex-section']?.backgroundSceneSource).toBeUndefined();
    expect(Object.values(ELEMENT_VALUES['*'] ?? {}).map((s) => s.writeKey)).toContain(
      'backgroundSceneSource',
    );
  });
});

/**
 * A DECLARATION OUTRANKS A RENDERER ON THE VALUES AND ON NOTHING ELSE.
 *
 * `values` and `fallback`/`open` answer two different questions. A schema list
 * says which words MEAN something; only the renderer can say what happens to a
 * word OUTSIDE the list. So when a declaration supersedes a Go reading, the
 * renderer's half has to survive — a plain overwrite threw away a fact the
 * winning source never had.
 *
 * MEASURED, NOT ANTICIPATED: `tab.tabPosition` carried `fallback: "top"` from
 * `nodes/tab/html.go` until the platform moved the list into `TAB_POSITIONS`,
 * and nothing went red — the entry stayed correct and got less informative,
 * which is how this accumulates while the platform keeps migrating vocabularies
 * out of its renderers.
 */
describe('what the renderer knows and a declaration does not', () => {
  it('keeps the fallback when a declaration takes over the values', () => {
    const v = vocabularyForWrite('tab', 'config', 'tabPosition')!;
    // The declaration won the values...
    expect(v.readBy).toMatch(/TAB_POSITIONS/);
    // ...and the renderer's answer to "what does an unknown word render as"
    // survived it, credited to the renderer rather than to the list.
    expect(v.fallback).toBe('top');
    expect(v.fallbackReadBy).toMatch(/\.go:/);
    const note = unknownWriteNote('tab', 'config', 'tabPosition', 'start')!;
    expect(note).toMatch(/normalises anything unrecognised to "top"/);
    expect(note).toMatch(/\.go:/);
    expect(note).not.toMatch(/TAB_POSITIONS normalises/);
  });

  /**
   * `open` IS THE HALF THAT WOULD COST MORE. Dropping a fallback costs a
   * sentence; dropping `open` makes the note report a CORRECT value as a
   * mistake — `mediaImageRatio: "4 / 5"` really is handed straight to CSS — and
   * sends a caller to "fix" a working page. Nothing declares that key today, so
   * this pins the guard before the first declaration that would spring it.
   */
  it('stays silent on an open vocabulary whatever declares its named values', () => {
    expect(vocabularyForWrite('media-dataset', 'config', 'mediaImageRatio')!.open).toBe(true);
    expect(unknownWriteNote('media-dataset', 'config', 'mediaImageRatio', '4 / 5')).toBeNull();
  });

  /**
   * The carry is CONDITIONAL, and this is the property that makes it safe: a
   * fallback the declared list no longer contains would mean the Go reading has
   * gone stale, and naming it would tell an agent a value the platform says is
   * not one. Held over the whole table rather than over one entry.
   */
  it('never names a fallback outside its own list', () => {
    for (const [scope, table] of Object.entries(ELEMENT_VALUES)) {
      for (const [key, v] of Object.entries(table)) {
        if (v.fallback === undefined) continue;
        expect(v.values, `${scope}.${key}`).toContain(v.fallback);
      }
    }
  });
});
