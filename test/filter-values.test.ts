import { describe, it, expect } from 'vitest';
import { fakePlatform } from './helpers/platform.js';

/**
 * A FILTER ADDED WITH sb_add RENDERED NOTHING. The Go renderer
 * (render/nodes/filtershared optionsOf) reads ONLY `specials.filterValues`; the
 * editor's FilterConfigDialog materializes those rows on save from
 * `GET /api/sites/{siteId}/filter-facets`. sb_add now does the same.
 *
 * The facet fixture is storefeed's FacetSet wire shape (editor
 * features/filters/types.ts mirrors it): categories carry parent + slug.
 */
const FACETS = {
  facets: {
    categories: [
      { value: 'cat_laptop', label: 'Laptop', count: 5, slug: 'laptop' },
      { value: 'cat_gaming', label: 'Laptop gaming', count: 2, slug: 'laptop-gaming', parent: 'cat_laptop' },
      { value: 'cat_pc', label: 'PC', count: 3, slug: 'pc' },
    ],
    brands: [
      { value: 'asus', label: 'ASUS', count: 4 },
      { value: 'dell', label: 'Dell', count: 2 },
    ],
    tags: [{ value: 'sale', label: 'Sale', count: 1 }],
    attributes: [
      { name: 'RAM', values: [{ value: 'RAM:16GB', label: '16GB', count: 3 }, { value: 'RAM:32GB', label: '32GB', count: 2 }] },
    ],
    inStock: 7,
    outOfStock: 1,
    priceMinCents: 1_500_000_000,
    priceMaxCents: 9_000_000_000,
  },
};

type Doc = { nodes: Record<string, { data: { type: string }; specials?: Record<string, unknown> }> };

async function setup(opts: { facets?: unknown; facetsFail?: boolean; locale?: string } = {}) {
  let facetReads = 0;
  const p = fakePlatform((method, path) => {
    if (method === 'GET' && path === '/api/sites/s1/filter-facets') {
      facetReads++;
      if (opts.facetsFail) throw new Error('facets down');
      return opts.facets ?? FACETS;
    }
    if (method === 'GET' && path === '/api/sites/s1/settings') {
      return { settings: { locale: opts.locale ?? 'vi', currency: 'VND' } };
    }
    return undefined;
  });
  const { call: raw, close } = await p.connect();
  const call = raw;
  await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
  const doc = () => p.pages.get('pg_1')!.document as Doc;
  const added = async (spec: Record<string, unknown>) => {
    const out = await call('sb_add', {
      parent_id: 'ROOT',
      spec: { type: 'flex-section', children: [spec] },
      dry_run: false,
    });
    const node = Object.values(doc().nodes).find((n) => n.data.type === spec.type)!;
    return { out, node };
  };
  return { call, close, doc, added, reads: () => facetReads };
}

describe('sb_add materializes a filter\'s rows', () => {
  it('category (the default): tree order, depth and slug, as the dialog saves them', async () => {
    const { added, close } = await setup();
    const { out, node } = await added({ type: 'filter-checkbox' });
    expect(node.specials!.filterValues).toEqual([
      { value: 'cat_laptop', label: 'Laptop', enabled: true, slug: 'laptop' },
      { value: 'cat_gaming', label: 'Laptop gaming', enabled: true, slug: 'laptop-gaming', depth: 1 },
      { value: 'cat_pc', label: 'PC', enabled: true, slug: 'pc' },
    ]);
    expect(out.json.filters).toEqual([{ id: expect.any(String), source: 'category', rows: 3 }]);
    await close();
  });

  it('brand and tag read their facet lists', async () => {
    const { added, close } = await setup();
    const { node } = await added({ type: 'filter-tag', specials: { filterSource: 'brand' } });
    expect(node.specials!.filterValues).toEqual([
      { value: 'asus', label: 'ASUS', enabled: true },
      { value: 'dell', label: 'Dell', enabled: true },
    ]);
    await close();
  });

  it('attribute needs filterAxis; without it the add notes the axes', async () => {
    const { added, close } = await setup();
    const { node } = await added({ type: 'filter-radio', specials: { filterSource: 'attribute', filterAxis: 'RAM' } });
    expect(node.specials!.filterValues).toEqual([
      { value: 'RAM:16GB', label: '16GB', enabled: true },
      { value: 'RAM:32GB', label: '32GB', enabled: true },
    ]);
    await close();
    const again = await setup();
    const bare = await again.added({ type: 'filter-radio', specials: { filterSource: 'attribute' } });
    expect(bare.out.json.filters[0].note).toMatch(/filterAxis.*RAM/);
    await again.close();
  });

  it('availability is FIXED, labelled in the site language', async () => {
    const vi = await setup({ locale: 'vi' });
    expect((await vi.added({ type: 'filter-checkbox', specials: { filterSource: 'availability' } })).node.specials!.filterValues).toEqual([
      { value: 'in_stock', label: 'Còn hàng', enabled: true },
      { value: 'out_of_stock', label: 'Hết hàng', enabled: true },
    ]);
    expect(vi.reads()).toBe(0);
    await vi.close();
    const en = await setup({ locale: 'en' });
    const rows = (await en.added({ type: 'filter-checkbox', specials: { filterSource: 'availability' } })).node.specials!.filterValues as Array<{ label: string }>;
    expect(rows.map((r) => r.label)).toEqual(['In stock', 'Out of stock']);
    await en.close();
  });

  it('price derives rows from filterRanges in the from-to grammar the storefront filters on', async () => {
    // Measured: f.price=4500000000-7000000000 filters; the `..` grammar returns nothing.
    const { added, close } = await setup();
    const { node } = await added({
      type: 'filter-checkbox',
      specials: { filterSource: 'price', filterRanges: [{ fromCents: 4_500_000_000, toCents: 7_000_000_000 }, { fromCents: 7_000_000_000, toCents: null }] },
    });
    const rows = node.specials!.filterValues as Array<{ value: string; label: string }>;
    expect(rows.map((r) => r.value)).toEqual(['4500000000-7000000000', '7000000000-']);
    expect(rows[0].label).toMatch(/45\.000\.000.*70\.000\.000/);
    expect(rows[1].label).toMatch(/70\.000\.000.*\+$/);
    await close();
  });

  it('price with no ranges says it needs filterRanges', async () => {
    const { added, close } = await setup();
    const { out, node } = await added({ type: 'filter-checkbox', specials: { filterSource: 'price' } });
    expect(node.specials!.filterValues).toEqual([]);
    expect(out.json.filters[0].note).toMatch(/filterRanges/);
    await close();
  });

  it('a failed facets read does not fail the add — it notes', async () => {
    const { added, close } = await setup({ facetsFail: true });
    const { out, node } = await added({ type: 'filter-checkbox' });
    expect(out.isError).toBe(false);
    expect(node).toBeDefined();
    expect(out.json.filters[0].note).toMatch(/facets/);
    await close();
  });

  it('leaves a manual list, or rows the caller gave, alone', async () => {
    const { added, close, reads } = await setup();
    const given = [{ value: 'asus', label: 'Asus', enabled: true }];
    const { node, out } = await added({ type: 'filter-checkbox', specials: { filterSource: 'brand', filterValues: given } });
    expect(node.specials!.filterValues).toEqual(given);
    expect(out.json.filters).toBeUndefined();
    expect(reads()).toBe(0);
    await close();
  });
});

describe('sb_set re-sources a filter', () => {
  it('a new filterSource replaces the rows with the new source\'s', async () => {
    const { added, call, doc, close } = await setup();
    const { node } = await added({ type: 'filter-checkbox' });
    const id = Object.entries(doc().nodes).find(([, n]) => n === node || n.data.type === 'filter-checkbox')![0];
    const out = await call('sb_set', { id, namespace: 'specials', keys: { filterSource: 'tag' }, dry_run: false });
    expect(out.json.filters).toEqual([{ id, source: 'tag', rows: 1 }]);
    expect(doc().nodes[id].specials!.filterValues).toEqual([{ value: 'sale', label: 'Sale', enabled: true }]);
    await close();
  });
});
