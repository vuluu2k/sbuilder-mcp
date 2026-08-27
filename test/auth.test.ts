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
});
