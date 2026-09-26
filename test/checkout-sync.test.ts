import { describe, it, expect, vi } from 'vitest';
import { syncOrderDocument } from '../src/tools/store.js';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

describe('checkout_sync — an order form brought up to the store it sells from', () => {
  const doc = () => ({
    nodes: {
      a: { specials: { name: 'payment_method', defaultValue: 'cod', methods: [{ value: 'cod', label: 'Tiền mặt (sửa)', description: 'x' }] } },
      b: { specials: { name: 'shipping_method', options: [] as string[] } },
      c: { specials: { name: 'full_name' } },
    },
  });
  const fresh = [
    { value: 'cod', label: 'COD', description: '' },
    { value: 'vnpay', label: 'VNPay', description: '' },
  ];

  it('fills an empty delivery select and adds a gateway switched on later', () => {
    const d = doc();
    const r = syncOrderDocument(d, fresh, ['Giao nhanh']);
    expect(r).toMatchObject({ changed: true, payment_methods: ['cod', 'vnpay'], delivery_options: ['Giao nhanh'] });
    expect(d.nodes.b.specials.options).toEqual(['Giao nhanh']);
    // The merchant's own wording for a method they already had survives.
    expect((d.nodes.a.specials.methods as Array<{ label: string }>)[0].label).toBe('Tiền mặt (sửa)');
  });

  it('moves the default off a method that is gone', () => {
    const d = doc();
    d.nodes.a.specials.defaultValue = 'momo';
    syncOrderDocument(d, fresh, []);
    expect(d.nodes.a.specials.defaultValue).toBe('cod');
  });

  it('reports no change when the form already matches', () => {
    const d = doc();
    syncOrderDocument(d, fresh, ['Giao nhanh']);
    expect(syncOrderDocument(d, fresh, ['Giao nhanh']).changed).toBe(false);
  });
});

describe('checkout_sync over the wire', () => {
  function site(opts: { shippingFails?: boolean } = {}) {
    const writes: string[] = [];
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const method = init?.method ?? 'GET';
      if (method !== 'GET') writes.push(`${method} ${path}`);
      const json = (v: unknown, status = 200) =>
        new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
      if (path.endsWith('/payment-gateways')) return json({ paymentGateways: [] });
      if (path.endsWith('/shipping-methods'))
        return opts.shippingFails ? json({ error: 'down' }, 500) : json({ shippingMethods: [{ name: 'Giao nhanh' }] });
      if (path.endsWith('/forms')) return json({ forms: [{ id: 'frm_1', name: 'Thanh toán', type: 'order' }] });
      if (path.endsWith('/document'))
        return json({ document: { nodes: { b: { specials: { name: 'shipping_method', options: ['Cũ'] } } } } });
      if (path.endsWith('/pages')) return json({ pages: [{ id: 'pg_ck', type: 'checkout' }] });
      if (path.endsWith('/publish')) return json({ published: [{ pageId: 'pg_ck' }] });
      return json({});
    }) as unknown as typeof fetch;
    return { f, writes };
  }
  async function run(f: typeof fetch, args: Record<string, unknown>) {
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({ base: 'http://x', session, fetchImpl: f, notices: new Notices(), undo: new UndoLog(), siteId: 's1' });
    const r = await client.callTool({ name: 'sb_store', arguments: { action: 'checkout_sync', ...args } });
    await close();
    return r as { isError?: boolean; content: Array<{ text: string }> };
  }

  it('a dry run sends no write', async () => {
    const s = site();
    const r = await run(s.f, {});
    expect(JSON.parse(r.content[0].text)).toMatchObject({ dry_run: true, would_republish: ['pg_ck'] });
    expect(s.writes).toEqual([]);
  });

  // A failed read is not "the store has no delivery": treating it so would
  // empty a working checkout and publish it.
  it('refuses to rewrite anything when the store cannot be read', async () => {
    const s = site({ shippingFails: true });
    const r = await run(s.f, { dry_run: false });
    expect(r.isError).toBe(true);
    expect(s.writes).toEqual([]);
  });

  it('saves the form and republishes the checkout page', async () => {
    const s = site();
    await run(s.f, { dry_run: false });
    expect(s.writes).toEqual(['PUT /api/sites/s1/forms/frm_1/document', 'POST /api/sites/s1/publish']);
  });
});
