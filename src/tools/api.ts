import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { API_OPERATIONS, SWAGGER_SOURCE } from '../catalog/api.generated.js';
import {
  searchOperations,
  describeOperation,
  summarizeOperation,
  findOperation,
} from '../catalog/search.js';
import { request, redact } from '../transport/http.js';
import { text } from '../mcp/response.js';
import type { ToolContext } from './context.js';

export interface CallArgs {
  id: string;
  path_params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  dry_run?: boolean;
  /** Fields to keep on each item of a list response (or on a single item). */
  pick?: string[];
  /** Cap on the items of a list response, applied after the platform's own paging. */
  max_items?: number;
}

/** Past this many characters a list response is cut to fit and says so. */
export const RESULT_CAP = 60_000;

/**
 * Find the ONE list in a platform response.
 *
 * httpx.WriteList answers `{ <name>: [...], total }`, WriteItem `{ <name>: {...} }`,
 * and a few endpoints answer a bare array. The list is the part that grows,
 * so it is the part that gets picked, capped and truncated.
 */
function listOf(raw: unknown): { key: string | null; items: unknown[] } | null {
  if (Array.isArray(raw)) return { key: null, items: raw };
  if (!raw || typeof raw !== 'object') return null;
  const arrays = Object.entries(raw as Record<string, unknown>).filter(([, v]) => Array.isArray(v));
  if (arrays.length !== 1) return null;
  return { key: arrays[0][0], items: arrays[0][1] as unknown[] };
}

function pickFields(item: unknown, fields: string[]): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const o: Record<string, unknown> = {};
  for (const f of fields) {
    const v = (item as Record<string, unknown>)[f];
    if (v !== undefined) o[f] = v;
  }
  return o;
}

/**
 * Shape a live response for the reader: pick, cap, and never exceed RESULT_CAP
 * on a list.
 *
 * A product list is 50 objects of 2 KB each — 100 KB into the context for the
 * ids and titles the agent wanted. `pick` keeps the named fields on every item
 * (or on the single item of a WriteItem answer), `max_items` cuts the list, and
 * a list still over RESULT_CAP is cut to fit. Every cut is SAID, with the size
 * it would have been and how to narrow the call. A non-list answer is never
 * cut: there is no honest place to stop inside one object.
 */
export function shapeResponse(raw: unknown, opts: { pick?: string[]; max_items?: number }): unknown {
  const list = listOf(raw);
  if (!list) {
    // WriteItem: `{ page: {...} }` — pick reaches inside the one object.
    if (opts.pick && raw && typeof raw === 'object') {
      const entries = Object.entries(raw as Record<string, unknown>);
      const objs = entries.filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
      if (objs.length === 1) return { ...raw, [objs[0][0]]: pickFields(objs[0][1], opts.pick) };
      return pickFields(raw, opts.pick);
    }
    return raw;
  }
  let items = opts.pick ? list.items.map((it) => pickFields(it, opts.pick!)) : list.items;
  const of = items.length;
  let cut: string | undefined;
  if (opts.max_items !== undefined && items.length > opts.max_items) {
    items = items.slice(0, opts.max_items);
    cut = 'max_items';
  }
  const rebuild = (its: unknown[]) =>
    list.key === null ? its : { ...(raw as Record<string, unknown>), [list.key]: its };
  let out = rebuild(items);
  if (JSON.stringify(out).length > RESULT_CAP) {
    // Drop from the end until it fits; the first items are the ones paging asked for.
    const fixed = JSON.stringify(rebuild([])).length;
    let used = fixed;
    let n = 0;
    for (const it of items) {
      const size = JSON.stringify(it).length + 1;
      if (used + size > RESULT_CAP) break;
      used += size;
      n++;
    }
    items = items.slice(0, n);
    out = rebuild(items);
    cut = 'size';
  }
  if (!cut) return out;
  const truncated = {
    shown: items.length,
    of,
    hint:
      cut === 'size'
        ? `The full list was over ${RESULT_CAP} characters. Pass pick to keep only the fields you need, max_items, or the operation's own limit/offset query.`
        : 'Cut by max_items; raise it or page with the operation\'s own limit/offset query.',
  };
  return list.key === null ? { items, truncated } : { ...(out as Record<string, unknown>), truncated };
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

  const raw = await request({
    base: ctx.base,
    method: op.method,
    path,
    token,
    query: args.query,
    body: args.body,
    fetchImpl: ctx.fetchImpl,
  });
  return shapeResponse(raw, { pick: args.pick, max_items: args.max_items });
}

export function registerApiTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'sb_api_find',
    {
      description:
        'Search platform API operations by intent (query: one line per match), or read one ' +
          "operation's full call sheet (id: parameter types, credential, body schema or an " +
          `explicit warning that none is described). Reaches all ${SWAGGER_SOURCE.operations} operations.`,
      inputSchema: {
      query: z
        .string()
        .optional()
        .describe('What you want to do, in words: "create a menu", "list orders", "upload media"'),
      id: z
        .string()
        .optional()
        .describe('An id from a previous search — returns that operation\'s full call sheet'),
      tag: z.string().optional().describe('Narrow to one tag, e.g. "menus", "products", "theme"'),
      limit: z.number().int().min(1).max(50).optional().describe('Default 8'),
    },
      annotations: { readOnlyHint: true },
    },
    async ({ query, id, tag, limit }) => {
      if (id) {
        const op = findOperation(id);
        if (!op) throw new Error(`sbuilder: unknown operation "${id}" — search with query first`);
        return text(describeOperation(op));
      }
      if (!query) {
        throw new Error('sbuilder: sb_api_find needs a query (search) or an id (call sheet)');
      }
      const matches = searchOperations(query, { tag, limit }).map(summarizeOperation);
      return text({
        matches,
        next: matches.length
          ? 'Pass one id back to sb_api_find for its call sheet before calling it.'
          : 'No match — try other words, or a tag.',
      });
    },
  );

  server.registerTool(
    'sb_api_call',
    {
      description:
        'Execute one operation from sb_api_find. Defaults to a dry run that sends nothing and ' +
          'shows the request. pick keeps only named fields on list items, max_items caps the ' +
          'list, and a list over 60 KB is cut to fit and says so.',
      inputSchema: {
      id: z
        .string()
        .describe('Operation id from sb_api_find, e.g. "get:/api/sites/{siteID}/menus"'),
      path_params: z.record(z.string()).optional(),
      query: z.record(z.string()).optional(),
      body: z.unknown().optional(),
      dry_run: z.boolean().optional().describe('Defaults to true. Pass false to actually send.'),
      pick: z.array(z.string()).optional(),
      max_items: z.number().int().min(1).optional(),
    },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) => text(await callOperation(ctx, args as CallArgs)),
  );
}
