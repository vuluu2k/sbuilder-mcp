import { describe, it, expect } from 'vitest';
import { fakePlatform } from './helpers/platform.js';

/**
 * NATIVE-ELEMENT FIXTURES, driven through the PUBLIC tools only — the calls an
 * agent makes — against a small stateful platform whose PUT really changes the
 * stored page. Each is industry-neutral and needs no custom code.
 */

type Doc = { root_node_id: string; nodes: Record<string, { id: string; data: { type: string; parent: string | null; nodes: string[] }; specials?: Record<string, unknown>; config?: Record<string, unknown>; responsive?: Record<string, { style?: Record<string, unknown> }>; events?: unknown[]; bindings?: unknown[] }> };
const stored = (p: ReturnType<typeof fakePlatform>, page: string) => p.pages.get(page)!.document as Doc;
const ofType = (d: Doc, t: string) => Object.values(d.nodes).filter((n) => n.data.type === t);
const codes = (r: { json: Record<string, unknown> }) =>
  ((r.json.findings ?? []) as Array<{ code: string }>).map((f) => f.code);
const checkCodes = (r: { json: Record<string, unknown> }) =>
  ((r.json.checks ?? []) as Array<{ code: string }>).map((f) => f.code);
/** Finding codes this work added — a fixture built right must raise none of them. */
const NEW = ['invalid_action', 'action_missing_target', 'no_data_context', 'unread_value', 'custom_code_native'];

function platform(type = 'page') {
  return fakePlatform((method, path) =>
    method === 'GET' && path === '/api/sites/s1/pages'
      ? { pages: [{ id: 'pg_1', type, status: 'draft', name: 'Fixture' }] }
      : undefined,
  );
}

describe('fixture 1 — a responsive content page', () => {
  it('builds from a native pattern, answers mobile on its own, duplicate is undone and redone by sb_undo, survives reload', async () => {
    const p = platform();
    const { call, close } = await p.connect();
    await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });

    const dry = await call('sb_template_use', { site_id: 's1', page_id: 'pg_1', template_id: 'sb_feature_trio' });
    expect(p.writes).toEqual([]); // a dry run sends nothing
    expect(dry.isError).toBe(false);
    await call('sb_template_use', { site_id: 's1', page_id: 'pg_1', template_id: 'sb_feature_trio', dry_run: false });

    let doc = stored(p, 'pg_1');
    const heading = ofType(doc, 'heading')[0];
    expect(heading).toBeDefined();
    const set = await call('sb_set', { id: heading.id, namespace: 'style', keys: { fontSize: '28px' }, breakpoint: 'mobile', dry_run: false });
    expect(set.isError).toBe(false);
    doc = stored(p, 'pg_1');
    expect(doc.nodes[heading.id].responsive?.mobile?.style?.fontSize).toBe('28px');

    // A child node is an ordinary node: duplicate it, undo the duplicate, redo it.
    const cards = doc.nodes[heading.id].data.parent!;
    const preDup = JSON.parse(JSON.stringify(stored(p, 'pg_1')));
    await call('sb_duplicate', { id: cards, dry_run: false });
    const postDup = JSON.parse(JSON.stringify(stored(p, 'pg_1')));
    expect(Object.keys(postDup.nodes).length).toBeGreaterThan(Object.keys(preDup.nodes).length);
    expect((await call('sb_undo', { index: 1, dry_run: false })).isError).toBe(false);
    expect(stored(p, 'pg_1')).toEqual(preDup);
    expect((await call('sb_undo', { index: 1, dry_run: false })).isError).toBe(false);
    expect(stored(p, 'pg_1')).toEqual(postDup);

    // Reload: what the editor would open is what was saved.
    await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
    const outline = await call('sb_outline', { depth: 6 });
    expect(outline.text).toContain(heading.id);
    const review = await call('sb_review', {});
    expect(codes(review).filter((c) => NEW.includes(c))).toEqual([]);
    await close();
  });
});

describe('fixture 2 — a data list with search, filter, sort, paging and an empty state', () => {
  it('composes native controls, every key known, bindings and the empty state seeded', async () => {
    const p = platform();
    const { call, close } = await p.connect();
    await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
    const add = await call('sb_add', {
      parent_id: 'ROOT',
      dry_run: false,
      spec: {
        type: 'flex-section',
        children: [
          {
            type: 'flex-block',
            children: [
              { type: 'search-input' },
              { type: 'filter-checkbox', specials: { filterSource: 'category' } },
              { type: 'select', specials: { filterSource: 'sort' } },
              { type: 'list-dataset', config: { datasetSource: 'product', loadingMode: 'pagination' } },
            ],
          },
        ],
      },
    });
    expect(add.isError).toBe(false);
    expect(checkCodes(add).filter((c) => c === 'unknown_key' || c === 'unknown_value')).toEqual([]);

    const doc = stored(p, 'pg_1');
    const [list] = ofType(doc, 'list-dataset');
    expect(list.config?.loadingMode).toBe('pagination');
    // The empty state is a real, designable node, not a string in a wrapper.
    const emptyId = list.config?.emptyStateId as string;
    expect(emptyId && doc.nodes[emptyId]?.data.type).toBe('list-empty');
    // The item template's children carry bindings derived from the source.
    const bound = Object.values(doc.nodes).filter((n) => (n.bindings ?? []).length > 0);
    expect(bound.length).toBeGreaterThan(0);

    const review = await call('sb_review', {});
    expect(codes(review).filter((c) => NEW.includes(c))).toEqual([]);
    await close();
  });

  it('a value the renderer does not read is said at write time and again at review', async () => {
    const p = platform();
    const { call, close } = await p.connect();
    await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
    await call('sb_add', {
      parent_id: 'ROOT',
      dry_run: false,
      spec: { type: 'flex-section', children: [{ type: 'list-dataset', config: { datasetSource: 'product' } }] },
    });
    const [list] = ofType(stored(p, 'pg_1'), 'list-dataset');
    const set = await call('sb_set', { id: list.id, namespace: 'config', keys: { loadingMode: 'paginate' }, base: true, dry_run: false });
    expect(checkCodes(set)).toContain('unknown_value');
    expect(codes(await call('sb_review', {}))).toContain('unread_value');
    await close();
  });

  it('a record-bound element outside any repeater on a plain page is reported', async () => {
    const p = platform('page');
    const { call, close } = await p.connect();
    await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
    await call('sb_add', {
      parent_id: 'ROOT',
      dry_run: false,
      spec: { type: 'flex-section', children: [{ type: 'text-dataset', config: { datasetSource: 'product', kind: 'title' } }] },
    });
    expect(codes(await call('sb_review', {}))).toContain('no_data_context');
    await close();
  });
});

describe('fixture 3 — a panel about the item clicked', () => {
  it('a pop-up with no target is refused before it is stored; with one it is stored', async () => {
    const p = platform();
    const { call, close } = await p.connect();
    await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
    await call('sb_add', {
      parent_id: 'ROOT',
      dry_run: false,
      spec: { type: 'flex-section', children: [{ type: 'button', specials: { text: 'Chi tiết' } }] },
    });
    const [btn] = ofType(stored(p, 'pg_1'), 'button');
    const bad = await call('sb_event', { id: btn.id, action: 'popup', payload: {}, dry_run: false });
    expect(bad.isError || /payload/i.test(bad.text)).toBe(true);
    expect(stored(p, 'pg_1').nodes[btn.id].events ?? []).toEqual([]);
    const good = await call('sb_event', { id: btn.id, action: 'popup', payload: { id: 'ov_1' }, dry_run: false });
    expect(good.isError).toBe(false);
    expect(JSON.stringify(stored(p, 'pg_1').nodes[btn.id].events)).toContain('ov_1');
    await close();
  });
});

describe('fixture 5 — navigation', () => {
  it('a link with no address is refused; a link carrying its query string keeps it', async () => {
    const p = platform();
    const { call, close } = await p.connect();
    await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
    await call('sb_add', {
      parent_id: 'ROOT',
      dry_run: false,
      spec: { type: 'flex-section', children: [{ type: 'button', specials: { text: 'Xem' } }] },
    });
    const [btn] = ofType(stored(p, 'pg_1'), 'button');
    const bad = await call('sb_event', { id: btn.id, action: 'go_to_url', payload: {}, dry_run: false });
    expect(bad.isError || /payload/i.test(bad.text)).toBe(true);
    await call('sb_event', { id: btn.id, action: 'go_to_url', payload: { url: '/collections/all?sort=newest' }, dry_run: false });
    expect(stored(p, 'pg_1').nodes[btn.id].specials?.href).toBe('/collections/all?sort=newest');
    expect(codes(await call('sb_review', {})).filter((c) => NEW.includes(c))).toEqual([]);
    await close();
  });
});
