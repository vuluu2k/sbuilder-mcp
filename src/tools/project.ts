/**
 * A whitelist projection over the platform's `{ <key>: [...], total }` lists.
 *
 * `sb_page_list`, `sb_templates` and `sb_media_list` returned the platform's
 * JSON verbatim — a section template carries its whole document, a page its
 * settings blob. The next call needs an id and a name. Unknown keys drop; a
 * response that is not the expected list shape is returned untouched, so a
 * platform change degrades to yesterday's behaviour rather than to an empty
 * list. Field names are the Go structs' json tags (page.go:163, media.go:245
 * plus library.go:339 `url`, sectiontemplate.go:129) — the OpenAPI document
 * does not describe list responses, so they were read off the source.
 */
export const PAGE_FIELDS = [
  'id', 'name', 'slug', 'path', 'isHomepage', 'type', 'status', 'updatedAt', 'publishedAt',
];
export const TEMPLATE_FIELDS = [
  'id', 'name', 'description', 'categoryIds', 'source', 'listed', 'updatedAt',
];
export const MEDIA_FIELDS = [
  'id', 'name', 'url', 'mediaType', 'contentType', 'sizeBytes', 'width', 'height', 'folderId', 'state',
];

export function projectList(raw: unknown, key: string, fields: string[]): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const list = (raw as Record<string, unknown>)[key];
  const isItem = (it: unknown) => !!it && typeof it === 'object' && !Array.isArray(it);
  if (!Array.isArray(list) || !list.every(isItem)) return raw;
  const items = (list as Array<Record<string, unknown>>).map((it) => {
    const o: Record<string, unknown> = {};
    for (const f of fields) if (it[f] !== undefined) o[f] = it[f];
    return o;
  });
  const total = (raw as Record<string, unknown>).total;
  return { [key]: items, ...(total !== undefined ? { total } : {}) };
}
