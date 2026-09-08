import { describe, it, expect } from 'vitest';
import { siteFor } from '../src/tools/context.js';
import { callOperation } from '../src/tools/api.js';
import { buildEntry, runInstallCli } from '../src/install/index.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

const ctx = (over: Record<string, unknown> = {}) =>
  ({
    base: 'http://x',
    session: new Session('http://x'),
    notices: new Notices(), undo: new UndoLog(),
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

/**
 * ONE PARAMETER, TWO SPELLINGS.
 *
 * The platform writes `{siteId}` in 281 operations and `{siteID}` in 8. A caller
 * who learned the common spelling is refused on those eight for a difference of
 * one letter — a distinction no reader of the call sheet has reason to notice.
 */
describe('sb_api_call path params fold case', () => {
  const seen: string[] = [];
  const f = (async (url: string) => {
    seen.push(String(url));
    return new Response('{"menus":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  it('accepts the common spelling for an operation that uses the rare one', async () => {
    seen.length = 0;
    await callOperation(ctx({ apiKey: 'wbk_k', fetchImpl: f }), {
      id: 'get:/api/sites/{siteID}/menus',
      path_params: { siteId: 'site_1' },
      dry_run: false,
    });
    expect(seen[0]).toContain('/api/sites/site_1/menus');
  });

  it('still prefers an exact match when both are present', async () => {
    seen.length = 0;
    await callOperation(ctx({ apiKey: 'wbk_k', fetchImpl: f }), {
      id: 'get:/api/sites/{siteID}/menus',
      path_params: { siteID: 'exact', siteId: 'folded' },
      dry_run: false,
    });
    expect(seen[0]).toContain('/api/sites/exact/menus');
  });

  it('still refuses when the parameter is genuinely absent', async () => {
    await expect(
      callOperation(ctx({ apiKey: 'wbk_k', fetchImpl: f }), { id: 'get:/api/sites/{siteID}/menus' }),
    ).rejects.toThrow(/path_params/);
  });
});
