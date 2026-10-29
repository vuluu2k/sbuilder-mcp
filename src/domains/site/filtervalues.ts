import { request } from '../../transport/http.js';
import { siteToken } from '../../tools/credentialpick.js';
import type { ToolContext } from '../../tools/context.js';
import type { Patch } from '../../core/patch.js';

/**
 * A FILTER ADDED BY THIS SERVER RENDERED NOTHING. The Go renderer
 * (`render/nodes/filtershared` optionsOf) reads ONLY `specials.filterValues`;
 * the editor's FilterConfigDialog materializes those rows on SAVE from
 * `GET /api/sites/{siteId}/filter-facets`, and nothing here ever did — so every
 * filter sb_add made was an empty box, saved and published.
 *
 * This is the dialog's save for the `all` value mode: catalogue rows from the
 * facet read (category in tree order with depth and slug, brand, tag, one
 * attribute axis), the FIXED pairs from `schema/src/filters/sources.ts`, and
 * price rows from the author's `filterRanges` in the `<from>-<to>` grammar
 * `matchesRange` parses (measured live: `f.price=4500000000-7000000000` filters,
 * `..` returns nothing). A `sort` select gets the six product orders the editor's
 * "Sort control" preset seeds (editor/src/element/sortOptions.ts, render/filters
 * SortKeys; the vi labels are this server's) — without them it published an
 * empty panel (TTG, 2026-10-30). Not
 * when it aims at a record list, whose keys are `<fieldId>_asc|desc`. The
 * blog/course sources are not covered.
 */
export const FILTER_VALUE_TYPES = new Set(['filter-checkbox', 'filter-radio', 'filter-tag', 'filter-color', 'select']);

/** The keys whose change re-derives the rows on sb_set. */
export const RESOURCE_KEYS = ['filterSource', 'filterAxis', 'filterRanges'];

const CATALOG = new Set(['category', 'brand', 'tag', 'attribute']);

/** `fixedLabels` in schema/src/filters/sources.ts, per SITE language. */
const FIXED: Record<string, Array<[string, Record<string, string>]>> = {
  availability: [
    ['in_stock', { en: 'In stock', vi: 'Còn hàng' }],
    ['out_of_stock', { en: 'Out of stock', vi: 'Hết hàng' }],
  ],
  sort: [
    ['newest', { en: 'Newest', vi: 'Mới nhất' }],
    ['oldest', { en: 'Oldest', vi: 'Cũ nhất' }],
    ['price_asc', { en: 'Price: low to high', vi: 'Giá: thấp đến cao' }],
    ['price_desc', { en: 'Price: high to low', vi: 'Giá: cao đến thấp' }],
    ['name_asc', { en: 'Name: A-Z', vi: 'Tên: A-Z' }],
    ['name_desc', { en: 'Name: Z-A', vi: 'Tên: Z-A' }],
  ],
  purchase_history: [
    ['purchased', { en: 'Purchased', vi: 'Đã mua' }],
    ['not_purchased', { en: 'Not purchased', vi: 'Chưa mua' }],
  ],
};

interface FacetValue { value: string; label: string; parent?: string; slug?: string }
interface Facets {
  categories?: FacetValue[];
  brands?: FacetValue[];
  tags?: FacetValue[];
  attributes?: Array<{ name: string; values: FacetValue[] }>;
}
type Row = { value: string; label: string; enabled: boolean; color?: string; slug?: string; depth?: number };
type Specials = Record<string, unknown>;

/**
 * The node's source as the renderer reads it: a `select` with none publishes as
 * a sort (render/nodes/dropdown WireSource(n, "sort")).
 */
export function sourceOf(type: string, sp: Specials): string {
  if (typeof sp.filterSource === 'string' && sp.filterSource) return sp.filterSource;
  return type === 'select' ? 'sort' : '';
}

/**
 * Would the dialog's save write rows for this node? `force` = its source just
 * moved. `nodes` = the document, to leave a sort aimed at a record list alone.
 */
export function wantsRows(
  type: string,
  sp: Specials,
  force = false,
  nodes: Record<string, { data: { type: string }; config?: Record<string, unknown> }> = {},
): boolean {
  if (!FILTER_VALUE_TYPES.has(type)) return false;
  const mode = sp.filterValueMode ?? 'all';
  if (mode !== 'all' && mode !== '') return false;
  const source = sourceOf(type, sp);
  if (!source) return false;
  if (source === 'sort') {
    const targets = [
      ...(typeof sp.filterTarget === 'string' && sp.filterTarget ? [sp.filterTarget] : []),
      ...(Array.isArray(sp.filterTargets) ? (sp.filterTargets as unknown[]).map(String) : []),
    ];
    if (targets.some((t) => nodes[t]?.data.type === 'list-dataset' && nodes[t]?.config?.datasetSource === 'record')) return false;
  }
  return force || !Array.isArray(sp.filterValues) || sp.filterValues.length === 0;
}

/** Category facets in the dialog's order: depth-first under each parent, strays appended flat. */
function tree(cats: FacetValue[], flat: boolean): Row[] {
  const kids = new Map<string, FacetValue[]>();
  for (const c of cats) kids.set(c.parent ?? '', [...(kids.get(c.parent ?? '') ?? []), c]);
  const out: Row[] = [];
  const seen = new Set<string>();
  const walk = (parent: string, depth: number) => {
    for (const c of kids.get(parent) ?? []) {
      if (seen.has(c.value)) continue;
      seen.add(c.value);
      out.push({ value: c.value, label: c.label, enabled: true, ...(c.slug ? { slug: c.slug } : {}), ...(depth && !flat ? { depth } : {}) });
      walk(c.value, depth + 1);
    }
  };
  walk('', 0);
  for (const c of cats) if (!seen.has(c.value)) out.push({ value: c.value, label: c.label, enabled: true, ...(c.slug ? { slug: c.slug } : {}) });
  return out;
}

/** The rows for one node, or the reason there are none. */
export function filterRows(
  sp: Specials,
  facets: Facets | null,
  site: { locale?: string; currency?: string },
): { rows: Row[] } | { note: string } {
  const source = String(sp.filterSource);
  const lang = (site.locale || 'vi').split('-')[0].toLowerCase();
  let rows: Row[];
  if (FIXED[source]) {
    rows = FIXED[source].map(([value, l]) => ({ value, label: l[lang] ?? l.en, enabled: true }));
  } else if (source === 'price') {
    const ranges = Array.isArray(sp.filterRanges) ? (sp.filterRanges as Array<{ fromCents: number; toCents: number | null }>) : [];
    if (!ranges.length) {
      return { note: 'A price filter is a RANGE source: set specials.filterRanges [{fromCents, toCents|null}] (minor units — hundredths, VND too); its rows are derived from them.' };
    }
    const money = new Intl.NumberFormat(site.locale || 'vi', { style: 'currency', currency: site.currency || 'VND' });
    const fmt = (c: number) => money.format(c / 100);
    rows = ranges.map((r) => ({
      value: `${r.fromCents}-${r.toCents ?? ''}`,
      label: r.toCents == null ? `${fmt(r.fromCents)}+` : `${fmt(r.fromCents)} – ${fmt(r.toCents)}`,
      enabled: true,
    }));
  } else if (CATALOG.has(source)) {
    if (!facets) return { note: 'The filter-facets read failed, so no rows were written and the filter renders empty. Re-run sb_set specials {filterSource} once the platform answers.' };
    if (source === 'category') rows = tree(facets.categories ?? [], sp.filterHierarchy === 'flat');
    else if (source === 'attribute') {
      const axes = (facets.attributes ?? []).map((a) => a.name);
      const axis = (facets.attributes ?? []).find((a) => a.name === sp.filterAxis);
      if (!axis) return { note: `An attribute filter needs specials.filterAxis — one of: ${axes.join(', ') || '(the catalogue has no option axes)'}.` };
      rows = axis.values.map((v) => ({ value: v.value, label: v.label, enabled: true }));
    } else {
      rows = ((source === 'brand' ? facets.brands : facets.tags) ?? []).map((v) => ({ value: v.value, label: v.label, enabled: true }));
    }
    if (!rows.length) return { note: `The catalogue has no ${source} values yet, so the filter renders empty. Re-run sb_set specials {filterSource} after adding them.` };
  } else {
    return { note: `Rows for source "${source}" are not derived here; write specials.filterValues [{value,label,enabled}] yourself.` };
  }
  const excluded = new Set(Array.isArray(sp.filterExcluded) ? (sp.filterExcluded as string[]) : []);
  const colors = (sp.filterColors ?? {}) as Record<string, string>;
  return {
    rows: rows.map((r) => ({
      ...r,
      ...(excluded.has(r.value) ? { enabled: false } : {}),
      ...(colors[r.value] ? { color: colors[r.value] } : {}),
    })),
  };
}

/**
 * Fetch what the named filters need — facets for a catalogue source, settings
 * for a fixed or price one — and answer their `filterValues` patches. TOLERANT:
 * a failed read becomes a note, never a failed add.
 */
export async function filterPatches(
  ctx: ToolContext,
  siteId: string,
  targets: Array<{ id: string; specials: Specials }>,
): Promise<{ patches: Patch[]; report: Array<{ id: string; source: string; rows?: number; note?: string }> }> {
  const get = async (path: string) => {
    try {
      return (await request({ base: ctx.base, method: 'GET', path: `/api/sites/${encodeURIComponent(siteId)}${path}`, token: siteToken(ctx), fetchImpl: ctx.fetchImpl })) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const sources = targets.map((t) => String(t.specials.filterSource));
  const facets = sources.some((s) => CATALOG.has(s)) ? (((await get('/filter-facets'))?.facets as Facets | undefined) ?? null) : null;
  const settings = sources.some((s) => FIXED[s] || s === 'price')
    ? (((await get('/settings'))?.settings ?? {}) as { locale?: string; currency?: string })
    : {};
  const patches: Patch[] = [];
  const report = targets.map(({ id, specials }) => {
    const got = filterRows(specials, facets, settings);
    const source = String(specials.filterSource);
    if ('note' in got) return { id, source, note: got.note };
    patches.push({ op: 'set', path: ['nodes', id, 'specials', 'filterValues'], value: got.rows });
    return { id, source, rows: got.rows.length };
  });
  return { patches, report };
}
