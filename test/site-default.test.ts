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

/**
 * `sb_api_call` REACHES 289 OPERATIONS THAT NAME THE SITE, and it used to demand
 * the id on every one of them while `siteFor()` was defaulting it everywhere
 * else. On a key-only install that is a 32-character constant the environment
 * already holds.
 */
describe('sb_api_call fills {siteId} from SB_SITE', () => {
  const seen: string[] = [];
  const f = (async (url: string) => {
    seen.push(String(url));
    return new Response('{"domains":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

  it('uses SB_SITE when path_params names no site', async () => {
    seen.length = 0;
    await callOperation(ctx({ apiKey: 'wbk_k', siteId: 'site_env', fetchImpl: f }), {
      id: 'get:/api/sites/{siteId}/domains',
      dry_run: false,
    });
    expect(seen[0]).toContain('/api/sites/site_env/domains');
  });

  it('still lets an explicit argument win, so a two-site session works', async () => {
    seen.length = 0;
    await callOperation(ctx({ apiKey: 'wbk_k', siteId: 'site_env', fetchImpl: f }), {
      id: 'get:/api/sites/{siteId}/domains',
      path_params: { siteId: 'site_arg' },
      dry_run: false,
    });
    expect(seen[0]).toContain('/api/sites/site_arg/domains');
  });

  it('still refuses a param that is NOT the site', async () => {
    await expect(
      callOperation(ctx({ apiKey: 'wbk_k', siteId: 'site_env', fetchImpl: f }), {
        id: 'get:/api/sites/{siteId}/products/{id}',
        dry_run: false,
      }),
    ).rejects.toThrow(/path param "id"/);
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
    // A silently dropped flag is worse than one that does not exist: the caller
    // believes it took effect and spends the session wondering why it did not.
    const errs: string[] = [];
    const spy = console.error;
    console.error = (...a: unknown[]) => void errs.push(a.join(' '));
    try {
      const code = runInstallCli(['--token', 'wbk_k', '--nonesuch', 'Shop', '--dry-run']);
      expect(code).toBe(1);
      expect(errs.join('\n')).toMatch(/unknown option\(s\) --nonesuch/);
    } finally {
      console.error = spy;
    }
  });

  // THIS TEST USED TO PIN THE OPPOSITE, and it was right when it was written.
  // `--site-name` then came from nowhere and meant nothing. It now comes from
  // the platform's own install screen (AgentAppPanel.vue appends it whenever the
  // store has a name, with a test of its own), so refusing it made the ONE
  // documented install path exit 1 and install nothing.
  it('takes --site-name, because the platform emits it', () => {
    const entry = buildEntry({ token: 'wbk_k', site: 'site_1', siteName: 'Bản sao của Test' });
    expect(entry.env.SB_SITE_NAME).toBe('Bản sao của Test');

    const errs: string[] = [];
    const spy = console.error;
    console.error = (...a: unknown[]) => void errs.push(a.join(' '));
    try {
      const code = runInstallCli([
        '--token', 'wbk_k', '--site', 'site_1', '--site-name', 'Shop', '--dry-run',
      ]);
      expect(errs.join('\n')).not.toMatch(/unknown option/);
      expect(code).toBe(0);
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
