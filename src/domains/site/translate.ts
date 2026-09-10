import {
  NEVER_TRANSLATED,
  TRANSLATABLE_ENTITY_FIELDS,
  TRANSLATABLE_SPECIALS,
  TRANSLATION_ENTITY_TYPES,
} from '../../catalog/translations.generated.js';

/**
 * WHICH CONTENT A TRANSLATION MAY REWRITE — AND WHICH BREAKS THE PAGE.
 *
 * A multi-language store was REACHABLE and UNSAFE. Every translations route is
 * in the catalog — read, write, auto-fill, the review queue — so an agent could
 * call them all and had no way to know which fields are content.
 *
 * The platform's registry says why that matters: the element registry declares
 * 117 `(element, special)` pairs across 66 keys, INTERLEAVED in one object —
 *
 *   text · label · alt · emptyText · searchPlaceholder            ← content
 *   htmlTag · videoId · filterSource · contentType · src · name   ← NOT
 *
 * — and translating one of the second group "does not degrade the page, it
 * breaks the render": `name` is a lucide icon id, `src` is a URL,
 * `filterSource` is a registry id the Go predicate switches on. An agent
 * walking a page document and translating every string it finds hits all three,
 * and the page it hands back renders wrong with nothing reporting why.
 *
 * A NEGATIVE ANSWER HERE IS INFORMATION, not an absence. `icon` has no
 * translatable specials at all, and that is the correct, complete answer.
 *
 * NO NEW TOOL: this rides inside `sb_traits_for`'s result and the call sheet
 * `sb_api_find` already prints for a translations operation.
 */

/** The specials a translation may rewrite on this element. Empty is an answer. */
export function translatableSpecials(elementType: string): string[] {
  return TRANSLATABLE_SPECIALS[elementType] ?? [];
}

/** Would translating this key break a render, whatever element it is on? */
export function isNeverTranslated(key: string): boolean {
  return NEVER_TRANSLATED.includes(key);
}

/**
 * The specials this element HAS that must never be translated.
 *
 * Named per element rather than handed over as the whole 156-key list, because
 * the answer a caller needs is about the node in front of it — and a list that
 * long, on every element, is the kind of weight that makes a result unreadable.
 */
export function neverTranslatedOn(elementType: string, ownKeys: readonly string[]): string[] {
  const ok = new Set(translatableSpecials(elementType));
  return ownKeys.filter((k) => !ok.has(k) && isNeverTranslated(k));
}

/** The columns a translation may rewrite on an entity, or null for an unknown one. */
export function entityFields(
  entityType: string,
): Array<{ key: string; html?: boolean; multiline?: boolean; list?: string }> | null {
  return TRANSLATABLE_ENTITY_FIELDS[entityType] ?? null;
}

export function entityTypes(): string[] {
  return TRANSLATION_ENTITY_TYPES;
}

/**
 * The vocabulary a translations operation needs, for its call sheet.
 *
 * The ENTITY FIELDS are the body of it; `node` is called out separately because
 * it is the one entity type with no column list — a node translation is keyed
 * by (node id, special), so its vocabulary is per element and lives in
 * `sb_traits_for`. Without that sentence the empty answer for `node` reads as
 * "nothing on a node is translatable", which is the opposite of true.
 */
export function translationCallSheet(): Record<string, unknown> {
  return {
    entity_types: TRANSLATION_ENTITY_TYPES,
    entity_fields: TRANSLATABLE_ENTITY_FIELDS,
    node_note:
      'entityType "node" has no column list because a node translation is keyed by (node id, ' +
      'specials key). Ask sb_traits_for <element> for `translatable` — it names the specials ' +
      'that element allows. Translating any OTHER special BREAKS the render rather than ' +
      'degrading it: `name` is a lucide icon id, `src` a URL, `filterSource` a registry id the ' +
      'renderer switches on. Never walk a document translating every string you find.',
  };
}
