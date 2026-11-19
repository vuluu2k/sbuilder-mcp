import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { request } from '../transport/http.js';
import { text } from '../mcp/response.js';
import { openBrowser, pollDevice, startDevice, type DeviceStart } from '../transport/device.js';
import { readPairSync, RELOGIN, savePair } from '../transport/stored.js';
import type { ToolContext } from './context.js';

/**
 * THE ACCOUNT LOGIN, IN THE BROWSER — no password in any config file.
 *
 * `sb_login` opens the editor's /device page; the person types the code it
 * returns and approves. The session lands in the machine's shared login file
 * (the one `sb login` writes), so every MCP window and the CLI are signed in
 * together and stay so across restarts. With it the agent reaches the whole
 * account — every site the person can operate — and `sb_site_use` moves it
 * between them.
 */

export interface AccountSummary {
  status: 'signed_in';
  user: string;
  sites: Array<{ id: string; name: string }>;
  /** The site every tool defaults to now. */
  site?: string;
  site_name?: string;
  note: string;
}

interface Pending {
  start: DeviceStart;
  deadline: number;
  interval: number;
}

/** One login in flight per process; a second sb_login keeps waiting on it. The
 *  PROMISE is kept, so two calls racing the first start share one code. */
const pending = new WeakMap<ToolContext, Promise<Pending>>();

/** How long one sb_login call waits for the approval before handing back. */
export const WAIT = { ms: 45_000 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function listSites(ctx: ToolContext): Promise<Array<{ id: string; name: string }>> {
  const out = (await request({
    base: ctx.base,
    method: 'GET',
    path: '/api/sites',
    token: ctx.session.token(),
    fetchImpl: ctx.fetchImpl,
  })) as { sites?: Array<{ id: string; name: string }> };
  return (out?.sites ?? []).map((s) => ({ id: s.id, name: s.name }));
}

/** Who the stored login is, and where the agent stands. */
export async function accountSummary(ctx: ToolContext): Promise<AccountSummary> {
  if (!ctx.session.userName) {
    const me = (await request({
      base: ctx.base,
      method: 'GET',
      path: '/api/auth/me',
      token: ctx.session.token(),
      fetchImpl: ctx.fetchImpl,
    }).catch(() => null)) as { user?: { email?: string; name?: string } } | null;
    ctx.session.userName = me?.user?.email || me?.user?.name || '';
  }
  const sites = await listSites(ctx);
  const here = ctx.siteId ? sites.find((s) => s.id === ctx.siteId) : undefined;
  if (here) ctx.siteName = here.name;
  return {
    status: 'signed_in',
    user: ctx.session.userName,
    sites,
    ...(ctx.siteId ? { site: ctx.siteId } : {}),
    ...(here ? { site_name: here.name } : {}),
    note: ctx.siteId
      ? here
        ? `Working on ${JSON.stringify(here.name)} (${ctx.siteId}); every tool defaults to it. ` +
          'sb_site_use moves to another site in this list.'
        : `SB_SITE is ${ctx.siteId}, which this account cannot operate — pick one with sb_site_use.`
      : 'No site selected: pass site_id per call, or pick one with sb_site_use.',
  };
}

export async function login(
  ctx: ToolContext,
  args: { action?: 'start' | 'logout' },
  version: string,
): Promise<unknown> {
  const f = ctx.fetchImpl ?? fetch;
  if (args.action === 'logout') {
    pending.delete(ctx);
    await ctx.session.forgetStored();
    return {
      status: 'signed_out',
      note: 'The account login is revoked and removed from this machine (the sb CLI shares it).',
    };
  }
  // A login the machine already holds (sb login, another window) is adopted —
  // a fresh browser flow would take another of the account's device slots.
  if (!ctx.session.isStored()) {
    const filed = readPairSync(ctx.base);
    if (filed) await ctx.session.adoptStored(filed);
  }
  if (ctx.session.isStored()) {
    try {
      return await accountSummary(ctx);
    } catch (err) {
      // Only a dead login starts a new one; an outage is reported as such.
      if ((err as Error).message !== RELOGIN && ctx.session.loggedIn()) throw err;
    }
  }

  let started = pending.get(ctx);
  let p = started ? await started.catch(() => undefined) : undefined;
  if (!p || Date.now() > p.deadline) {
    started = startDevice(ctx.base, version, f).then((start) => ({
      start,
      deadline: Date.now() + start.expiresIn * 1000,
      interval: start.interval * 1000,
    }));
    pending.set(ctx, started);
    started.catch(() => pending.delete(ctx));
    p = await started;
    const { start } = p;
    const opened = openBrowser(start.verificationUri);
    // RETURN THE CODE NOW. The person needs it to type into the page; waiting
    // for the approval first would hide the one thing they must read.
    return {
      status: 'waiting',
      url: start.verificationUri,
      code: start.userCode,
      browser_opened: opened,
      expires_in_minutes: Math.round(start.expiresIn / 60),
      note:
        `Tell the person: ${opened ? 'a browser page has opened' : `open ${start.verificationUri}`}, ` +
        `type the code ${start.userCode}, check it matches, and press Approve. Then call sb_login ` +
        'again — it waits for the approval.',
    };
  }

  const until = Date.now() + WAIT.ms;
  while (Date.now() < until && Date.now() < p.deadline) {
    await sleep(p.interval);
    const r = await pollDevice(ctx.base, p.start.deviceCode, f);
    if (r.state === 'approved') {
      pending.delete(ctx);
      await savePair(ctx.base, r.pair);
      await ctx.session.adoptStored(r.pair);
      ctx.session.userName = '';
      return await accountSummary(ctx);
    }
    if (r.state === 'slow') p.interval += 5000;
    if (r.state === 'denied') {
      pending.delete(ctx);
      throw new Error('sbuilder: the login was denied in the browser. Nothing was stored.');
    }
    if (r.state === 'expired') {
      pending.delete(ctx);
      throw new Error('sbuilder: the code expired before it was approved. Call sb_login for a new one.');
    }
  }
  return {
    status: 'waiting',
    url: p.start.verificationUri,
    code: p.start.userCode,
    note: `Not approved yet. The code is ${p.start.userCode}; call sb_login again once it is approved.`,
  };
}

/** Move the agent to another site of the account. */
export async function useSite(ctx: ToolContext, siteId: string): Promise<unknown> {
  if (!ctx.session.loggedIn()) {
    if (ctx.apiKey && siteId === ctx.keySite) {
      ctx.siteId = siteId;
      return { site: siteId, note: 'Back on the API key\'s own site.' };
    }
    throw new Error(
      'sbuilder: an API key opens one site only. Call sb_login (approve in the browser) to reach ' +
        'every site of the account, then sb_site_use again.',
    );
  }
  const sites = await listSites(ctx);
  const site = sites.find((s) => s.id === siteId);
  if (!site) {
    throw new Error(
      `sbuilder: this account cannot operate ${siteId}. Its sites: ` +
        (sites.map((s) => `${s.id} (${s.name})`).join(', ') || 'none'),
    );
  }
  ctx.siteId = site.id;
  ctx.siteName = site.name;
  return {
    site: site.id,
    site_name: site.name,
    note:
      `Working on ${JSON.stringify(site.name)} now; every tool defaults to it. A page opened on ` +
      'the previous site stays open until sb_page_open opens one here.',
  };
}

export function registerLoginTools(server: McpServer, ctx: ToolContext, version: string): void {
  server.registerTool(
    'sb_login',
    {
      description:
        'Sign in to the whole account in the browser, no password. The first call returns a code ' +
        'to type on the page it opens; call again to wait for the approval. Remembered on this ' +
        'machine. action:"logout" signs out.',
      inputSchema: { action: z.enum(['start', 'logout']).optional() },
      annotations: { openWorldHint: true },
    },
    async (args) => text(await login(ctx, args, version)),
  );
  server.registerTool(
    'sb_site_use',
    {
      description:
        'Switch the site every tool defaults to (needs the sb_login account login).',
      inputSchema: { site_id: z.string() },
      // NOT read-only: it moves where every later write lands, so a client that
      // auto-approves read-only tools must still ask before it.
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ site_id }) => text(await useSite(ctx, site_id)),
  );
}
