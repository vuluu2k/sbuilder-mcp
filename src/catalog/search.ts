import { API_OPERATIONS, API_DEFINITIONS } from './api.generated.js';
import { REQUEST_SHAPES } from './shapes.generated.js';
import { translationCallSheet } from '../domains/site/translate.js';
import type { ApiOperation } from './types.js';

/**
 * Term-hit scoring, weighted by field, and deliberately NOT fuzzy.
 *
 * The caller is a language model that can re-query with better words, so an
 * empty list is a cheap, recoverable answer. A fuzzy ranker's failure mode is
 * the expensive one: it returns a confident wrong operation, and the model then
 * calls it. Ties break by id so the same query always returns the same order —
 * a ranker whose output shuffles between calls is one nobody can debug.
 */
const WEIGHT = { tag: 5, path: 3, summary: 2 } as const;

/** Eight is enough to choose from; twelve was measured at 44 KB once the schemas rode along. */
export const DEFAULT_FIND_LIMIT = 8;

export function findOperation(id: string): ApiOperation | undefined {
  return API_OPERATIONS.find((o) => o.id === id);
}

export function searchOperations(
  query: string,
  opts: { tag?: string; limit?: number } = {},
): ApiOperation[] {
  const limit = opts.limit ?? DEFAULT_FIND_LIMIT;
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let pool = API_OPERATIONS;
  if (opts.tag) pool = pool.filter((o) => o.tags.includes(opts.tag!));
  if (terms.length === 0) return pool.slice(0, limit);

  const scored: Array<{ op: ApiOperation; score: number }> = [];
  for (const op of pool) {
    const tags = op.tags.join(' ').toLowerCase();
    const path = op.path.toLowerCase();
    const summary = op.summary.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (tags.includes(t)) score += WEIGHT.tag;
      if (path.includes(t)) score += WEIGHT.path;
      if (summary.includes(t)) score += WEIGHT.summary;
    }
    if (score > 0) scored.push({ op, score });
  }
  scored.sort((a, b) => b.score - a.score || a.op.id.localeCompare(b.op.id));
  return scored.slice(0, limit).map((s) => s.op);
}

/**
 * The full call sheet for one operation — including, deliberately, what is NOT
 * known about it.
 *
 * The source document under-describes bodies in TWO different ways, and telling
 * them apart matters because the right recovery differs:
 *
 *  - 62 of the 168 body-carrying operations declare a body with no `$ref`, so
 *    the shape is unknown but its EXISTENCE is certain.
 *  - 95 of the 180 write operations declare no body parameter at all. Some
 *    genuinely take none (`POST /api/orgs/{id}/leave` is an action, not a
 *    payload). Others are simply un-annotated: `PUT /pages/{id}/source` carries
 *    a whole page document and the document says nothing about it, and
 *    `POST /_wb/account/login` obviously takes credentials.
 *
 * Saying "no body" for the second group would be the silent failure — the model
 * would send an empty PUT and wipe a page. So the two get different words.
 */
export function describeOperation(op: ApiOperation): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: op.id,
    method: op.method,
    path: op.path,
    summary: op.summary,
    tags: op.tags,
    credential: op.credential,
    params: op.params.filter((p) => p.in !== 'body'),
  };
  const hasBody = op.params.some((p) => p.in === 'body');
  const isWrite = op.method === 'POST' || op.method === 'PUT' || op.method === 'PATCH';

  // THE HANDLER OUTRANKS THE DOCUMENT. `swagger.json` describes 46 of 212 write
  // bodies, and it attaches one doc comment's `@Param body` to every `@Router`
  // line beneath it — so a listing GET currently claims a body it does not take.
  // A decode site sits inside one `case http.Method*`, so it is per-method by
  // construction, and it is read from the code that actually runs.
  //
  // The two warnings below are dropped when a shape is present: they exist
  // because the shape was unknown, and keeping them once it is known is prose
  // the model has to read past on its way to the answer.
  // A TRANSLATIONS OPERATION IS REACHABLE AND WAS UNSAFE. Every route here is in
  // the catalog, so an agent could call them all and had no way to know which
  // fields are content — and translating the wrong special BREAKS the render
  // rather than degrading it. Attached to the call sheet because that is where
  // the agent already is when it decides what to send.
  if (/\/translations(\/|$)/.test(op.path)) {
    out.translation_fields = translationCallSheet();
  }

  // AN APP'S BLOCKS WERE REACHABLE AND UNUSABLE, because the one thing needed to
  // place one is a string format that exists only in Go. `page/appblocks.go`
  // spells it out — SpecAppBlockRef is "<installId>/<blockKey>" — and every
  // field to build it comes back from `/apps/blocks` (`installId`, `key`). An
  // agent had the list of blocks, the route that returns it, and no way to turn
  // a row into a node.
  //
  // Attached to the call sheet for the same reason the translation table is:
  // that is where the agent already is when it decides what to send. No new
  // tool — placing one is `sb_add`, which already takes the specials it needs.
  if (/\/(apps|builtin-apps)(\/|$)/.test(op.path)) {
    out.app_blocks = {
      place:
        'A block from an installed app goes on a page as ONE node carrying ' +
        'specials.appBlockRef = "<installId>/<blockKey>" — both fields come back from ' +
        'GET /api/sites/{siteId}/apps/blocks. Add it with sb_add; the platform composes the ' +
        "app's markup underneath on read.",
      never:
        'Never author specials.appBlockId or appBlockHash. Those are the stamps the SERVER ' +
        'writes when it composes, and writing one makes the next save decompose your node over ' +
        'the app instead.',
      interior:
        'An edit INSIDE a composed block is stored nowhere and reported nowhere — the save ' +
        'reduces the subtree back to the reference. Configure the block through its own ' +
        'props/slots, never by editing what it rendered.',
      installing:
        'A BUILT-IN app installs with POST /api/sites/{siteId}/builtin-apps/{key} and that key ' +
        "parameter's description names every installable one. A MARKETPLACE app cannot be " +
        'installed from here at all: it goes through an OAuth consent screen a person has to ' +
        'approve, so ask the merchant to install it and then read /apps/blocks again.',
    };
  }

  const shape = REQUEST_SHAPES[op.id];
  if (shape) {
    out.body_shape = shape;
    return out;
  }

  if (hasBody && op.bodyDescribed && op.bodyRef) {
    out.body_schema = API_DEFINITIONS[op.bodyRef];
  } else if (hasBody) {
    out.body_warning =
      'This operation takes a body, but the OpenAPI document does not describe its shape ' +
      '(no $ref). Do NOT guess one: read an existing item with the matching GET first and ' +
      'send back a modified copy.';
  } else if (isWrite) {
    out.body_note =
      'The document declares NO request body for this write operation. That may be true ' +
      '(some endpoints are pure actions, e.g. POST /api/orgs/{id}/leave), or the annotation ' +
      'may simply be missing — PUT /pages/{id}/source takes a whole page document and is ' +
      'documented exactly like this. Confirm with the matching GET before sending an empty body.';
  }
  return out;
}

export interface OperationLine {
  id: string;
  method: string;
  path: string;
  summary: string;
  credential: string;
  /** Non-body parameter names; `?` prefixes an optional one. */
  params: string[];
  body?: 'described' | 'undescribed' | 'none_declared';
}

/**
 * One LINE per match — what an agent needs to CHOOSE, not to call.
 *
 * `describeOperation` inlined the whole body definition for every hit, so a
 * "list orders" search cost ~44 KB for twelve operations the agent would call
 * one of. The schema now arrives with `sb_api_find id:` once the choice is
 * made. `body` is the three-way verdict as one word; the full wording — the
 * one that stops a model sending an empty PUT — lives in the call sheet, where
 * it is read at the moment it matters.
 */
export function summarizeOperation(op: ApiOperation): OperationLine {
  const hasBody = op.params.some((p) => p.in === 'body');
  const isWrite = op.method === 'POST' || op.method === 'PUT' || op.method === 'PATCH';
  const out: OperationLine = {
    id: op.id,
    method: op.method,
    path: op.path,
    summary: op.summary,
    credential: op.credential,
    params: op.params.filter((p) => p.in !== 'body').map((p) => (p.required ? p.name : `?${p.name}`)),
  };
  if (hasBody) out.body = op.bodyDescribed && op.bodyRef ? 'described' : 'undescribed';
  else if (isWrite) out.body = 'none_declared';
  return out;
}
