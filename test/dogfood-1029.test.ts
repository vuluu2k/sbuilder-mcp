import { describe, it, expect, beforeEach } from 'vitest';
import { fakePlatform, blank } from './helpers/platform.js';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { readinessGaps, type ReadinessInput } from '../src/domains/site/readiness.js';
import { writeCheck } from '../src/domains/site/writecheck.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { PageDoc } from '../src/domains/site/document.js';
import { searchOperations } from '../src/catalog/search.js';
import { clearThemeCache } from '../src/domains/site/theme-fetch.js';

/**
 * TTG GAPS #46–#59, found by a fresh agent building a throwaway QA page on a
 * Vietnamese store (2026-10-29). Each block names its gap.
 */

type Node = { id: string; data: { type: string; parent: string | null; nodes: string[] }; config?: Record<string, unknown>; specials?: Record<string, unknown> };
type Doc = { root_node_id: string; nodes: Record<string, Node> };

const locale = (l: string) => (method: string, path: string) =>
  method === 'GET' && path === '/api/sites/s1/settings' ? { settings: { locale: l } } : undefined;

async function open(extra?: Parameters<typeof fakePlatform>[0]) {
  const p = fakePlatform(extra);
  const c = await p.connect();
  await c.call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
  return { ...c, p, doc: () => p.pages.get('pg_1')!.document as Doc };
}

beforeEach(() => clearThemeCache());

/* #46 ---------------------------------------------------------------------- */

describe('#46 sb_add localizes the seed copy it mints, by the site locale', () => {
  const list = { type: 'flex-section', children: [{ type: 'list-dataset' }] };
  const texts = (d: Doc) => Object.values(d.nodes).map((n) => n.specials?.text).filter(Boolean);

  it('a vi site gets the Vietnamese empty state, like sb_page_create', async () => {
    const { call, close, doc } = await open(locale('vi'));
    try {
      const r = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: list });
      expect(r.isError, r.text).toBe(false);
      expect(texts(doc())).toContain('Chưa có sản phẩm');
      expect(texts(doc())).not.toContain('No products yet');
    } finally {
      await close();
    }
  });

  it('an en site keeps the English seed', async () => {
    const { call, close, doc } = await open(locale('en'));
    try {
      await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: list });
      expect(texts(doc())).toContain('No products yet');
    } finally {
      await close();
    }
  });
});

/* #47 ---------------------------------------------------------------------- */

describe('#47 a media-dataset in a card is a single image', () => {
  it('sb_add seeds layout:"single" inside a dataset-block, as the editor card palette does', async () => {
    const { call, close, doc } = await open();
    try {
      const r = await call('sb_add', {
        parent_id: 'ROOT',
        dry_run: false,
        spec: {
          type: 'flex-section',
          children: [
            { type: 'list-dataset', children: [{ type: 'dataset-block', children: [{ type: 'media-dataset', config: { datasetSource: 'product' } }] }] },
            { type: 'media-dataset' },
          ],
        },
      });
      expect(r.isError, r.text).toBe(false);
      const media = Object.values(doc().nodes).filter((n) => n.data.type === 'media-dataset');
      const inCard = media.find((n) => doc().nodes[n.data.parent!].data.type === 'dataset-block')!;
      const alone = media.find((n) => n !== inCard)!;
      expect(inCard.config?.layout).toBe('single');
      expect(alone.config?.layout).not.toBe('single');
      // An explicit layout is the caller's.
      const g = await call('sb_add', {
        parent_id: 'ROOT',
        dry_run: false,
        spec: { type: 'flex-section', children: [{ type: 'list-dataset', children: [{ type: 'dataset-block', children: [{ type: 'media-dataset', config: { layout: 'grid' } }] }] }] },
      });
      expect(g.isError, g.text).toBe(false);
      expect(Object.values(doc().nodes).some((n) => n.data.type === 'media-dataset' && n.config?.layout === 'grid')).toBe(true);
    } finally {
      await close();
    }
  });

  it('sb_traits_for control:"layout" names the key it writes and its values', async () => {
    const { call, close } = await open();
    try {
      const r = (await call('sb_traits_for', { type: 'media-dataset', control: 'layout' })).json;
      expect(r.writes).toEqual([{ target: 'config', writeKey: 'layout' }]);
      expect(r.values).toContain('single');
    } finally {
      await close();
    }
  });
});

/* #48 + #49 ---------------------------------------------------------------- */

describe('#48 #49 sb_review judges the open draft, and a noIndex page is not an orphan', () => {
  const home = { id: 'pg_home', type: 'page', status: 'published', name: 'Trang chủ', path: '/', isHomepage: true, settings: { title: 't', description: 'd' } };
  const gaps = (extra: Partial<ReadinessInput>) =>
    readinessGaps({
      liveGateways: null,
      shippingMethods: null,
      pageNodes: [],
      globalNodes: [],
      globalKinds: ['header'],
      menuLinks: { pageIds: [], hrefs: [] },
      ...extra,
    } as never);

  it('the OPEN draft page is judged for SEO and reach before its first publish', () => {
    const draft = { id: 'pg_qa', type: 'page', status: 'draft', name: 'QA', path: '/qa', settings: {} };
    const ids = gaps({ pages: [home, draft], openPageId: 'pg_qa' }).map((g) => g.id);
    expect(ids).toContain('pageSeo');
    expect(ids).toContain('unreachablePage');
    const seo = gaps({ pages: [home, draft], openPageId: 'pg_qa' }).find((g) => g.id === 'pageSeo')!;
    expect(seo.problem).not.toMatch(/published page/);
    expect(seo.problem).toMatch(/draft/);
    // Another draft is still nobody's business.
    expect(gaps({ pages: [home, draft], openPageId: 'pg_home' }).map((g) => g.id)).not.toContain('pageSeo');
  });

  it('a noIndex page is left out of unreachablePage, and the fix says how to clear it', () => {
    const landing = { id: 'pg_ad', type: 'page', status: 'published', name: 'Ads', path: '/ads', settings: { title: 't', description: 'd' } };
    const hit = gaps({ pages: [home, landing] }).find((g) => g.id === 'unreachablePage')!;
    expect(hit.fix).toMatch(/noIndex/);
    const kept = { ...landing, settings: { ...landing.settings, noIndex: true } };
    expect(gaps({ pages: [home, kept] }).map((g) => g.id)).not.toContain('unreachablePage');
  });
});

/* #50 ---------------------------------------------------------------------- */

describe('#50 a link in rich text paints the browser default blue', () => {
  const codes = (html: string) => writeCheck('text', 'specials', { textHtml: html }).map((c) => c.note.code);
  it('warns on an <a> with no colour of its own', () => {
    const n = writeCheck('text', 'specials', { textHtml: 'Xem <a href="/p">trang chính sách</a>' }, { id: 't1' }).find((c) => c.note.code === 'link_colour');
    expect(n?.note.problem).toMatch(/blue/);
    expect(n?.note.fix).toMatch(/style="color:/);
  });
  it('is silent when the link carries a colour, or there is no link', () => {
    expect(codes('<a href="/p" style="color:inherit">x</a>')).not.toContain('link_colour');
    expect(codes('<a href="/p" style="text-decoration:none; color:#2e86ae">x</a>')).not.toContain('link_colour');
    expect(codes('<b>x</b>')).not.toContain('link_colour');
  });
  it('sb_review reports it on a page that already carries one', () => {
    const doc = PageDoc.from({
      schema_version: 2,
      root_node_id: 'ROOT',
      nodes: {
        ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['s'] }, specials: {} },
        s: { id: 's', data: { type: 'flex-section', parent: 'ROOT', nodes: ['t'] }, specials: {} },
        t: { id: 't', data: { type: 'text', parent: 's', nodes: [] }, specials: { text: 'x', textHtml: 'Xem <a href="/p">đây</a>' } },
      },
    } as never);
    expect(reviewDesign(doc).map((f) => f.code)).toContain('link_colour');
  });
});

/* #51 ---------------------------------------------------------------------- */

describe('#51 an accordion header still in the element\'s literal Inter on a themed site', () => {
  const doc = () =>
    PageDoc.from({
      schema_version: 2,
      root_node_id: 'ROOT',
      nodes: {
        ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['s'] }, specials: {} },
        s: { id: 's', data: { type: 'flex-section', parent: 'ROOT', nodes: ['a'] }, specials: {} },
        a: { id: 'a', data: { type: 'accordion', parent: 's', nodes: [] }, config: { accordionItemId: 'ai' }, specials: {} },
        ai: { id: 'ai', data: { type: 'accordion-item', parent: 'a', nodes: [] }, style: { fontFamily: 'Inter' }, specials: {} },
      },
    } as never);
  it('is reported when the theme body font is another family', () => {
    const f = reviewDesign(doc(), { bodyFont: 'Be Vietnam Pro' }).find((x) => x.code === 'default_font');
    expect(f?.nodeId).toBe('ai');
    expect(f?.problem).toMatch(/Be Vietnam Pro/);
  });
  it('is silent when the theme is Inter too, or unknown', () => {
    expect(reviewDesign(doc(), { bodyFont: 'Inter' }).map((x) => x.code)).not.toContain('default_font');
    expect(reviewDesign(doc()).map((x) => x.code)).not.toContain('default_font');
  });
});

/* #52 ---------------------------------------------------------------------- */

describe('#52 routine reads stay small', () => {
  it('sb_outline collapses a shared header to one line unless chrome:true', async () => {
    const { call, close, p } = await open();
    try {
      const d = blank() as unknown as Doc;
      d.nodes.ROOT.data.nodes = ['h', 's'];
      d.nodes.h = { id: 'h', data: { type: 'flex-section', parent: 'ROOT', nodes: ['hb'] }, specials: { globalId: 'g1', globalKind: 'header' } };
      d.nodes.hb = { id: 'hb', data: { type: 'flex-block', parent: 'h', nodes: [] }, specials: {} };
      d.nodes.s = { id: 's', data: { type: 'flex-section', parent: 'ROOT', nodes: [] }, specials: {} };
      p.pages.set('pg_2', { document: d, rev: 1 });
      await call('sb_page_open', { site_id: 's1', page_id: 'pg_2' });
      const lean = (await call('sb_outline', { depth: 3 })).json as unknown as Array<{ id: string; kids?: unknown[] }>;
      expect(lean.find((n) => n.id === 'h')!.kids).toBeUndefined();
      const full = (await call('sb_outline', { depth: 3, chrome: true })).json as unknown as Array<{ id: string; kids?: unknown[] }>;
      expect(full.find((n) => n.id === 'h')!.kids).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it('sb_traits_for says the hints and the animation vocabulary once per process', async () => {
    const { client, close } = await connectedClient();
    const size = async () =>
      ((await client.callTool({ name: 'sb_traits_for', arguments: { type: 'list-dataset' } })) as { content: Array<{ text?: string }> }).content[0].text!.length;
    const first = await size();
    const second = await size();
    expect(second).toBeLessThan(first - 5_000);
    expect(second).toBeLessThan(9_000);
    await close();
  });

  it('sb_node_read omits the inert backgroundScene* defaults of a section with no scene', async () => {
    const { call, close } = await open();
    try {
      const add = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: { type: 'flex-section' } });
      const id = Object.keys(add.json.added as Record<string, string>)[0];
      const r = await call('sb_node_read', { id });
      expect(JSON.stringify(r.json.node)).not.toMatch(/backgroundScene/);
      expect(r.json.node).toBeTruthy();
    } finally {
      await close();
    }
  });
});

/* #53 ---------------------------------------------------------------------- */

describe('#53 writes say which id became what', () => {
  it('sb_add maps ids to types and keeps satellites apart', async () => {
    const { call, close } = await open(locale('vi'));
    try {
      const r = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: { type: 'flex-section', children: [{ type: 'list-dataset' }] } });
      const added = r.json.added as Record<string, string>;
      expect(Object.values(added).slice(0, 2)).toEqual(['flex-section', 'list-dataset']);
      const sats = r.json.satellites as Record<string, string>;
      expect(Object.values(sats)).toContain('list-empty');
      for (const id of Object.keys(sats)) expect(added[id]).toBeUndefined();
    } finally {
      await close();
    }
  });

  it('sb_duplicate returns every copy, old → [new, type]', async () => {
    const { call, close, doc } = await open();
    try {
      const add = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: { type: 'flex-section', children: [{ type: 'heading' }, { type: 'text' }] } });
      const [sec, h, t] = Object.keys(add.json.added as Record<string, string>);
      const r = await call('sb_duplicate', { id: sec, dry_run: false });
      const copies = r.json.copies as Record<string, [string, string]>;
      expect(Object.keys(copies)).toEqual([sec, h, t]);
      expect(copies[t][1]).toBe('text');
      expect(doc().nodes[copies[t][0]].data.type).toBe('text');
    } finally {
      await close();
    }
  });

  it('sb_outline shows an accordion row\'s label', () => {
    const d = PageDoc.from({
      schema_version: 2,
      root_node_id: 'ROOT',
      nodes: {
        ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['a'] }, specials: {} },
        a: { id: 'a', data: { type: 'accordion', parent: 'ROOT', nodes: ['c'] }, specials: {} },
        c: { id: 'c', data: { type: 'accordion-content', parent: 'a', nodes: [] }, specials: { label: 'Bảo hành bao lâu?' } },
      },
    } as never);
    const o = d.outline({ depth: 2 }) as unknown as Array<{ kids: Array<{ label?: string }> }>;
    expect(o[0].kids[0].label).toBe('Bảo hành bao lâu?');
  });
});

/* #54 ---------------------------------------------------------------------- */

describe('#54 sb_undo says what each write was, and lists the open page', () => {
  it('entries carry the tool and a summary; another page is counted, not listed', async () => {
    const { call, close, p } = await open();
    try {
      const add = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: { type: 'flex-section' } });
      const id = Object.keys(add.json.added as Record<string, string>)[0];
      await call('sb_remove', { id, dry_run: false });
      const list = (await call('sb_undo', {})).json.undoable as Array<{ index: number; tool: string; summary: string }>;
      expect(list[0]).toMatchObject({ index: 1, tool: 'sb_remove' });
      expect(list[0].summary).toContain(id);
      expect(list[1].tool).toBe('sb_add');

      p.pages.set('pg_2', { document: blank(), rev: 1 });
      await call('sb_page_open', { site_id: 's1', page_id: 'pg_2' });
      await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: { type: 'flex-section' } });
      const scoped = (await call('sb_undo', {})).json;
      expect((scoped.undoable as unknown[]).length).toBe(1);
      expect(scoped.other_pages).toBe(2);
      const all = (await call('sb_undo', { all: true })).json;
      expect((all.undoable as unknown[]).length).toBe(3);
    } finally {
      await close();
    }
  });
});

/* #55 ---------------------------------------------------------------------- */

describe('#55 sb_set unset in edits[] needs no keys and says what it removed', () => {
  it('echoes the removed key, and names one that was not there', async () => {
    const { call, close } = await open();
    try {
      const add = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: { type: 'flex-section', children: [{ type: 'button', specials: { href: '/x' } }] } });
      const btn = Object.keys(add.json.added as Record<string, string>)[1];
      const r = await call('sb_set', { dry_run: false, edits: [{ id: btn, namespace: 'specials', unset: ['href', 'nope'] }] });
      expect(r.isError, r.text).toBe(false);
      expect((r.json.set as Array<Record<string, unknown>>)[0]).toMatchObject({ id: btn, unset: ['href'], absent: ['nope'] });
    } finally {
      await close();
    }
  });
});

/* #56 + #57 ---------------------------------------------------------------- */

function gonePlatform() {
  let gone = false;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const f = (async (input: string | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/source')) {
      if (gone) return json({ error: 'source not found', code: 'not_found' }, 404);
      return json({ source: { pageId: 'pg_1', siteId: 's1', document: blank(), schemaVersion: 2, rev: 1, updatedAt: 'now' } });
    }
    void init;
    return json({});
  }) as unknown as typeof fetch;
  return { f, kill: () => (gone = true) };
}

describe('#56 #57 sb_page_state', () => {
  it('the recovery note says autosaves fold, not that every save appends', async () => {
    const { call, close } = await open();
    try {
      const r = await call('sb_page_state', {});
      const note = (r.json.recovery as { note: string }).note;
      expect(note).not.toMatch(/EVERY draft save/);
      expect(note).toMatch(/5 min/);
    } finally {
      await close();
    }
  });

  it('a deleted open page is named as deleted, not a bare 404', async () => {
    const { f, kill } = gonePlatform();
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({ fetchImpl: f, session, siteId: 's1' });
    try {
      await client.callTool({ name: 'sb_page_open', arguments: { page_id: 'pg_1' } });
      kill();
      const r = (await client.callTool({ name: 'sb_page_state', arguments: {} })) as { isError?: boolean; content: Array<{ text?: string }> };
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toMatch(/no longer exists/);
      expect(r.content[0].text).toMatch(/sb_page_open/);
    } finally {
      await close();
    }
  });
});

/* #58 ---------------------------------------------------------------------- */

describe('#58 sb_store action:"form" can place the form on the open page', () => {
  it('node_id puts a form node bound to the new form inside that node', async () => {
    const forms = (method: string, path: string, body: unknown) => {
      if (method === 'POST' && path === '/api/sites/s1/forms') return { form: { id: 'frm_1', name: 'contact', type: 'contact' } };
      if (method === 'PUT' && path === '/api/sites/s1/forms/frm_1') return { form: { id: 'frm_1', ...(body as object) } };
      return undefined;
    };
    const { call, close, doc } = await open(forms);
    try {
      const add = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: { type: 'flex-section' } });
      const sec = Object.keys(add.json.added as Record<string, string>)[0];
      const r = await call('sb_store', { action: 'form', site_id: 's1', template: 'contact', node_id: sec, dry_run: false });
      expect(r.isError, r.text).toBe(false);
      const form = Object.values(doc().nodes).find((n) => n.data.type === 'form')!;
      expect(form.specials?.formId).toBe('frm_1');
      expect(form.data.parent).toBe(sec);
      expect((r.json.placed as { id: string }).id).toBe(form.id);
    } finally {
      await close();
    }
  });
});

/* #59 ---------------------------------------------------------------------- */

describe('#59 discovery nits', () => {
  it('"list categories" does not rank wishlist-demand first — a word, not a substring', () => {
    const ids = searchOperations('list categories').map((o) => o.id);
    expect(ids).not.toContain('get:/api/sites/{siteId}/wishlist-demand');
    expect(ids).toContain('get:/api/sites/{siteId}/product-categories');
  });

  it('sb_publish dry run says what a cascade would add', async () => {
    const { call, close } = await open();
    try {
      const r = await call('sb_publish', { site_id: 's1', page_id: 'pg_1' });
      expect(r.json.cascade_note).toMatch(/LAST PUBLISHED/);
    } finally {
      await close();
    }
  });
});
