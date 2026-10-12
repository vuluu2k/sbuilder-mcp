import { describe, it, expect, vi } from 'vitest';
import { Session } from '../src/transport/auth.js';
import { request } from '../src/transport/http.js';

function tokensBody(access: string) {
  return JSON.stringify({
    user: { id: 'u1', name: 'Agent' },
    tokens: { accessToken: access, refreshToken: 'r1', tokenType: 'Bearer', expiresIn: 900 },
  });
}

function loginFetch(access: string) {
  return vi.fn(
    async () =>
      new Response(tokensBody(access), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

describe('Session', () => {
  it('stores the access token and the user name after login', async () => {
    const s = new Session('http://x', loginFetch('a1'));
    await s.login('e@x', 'pw');
    expect(s.token()).toBe('a1');
    expect(s.userName).toBe('Agent');
  });

  it('throws when token() is called before login', () => {
    const s = new Session('http://x', loginFetch('a1'));
    expect(() => s.token()).toThrow(/not logged in/i);
  });

  it('returns the NEW token after a refresh - the getter is not a snapshot', async () => {
    const f = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { refreshToken?: string };
      const access = body.refreshToken ? 'a2' : 'a1';
      return new Response(tokensBody(access), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const s = new Session('http://x', f);
    await s.login('e@x', 'pw');
    const captured = s.token(); // what a buggy caller would have kept
    await s.refresh();
    expect(s.token()).toBe('a2');
    expect(captured).toBe('a1');
  });

  it('refuses to refresh before a login', async () => {
    const s = new Session('http://x', loginFetch('a1'));
    await expect(s.refresh()).rejects.toThrow(/no refresh token/i);
  });

  it('signs its device out with the refresh token, and a re-login frees the first device', async () => {
    const calls: Array<[string, unknown]> = [];
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push([new URL(String(url)).pathname, JSON.parse(String(init?.body ?? '{}'))]);
      if (String(url).endsWith('/logout')) return new Response(null, { status: 204 });
      return new Response(tokensBody('a1'), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const s = new Session('http://x', f);
    await s.logout(); // never signed in: no request
    await s.login('e@x', 'pw');
    await s.login('e@x', 'pw');
    await s.logout();
    expect(calls.map((c) => c[0])).toEqual(['/api/auth/login', '/api/auth/logout', '/api/auth/login', '/api/auth/logout']);
    expect(calls[1][1]).toEqual({ refreshToken: 'r1' });
    expect(s.loggedIn()).toBe(false);
  });

  it('a failed sign-out never throws', async () => {
    let n = 0;
    const f = vi.fn(async () =>
      n++ === 0
        ? new Response(tokensBody('a1'), { status: 200, headers: { 'content-type': 'application/json' } })
        : Promise.reject(new Error('down')),
    ) as unknown as typeof fetch;
    const s = new Session('http://x', f);
    await s.login('e@x', 'pw');
    await expect(s.logout()).resolves.toBeUndefined();
  });

  it('two concurrent logins sign the first device out instead of stranding it', async () => {
    const paths: string[] = [];
    const f = vi.fn(async (url: unknown) => {
      paths.push(new URL(String(url)).pathname);
      if (String(url).endsWith('/logout')) return new Response(null, { status: 204 });
      return new Response(tokensBody('a1'), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const s = new Session('http://x', f);
    await Promise.all([s.login('e@x', 'pw'), s.login('e@x', 'pw')]);
    expect(paths).toEqual(['/api/auth/login', '/api/auth/logout', '/api/auth/login']);
  });
});

describe('a refused access token renews itself once (web_builder af905a126)', () => {
  // A platform whose access token `a1` has expired: it answers 401 to a1, 200 to a2.
  function platform() {
    // Tokens unique to this platform: every Session in the process listens for 401s.
    const id = Math.random().toString(36).slice(2);
    const [a1, a2] = [`a1-${id}`, `a2-${id}`];
    const calls: string[] = [];
    let refreshes = 0;
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? '';
      calls.push(`${path} ${auth}`);
      const json = (b: unknown, status = 200) =>
        new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
      if (path === '/api/auth/login') return json({ user: { id: 'u', name: 'A' }, tokens: { accessToken: a1, refreshToken: 'r1', tokenType: 'Bearer', expiresIn: 60 } });
      if (path === '/api/auth/refresh') {
        refreshes++;
        await new Promise((r) => setTimeout(r, 5));
        return json({ tokens: { accessToken: a2, refreshToken: 'r2', tokenType: 'Bearer', expiresIn: 60 } });
      }
      return auth === `Bearer ${a2}` ? json({ ok: true }) : json({ error: 'expired', code: 'unauthorized' }, 401);
    }) as unknown as typeof fetch;
    return { f, calls, a2, refreshes: () => refreshes };
  }

  it('refreshes once and retries the request with the new token', async () => {
    const p = platform();
    const s = new Session('http://x', p.f);
    await s.login('e@x', 'pw');
    const out = await request({ base: 'http://x', method: 'GET', path: '/api/sites', token: s.token(), fetchImpl: p.f });
    expect(out).toEqual({ ok: true });
    expect(p.refreshes()).toBe(1);
    expect(s.token()).toBe(p.a2);
  });

  it('two requests refused at once share ONE refresh — a refresh token is single-use', async () => {
    const p = platform();
    const s = new Session('http://x', p.f);
    await s.login('e@x', 'pw');
    const t = s.token();
    const both = await Promise.all([
      request({ base: 'http://x', method: 'GET', path: '/api/sites', token: t, fetchImpl: p.f }),
      request({ base: 'http://x', method: 'GET', path: '/api/sites/s1', token: t, fetchImpl: p.f }),
    ]);
    expect(both).toEqual([{ ok: true }, { ok: true }]);
    expect(p.refreshes()).toBe(1);
  });

  it('never renews a token that is not the session\'s own — an API key fails as it was', async () => {
    const p = platform();
    const s = new Session('http://x', p.f);
    await s.login('e@x', 'pw');
    await expect(
      request({ base: 'http://x', method: 'GET', path: '/api/v1/products', token: 'wbk_key', fetchImpl: p.f }),
    ).rejects.toThrow(/expired/);
    expect(p.refreshes()).toBe(0);
  });
});

describe('ensureFresh — renewal before a call that cannot retry itself', () => {
  it('refreshes within 30s of the issued lifetime, and not before', async () => {
    let refreshes = 0;
    const pair = (a: string, expiresIn: number) => ({ accessToken: a, refreshToken: `r-${a}`, tokenType: 'Bearer', expiresIn });
    const f = vi.fn(async (url: unknown) => {
      const path = new URL(String(url)).pathname;
      const body = path === '/api/auth/refresh' ? (refreshes++, { tokens: pair('b2', 3600) }) : { user: { id: 'u', name: 'A' }, tokens: pair('b1', 10) };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const s = new Session('http://x', f);
    await s.login('e@x', 'pw'); // expires in 10s: inside the 30s window
    await s.ensureFresh();
    expect(refreshes).toBe(1);
    expect(s.token()).toBe('b2');
    await s.ensureFresh(); // an hour left: nothing to do
    expect(refreshes).toBe(1);
  });
});

describe('renewal edge cases (verifier probes)', () => {
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const pair = (a: string, r: string) => ({ accessToken: a, refreshToken: r, tokenType: 'Bearer', expiresIn: 3600 });

  it('a failed refresh surfaces the ORIGINAL 401, carrying nothing from the refresh', async () => {
    const id = Math.random().toString(36).slice(2);
    const f = vi.fn(async (url: unknown) => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/auth/login') return json({ user: { id: 'u', name: 'A' }, tokens: pair(`x1-${id}`, 'SECRET_R1') });
      if (path === '/api/auth/refresh') return json({ error: 'refresh SECRET_R1 refused', code: 'invalid_refresh' }, 401);
      return json({ error: 'unauthorized', code: 'unauthorized' }, 401);
    }) as unknown as typeof fetch;
    const s = new Session('http://x', f);
    await s.login('e@x', 'pw');
    const err = await request({ base: 'http://x', method: 'GET', path: '/api/sites', token: s.token(), fetchImpl: f }).catch((e) => e as Error);
    expect(err.message).toMatch(/http 401/);
    expect(err.message).not.toMatch(/SECRET/);
  });

  it('a genuine refusal costs exactly one refresh, then the 401 stands', async () => {
    const id = Math.random().toString(36).slice(2);
    let refreshes = 0;
    const f = vi.fn(async (url: unknown) => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/auth/login') return json({ user: { id: 'u', name: 'A' }, tokens: pair(`y1-${id}`, 'r1') });
      if (path === '/api/auth/refresh') return refreshes++, json({ tokens: pair(`y2-${id}-${refreshes}`, `r${refreshes + 1}`) });
      return json({ error: 'forbidden here', code: 'unauthorized' }, 401);
    }) as unknown as typeof fetch;
    const s = new Session('http://x', f);
    await s.login('e@x', 'pw');
    await expect(request({ base: 'http://x', method: 'GET', path: '/api/x', token: s.token(), fetchImpl: f })).rejects.toThrow(/401/);
    expect(refreshes).toBe(1);
  });

  // A refresh slow enough to sign out, or in again, while it is in flight.
  function slowPlatform() {
    const id = Math.random().toString(36).slice(2);
    let logins = 0;
    const loggedOut: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const body = JSON.parse(String(init?.body ?? '{}')) as { refreshToken?: string };
      if (path === '/api/auth/login') return logins++, json({ user: { id: 'u', name: 'A' }, tokens: pair(`z${logins}-${id}`, `rl${logins}`) });
      if (path === '/api/auth/refresh') {
        await gate;
        return json({ tokens: pair(`zr-${id}`, 'r-rotated') });
      }
      if (path === '/api/auth/logout') return loggedOut.push(String(body.refreshToken)), new Response(null, { status: 204 });
      return json({ error: 'unauthorized', code: 'unauthorized' }, 401);
    }) as unknown as typeof fetch;
    return { f, id, release, loggedOut };
  }

  it('a sign-in during a renewal keeps the NEW session, and signs out the rotated one', async () => {
    const p = slowPlatform();
    const s = new Session('http://x', p.f);
    await s.login('e@x', 'pw');
    const pending = request({ base: 'http://x', method: 'GET', path: '/api/x', token: s.token(), fetchImpl: p.f }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 5)); // the 401 has started the refresh
    const relogin = s.login('e@x', 'pw');
    p.release();
    await relogin;
    await pending;
    expect(s.token()).toBe(`z2-${p.id}`);
    expect(p.loggedOut).toEqual(['r-rotated']); // never the spent rl1
  });

  it('a sign-out during a renewal stays signed out', async () => {
    const p = slowPlatform();
    const s = new Session('http://x', p.f);
    await s.login('e@x', 'pw');
    const pending = request({ base: 'http://x', method: 'GET', path: '/api/x', token: s.token(), fetchImpl: p.f }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 5));
    const out = s.logout();
    p.release();
    await out;
    await pending;
    expect(s.loggedIn()).toBe(false);
    expect(p.loggedOut).toEqual(['r-rotated']);
  });
});
