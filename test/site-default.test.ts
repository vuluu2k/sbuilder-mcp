import { describe, it, expect } from 'vitest';
import { siteFor } from '../src/tools/context.js';
import { callOperation } from '../src/tools/api.js';
import { buildEntry, runInstallCli } from '../src/install/index.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';

const ctx = (over: Record<string, unknown> = {}) =>
  ({
    base: 'http://x',
    session: new Session('http://x'),
    notices: new Notices(),
    ...over,
  }) as never;

/**
 * THE SITE ID, which a key-only install already knows.
 *
 * A key belongs to exactly one site, so requiring the id on every call made the
 * model carry a 32-character string it can only obtain by listing pages and
 * reading one back.
 */
describe('siteFor()', () => {
  it('prefers the argument, so a two-site session still works', () => {
    expect(siteFor(ctx({ siteId: 'site_env' }), 'site_arg')).toBe('site_arg');
  });

  it('falls back to SB_SITE', () => {
    expect(siteFor(ctx({ siteId: 'site_env' }))).toBe('site_env');
  });

  it('names the fix when neither is there', () => {
    expect(() => siteFor(ctx())).toThrow(/SB_SITE/);
  });
});

describe('sb_api_call refusals and empty answers', () => {
  it('says WHERE a missing path param goes', async () => {
    await expect(
      callOperation(ctx({ apiKey: 'wbk_k' }), { id: 'get:/api/v1/pages/{id}' }),
    ).rejects.toThrow(/path_params/);
  });

  it('reports a no-content answer instead of null', async () => {
    // Sixteen page deletes in a row each reported `null`, which reads the same
    // as a call that did nothing.
    const f = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const out = (await callOperation(
      ctx({ apiKey: 'wbk_k', fetchImpl: f }),
      { id: 'delete:/api/v1/pages/{id}', path_params: { id: 'pg_1' }, dry_run: false },
    )) as { ok: boolean; method: string };
    expect(out.ok).toBe(true);
    expect(out.method).toBe('DELETE');
  });
});

describe('the installer', () => {
  it('writes SB_SITE when --site named one', () => {
    const entry = buildEntry({ token: 'wbk_k', api: 'http://h', site: 'site_1' });
    expect(entry.env).toMatchObject({ SB_TOKEN: 'wbk_k', SB_API: 'http://h', SB_SITE: 'site_1' });
  });

  it('leaves SB_SITE out when no site was named', () => {
    expect(buildEntry({ token: 'wbk_k' }).env).not.toHaveProperty('SB_SITE');
  });

  it('REFUSES an unknown flag rather than dropping it', () => {
    // `--site-name` was typed at a real install, read by nothing, and reported
    // as success. A silently dropped flag is worse than one that does not exist.
    const errs: string[] = [];
    const spy = console.error;
    console.error = (...a: unknown[]) => void errs.push(a.join(' '));
    try {
      const code = runInstallCli(['--token', 'wbk_k', '--site-name', 'Shop', '--dry-run']);
      expect(code).toBe(1);
      expect(errs.join('\n')).toMatch(/unknown option\(s\) --site-name/);
    } finally {
      console.error = spy;
    }
  });
});
