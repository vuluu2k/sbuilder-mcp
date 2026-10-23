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
 * or `record.id` — the row's own record id (recordContext.ts).
 */
export const RECORD_SOURCE = /^record\.(?:id|(?:html\.|money\.)?fld_[0-9a-f]{16})$/;

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
  const ok = typeof fid === 'string' && RECORD_FIELD_ID.test(fid);
  const html = type === 'text-dataset' && config.recordFieldType === 'richtext';
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
export function recordFieldProblem(source: string, scope: Array<{ collectionId: string; fields: RecordFieldRow[] }>): string | undefined {
  if (!scope.length) {
    return `"${source}" sits in no record-list row — only a list-dataset with datasetSource "record" (or a relation list inside one) supplies a record, so it would render its placeholder.`;
  }
  if (source === 'record.id') return undefined;
  const html = source.startsWith('record.html.');
  const money = source.startsWith('record.money.');
  const fid = source.slice(html ? 12 : money ? 13 : 7);
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
