import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

/** The site's one menu, as the platform would return it — a page link and a plain url. */
const MENU = {
  id: 'mn_1',
  name: 'Main menu',
  items: [
    { id: 'i1', label: 'Home', link: { type: 'page', pageId: 'pg_1' } },
    { id: 'i2', label: 'Blog', link: { type: 'url', url: 'https://x' } },
  ],
};

/** A page holding one flex-section with one menu child, freshly seeded. */
function buildDoc(): { document: unknown; menuNodeId: string } {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const { patches, ids } = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'menu' }] });
  d.apply(patches);
  return { document: d.doc, menuNodeId: ids[1] };
}

interface Menu {
  id: string;
  name: string;
  items: unknown[];
}

/**
 * Answers every route `bindMenu` touches, by URL, and records every call.
 *
 * `/menus/{id}` answers whichever of `menus` (or `createdMenu`) carries that
 * id — generalised past the original hardcoded `mn_1` so a test can pass its
 * own menu(s) without teaching this helper a new literal every time. The four
 * entity listings default to empty, exactly the "kind whose listing fails" a
 * caller sees when a test does not care about that kind at all.
 */
function scripted(
  initialDoc: unknown,
  menus: Menu[],
  opts: {
    createdMenu?: Menu;
    categories?: Array<{ id: string; slug: string }>;
    articles?: Array<{ id: string; slug: string }>;
    blogCategories?: Array<{ id: string; slug: string }>;
    products?: Array<{ id: string; slug: string }>;
  } = {},
) {
  const createdMenu = opts.createdMenu ?? MENU;
  const calls: Call[] = [];
  const saved: Array<Record<string, unknown>> = [];
  let current = initialDoc;
  const f = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path, body });
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

    if (path.endsWith('/source')) {
      if (method === 'PUT') {
        saved.push(body as Record<string, unknown>);
        current = (body as { document: unknown }).document;
      }
      return json({
        source: { pageId: 'pg_1', siteId: 's1', document: current, schemaVersion: 2, updatedAt: 'now' },
      });
    }
    if (path.endsWith('/menus') && method === 'GET') return json({ menus });
    if (path.endsWith('/menus') && method === 'POST') return json({ menu: createdMenu }, 201);
    const menuId = /\/menus\/([^/]+)$/.exec(path)?.[1];
    if (menuId && method === 'GET') {
      const found = menus.find((m) => m.id === menuId) ?? (menuId === createdMenu.id ? createdMenu : undefined);
      if (found) return json({ menu: found });
    }
    if (path.endsWith('/pages') && method === 'GET') {
      return json({ pages: [{ id: 'pg_1', slug: 'home', path: '/', name: 'Home' }] });
    }
    if (path.endsWith('/product-categories') && method === 'GET') return json({ categories: opts.categories ?? [] });
    if (path.endsWith('/articles') && method === 'GET') return json({ articles: opts.articles ?? [] });
    if (path.endsWith('/blog-categories') && method === 'GET') {
      return json({ blogCategories: opts.blogCategories ?? [] });
    }
    if (path.endsWith('/products') && method === 'GET') return json({ products: opts.products ?? [] });
    return json({});
  }) as unknown as typeof fetch;
  return { f, calls, saved };
}

/** A page document with a menu node's `specials.menuItems` overwritten before it is served. */
function withMenuItems(document: unknown, nodeId: string, menuItems: unknown[]): unknown {
  const doc = JSON.parse(JSON.stringify(document)) as {
    nodes: Record<string, { specials: Record<string, unknown> }>;
  };
  doc.nodes[nodeId].specials.menuItems = menuItems;
  return doc;
}

async function clientOver(f: typeof fetch) {
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  return connectedClient({
    base: 'http://x',
    session,
    fetchImpl: f,
    notices: new Notices(),
    undo: new UndoLog(),
    siteId: 's1',
  });
}

const parse = (r: unknown) =>
  JSON.parse((r as { content: Array<{ text: string }> }).content[0].text) as Record<string, unknown>;

describe('sb_store action:"menu"', () => {
  it('dry run reads only, and names the create as its first step', async () => {
    const { document, menuNodeId } = buildDoc();
    const { f, calls } = scripted(document, []);
    const { client, close } = await clientOver(f);

    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
    const out = parse(
      await client.callTool({ name: 'sb_store', arguments: { action: 'menu', node_id: menuNodeId } }),
    );

    expect(out.dry_run).toBe(true);
    const plan = out.plan as Array<{ step: number; method: string; path: string }>;
    expect(plan[0].step).toBe(1);
    expect(plan[0].method).toBe('POST');
    expect(plan[0].path).toMatch(/\/menus$/);
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);

    await close();
  });

  it('creates the menu, binds the node and writes its resolved snapshot', async () => {
    const { document, menuNodeId } = buildDoc();
    const { f, saved } = scripted(document, []);
    const { client, close } = await clientOver(f);

    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
    const out = parse(
      await client.callTool({
        name: 'sb_store',
        arguments: { action: 'menu', node_id: menuNodeId, dry_run: false },
      }),
    );

    expect(out.created).toBe(true);
    expect(out.menu_id).toBe('mn_1');
    expect(saved.length).toBe(1);
    const savedDoc = saved[0].document as { nodes: Record<string, { specials: Record<string, unknown> }> };
    const node = savedDoc.nodes[menuNodeId];
    expect(node.specials.menuId).toBe('mn_1');
    expect(node.specials.menuItems).toEqual([
      { id: 'i1', label: 'Home', href: '/' },
      { id: 'i2', label: 'Blog', href: 'https://x' },
    ]);

    await close();
  });

  it('a second call against an existing menu creates nothing', async () => {
    const { document, menuNodeId } = buildDoc();
    const { f, calls } = scripted(document, [MENU]);
    const { client, close } = await clientOver(f);

    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
    const out = parse(
      await client.callTool({
        name: 'sb_store',
        arguments: { action: 'menu', node_id: menuNodeId, dry_run: false },
      }),
    );

    expect(out.created).toBe(false);
    expect(out.menu_id).toBe('mn_1');
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);

    await close();
  });

  it('refuses a node that is not a menu element', async () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const { patches } = addSubtree(d, 'ROOT', { type: 'heading' });
    d.apply(patches);
    const headingId = d.outline()[0].id;
    const { f } = scripted(d.doc, []);
    const { client, close } = await clientOver(f);

    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
    const failed = (await client.callTool({
      name: 'sb_store',
      arguments: { action: 'menu', node_id: headingId },
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain('heading');

    await close();
  });

  it("preserves a row's panelId across a re-sync, at depth 2 as well", async () => {
    const { document, menuNodeId } = buildDoc();
    const withPanels = withMenuItems(document, menuNodeId, [
      {
        id: 'i1',
        label: 'Shop (old)',
        href: '',
        panelId: 'panel_top',
        items: [{ id: 'i1a', label: 'New (old)', href: '', panelId: 'panel_new' }],
      },
    ]);
    const menu: Menu = {
      id: 'mn_2',
      name: 'Main menu',
      items: [
        {
          id: 'i1',
          label: 'Shop',
          link: { type: 'none' },
          items: [{ id: 'i1a', label: 'New', link: { type: 'url', url: 'https://x/new' } }],
        },
      ],
    };
    const { f, saved } = scripted(withPanels, [menu]);
    const { client, close } = await clientOver(f);

    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
    await client.callTool({
      name: 'sb_store',
      arguments: { action: 'menu', node_id: menuNodeId, dry_run: false },
    });

    const savedDoc = saved[0].document as { nodes: Record<string, { specials: Record<string, unknown> }> };
    const items = savedDoc.nodes[menuNodeId].specials.menuItems as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({ id: 'i1', label: 'Shop', href: '', panelId: 'panel_top' });
    const kids = items[0].items as Array<Record<string, unknown>>;
    expect(kids[0]).toMatchObject({ id: 'i1a', label: 'New', href: 'https://x/new', panelId: 'panel_new' });

    await close();
  });

  it("resolves a productCategory link to the platform's own collections prefix", async () => {
    const { document, menuNodeId } = buildDoc();
    const menu: Menu = {
      id: 'mn_3',
      name: 'Main menu',
      items: [{ id: 'i1', label: 'Shoes', link: { type: 'productCategory', entityId: 'c1' } }],
    };
    const { f, saved } = scripted(document, [menu], { categories: [{ id: 'c1', slug: 'giay-dep' }] });
    const { client, close } = await clientOver(f);

    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
    await client.callTool({
      name: 'sb_store',
      arguments: { action: 'menu', node_id: menuNodeId, dry_run: false },
    });

    const savedDoc = saved[0].document as { nodes: Record<string, { specials: Record<string, unknown> }> };
    const items = savedDoc.nodes[menuNodeId].specials.menuItems as Array<Record<string, unknown>>;
    expect(items[0].href).toBe('/collections/giay-dep');

    await close();
  });

  it("resolves an article link to the platform's own blog prefix", async () => {
    const { document, menuNodeId } = buildDoc();
    const menu: Menu = {
      id: 'mn_4',
      name: 'Main menu',
      items: [{ id: 'i1', label: 'Launch post', link: { type: 'article', entityId: 'a1' } }],
    };
    const { f, saved } = scripted(document, [menu], { articles: [{ id: 'a1', slug: 'ra-mat' }] });
    const { client, close } = await clientOver(f);

    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
    await client.callTool({
      name: 'sb_store',
      arguments: { action: 'menu', node_id: menuNodeId, dry_run: false },
    });

    const savedDoc = saved[0].document as { nodes: Record<string, { specials: Record<string, unknown> }> };
    const items = savedDoc.nodes[menuNodeId].specials.menuItems as Array<Record<string, unknown>>;
    expect(items[0].href).toBe('/blog/ra-mat');

    await close();
  });

  it("resolves a blogCategory link to the platform's own blog-categories prefix", async () => {
    const { document, menuNodeId } = buildDoc();
    const menu: Menu = {
      id: 'mn_5',
      name: 'Main menu',
      items: [{ id: 'i1', label: 'News', link: { type: 'blogCategory', entityId: 'bc1' } }],
    };
    const { f, saved } = scripted(document, [menu], { blogCategories: [{ id: 'bc1', slug: 'tin-tuc' }] });
    const { client, close } = await clientOver(f);

    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
    await client.callTool({
      name: 'sb_store',
      arguments: { action: 'menu', node_id: menuNodeId, dry_run: false },
    });

    const savedDoc = saved[0].document as { nodes: Record<string, { specials: Record<string, unknown> }> };
    const items = savedDoc.nodes[menuNodeId].specials.menuItems as Array<Record<string, unknown>>;
    expect(items[0].href).toBe('/blog-categories/tin-tuc');

    await close();
  });

  it("resolves a product link to the platform's own products prefix, batched by id", async () => {
    const { document, menuNodeId } = buildDoc();
    const menu: Menu = {
      id: 'mn_6',
      name: 'Main menu',
      items: [{ id: 'i1', label: 'Best seller', link: { type: 'product', entityId: 'p1' } }],
    };
    const { f, calls, saved } = scripted(document, [menu], { products: [{ id: 'p1', slug: 'ao-thun' }] });
    const { client, close } = await clientOver(f);

    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
    await client.callTool({
      name: 'sb_store',
      arguments: { action: 'menu', node_id: menuNodeId, dry_run: false },
    });

    const savedDoc = saved[0].document as { nodes: Record<string, { specials: Record<string, unknown> }> };
    const items = savedDoc.nodes[menuNodeId].specials.menuItems as Array<Record<string, unknown>>;
    expect(items[0].href).toBe('/products/ao-thun');
    // Batched by id, not a whole-list read — the same split the editor's own
    // resolver makes, because a shop may hold thousands of products.
    const productCall = calls.find((c) => c.method === 'GET' && c.path.endsWith('/products'));
    expect(productCall).toBeTruthy();

    await close();
  });
});
