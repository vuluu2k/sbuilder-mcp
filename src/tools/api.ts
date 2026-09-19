import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { API_OPERATIONS, SWAGGER_SOURCE } from '../catalog/api.generated.js';
import { REQUEST_SHAPES } from '../catalog/shapes.generated.js';
import {
  searchOperations,
  describeOperation,
  summarizeOperation,
  findOperation,
} from '../catalog/search.js';
import { request, redact } from '../transport/http.js';
import { text } from '../mcp/response.js';
import type { ToolContext } from './context.js';
import { credentialFor } from '../transport/credential.js';
import type { ApiOperation } from '../catalog/types.js';

export interface CallArgs {
  /** Operation id from sb_api_find. Omit it to call by method + path. */
  id?: string;
  /** With `path`, when `id` is absent: a route the catalog does not carry. */
  method?: string;
  path?: string;
  path_params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  dry_run?: boolean;
  /** Fields to keep on each item of a list response (or on a single item). */
  pick?: string[];
  /** Cap on the items of a list response, applied after the platform's own paging. */
  max_items?: number;
  /** Skip items within this response, not within the server's dataset. */
  item_offset?: number;
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
/**
 * LIST OPERATIONS WHOSE EVERY ROW CARRIES A WHOLE PAGE DOCUMENT.
 *
 * The page recovery surface answers with the documents themselves — which is
 * right, since a restore has to have something to restore from — and useless to
 * read. MEASURED against a live server: one version of a TWO-NODE page is 1,690
 * bytes, so a realistic 120-node page runs about 70 KB per version and a listing
 * of twenty is **1.4 MB in one answer**. An agent choosing which version to
 * restore would be handed a truncated blob and no reliable way to pick.
 *
 * `sb_publish` already had this exact problem and the same answer: a published
 * row carries `document`, `html` and `css` for every page the cascade touched,
 * so it PROJECTS the rows. This is that, applied where the caller cannot know to
 * ask — and it is a DEFAULT rather than a rule: an explicit `pick` still wins,
 * so the document is one argument away for a caller that wants to read one.
 */
const LIST_PROJECTIONS: Record<string, string[]> = {
  'get:/api/sites/{siteId}/pages/{pageId}/versions': [
    'id',
    'versionNo',
    'label',
    'createdBy',
    'createdAt',
    'isLive',
  ],
  'get:/api/sites/{siteId}/pages/{pageId}/history': ['id', 'createdBy', 'createdAt'],
};

export function shapeResponse(
  raw: unknown,
  opts: Pick<CallArgs, 'pick' | 'max_items' | 'item_offset'>,
): unknown {
  const asked = opts.pick !== undefined || opts.max_items !== undefined || opts.item_offset !== undefined;
  const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const list = listOf(raw);

  if (!list) {
    // No single list. `pick` has two honest targets: the answer's own fields,
    // or the ONE object a WriteItem answer wraps (`{ page: {...} }`) — tried in
    // that order, because an item that happens to hold a nested object would
    // otherwise have its named fields dropped and the nested object emptied.
    // Never `{}`: a pick that matched nothing returns the answer untouched and
    // says so, since an empty object reads as "the platform sent nothing".
    let out: unknown = raw;
    let applied = false;
    if (opts.pick && isObj(raw)) {
      const top = pickFields(raw, opts.pick) as Record<string, unknown>;
      if (Object.keys(top).length > 0) {
        out = top;
        applied = true;
      } else {
        const objs = Object.entries(raw).filter(([, v]) => isObj(v));
        if (objs.length === 1) {
          const inner = pickFields(objs[0][1], opts.pick) as Record<string, unknown>;
          if (Object.keys(inner).length > 0) {
            out = { ...raw, [objs[0][0]]: inner };
            applied = true;
          }
        }
      }
    }
    if (asked && !applied && isObj(out)) {
      return {
        ...out,
        shaping_note:
          'Not a single-list answer and pick matched no field, so nothing was shaped or cut.',
      };
    }
    if ((opts.max_items !== undefined || opts.item_offset !== undefined) && isObj(out)) {
      return { ...out, shaping_note: 'Not a list answer, so max_items/item_offset did not apply.' };
    }
    return out;
  }

  const of = list.items.length;
  const offset = Math.min(opts.item_offset ?? 0, of);
  let items = list.items.slice(offset);
  let shapingNote: string | undefined;
  if (opts.pick) {
    const projected = items.map((it) => pickFields(it, opts.pick!));
    // A typo must not turn a populated list into apparently empty records.
    // Keep the payload in this case, but still apply the normal size guard.
    const objects = projected.filter(isObj);
    if (objects.length > 0 && objects.every((it) => Object.keys(it).length === 0)) {
      shapingNote = 'pick matched no field on these items; original fields kept. Check the field names.';
    } else {
      items = projected;
    }
  }
  let cut: 'max_items' | 'size' | 'item_offset' | undefined = offset > 0 ? 'item_offset' : undefined;
  if (opts.max_items !== undefined && items.length > opts.max_items) {
    items = items.slice(0, opts.max_items);
    cut = 'max_items';
  }
  const rebuild = (its: unknown[]) => {
    const out = list.key === null ? its : { ...(raw as Record<string, unknown>), [list.key]: its };
    if (!shapingNote) return out;
    return list.key === null
      ? { items: its, shaping_note: shapingNote }
      : { ...out, shaping_note: shapingNote };
  };

  // The platform may already answer with a `truncated` field; never clobber it.
  const key = isObj(raw) && 'truncated' in raw ? '_truncated' : 'truncated';
  const said = (t: Record<string, unknown>) =>
    list.key === null
      ? { items, ...(shapingNote ? { shaping_note: shapingNote } : {}), [key]: t }
      : { ...(rebuild(items) as Record<string, unknown>), [key]: t };

  // Budget the cut so the answer INCLUDING what it says about the cut fits.
  const TRUNCATED_ROOM = 320;
  if (JSON.stringify(rebuild(items)).length + (cut ? TRUNCATED_ROOM : 0) > RESULT_CAP) {
    const fixed = JSON.stringify(rebuild([])).length;
    if (fixed + TRUNCATED_ROOM > RESULT_CAP) {
      // The non-list part alone is over the cap, so dropping items gains
      // nothing. The answer goes back whole, with the reason.
      return said({
        shown: items.length,
        of,
        offset,
        hint: `The non-list part alone exceeds ${RESULT_CAP} characters; no additional size cut was made. Narrow the response at the API.`,
      });
    }
    let used = fixed + TRUNCATED_ROOM;
    let n = 0;
    for (const it of items) {
      const size = JSON.stringify(it).length + 1;
      if (used + size > RESULT_CAP) break;
      used += size;
      n++;
    }
    items = items.slice(0, n);
    cut = 'size';
  }
  if (!cut) return rebuild(items);
  return said({
    shown: items.length,
    of,
    offset,
    // No false continuation when even one row cannot fit. The caller must
    // narrow its fields first, not loop forever at the same offset.
    ...(items.length > 0 && offset + items.length < of
      ? { next_item_offset: offset + items.length }
      : {}),
    hint:
      cut === 'size'
        ? `List exceeds ${RESULT_CAP} characters. Use pick to narrow fields; item_offset pages within this response.`
        : 'item_offset/max_items select within this response, after API paging. Repeat only reads, never mutations.',
  });
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

/**
 * The path parameters that mean "THIS site" — lowercased, because the platform
 * writes `{siteId}` in 281 operations and `{siteID}` in 8.
 *
 * Deliberately only the site. `{productId}`, `{id}` and the rest name a record
 * the caller chose; the site is the one id an install already holds.
 */
const SITE_PARAMS = new Set(['siteid']);

const RAW_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Two ids naming the same route differ only in what they call the parameter:
 * `{siteId}` in most operations, `{siteID}` in eight. Compare on route SHAPE —
 * the same normalisation `reportUndocumentedRoutes` in scripts/gen-catalog.ts
 * uses for the identical split — so a caller who spells a parameter name
 * differently still gets the catalogued treatment rather than silently
 * dropping onto the raw path with no undo prepared for a whole-document PUT.
 */
const routeShape = (id: string): string => id.replace(/\{[^}]*\}/g, '{}');

/**
 * Fold a raw method+path back onto the catalogued route it names.
 *
 * `routeShape` answers only when the caller SPELLED the parameters. A caller
 * who writes the real ids instead — `/api/sites/abc123/menus/m1`, which is what
 * a path copied out of a browser looks like — named exactly the same route and
 * got none of the catalogued treatment: no shape, no projection, and no undo
 * pre-read before a whole-document PUT.
 *
 * Segment-wise: the same number of segments, a catalogued `{param}` takes any
 * single non-empty segment, a literal must match exactly and case-sensitively.
 *
 * RANKED so the tool never GUESSES between siblings. An exact-literal route —
 * every segment equal — wins outright, because it IS the route rather than a
 * match of it. Otherwise the candidate spelling the MOST literal segments wins:
 * `…/pages/locate-nodes` is more specific than `…/pages/{pageId}` and is what a
 * caller naming that path meant. A TIE folds to NOTHING and the call stays raw,
 * because two equally specific siblings are two different operations and
 * picking one would send a body shaped for the other.
 */
export function foldBack(
  method: string,
  path: string,
  ops: readonly ApiOperation[],
): ApiOperation | undefined {
  const want = `${method.toLowerCase()}:${path}`;
  const byShape = ops.find((o) => routeShape(o.id) === routeShape(want));
  if (byShape) return byShape;

  const segs = path.split('/');
  let best: ApiOperation | undefined;
  let bestLiterals = -1;
  let tied = false;
  for (const o of ops) {
    if (o.method.toLowerCase() !== method.toLowerCase()) continue;
    const cand = o.path.split('/');
    if (cand.length !== segs.length) continue;
    let literals = 0;
    let ok = true;
    for (let i = 0; i < cand.length; i++) {
      const c = cand[i];
      if (c.startsWith('{') && c.endsWith('}')) {
        if (!segs[i]) { ok = false; break; }
      } else if (c === segs[i]) {
        literals++;
      } else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (literals === cand.length) return o;
    if (literals > bestLiterals) {
      best = o;
      bestLiterals = literals;
      tied = false;
    } else if (literals === bestLiterals) {
      tied = true;
    }
  }
  return tied ? undefined : best;
}

/**
 * Said once per process on the first raw call. A raw route has no call sheet,
 * no shape and no undo, and the durable fix is upstream — the same fix
 * reportUndocumentedRoutes names.
 */
export const RAW_CALL_NOTICE =
  'This route is not in the catalog, so it has no call sheet, no body shape, no body ' +
  'warnings and no sb_undo. The credential still follows the path prefix and dry_run still ' +
  'defaults to true. Spell path parameters as {name} with values in path_params; a literal id ' +
  'folds onto the catalogued route only when exactly one matches. ' +
  'The durable fix is an @Router annotation upstream and a catalog regen.';

/**
 * Routes registered DIRECTLY on the gin router, outside every annotated
 * dispatcher, so no `swag init` and no regen can ever carry them. Hand-kept
 * and three entries long on purpose: the generated answer for UNANNOTATED
 * routes is an @Router line upstream, not a table here.
 */
export const OUTSIDE_CATALOG = [
  { method: 'GET', path: '/api/permissions', why: 'the RBAC matrix, content domains and delegation scopes' },
  { method: 'GET', path: '/api/plans', why: 'the public plan catalogue' },
  { method: 'GET', path: '/api/locales', why: "the language list with each locale's currency" },
] as const;

/**
 * The operation a call names — from the catalog by id, or synthesised from
 * method + path for a route the catalog does not carry.
 *
 * The raw form exists because the catalog is a CLOSED LIST read off one
 * swagger document, and the platform serves routes that document does not
 * describe: 20 the platform never annotated, three registered directly on the
 * router, and anything newer than the last regen. Refusing them made the
 * catalog's staleness the caller's ceiling.
 *
 * It changes no rule. The credential comes from the path prefix exactly as it
 * does for a catalogued route, and a path that is not a bare platform path is
 * refused: `request()` prefixes `ctx.base`, so a path carrying a host would
 * send this install's credential to another server.
 *
 * A method+path that NAMES a catalogued route folds back onto it, so a caller
 * who happens to spell a known route this way gets the catalogued treatment
 * — shape, undo, projections — never less than the catalog already knows.
 */
export function resolveOperation(args: CallArgs): ApiOperation & { raw?: true; bound?: Record<string, string> } {
  const hasRaw = args.method !== undefined || args.path !== undefined;
  if (args.id && hasRaw) {
    throw new Error('sbuilder: sb_api_call takes either id or method+path, not both.');
  }
  if (!args.id && !(args.method && args.path)) {
    throw new Error(
      'sbuilder: sb_api_call takes either id or method+path — id from sb_api_find, ' +
        'method+path for a route the catalog does not carry.',
    );
  }
  if (args.id) {
    const op = API_OPERATIONS.find((o) => o.id === args.id);
    if (!op) throw new Error(`sbuilder: unknown operation "${args.id}" — use sb_api_find first`);
    return op;
  }
  const method = args.method!.toUpperCase();
  if (!RAW_METHODS.has(method)) {
    throw new Error(`sbuilder: method "${args.method}" is not one of ${[...RAW_METHODS].join(', ')}.`);
  }
  const path = args.path!;
  // `request()` builds the URL as `ctx.base + path` (plain concatenation), so an
  // authority can never be reintroduced by the path — but a backslash is refused
  // outright anyway, because a relative-URL resolver treats one as a slash and
  // this refusal must hold even if that concatenation is ever replaced with one.
  // A `?` or `#` in `path` is refused too: `buildUrl` appends `query` with its
  // own `?`, so one already in `path` either buries the query in a fragment or
  // sends two `?`s — a query belongs in `query`, not folded into `path`.
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    path.includes('?') ||
    path.includes('#')
  ) {
    throw new Error(
      `sbuilder: path must be a bare platform path starting with "/", with no query string or ` +
        `fragment (got ${JSON.stringify(path)}). A query belongs in \`query\`, not in \`path\`. ` +
        'The base URL is this install\'s SB_API; a path carrying a host would send the credential elsewhere.',
    );
  }
  // A method+path that names a catalogued route gets the catalogued treatment
  // — shape, undo, projections — never less than the catalog already knows.
  const known = foldBack(method, path, API_OPERATIONS);
  if (known) {
    // THE CATALOGUED PATH IS WHAT IS RETURNED, always. `op.path` is the key the
    // undo pre-read and the projections are looked up by, so replacing it with
    // the caller's literal spelling would fold the route back and then lose the
    // treatment that was the point. The literals the caller wrote become
    // bindings instead, under the names the call sheet lists.
    const bound: Record<string, string> = {};
    const cand = known.path.split('/');
    const segs = path.split('/');
    if (cand.length === segs.length) {
      for (let i = 0; i < cand.length; i++) {
        const c = cand[i];
        if (c.startsWith('{') && c.endsWith('}') && !segs[i].startsWith('{')) {
          bound[c.slice(1, -1)] = segs[i];
        }
      }
    }
    return Object.keys(bound).length ? { ...known, bound } : known;
  }
  return {
    id: `${method.toLowerCase()}:${path}`,
    method,
    path,
    tags: [],
    summary: '',
    params: [],
    bodyDescribed: false,
    bodyRef: null,
    credential: credentialFor(path),
    raw: true,
  };
}

export async function callOperation(ctx: ToolContext, args: CallArgs): Promise<unknown> {
  const op = resolveOperation(args);
  if (args.item_offset && op.method !== 'GET' && op.method !== 'HEAD') {
    throw new Error('sbuilder: item_offset is for reads only. Repeating a mutation to page its result would repeat the write; use the matching GET instead.');
  }

  // Substitute {name} placeholders. A missing one would otherwise be sent
  // literally, and a path containing a brace 404s with nothing to explain it.
  let path = op.path;
  for (const m of op.path.matchAll(/\{([^}]+)\}/g)) {
    const name = m[1];
    // CASE-INSENSITIVE, because the platform spells one parameter two ways:
    // `{siteId}` in 281 operations and `{siteID}` in 8. A caller who learned the
    // common spelling passes the wrong key on those eight and is refused for a
    // difference of one letter — a distinction no reader of the call sheet has
    // any reason to notice, and one this tool has nothing to gain by enforcing.
    // The exact name still wins; the fold is only a fallback.
    // A LITERAL THE CALLER WROTE INTO THE PATH IS A VALUE THEY SUPPLIED, under
    // the name the catalogued route gives that segment. An explicit
    // `path_params` entry still wins.
    const given = { ...(op.bound ?? {}), ...(args.path_params ?? {}) };
    let value = given[name];
    if (value === undefined) {
      const folded = Object.keys(given).find((k) => k.toLowerCase() === name.toLowerCase());
      if (folded !== undefined) value = given[folded];
    }
    // SB_SITE ANSWERS FOR {siteId}, exactly as it does for every tool's
    // `site_id` argument through `siteFor()`. It did not here, and this is the
    // surface where it costs most: `sb_api_call` reaches 484 operations and 289
    // of them name the site, so a key-only install — where the id is a constant
    // the environment already holds — made the model carry a 32-character
    // string through every raw call it made. An explicit argument still wins,
    // so a session spanning two sites works by naming each.
    if (value === undefined && SITE_PARAMS.has(name.toLowerCase()) && ctx.siteId) {
      value = ctx.siteId;
    }
    if (value === undefined) {
      // NAME THE ARGUMENT, not just the parameter. The call sheet lists these
      // under `params` while the call takes them in `path_params`, and a caller
      // who reads the sheet and passes `params` is told only that the param is
      // missing — which is exactly the value they just supplied. Two words of
      // "in path_params" is the difference between one round trip and a loop.
      throw new Error(
        `sbuilder: operation ${op.id} needs path param "${name}" — pass it in path_params, ` +
          `e.g. path_params: { "${name}": "…" }. The call sheet lists it under "params"; ` +
          'query values go in `query`.',
      );
    }
    path = path.replace(`{${name}}`, encodeURIComponent(value));
  }

  const token = tokenFor(ctx, op.credential);
  const dryRun = args.dry_run !== false;
  if (dryRun) {
    // THE DRY RUN IS THE DEFAULT, so a directive said only after a real send
    // reaches nobody who looks before they leap. Once per process either way:
    // a dry run that said it leaves the send that follows silent.
    const directive = op.raw ? ctx.notices.once('raw_call', RAW_CALL_NOTICE) : undefined;
    return {
      dry_run: true,
      ...(op.raw ? { uncatalogued: true } : {}),
      ...(directive ? { directive } : {}),
      would_send: redact({
        method: op.method,
        url: ctx.base.replace(/\/$/, '') + path,
        query: args.query,
        Authorization: token ? `Bearer ${token}` : undefined,
        body: args.body,
      }),
      // Shaping is part of what the call WOULD do, so the preview says it;
      // otherwise a dry run reads identically whether or not it was asked for.
      ...(args.pick !== undefined || args.max_items !== undefined || args.item_offset !== undefined
        ? { shaping: { pick: args.pick, max_items: args.max_items, item_offset: args.item_offset } }
        : {}),
      note: 'Nothing was sent. Re-call with dry_run:false to execute.',
    };
  }

  // A PUT IS A REPLACE, AND THE PLATFORM HAS NO HISTORY. Read what is about to
  // be destroyed first, so `sb_undo` can put it back — one extra round trip on a
  // write, never on a read and never on a dry run. Silent on failure: an undo
  // that could not be prepared must not stop the write the caller asked for.
  if (op.method === 'PUT' && REQUEST_SHAPES[op.id] && API_OPERATIONS.some((o) => o.id === `get:${op.path}`)) {
    try {
      const before = await request({
        base: ctx.base,
        method: 'GET',
        path,
        token: tokenFor(ctx, findOperation(`get:${op.path}`)?.credential ?? op.credential),
        fetchImpl: ctx.fetchImpl,
      });
      ctx.undo.record(op.id, path, before);
    } catch {
      // The state could not be read — the row may not exist yet, which is the
      // common case for a PUT that creates. Nothing to undo, nothing to say.
    }
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
  // A 204 HAS NO BODY, and `null` is not an answer a caller can read: a DELETE
  // that worked and a DELETE that returned nothing looked identical, so sixteen
  // page deletes in a row reported `null` sixteen times and the only way to know
  // they had happened was to list the pages again. Say what the operation did.
  // The caller's own `pick` outranks the default: asking for `document` is how
  // you read a version rather than merely choose one.
  const answer =
    raw === null || raw === undefined
      ? { ok: true, method: op.method, path, note: 'The platform answered with no content.' }
      : shapeResponse(raw, {
          pick: args.pick ?? LIST_PROJECTIONS[op.id],
          max_items: args.max_items,
          item_offset: args.item_offset,
        });
  if (!op.raw) return answer;
  const note = ctx.notices.once('raw_call', RAW_CALL_NOTICE);
  return { uncatalogued: true, ...(note ? { note } : {}), data: answer };
}

/**
 * WHY A SUMMARY CAN BE ABOUT A DIFFERENT ROUTE.
 *
 * The platform stacks ONE doc comment over several `@Router` lines and swag
 * copies it to each, so the summary — and the description, which it also merges
 * across blocks — belongs to the group rather than to the route. This repo
 * already corrects the same defect for BODIES by reading the decode site; there
 * is no such correction for prose, and no per-route sentence exists to recover.
 */
const SHARED_SUMMARY_NOTICE =
  'summary_covers means the platform wrote that one sentence for several routes at once (one ' +
  'doc comment over several @Router lines), so it may describe one of the listed routes rather ' +
  'than this one — trust the PATH and the body shape, not the sentence. The sharpest case is ' +
  'money: /payment-transactions/{id}/refund only RECORDS a refund made elsewhere, while ' +
  '/refund-via-gateway is the one that asks the gateway to actually send it.';

export function registerApiTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'sb_api_find',
    {
      description:
        'Find API operations by intent (query), or get a call sheet (id): parameters, ' +
          'credential, body fields and handler caveats. ' +
          `Reaches all ${SWAGGER_SOURCE.operations} operations.`,
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
        const sheet = describeOperation(op);
        // The WHY is a directive, so it is said once per process; the routes it
        // covers are DATA and ride on every sheet that has them.
        const why = sheet.summary_covers
          ? ctx.notices.once('shared_summary', SHARED_SUMMARY_NOTICE)
          : undefined;
        return text(why ? { ...sheet, directive: why } : sheet);
      }
      if (!query) {
        throw new Error('sbuilder: sb_api_find needs a query (search) or an id (call sheet)');
      }
      const matches = searchOperations(query, { tag, limit }).map(summarizeOperation);
      return text({
        matches,
        next: matches.length
          ? 'Pass one id back to sb_api_find for its call sheet before calling it.'
          : 'No match — try other words, or a tag. A route the catalog does not carry can still be called: sb_api_call with method + path.',
        ...(matches.length ? {} : { outside_catalog: OUTSIDE_CATALOG }),
      });
    },
  );

  server.registerTool(
    'sb_api_call',
    {
      description:
        'Call an operation from sb_api_find (id), or a route the catalog lacks (method+path); ' +
          'dry run by default. pick selects fields, max_items caps lists, item_offset skips items. ' +
          'Lists over 60 KB say so.',
      inputSchema: {
      id: z
        .string()
        .optional()
        .describe('Operation id from sb_api_find, e.g. "get:/api/sites/{siteID}/menus"'),
      method: z.string().optional().describe('With path, when id is absent: GET|HEAD|POST|PUT|PATCH|DELETE'),
      path: z
        .string()
        .optional()
        .describe('Bare platform path, e.g. "/api/sites/{siteId}/published"; {siteId} defaults to SB_SITE'),
      path_params: z.record(z.string()).optional(),
      query: z.record(z.string()).optional(),
      body: z.unknown().optional(),
      dry_run: z.boolean().optional().describe('Defaults to true. Pass false to actually send.'),
      pick: z.array(z.string()).optional(),
      max_items: z.number().int().min(1).optional(),
      item_offset: z.number().int().min(0).optional().describe('Offset within this response, after API paging. Reads only.'),
    },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (args) => text(await callOperation(ctx, args as CallArgs)),
  );
}
