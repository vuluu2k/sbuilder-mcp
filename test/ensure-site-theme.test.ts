import { describe, it, expect } from 'vitest';
import { Session } from '../src/transport/auth.js';
import { ensureSiteTheme } from '../src/tools/theme.js';
import { STARTER_THEME } from '../src/domains/site/theme.js';

/**
 * Publish compiles only the STORED theme, so a page built on a site that never
 * saved one ships `var(--wb-color-primary)` with nothing declaring it. The first
 * page write saves the starter, exactly once, and never over a stored theme.
 */
function harness(themeReply: () => Response) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? 'GET';
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'GET') return themeReply();
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const ctx = { base: 'http://x', session: new Session('http://x'), apiKey: 'wbk_k', fetchImpl } as never;
  return { ctx, calls };
}
const json = (v: unknown) =>
  new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });

describe('ensureSiteTheme', () => {
  it('saves the starter theme for a site with none, and only once', async () => {
    const { ctx, calls } = harness(() => json({ theme: null }));
    await ensureSiteTheme(ctx, 'site_new');
    await ensureSiteTheme(ctx, 'site_new');
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts.map((c) => c.path), 'one theme PUT').toEqual(['/api/sites/site_new/theme']);
    expect((puts[0]!.body as { theme: unknown }).theme, 'the starter, whole').toEqual(STARTER_THEME);
    expect(calls.filter((c) => c.method === 'GET'), 'second call hits the cache').toHaveLength(1);
  });

  it('never writes over a stored theme', async () => {
    const { ctx, calls } = harness(() => json({ theme: { version: 6, colors: [], presets: [] } }));
    await ensureSiteTheme(ctx, 'site_saved');
    expect(calls.filter((c) => c.method === 'PUT'), 'no PUT over a stored theme').toHaveLength(0);
  });

  it('swallows a failed read and retries on the next save', async () => {
    let fail = true;
    const { ctx, calls } = harness(() =>
      fail ? new Response('{"error":"boom"}', { status: 500, headers: { 'content-type': 'application/json' } }) : json({ theme: null }),
    );
    await expect(ensureSiteTheme(ctx, 'site_flaky')).resolves.toBeUndefined();
    expect(calls.filter((c) => c.method === 'PUT'), 'nothing written on a failed read').toHaveLength(0);
    fail = false;
    await ensureSiteTheme(ctx, 'site_flaky');
    expect(calls.filter((c) => c.method === 'PUT'), 'retried after the failure').toHaveLength(1);
  });
});
