import { describe, it, expect } from 'vitest';
import {
  entityFields,
  entityTypes,
  isNeverTranslated,
  neverTranslatedOn,
  translatableSpecials,
  translationCallSheet,
} from '../src/domains/site/translate.js';
import { TRANSLATION_SOURCE } from '../src/catalog/translations.generated.js';
import { traitsFor } from '../src/catalog/element-search.js';
import { describeOperation } from '../src/catalog/search.js';
import { API_OPERATIONS } from '../src/catalog/api.generated.js';

/**
 * A multi-language store was REACHABLE and UNSAFE. Every translations route is
 * in the catalog, so an agent could call them all and had no way to know which
 * fields are content — and the platform's registry is explicit that translating
 * the wrong one "does not degrade the page, it breaks the render".
 */
describe('what a translation may rewrite', () => {
  it('carries the platform classification, not an allow-list', () => {
    expect(TRANSLATION_SOURCE.pairs).toBeGreaterThan(100);
    // The NEVER half is what makes it safe: a positive-only list stays green
    // forever while new elements quietly ship untranslatable strings.
    expect(TRANSLATION_SOURCE.neverKeys).toBeGreaterThan(100);
  });

  // THE TRAP THIS EXISTS FOR. An icon's only string is a lucide id.
  it("says an icon has NO translatable string, and names the one that breaks it", () => {
    expect(translatableSpecials('icon')).toEqual([]);
    expect(isNeverTranslated('name')).toBe(true);
    expect(neverTranslatedOn('icon', ['name'])).toEqual(['name']);
  });

  it('says a heading has one, and that its tag is not it', () => {
    expect(translatableSpecials('heading')).toContain('text');
    expect(isNeverTranslated('htmlTag')).toBe(true);
    expect(neverTranslatedOn('heading', ['text', 'htmlTag'])).toEqual(['htmlTag']);
  });

  // An EMPTY answer is the complete answer, not an absence — reported so a
  // caller cannot read silence as "nobody has classified this yet".
  it('reports the empty case rather than omitting it', () => {
    const out = traitsFor('icon') as { translatable?: { specials: string[] } };
    expect(out.translatable).toBeDefined();
    expect(out.translatable!.specials).toEqual([]);
  });

  it('names the columns each entity allows, SEO included', () => {
    const product = entityFields('product')!.map((f) => f.key);
    expect(product).toContain('title');
    expect(product).toContain('seoTitle');
    expect(entityFields('nope')).toBeNull();
  });

  // `node` is in the type list and has NO column list on purpose: a node
  // translation is keyed by (node id, special). Recording the empty answer
  // would read as "nothing on a node is translatable", the opposite of true.
  it('keeps node in the type list while sending its vocabulary elsewhere', () => {
    expect(entityTypes()).toContain('node');
    expect(entityFields('node')).toBeNull();
    const sheet = translationCallSheet();
    expect(sheet.entity_types).toContain('node');
    expect(String(sheet.node_note)).toMatch(/sb_traits_for/);
    expect(String(sheet.node_note)).toMatch(/BREAKS the render/);
  });

  // It rides on the call sheet the agent is already reading when it decides
  // what to send — no new tool.
  it('attaches to a translations operation and to nothing else', () => {
    const tr = API_OPERATIONS.find((o) => /\/translations$/.test(o.path) && o.method === 'PUT')!;
    expect(describeOperation(tr).translation_fields).toBeDefined();
    const other = API_OPERATIONS.find((o) => /\/products$/.test(o.path) && o.method === 'POST')!;
    expect(describeOperation(other).translation_fields).toBeUndefined();
  });
});
