import {
  CONFIG_FIELD_PREFIX,
  NEVER_TRANSLATED,
  TRANSLATABLE_CONFIG,
  TRANSLATABLE_FIELDS,
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
 * The vocabulary rides inside `sb_traits_for`'s result and the call sheet
 * `sb_api_find` prints for a translations operation; the page collector below
 * is what `sb_translate` runs.
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
      'specials key). sb_translate collects, writes and fills node rows for a whole page — ' +
      'prefer it over hand-built bodies. sb_traits_for <element> names the specials it allows. Translating any OTHER special BREAKS the render rather than ' +
      'degrading it: `name` is a lucide icon id, `src` a URL, `filterSource` a registry id the ' +
      'renderer switches on. Never walk a document translating every string you find.',
    // THE REVIEW GATE (web_builder c6184c085). The storefront, search, slug routing
    // and shopper mail read only rows whose source is "human". The key surface
    // defaults source to "machine" — deliberately, so an app cannot mislabel an
    // unread value as reviewed — so a translation written there is stored,
    // counted by /progress, and never SHOWN until a review call approves it.
    review_gate:
      'Only rows with source "human" are served — on the storefront, in search, in slug ' +
      'routing and in shopper mail. PUT /api/v1/translations defaults source to "machine": ' +
      'the row is stored and counted by GET /api/v1/translations/progress, and shown to ' +
      'nobody until POST /api/sites/{siteId}/translations/review {locale, entityType, ' +
      'entityId, field} or …/review/bulk approves it (session credential). Send ' +
      '"source": "human" only when a person read the text; the site-scoped PUT ' +
      '/api/sites/{siteId}/translations already defaults to "human".',
  };
}

// ---- The page collector `sb_translate` runs ---------------------------------

export type TrNode = { id?: string; data?: { type?: string }; specials?: Record<string, unknown>; config?: Record<string, unknown> };

/** One translatable string on a page, addressed the way the appliers read it. */
export interface PageEntry {
  entityId: string;
  field: string;
  text: string;
}

/**
 * The editor's source fingerprint (`editor/src/features/translations/sourceHash.ts`):
 * FNV-1a, 32-bit, hex padded to 8, over UTF-16 code units. Every writer must use
 * the same function, or every row reads OUTDATED.
 */
export function sourceHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * A MIRROR of the editor's `collectPageEntries` (pageFill.ts) — same rows, same
 * field grammar, same skips — because the appliers on both renderers only
 * address rows of that grammar. Base config for `config.<key>`; `when` gates a
 * field on a sibling special; lists expand per item (by base text, or by the
 * item's own id with nested `items` walked); only non-blank strings travel;
 * `machine` drops html fields, which a fill must leave to a human.
 */
export function collectPageEntries(nodes: Record<string, TrNode>, opts: { machine?: boolean } = {}): PageEntry[] {
  const out: PageEntry[] = [];
  const push = (id: string, field: string, text: unknown) => {
    if (typeof text === 'string' && text.trim() !== '') out.push({ entityId: id, field, text });
  };
  for (const [key, node] of Object.entries(nodes)) {
    const id = node.id ?? key;
    const type = node.data?.type ?? '';
    for (const f of TRANSLATABLE_CONFIG[type] ?? []) push(id, CONFIG_FIELD_PREFIX + f.key, node.config?.[f.key]);
    for (const f of TRANSLATABLE_FIELDS[type] ?? []) {
      if (f.when && node.specials?.[f.when.key] !== f.when.equals) continue;
      if (opts.machine && f.html) continue;
      const value = node.specials?.[f.key];
      if (!f.list) {
        push(id, f.key, value);
        continue;
      }
      if (!Array.isArray(value)) continue;
      if (f.list === 'strings' || f.list === 'labels') {
        for (const item of value) push(id, `${f.key}.${String(item)}`, item);
        continue;
      }
      if (typeof f.list !== 'object') continue; // 'attributes' is an entity list, never a node's
      const { itemIdKey, textKey } = f.list;
      const subs = Array.isArray(textKey) ? textKey : [textKey];
      const walk = (items: unknown[]): void => {
        for (const item of items) {
          if (typeof item !== 'object' || item === null) continue;
          const it = item as Record<string, unknown>;
          const itemId = it[itemIdKey];
          if (typeof itemId === 'string' && itemId !== '') {
            for (const sub of subs) push(id, `${f.key}.${itemId}.${sub}`, it[sub]);
          }
          if (Array.isArray(it.items)) walk(it.items);
        }
      };
      walk(value);
    }
  }
  return out;
}

/**
 * The source text a translation of (node, field) is made from, or why that
 * row cannot exist. A write is checked against the collector itself, so a
 * write can name exactly the rows the collector would produce and no other.
 */
export function translationField(
  nodes: Record<string, TrNode>,
  nodeId: string,
  field: string,
): { text: string } | { error: string } {
  const node = nodes[nodeId];
  if (!node) return { error: `no node ${nodeId} on this page` };
  const hit = collectPageEntries({ [nodeId]: node }).find((e) => e.field === field);
  if (hit) return { text: hit.text };
  const type = node.data?.type ?? '';
  const allowed = [
    ...(TRANSLATABLE_FIELDS[type] ?? []).map((f) => f.key),
    ...(TRANSLATABLE_CONFIG[type] ?? []).map((f) => CONFIG_FIELD_PREFIX + f.key),
  ];
  const base = field.startsWith(CONFIG_FIELD_PREFIX) ? field : field.split('.')[0];
  if (!allowed.includes(base)) {
    return { error: `${field} is not translatable on ${type} (allowed: ${allowed.join(', ') || 'none'})` };
  }
  return { error: `${nodeId}.${field}: no item by that address, its source is empty, or its condition is off` };
}

export type RowStatus = 'missing' | 'done' | 'outdated';

/** Join collected rows with the stored values and hashes, as the editor's panel does. */
export function rowStatus(
  rows: PageEntry[],
  byEntity: Record<string, Record<string, string>>,
  hashes: Record<string, Record<string, string>>,
): Array<PageEntry & { status: RowStatus; value?: string }> {
  return rows.map((r) => {
    const value = byEntity[r.entityId]?.[r.field];
    if (value === undefined || value === '') return { ...r, status: 'missing' as const };
    const stored = hashes[r.entityId]?.[r.field];
    // An unknown fingerprint is never outdated (editor isOutdated).
    return { ...r, value, status: stored && stored !== sourceHash(r.text) ? ('outdated' as const) : ('done' as const) };
  });
}
