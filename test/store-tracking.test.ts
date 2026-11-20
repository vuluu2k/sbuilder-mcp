// sb_store action:"tracking" — a store's measurement in one call: status, install
// from any pasted vendor snippet (the server's detect names providers and cleans
// ids), and switching one tracker on or off. The server owns every rule; this
// sequences calls, so the assertions are on the calls made and the answers relayed.
import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

function store(opts: { failCreate?: boolean } = {}) {
  const calls: Call[] = [];
  const rows = [
    {
      id: 'i_ga',
      provider: 'google_analytics',
      enabled: false,
      config: { measurementId: 'UA-1', note: 'keep' },
      problem: 'UA- is Universal Analytics',
    },
  ];
  const f = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path, body });
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (path === '/api/sites/s1/integrations' && method === 'GET')
      return json({ integrations: rows, total: rows.length });
    if (path === '/api/sites/s1/integrations/detect') {
      const text = String(body?.text ?? '');
      const found = [];
      if (text.includes('G-NEW'))
        found.push({
          provider: 'google_analytics',
          enabled: true,
          config: { measurementId: 'G-NEW12345' },
        });
      if (text.includes('oaiq'))
        found.push({
          provider: 'openai_pixel',
          enabled: true,
          config: { pixelId: 'pX_1' },
        });
      return json({ integrations: found, total: found.length });
    }
    if (path === '/api/sites/s1/integrations' && method === 'POST') {
      if (opts.failCreate) {
        return json(
          {
            error: 'integrations: invalid integration: invalid tracking id: …',
            code: 'invalid_tracking_id',
          },
          400,
        );
      }
      return json({ integration: { id: 'i_new', ...body } }, 201);
    }
    if (path.startsWith('/api/sites/s1/integrations/') && method === 'PUT')
      return json({ integration: { id: 'i_ga', ...body } });
    if (path === '/api/sites/s1/forms/submissions/channels') {
      return json({
        channels: [{ channel: 'chatgpt', submissions: 4, orders: 1 }],
        total: 1,
      });
    }
    return json({});
  }) as unknown as typeof fetch;
  return { f, calls };
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
const call = async (f: typeof fetch, args: Record<string, unknown>) => {
  const { client, close } = await clientOver(f);
  try {
    return parse(
      await client.callTool({
        name: 'sb_store',
        arguments: { action: 'tracking', ...args },
      }),
    );
  } finally {
    await close();
  }
};

describe('sb_store action:"tracking"', () => {
  it('alone: every provider, its id and problem, and where visitors came from — and writes nothing', async () => {
    const { f, calls } = store();
    const out = await call(f, {});
    const trackers = out.trackers as Array<Record<string, unknown>>;
    expect(trackers.map((t) => t.provider)).toEqual([
      'google_analytics',
      'google_tag_manager',
      'facebook_pixel',
      'tiktok_pixel',
      'openai_pixel',
    ]);
    expect(trackers[0]).toEqual({
      provider: 'google_analytics',
      id: 'UA-1',
      enabled: false,
      problem: 'UA- is Universal Analytics',
    });
    expect(trackers[4]).toEqual({ provider: 'openai_pixel', connected: false });
    expect(out.channelsLast30Days).toEqual([{ channel: 'chatgpt', submissions: 4, orders: 1 }]);
    expect(
      calls.filter((c) => c.method !== 'GET'),
      'a status read wrote',
    ).toEqual([]);
  });

  it('with text: dry run plans an UPDATE for a connected provider (config kept, switched on) and a CREATE for a new one', async () => {
    const { f, calls } = store();
    const out = await call(f, {
      text: '<script>gtag G-NEW</script><script>oaiq("init",…)</script>',
    });
    expect(out.dry_run).toBe(true);
    const plan = out.plan as Array<Record<string, unknown>>;
    expect(plan[0]).toMatchObject({
      provider: 'google_analytics',
      id: 'G-NEW12345',
      replaces: 'UA-1',
      method: 'PUT',
      path: '/api/sites/s1/integrations/i_ga',
      body: {
        provider: 'google_analytics',
        enabled: true,
        config: { measurementId: 'G-NEW12345', note: 'keep' },
      },
    });
    expect(plan[1]).toMatchObject({
      provider: 'openai_pixel',
      method: 'POST',
      path: '/api/sites/s1/integrations',
    });
    expect(
      calls.filter((c) => c.method === 'PUT' || (c.method === 'POST' && !c.path.endsWith('/detect'))),
      'a dry run wrote',
    ).toEqual([]);
  });

  it('with text and dry_run:false: writes each, and one refusal does not stop the others', async () => {
    const { f, calls } = store({ failCreate: true });
    const out = await call(f, { text: 'G-NEW oaiq', dry_run: false });
    const results = out.results as Array<Record<string, unknown>>;
    expect(results[0]).toMatchObject({
      provider: 'google_analytics',
      ok: true,
    });
    expect(results[1]).toMatchObject({ provider: 'openai_pixel', ok: false });
    expect(String(results[1].error), 'the server sentence was lost').toContain('invalid tracking id');
    expect(calls.some((c) => c.method === 'PUT' && c.path.endsWith('/i_ga'))).toBe(true);
  });

  it('nothing recognised says what to do instead of writing', async () => {
    const { f, calls } = store();
    const out = await call(f, { text: 'hello', dry_run: false });
    expect(out.recognised).toEqual([]);
    expect(String(out.note)).toContain('whole snippet');
    expect(calls.filter((c) => c.method === 'PUT' || (c.method === 'POST' && !c.path.endsWith('/detect')))).toEqual([]);
  });

  it('provider + enabled switches one, keeping its config; an unconnected one is refused by name', async () => {
    const { f, calls } = store();
    const out = await call(f, {
      provider: 'google_analytics',
      enabled: true,
      dry_run: false,
    });
    expect(out).toMatchObject({ provider: 'google_analytics', enabled: true });
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toEqual({
      provider: 'google_analytics',
      enabled: true,
      config: { measurementId: 'UA-1', note: 'keep' },
    });
    const { f: f2 } = store();
    const { client, close } = await clientOver(f2);
    const res = (await client.callTool({
      name: 'sb_store',
      arguments: {
        action: 'tracking',
        provider: 'tiktok_pixel',
        enabled: false,
      },
    })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    await close();
    expect(res.content[0].text).toContain('not connected');
  });
});
