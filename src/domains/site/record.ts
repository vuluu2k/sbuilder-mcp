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

/** A `record.*` source a context can supply: `record.<fid>` or `record.html.<fid>` (recordContext.ts). */
export const RECORD_SOURCE = /^record\.(?:html\.)?fld_[0-9a-f]{16}$/;

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
  return rows.map((row) => {
    const b = row as { id?: string };
    if (b.id === 'bind-image') return { ...b, source: ok ? `record.${fid}` : '' };
    if (b.id === 'bind-text') {
      return {
        ...b,
        source: ok ? `record.${html ? 'html.' : ''}${fid}` : '',
        field: html ? 'specials.boundHtml' : 'specials.boundText',
      };
    }
    return row;
  });
}
