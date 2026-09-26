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

/**
 * The four operations that create or replace a whole product, on both
 * credential surfaces — never a list, a delete, or the bulk import/categories
 * routes beside them. Listed rather than matched by path pattern, because
 * `/products/import` and `/products/{productId}/categories` sit right next to
 * these and are not this trap: an import posts a file, and filing a product
 * under a category touches neither its price, its slug, nor its photos.
 */
const PRODUCT_WRITE_IDS = new Set([
  'post:/api/sites/{siteId}/products',
  'put:/api/sites/{siteId}/products/{id}',
  'post:/api/v1/products',
  'put:/api/v1/products/{id}',
]);

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
/**
 * ONE DOC BLOCK OVER SEVERAL `@Router` LINES, AND THE SUMMARY IS THE HALF
 * NOTHING CORRECTED.
 *
 * This file already records the defect for BODIES — swag attaches one comment
 * block's `@Param body` to every route beneath it, so a listing GET claimed a
 * body it does not take — and the fix was to read the decode site instead. The
 * SUMMARY is copied by the same mechanism and has no such correction: 302 of
 * 524 operations share a summary with another operation.
 *
 * MOST OF THAT IS HARMLESS AND MUST NOT BE FLAGGED. "List, create, update or
 * delete a course's lessons" on all four CRUD routes is an UMBRELLA — it names
 * the whole group and is true of each member, and 105 of the 119 shared
 * summaries are that shape. Flagging them would bury the ones that matter.
 *
 * THE DISCRIMINATOR IS THE TRAILING LITERAL SEGMENT, which is the same signal
 * `scripts/shapes.ts` already trusts to pick a handler out of a dispatcher that
 * routes by path ("the route's own trailing literal segment picks the callee").
 * Operations sharing a summary while differing only by METHOD or by a trailing
 * `{param}` are one resource; ones whose literal tails DIFFER are separate
 * ACTIONS, and one sentence can describe at most one of them. That leaves 14
 * groups and 41 operations.
 *
 * WHY THIS IS WORTH A FIELD. The costliest is money: this platform documents
 * `/refund` as RECORDING a refund made elsewhere and `/refund-via-gateway` as
 * ASKING the gateway to send it, and the catalog gives BOTH — plus `POST
 * /payment-transactions`, which opens a pay link — the single summary "ASK the
 * gateway to send the money back". An agent asked to refund a customer reaches
 * for the obvious name, reads a sentence promising the money moves, and records
 * a refund that never pays anybody. `POST .../versions` (snapshot) and
 * `.../restore` share one summary while running in OPPOSITE directions, and
 * `/invitations/{id}/accept` and `/decline` are both described as "Withdraw an
 * invitation".
 *
 * IT REPORTS THE COVERAGE AND NEVER GUESSES THE MISSING SENTENCE. The per-route
 * text does exist — in each package's route-map comment — but those maps write
 * paths relatively, abbreviate methods (`PATCH/DEL`), carry query strings and
 * often no description at all, so recovering a summary from them would invent
 * exactly the kind of confident wrong sentence this exists to remove. Naming
 * the routes the sentence covers is knowable, is enough for the agent to read
 * the path instead, and cannot be wrong.
 *
 * Derived from the catalog rather than generated into it: it is a fact ABOUT
 * the document, not one read off the platform, so generating it would ship a
 * table restating data the same file already carries.
 */
const summaryCoverage = (() => {
  let byId: Map<string, string[]> | null = null;
  /** The last segment that is not a `{param}` — an action tail, or a resource. */
  const tail = (path: string): string => {
    const literal = path.split('/').filter((seg) => seg && !seg.startsWith('{'));
    return literal[literal.length - 1] ?? '';
  };
  const build = (): Map<string, string[]> => {
    const groups = new Map<string, ApiOperation[]>();
    for (const op of API_OPERATIONS) {
      if (!op.summary) continue;
      const g = groups.get(op.summary);
      if (g) g.push(op);
      else groups.set(op.summary, [op]);
    }
    const out = new Map<string, string[]>();
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      if (new Set(members.map((m) => tail(m.path))).size < 2) continue;
      for (const op of members) {
        out.set(
          op.id,
          members.filter((m) => m.id !== op.id).map((m) => `${m.method} ${m.path}`),
        );
      }
    }
    return out;
  };
  return (id: string): string[] | undefined => (byId ??= build()).get(id);
})();

/** Whether this operation's summary is one the platform wrote for a group. */
export function summaryIsShared(id: string): boolean {
  return summaryCoverage(id) !== undefined;
}

/**
 * THE PARAMS, ONCE EACH.
 *
 * The stacked block copies `@Param` lines as well as prose, so an operation in
 * a group of four carries `siteId` four times: 29 operations list a parameter
 * more than once, and `POST /payment-transactions` reports `siteId` three
 * times. It is noise in the one field an agent reads to build the call, and it
 * costs tokens on every search line.
 *
 * Deduplicated by NAME AND LOCATION, which is what identifies a parameter on
 * the wire — two entries agreeing on both are one parameter however many blocks
 * declared it. The first is kept, so a description is never invented or merged.
 * No operation claims a path param its own path lacks (measured), so the
 * deduplication only ever removes a repeat.
 *
 * AND THE PATH IS THE AUTHORITY ON WHAT THE CALL NEEDS, which is the other
 * direction and was costing a round trip. THIRTY operations declare a `{param}`
 * in their path that the document lists under no `@Param` at all —
 * `POST /api/sites/{siteId}/pages` lists NONE of its own, and
 * `PUT /api/sites/{siteId}/courses/{id}/questions/{questionId}` lists every one
 * but `questionId`. `callOperation` already ignores this list and walks the
 * PATH, so the call is not broken; what breaks is the agent, which reads
 * `params`, sends what it says, and is told it is missing an argument the sheet
 * never mentioned. Synthesised here so the sheet says what the call demands,
 * and marked so nobody mistakes it for something the platform described.
 */
function visibleParams(op: ApiOperation): ApiOperation['params'] {
  const seen = new Set<string>();
  const out = op.params.filter((p) => {
    if (p.in === 'body') return false;
    const id = `${p.in}:${p.name}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  for (const m of op.path.matchAll(/\{([^}]+)\}/g)) {
    if (seen.has(`path:${m[1]}`)) continue;
    seen.add(`path:${m[1]}`);
    out.push({
      name: m[1],
      in: 'path',
      required: true,
      type: 'string',
      description: 'In the path, and undocumented — recovered from the route itself.',
    });
  }
  return out;
}

/**
 * A READ THAT CLAIMS A BODY IS CLAIMING ITS NEIGHBOUR'S.
 *
 * The same stacking that copies a summary copies every `@Param` in the block,
 * so 90 GET and DELETE operations declare a request body. `describeOperation`
 * believed them and inlined the DEFINITION: measured, ~83 KB of body schema
 * across those 90 call sheets — about 927 bytes each — describing a body the
 * route cannot take. `GET /api/sites/{siteId}/customers`, a listing, ships the
 * whole customer object and reports `body: "described"`.
 *
 * THE DECODE SITES CANNOT ANSWER THIS ONE, and reading their silence as a no
 * would be the mistake this repo already records in another form ("the absence
 * of a string is evidence about the string, not about the behaviour").
 * `scripts/shapes.ts` sets `WRITE_METHODS = POST | PUT | PATCH` and never looks
 * at a read, so "0 of 90 confirmed" is structural, not a finding.
 *
 * SO THE TEST IS THE MECHANISM ITSELF, which is visible in the document. A
 * stacked block gives every route the SAME `@Param`, byte for byte — name, type
 * and description. MEASURED: all 90 carry a body param identical to some write
 * operation's, and for 86 that donor is on the same path or the same resource,
 * which is a doc block covering several methods. That is the copy caught in the
 * act, not an assumption about what a GET may carry.
 *
 * It answers only for reads. A WRITE's body claim stays believed: this file
 * already records that most writes are UNDER-annotated, and `PUT
 * /pages/{id}/source` carries a whole page document while declaring nothing —
 * so the risk there runs the other way and a shared `@Param` may be the only
 * description of a real body.
 */
const copiedBodyDonor = (() => {
  let byId: Map<string, string> | null = null;
  const sig = (p: { name: string; type?: string; description?: string }): string =>
    JSON.stringify([p.name, p.type, p.description]);
  const build = (): Map<string, string> => {
    const donors = new Map<string, ApiOperation>();
    for (const op of API_OPERATIONS) {
      if (op.method !== 'POST' && op.method !== 'PUT' && op.method !== 'PATCH') continue;
      for (const p of op.params) if (p.in === 'body' && !donors.has(sig(p))) donors.set(sig(p), op);
    }
    const out = new Map<string, string>();
    for (const op of API_OPERATIONS) {
      if (op.method !== 'GET' && op.method !== 'DELETE') continue;
      const bodies = op.params.filter((p) => p.in === 'body');
      if (!bodies.length) continue;
      // EVERY one must be accounted for. A read carrying one copied param and
      // one of its own would be a shape nothing here has seen, and the honest
      // answer to that is to say nothing and leave the document's claim alone.
      const found = bodies.map((p) => donors.get(sig(p)));
      if (found.some((d) => d === undefined)) continue;
      out.set(op.id, `${found[0]!.method} ${found[0]!.path}`);
    }
    return out;
  };
  return (id: string): string | undefined => (byId ??= build()).get(id);
})();

export function describeOperation(op: ApiOperation): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: op.id,
    method: op.method,
    path: op.path,
    summary: op.summary,
    tags: op.tags,
    credential: op.credential,
    params: visibleParams(op),
  };

  // SAY WHO ELSE THE SENTENCE ABOVE IS ABOUT. Placed directly under `summary`
  // because that is the field it qualifies: an agent that has read the sentence
  // and moved on has already taken the wrong operation.
  const covers = summaryCoverage(op.id);
  if (covers) out.summary_covers = covers;

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
        "parameter's description names every installable one.",
      // A MARKETPLACE APP IS A PERMISSION GRANT, and who may make it is the
      // platform's line rather than this client's caution. `consent`
      // authenticates as a USER — the platform parses an ACCESS TOKEN, so a
      // session reaches it and a `wbk_` key does not — because an installed app
      // holds SCOPES against the store. And `acceptedPrice` is a pointer:
      // omitting it means a free app, and omitting it for a paid one is REFUSED
      // rather than assumed, so nothing automated can commit a merchant to a
      // subscription.
      //
      // So the honest answer is neither "ask a human" nor "just install it". It
      // is: always be able to SUGGEST, and install only what the credential in
      // hand is allowed to install, having shown what it grants.
      marketplace:
        'SUGGESTING one is always available: GET /api/sites/{siteId}/apps lists what this store ' +
        'can install, and GET /oauth/authorize-info?client_id=… answers with the app, its ' +
        'publisher, its privacy policy, the SCOPES it would hold and whether it is paid. Show ' +
        'that to whoever is accountable for it. INSTALLING is POST /oauth/authorize with ' +
        '{siteId, clientId, versionId, redirectUri, scopes} — it needs a SESSION ' +
        '(SB_EMAIL/SB_PASSWORD), because an agent key is not an access token and the platform ' +
        'refuses it by design: the app holds scopes against the store. A FREE app installs with ' +
        'no acceptedPrice; a PAID one is refused without it rather than having a price assumed ' +
        'on the merchant\'s behalf, so never send one they have not seen. Then read ' +
        '/apps/blocks again for what it contributed.',
    };
  }

  // FILLING A CATALOGUE WAS REACHABLE AND FIVE FACTS ABOUT IT WERE NOT, each
  // failing silently. Attached to the call sheet for the same reason the
  // translation table is: this is where the agent is when it decides what to
  // send, on both credential surfaces a product can be created or replaced on.
  if (PRODUCT_WRITE_IDS.has(op.id)) {
    out.product_traps = {
      price:
        'Price lives on the VARIANT, not the product — variants[].priceCents. A product ' +
        'posted with no variant renders a catalogue entry nobody can buy.',
      // MINOR UNITS, SAID WHERE THE NUMBER IS BEING WRITTEN.
      //
      // The fact was already in the codebase — `readiness.ts` carries it twice —
      // but only as the FIX on a store gap that fires when the catalogue is
      // EMPTY or has no priced product. The moment an agent creates products the
      // gap clears, so the sentence is on screen exactly while it cannot be
      // acted on and gone the moment it could be.
      //
      // MEASURED: a whole storefront built with every price 100× low. Cherry at
      // "8.500 ₫", a 3.2M gift basket at "32.000 ₫" — read back through the
      // renderer, published, and only caught because the numbers looked absurd
      // to a human. Nothing refused them: `priceCents` takes any integer, and a
      // store whose every price is wrong by the same factor looks internally
      // consistent.
      units:
        'priceCents is MINOR UNITS — the storefront divides by 100, so VND 280.000 is ' +
        "28000000. Same for compareAtCents, costCents and a shipping method's feeCents. " +
        'Nothing refuses a wrong one, and every price wrong by the same factor looks ' +
        'deliberate. Write one, read the rendered price, then write the rest.',
      // THE PICKER A PRODUCT GETS WHEN NOBODY DECLARED ITS OPTIONS.
      //
      // `variants[].options` alone is not enough: the buy box reads
      // `attributes` for the control, and a product with variants but no
      // attributes renders the ELEMENT'S SEED — "Color: Red / Green / Blue",
      // "Size: S / M / L" — on a real product page, published.
      //
      // MEASURED on a fruit-gift store: every one of 19 products offered Color
      // and Size until attributes were added.
      attributes:
        'The variant picker comes from product.attributes — [{ name, values[] }] — not ' +
        "from variants[].options alone. Variants without attributes render the element's " +
        'seed ("Color: Red / Green / Blue") on the published page. Declare attributes, and ' +
        "match each variant's options keys to them.",
      slug:
        'A colliding slug is RENAMED, not refused, and the write still answers 200/201. ' +
        'Re-running an import does not error — it DOUBLES the catalogue in silence.',
      images:
        'POST /api/media/{siteId}/from-url ingests a photo straight from its URL, one hop ' +
        'instead of downloading and re-uploading it.',
    };
  }

  const shape = REQUEST_SHAPES[op.id];
  if (shape) {
    out.body_shape = shape;
    return out;
  }

  // Said BEFORE the body branches, because the whole point is not to inline a
  // definition for a body this route does not take.
  const copiedFrom = copiedBodyDonor(op.id);
  if (copiedFrom) {
    out.body_note =
      `The document declares a request body here, and it is a VERBATIM copy of ${copiedFrom}'s ` +
      '— one doc comment over several @Router lines gives every route in the block the same ' +
      '@Param. Send no body; the schema is that other route\'s.';
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
  /** The summary describes several routes at once — read the path, not it. */
  summary_shared?: true;
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
    params: visibleParams(op).map((p) => (p.required ? p.name : `?${p.name}`)),
  };
  // ONE BOOLEAN, because this line is where the CHOICE is made and a search hit
  // must stay a line. It says only "this sentence was written for a group of
  // routes, so read the path"; the call sheet names the group.
  if (summaryIsShared(op.id)) out.summary_shared = true;
  // A copied body is not this route's, so the line says nothing rather than
  // `described` — see `copiedBodyDonor`.
  // The handler's own decode outranks the document, as it does on the call sheet;
  // without this the line said `undescribed` for a body the sheet then described.
  if (REQUEST_SHAPES[op.id]) out.body = 'described';
  else if (hasBody && !copiedBodyDonor(op.id))
    out.body = op.bodyDescribed && op.bodyRef ? 'described' : 'undescribed';
  else if (isWrite) out.body = 'none_declared';
  return out;
}
