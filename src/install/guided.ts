import { createInterface } from 'node:readline/promises';
import { openBrowser, pollDevice, startDevice } from '../transport/device.js';
import { readPairSync, rotate, savePair } from '../transport/stored.js';
import { install, parseInstallArgs, type InstallOpts, type InstallResult } from './index.js';

/**
 * `npx -y sbuilder-mcp@latest install` — the whole setup, for a person who
 * does not know what an MCP server, an API key or an env var is.
 *
 * ONE command, no flags required: it signs in through the browser (type the
 * code, Approve), lets them pick the store by number, writes every agent client
 * on the machine, and ends by saying what to do next. Flags still exist for the
 * screen that hands out the command (`--api`, `--site`) and for scripts
 * (`--token`, `--client`, `--dry-run`), but nobody has to type one.
 */

/** Where a real merchant's store lives. Local dev passes --api. */
export const PROD_API = 'https://api.sbuilder.io.vn';

export interface LoginDeps {
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  open?: (url: string) => boolean;
  version?: string;
  /** Answers the site question; undefined = not a terminal, skip it. */
  ask?: (question: string) => Promise<string>;
  lang?: Lang;
  /** The home directory to write client configs into. Tests MUST set it: in a
   *  vitest worker, process.env.HOME is a copy os.homedir() never reads. */
  home?: string;
}

type Lang = 'vi' | 'en';

/** --lang, else the environment's locale; English when nothing says Vietnamese. */
export function pickLang(flag?: string, env: NodeJS.ProcessEnv = process.env): Lang {
  const hint = flag ?? env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG ?? Intl.DateTimeFormat().resolvedOptions().locale;
  return /^vi/i.test(hint ?? '') ? 'vi' : 'en';
}

const M = {
  vi: {
    title: 'Kết nối Store Builder với agent AI trên máy này',
    step: (n: number, what: string) => `\nBước ${n}/3 — ${what}`,
    signIn: 'Đăng nhập',
    pick: 'Chọn cửa hàng',
    write: 'Cài vào agent',
    already: (who: string) => `  ✔ Đã đăng nhập sẵn: ${who}`,
    opened: (url: string) => `  Trang đăng nhập đã mở trong trình duyệt: ${url}`,
    open: (url: string) => `  Mở trang này trong trình duyệt: ${url}`,
    type: (code: string) => `  Gõ mã:  ${code}`,
    approve: (min: number) => `  Thấy mã trùng khớp thì bấm "Chấp thuận". Mã hết hạn sau ${min} phút.`,
    waiting: '  Đang chờ bạn chấp thuận…',
    signedIn: (who: string) => `  ✔ Đã đăng nhập: ${who}`,
    denied: '  ✖ Bạn đã từ chối trên trình duyệt. Chưa cài gì cả.',
    expired: '  ✖ Mã đã hết hạn. Chạy lại lệnh để lấy mã mới.',
    noSites: '  Tài khoản chưa có cửa hàng nào — agent vẫn tạo được cửa hàng mới.',
    oneSite: (name: string) => `  ✔ Cửa hàng: ${name}`,
    choose: (n: number) => `  Gõ số cửa hàng agent sẽ làm việc (1–${n}), Enter để bỏ qua: `,
    skipped: '  · Bỏ qua — agent sẽ hỏi cửa hàng khi cần, hoặc bạn bảo nó "chuyển sang cửa hàng …".',
    given: (name: string) => `  ✔ Cửa hàng: ${name}`,
    installed: (c: string) => `  ✔ ${c}`,
    unchanged: (c: string) => `  · ${c} (đã cài sẵn)`,
    preview: (c: string) => `  → ${c} (thử, chưa ghi)`,
    failed: (c: string, why: string) => `  ✖ ${c}: ${why}`,
    backup: (f: string) => `      bản cũ lưu ở ${f}`,
    noClient: '  ✖ Không tìm thấy Claude Code, Claude Desktop, Cursor, Windsurf, VS Code hay Codex trên máy này. Cài một cái rồi chạy lại.',
    done: (site?: string) =>
      `\nXong! Mở lại (khởi động lại) agent của bạn, rồi thử nói:\n  "${site ? `Liệt kê các trang của cửa hàng ${site}` : 'Liệt kê các cửa hàng của tôi'}"\n` +
      'Đăng xuất máy này: bảo agent "đăng xuất sbuilder".',
  },
  en: {
    title: 'Connect Store Builder to the AI agents on this machine',
    step: (n: number, what: string) => `\nStep ${n}/3 — ${what}`,
    signIn: 'Sign in',
    pick: 'Choose a store',
    write: 'Install into your agents',
    already: (who: string) => `  ✔ Already signed in: ${who}`,
    opened: (url: string) => `  The sign-in page is open in your browser: ${url}`,
    open: (url: string) => `  Open this page in your browser: ${url}`,
    type: (code: string) => `  Type the code:  ${code}`,
    approve: (min: number) => `  When the code matches, press "Approve". It expires in ${min} minutes.`,
    waiting: '  Waiting for your approval…',
    signedIn: (who: string) => `  ✔ Signed in: ${who}`,
    denied: '  ✖ You denied it in the browser. Nothing was installed.',
    expired: '  ✖ The code expired. Run the command again for a new one.',
    noSites: '  This account has no store yet — the agent can still create one.',
    oneSite: (name: string) => `  ✔ Store: ${name}`,
    choose: (n: number) => `  Type the number of the store the agent works on (1–${n}), Enter to skip: `,
    skipped: '  · Skipped — the agent asks when it needs one, or tell it "switch to store …".',
    given: (name: string) => `  ✔ Store: ${name}`,
    installed: (c: string) => `  ✔ ${c}`,
    unchanged: (c: string) => `  · ${c} (already set up)`,
    preview: (c: string) => `  → ${c} (dry run, nothing written)`,
    failed: (c: string, why: string) => `  ✖ ${c}: ${why}`,
    backup: (f: string) => `      previous file saved as ${f}`,
    noClient: '  ✖ No Claude Code, Claude Desktop, Cursor, Windsurf, VS Code or Codex found on this machine. Install one and run this again.',
    done: (site?: string) =>
      `\nDone! Restart your agent, then try saying:\n  "${site ? `List the pages of the ${site} store` : 'List my stores'}"\n` +
      'To sign this machine out: tell the agent "sign out of sbuilder".',
  },
};

const trim = (api: string) => api.replace(/\/+$/, '');

async function getJson<T>(api: string, path: string, token: string, f: typeof fetch): Promise<{ status: number; data?: T }> {
  const res = await f(`${trim(api)}${path}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res) return { status: 0 };
  return { status: res.status, data: res.ok ? ((await res.json().catch(() => undefined)) as T) : undefined };
}

/** The stored login's token and email when it still works (renewing it once if refused). */
async function storedLogin(api: string, f: typeof fetch): Promise<{ token: string; who: string } | undefined> {
  let pair = readPairSync(api);
  for (let attempt = 0; pair && attempt < 2; attempt++) {
    const me = await getJson<{ user?: { email?: string } }>(api, '/api/auth/me', pair.accessToken, f);
    if (me.status === 200) return { token: pair.accessToken, who: me.data?.user?.email || '' };
    if (me.status !== 401) return undefined;
    pair = await rotate(api, pair.accessToken, f).catch(() => undefined);
  }
  return undefined;
}

/**
 * The browser sign-in, in this terminal. Reuses a login the machine already
 * holds (`sb login`, an agent's sb_login). Returns the token, or undefined when
 * the person denied it or let the code expire.
 */
export async function deviceLogin(api: string, deps: LoginDeps = {}): Promise<string | undefined> {
  const t = M[deps.lang ?? 'en'];
  const log = deps.log ?? ((l: string) => console.error(l));
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const f = deps.fetchImpl ?? fetch;
  const held = await storedLogin(api, f);
  if (held) {
    log(t.already(held.who || api));
    return held.token;
  }
  const s = await startDevice(api, deps.version ?? '0.0.0', f);
  log((deps.open ?? openBrowser)(s.verificationUri) ? t.opened(s.verificationUri) : t.open(s.verificationUri));
  log(t.type(s.userCode));
  log(t.approve(Math.round(s.expiresIn / 60)));
  log(t.waiting);
  let interval = s.interval * 1000;
  const deadline = Date.now() + s.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    // A dropped connection is not a refusal; anything else the server says is.
    const r = await pollDevice(api, s.deviceCode, f).catch((err: unknown) => {
      if (err instanceof TypeError) return { state: 'pending' as const };
      throw err;
    });
    if (r.state === 'approved') {
      await savePair(api, r.pair);
      const me = await getJson<{ user?: { email?: string } }>(api, '/api/auth/me', r.pair.accessToken, f);
      log(t.signedIn(me.data?.user?.email || api));
      return r.pair.accessToken;
    }
    if (r.state === 'slow') interval += 5000;
    if (r.state === 'denied') {
      log(t.denied);
      return undefined;
    }
    if (r.state === 'expired') break;
  }
  log(t.expired);
  return undefined;
}

/** Pick the store: the one named, the only one, or the person's choice by number. */
async function chooseSite(
  api: string,
  token: string,
  opts: InstallOpts,
  deps: LoginDeps,
  log: (l: string) => void,
): Promise<void> {
  const t = M[deps.lang ?? 'en'];
  const listed = await getJson<{ sites?: Array<{ id: string; name: string }> }>(api, '/api/sites', token, deps.fetchImpl ?? fetch);
  const sites = listed.data?.sites ?? [];
  if (opts.site) {
    const named = sites.find((s) => s.id === opts.site);
    if (named && !opts.siteName) opts.siteName = named.name;
    log(t.given(opts.siteName ?? opts.site));
    return;
  }
  if (!sites.length) return log(t.noSites);
  if (sites.length === 1) {
    opts.site = sites[0].id;
    opts.siteName = sites[0].name;
    return log(t.oneSite(sites[0].name));
  }
  if (!deps.ask) return log(t.skipped);
  sites.forEach((s, i) => log(`  ${String(i + 1).padStart(2)}. ${s.name}`));
  const answer = (await deps.ask(t.choose(sites.length))).trim();
  const picked = sites[Number(answer) - 1];
  if (!answer || !picked) return log(t.skipped);
  opts.site = picked.id;
  opts.siteName = picked.name;
  log(t.given(picked.name));
}

function report(results: InstallResult[], opts: InstallOpts, lang: Lang, log: (l: string) => void): number {
  const t = M[lang];
  if (!results.length) {
    log(t.noClient);
    return 1;
  }
  for (const r of results) {
    if (opts.dryRun) log(t.preview(r.client));
    else if (r.status === 'installed') log(t.installed(r.client));
    else if (r.status === 'unchanged') log(t.unchanged(r.client));
    else log(t.failed(r.client, r.reason ?? ''));
    if (r.backup) log(t.backup(r.backup));
  }
  return opts.dryRun || results.some((r) => r.status !== 'skipped') ? 0 : 1;
}

/** Interactive question on the terminal, or undefined when there is none. */
function terminalAsk(): LoginDeps['ask'] {
  if (!process.stdin.isTTY) return undefined;
  return async (q) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      return await rl.question(q);
    } finally {
      rl.close();
    }
  };
}

/**
 * The CLI entry. With a key (--token) or a password it installs that, as
 * before. Otherwise — the default — it signs in through the browser.
 */
export async function runInstall(argv: string[], deps: LoginDeps = {}): Promise<number> {
  const log = deps.log ?? ((l: string) => console.error(l));
  const parsed = parseInstallArgs(argv);
  if ('error' in parsed) {
    log(parsed.error);
    return 1;
  }
  const lang = deps.lang ?? pickLang(parsed.lang);
  const t = M[lang];
  const opts: InstallOpts = { ...parsed.opts, api: parsed.opts.api ?? PROD_API, home: deps.home };
  const viaLogin = !opts.token && !(opts.email && opts.password);
  opts.login = viaLogin;
  const d: LoginDeps = { ...deps, lang, log, ask: 'ask' in deps ? deps.ask : terminalAsk() };

  log(t.title);
  if (viaLogin && !opts.dryRun) {
    log(t.step(1, t.signIn));
    let token: string | undefined;
    try {
      token = await deviceLogin(opts.api!, d);
    } catch (err) {
      log(`  ✖ ${(err as Error).message}`);
      return 1;
    }
    if (!token) return 1;
    log(t.step(2, t.pick));
    await chooseSite(opts.api!, token, opts, d, log);
  }
  log(t.step(3, t.write));
  let results: InstallResult[];
  try {
    results = install(opts);
  } catch (err) {
    log(`  ✖ ${(err as Error).message}`);
    return 1;
  }
  const code = report(results, opts, lang, log);
  if (code === 0 && !opts.dryRun) log(t.done(opts.siteName));
  return code;
}
