import { describe, it, expect, vi } from 'vitest';
import { callOperation } from '../src/tools/api.js';
import { Session } from '../src/transport/auth.js';

const ok = () =>
  vi.fn(
    async () =>
      new Response(JSON.stringify({ menus: [], total: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;

function calls(f: typeof fetch) {
  return (f as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}

async function ctxWith(fetchImpl: typeof fetch, apiKey?: string) {
  const loginFetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          user: { id: 'u1', name: 'Agent' },
          tokens: { accessToken: 'jwt', refreshToken: 'r', tokenType: 'Bearer', expiresIn: 900 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  ) as unknown as typeof fetch;
  const session = new Session('http://x', loginFetch);
  await session.login('e@x', 'pw');
  return { base: 'http://x', session, apiKey, fetchImpl };
}

describe('callOperation()', () => {
  it('substitutes path params', async () => {
    const f = ok();
    await callOperation(await ctxWith(f, 'wbk_k'), {
      id: 'get:/api/sites/{siteID}/menus',
      path_params: { siteID: 's1' },
      dry_run: false,
    });
    expect(calls(f)[0][0]).toBe('http://x/api/sites/s1/menus');
  });

  it('refuses when a required path param is missing', async () => {
    await expect(
      callOperation(await ctxWith(ok(), 'wbk_k'), {
        id: 'get:/api/sites/{siteID}/menus',
        dry_run: false,
      }),
    ).rejects.toThrow(/siteID/);
  });

  it('refuses an unknown operation id', async () => {
    await expect(
      callOperation(await ctxWith(ok(), 'wbk_k'), { id: 'get:/nope', dry_run: false }),
    ).rejects.toThrow(/unknown operation/i);
  });

  it('PREFERS the API key on a private path - it is the narrower credential', async () => {
    const f = ok();
    await callOperation(await ctxWith(f, 'wbk_k'), {
      id: 'get:/api/sites/{siteID}/menus',
      path_params: { siteID: 's1' },
      dry_run: false,
    });
    const init = calls(f)[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer wbk_k');
  });

  it('falls back to the session on a private path when no key is set', async () => {
    const f = ok();
    await callOperation(await ctxWith(f), {
      id: 'get:/api/sites/{siteID}/menus',
      path_params: { siteID: 's1' },
      dry_run: false,
    });
    const init = calls(f)[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
  });

  it('names both ways to authenticate when neither is present', async () => {
    const loginless = { base: 'http://x', session: new Session('http://x'), fetchImpl: ok() };
    await expect(
      callOperation(loginless, {
        id: 'get:/api/sites/{siteID}/menus',
        path_params: { siteID: 's1' },
        dry_run: false,
      }),
    ).rejects.toThrow(/SB_TOKEN.*SB_EMAIL|SB_EMAIL.*SB_TOKEN/s);
  });

  it('sends the API key for a /api/v1 path', async () => {
    const f = ok();
    await callOperation(await ctxWith(f, 'wbk_k'), { id: 'get:/api/v1/products', dry_run: false });
    const init = calls(f)[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer wbk_k');
  });

  it('says which env var is missing rather than sending an unauthenticated v1 call', async () => {
    await expect(
      callOperation(await ctxWith(ok()), { id: 'get:/api/v1/products', dry_run: false }),
    ).rejects.toThrow(/SB_TOKEN/);
  });

  it('defaults to a dry run that touches no network and redacts the token', async () => {
    const f = ok();
    const out = (await callOperation(await ctxWith(f, 'wbk_k'), {
      id: 'get:/api/sites/{siteID}/menus',
      path_params: { siteID: 's1' },
    })) as Record<string, unknown>;
    expect(calls(f).length).toBe(0);
    expect(out.dry_run).toBe(true);
    expect(JSON.stringify(out)).not.toContain('jwt');
  });

  it('encodes a path param rather than letting it inject a path segment', async () => {
    const f = ok();
    await callOperation(await ctxWith(f, 'wbk_k'), {
      id: 'get:/api/sites/{siteID}/menus',
      path_params: { siteID: 'a/../b' },
      dry_run: false,
    });
    expect(calls(f)[0][0]).toBe('http://x/api/sites/a%2F..%2Fb/menus');
  });
});
