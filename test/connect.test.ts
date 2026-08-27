import { describe, it, expect, vi } from 'vitest';
import { connect } from '../src/tools/session.js';
import { Session } from '../src/transport/auth.js';

function scriptedFetch() {
  return vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.endsWith('/api/auth/login')) {
      return new Response(
        JSON.stringify({
          user: { id: 'u1', name: 'Agent' },
          tokens: { accessToken: 'a1', refreshToken: 'r1', tokenType: 'Bearer', expiresIn: 900 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ sites: [{ id: 's1', name: 'Shop' }], total: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function ctx(f: typeof fetch, apiKey?: string) {
  return { base: 'http://x', session: new Session('http://x', f), apiKey, fetchImpl: f };
}

describe('connect()', () => {
  it('logs in and lists the sites', async () => {
    const f = scriptedFetch();
    const out = await connect(ctx(f, 'wbk_k'), { email: 'e@x', password: 'pw' });
    expect(out.user).toBe('Agent');
    expect(out.sites).toEqual([{ id: 's1', name: 'Shop' }]);
    expect(out.api_key).toBe('present');
    expect(out.operations).toBeGreaterThan(300);
  });

  it('reports a missing API key without failing - half the surface still works', async () => {
    const f = scriptedFetch();
    const out = await connect(ctx(f), { email: 'e@x', password: 'pw' });
    expect(out.api_key).toBe('missing');
    expect(String(out.note)).toMatch(/api_key_required/);
  });

  it('never echoes the password', async () => {
    const f = scriptedFetch();
    const out = await connect(ctx(f), { email: 'e@x', password: 'hunter2' });
    expect(JSON.stringify(out)).not.toContain('hunter2');
  });

  it('names both env vars when neither credentials nor args are present', async () => {
    const f = scriptedFetch();
    const saved = [process.env.SB_EMAIL, process.env.SB_PASSWORD];
    delete process.env.SB_EMAIL;
    delete process.env.SB_PASSWORD;
    await expect(connect(ctx(f), {})).rejects.toThrow(/SB_EMAIL.*SB_PASSWORD/);
    if (saved[0]) process.env.SB_EMAIL = saved[0];
    if (saved[1]) process.env.SB_PASSWORD = saved[1];
  });

  it('tolerates a site list the server sent without the key', async () => {
    const f = vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/api/auth/login')) {
        return new Response(
          JSON.stringify({
            user: { id: 'u1', name: 'Agent' },
            tokens: { accessToken: 'a1', refreshToken: 'r1', tokenType: 'Bearer', expiresIn: 900 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const out = await connect(ctx(f), { email: 'e@x', password: 'pw' });
    expect(out.sites).toEqual([]);
  });
});
