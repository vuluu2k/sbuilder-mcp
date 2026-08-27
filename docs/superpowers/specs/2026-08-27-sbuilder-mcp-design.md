# `@sbuilder/mcp` — design

Date: 2026-08-27 · Status: approved, pre-implementation

## 1. What this is

An MCP **stdio** server that lets an AI agent operate a Store Builder site end to end —
design its pages, fill them with real data, look at the result, and publish it — with no
human clicking anything.

Two sentences of scope, because the difference matters:

- It **designs**: it holds a page's node document, edits it through the same patch protocol
  the editor's own tabs use, broadcasts those edits over the live-edit socket so anyone
  watching sees the page assemble, and autosaves through the same endpoint the editor does.
- It **operates**: products, media, menus, theme, fonts, forms, blog, translations,
  discounts, domains, overlays, settings, publish — the whole merchant surface, reached
  through a generated index of the platform's own OpenAPI document.

It is not a renderer. Every pixel it produces comes from the platform's Go renderer; the
server only ever sees the document and the screenshots.

## 2. The one decision everything else follows from

**The platform already publishes two generated, drift-tested artifacts that together
describe everything this server needs to know.**

| Input (in the `web_builder` checkout) | What it yields |
| --- | --- |
| `server/docs/swagger.json` | 205 paths / 320 operations / 85 definitions — route, method, parameters, response shape, auth requirement, for the entire private + public API |
| `schema/src/elements/**` (95 elements, each with `meta.ts` + `ai.ts`) | the element catalog: traits, defaults, and the `useWhen` / `avoidWhen` / `contentTips` / `semantics` hints written for exactly this purpose |

Both are already committed and already guarded in that repo (`npm run docs:api` regenerates
the first; the schema has its own drift tests). So this repo **vendors no code**. A build
step reads those two files out of a checkout and emits `src/catalog/generated.ts`.

That is what makes a separate repository the right call rather than a compromise: the
coupling is to two data files with a maintained contract, not to a moving codebase.

## 3. Two credentials, structurally required

Not a preference — the platform refuses each credential on the other's surface.

| Credential | Reaches | Proof |
| --- | --- | --- |
| API key `wbk_…` (or app token `wba_…`) | `/api/v1` — products, orders, customers, pages metadata, media, blog, webhooks | `PUBLIC_API.md` §2: *"A user's access token is still refused… Sending one answers `401 api_key_required`"* |
| User session JWT (`POST /api/auth/login` → `tokens`) | everything under `/api/sites/{siteId}/…`, and the live-edit socket | `realtimeAuth.Authorize` calls `auth.Service.Authenticate`, which parses an access token; an API key is not one |

Consequences the implementation must respect:

- The session access token is short-lived (~15 min) and rotates. It must be read through a
  **getter per use**, never captured once — this is a bug the editor already shipped and
  fixed (`editor/src/features/realtime/socket.ts`, MF1): a socket holding the string it was
  constructed with replays an expired token on every reconnect.
- The socket sends **no `Origin` header** from Node, which the origin gate explicitly
  permits (*"reachable by curl/tests (no Origin header)"*). No operator env change needed.

Config: `SB_API` (base URL), `SB_TOKEN` (`wbk_…`), `SB_EMAIL` + `SB_PASSWORD` (session).
Env names carry the product's initials, matching `@sbuilder/cli`'s `SB_TOKEN` / `SB_API`.
Secrets come from env only; the repo is public.

## 4. Architecture

```
sbuilder-mcp/
  bin/sb-mcp.ts               stdio entry
  src/
    server.ts                 tool registration
    mcp/response.ts           text() helper — the one way a tool answers
    core/                     domain-agnostic
      patch.ts                Patch shape + apply + isSyncablePatch (mirror)
      tree.ts                 node-map walking, ROOT rules
      expand.ts / compact.ts  sparse authoring <-> full document
    domains/site/
      document.ts             PageDocument in memory
      builder.ts              design intent -> valid patches
      ids.ts                  node id minting (schema prefix table)
      traps.ts                overlays / globals / responsive rules
      validate.ts             structural + semantic checks before a write
    transport/
      auth.ts                 login, refresh, token getter
      v1.ts                   /api/v1 + wbk_
      private.ts              /api/sites/{id}/... + session
      socket.ts               /api/realtime/ws?site=<id> + session
    live/
      session.ts              join, snapshot handshake, seq/ack, remote ops
      presence.ts             cursor / select frames, pacing
      autosave.ts             debounced PUT /pages/{id}/source
    vision/
      preview.ts              mint preview link
      shoot.ts                Playwright screenshots + [data-node-id] boxes
    catalog/generated.ts      <- codegen output (elements + API index)
    tools/*.ts                tool groups
  scripts/gen-catalog.ts      reads WB_REPO, emits catalog/generated.ts
```

`src/core/` knows nothing about Store Builder. Everything else does: `domains/site/` holds
the model and its rules, and `transport/` · `live/` · `vision/` are its adapters, kept at
the top level because they are I/O rather than domain logic. Tools depend only on the
domain seam and never reach past it into an adapter. This mirrors
`webcake-landing-mcp`'s core/domain split, which exists so a second output target can be
added later without rewiring.

## 5. The document core

### 5.1 Patch protocol

The editor's live-edit channel carries batches of patches over paths into the node map:

```ts
type Path  = (string | number)[];
type Patch =
  | { op: 'set';    path: Path; value: unknown }
  | { op: 'unset';  path: Path }
  | { op: 'insert'; path: Path; index: number; value: unknown }
  | { op: 'remove'; path: Path; index: number };
```

`core/patch.ts` mirrors this **and its admission rules**, which are a security boundary,
not a formality (`editor/src/features/liveedit/ops.ts`):

- path must start `['nodes', <id>]` and be at least 2 segments — a bare `['nodes']` write
  replaces the entire document in one frame;
- no segment may stringify to `__proto__`, `constructor`, or `prototype` — compared after
  `` `${seg}` ``, because a segment shaped `['__proto__']` stringifies to `'__proto__'` and
  sails past a `typeof === 'string'` guard;
- `insert`/`remove` indices must be non-negative integers — a negative index splices from
  the end, writing into a parent the sender never named.

### 5.2 What is deliberately NOT ported

`editor/src/features/liveedit/` also contains an outbox with per-path deferral, an inbox
with gap detection, and a convergence checkpoint with a "who pulls" tie-break. All of that
exists to arbitrate between **two equally authoritative editors**. This server takes a
weaker and simpler position:

> **Yield rule.** When a human peer is in the room, the agent is never the authority. It
> does not answer `snapreq` for anyone. On any evidence of divergence — a gap in `seq`, a
> checkpoint mismatch, a rejected `PUT /source` — it discards its copy, re-pulls from the
> room or from `/source`, and replays whatever intent was still outstanding.

When the agent is **alone in the room** — the ordinary case for "operate the site with only
the MCP" — it is the sole writer and the rule costs nothing. So this is a mode, not a
permanent sacrifice.

What must be ported: the patch shape and its admission rules, `seq`/`ack` accounting, and
the *asking* half of the snapshot handshake.

### 5.3 Sparse authoring

Carried over from `webcake-landing-mcp`: the model writes a **sparse** node and
`core/expand.ts` merges it onto the element's `meta.defaults` seed, recursively for
children. `core/compact.ts` is the exact inverse, so reads come back in the same sparse
shape writes go out in. The invariant `expand(compact(x)) ≡ expand(x)` is a gate test.

This roughly halves the JSON per element, which is the difference between one tool call per
section and one per node.

## 6. The three traps

The scope "operate the whole site" drags in three rules that the page-only scope did not.
All three fail **silently**, which this platform treats as the worst available outcome. Each
is encoded in `domains/site/traps.ts` with its own test, not written down in a README.

1. **Overlays are not in the page document.** The cart drawer and pop-ups live in
   `site_overlays`, are composed onto ROOT on read and stripped back out on write. Any walk
   over ROOT's children must exclude them. A builder that does not know this corrupts pages
   with nothing on screen and nothing in the network log to say so.
2. **Global sections are shared masters.** Editing a header once changes every page that
   carries it, and `publish` **cascades** to those pages — a header edited once must not go
   live on one page and stay stale on the rest. Any tool touching a global says so in its
   result.
3. **The responsive mandate.** *If a key CAN be responsive, it MUST be.* A visual quantity
   baked in base-only renders correctly on the canvas and **vanishes on publish**. So
   `sb_set` writes **per-breakpoint by default**; writing base requires saying so explicitly.
   Only identity and content (`specials`, `htmlTag`, `kind`) legitimately live at base.

## 7. Tool surface — two tiers, ~18 tools

320 operations cannot be 320 tools. The split:

### Tier 1 — hand-written (16)

For everything the OpenAPI document cannot describe: the page document (`PUT /source`'s
body is `additionalProperties: true` in the spec), the `ai.ts` hints (in no API at all), the
socket (a raw route, absent from the spec), and the vision loop (not HTTP).

```
Session   sb_connect · sb_site_list · sb_site_create · sb_page_list
          sb_page_open · sb_page_create
Read      sb_outline · sb_node_read · sb_catalog_search · sb_traits_for
Write     sb_add · sb_set · sb_move · sb_remove · sb_bind
See       sb_look
```

### Tier 2 — generated reach (2)

`sb_api_find` (describe an intent → matching operations with their real parameter schemas)
and `sb_api_call` (execute one). This is the pattern the Claude Code harness itself uses
for deferred tools: keep the list short, fetch the schema on demand. Every one of the 320
operations is reachable, and operations added to the platform later arrive with the next
codegen run.

**Two limitations, measured rather than guessed:**

- **58 of the 140 body-carrying operations have an opaque body** — no `$ref`, just a loose
  object (`PUT /pages/{id}/source` among them). The other 82 resolve to a real definition.
  `sb_api_find` returns the opaque ones with an explicit "body not described" flag rather
  than letting the agent trust a schema that says nothing.
- **The spec cannot route credentials.** It declares exactly one scheme, `BearerAuth`, for
  both the API key and the session JWT — 212 operations carry it and 92 carry none. So the
  credential is chosen by **path prefix**, encoded in this repo and tested: `/api/v1/…` →
  `SB_TOKEN` (`wbk_`), everything else → the session JWT. Sending the wrong one is not a
  soft failure; `/api/v1` answers `401 api_key_required`.

There are also **no `operationId`s** in the document, so the index synthesizes stable ids
from method + path (`get:/api/sites/{siteId}/menus`). The generator asserts they are unique.

### Conventions every tool follows

- Answers go through `text()` (`src/mcp/response.ts`); **stdout is the MCP channel**, so
  logging is `console.error` only.
- Mutating tools accept `dry_run`, and a dry run returns a credential-redacted preview of
  the request it would have made.
- `sb_outline` returns a compressed tree (id · type · name · child count), never a document
  dump — a real page is hundreds of KB.
- `sb_add` accepts nested subtrees and `sb_set` accepts many nodes × many keys per call, so
  a hero section is one call rather than forty.
- Every write returns the new revision, so an interrupted agent can resume.

## 8. Vision loop

`sb_look`: autosave → mint a preview token (`internal/previewtoken`) → open `/_wb/preview`
in Playwright → screenshot at desktop / tablet / mobile → return images **plus the real
bounding box of every `[data-node-id]`**.

The bounding boxes are not a bonus. `EvCursor` carries **layout pixels, not screen pixels**
— the canvas is zoomed per viewer, so screen coordinates land somewhere else on a peer with
a different window width. Without a real box, an agent cursor is a random number. With one,
the agent's cursor moves to the thing it is about to edit, and presence is honest rather
than theatrical.

## 9. Anti-drift

Three tripwires, because the source repo **does not type-check** — `vue-tsc` is banned
there, CI runs `vite build` only, and its own `CLAUDE.md` states plainly that *"TypeScript
will catch it" is never a safety argument*. Everything must fail at runtime or in a test.

1. **Version stamp.** The generated catalog records the `schema_version` it was built from.
   `sb_connect` compares it against the `schema_version` on a document the server returns
   and reports a mismatch **loudly in the tool result**.
2. **Unknown element.** A `type` absent from the catalog makes the server say "catalog is
   stale", never guess.
3. **Patch-shape golden test.** Fixtures copied from `editor/test` at codegen time, asserted
   against `core/patch.ts`.

## 10. Gates

- `npm run build` — tsc → `dist/`, plus copying runtime JSON assets.
- `npm run smoke` — offline self-test of the builder, expander, validator, and every catalog
  example. Must end `ALL GOOD`. `prepublishOnly` runs `build && smoke`.
- `npm test` — vitest units against a fake REST + fake WS in process (the editor's own
  `WebSocketLike` seam is the precedent for testing a socket with no network).
- Opt-in e2e behind an env flag, against a real `npm run stack:hot`.

## 11. Non-goals

- Rendering. The Go renderer is the only renderer.
- Driving the editor's UI in a browser. Considered and rejected: dozens of times slower,
  breaks on every UI change, and non-deterministic for a 40-element page.
- Editing the `web_builder` repo. This server consumes its published artifacts and its HTTP
  surface; it changes neither.
- Being authoritative during co-editing. See the yield rule (§5.2).

## 12. Deferred, with the seam left open

- A second output target behind the `Domain` seam (the `core/` split exists for this).
- Remote Streamable-HTTP transport alongside stdio, as `webcake-landing-mcp` does.
- Answering `snapreq` — would require the full inbox/outbox arbitration of §5.2.
