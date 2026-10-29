import { describe, it, expect, beforeEach } from 'vitest';
import { fakePlatform, blank } from './helpers/platform.js';
import { writeCheck } from '../src/domains/site/writecheck.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { PageDoc } from '../src/domains/site/document.js';
import { clearThemeCache } from '../src/domains/site/theme-fetch.js';
import { loadSource } from '../src/transport/pages.js';

/** Verifier findings on v0.99.0 / v0.100.0, one block each. */

type Node = { id: string; data: { type: string; parent: string | null; nodes: string[] }; config?: Record<string, unknown>; specials?: Record<string, unknown>; style?: Record<string, unknown> };
type Doc = { root_node_id: string; nodes: Record<string, Node> };

const forms = (method: string, path: string, body: unknown) => {
  if (method === 'POST' && path === '/api/sites/s1/forms') return { form: { id: 'frm_1', name: 'contact', type: 'contact' } };
  if (method === 'PUT' && path === '/api/sites/s1/forms/frm_1') return { form: { id: 'frm_1', ...(body as object) } };
  return undefined;
};

/** A page whose ROOT reads `ids`, each a flex-section carrying `specials`. */
function page(kids: Array<[string, Record<string, unknown>]>): Doc {
  const d = blank() as unknown as Doc;
  d.nodes.ROOT.data.nodes = kids.map(([id]) => id);
  for (const [id, specials] of kids) d.nodes[id] = { id, data: { type: 'flex-section', parent: 'ROOT', nodes: [] }, specials };
  return d;
}

async function openDoc(d: Doc, extra?: Parameters<typeof fakePlatform>[0]) {
  const p = fakePlatform(extra);
  p.pages.set('pg_1', { document: d, rev: 1 });
  const c = await p.connect();
  await c.call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
  return { ...c, p, doc: () => p.pages.get('pg_1')!.document as Doc };
}

beforeEach(() => clearThemeCache());

describe('1. sb_store action:"form" + node_id places like sb_add, and a refused placement creates nothing', () => {
  const chrome = (): Doc =>
    page([
      ['hd', { globalId: 'g1', globalKind: 'header' }],
      ['sec', {}],
      ['ft', { globalId: 'g2', globalKind: 'footer' }],
      ['cart', { overlayId: 'ov_1' }],
    ]);

  it('node_id ROOT lands at the end of the middle band, ahead of the shared footer', async () => {
    const { call, close, doc } = await openDoc(chrome(), forms);
    try {
      const r = await call('sb_store', { action: 'form', site_id: 's1', template: 'contact', node_id: 'ROOT', dry_run: false });
      expect(r.isError, r.text).toBe(false);
      expect(r.json.page_failed).toBeUndefined();
      const id = (r.json.placed as { id: string }).id;
      const kids = doc().nodes.ROOT.data.nodes;
      expect(kids.indexOf(id)).toBe(kids.indexOf('ft') - 1);
    } finally {
      await close();
    }
  });

  it('a placement the save would refuse is refused BEFORE the form is created', async () => {
    // Already unstorable: a footer ahead of the middle band.
    const broken = page([
      ['ft', { globalId: 'g2', globalKind: 'footer' }],
      ['sec', {}],
    ]);
    const { call, close, p } = await openDoc(broken, forms);
    try {
      const r = await call('sb_store', { action: 'form', site_id: 's1', template: 'contact', node_id: 'sec', dry_run: false });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/refusing to save/);
      expect(p.writes.filter((w) => w.path.startsWith('/api/sites/s1/forms'))).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe('2. default_font is silent when a breakpoint carries its own fontFamily', () => {
  it('a per-breakpoint family is the author speaking', () => {
    const doc = PageDoc.from({
      schema_version: 2,
      root_node_id: 'ROOT',
      nodes: {
        ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['s'] }, specials: {} },
        s: { id: 's', data: { type: 'flex-section', parent: 'ROOT', nodes: ['a'] }, specials: {} },
        a: { id: 'a', data: { type: 'accordion', parent: 's', nodes: [] }, config: { accordionItemId: 'ai' }, specials: {} },
        ai: {
          id: 'ai',
          data: { type: 'accordion-item', parent: 'a', nodes: [] },
          style: { fontFamily: 'Inter' },
          responsive: { desktop: { style: { fontFamily: 'Be Vietnam Pro' } } },
          specials: {},
        },
      },
    } as never);
    expect(reviewDesign(doc, { fonts: { 'text-2': 'Be Vietnam Pro' } }).map((x) => x.code)).not.toContain('default_font');
  });
});

describe('3. sb_publish dry run says the cascade rule once per process', () => {
  it('a second dry run does not repeat cascade_note', async () => {
    const { call, close } = await openDoc(blank() as unknown as Doc);
    try {
      const first = await call('sb_publish', { site_id: 's1', page_id: 'pg_1' });
      expect(first.json.cascade_note).toMatch(/LAST PUBLISHED/);
      const second = await call('sb_publish', { site_id: 's1', page_id: 'pg_1' });
      expect(second.json.cascade_note).toBeUndefined();
    } finally {
      await close();
    }
  });
});

describe('4. sb_outline collapses shared header/footer and overlays only, and says so', () => {
  it('a custom middle-band global stays expanded; a collapsed line is marked', async () => {
    const d = page([
      ['hd', { globalId: 'g1', globalKind: 'header' }],
      ['mid', { globalId: 'g3', globalKind: 'custom' }],
      ['ft', { globalId: 'g2', globalKind: 'footer' }],
    ]);
    for (const p of ['hd', 'mid', 'ft']) {
      d.nodes[p].data.nodes = [`${p}_b`];
      d.nodes[`${p}_b`] = { id: `${p}_b`, data: { type: 'flex-block', parent: p, nodes: [] }, specials: {} };
    }
    const { call, close } = await openDoc(d);
    try {
      const lines = (await call('sb_outline', { depth: 2 })).json as unknown as Array<{ id: string; kids?: unknown[]; collapsed?: boolean }>;
      const at = (id: string) => lines.find((n) => n.id === id)!;
      expect(at('mid').kids).toHaveLength(1);
      expect(at('mid').collapsed).toBeUndefined();
      expect(at('hd').kids).toBeUndefined();
      expect(at('hd').collapsed).toBe(true);
      expect(at('ft').collapsed).toBe(true);
      const full = (await call('sb_outline', { depth: 2, chrome: true })).json as unknown as Array<{ id: string; collapsed?: boolean }>;
      expect(full.some((n) => n.collapsed)).toBe(false);
    } finally {
      await close();
    }
  });
});

describe('5. link_colour reads `color`, not background-color / border-color', () => {
  const codes = (html: string) => writeCheck('button', 'specials', { textHtml: html }).map((c) => c.note.code);
  it('a link with only a background or border colour still paints UA blue', () => {
    expect(codes('<a href="/p" style="background-color:#fff">x</a>')).toContain('link_colour');
    expect(codes('<a href="/p" style="border-color:#000">x</a>')).toContain('link_colour');
  });
  it('a real color declaration anywhere in the style is enough', () => {
    expect(codes('<a href="/p" style="color:#111">x</a>')).not.toContain('link_colour');
    expect(codes('<a href="/p" style="background-color:#fff;color:#111">x</a>')).not.toContain('link_colour');
    expect(codes("<a href='/p' style='font-weight:700; color: red'>x</a>")).not.toContain('link_colour');
  });
});

describe('6. a page-source 404 names the site and the key', () => {
  it('says the page may be on another site or outside the key, not only deleted', async () => {
    const f = (async () =>
      new Response(JSON.stringify({ error: 'source not found', code: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const err = (await loadSource({ base: 'http://x', fetchImpl: f, apiKey: 'wbk_x' } as never, 's9', 'pg_x').catch((e: Error) => e)) as Error;
    expect(err.message).toMatch(/page pg_x not found on site s9/);
    expect(err.message).toMatch(/not this site\/key/);
  });
});

describe('7. sb_duplicate keeps its copies map small', () => {
  it('a large subtree answers the top ids, a count and copies_truncated', async () => {
    const { call, close } = await openDoc(blank() as unknown as Doc);
    try {
      const cards = Array.from({ length: 60 }, () => ({ type: 'text' }));
      const add = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: { type: 'flex-section', children: [{ type: 'flex-block', children: cards }] } });
      const sec = Object.keys(add.json.added as Record<string, string>)[0];
      const r = await call('sb_duplicate', { id: sec, dry_run: false });
      expect(r.isError, r.text).toBe(false);
      expect(r.json.copies_truncated).toBe(true);
      expect(r.json.copied).toBe(62);
      expect(Object.keys(r.json.copies as object).length).toBeLessThanOrEqual(40);
      expect((r.json.copies as Record<string, unknown>)[sec]).toBeTruthy();
    } finally {
      await close();
    }
  });
});
