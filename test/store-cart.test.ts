import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import { OVERLAY_SEEDS } from '../src/catalog/overlays.generated.js';

/** A site whose overlay list is `kinds`; every call recorded. */
function site(kinds: string[], locale?: string) {
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  const f = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/overlays') && method === 'GET') {
      return json({ overlays: kinds.map((k, i) => ({ id: `ov_${i}`, kind: k })) });
    }
    if (path.endsWith('/settings') && method === 'GET') return json({ settings: locale ? { locale } : {} });
    if (path.endsWith('/overlays') && method === 'POST') return json({ overlay: { id: 'cart_1', kind: 'cart' } }, 201);
    return json({});
  }) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  return { calls, ctx: { base: 'http://x', session, fetchImpl: f, notices: new Notices(), undo: new UndoLog(), siteId: 's1' } };
}

const parse = (r: unknown) => JSON.parse((r as { content: Array<{ text: string }> }).content[0].text);

describe('sb_store action:"cart"', () => {
  it('creates the site\'s cart drawer from the editor\'s seed, under fresh ids', async () => {
    const { calls, ctx } = site(['popup']);
    const { client, close } = await connectedClient(ctx);
    const out = parse(await client.callTool({ name: 'sb_store', arguments: { action: 'cart', dry_run: false } }));
    const post = calls.find((c) => c.method === 'POST' && c.path === '/api/sites/s1/overlays')!;
    expect(post.body.kind).toBe('cart');
    const doc = post.body.document;
    expect((doc.nodes[doc.root_node_id] as any).data.type).toBe('cart-drawer');
    expect(Object.keys(doc.nodes).length).toBe(Object.keys(OVERLAY_SEEDS.cart.nodes).length);
    expect(Object.keys(doc.nodes).filter((id) => id in OVERLAY_SEEDS.cart.nodes)).toEqual([]);
    expect(out.overlay_id).toBe('cart_1');
    await close();
  });

  it('dry run sends nothing', async () => {
    const { calls, ctx } = site([]);
    const { client, close } = await connectedClient(ctx);
    const out = parse(await client.callTool({ name: 'sb_store', arguments: { action: 'cart' } }));
    expect(out.dry_run).toBe(true);
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
    await close();
  });

  it('a site that already has one is left alone', async () => {
    const { calls, ctx } = site(['cart']);
    const { client, close } = await connectedClient(ctx);
    const out = parse(await client.callTool({ name: 'sb_store', arguments: { action: 'cart', dry_run: false } }));
    expect(out.overlay_id).toBe('ov_0');
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
    await close();
  });

  // The editor seeds the drawer in `settings.locale`; this tool seeded English
  // on every store, so a Vietnamese shop said "Your cart" / "Checkout".
  it.each([
    ['vi-VN', '"text":"Giỏ hàng"', '"text":"Your cart"'],
    [undefined, '"text":"Your cart"', '"text":"Giỏ hàng"'],
    ['xx', '"text":"Your cart"', '"text":"Giỏ hàng"'],
  ])('speaks the site language (%s)', async (locale, says, never) => {
    const { calls, ctx } = site([], locale);
    const { client, close } = await connectedClient(ctx);
    await client.callTool({ name: 'sb_store', arguments: { action: 'cart', dry_run: false } });
    const doc = JSON.stringify(calls.find((c) => c.method === 'POST' && c.path === '/api/sites/s1/overlays')!.body);
    expect(doc).toContain(says);
    expect(doc).not.toContain(never);
    // The empty cart too — it said "Your cart is empty" on a Vietnamese store.
    if (locale === 'vi-VN') expect(doc).not.toContain('Your cart is empty');
    await close();
  });

  it('says WHY a drawer came out in English, and says nothing when it did not', async () => {
    for (const [locale, note] of [['vi', undefined], [undefined, /unset/], ['xx', /"xx", which has no seed/]] as const) {
      const { ctx } = site([], locale);
      const { client, close } = await connectedClient(ctx);
      const out = parse(await client.callTool({ name: 'sb_store', arguments: { action: 'cart' } }));
      if (note) expect(out.language_note).toMatch(note);
      else expect(out.language_note).toBeUndefined();
      await close();
    }
  });
});
