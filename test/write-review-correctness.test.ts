import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { writeCheck, specCheck } from '../src/domains/site/writecheck.js';
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
    ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['hd', 'sec'] }, specials: {} },
    hd: {
      id: 'hd',
      data: { type: 'flex-section', parent: 'ROOT', nodes: ['b1', 'b2'] },
      specials: { globalId: 'gs_head', globalKind: 'header', globalRev: 1 },
    },
    b1: { id: 'b1', data: { type: 'button', parent: 'hd', nodes: [] }, specials: { text: 'A' } },
    b2: { id: 'b2', data: { type: 'button', parent: 'hd', nodes: [] }, specials: { text: 'B' } },
    sec: { id: 'sec', data: { type: 'flex-section', parent: 'ROOT', nodes: [] }, style: { display: 'flex' } },
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
      const r = await call('sb_set', { id: 'sec', namespace: 'style', keys: { order: '9' }, breakpoint: 'mobile', dry_run: false });
      expect(r.json.checks).toEqual([expect.objectContaining({ code: 'cascade_tail', id: 'sec', key: 'style.order' })]);
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
});
