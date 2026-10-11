import { describe, it, expect, vi } from 'vitest';
import { Session } from '../src/transport/auth.js';

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
