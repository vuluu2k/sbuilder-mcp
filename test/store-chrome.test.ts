import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import { PageDoc } from '../src/domains/site/document.js';
import { reviewDesign } from '../src/domains/site/review.js';

type Node = { id: string; data: { type: string; parent: string | null; nodes: string[] }; [k: string]: any };
type Doc = { schema_version: number; root_node_id: string; nodes: Record<string, Node> };

const blank = (): Doc => ({
  schema_version: 2,
  root_node_id: 'ROOT',
  nodes: {
    ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['sec'] } },
    sec: { id: 'sec', data: { type: 'flex-section', parent: 'ROOT', nodes: [] }, style: {} },
  },
});

/**
 * A fresh store: a home page, an about page, a policy page, the product
 * template, one category holding a product and one empty. No menu, no chrome.
 */
function store(opts: { menus?: Array<{ id: string; name: string; items: unknown[] }>; overlays?: Array<{ id: string; kind: string }> } = {}) {
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  const overlays = [...(opts.overlays ?? [])];
  const menus = [...(opts.menus ?? [])];
  const globals: Array<{ id: string; kind: string; document: Doc }> = [];
  const pages = [
    { id: 'pg_home', slug: '', path: '/', name: 'Trang chủ', isHomepage: true, type: 'page' },
    { id: 'pg_about', slug: 'gioi-thieu', path: '/gioi-thieu', name: 'Giới thiệu', type: 'about' },
    { id: 'pg_pol', slug: 'chinh-sach', path: '/chinh-sach', name: 'Chính sách', type: 'policy' },
    { id: 'pg_prod', slug: 'product', path: '/product', name: 'Product', type: 'product', isDefaultTemplate: true },
  ];
  const docs: Record<string, Doc> = Object.fromEntries(pages.map((p) => [p.id, blank()]));
  const f = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    const src = /\/pages\/([^/]+)\/source$/.exec(path);
    if (src) {
      if (method === 'PUT') docs[src[1]] = body.document;
      return json({ source: { pageId: src[1], document: docs[src[1]], schemaVersion: 2 } });
    }
    if (path.endsWith('/pages')) return json({ pages });
    if (path.endsWith('/global-sections') && method === 'GET') return json({ globalSections: globals });
    if (path.endsWith('/global-sections') && method === 'POST') {
      globals.push({ id: `g${globals.length + 1}`, kind: body.kind, document: body.document });
      return json({ globalSection: { id: `g${globals.length}` } }, 201);
    }
    if (/\/global-sections\/[^/]+\/pages$/.test(path)) return json({ pages: [] });
    if (path.endsWith('/overlays') && method === 'GET') return json({ overlays });
    if (path.endsWith('/overlays') && method === 'POST') {
      overlays.push({ id: `ov${overlays.length + 1}`, kind: body.kind });
      return json({ overlay: { id: `ov${overlays.length}` } }, 201);
    }
    if (path.endsWith('/menus') && method === 'GET') return json({ menus });
    if (path.endsWith('/menus') && method === 'POST') {
      const withIds = (items: any[], pre: string): any[] =>
        items.map((it, i) => ({ ...it, id: `${pre}${i}`, items: withIds(it.items ?? [], `${pre}${i}_`) }));
      const m = { id: `mn_${menus.length + 1}`, name: body.name, items: withIds(body.items, `it${menus.length}_`) };
      menus.push(m);
      return json({ menu: m }, 201);
    }
    const one = /\/menus\/([^/]+)$/.exec(path);
    if (one && method === 'PUT') {
      const m = menus.find((x) => x.id === one[1])!;
      m.items = body.items;
      return json({ menu: m });
    }
    if (one) return json({ menu: menus.find((m) => m.id === one[1]) });
    if (path.endsWith('/product-categories')) {
      return json({
        categories: [
          { id: 'c1', name: 'Áo', slug: 'ao', parentId: '' },
          { id: 'c2', name: 'Trống', slug: 'trong', parentId: '' },
        ],
      });
    }
    if (path.endsWith('/product-categories/c1/products')) return json({ products: [{ id: 'p1', name: 'Áo thun', slug: 'ao-thun' }] });
    if (/\/product-categories\/[^/]+\/products$/.test(path)) return json({ products: [] });
    if (path.endsWith('/products')) return json({ products: [{ id: 'p1', slug: 'ao-thun' }] });
    return json({});
  }) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  return {
    calls,
    globals,
    menus,
    overlays,
    ctx: { base: 'http://x', session, fetchImpl: f, notices: new Notices(), undo: new UndoLog(), siteId: 's1' },
  };
}

const parse = (r: unknown) => JSON.parse((r as { content: Array<{ text: string }> }).content[0].text);
const ofType = (d: Doc, t: string) => Object.values(d.nodes).filter((n) => n.data.type === t);
const links = (items: any[]): any[] => items.flatMap((i) => [i.link, ...links(i.items ?? [])]);

describe('sb_store action:"chrome" builds a real header', () => {
  it('creates a site menu of references and a header bound to it', async () => {
    const { calls, globals, ctx } = store();
    const { client, close } = await connectedClient(ctx);
    await client.callTool({ name: 'sb_store', arguments: { action: 'chrome', dry_run: false } });

    const post = calls.filter((c) => c.method === 'POST' && c.path === '/api/sites/s1/menus');
    expect(post.length).toBe(1);
    const all = links(post[0].body.items);
    expect(all).toContainEqual({ type: 'page', pageId: 'pg_home' });
    expect(all).toContainEqual({ type: 'productCategory', entityId: 'c1' });
    expect(all).toContainEqual({ type: 'product', entityId: 'p1' });
    // Ids, never addresses; no template page and no empty category.
    expect(all.filter((l) => l.type === 'url')).toEqual([]);
    expect(all.find((l) => l.pageId === 'pg_prod' || l.entityId === 'c2')).toBeUndefined();

    const header = globals[0].document;
    expect(header.nodes[header.root_node_id].specials.stylePreset).toBe('section-wide');
    const [desktop, drawerMenu] = ofType(header, 'menu').sort((a) =>
      header.nodes[a.data.parent!].data.type === 'menu-drawer' ? 1 : -1,
    );
    expect(desktop.specials.menuId).toBe('mn_1');
    expect(desktop.config).toMatchObject({ expandType: 'hover', submenuStyle: 'dropdown' });
    expect(desktop.responsive.mobile.config.hidden).toBe(true);
    expect(desktop.specials.menuItems.map((r: any) => r.href)).toContain('/collections/ao');
    expect(drawerMenu.specials.menuId).toBe('mn_1');
    expect(drawerMenu.config.submenuStyle).toBe('collapse');
    const burger = ofType(header, 'hamburger-menu')[0];
    expect(burger.config.hidden).toBe(true);
    expect(burger.responsive.mobile?.config?.hidden).not.toBe(true);
    expect(ofType(header, 'icon').some((i) => i.events?.[0]?.action === 'close_menu')).toBe(true);

    const cart = ofType(header, 'icon').find((i) => i.events?.[0]?.action === 'open_cart')!;
    const badge = header.nodes[cart.config.cartCountId];
    expect(badge.data.type).toBe('cart-count');
    expect(badge.data.parent).toBe(cart.id);
    const account = ofType(header, 'icon').find((i) => i.events?.[0]?.action === 'go_to_url')!;
    expect(account.specials.href).toBe('/account');

    // What sb_review reads once the master is composed onto a page.
    const nodes: Record<string, any> = JSON.parse(JSON.stringify(header.nodes));
    nodes[header.root_node_id].specials.globalId = 'g1';
    nodes[header.root_node_id].specials.globalKind = 'header';
    nodes[header.root_node_id].data.parent = 'rt';
    nodes.rt = { id: 'rt', data: { type: 'root', parent: null, nodes: [header.root_node_id] } };
    const composed = PageDoc.from({ schema_version: 2, root_node_id: 'rt', nodes } as never);
    expect(reviewDesign(composed).filter((f) => f.code === 'handbuilt_menu')).toEqual([]);
    await close();
  });

  it('a re-run creates no second menu', async () => {
    const { calls, ctx } = store();
    const { client, close } = await connectedClient(ctx);
    await client.callTool({ name: 'sb_store', arguments: { action: 'chrome', dry_run: false } });
    await client.callTool({ name: 'sb_store', arguments: { action: 'chrome', dry_run: false } });
    expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/menus')).length).toBe(1);
    await close();
  });

  it('reuses a site menu of the same name rather than making a duplicate', async () => {
    const { calls, globals, ctx } = store({ menus: [{ id: 'mn_x', name: 'Main menu', items: [] }] });
    const { client, close } = await connectedClient(ctx);
    await client.callTool({ name: 'sb_store', arguments: { action: 'chrome', dry_run: false } });
    expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/menus'))).toEqual([]);
    expect(ofType(globals[0].document, 'menu')[0].specials.menuId).toBe('mn_x');
    await close();
  });

  const placeholder = ['Home', 'Categories', 'Contact', 'About us'].map((label, i) => ({
    id: `ph${i}`,
    label,
    link: { type: 'none' },
  }));

  it('fills a reused menu whose every row is a placeholder with the real links', async () => {
    const { calls, menus, ctx } = store({ menus: [{ id: 'mn_x', name: 'Main menu', items: placeholder }] });
    const { client, close } = await connectedClient(ctx);
    const out = parse(await client.callTool({ name: 'sb_store', arguments: { action: 'chrome', dry_run: false } }));
    const put = calls.filter((c) => c.method === 'PUT' && c.path === '/api/sites/s1/menus/mn_x');
    expect(put.length).toBe(1);
    expect(links(put[0].body.items)).toContainEqual({ type: 'page', pageId: 'pg_home' });
    expect(links(menus[0].items).every((l: any) => l.type !== 'none')).toBe(true);
    expect(out.menus[0]).toMatchObject({ id: 'mn_x', filled: true });
    await close();
  });

  it("keeps the merchant's own linked menu exactly as it is", async () => {
    const own = [
      { id: 'o1', label: 'Shop', link: { type: 'page', pageId: 'pg_home' } },
      { id: 'o2', label: 'Blog', link: { type: 'none' } },
    ];
    const { calls, menus, ctx } = store({ menus: [{ id: 'mn_x', name: 'Main menu', items: own }] });
    const { client, close } = await connectedClient(ctx);
    const out = parse(await client.callTool({ name: 'sb_store', arguments: { action: 'chrome', dry_run: false } }));
    expect(calls.filter((c) => c.method === 'PUT' && c.path.includes('/menus/'))).toEqual([]);
    expect(menus[0].items).toBe(own);
    expect(out.menus[0]).toMatchObject({ id: 'mn_x', reused: true });
    await close();
  });

  it('dry run shows the rows of a menu it would reuse, and what it would fill', async () => {
    const { calls, ctx } = store({ menus: [{ id: 'mn_x', name: 'Main menu', items: placeholder }] });
    const { client, close } = await connectedClient(ctx);
    const out = parse(await client.callTool({ name: 'sb_store', arguments: { action: 'chrome' } }));
    expect(out.menus[0]).toMatchObject({ name: 'Main menu', would: 'fill', id: 'mn_x' });
    expect(out.menus[0].rows.map((r: any) => r.label)).toEqual(['Home', 'Categories', 'Contact', 'About us']);
    expect(out.menus[0].items.length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
    await close();
  });

  it('dry run names the menus it would create and the header it would build, and sends nothing', async () => {
    const { calls, ctx } = store();
    const { client, close } = await connectedClient(ctx);
    const out = parse(await client.callTool({ name: 'sb_store', arguments: { action: 'chrome' } }));
    expect(out.dry_run).toBe(true);
    expect(out.menus[0]).toMatchObject({ name: 'Main menu', would: 'create' });
    expect(JSON.stringify(out.tree)).toMatch(/hamburger-menu/);
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
    await close();
  });

  it('the header\'s cart icon opens something: a site with no cart drawer gets one', async () => {
    const { calls, overlays, ctx } = store();
    const { client, close } = await connectedClient(ctx);
    const dry = parse(await client.callTool({ name: 'sb_store', arguments: { action: 'chrome' } }));
    expect(dry.cart).toMatchObject({ dry_run: true });
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
    const out = parse(await client.callTool({ name: 'sb_store', arguments: { action: 'chrome', dry_run: false } }));
    expect(overlays.filter((o) => o.kind === 'cart').length).toBe(1);
    expect(out.cart).toMatchObject({ created: true });
    await close();
  });

  it('a site that has its cart drawer keeps it, and gets no second one', async () => {
    const { overlays, ctx } = store({ overlays: [{ id: 'ov_c', kind: 'cart' }] });
    const { client, close } = await connectedClient(ctx);
    const out = parse(await client.callTool({ name: 'sb_store', arguments: { action: 'chrome', dry_run: false } }));
    expect(overlays.length).toBe(1);
    expect(out.cart).toMatchObject({ overlay_id: 'ov_c', created: false });
    await close();
  });

  it('a footer is columns of vertical menus', async () => {
    const { globals, ctx } = store();
    const { client, close } = await connectedClient(ctx);
    await client.callTool({ name: 'sb_store', arguments: { action: 'chrome', footer: true, dry_run: false } });
    const footer = globals[0].document;
    const cols = ofType(footer, 'menu');
    expect(cols.length).toBeGreaterThanOrEqual(2);
    for (const m of cols) {
      expect(m.style.flexDirection).toBe('column');
      expect(m.specials.menuId).toMatch(/^mn_/);
    }
    await close();
  });
});
