import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import { CART_SEEDS } from '../src/catalog/overlays.generated.js';
import { withFreshIds } from '../src/domains/site/ids.js';
import { readinessGaps, type ReadinessInput } from '../src/domains/site/readiness.js';
import { gatherReadiness } from '../src/domains/site/readiness-fetch.js';

/**
 * A STORE MADE BEFORE THE PER-LOCALE SEED keeps "Your cart" / "Checkout" /
 * "Your cart is empty" on a Vietnamese site — observed live. Detected by EXACT
 * match against another locale's seed words; merchant-edited text is theirs.
 */
type Doc = { root_node_id: string; nodes: Record<string, any> };
const drawer = (locale: string, edit?: (d: Doc) => void): Doc => {
  const d = withFreshIds(structuredClone(CART_SEEDS[locale])) as Doc;
  edit?.(d);
  return d;
};
const texts = (d: Doc) =>
  Object.values(d.nodes).flatMap((n) => ['text', 'label', 'emptyText'].map((k) => n.specials?.[k]).filter((v) => typeof v === 'string'));

const base: ReadinessInput = {
  pages: [{ type: 'page', status: 'published' }],
  liveGateways: 1,
  shippingMethods: 1,
  pageNodes: [{ data: { type: 'heading' } } as never],
  globalNodes: [],
};
const gap = (input: Partial<ReadinessInput>) => readinessGaps({ ...base, ...input }).find((g) => g.id === 'cartDrawerLanguage');

describe('cartDrawerLanguage', () => {
  it('a vi site whose drawer still speaks the English seed', () => {
    const g = gap({ siteLocale: 'vi-VN', cartOverlay: drawer('en') });
    expect(g?.problem).toMatch(/Your cart/);
    expect(g?.fix).toMatch(/sb_store action:"cart" relocalize:true/);
  });

  it('a vi drawer on a vi site, and an en drawer on an en site, are fine', () => {
    expect(gap({ siteLocale: 'vi', cartOverlay: drawer('vi') })).toBeUndefined();
    expect(gap({ siteLocale: 'en', cartOverlay: drawer('en') })).toBeUndefined();
  });

  it('a locale with no seed compares against en', () => {
    expect(gap({ siteLocale: 'fr', cartOverlay: drawer('vi') })).toBeDefined();
  });

  it('text the merchant rewrote is theirs', () => {
    const edited = drawer('en', (d) => {
      for (const n of Object.values(d.nodes)) {
        for (const k of ['text', 'label', 'emptyText']) if (typeof n.specials?.[k] === 'string') n.specials[k] = `Mine ${k}`;
      }
    });
    expect(gap({ siteLocale: 'vi', cartOverlay: edited })).toBeUndefined();
  });

  it('silent on unread data', () => {
    expect(gap({ siteLocale: null, cartOverlay: drawer('en') })).toBeUndefined();
    expect(gap({ siteLocale: 'vi', cartOverlay: null })).toBeUndefined();
  });

  it('gatherReadiness reads the cart document off the overlay list', async () => {
    const f = (async (url: unknown) => {
      const path = new URL(String(url)).pathname;
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
      if (path.endsWith('/overlays')) return json({ overlays: [{ id: 'p', kind: 'popup' }, { id: 'c', kind: 'cart', document: drawer('en') }] });
      if (path.endsWith('/settings')) return json({ settings: { locale: 'vi' } });
      return json({});
    }) as unknown as typeof fetch;
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const input = await gatherReadiness({ base: 'http://x', session, fetchImpl: f, notices: new Notices(), undo: new UndoLog() } as never, 's1', []);
    expect(readinessGaps(input).map((g) => g.id)).toContain('cartDrawerLanguage');
  });
});

/** A vi site, its English cart drawer composed onto the open page `pg`. */
function site(edited = false) {
  const cart = drawer('en', (d) => {
    if (!edited) return;
    const btn = Object.values(d.nodes).find((n) => n.specials?.text === 'Checkout');
    btn.specials.text = 'Pay now';
  });
  const root = cart.nodes[cart.root_node_id];
  root.data.parent = 'ROOT';
  root.specials = { ...root.specials, overlayId: 'ov_cart', overlayRev: 1 };
  const page = {
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: {
      ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: [cart.root_node_id] }, specials: {} },
      ...cart.nodes,
    },
  };
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  const f = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/overlays')) {
      const master = structuredClone(cart);
      return json({ overlays: [{ id: 'ov_cart', kind: 'cart', document: master }] });
    }
    if (path.endsWith('/settings')) return json({ settings: { locale: 'vi' } });
    if (path.endsWith('/source')) return json({ source: { pageId: 'pg', document: method === 'PUT' ? body.document : page } });
    return json({});
  }) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  const ctx = { base: 'http://x', session, fetchImpl: f, notices: new Notices(), undo: new UndoLog(), siteId: 's1' };
  return { ctx, calls, page };
}
const parse = (r: unknown) => JSON.parse((r as { content: Array<{ text: string }> }).content[0].text);

describe('sb_store action:"cart" relocalize', () => {
  it('dry run lists the changes and sends nothing', async () => {
    const { ctx, calls } = site();
    const { client, close } = await connectedClient(ctx as never);
    await client.callTool({ name: 'sb_page_open', arguments: { page_id: 'pg' } });
    const out = parse(await client.callTool({ name: 'sb_store', arguments: { action: 'cart', relocalize: true } }));
    expect(out.dry_run).toBe(true);
    expect(out.language).toBe('vi');
    expect(out.changes).toContainEqual(expect.objectContaining({ from: 'Checkout', to: 'Thanh toán' }));
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
    await close();
  });

  it('a real run saves the page with ONLY those strings changed, and leaves edited text alone', async () => {
    const { ctx, calls, page } = site(true);
    const { client, close } = await connectedClient(ctx as never);
    await client.callTool({ name: 'sb_page_open', arguments: { page_id: 'pg' } });
    const out = parse(await client.callTool({ name: 'sb_store', arguments: { action: 'cart', relocalize: true, dry_run: false } }));
    const put = calls.find((c) => c.method === 'PUT' && c.path === '/api/sites/s1/pages/pg/source')!;
    expect(put).toBeDefined();
    const sent = put.body.document as Doc;
    expect(Object.keys(sent.nodes).sort()).toEqual(Object.keys(page.nodes).sort());
    expect(texts(sent)).toContain('Giỏ hàng');
    expect(texts(sent)).toContain('Pay now');
    expect(texts(sent)).not.toContain('Your cart');
    expect(texts(sent)).not.toContain('Your cart is empty');
    // Nothing but the strings moved.
    const strip = (d: Doc) => JSON.stringify(Object.values(d.nodes).map((n) => ({ ...n, specials: { ...n.specials, text: 0, label: 0, emptyText: 0 } })));
    expect(strip(sent)).toBe(strip(page as Doc));
    expect(out.changes.length).toBe(out.changes.filter((c: any) => c.from !== 'Pay now').length);
    // Through the page save — the overlays API ignores a document.
    expect(calls.filter((c) => c.method !== 'GET' && c.path.includes('/overlays'))).toEqual([]);
    await close();
  });
});
