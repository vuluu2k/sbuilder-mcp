import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callOperation } from '../src/tools/api.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import type { ToolContext } from '../src/tools/context.js';

type Route = (init: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake platform: `routes['GET /api/…']` answers; anything else is a 404 the test will see. */
function platform(routes: Record<string, Route>) {
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${new URL(url).pathname}`;
    const r = routes[key];
    return r ? r(init) : json({ error: `no route ${key}`, code: 'not_found' }, 404);
  });
  return f as unknown as typeof fetch & typeof f;
}

function ctx(fetchImpl: typeof fetch): ToolContext {
  return {
    base: 'http://x',
    session: new Session('http://x', fetchImpl),
    apiKey: 'wbk_k',
    siteId: 's1',
    fetchImpl,
    notices: new Notices(),
    undo: new UndoLog(),
  };
}

const hdr = (init: RequestInit, name: string) => (init.headers as Record<string, string>)[name];

describe('sb_api_call — shipping-config If-Match', () => {
  it('reads the version first when no if_match is given, sends it, and says so', async () => {
    const f = platform({
      'GET /api/sites/s1/shipping-config': () => json({ config: { version: 7, methods: [] } }),
      'PATCH /api/sites/s1/shipping-config': () => json({ config: { version: 8, methods: [] } }),
    });
    const out = (await callOperation(ctx(f), {
      id: 'patch:/api/sites/{siteId}/shipping-config',
      body: { methods: [{ name: 'Giao nhanh', feeCents: 3000000 }] },
      dry_run: false,
    })) as Record<string, unknown>;
    expect(f.mock.calls.map((c) => (c[1] as RequestInit).method ?? 'GET')).toEqual(['GET', 'PATCH']);
    expect(hdr(f.mock.calls[1][1] as RequestInit, 'If-Match')).toBe('"7"');
    expect(out.if_match).toMatchObject({ sent: '"7"', read_from: 'GET /api/sites/s1/shipping-config' });
    expect((out.config as { version: number }).version).toBe(8);
  });

  it('sends a given if_match quoted, without reading', async () => {
    const f = platform({
      'PATCH /api/sites/s1/shipping-config': () => json({ config: { version: 10 } }),
    });
    await callOperation(ctx(f), {
      id: 'patch:/api/sites/{siteId}/shipping-config',
      body: {},
      if_match: 9,
      dry_run: false,
    });
    expect(f.mock.calls).toHaveLength(1);
    expect(hdr(f.mock.calls[0][1] as RequestInit, 'If-Match')).toBe('"9"');
  });

  it('the restore needs it too', async () => {
    const f = platform({
      'GET /api/sites/s1/shipping-config': () => json({ config: { version: 3 } }),
      'POST /api/sites/s1/shipping-config/versions/v1/restore': () => json({ config: { version: 4 } }),
    });
    await callOperation(ctx(f), {
      id: 'post:/api/sites/{siteId}/shipping-config/versions/{id}/restore',
      path_params: { id: 'v1' },
      dry_run: false,
    });
    expect(hdr(f.mock.calls[1][1] as RequestInit, 'If-Match')).toBe('"3"');
  });

  it('a dry run reads nothing and says where the version will come from', async () => {
    const f = platform({});
    const out = (await callOperation(ctx(f), {
      id: 'patch:/api/sites/{siteId}/shipping-config',
      body: {},
    })) as { would_send: { headers?: Record<string, string> } };
    expect(f.mock.calls).toHaveLength(0);
    expect(out.would_send.headers?.['If-Match']).toMatch(/GET .*shipping-config/);
  });

  it('a v1 shipping writer refused as moved names the shipping-config route as the fix', async () => {
    const f = platform({
      'POST /api/sites/s1/shipping-methods': () =>
        json({ error: 'shipping: config moved', code: 'shipping_config_moved' }, 409),
    });
    await expect(
      callOperation(ctx(f), { id: 'post:/api/sites/{siteId}/shipping-methods', body: { name: 'x' }, dry_run: false }),
    ).rejects.toThrow(/shipping_config_moved.*PATCH \/api\/sites\/\{siteId\}\/shipping-config/s);
  });
});

describe('sb_api_call — merge for a full-replace PUT', () => {
  const gateway = { provider: 'vnpay', label: 'VNPay', enabled: true, sandbox: true, fields: [{ key: 'tmnCode' }] };

  it('dry run shows the caller body and the changed paths, never what the GET read, and sends nothing', async () => {
    const f = platform({
      'GET /api/sites/s1/payment-gateways/vnpay': () => json({ paymentGateway: gateway }),
    });
    const out = (await callOperation(ctx(f), {
      id: 'put:/api/sites/{siteId}/payment-gateways/{provider}',
      path_params: { provider: 'vnpay' },
      body: { label: 'Thẻ ATM' },
      merge: true,
    })) as { would_send: { body: Record<string, unknown> }; merge: { changed: string[] } };
    expect(f.mock.calls.map((c) => (c[1] as RequestInit).method ?? 'GET')).toEqual(['GET']);
    // Not the merged record: redact() hides only secret-looking key names, so data
    // read from the GET would otherwise be printed in a tool result.
    expect(out.would_send.body).toEqual({ label: 'Thẻ ATM' });
    expect(out.merge.changed).toEqual(['label']);
  });

  it('keeps the envelope when the PUT takes one (settings), deep-merges objects, replaces arrays', async () => {
    let sent: unknown;
    const f = platform({
      'GET /api/sites/s1/settings': () =>
        json({ settings: { locale: 'vi', locales: ['vi', 'en'], seo: { title: 'A', description: 'B' } } }),
      'PUT /api/sites/s1/settings': (init) => {
        sent = JSON.parse(String(init.body));
        return json({ settings: sent });
      },
    });
    await callOperation(ctx(f), {
      id: 'put:/api/sites/{siteId}/settings',
      body: { settings: { locales: ['vi'], seo: { title: 'C' } } },
      merge: true,
      dry_run: false,
    });
    expect(sent).toEqual({ settings: { locale: 'vi', locales: ['vi'], seo: { title: 'C', description: 'B' } } });
  });

  it('a PUT without merge warns about the fields the replace would erase', async () => {
    const f = platform({
      'GET /api/sites/s1/payment-gateways/vnpay': () => json({ paymentGateway: gateway }),
    });
    const out = (await callOperation(ctx(f), {
      id: 'put:/api/sites/{siteId}/payment-gateways/{provider}',
      path_params: { provider: 'vnpay' },
      body: { label: 'Thẻ ATM' },
    })) as { replace_warning?: string };
    expect(out.replace_warning).toMatch(/enabled/);
    expect(out.replace_warning).toMatch(/sandbox/);
    expect(out.replace_warning).toMatch(/merge:true/);
  });

  it('merge is refused off a PUT', async () => {
    await expect(
      callOperation(ctx(platform({})), { id: 'post:/api/sites/{siteId}/shipping-methods', body: {}, merge: true }),
    ).rejects.toThrow(/merge/);
  });
});

describe('sb_api_call — multipart file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sbmcp-file-'));

  it('POSTs a local file as multipart and returns the per-row result', async () => {
    const xlsx = join(dir, 'products.xlsx');
    writeFileSync(xlsx, 'PK-fake-workbook');
    let init!: RequestInit;
    const f = platform({
      'POST /api/sites/s1/products/import': (i) => {
        init = i;
        return json({ result: { created: 2, updated: 0, errors: [{ row: 4, message: 'ao: price' }] } });
      },
    });
    const out = await callOperation(ctx(f), {
      id: 'post:/api/sites/{siteId}/products/import',
      file: { path: xlsx },
      dry_run: false,
    });
    expect(init.body).toBeInstanceOf(FormData);
    const part = (init.body as FormData).get('file') as File;
    expect(part.name).toBe('products.xlsx');
    expect(part.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(hdr(init, 'Content-Type')).toBeUndefined();
    expect(out).toMatchObject({ result: { created: 2, errors: [{ row: 4 }] } });
  });

  it('a GET with file saves the response bytes there', async () => {
    const dest = join(dir, 'template.xlsx');
    const f = platform({
      'GET /api/sites/s1/products/import-template': () => new Response(new Uint8Array([0x50, 0x4b, 3, 4]), { status: 200 }),
    });
    const out = await callOperation(ctx(f), {
      id: 'get:/api/sites/{siteId}/products/import-template',
      file: { path: dest },
      dry_run: false,
    });
    expect([...readFileSync(dest)]).toEqual([0x50, 0x4b, 3, 4]);
    expect(out).toMatchObject({ saved: realpathSync(dest), bytes: 4 });
  });

  it('a dry run sends nothing and describes the multipart body', async () => {
    const xlsx = join(dir, 'p.xlsx');
    writeFileSync(xlsx, 'abc');
    const f = platform({});
    const out = (await callOperation(ctx(f), {
      id: 'post:/api/sites/{siteId}/products/import',
      file: { path: xlsx },
    })) as { would_send: { body: unknown } };
    expect(f.mock.calls).toHaveLength(0);
    expect(out.would_send.body).toMatchObject({ multipart: { field: 'file', path: realpathSync(xlsx), bytes: 3 } });
  });
});

describe('sb_api_call — review fixes', () => {
  it('a download never overwrites an existing file', async () => {
    const d = mkdtempSync(join(tmpdir(), 'sbdl-'));
    const dest = join(d, 'keep.xlsx');
    writeFileSync(dest, 'PRECIOUS');
    const f = platform({
      'GET /api/sites/s1/products/import-template': () => new Response(new Uint8Array([1, 2]), { status: 200 }),
    });
    await expect(
      callOperation(ctx(f), { id: 'get:/api/sites/{siteId}/products/import-template', file: { path: dest }, dry_run: false }),
    ).rejects.toThrow(/already exists/);
    expect(readFileSync(dest, 'utf8')).toBe('PRECIOUS');
  });

  it('if_match must be a version', async () => {
    const f = platform({});
    await expect(
      callOperation(ctx(f), { id: 'patch:/api/sites/{siteId}/shipping-config', body: {}, if_match: 'abc' }),
    ).rejects.toThrow(/version number/);
  });

  it('the replace warning leaves out server-owned fields', async () => {
    const f = platform({
      'GET /api/sites/s1/payment-gateways/vnpay': () =>
        json({ paymentGateway: { id: 'pg1', siteId: 's1', createdAt: 't', updatedAt: 't', enabled: true, label: 'A' } }),
    });
    const out = (await callOperation(ctx(f), {
      id: 'put:/api/sites/{siteId}/payment-gateways/{provider}',
      path_params: { provider: 'vnpay' },
      body: { label: 'B' },
    })) as { replace_warning?: string };
    expect(out.replace_warning).toMatch(/enabled/);
    expect(out.replace_warning).not.toMatch(/\bid\b|siteId|createdAt|updatedAt/);
  });

  it('a locale-only settings PUT warns of nothing — the server merges that one shape', async () => {
    const f = platform({ 'GET /api/sites/s1/settings': () => json({ settings: { locale: 'en', currency: 'VND' } }) });
    const out = (await callOperation(ctx(f), { id: 'put:/api/sites/{siteId}/settings', body: { settings: { locale: 'vi' } } })) as {
      replace_warning?: string;
    };
    expect(out.replace_warning).toBeUndefined();
  });

  it('merge refuses a body outside the envelope the PUT takes', async () => {
    const f = platform({ 'GET /api/sites/s1/settings': () => json({ settings: { locale: 'en' } }) });
    await expect(
      callOperation(ctx(f), { id: 'put:/api/sites/{siteId}/settings', body: { locale: 'vi' }, merge: true }),
    ).rejects.toThrow(/settings: …/);
  });

  it('a merge dry run never prints a value the GET read under an ordinary key', async () => {
    const f = platform({
      'GET /api/sites/s1/payment-gateways/vnpay': () =>
        json({ paymentGateway: { enabled: true, label: 'A', accountNumber: '0123456789' } }),
    });
    const out = await callOperation(ctx(f), {
      id: 'put:/api/sites/{siteId}/payment-gateways/{provider}',
      path_params: { provider: 'vnpay' },
      body: { label: 'B' },
      merge: true,
    });
    expect(JSON.stringify(out)).not.toContain('0123456789');
  });

  it('the file door only opens for a catalogue spreadsheet', async () => {
    const f = platform({
      'GET /api/sites/s1/products/import-template': () => new Response(new Uint8Array([1]), { status: 200 }),
    });
    const d = mkdtempSync(join(tmpdir(), 'sbguard-'));
    const key = join(d, 'id_rsa');
    writeFileSync(key, 'SECRET');
    // Not a spreadsheet: never read, never sent.
    await expect(
      callOperation(ctx(f), { id: 'post:/api/sites/{siteId}/products/import', file: { path: key }, dry_run: false }),
    ).rejects.toThrow(/must be one of/);
    // A spreadsheet name that is a symlink to the key: refused too.
    const { symlinkSync } = await import('node:fs');
    const link = join(d, 'p.xlsx');
    symlinkSync(key, link);
    await expect(
      callOperation(ctx(f), { id: 'post:/api/sites/{siteId}/products/import', file: { path: link }, dry_run: false }),
    ).rejects.toThrow(/must be one of/); // the extension is the REAL file's
    // A dot-folder download (.claude/, .vscode/ — config that runs code): refused.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(d, '.vscode'));
    await expect(
      callOperation(ctx(f), { id: 'get:/api/sites/{siteId}/products/import-template', file: { path: join(d, '.vscode', 'x.csv') }, dry_run: false }),
    ).rejects.toThrow(/dot-/);
    // Nor a .json, which is config somewhere.
    await expect(
      callOperation(ctx(f), { id: 'get:/api/sites/{siteId}/products/import-template', file: { path: join(d, 'x.json') }, dry_run: false }),
    ).rejects.toThrow(/must be one of/);
    // A download outside the working directory and the temp directory: refused.
    await expect(
      callOperation(ctx(f), { id: 'get:/api/sites/{siteId}/products/import-template', file: { path: '/usr/x.xlsx' }, dry_run: false }),
    ).rejects.toThrow(/working directory/);
    await expect(
      callOperation(ctx(f), { id: 'get:/api/sites/{siteId}/products/import-template', file: { path: join(d, 'x.plist') }, dry_run: false }),
    ).rejects.toThrow(/must be one of/);
    expect(f.mock.calls.length).toBe(0);
  });
});
