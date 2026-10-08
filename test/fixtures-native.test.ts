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

/**
 * A platform that keeps FORM RECORDS: POST creates one, PUT replaces it whole,
 * GET reads it — beside fakePlatform's own field documents.
 */
function formsPlatform() {
  const records = new Map<string, { id: string; name: string; type: string; settings: Record<string, unknown> }>();
  let n = 0;
  const p = fakePlatform((method, path, body) => {
    if (method === 'POST' && path === '/api/sites/s1/forms') {
      const b = body as { name: string; type: string };
      const rec = { id: `frm_${++n}`, name: b.name, type: b.type, settings: { notify: { owner: true } } };
      records.set(rec.id, rec);
      return { form: rec };
    }
    const m = /^\/api\/sites\/s1\/forms\/(frm_\d+)$/.exec(path);
    if (m && method === 'PUT') {
      records.set(m[1], { ...(body as never), id: m[1] });
      return { form: records.get(m[1]) };
    }
    if (m && method === 'GET') return { form: records.get(m[1]) };
    return undefined;
  });
  return { p, records };
}
const formDocOf = (p: ReturnType<typeof fakePlatform>, id: string) => p.forms.get(id) as Doc;

describe('fixture 6 — booking-shaped forms, native end to end', () => {
  it('a salon: template booking → a "Dịch vụ" select → a rule → maxPerSlot, and it all reopens', async () => {
    const { p, records } = formsPlatform();
    const { call, close } = await p.connect();
    const made = await call('sb_store', {
      site_id: 's1',
      action: 'form',
      template: 'booking',
      name: 'Đặt lịch salon',
      settings: { booking: { maxPerSlot: 2, minNoticeDays: 1 } },
      dry_run: false,
    });
    expect(made.isError).toBe(false);
    const formId = (made.json.form as { id: string }).id;
    // The PUT-whole step carried the rulebook, over what the platform seeded.
    expect(records.get(formId)).toMatchObject({
      type: 'booking',
      settings: { notify: { owner: true }, booking: { maxPerSlot: 2, minNoticeDays: 1 } },
    });

    await call('sb_page_open', { site_id: 's1', form_id: formId });
    const root = formDocOf(p, formId).root_node_id;
    const add = await call('sb_add', {
      parent_id: root,
      dry_run: false,
      spec: {
        type: 'form-select',
        specials: { name: 'dich_vu', label: 'Dịch vụ', required: true, options: ['Cắt tóc', 'Nhuộm tóc', 'Gội đầu'] },
      },
    });
    expect(add.isError).toBe(false);
    expect(add.json.checks).toBeUndefined(); // named, with options: nothing to say
    const rules = [
      { id: 'r1', join: 'and', conditions: [{ field: 'dich_vu', op: 'is', value: 'Nhuộm tóc' }], targets: [{ field: 'notes', action: 'required' }] },
    ];
    const set = await call('sb_set', { id: root, namespace: 'specials', keys: { formRules: JSON.stringify(rules) }, dry_run: false });
    expect(set.isError).toBe(false);
    expect(set.json.checks).toBeUndefined();

    let doc = formDocOf(p, formId);
    const select = ofType(doc, 'form-select')[0];
    const kids = doc.nodes[root].data.nodes;
    // Above "Đặt lịch", where the editor puts a new field.
    expect(kids.indexOf(select.id)).toBeLessThan(kids.indexOf(ofType(doc, 'form-submit')[0].id));
    expect(JSON.parse(String(doc.nodes[root].specials?.formRules))).toEqual(rules);
    expect(ofType(doc, 'custom-code')).toEqual([]);

    // Reopen: what the form builder would load is what was saved.
    await call('sb_page_open', { site_id: 's1', form_id: formId });
    expect((await call('sb_outline', { depth: 3 })).text).toContain(select.id);
    doc = formDocOf(p, formId);
    expect(doc.nodes[select.id].specials?.options).toEqual(['Cắt tóc', 'Nhuộm tóc', 'Gội đầu']);
    const review = await call('sb_review', {});
    expect(codes(review).filter((c) => c.startsWith('form_'))).toEqual([]);
    await close();
  });

  it('a hotel: template stay → min/max nights; two dates are the stay and review is clean', async () => {
    const { p, records } = formsPlatform();
    const { call, close } = await p.connect();
    const dry = await call('sb_store', {
      site_id: 's1',
      action: 'form',
      template: 'stay',
      settings: { booking: { minStayNights: 2, maxStayNights: 14 } },
    });
    expect(dry.json.settings).toEqual({ booking: { minStayNights: 2, maxStayNights: 14 } });
    expect(dry.json.settings_unknown).toBeUndefined();
    expect(p.writes).toEqual([]);

    const made = await call('sb_store', {
      site_id: 's1',
      action: 'form',
      template: 'stay',
      settings: { booking: { minStayNights: 2, maxStayNights: 14 } },
      dry_run: false,
    });
    const formId = (made.json.form as { id: string }).id;
    expect(records.get(formId)?.settings).toMatchObject({ booking: { minStayNights: 2, maxStayNights: 14 } });
    await call('sb_page_open', { site_id: 's1', form_id: formId });
    const doc = formDocOf(p, formId);
    expect(ofType(doc, 'form-calendar').map((n) => n.specials?.name)).toEqual(['nhan_phong', 'tra_phong']);
    const review = await call('sb_review', {});
    expect(codes(review).filter((c) => c.startsWith('form_'))).toEqual([]);
    // A third date on this BOOKING form is said at the write, before it ships.
    const third = await call('sb_add', { parent_id: doc.root_node_id, spec: { type: 'form-calendar', specials: { name: 'ngay_sinh' } } });
    expect(JSON.stringify(third.json.checks)).toContain('check-in');
    await close();
  });
});
