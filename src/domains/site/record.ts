/**
 * COLLECTIONS RECORD LISTS (web_builder PR #117) — the one data axis whose
 * binding source is the merchant's own: a `list-dataset` with
 * `config.datasetSource: 'record'` repeats a collection's PUBLISHED records
 * (`pagerender/recordfeed.go`), and each tile names a FIELD ID in
 * `config.recordField`. Mirrored from the schema, never guessed; codegen runs
 * the platform's `datasetBindings` over RECORD_BINDING_PROBES and
 * test/record-list.test.ts holds `recordTileBindings` to every answer.
 */

/** `collections.NewID("fld")` — schema/src/elements/recordContext.ts:33. Anything else binds nothing. */
export const RECORD_FIELD_ID = /^fld_[0-9a-f]{16}$/;

/**
 * A `record.*` source a context can supply: `record.<fid>`, `record.html.<fid>`,
 * `record.money.<fid>` (a number/integer field formatted in the site's currency),
 * `record.id` — the row's own record id — or `record.url` — `/records/<id>`, emitted
 * only when the row's collection has a published record detail page (recordContext.ts),
 * or `record.ref.<refFid>.<fid>` / `record.money.ref.…` — a field of the record a
 * `reference` field names, one hop, never rich (contract §7.8).
 */
export const RECORD_SOURCE =
  /^record\.(?:id|url|(?:html\.|money\.)?fld_[0-9a-f]{16}|(?:money\.)?agg\.[a-z][a-zA-Z0-9_]{0,31}|(?:money\.)?ref\.fld_[0-9a-f]{16}\.fld_[0-9a-f]{16})$/;

/** recordContext.ts parseRecordRefAxis — `ref.<referenceFid>.<targetFid>`, else null. */
export function parseRecordRefAxis(axis: string): { ref: string; field: string } | null {
  const m = /^ref\.(fld_[0-9a-f]{16})\.(fld_[0-9a-f]{16})$/.exec(axis);
  return m ? { ref: m[1], field: m[2] } : null;
}

/** recordContext.ts RECORD_REF_TARGET_TYPES — what a `ref.<a>.<b>` tile may show. */
export const RECORD_REF_TARGET_TYPES = new Set(['text', 'select', 'url', 'date', 'number', 'integer', 'boolean', 'tags']);

/**
 * RECORD LINK PARAMETERS (contract §7.6, schema/src/elements/hrefParams.ts).
 * `specials.hrefParams: [{name, source}]` appends row values to a same-site
 * `specials.href`; every malformed entry is DROPPED at render, never repaired.
 */
export const HREF_PARAM_NAME = /^[a-z][a-z0-9_]{0,23}$/;
export const HREF_PARAM_SOURCE = /^record\.(?:id|url|fld_[0-9a-f]{16})$/;
export const HREF_PARAM_RESERVED = new Set(['lang', 's', 't', 'lesson']);
export const MAX_HREF_PARAMS = 8;

/** hrefParams.ts isSameSitePath — the only hrefs params are appended to. */
export function isSameSitePath(p: string): boolean {
  if (!p.startsWith('/') || p[1] === '/' || p[1] === '\\') return false;
  return ![...p].some((c) => c.charCodeAt(0) <= 0x20 || c.charCodeAt(0) === 0x7f || c === '\\');
}

/** Why entries of `hrefParams` would be dropped at render (hrefWithParams), in the renderer's own order. */
export function hrefParamProblems(raw: unknown): string[] {
  if (raw === undefined || (Array.isArray(raw) && !raw.length)) return [];
  if (!Array.isArray(raw)) return ['specials.hrefParams is not an array of { name, source }'];
  const out: string[] = [];
  if (raw.length > MAX_HREF_PARAMS) out.push(`only the first ${MAX_HREF_PARAMS} entries are read — ${raw.length - MAX_HREF_PARAMS} more are ignored`);
  const seen = new Set<string>();
  for (const item of raw.slice(0, MAX_HREF_PARAMS)) {
    const { name, source } = (item ?? {}) as Record<string, unknown>;
    if (typeof name !== 'string') { out.push('an entry has no string name'); continue; }
    if (seen.has(name)) { out.push(`"${name}" is named twice — only the first entry is read`); continue; }
    seen.add(name);
    if (!HREF_PARAM_NAME.test(name)) out.push(`name "${name}" is not ^[a-z][a-z0-9_]{0,23}$`);
    else if (HREF_PARAM_RESERVED.has(name)) out.push(`name "${name}" is reserved (lang, s, t, lesson are read by the platform)`);
    else if (typeof source !== 'string' || !HREF_PARAM_SOURCE.test(source))
      out.push(`"${name}"'s source "${String(source)}" is not record.id, record.url or record.fld_<16 hex>`);
  }
  return out;
}

/** An aggregate key — recordAggregates.ts RECORD_AGG_KEY. A tile names it as `agg.<key>`. */
export const RECORD_AGG_KEY = /^[a-z][a-zA-Z0-9_]{0,31}$/;
const RECORD_PARAM_NAME = /^[a-z][a-z0-9_]{0,23}$/;
const COLLECTION_ID = /^col_[0-9a-f]{16}$/;
export const recordAggKeyOf = (axis: string): string => {
  const key = axis.startsWith('agg.') ? axis.slice(4) : '';
  return RECORD_AGG_KEY.test(key) ? key : '';
};

export interface RecordAggregate {
  key: string;
  op: string;
  where: Array<{ param: string; per?: string }>;
  whenNone: string;
}

/**
 * `config.recordAggregates` read the way the platform does
 * (recordAggregates.ts readRecordAggregates): [] for none, null when MALFORMED —
 * the server then refuses the list and it publishes EMPTY.
 */
export function readRecordAggregates(raw: unknown): RecordAggregate[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 4) return null;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const seen = new Set<string>();
  const out: RecordAggregate[] = [];
  for (const a of raw as Record<string, unknown>[]) {
    if (!a || typeof a !== 'object') return null;
    const op = s(a.op);
    const field = s(a.recordField);
    const whenNone = a.whenNone == null || a.whenNone === '' ? 'hide' : s(a.whenNone);
    if (
      !RECORD_AGG_KEY.test(s(a.key)) ||
      seen.has(s(a.key)) ||
      !['min', 'max', 'count'].includes(op) ||
      !COLLECTION_ID.test(s(a.recordCollectionId)) ||
      !RECORD_FIELD_ID.test(s(a.recordRelationField)) ||
      (op === 'count' ? field !== '' : !RECORD_FIELD_ID.test(field)) ||
      !['hide', 'show'].includes(whenNone)
    ) {
      return null;
    }
    const where = a.where ?? [];
    if (!Array.isArray(where) || where.length > 4) return null;
    const conds: RecordAggregate['where'] = [];
    for (const c of where as Record<string, unknown>[]) {
      const per = s(c?.per);
      if (!c || !RECORD_FIELD_ID.test(s(c.recordField)) || c.op !== 'gte' || !RECORD_PARAM_NAME.test(s(c.param)) || (per !== '' && !RECORD_PARAM_NAME.test(per))) {
        return null;
      }
      conds.push({ param: s(c.param), ...(per ? { per } : {}) });
    }
    seen.add(s(a.key));
    out.push({ key: s(a.key), op, where: conds, whenNone });
  }
  return out;
}

/** The visitor params a list's aggregates read (`param.<name>` axes it accepts). */
export const recordAggregateParams = (aggs: RecordAggregate[]): Set<string> =>
  new Set(aggs.flatMap((a) => a.where.flatMap((c) => (c.per ? [c.param, c.per] : [c.param]))));

/** The field types `record.money.<fid>` formats — recordContext.ts RECORD_MONEY_FIELD_TYPES. */
export const RECORD_MONEY_TYPES = new Set(['number', 'integer']);

/** The only record source `specials.boundHtml` admits — schema/src/rawSinkBindings.ts:102. */
export const RECORD_HTML_SOURCE = /^record\.html\.fld_[0-9a-f]{16}$/;

/** The tile elements whose binding the record field drives (editor/src/element/recordList.ts TILE_FIELD_TYPES). */
export const RECORD_TILES = new Set(['text-dataset', 'collection-media']);

export const isRecordSource = (s: string): boolean => s.startsWith('record.');

/**
 * Rewrite a tile's generated `record|<kind>` row (which carries the right
 * `target` and the source `''` its empty default field gives) for the field it
 * actually names — datasetBindings.ts:147-160 `recordSource`, :517-530
 * (text-dataset: richtext → `record.html.<fid>` into boundHtml) and :747-752
 * (collection-media: always `record.<fid>`). An id not shaped like a field id
 * yields `''`, so the node keeps its placeholder rather than binding a guess.
 */
export function recordTileBindings(type: string, config: Record<string, unknown>, rows: unknown[]): unknown[] {
  if (!RECORD_TILES.has(type)) return rows;
  const fid = config.recordField;
  const html = type === 'text-dataset' && config.recordFieldType === 'richtext';
  // An aggregate (`agg.<key>`) is a number on the row — datasetBindings.ts recordSource.
  // A referenced record's field (`ref.<a>.<b>`) — one hop, never rich.
  const ok =
    typeof fid === 'string' &&
    (RECORD_FIELD_ID.test(fid) || (!html && (recordAggKeyOf(fid) !== '' || parseRecordRefAxis(fid) !== null)));
  // datasetBindings.ts isRecordMoney: a stale recordFormat on any other type is ignored.
  const money =
    type === 'text-dataset' && config.recordFormat === 'money' && RECORD_MONEY_TYPES.has(String(config.recordFieldType));
  return rows.map((row) => {
    const b = row as { id?: string };
    if (b.id === 'bind-image') return { ...b, source: ok ? `record.${fid}` : '' };
    if (b.id === 'bind-text') {
      return {
        ...b,
        source: ok ? `record.${html ? 'html.' : money ? 'money.' : ''}${fid}` : '',
        field: html ? 'specials.boundHtml' : 'specials.boundText',
      };
    }
    return row;
  });
}

/** One row of GET …/collections/{id}/fields, as much of it as a binding needs. */
export interface RecordFieldRow {
  id: string;
  key: string;
  type: string;
  /** The collection a `reference` field points at. */
  refCollectionId?: string;
}

type NodeAt = (id: string) => { data: { type: string; parent: string | null }; config?: Record<string, unknown> } | undefined;

/**
 * The collections a `record.*` binding on `id` can read, nearest first. The
 * NEAREST list-dataset is the row it reads (editor `owningList`); while that list
 * is a RELATION list the parent row is merged under it (list-dataset/html.go
 * relationRows), so the enclosing record list's fields resolve too. `[]` = no
 * record row anywhere above — the binding resolves to nothing.
 */
export function recordScope(nodeAt: NodeAt, id: string): string[] {
  const out: string[] = [];
  let cur = nodeAt(id)?.data.parent ?? null;
  while (cur) {
    const n = nodeAt(cur);
    if (!n) break;
    if (n.data.type === 'list-dataset') {
      if (n.config?.datasetSource !== 'record') break;
      out.push(String(n.config.recordCollectionId ?? ''));
      if (!String(n.config.recordRelationField ?? '')) break;
    }
    cur = n.data.parent;
  }
  return out;
}

/**
 * Why a `record.<fid>` / `record.html.<fid>` binding would render nothing, given
 * the fields of each collection in scope — or undefined when it resolves. The
 * stringification is recordContext.ts: gallery emits nothing yet, richtext only
 * under `record.html.`, every other type only under `record.`.
 */
export function recordFieldProblem(
  source: string,
  scope: Array<{ collectionId: string; fields: RecordFieldRow[] }>,
  /** The fields of each collection a scope `reference` field targets, by collection id (§7.8). */
  refFields: Record<string, RecordFieldRow[]> = {},
): string | undefined {
  if (!scope.length) {
    return `"${source}" sits in no record-list row and this is no record detail page — only a list-dataset with datasetSource "record" (or a relation list inside one), or a page of type "record" attached to a collection, supplies a record, so it would render its placeholder.`;
  }
  if (source === 'record.id' || source === 'record.url') return undefined;
  // An aggregate is checked against the list's recordAggregates (sb_review), not a field.
  if (/^record\.(?:money\.)?agg\./.test(source)) return undefined;
  const html = source.startsWith('record.html.');
  const money = source.startsWith('record.money.');
  const fid = source.slice(html ? 12 : money ? 13 : 7);
  const ref = parseRecordRefAxis(fid);
  if (ref) {
    const r = scope.flatMap((s) => s.fields).find((x) => x.id === ref.ref);
    if (!r || r.type !== 'reference') return `${ref.ref} is not a reference field of the collection(s) this row reads.`;
    const target = r.refCollectionId ?? '';
    const t = (refFields[target] ?? []).find((x) => x.id === ref.field);
    if (!t) return `${ref.field} is not a field of ${target || 'the referenced collection'} (what ${r.key} points at).`;
    if (!RECORD_REF_TARGET_TYPES.has(t.type)) return `${ref.field} (${t.key}) is ${t.type} — a referenced field shows only ${[...RECORD_REF_TARGET_TYPES].join(', ')}.`;
    if (money && !RECORD_MONEY_TYPES.has(t.type)) return `${ref.field} (${t.key}) is ${t.type} — record.money. formats only a number or integer field.`;
    return undefined;
  }
  const f = scope.flatMap((s) => s.fields).find((x) => x.id === fid);
  if (!f) {
    const avail = scope
      .map((s) => `${s.collectionId}: ${s.fields.map((x) => `${x.id} (${x.key}, ${x.type})`).join(', ') || 'no fields'}`)
      .join('; ');
    return `${fid} is not a field of the collection(s) this row reads — ${avail}.`;
  }
  if (f.type === 'gallery') return `${fid} (${f.key}) is a gallery field, which the renderers do not bind yet — it emits nothing.`;
  if (money && !RECORD_MONEY_TYPES.has(f.type)) return `${fid} (${f.key}) is ${f.type} — record.money. formats only a number or integer field.`;
  if (html && f.type !== 'richtext') return `${fid} (${f.key}) is ${f.type}, not richtext — bind it as "record.${fid}".`;
  if (!html && f.type === 'richtext') return `${fid} (${f.key}) is richtext — bind it as "record.html.${fid}" into specials.boundHtml.`;
  return undefined;
}
