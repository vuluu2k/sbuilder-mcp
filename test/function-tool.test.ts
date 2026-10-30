import { describe, it, expect } from 'vitest';
import { fakePlatform } from './helpers/platform.js';

/** sb_function — the site's backend functions (web_builder internal/functions, editor REST). */
const CANARY = 'sk_live_CANARY_9f3e1d';
const B = '/api/sites/s1/functions';

function platform(opts: { disabled?: 'editor' | 'v1'; notInPlan?: boolean } = {}) {
  const writes: Array<{ method: string; path: string; query?: string; body: any }> = [];
  let row: Record<string, unknown> = {
    id: 'fn_1',
    siteId: 's1',
    slug: 'hello',
    language: 'typescript',
    content: 'export default () => new Response("hi")',
    enabled: true,
    compileError: '',
    createdAt: '2026-10-30T00:00:00Z',
    updatedAt: '2026-10-30T01:02:03.456789Z',
  };
  const fake = fakePlatform((method, path, body) => {
    if (opts.disabled === 'editor') return { __status: 404, error: 'backend functions are not enabled on this server', code: 'functions_disabled' };
    if (opts.disabled === 'v1') return { __status: 503, error: 'functions are unavailable', code: 'resource_unavailable' };
    if (method !== 'GET') writes.push({ method, path, body });
    if (path === B) {
      if (method === 'POST') {
        const b = body as { content: string };
        return { function: { id: 'fn_2', siteId: 's1', ...(body as object), compileError: b.content.includes('!') ? 'functions/x.ts:1:2: Expected ";"' : '' } };
      }
      return { functions: [row, { ...row, id: 'fn_m', slug: '_util', compileError: 'functions/_util.ts:1:1: boom' }], total: 2 };
    }
    if (path === `${B}/fn_1`) {
      if (method === 'PUT') row = { ...row, ...(body as object), compileError: '' };
      return method === 'DELETE' ? {} : { function: row };
    }
    if (path === `${B}/fn_1/test`) {
      if (opts.notInPlan) return { __status: 404, error: 'the function was not run: function_not_in_plan', code: 'function_not_in_plan' };
      return {
        result: {
          status: 200, headers: [['content-type', 'text/plain']], setCookies: ['fn_a=1; Path=/'], body: 'hi',
          outcome: 'ok', durationMs: 12, memoryBytes: 1024, console: 'log\n', error: '',
        },
      };
    }
    if (path === `${B}/invocations`) {
      return { invocations: [{ id: 'i1', functionId: 'fn_1', slug: 'hello', startedAt: 't', durationMs: 3, status: 200, outcome: 'ok', memoryBytes: 1, console: '', error: '', test: true }], total: 1 };
    }
    if (path === `${B}/usage`) return { usage: { periodStart: '2026-10-01T00:00:00Z', invocations: 4, limit: opts.notInPlan ? 0 : 1000 } };
    if (path === `${B}/secrets`) return { secrets: [{ key: 'STRIPE_KEY', updatedAt: 't' }], total: 1 };
    if (path.startsWith(`${B}/secrets/`)) return method === 'DELETE' ? {} : { secret: { key: path.split('/').pop(), updatedAt: 't' } };
    return undefined;
  });
  return { fake, writes, row: () => row };
}

async function withCall<T>(p: ReturnType<typeof platform>, fn: (call: Awaited<ReturnType<ReturnType<typeof platform>['fake']['connect']>>['call']) => Promise<T>) {
  const { call, close } = await p.fake.connect();
  try {
    return await fn(call);
  } finally {
    await close();
  }
}

describe('sb_function', () => {
  it('list: compact rows, module flagged, route for a function, compile_error surfaced, no content', async () => {
    await withCall(platform(), async (call) => {
      const r = await call('sb_function', { site_id: 's1', action: 'list' });
      expect(r.isError, r.text).toBe(false);
      const [fn, mod] = r.json.functions as any[];
      expect(fn).toMatchObject({ id: 'fn_1', slug: 'hello', route: '/_wb/fn/hello', enabled: true });
      expect(fn).not.toHaveProperty('content');
      expect(fn).not.toHaveProperty('compile_error');
      expect(mod).toMatchObject({ slug: '_util', module: true, compile_error: 'functions/_util.ts:1:1: boom' });
      expect(mod).not.toHaveProperty('route');
    });
  });

  it('get returns the source', async () => {
    await withCall(platform(), async (call) => {
      const r = await call('sb_function', { site_id: 's1', action: 'get', id: 'fn_1' });
      expect((r.json.function as any).content).toMatch(/Response/);
    });
  });

  it('set creates as a dry run by default, then sends slug/language/content/enabled', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const dry = await call('sb_function', { site_id: 's1', action: 'set', slug: 'webhook', content: 'export default () => 1' });
      expect(dry.json.dry_run).toBe(true);
      expect(p.writes).toEqual([]);
      const r = await call('sb_function', { site_id: 's1', action: 'set', slug: 'webhook', content: 'export default () => 1', dry_run: false });
      expect(r.isError, r.text).toBe(false);
      expect(p.writes[0]).toMatchObject({ method: 'POST', path: B, body: { slug: 'webhook', language: 'typescript', enabled: true } });
      expect(r.json.created).toMatchObject({ id: 'fn_2', route: '/_wb/fn/webhook' });
    });
  });

  it('set refuses a slug the server pattern refuses, before any request', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      for (const slug of ['Hello', '-x', 'a_b', '__x', 'a'.repeat(64), 'a/b']) {
        const r = await call('sb_function', { site_id: 's1', action: 'set', slug, content: 'x', dry_run: false });
        expect(r.isError, slug).toBe(true);
        expect(r.text).toMatch(/slug/);
      }
      expect(p.writes).toEqual([]);
      const ok = await call('sb_function', { site_id: 's1', action: 'set', slug: '_shared-1', content: 'export const a = 1', dry_run: false });
      expect(ok.isError, ok.text).toBe(false);
    });
  });

  it('update reads, merges, PUTs the whole row with expectedUpdatedAt and never the server-owned fields', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const r = await call('sb_function', { site_id: 's1', action: 'set', id: 'fn_1', enabled: false, dry_run: false });
      expect(r.isError, r.text).toBe(false);
      const put = p.writes[0];
      expect(put.method).toBe('PUT');
      expect(put.body).toEqual({
        slug: 'hello',
        language: 'typescript',
        content: 'export default () => new Response("hi")',
        enabled: false,
        expectedUpdatedAt: '2026-10-30T01:02:03.456789Z',
      });
      expect(r.json.changes).toEqual({ enabled: [true, false] });
    });
  });

  it('a set whose build failed leads with compile_error', async () => {
    await withCall(platform(), async (call) => {
      const r = await call('sb_function', { site_id: 's1', action: 'set', slug: 'x', content: 'let !', dry_run: false });
      expect(r.isError, r.text).toBe(false);
      expect(Object.keys(r.json)[0]).toBe('compile_error');
      expect(r.json.compile_error).toMatch(/Expected ";"/);
    });
  });

  it('remove deletes a function by id, dry run by default', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const dry = await call('sb_function', { site_id: 's1', action: 'remove', id: 'fn_1' });
      expect(dry.json.dry_run).toBe(true);
      expect(p.writes).toEqual([]);
      await call('sb_function', { site_id: 's1', action: 'remove', id: 'fn_1', dry_run: false });
      expect(p.writes[0]).toMatchObject({ method: 'DELETE', path: `${B}/fn_1` });
    });
  });

  it('test: dry run by default; runs with the request; returns the result; quota notice said once', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const args = { site_id: 's1', action: 'test', id: 'fn_1', method: 'POST', path: '/x', query: 'a=1', headers: { 'x-y': '1' }, cookies: { fn_s: 'v' }, body: '{}' };
      const dry = await call('sb_function', args);
      expect(dry.json.dry_run).toBe(true);
      expect(p.writes).toEqual([]);
      const r = await call('sb_function', { ...args, dry_run: false });
      expect(r.isError, r.text).toBe(false);
      expect(p.writes[0]).toMatchObject({ method: 'POST', path: `${B}/fn_1/test`, body: { method: 'POST', path: '/x', query: 'a=1', headers: { 'x-y': '1' }, cookies: { fn_s: 'v' }, body: '{}' } });
      expect(r.json.result).toMatchObject({ outcome: 'ok', status: 200, setCookies: ['fn_a=1; Path=/'], body: 'hi', console: 'log\n', durationMs: 12 });
      expect(r.text).toMatch(/quota/);
      const again = await call('sb_function', { ...args, dry_run: false });
      expect(again.text).not.toMatch(/quota/);
    });
  });

  it('logs and usage read the ring and the month', async () => {
    await withCall(platform(), async (call) => {
      const l = await call('sb_function', { site_id: 's1', action: 'logs', id: 'fn_1', limit: 5 });
      expect(l.isError, l.text).toBe(false);
      expect((l.json.invocations as any[])[0]).toMatchObject({ slug: 'hello', outcome: 'ok', test: true });
      const u = await call('sb_function', { site_id: 's1', action: 'usage' });
      expect(u.json.usage).toMatchObject({ invocations: 4, limit: 1000 });
    });
  });

  it('logs passes functionId and limit as query', async () => {
    const seen: string[] = [];
    const probe = fakePlatform((_m, path, _b, query) => {
      if (path !== `${B}/invocations`) return undefined;
      seen.push(query);
      return { invocations: [], total: 0 };
    });
    const { call, close } = await probe.connect();
    try {
      const r = await call('sb_function', { site_id: 's1', action: 'logs', id: 'fn_1', limit: 5 });
      expect(r.isError, r.text).toBe(false);
      expect(seen).toEqual(['?functionId=fn_1&limit=5']);
    } finally {
      await close();
    }
  });

  it('a secret value never appears in a dry-run preview or a result', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const dry = await call('sb_function', { site_id: 's1', action: 'secret', key: 'STRIPE_KEY', value: CANARY });
      expect(dry.json.dry_run).toBe(true);
      expect(dry.text).not.toContain(CANARY);
      expect(p.writes).toEqual([]);
      const r = await call('sb_function', { site_id: 's1', action: 'secret', key: 'STRIPE_KEY', value: CANARY, dry_run: false });
      expect(r.isError, r.text).toBe(false);
      expect(r.text).not.toContain(CANARY);
      // It did reach the wire, and only there.
      expect(p.writes[0]).toMatchObject({ method: 'PUT', path: `${B}/secrets/STRIPE_KEY`, body: { value: CANARY } });
      const list = await call('sb_function', { site_id: 's1', action: 'secret' });
      expect(list.json.secrets).toEqual([{ key: 'STRIPE_KEY', updatedAt: 't' }]);
    });
  });

  it('secret: a bad key is refused locally; remove takes key; key without value is refused', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const bad = await call('sb_function', { site_id: 's1', action: 'secret', key: 'lower', value: 'x', dry_run: false });
      expect(bad.isError).toBe(true);
      const novalue = await call('sb_function', { site_id: 's1', action: 'secret', key: 'STRIPE_KEY', dry_run: false });
      expect(novalue.isError).toBe(true);
      expect(novalue.text).toMatch(/action:"remove"/);
      expect(p.writes).toEqual([]);
      const both = await call('sb_function', { site_id: 's1', action: 'remove', id: 'fn_1', key: 'STRIPE_KEY', dry_run: false });
      expect(both.isError).toBe(true);
      expect(both.text).toMatch(/not both/);
      expect(p.writes).toEqual([]);
      await call('sb_function', { site_id: 's1', action: 'remove', key: 'STRIPE_KEY', dry_run: false });
      expect(p.writes[0]).toMatchObject({ method: 'DELETE', path: `${B}/secrets/STRIPE_KEY` });
    });
  });

  it('functions switched off on the platform reads as one clear message (editor 404 and v1 503)', async () => {
    for (const disabled of ['editor', 'v1'] as const) {
      await withCall(platform({ disabled }), async (call) => {
        const r = await call('sb_function', { site_id: 's1', action: 'list' });
        expect(r.isError).toBe(true);
        expect(r.text).toMatch(/switched off.*WB_FUNCTIONS/);
      });
    }
  });

  it('a plan with no function runs says so, on test and on usage', async () => {
    await withCall(platform({ notInPlan: true }), async (call) => {
      const t = await call('sb_function', { site_id: 's1', action: 'test', id: 'fn_1', dry_run: false });
      expect(t.isError).toBe(true);
      expect(t.text).toMatch(/plan grants no function runs/);
      const u = await call('sb_function', { site_id: 's1', action: 'usage' });
      expect(u.text).toMatch(/plan grants no function runs/);
    });
  });
});
