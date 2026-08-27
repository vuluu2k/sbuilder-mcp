import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { API_OPERATIONS } from '../catalog/api.generated.js';
import { searchOperations, describeOperation } from '../catalog/search.js';
import { request, redact } from '../transport/http.js';
import { text } from '../mcp/response.js';
import type { ToolContext } from './context.js';

export interface CallArgs {
  id: string;
  path_params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  dry_run?: boolean;
}

/**
 * Pick the credential a path needs.
 *
 * `siteScoped` PREFERS the API key. Both open the private surface, and the key
 * is the narrower of the two: revocable on its own, bounded by its scopes
 * intersected with its minter's live role, and bound to one store — while a
 * session carries the whole account. Preferring it is also what lets a merchant
 * connect an agent with one env var and no password.
 */
export function tokenFor(ctx: ToolContext, credential: string): string | undefined {
  if (credential === 'apiKey') {
    // Naming the env var matters: the alternative is a 401 api_key_required
    // from the platform, which reads like a permissions problem rather than an
    // unset variable.
    if (!ctx.apiKey) {
      throw new Error('sbuilder: SB_TOKEN is not set — /api/v1 operations need an API key');
    }
    return ctx.apiKey;
  }
  if (credential === 'siteScoped') {
    if (ctx.apiKey) return ctx.apiKey;
    if (ctx.session.loggedIn()) return ctx.session.token();
    throw new Error(
      'sbuilder: no credential for this site. Set SB_TOKEN to an API key from the site\'s ' +
        'Agent app, or call sb_connect with SB_EMAIL and SB_PASSWORD.',
    );
  }
  return undefined;
}

export async function callOperation(ctx: ToolContext, args: CallArgs): Promise<unknown> {
  const op = API_OPERATIONS.find((o) => o.id === args.id);
  if (!op) throw new Error(`sbuilder: unknown operation "${args.id}" — use sb_api_find first`);

  // Substitute {name} placeholders. A missing one would otherwise be sent
  // literally, and a path containing a brace 404s with nothing to explain it.
  let path = op.path;
  for (const m of op.path.matchAll(/\{([^}]+)\}/g)) {
    const name = m[1];
    const value = args.path_params?.[name];
    if (value === undefined) {
      throw new Error(`sbuilder: operation ${op.id} needs path param "${name}"`);
    }
    path = path.replace(`{${name}}`, encodeURIComponent(value));
  }

  const token = tokenFor(ctx, op.credential);
  const dryRun = args.dry_run !== false;
  if (dryRun) {
    return {
      dry_run: true,
      would_send: redact({
        method: op.method,
        url: ctx.base.replace(/\/$/, '') + path,
        query: args.query,
        Authorization: token ? `Bearer ${token}` : undefined,
        body: args.body,
      }),
      note: 'Nothing was sent. Re-call with dry_run:false to execute.',
    };
  }

  return request({
    base: ctx.base,
    method: op.method,
    path,
    token,
    query: args.query,
    body: args.body,
    fetchImpl: ctx.fetchImpl,
  });
}

export function registerApiTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'sb_api_find',
    'Find platform API operations by intent. Returns each match with its real parameter ' +
      'schema, which credential it needs, and an explicit note when the document fails to ' +
      'describe the request body. Use this before sb_api_call: the tool list is short, but ' +
      'this index reaches all 310 operations.',
    {
      query: z
        .string()
        .describe('What you want to do, in words: "create a menu", "list orders", "upload media"'),
      tag: z.string().optional().describe('Narrow to one tag, e.g. "menus", "products", "theme"'),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async ({ query, tag, limit }) =>
      text(searchOperations(query, { tag, limit }).map(describeOperation)),
  );

  server.tool(
    'sb_api_call',
    'Execute one operation found by sb_api_find. Defaults to a dry run that sends nothing ' +
      'and shows the request it would have made.',
    {
      id: z
        .string()
        .describe('Operation id from sb_api_find, e.g. "get:/api/sites/{siteID}/menus"'),
      path_params: z.record(z.string()).optional(),
      query: z.record(z.string()).optional(),
      body: z.unknown().optional(),
      dry_run: z.boolean().optional().describe('Defaults to true. Pass false to actually send.'),
    },
    async (args) => text(await callOperation(ctx, args as CallArgs)),
  );
}
