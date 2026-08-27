import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { request } from '../transport/http.js';
import { text } from '../mcp/response.js';
import { API_OPERATIONS } from '../catalog/api.generated.js';
import type { ToolContext } from './context.js';

export interface ConnectResult {
  user: string;
  sites: Array<{ id: string; name: string }>;
  api_key: 'present' | 'missing';
  operations: number;
  note?: string;
}

/**
 * Log in and report what this server can actually reach.
 *
 * A missing API key is REPORTED, not thrown. The session half of the surface —
 * pages, menus, theme, overlays, forms, settings — works without one, and
 * failing the whole connect over it would hide that from a caller who does not
 * need /api/v1 at all.
 */
export async function connect(
  ctx: ToolContext,
  args: { email?: string; password?: string },
): Promise<ConnectResult> {
  const email = args.email ?? process.env.SB_EMAIL;
  const password = args.password ?? process.env.SB_PASSWORD;

  // KEY-ONLY MODE. An API key from the site's Agent app opens both surfaces on
  // its own, which is the whole point of the connect button: one env var, no
  // password anywhere. There is no login to do and no site list to fetch — a key
  // belongs to exactly one store, and `GET /api/sites` means "this human's
  // account", which a key deliberately cannot answer.
  if (ctx.apiKey && (!email || !password)) {
    return {
      user: 'api key',
      sites: [],
      api_key: 'present',
      operations: API_OPERATIONS.length,
      note:
        'Connected with an API key alone. It is bound to one site, so there is no site list — ' +
        'pass that site id to sb_page_open. Set SB_EMAIL and SB_PASSWORD as well if you want ' +
        'account-level calls (listing sites, members, roles), which a key cannot make.',
    };
  }

  if (!email || !password) {
    throw new Error(
      'sbuilder: set SB_TOKEN to an API key from the site\'s Agent app, or set SB_EMAIL and ' +
        'SB_PASSWORD for a full account session.',
    );
  }
  await ctx.session.login(email, password);

  const listed = (await request({
    base: ctx.base,
    method: 'GET',
    path: '/api/sites',
    token: ctx.session.token(),
    fetchImpl: ctx.fetchImpl,
  })) as { sites?: Array<{ id: string; name: string }> };

  const result: ConnectResult = {
    user: ctx.session.userName,
    // The key is absent when the account owns no sites; a nil slice would have
    // marshalled to null, which is why the platform's own list contract exists.
    sites: (listed?.sites ?? []).map((s) => ({ id: s.id, name: s.name })),
    api_key: ctx.apiKey ? 'present' : 'missing',
    operations: API_OPERATIONS.length,
  };
  if (!ctx.apiKey) {
    result.note =
      'SB_TOKEN is not set, so /api/v1 operations (products, orders, customers, media, blog, ' +
      'webhooks) will be refused with api_key_required. The private site API is unaffected.';
  }
  return result;
}

export function registerSessionTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'sb_connect',
    'Log in and list the sites this account can operate. Call this first. Reads SB_EMAIL and ' +
      'SB_PASSWORD from the environment unless you pass them.',
    {
      email: z.string().optional(),
      password: z.string().optional(),
    },
    async (args) => text(await connect(ctx, args)),
  );

  server.tool(
    'sb_site_list',
    'List the sites this account can operate.',
    {},
    async () =>
      text(
        await request({
          base: ctx.base,
          method: 'GET',
          path: '/api/sites',
          token: ctx.session.token(),
          fetchImpl: ctx.fetchImpl,
        }),
      ),
  );
}
