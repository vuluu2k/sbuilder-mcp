import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { writeCheck, specCheck, pinFor } from '../src/domains/site/writecheck.js';
import { bindNode } from '../src/tools/live.js';
import { emptyDoc } from './helpers/doc.js';

/**
 * SIX DEFECTS FOUND BUILDING ONE REAL STOREFRONT with the published server,
 * each observed live. Every one is a write or a review that told the caller
 * something false: a warning on correct work, silence on broken work, or the
 * same sentence three times.
 */

/* 1 + 2 ------------------------------------------------------------------ */

describe('specials.text / textHtml on a text-bearing element', () => {
  // The Go renderer reads rich text through `nodes.RichText(n, "text")`, which
  // returns `specials.textHtml` when set (render/nodes/helpers.go:1693) — so
  // textHtml is READ, and `unknown_key` on it told the caller to drop the one
  // key that makes bold copy render.
  it('knows textHtml on text, heading and button', () => {
    for (const type of ['text', 'heading', 'button']) {
      const codes = writeCheck(type, 'specials', { textHtml: '<b>x</b>' }).map((c) => c.note.code);
      expect(codes, type).not.toContain('unknown_key');
    }
  });

  // …and the other half: markup in plain `text` is ESCAPED, so the shopper
  // reads a literal "<b>".
  it('warns when plain text carries markup, and names textHtml', () => {
    const [c] = writeCheck('text', 'specials', { text: 'Hà Nội: <b>83 Thái Hà</b>' }, { id: 't1' });
    expect(c.note).toMatchObject({ code: 'text_markup', id: 't1', key: 'specials.text' });
    expect(c.note.problem).toMatch(/escaped/i);
    expect(c.note.fix).toMatch(/textHtml/);
    expect(writeCheck('text', 'specials', { text: 'Giá < 100k & miễn phí' })).toEqual([]);
    // An element with no rich twin has nowhere better to put it.
    expect(writeCheck('form-title', 'specials', { text: '<b>x</b>' }).map((c) => c.note.code)).not.toContain('text_markup');
  });

  it('sb_add says it too, once per element type and key', () => {
    const spec = {
      type: 'flex-section',
      children: [
        { type: 'heading', specials: { text: 'A <span>b</span>' } },
        { type: 'heading', specials: { text: 'C <br/> d' } },
      ],
    };
    const once = new Set(specCheck(spec).filter((c) => c.note.code === 'text_markup').map((c) => c.once));
    expect(once.size).toBe(1);
  });
});

/* 3 ---------------------------------------------------------------------- */

describe('review of text that lives somewhere other than specials.text', () => {
  it('a text whose copy is only in textHtml is not empty', () => {
    const d = emptyDoc();
    d.apply(
      addSubtree(d, 'ROOT', {
        type: 'flex-section',
        children: [{ type: 'text', specials: { text: '', textHtml: 'Hà Nội: <b>83 Thái Hà</b>' } }],
      }).patches,
    );
    expect(reviewDesign(d).map((f) => f.code)).not.toContain('empty_text');
  });

  const node = (id: string, type: string, parent: string | null, specials: Record<string, unknown>, nodes: string[] = []) => ({
    id,
    data: { type, parent, nodes },
    style: {},
    config: {},
    specials,
    responsive: {},
    events: [],
    bindings: [],
  });
  // A login form's own document, as `sb_page_open form_id` opens it.
  const formDoc = () =>
    PageDoc.from({
      schema_version: 2,
      root_node_id: 'fm_1',
      nodes: {
        fm_1: node('fm_1', 'form', null, { formId: '', segmentId: '' }, ['fm_h', 'fm_e', 'fm_l', 'fm_r', 'fm_s']),
        fm_h: node('fm_h', 'heading', 'fm_1', { text: 'Đăng nhập', htmlTag: 'h2' }),
        fm_e: node('fm_e', 'form-text', 'fm_1', { name: 'email', label: 'Email' }),
        fm_l: node('fm_l', 'form-link', 'fm_1', { text: '', linkText: 'Quên mật khẩu?' }),
        fm_r: node('fm_r', 'form-link', 'fm_1', { text: 'Chưa có tài khoản?', linkText: 'Đăng ký ngay' }),
        fm_s: node('fm_s', 'form-submit', 'fm_1', { text: 'Đăng nhập' }),
      },
    } as never);

  it('a form-link with only linkText is not empty_text', () => {
    expect(reviewDesign(formDoc()).filter((f) => f.nodeId === 'fm_l').map((f) => f.code)).toEqual([]);
  });

  it("the form-link's own seed copy is real copy, not a placeholder", () => {
    expect(reviewDesign(formDoc()).filter((f) => f.nodeId === 'fm_r').map((f) => f.code)).toEqual([]);
  });

  it('a form document never reports no_h1 — the page around it owns the h1', () => {
    expect(reviewDesign(formDoc()).map((f) => f.code)).not.toContain('no_h1');
  });
});

/* 4 ---------------------------------------------------------------------- */

describe('sb_bind on a field that is already bound', () => {
  it('replaces the binding on that field, keeping its id', () => {
    const d = emptyDoc();
    const { patches, ids } = addSubtree(d, 'ROOT', { type: 'text-dataset' });
    d.apply(patches);
    const id = ids[0];
    const before = (d.node(id).bindings as Array<{ id: string; field: string }>).filter((b) => b.field === 'specials.boundText');
    expect(before).toHaveLength(1);
    d.apply(bindNode(d, id, 'product.tags', 'specials.boundText'));
    const after = (d.node(id).bindings as Array<{ id: string; field: string; source: string }>).filter((b) => b.field === 'specials.boundText');
    expect(after).toEqual([expect.objectContaining({ id: before[0].id, source: 'product.tags' })]);
  });
});

/* 5 + 6: through the real tools ------------------------------------------ */

const DOC = {
  schema_version: 2,
  root_node_id: 'ROOT',
  nodes: {
    ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['hd', 'sec', 'box'] }, specials: {} },
    hd: {
      id: 'hd',
      data: { type: 'flex-section', parent: 'ROOT', nodes: ['b1', 'b2'] },
      specials: { globalId: 'gs_head', globalKind: 'header', globalRev: 1 },
    },
    b1: { id: 'b1', data: { type: 'button', parent: 'hd', nodes: [] }, specials: { text: 'A' } },
    b2: { id: 'b2', data: { type: 'button', parent: 'hd', nodes: [] }, specials: { text: 'B' } },
    sec: { id: 'sec', data: { type: 'flex-section', parent: 'ROOT', nodes: [] }, style: { display: 'flex' } },
    // The fallback-up fixtures: an image with nothing sized, an image whose
    // TABLET slot says maxWidth, and a divider (its own stylesheet sets width).
    box: { id: 'box', data: { type: 'flex-section', parent: 'ROOT', nodes: ['pic', 'pic2', 'hr', 'txt', 'txt2'] }, style: { display: 'flex' } },
    pic: { id: 'pic', data: { type: 'image', parent: 'box', nodes: [] }, specials: { src: 'https://x/a.png' } },
    pic2: {
      id: 'pic2',
      data: { type: 'image', parent: 'box', nodes: [] },
      specials: { src: 'https://x/b.png' },
      responsive: { tablet: { style: { maxWidth: '600px' } } },
    },
    hr: { id: 'hr', data: { type: 'divider', parent: 'box', nodes: [] } },
    // body-default caps reading width at 680px in the starter theme; txt2 wears text-default.
    txt: { id: 'txt', data: { type: 'text', parent: 'box', nodes: [] }, specials: { text: 'Đoạn văn', stylePreset: 'body-default' } },
    txt2: { id: 'txt2', data: { type: 'text', parent: 'box', nodes: [] }, specials: { text: 'Đoạn văn' } },
  },
};

async function openClient() {
  const f = (async (url: unknown) => {
    const path = new URL(String(url)).pathname;
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/source')) {
      return json({ source: { pageId: 'pg_1', siteId: 's1', document: JSON.parse(JSON.stringify(DOC)), schemaVersion: 2, updatedAt: 'now', rev: 1 } });
    }
    return json({});
  }) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  const { client, close } = await connectedClient({ fetchImpl: f, session, siteId: 's1' });
  await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text?: string }> };
    const raw = res.content.map((c) => c.text ?? '').join('');
    expect(raw).not.toMatch(/^sbuilder:|^Cannot/);
    return { raw, json: JSON.parse(raw) as Record<string, unknown> };
  };
  return { call, close };
}

describe('a write inside a shared master says so once per master', () => {
  it('names the master and the node count, once — not once per node, not again', async () => {
    const { call, close } = await openClient();
    try {
      const r = await call('sb_set', {
        edits: [
          { id: 'b1', namespace: 'style', keys: { color: 'red' } },
          { id: 'b1', namespace: 'style', keys: { fontWeight: '700' } },
          { id: 'b2', namespace: 'style', keys: { color: 'red' } },
        ],
        dry_run: false,
      });
      expect(r.raw.match(/Say so when reporting/g)).toHaveLength(1);
      expect(r.raw).toMatch(/gs_head/);
      expect(r.raw).toMatch(/2 nodes/);
      const again = await call('sb_set', { id: 'b2', namespace: 'style', keys: { color: 'blue' }, dry_run: false });
      expect(again.raw).not.toMatch(/Say so when reporting/);
    } finally {
      await close();
    }
  });
});

describe('a narrower-only style key reaches desktop through the cascade tail', () => {
  it('sb_set names a mobile-only key once, and is silent when base declares it', async () => {
    const { call, close } = await openClient();
    try {
      const r = await call('sb_set', { id: 'sec', namespace: 'style', keys: { order: '9' }, breakpoint: 'mobile', pin_wider: false, dry_run: false });
      expect(r.json.checks).toEqual([expect.objectContaining({ code: 'cascade_tail', id: 'sec', key: 'style.order' })]);
      // The DEFAULT pins instead: `order` has no neutral value, so base gets an
      // empty one — the cascade stops there and the browser drops `order:;`.
      const pinned = await call('sb_set', { id: 'sec', namespace: 'style', keys: { flexGrow: '2' }, breakpoint: 'mobile' });
      expect(pinned.json.checks, 'pinned by default, so nothing falls').toBeUndefined();
      expect(pinned.json.pinned).toEqual([
        expect.objectContaining({ id: 'sec', key: 'style.flexGrow', value: '' }),
      ]);
      // `display` is declared at base on this node: the tail never reaches desktop.
      const quiet = await call('sb_set', { id: 'sec', namespace: 'style', keys: { display: 'block' }, breakpoint: 'tablet', dry_run: false });
      expect(quiet.json.checks).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("sb_add judges the node as born: flex-block's own base flexDirection keeps a mobile column silent", async () => {
    const { call, close } = await openClient();
    try {
      const r = await call('sb_add', {
        parent_id: 'sec',
        spec: { type: 'flex-block', responsive: { mobile: { style: { flexDirection: 'column', flexWrap: 'wrap' } } } },
      });
      expect((r.json.checks as Array<{ code: string; key: string }>).filter((c) => c.code === 'cascade_tail').map((c) => c.key)).toEqual([
        'style.flexWrap',
      ]);
    } finally {
      await close();
    }
  });

  // GAP #26 (TTG, 2026-10-29): three small rows written `flexDirection:"row"` at
  // base, with their own `responsive.mobile.style.gap`, stacked at 390 — the
  // element's seed `responsive.mobile.style.flexDirection:"column"` (the editor
  // seeds the same) survives the per-namespace merge, and nothing said so.
  it('sb_add says when an element seed overrides a base style key at a narrower width', async () => {
    const { call, close } = await openClient();
    try {
      const r = await call('sb_add', {
        parent_id: 'sec',
        spec: { type: 'flex-block', style: { flexDirection: 'row' }, responsive: { mobile: { style: { gap: '8px' } } } },
      });
      const seed = (r.json.checks as Array<{ code: string; key: string; fix: string }>).filter((c) => c.code === 'seed_override');
      expect(seed).toEqual([expect.objectContaining({ key: 'style.flexDirection' })]);
      expect(seed[0].fix).toMatch(/responsive.*mobile.*flexDirection/);
      // Saying the mobile answer out loud is silent — the caller decided.
      const quiet = await call('sb_add', {
        parent_id: 'sec',
        spec: { type: 'flex-block', style: { flexDirection: 'row' }, responsive: { mobile: { style: { flexDirection: 'row' } } } },
      });
      expect(((quiet.json.checks ?? []) as Array<{ code: string }>).filter((c) => c.code === 'seed_override')).toEqual([]);
    } finally {
      await close();
    }
  });

  type Note = { code: string; id?: string; key: string; problem: string; fix: string };
  const tails = (r: { json: Record<string, unknown> }) => ((r.json.checks ?? []) as Note[]).filter((c) => c.code === 'cascade_tail');

  it('a value at a WIDER breakpoint (not only base/desktop) stops the fall — and names every width it reaches', async () => {
    const { call, close } = await openClient();
    try {
      const hit = await call('sb_set', { id: 'pic', namespace: 'style', keys: { maxWidth: '170px' }, breakpoint: 'mobile', pin_wider: false });
      expect(tails(hit).map((c) => c.key), 'liveness: nothing wider on pic').toEqual(['style.maxWidth']);
      expect(tails(hit)[0].problem).toMatch(/desktop, laptop, tablet/);
      expect(tails(hit)[0].fix).toMatch(/pin_wider/);
      const quiet = await call('sb_set', { id: 'pic2', namespace: 'style', keys: { maxWidth: '170px' }, breakpoint: 'mobile', pin_wider: false });
      expect(tails(quiet), "pic2's tablet maxWidth is wider than mobile").toEqual([]);
    } finally {
      await close();
    }
  });

  it('a state write at a narrow breakpoint falls back up too, judged on that state alone', async () => {
    const { call, close } = await openClient();
    try {
      const hit = await call('sb_set', { id: 'sec', namespace: 'style', state: 'hover', keys: { backgroundColor: 'red' }, breakpoint: 'tablet', pin_wider: false });
      expect(tails(hit).map((c) => c.key)).toEqual(['style.backgroundColor']);
      expect(tails(hit)[0].problem).toMatch(/state "hover"/);
      await call('sb_set', { id: 'box', namespace: 'style', state: 'hover', base: true, keys: { backgroundColor: 'blue' }, dry_run: false });
      const quiet = await call('sb_set', { id: 'box', namespace: 'style', state: 'hover', keys: { backgroundColor: 'red' }, breakpoint: 'tablet', pin_wider: false });
      expect(tails(quiet), 'base hover declares it').toEqual([]);
    } finally {
      await close();
    }
  });

  it('pin_wider writes the CSS initial at base where the element sets no such property itself', async () => {
    const { call, close } = await openClient();
    try {
      const r = await call('sb_set', { id: 'pic', namespace: 'style', keys: { maxWidth: '170px' }, breakpoint: 'mobile', pin_wider: true });
      expect(r.json.pinned).toEqual([{ id: 'pic', key: 'style.maxWidth', value: 'none', from: 'CSS initial' }]);
      expect(r.json.patches).toContainEqual({ op: 'set', path: ['nodes', 'pic', 'style', 'maxWidth'], value: 'none' });
      expect(tails(r), 'pinned, so nothing falls').toEqual([]);
    } finally {
      await close();
    }
  });

  it("pin_wider prefers the element's own default (button width: fit-content)", async () => {
    const { call, close } = await openClient();
    try {
      const r = await call('sb_set', { id: 'b1', namespace: 'style', keys: { width: '100%' }, breakpoint: 'mobile', pin_wider: true });
      expect(r.json.pinned).toEqual([
        { id: 'b1', key: 'style.width', value: 'fit-content', from: 'element default (restores the seeded value)' },
      ]);
    } finally {
      await close();
    }
  });

  it("pin_wider never overrides a preset that sets the key — body-default's 680px reading width", async () => {
    const { call, close } = await openClient();
    try {
      const r = await call('sb_set', { id: 'txt', namespace: 'style', keys: { maxWidth: '320px' }, breakpoint: 'mobile', pin_wider: true });
      // Not `none` (that would wipe the preset's 680px): an EMPTY base, which the
      // browser drops, so the preset's class rule still paints desktop.
      expect(r.json.pinned).toEqual([expect.objectContaining({ id: 'txt', key: 'style.maxWidth', value: '' })]);
      expect((r.json.pinned as Array<{ from: string }>)[0].from).toMatch(/preset "body-default" sets maxWidth/);
      expect(tails(r)).toEqual([]);
      const twin = await call('sb_set', { id: 'txt2', namespace: 'style', keys: { maxWidth: '320px' }, breakpoint: 'mobile', pin_wider: true });
      expect(twin.json.pinned, 'text-default sets no maxWidth').toEqual([{ id: 'txt2', key: 'style.maxWidth', value: 'none', from: 'CSS initial' }]);
    } finally {
      await close();
    }
  });

  it('pin_wider pins EMPTY where no value is safe: a divider sets its own width, a colour has no neutral', async () => {
    const { call, close } = await openClient();
    try {
      const r = await call('sb_set', {
        edits: [
          { id: 'hr', namespace: 'style', keys: { width: '50%' }, breakpoint: 'mobile' },
          { id: 'pic', namespace: 'style', keys: { color: 'red' }, breakpoint: 'mobile' },
        ],
        pin_wider: true,
      });
      const pinned = r.json.pinned as Array<{ id: string; key: string; value: unknown; from: string }>;
      expect(pinned.map((p) => `${p.id}:${p.key}=${JSON.stringify(p.value)}`).sort()).toEqual([
        'hr:style.width=""',
        'pic:style.color=""',
      ]);
      const from = Object.fromEntries(pinned.map((p) => [p.id, p.from]));
      expect(from.hr).toMatch(/divider's own stylesheet sets width/);
      expect(from.pic).toMatch(/no CSS initial is neutral for color/);
      expect(tails(r), 'pinned, so nothing falls').toEqual([]);
    } finally {
      await close();
    }
  });

  it('pinFor refuses a type the catalog does not carry', () => {
    expect(pinFor('no-such-element', 'maxWidth')).toEqual({ reason: "no-such-element is not in this MCP's catalog" });
    expect(pinFor('image', 'maxWidth'), 'liveness: a known type with no sizing rule pins').toEqual({ value: 'none', from: 'CSS initial' });
  });

  it('sb_add: a mobile-only maxWidth falls up; with tablet also set, the mobile one does not', () => {
    const notes = (responsive: Record<string, unknown>) =>
      specCheck({ type: 'image', responsive } as never)
        .map((c) => c.note)
        .filter((n) => n.code === 'cascade_tail');
    expect(notes({ mobile: { style: { maxWidth: '170px' } } }).map((n) => n.problem)).toEqual([expect.stringMatching(/only at mobile/)]);
    const both = notes({ tablet: { style: { maxWidth: '600px' } }, mobile: { style: { maxWidth: '170px' } } });
    expect(both.some((n) => /only at mobile/.test(n.problem)), 'tablet is wider than mobile').toBe(false);
    expect(both.map((n) => n.problem), 'the tablet value itself still reaches desktop').toEqual([expect.stringMatching(/only at tablet/)]);
    expect(notes({ desktop: { style: { maxWidth: '900px' } }, mobile: { style: { maxWidth: '170px' } } }), 'desktop says it').toEqual([]);
  });

  it('sb_add names each node, so a second node with the same narrower-only key is still told', async () => {
    const { call, close } = await openClient();
    try {
      const block = { type: 'flex-block', responsive: { mobile: { style: { order: '2' } } } };
      const r = await call('sb_add', { parent_id: 'sec', spec: { type: 'flex-block', children: [block, block] } });
      const tails = (r.json.checks as Array<{ code: string; id?: string }>).filter((c) => c.code === 'cascade_tail');
      expect(tails).toHaveLength(2);
      expect(new Set(tails.map((c) => c.id)).size).toBe(2);
      expect(tails.every((c) => typeof c.id === 'string')).toBe(true);
    } finally {
      await close();
    }
  });
});
