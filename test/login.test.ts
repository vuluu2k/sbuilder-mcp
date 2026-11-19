import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/transport/auth.js';
import { credentialsPath, readPairSync, rotate, RELOGIN, savePair } from '../src/transport/stored.js';
import { DEVICE_CLIENT, openBrowser } from '../src/transport/device.js';
import { request } from '../src/transport/http.js';
import { jwtExpiry } from '../src/transport/auth.js';
import { login, useSite, WAIT } from '../src/tools/login.js';
import { connect } from '../src/tools/session.js';
import { keyServes, tokenFor } from '../src/tools/api.js';
import { buildEntry, deviceLogin, PROD_API, runInstall, runInstallCli } from '../src/install/index.js';
import { pickLang } from '../src/install/guided.js';
import { buildContext } from '../src/server.js';
import type { ToolContext } from '../src/tools/context.js';

/**
 * The browser account login: one shared file with the sb CLI, rotation under
 * its lock, a session that survives the process, and a site the agent can move.
 */

const API = 'http://x';
let dir = '';
const saved = { ...process.env };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sb-login-'));
  process.env.XDG_CONFIG_HOME = dir;
  process.env.SB_NO_BROWSER = '1';
  delete process.env.SB_EMAIL;
  delete process.env.SB_PASSWORD;
  WAIT.ms = 50;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...saved };
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fileNow = () => JSON.parse(readFileSync(credentialsPath(), 'utf8'));

/** A platform: device flow (approved after `pendingPolls`), refresh, me, sites. */
function platform(opts: { pendingPolls?: number; deny?: boolean } = {}) {
  let polls = 0;
  const calls: string[] = [];
  const f = vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path === '/api/auth/device/start') {
      expect(body.client).toBe(DEVICE_CLIENT);
      return json({ deviceCode: 'dc', userCode: 'ABCD-EFGH', verificationUri: 'http://ed/device', expiresIn: 600, interval: 0 });
    }
    if (path === '/api/auth/device/token') {
      if (opts.deny) return json({ error: 'denied', code: 'access_denied' }, 400);
      if (polls++ < (opts.pendingPolls ?? 0)) return json({ error: 'wait', code: 'authorization_pending' }, 400);
      return json({ tokens: { accessToken: 'A1', refreshToken: 'R1' } });
    }
    if (path === '/api/auth/refresh') return json({ tokens: { accessToken: 'A2', refreshToken: 'R2' } });
    if (path === '/api/auth/logout') return json({});
    if (path === '/api/auth/me') return json({ user: { email: 'owner@shop.vn' } });
    if (path === '/api/sites') {
      return json({ sites: [{ id: 's1', name: 'Áo Thun' }, { id: 's2', name: 'Trà' }], total: 2 });
    }
    return json({ error: 'nope' }, 404);
  }) as unknown as typeof fetch;
  return { f, calls };
}

function ctxOf(f: typeof fetch, extra: Partial<ToolContext> = {}): ToolContext {
  return { base: API, session: new Session(API, f), fetchImpl: f, ...extra } as ToolContext;
}

describe('the shared login file', () => {
  it('is the sb CLI file, owner-only', async () => {
    expect(credentialsPath()).toBe(join(dir, 'sb', 'credentials.json'));
    await savePair(API, { accessToken: 'a', refreshToken: 'r' });
    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600);
    expect(readPairSync(API)).toEqual({ accessToken: 'a', refreshToken: 'r' });
  });

  it('adopts a pair another process already rotated to — no refresh request', async () => {
    await savePair(API, { accessToken: 'NEW', refreshToken: 'RNEW' });
    const { f, calls } = platform();
    expect(await rotate(API, 'OLD', f)).toEqual({ accessToken: 'NEW', refreshToken: 'RNEW' });
    expect(calls).not.toContain('/api/auth/refresh');
  });

  it('rotates once and writes it back when it holds the refused token', async () => {
    await savePair(API, { accessToken: 'A1', refreshToken: 'R1' });
    const { f } = platform();
    expect(await rotate(API, 'A1', f)).toEqual({ accessToken: 'A2', refreshToken: 'R2' });
    expect(fileNow()[API]).toEqual({ accessToken: 'A2', refreshToken: 'R2' });
  });

  it('a refused refresh removes the login and says to sign in again', async () => {
    await savePair(API, { accessToken: 'A1', refreshToken: 'R1' });
    const f = vi.fn(async () => json({ error: 'x' }, 401)) as unknown as typeof fetch;
    await expect(rotate(API, 'A1', f)).rejects.toThrow(RELOGIN);
    expect(fileNow()[API]).toBeUndefined();
  });
});

describe('a stored session', () => {
  it('outlives the process: exiting never revokes it; forgetStored does', async () => {
    await savePair(API, { accessToken: 'A1', refreshToken: 'R1' });
    const { f, calls } = platform();
    const s = new Session(API, f);
    await s.adoptStored(readPairSync(API)!);
    await s.logout();
    expect(calls, 'a process exit signed the machine out').not.toContain('/api/auth/logout');
    expect(fileNow()[API]).toBeDefined();
    await s.adoptStored(readPairSync(API)!);
    await s.forgetStored();
    expect(calls).toContain('/api/auth/logout');
    expect(fileNow()[API]).toBeUndefined();
  });

  it('a password session still signs itself out on exit (liveness of the branch above)', async () => {
    const { f, calls } = platform();
    const s = new Session(API, f);
    vi.mocked(f).mockImplementationOnce(async () =>
      json({ user: { id: 'u', name: 'n' }, tokens: { accessToken: 'P', refreshToken: 'PR', expiresIn: 900 } }),
    );
    await s.login('e@x', 'pw');
    await s.logout();
    expect(calls).toContain('/api/auth/logout');
  });

  it('renews through the file, so a second window does not spend the same refresh token', async () => {
    await savePair(API, { accessToken: 'A1', refreshToken: 'R1' });
    const { f, calls } = platform();
    const s = new Session(API, f);
    await s.adoptStored(readPairSync(API)!);
    await s.refresh();
    expect(s.token()).toBe('A2');
    expect(fileNow()[API].accessToken).toBe('A2');
    // Another window still holding A1 adopts A2 with no request.
    const other = new Session(API, f);
    await other.adoptStored({ accessToken: 'A1', refreshToken: 'R1' });
    const before = calls.filter((c) => c === '/api/auth/refresh').length;
    await other.refresh();
    expect(other.token()).toBe('A2');
    expect(calls.filter((c) => c === '/api/auth/refresh').length).toBe(before);
  });

  it('is adopted at boot from the file, and sb_connect reports the account', async () => {
    await savePair(API, { accessToken: 'A1', refreshToken: 'R1' });
    process.env.SB_API = API;
    process.env.SB_SITE = 's2';
    delete process.env.SB_TOKEN;
    const ctx = buildContext();
    expect(ctx.session.isStored()).toBe(true);
    const { f } = platform();
    ctx.fetchImpl = f;
    (ctx.session as unknown as { fetchImpl: typeof fetch }).fetchImpl = f;
    const out = await connect(ctx, {});
    expect(out.user).toBe('owner@shop.vn');
    expect(out.sites.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(out.site_name).toBe('Trà');
  });
});

describe('sb_login', () => {
  it('returns the code at once, then waits, stores the login and selects SB_SITE', async () => {
    const { f, calls } = platform({ pendingPolls: 1 });
    const ctx = ctxOf(f, { siteId: 's1' });
    const first = (await login(ctx, {}, '1.0.0')) as { status: string; code: string };
    expect(first.status).toBe('waiting');
    expect(first.code).toBe('ABCD-EFGH');
    expect(calls, 'polled before the person could see the code').not.toContain('/api/auth/device/token');
    const done = (await login(ctx, {}, '1.0.0')) as { status: string; site_name?: string; user: string };
    expect(done.status).toBe('signed_in');
    expect(done.user).toBe('owner@shop.vn');
    expect(done.site_name).toBe('Áo Thun');
    expect(fileNow()[API]).toEqual({ accessToken: 'A1', refreshToken: 'R1' });
    expect(calls.filter((c) => c === '/api/auth/device/start').length, 'a second start').toBe(1);
  });

  it('a denial stores nothing and the next call starts over', async () => {
    const { f, calls } = platform({ deny: true });
    const ctx = ctxOf(f);
    await login(ctx, {}, '1.0.0');
    await expect(login(ctx, {}, '1.0.0')).rejects.toThrow(/denied/);
    expect(readPairSync(API)).toBeUndefined();
    await login(ctx, {}, '1.0.0');
    expect(calls.filter((c) => c === '/api/auth/device/start').length).toBe(2);
  });

  it('logout signs the machine out', async () => {
    await savePair(API, { accessToken: 'A1', refreshToken: 'R1' });
    const { f } = platform();
    const ctx = ctxOf(f);
    await ctx.session.adoptStored(readPairSync(API)!);
    expect(((await login(ctx, { action: 'logout' }, '1')) as { status: string }).status).toBe('signed_out');
    expect(readPairSync(API)).toBeUndefined();
    expect(ctx.session.loggedIn()).toBe(false);
  });
});

describe('sb_site_use', () => {
  it('moves the account session between its sites', async () => {
    const { f } = platform();
    const ctx = ctxOf(f, { siteId: 's1' });
    await ctx.session.adoptStored({ accessToken: 'A1', refreshToken: 'R1' });
    await useSite(ctx, 's2');
    expect(ctx.siteId).toBe('s2');
    expect(ctx.siteName).toBe('Trà');
    await expect(useSite(ctx, 's9')).rejects.toThrow(/cannot operate s9.*s1 \(Áo Thun\)/);
    expect(ctx.siteId, 'a refused switch moved anyway').toBe('s2');
  });

  it('a key alone cannot leave its site, and can go back to it', async () => {
    const { f } = platform();
    const ctx = ctxOf(f, { apiKey: 'wbk_k', siteId: 's1', keySite: 's1' });
    await expect(useSite(ctx, 's2')).rejects.toThrow(/sb_login/);
    expect((await useSite(ctx, 's1')) as object).toMatchObject({ site: 's1' });
  });

  it('off the key\'s site, private calls use the account and /api/v1 refuses', async () => {
    const { f } = platform();
    const ctx = ctxOf(f, { apiKey: 'wbk_k', siteId: 's1', keySite: 's1' });
    await ctx.session.adoptStored({ accessToken: 'A1', refreshToken: 'R1' });
    expect(tokenFor(ctx, 'siteScoped'), 'on its own site the narrower key wins').toBe('wbk_k');
    expect(tokenFor(ctx, 'apiKey')).toBe('wbk_k');
    await useSite(ctx, 's2');
    expect(tokenFor(ctx, 'siteScoped')).toBe('A1');
    expect(() => tokenFor(ctx, 'apiKey')).toThrow(/key's own site \(s1\)/);
  });
});

describe('install --login', () => {
  it('signs in in the terminal and stores the login', async () => {
    const { f } = platform({ pendingPolls: 2 });
    const lines: string[] = [];
    const ok = await deviceLogin(API, { fetchImpl: f, sleep: async () => {}, open: () => false, log: (l) => lines.push(l) });
    expect(ok).toBe('A1');
    expect(lines.join('\n')).toContain('ABCD-EFGH');
    expect(readPairSync(API)).toEqual({ accessToken: 'A1', refreshToken: 'R1' });
  });

  it('reuses a login the machine already holds', async () => {
    await savePair(API, { accessToken: 'A1', refreshToken: 'R1' });
    const { f, calls } = platform();
    const lines: string[] = [];
    expect(await deviceLogin(API, { fetchImpl: f, log: (l) => lines.push(l) })).toBe('A1');
    expect(calls).not.toContain('/api/auth/device/start');
    expect(lines[0]).toMatch(/Already signed in: owner@shop.vn/);
  });

  it('writes no key and no password, only where and which site', () => {
    expect(buildEntry({ login: true, api: API, site: 's1', siteName: 'Áo Thun' }).env).toEqual({
      SB_API: API,
      SB_SITE: 's1',
      SB_SITE_NAME: 'Áo Thun',
    });
  });

  it('--login is a switch: the flag after it is still read', () => {
    const errs: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((l) => void errs.push(String(l)));
    expect(runInstallCli(['--login', '--api', API, '--site', 's1', '--dry-run'])).toBe(0);
    expect(errs.join('\n')).not.toMatch(/unknown option|nothing to install/);
    // …and it swallows nothing: a typo right after it is still refused.
    expect(runInstallCli(['--login', '--bogus', '--api', API, '--dry-run'])).toBe(1);
    expect(errs.join('\n')).toMatch(/unknown option\(s\) --bogus/);
    spy.mockRestore();
  });
});


const jwt = (exp: number) =>
  `h.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.s`;

describe('review fixes', () => {
  it('a key with no SB_SITE is never used once the session moved', async () => {
    const { f } = platform();
    const ctx = ctxOf(f, { apiKey: 'wbk_k', keySite: '' });
    await ctx.session.adoptStored({ accessToken: 'A1', refreshToken: 'R1' });
    expect(tokenFor(ctx, 'siteScoped'), 'before any switch the key is fine').toBe('wbk_k');
    await useSite(ctx, 's2');
    expect(tokenFor(ctx, 'siteScoped')).toBe('A1');
    expect(() => tokenFor(ctx, 'apiKey')).toThrow(/key's own site/);
    expect(keyServes(ctx, 's2'), 'the /api/v1 media retry would fire on s2').toBe(false);
  });

  it('off the key\'s site with the login gone: refused, never the key', async () => {
    const ctx = ctxOf(platform().f, { apiKey: 'wbk_k', siteId: 's2', keySite: 's1' });
    expect(() => tokenFor(ctx, 'siteScoped')).toThrow(/sb_login/);
    expect(tokenFor(ctx, 'siteScoped', 's1'), 'a call naming the key\'s site still uses it').toBe('wbk_k');
  });

  it('a 401 on a real request renews through the file and retries', async () => {
    // Unique tokens: 401 renewers are process-global, and another test's session holding A1 would answer.
    await savePair(API, { accessToken: 'Q1', refreshToken: 'QR1' });
    const seen: string[] = [];
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/auth/refresh') return json({ tokens: { accessToken: 'Q2', refreshToken: 'QR2' } });
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      seen.push(auth);
      return auth === 'Bearer Q2' ? json({ ok: true }) : json({ error: 'expired' }, 401);
    }) as unknown as typeof fetch;
    const s = new Session(API, f);
    await s.adoptStored(readPairSync(API)!);
    const out = await request({ base: API, method: 'GET', path: '/api/sites', token: s.token(), fetchImpl: f });
    expect(out).toEqual({ ok: true });
    expect(seen).toEqual(['Bearer Q1', 'Bearer Q2']);
    expect(fileNow()[API].accessToken).toBe('Q2');
    await s.forgetStored().catch(() => undefined);
  });

  it('a dead stored login clears the token instead of replaying it', async () => {
    await savePair(API, { accessToken: 'A1', refreshToken: 'R1' });
    const f = vi.fn(async () => json({ error: 'gone' }, 401)) as unknown as typeof fetch;
    const s = new Session(API, f);
    await s.adoptStored(readPairSync(API)!);
    await expect(s.refresh()).rejects.toThrow(RELOGIN);
    expect(s.loggedIn()).toBe(false);
  });

  it('reads the expiry out of the token so uploads renew ahead of it', async () => {
    const soon = Math.floor(Date.now() / 1000) + 10;
    expect(jwtExpiry(jwt(soon))).toBe(soon * 1000);
    expect(jwtExpiry('not-a-jwt')).toBe(0);
    await savePair(API, { accessToken: jwt(soon), refreshToken: 'R1' });
    const { f, calls } = platform();
    const s = new Session(API, f);
    await s.adoptStored(readPairSync(API)!);
    await s.ensureFresh();
    expect(calls, 'a token 10s from expiry was not renewed').toContain('/api/auth/refresh');
  });

  it('logout revokes the pair the FILE holds, even when sb login replaced ours', async () => {
    await savePair(API, { accessToken: 'A1', refreshToken: 'R1' });
    const revoked: string[] = [];
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith('/api/auth/logout')) revoked.push(JSON.parse(String(init!.body)).refreshToken);
      return json({});
    }) as unknown as typeof fetch;
    const s = new Session(API, f);
    await s.adoptStored(readPairSync(API)!);
    await savePair(API, { accessToken: 'B1', refreshToken: 'RB' });
    await s.forgetStored();
    expect(revoked.sort()).toEqual(['R1', 'RB']);
    expect(readPairSync(API)).toBeUndefined();
  });

  it('sb_login adopts a login the machine already holds — no new device slot', async () => {
    await savePair(API, { accessToken: 'A1', refreshToken: 'R1' });
    const { f, calls } = platform();
    const out = (await login(ctxOf(f), {}, '1')) as { status: string };
    expect(out.status).toBe('signed_in');
    expect(calls).not.toContain('/api/auth/device/start');
  });

  it('an outage while checking the login is reported, not answered with a new login', async () => {
    await savePair(API, { accessToken: 'A1', refreshToken: 'R1' });
    const f = vi.fn(async (url: unknown) =>
      String(url).includes('/device/') ? json({}) : json({ error: 'down' }, 503),
    ) as unknown as typeof fetch;
    await expect(login(ctxOf(f), {}, '1')).rejects.toThrow();
    expect(vi.mocked(f).mock.calls.some((c) => String(c[0]).includes('/device/start'))).toBe(false);
  });

  it('two first calls racing share one code', async () => {
    const { f, calls } = platform({ pendingPolls: 99 });
    const ctx = ctxOf(f);
    const [a, b] = (await Promise.all([login(ctx, {}, '1'), login(ctx, {}, '1')])) as { code: string }[];
    expect(a.code).toBe(b.code);
    expect(calls.filter((c) => c === '/api/auth/device/start').length).toBe(1);
  });

  it('opens only a web page', () => {
    delete process.env.SB_NO_BROWSER;
    expect(openBrowser('javascript:alert(1)')).toBe(false);
    expect(openBrowser('file:///etc/passwd')).toBe(false);
    expect(openBrowser('not a url')).toBe(false);
  });

  it('a password in the environment still wins over the stored login at boot', async () => {
    await savePair(API, { accessToken: 'A1', refreshToken: 'R1' });
    process.env.SB_API = API;
    process.env.SB_EMAIL = 'e@x';
    process.env.SB_PASSWORD = 'pw';
    expect(buildContext().session.isStored()).toBe(false);
  });

  it('--login never writes a password, even one in the environment', () => {
    expect(buildEntry({ login: true, api: API, email: 'e@x', password: 'pw' }).env).toEqual({ SB_API: API });
  });
});

describe('the guided install — one command, no flags to understand', () => {
  // Passed as deps.home, never via process.env.HOME: a vitest worker's env is a
  // copy os.homedir() does not read, and the install lands in the REAL home.
  const home = () => join(dir, 'home');
  const claudeEnv = (h: string) =>
    JSON.parse(readFileSync(join(h, '.claude.json'), 'utf8')).mcpServers.sbuilder.env;

  it('signs in, lets the person pick a store by number, installs, and says what next — in Vietnamese', async () => {
    const h = home();
    const { f } = platform({ pendingPolls: 1 });
    const lines: string[] = [];
    const asked: string[] = [];
    const code = await runInstall(['--api', API, '--client', 'claude-code'], { home: home(),
      fetchImpl: f, sleep: async () => {}, open: () => true, log: (l) => lines.push(l), lang: 'vi',
      ask: async (q) => (asked.push(q), '2'),
    });
    const out = lines.join('\n');
    expect(code, out).toBe(0);
    expect(out).toMatch(/Bước 1\/3[\s\S]*ABCD-EFGH[\s\S]*Bước 2\/3[\s\S]*1\. Áo Thun[\s\S]*2\. Trà[\s\S]*Bước 3\/3/);
    expect(asked[0]).toMatch(/1–2/);
    expect(out).toMatch(/Xong!.*\n.*cửa hàng Trà/);
    expect(claudeEnv(h)).toEqual({ SB_API: API, SB_SITE: 's2', SB_SITE_NAME: 'Trà' });
    // A stale npx cache would start a pre-login server that never sees the login.
    expect(JSON.parse(readFileSync(join(h, '.claude.json'), 'utf8')).mcpServers.sbuilder.args).toEqual(['-y', 'sbuilder-mcp@latest']);
  });

  it('defaults to the production platform — no --api to know about', async () => {
    home();
    const hosts: string[] = [];
    const f = vi.fn(async (url: unknown) => {
      hosts.push(new URL(String(url)).origin);
      return json({ error: 'stop', code: 'device_login_unavailable' }, 503);
    }) as unknown as typeof fetch;
    await runInstall(['--client', 'claude-code'], { home: home(), fetchImpl: f, log: () => {}, lang: 'en', ask: undefined });
    expect(hosts[0]).toBe(PROD_API);
  });

  it('a store named by the screen is used without asking; its name is filled in', async () => {
    const h = home();
    await savePair(API, { accessToken: 'A1', refreshToken: 'R1' });
    const { f } = platform();
    const ask = vi.fn(async () => '1');
    expect(await runInstall(['--api', API, '--site', 's2', '--client', 'claude-code'], { home: home(), fetchImpl: f, log: () => {}, lang: 'en', ask })).toBe(0);
    expect(ask).not.toHaveBeenCalled();
    expect(claudeEnv(h)).toEqual({ SB_API: API, SB_SITE: 's2', SB_SITE_NAME: 'Trà' });
  });

  it('no terminal to ask in: installs without a store rather than hanging', async () => {
    const h = home();
    await savePair(API, { accessToken: 'A1', refreshToken: 'R1' });
    const { f } = platform();
    const lines: string[] = [];
    expect(await runInstall(['--api', API, '--client', 'claude-code'], { home: home(), fetchImpl: f, log: (l) => lines.push(l), lang: 'en', ask: undefined })).toBe(0);
    expect(lines.join('\n')).toMatch(/Skipped/);
    expect(claudeEnv(h)).toEqual({ SB_API: API });
  });

  it('a denial installs nothing', async () => {
    const h = home();
    const { f } = platform({ deny: true });
    expect(await runInstall(['--api', API, '--client', 'claude-code'], { home: home(), fetchImpl: f, sleep: async () => {}, open: () => false, log: () => {}, lang: 'en', ask: undefined })).toBe(1);
    expect(() => readFileSync(join(h, '.claude.json'))).toThrow();
  });

  it('a key still installs the old way, with no browser', async () => {
    const h = home();
    const { f, calls } = platform();
    expect(await runInstall(['--token', 'wbk_k', '--api', API, '--site', 's1', '--client', 'claude-code'], { home: home(), fetchImpl: f, log: () => {}, lang: 'en', ask: undefined })).toBe(0);
    expect(calls).toEqual([]);
    expect(claudeEnv(h)).toEqual({ SB_API: API, SB_TOKEN: 'wbk_k', SB_SITE: 's1' });
  });

  it('speaks Vietnamese when told to, or when the machine is Vietnamese', () => {
    expect(pickLang('vi')).toBe('vi');
    expect(pickLang(undefined, { LANG: 'vi_VN.UTF-8' })).toBe('vi');
    expect(pickLang(undefined, { LANG: 'en_US.UTF-8' })).toBe('en');
  });
});
