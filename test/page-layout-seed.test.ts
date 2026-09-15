import { describe, it, expect } from 'vitest';
import { layoutForPageName, USUAL_PAGES } from '../src/domains/site/inventory.js';
import { layoutDocument, layoutNames } from '../src/domains/site/storepage.js';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

describe('layoutForPageName', () => {
  // THE MEASURED GAP. Every content page is type `page`, so the type-keyed seed
  // table gave About, a policy and an FAQ the same blank canvas.
  it('reads a page name in either language', () => {
    expect(layoutForPageName('Giới thiệu', 'page')).toBe('about');
    expect(layoutForPageName('About us', 'page')).toBe('about');
    expect(layoutForPageName('Chính sách bảo mật', 'page')).toBe('policy');
    expect(layoutForPageName('Shipping and returns', 'page')).toBe('policy');
    expect(layoutForPageName('Câu hỏi thường gặp', 'page')).toBe('faq');
    expect(layoutForPageName('FAQ', 'page')).toBe('faq');
  });

  // ONLY FOR `page`. Every other type already opens with its own seed, and a
  // name-based guess on top would contradict a decision already made.
  it('never overrules a typed seed', () => {
    expect(layoutForPageName('Giới thiệu sản phẩm', 'product')).toBeUndefined();
    expect(layoutForPageName('Giới thiệu', 'blog')).toBeUndefined();
  });

  // THE AUTH PAGES HAVE NO LAYOUT, on purpose: sb_store builds them with a real
  // form on the page, and a blank-form layout would be a second, worse door.
  it('leaves the form pages to the form flow', () => {
    expect(layoutForPageName('Đăng nhập', 'page')).toBeUndefined();
    expect(layoutForPageName('Liên hệ', 'page')).toBeUndefined();
  });

  it('says nothing about a name it does not recognise', () => {
    expect(layoutForPageName('Quà tặng doanh nghiệp', 'page')).toBeUndefined();
  });

  // THE TWO TABLES CANNOT DRIFT: every layout a purpose names must be one this
  // build actually carries, or a page is told to open as something that is not
  // there and quietly opens blank.
  it('names only layouts the catalog carries', () => {
    const carried = layoutNames();
    expect(carried.length).toBeGreaterThan(0);
    for (const u of USUAL_PAGES) {
      if (u.layout) expect(carried, u.key).toContain(u.layout);
    }
  });

  it('builds a real document for each', () => {
    for (const id of layoutNames()) {
      const doc = layoutDocument(id)!;
      expect(doc, id).toBeTruthy();
      expect(Object.keys(doc.nodes).length, id).toBeGreaterThan(1);
    }
    expect(layoutDocument('nonsense')).toBeNull();
  });
});

describe('sb_page_create opens a content page as something', () => {
  function platform() {
    const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
    const f = (async (url: unknown, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const method = init?.method ?? 'GET';
      calls.push({
        method, path,
        ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}),
      });
      const json = (v: unknown, s = 200) =>
        new Response(JSON.stringify(v), { status: s, headers: { 'content-type': 'application/json' } });
      if (path.endsWith('/pages') && method === 'POST') return json({ page: { id: 'pg_1' } }, 201);
      if (path.endsWith('/pages')) return json({ pages: [] });
      return json({});
    }) as unknown as typeof fetch;
    return { f, calls };
  }

  async function create(f: typeof fetch, args: Record<string, unknown>) {
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({
      base: 'http://x', session, fetchImpl: f,
      notices: new Notices(), undo: new UndoLog(), siteId: 's1',
    });
    try {
      const res = (await client.callTool({ name: 'sb_page_create', arguments: args })) as {
        content: Array<{ text: string }>;
      };
      return JSON.parse(res.content[0].text) as Record<string, unknown>;
    } finally {
      await close();
    }
  }

  // PROVING THE WIRING. layoutForPageName's own tests pass whether or not
  // sb_page_create ever calls it.
  it('seeds the layout its name implies', async () => {
    const h = platform();
    const body = await create(h.f, {
      site_id: 's1', name: 'Câu hỏi thường gặp', chrome: false, dry_run: false,
    });
    expect((body.seeded as { layout?: string })?.layout).toBe('faq');
    const put = h.calls.find((c) => c.method === 'PUT' && c.path.endsWith('/source'));
    expect(JSON.stringify(put?.body)).toContain('"accordion"');
  });

  // THE LIVENESS ANCHOR. A name with no layout must still create an ordinary
  // blank page — otherwise this is a tool that seeds everything.
  it('leaves an unrecognised name blank', async () => {
    const h = platform();
    const body = await create(h.f, {
      site_id: 's1', name: 'Quà tặng doanh nghiệp', chrome: false, dry_run: false,
    });
    expect(body.seeded).toBeUndefined();
    expect(h.calls.some((c) => c.method === 'PUT' && c.path.endsWith('/source'))).toBe(false);
  });

  it('honours seed:false, which has always meant blank', async () => {
    const h = platform();
    const body = await create(h.f, {
      site_id: 's1', name: 'Giới thiệu', seed: false, chrome: false, dry_run: false,
    });
    expect(body.seeded).toBeUndefined();
  });

  it('says so in a dry run', async () => {
    const body = await create(platform().f, { site_id: 's1', name: 'Giới thiệu' });
    expect(body.would_open_as).toBe('about');
  });
});
