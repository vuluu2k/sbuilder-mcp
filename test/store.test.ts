import { describe, it, expect, vi } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

/**
 * A store that answers every step of the checkout flow, and records the order.
 *
 * `fail` names a path fragment whose write should 500, so the recovery can be
 * tested — that recovery is the whole reason this flow is a tool rather than
 * four calls the model makes itself.
 */
function storefront(opts: { fail?: string; publishes?: boolean; gateways?: unknown[] } = {}) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path, body });

    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    if (opts.fail && path.includes(opts.fail) && method !== 'GET' && method !== 'DELETE') {
      return json({ error: 'nope', code: 'validation' }, 400);
    }
    if (path.endsWith('/payment-gateways')) {
      return json({
        paymentGateways: opts.gateways ?? [
          { provider: 'vnpay', label: 'VNPay', enabled: true, configured: true },
          { provider: 'momo', enabled: false, configured: true },
        ],
      });
    }
    if (path.endsWith('/shipping-methods')) {
      return json({ shippingMethods: [{ name: 'Giao hàng nhanh' }, { name: 'Nhận tại cửa hàng' }] });
    }
    if (path.endsWith('/forms') && method === 'POST') {
      return json({ form: { id: 'frm_1', name: 'X', type: 'order', settings: { notify: {} } } }, 201);
    }
    if (path.endsWith('/pages') && method === 'POST') {
      return json({ page: { id: 'pg_ck', slug: 'thanh-toan' } }, 201);
    }
    if (path.endsWith('/publish')) {
      return json({ published: opts.publishes === false ? [] : [{ pageId: 'pg_ck' }] });
    }
    return json({});
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function clientOver(f: typeof fetch) {
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  return connectedClient({ base: 'http://x', session, fetchImpl: f, notices: new Notices(), undo: new UndoLog(), siteId: 's1' });
}

const parse = (r: unknown) =>
  JSON.parse((r as { content: Array<{ text: string }> }).content[0].text) as Record<string, unknown>;

describe('sb_store checkout', () => {
  it('defaults to a dry run that sends no write and returns the four steps in order', async () => {
    const { f, calls } = storefront();
    const { client, close } = await clientOver(f);
    const out = parse(await client.callTool({ name: 'sb_store', arguments: { action: 'checkout' } }));

    expect(out.dry_run).toBe(true);
    const plan = out.plan as Array<{ step: number; method: string; path: string }>;
    expect(plan.map((p) => p.step)).toEqual([1, 2, 3, 4]);
    // The order IS the contract: the form must be PUT back whole before its
    // document is saved, and the page is created last because it binds the form.
    expect(plan[0].path).toMatch(/\/forms$/);
    expect(plan[1].method).toBe('PUT');
    expect(plan[2].path).toMatch(/\/document$/);
    expect(plan[3].path).toMatch(/\/pages$/);
    // A dry run reads the store — it has to, to say what the form will offer —
    // and writes nothing.
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    await close();
  });

  it('offers only the gateways that are live, with cash on delivery first', async () => {
    const { f } = storefront();
    const { client, close } = await clientOver(f);
    const out = parse(await client.callTool({ name: 'sb_store', arguments: { action: 'checkout' } }));
    // `momo` is configured but disabled, so a shopper cannot pay through it. An
    // option the server matches against nothing collects an answer worth nothing.
    expect(out.payment_methods).toEqual(['cod', 'vnpay']);
    expect(out.delivery_options).toEqual(['Giao hàng nhanh', 'Nhận tại cửa hàng']);
    await close();
  });

  it('warns when the store has no gateway and no delivery option', async () => {
    const f = vi.fn(async (url: unknown) => {
      const path = new URL(String(url)).pathname;
      const empty = path.endsWith('/payment-gateways')
        ? { paymentGateways: [] }
        : { shippingMethods: [] };
      return new Response(JSON.stringify(empty), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const { client, close } = await clientOver(f);
    const out = parse(await client.callTool({ name: 'sb_store', arguments: { action: 'checkout' } }));
    expect(String(out.warning)).toMatch(/cash on delivery/i);
    // An empty delivery select is the one that stops the order dead, so it says so.
    expect(String(out.warning_delivery)).toMatch(/EMPTY/);
    await close();
  });

  it('runs the four writes in order and binds the page to the form it just made', async () => {
    const { f, calls } = storefront();
    const { client, close } = await clientOver(f);
    const out = parse(
      await client.callTool({ name: 'sb_store', arguments: { action: 'checkout', dry_run: false } }),
    );

    expect(out.form_id).toBe('frm_1');
    expect(out.page_id).toBe('pg_ck');
    expect(out.published).toBe(true);

    const writes = calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${c.path.replace('/api/sites/s1', '')}`)).toEqual([
      'POST /forms',
      'PUT /forms/frm_1',
      'PUT /forms/frm_1/document',
      'POST /pages',
      'POST /publish',
    ]);

    // NAME AND TYPE RIDE ALONG on the settings write. PUT /forms/{id} decodes
    // into a fresh Form and Normalize() fills whatever is missing, so a
    // settings-only body renames the form and turns it `custom` — after which the
    // document below is refused as "mappings do not fit this form type".
    const settings = writes[1].body!;
    expect(settings.name).toBe('X');
    expect(settings.type).toBe('order');
    expect((settings.settings as Record<string, unknown>).orderSource).toBe('cart');
    // Merged over what the server returned, not replacing it: `settings` is a
    // whole object on the wire, so sending the template's one key alone would
    // blank the defaults and make a form that takes an order and tells nobody.
    expect((settings.settings as Record<string, unknown>).notify).toBeDefined();

    // The page document must carry the real form id; the sentinel must be gone.
    const page = JSON.stringify(writes[3].body);
    expect(page).toContain('frm_1');
    expect(page).not.toContain('__SB_CHECKOUT_FORM_ID__');
    expect(page).not.toContain('__SB_HEADLINE__');
    await close();
  });

  it('deletes the form again when a later step fails', async () => {
    const { f, calls } = storefront({ fail: '/document' });
    const { client, close } = await clientOver(f);
    const failed = (await client.callTool({
      name: 'sb_store',
      arguments: { action: 'checkout', dry_run: false },
    })) as { isError?: boolean };
    expect(failed.isError).toBe(true);
    // A form nobody can see — no page binds it, the Forms list shows an empty
    // "Form" — is the orphan the obvious retry would then duplicate.
    expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/forms/frm_1'))).toBe(true);
    expect(calls.some((c) => c.path.endsWith('/pages'))).toBe(false);
    await close();
  });

  it('says so when publish answers 200 without publishing the page', async () => {
    const { f } = storefront({ publishes: false });
    const { client, close } = await clientOver(f);
    const out = parse(
      await client.callTool({ name: 'sb_store', arguments: { action: 'checkout', dry_run: false } }),
    );
    // Publish SKIPS a page it has nothing to publish for and still answers 200
    // (service.go:650, a bare `continue`). Without this assertion a checkout that
    // 404s reports success.
    expect(out.published).toBe(false);
    expect(String(out.not_published)).toMatch(/\/checkout still resolves to nothing/);
    await close();
  });
});
