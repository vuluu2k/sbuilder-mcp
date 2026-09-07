# CLAUDE.md — `sbuilder-mcp`

Guidance for Claude Code when working in this repository.

## What this is

An MCP **stdio** server that lets an AI agent operate a Store Builder site end to end —
design its pages, fill them with real data, look at the result, and publish it — with no
human clicking anything.

It is **not** a renderer. Every pixel comes from the platform's Go renderer; this server
only ever holds the document and the screenshots.

Published to npm as `sbuilder-mcp`, binary `sb-mcp`. Runs via `npx -y sbuilder-mcp`.

Design spec: `docs/superpowers/specs/2026-08-27-sbuilder-mcp-design.md`. Read it before
changing anything structural — it records *why* each boundary is where it is.

## Commands

```bash
npm run build     # tsc -> dist/
npm test          # vitest run
npm run smoke     # offline self-test; MUST print "ALL GOOD"
npm run codegen   # WB_REPO=/path/to/web_builder npm run codegen
npm start         # node dist/index.js (stdio server)
```

**The gate for every change is `npm run build && npm test && npm run smoke`.**
`prepublishOnly` runs build + smoke, so a broken smoke blocks publishing.

## Releasing

A push to `main` that touches `src/**` releases on its own through
`.github/workflows/auto-release.yml`: the gate (build, test, smoke), a bump read off the
commit subject (`feat` → minor, `BREAKING CHANGE` or `!` → major, else patch; a
`workflow_dispatch` run picks its own), a bilingual changelog entry written by Claude,
`server.json` synced, a `chore(release): vX.Y.Z` commit plus tag, then npm publish, a GitHub
Release, and the MCP Registry through GitHub OIDC. Secrets, in the `prod` environment:
`NPM_ACCESS_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN`; the registry step needs none. The
workflow skips a head commit whose subject contains `chore(release):` or `release: v`, so a
release never triggers a second one. `npm run release` (`scripts/release.mjs`) is the
offline path — no CI, or a secret mid-rotation — and it MUST keep writing the same
`## [x.y.z] - date` heading and the same commit subject, because the workflow prepends above
the first `## [` line and matches the subject as its skip guard.

Three things the first live release cost, so nobody pays them twice:

- **`gh workflow run` starts TWO runs**, observed both times it was used here. The second
  queues behind the `auto-release` concurrency group and would release again after the
  first. Cancel it — and read each run's dispatch inputs before cancelling either, because
  they are not interchangeable: choosing by status alone released a patch when the run
  carrying `bump=minor` was the one cancelled.
- **`NPM_ACCESS_TOKEN` must be an npm AUTOMATION token** (or a granular token with read and
  write). A classic "publish" token still demands an OTP, and CI answers `EOTP` after the
  tag is already pushed.
- **Never re-run a failed release run.** It replays the OLD commit, whose `package.json`
  predates the release commit, so it bumps again. Dispatch a fresh run on `main` instead:
  resume mode sees the pushed tag and the missing npm version and publishes that version.

## Invariants — do not wait for a review to be told these

- **Node ≥22**, because this repo uses the GLOBAL `WebSocket`, unflagged from 22. The
  alternative was a `ws` dependency for a runtime the platform's own dev stack already
  exceeds; a stated version floor is the cheaper cost.
- **`playwright-core` + `channel: 'chrome'`** — the system browser, so `npm install`
  downloads nothing. A missing Chrome is reported by name, never degraded to a blank image.
- **Package `sbuilder-mcp`, bin `sb-mcp`, server name `sbuilder`.** Never the internal
  `@webbuilder/*` scope: that scope is private to the platform monorepo and an npm name is
  effectively permanent once taken.
- **stdout is the MCP channel.** Every log line is `console.error`. One stray `console.log`
  corrupts the protocol for every client.
- **ESM / Node16.** Every relative import ends in `.js`, including from a `.ts` source.
- **Secrets come from env only** — `SB_API`, `SB_TOKEN`, `SB_EMAIL`, `SB_PASSWORD`. This
  repo is public. No secret reaches a file, a log, or a tool result.
- **Every tool answers through `text()`** (or `image()`/`images()`) from `src/mcp/response.ts`.
  A hand-built content array is the shape that drifts.
- **Mutating tools take `dry_run` and default it to `true`**, returning a request preview
  passed through `redact()`.
- **An element's default BINDINGS come from codegen, and `createNode` seeds them.** They are
  a function of `config.datasetSource` + `config.kind`, so `sb_set` re-derives them from the
  generated table when either moves. A dataset element without them renders its placeholder
  forever, saving and publishing all the way.
- **Every result is compact JSON, and every directive is said once per process through
  `ctx.notices`**; a tool that repeats a notice on every call is the shape that drifts.
  `test/token-budget.test.ts` is the scale — a diet without one comes back.
- **Credential routing is by path prefix**, in `src/transport/credential.ts`, and is not
  negotiable: `/api/v1/…` → `SB_TOKEN`; everything else is `siteScoped` — it takes EITHER
  credential and prefers the key, because a key is narrower (revocable on its own, scoped,
  bound to one store) while a session carries the whole account. The OpenAPI
  document declares one `BearerAuth` scheme for both, so it *cannot* make this call, and
  the platform refuses each credential on the other's surface.
- **`src/catalog/api.generated.ts` is generated and committed.** Never hand-edit it;
  regenerate with `npm run codegen`. It is committed so `npm install` needs no
  `web_builder` checkout.

## The platform facts that shaped this code

Each of these cost real investigation. Do not re-derive them, and do not "fix" the code
that accounts for them.

- **The OpenAPI document holds 278 paths / 412 operations / 97 definitions, and no
  `operationId`.** Ids are synthesized as `method:path`; the generator asserts uniqueness.
  (423 is the count of *tag assignments* — an operation with two tags is counted twice.)
- **Bodies are under-described in two different ways.** 62 of 168 body-carrying operations
  declare a body with no `$ref`; 95 of 180 write operations declare no body *at all*, and
  that second group mixes genuine action endpoints (`POST /orgs/{id}/leave`) with missing
  annotations (`PUT /pages/{id}/source` carries a whole page document). `describeOperation`
  gives the two cases different words on purpose — saying "no body" for the second would
  have a model send an empty PUT and wipe a page.
- **The session access token lives ~15 minutes and rotates.** `Session.token()` is a
  GETTER and every consumer must call it per use. A client that captures the string
  replays an expired token forever, and the failure is silent — a rejected socket auth
  still fires `onopen`.
- **The platform writes exactly one error shape**, `{"error", "code"}`, never plain text.
  `code` is the branchable half; reading `statusText` throws it away. Two documented
  supersets exist — `details` (`WriteErrorCodeDetails`) and `fields` (`fielderrors.go`, with
  `code: "validation"`) — and `ApiError` carries both when present.
- **`PUT /pages/{id}/source` takes `{ document, schemaVersion }`**, not `{ document }`. The
  OpenAPI document declares no body for it at all, so the shape was read off the editor's
  own `saveSource` (`editor/src/features/pages/api.ts:115`), including its
  `schema_version ?? 1` fallback. Copy the working client; never guess a body.
- **The element registry holds 106 types, and `getElementAI` covers 106/106.** The
  directory has more entries than that because the loose `.ts` files beside the elements
  are not elements. 77 binding sources, read from BOTH renderers — the Go scope and the
  editor's own binding context, which carries keys the Go side never spells out
  (`product.moneyOverride`, `site.*`, `course.*`). Reading one alone made `sb_review` call
  the platform's own seeded pricing binding dead on every page that showed a price.
- **A plain `image` inside a repeater can never show a product photo.** Its renderer reads
  `specials.src` — what the DOCUMENT holds — so every card gets the same picture. Only the
  elements whose renderer reads a `bound…` special can show a record; that list is generated
  (`BOUND_SPECIALS`, read from `server/render/nodes/*/html.go`) rather than hand-kept, and
  `sb_review` reports the mistake as `static_in_dataset` with the element swap as the fix.
  A live storefront shipped with six identical placeholder cards before this check existed.
- **`rootId` is the app-block key for the same idea `root_node_id` names in a page.** A page
  document carrying it renders an EMPTY `<body>` with a 200 — the order-complete page of a
  real store did exactly that. `PageDoc.from` adopts the alias, drops it, and `sb_page_open`
  reports `blank_page_repair`, so one save fixes the page.
- **The wire caps frames by KIND.** `ops` and `snap` may reach 4 MiB; EVERY other kind is
  capped at 64 KiB, and exceeding it CLOSES the socket (`StatusMessageTooBig`) rather than
  rejecting one frame. Split a large batch.
- **An `ops` frame with an empty `pageId` or empty `ops[]` is dropped SILENTLY** by the
  server (a bare `continue`), so sending one is indistinguishable from success. `publish`
  guards both.
- **`applyBindings` honours only the `specials` namespace.** A binding whose `field` names
  any other namespace is stored, saved, published, and ignored forever.
- **Store readiness lives ONLY in the editor.** `editor/src/editor/storeReadiness.ts` computes
  five gaps between a site and a paid order — no checkout page, no live gateway, no published
  product template, no delivery option, nothing that opens the cart — and no API exposes any
  of it. `src/domains/site/readiness.ts` mirrors the table and `sb_review` reports it, SILENT
  on any input it could not fetch. A storefront built entirely through these tools reviewed
  clean and the editor then listed all five.
- **A composed stamp is not a reference.** `globalId` / `appBlockId` are what the server
  writes when it composes a shared subtree onto a page; the document stores `globalRef` /
  `appBlockRef`. Authoring the composed one makes the next save decompose that node OVER the
  master and empties it for every page carrying it — four pages went blank before `sb_add`
  and `sb_set` learned to refuse it.
- **`DOC_SCHEMA_VERSION` is 2** and lives in `editor/src/theme/legacyScopes.ts`, not in the
  schema package. Codegen reads it with a regex — importing an editor module would drag Vue
  into a build script for one integer.
- **A real document carries SATELLITE nodes, attached by `parent` alone.** `list-empty`,
  `list-loading`, `quantity-button`, `quantity-input`, `product-variant-label` and their
  contents set `parent` to their owner and are deliberately absent from that owner's
  `data.nodes`. Measured on a live page: 55 nodes, 16 of them satellites. So "every node is
  reachable from ROOT through child lists" is FALSE of documents the platform itself serves,
  and `validateForSave` checks ATTACHMENT — reachable, or hanging off something reachable —
  not reachability. The two stricter rules that used to live there refused every save of
  every real page, and only a live run could show it.
- **A SATELLITE hangs off `config[key]`, and the editor mints it on ADD.** Eight elements own
  one — `accordion`, `tab`, `menu`, `list-dataset`, `dataset-block`, `cart-order`,
  `product-variants`, `quantity-dataset`. The table is generated from the element METAS
  (`SATELLITE_RULES`), never from Go's `SatelliteConfigKeys`, because only the metas carry
  `optional` — and `list-loading` is the single opt-in satellite in the platform, because a
  list with no loading design shows a silhouette of its own cards. `schema_gen.go:245` states
  the walk contract outright: subtree collection, copy and delete must consult the table.
  `createNode` mints them, `walk` follows them, and `duplicateNode` deep-copies them with the
  owner's pointer rewritten — before which a duplicated accordion pointed at the ORIGINAL's
  skin. Three list-empty owners are born as a SUBTREE, not a bare node, so the empty state is
  generated per dataset source from the editor's own `buildEmptyStateTree`.

- **`ELEMENT_SEEDS` is content an element is not USABLE without.** A `dropdown` without its
  trigger and panel is "a bare relative box"; a `select` renders INTO those two nodes.
  Generated from `editor/src/element/seeds.ts`. Both that module and `emptyState.ts` import
  only `@webbuilder/schema`, so codegen imports them directly — unlike `legacyScopes.ts`,
  which is still read by regex because importing it would drag Vue into a build script.

- **`list-dataset` clones `Data.Nodes[0]` and drops every sibling** (`html.go:60`). It is the
  ONLY renderer that does, which is why `FIRST_CHILD_ONLY` is generated: `dataset-block` is a
  dataset container too and renders ALL of its children, so the obvious
  `isContainer && category === 'dataset'` predicate restricts the wrong element.

- **`GET .../source` returns compose `warnings`, and one of them is destructive.**
  `globalMissing` means the server could not find the master and `delete`d the reference from
  the composed document it handed back (`compose.go:118`), so the page opens with the section
  already gone and the next save stores that loss permanently. The field was typed on the
  response and read by nothing for three phases.

- **Publish SKIPS a page with no saved draft and still answers 200** (`service.go:650`, a bare
  `continue`), and a published row carries the whole rendered page — `document`, `html`, `css`
  — for every page the cascade touched. So `sb_publish` asserts the page came back, and
  projects the rows.

- **A colliding page slug is RENAMED, not refused.** `uniqueSlug` suffixes `-1`, `-2`, … and
  its own comment says it "never errors" (`service.go:877`). `ErrSlugConflict` exists and maps
  to 409; this path never reaches it. The create answers 200 carrying a slug the caller never
  asked for, and every link authored to the requested one is dead.

- **The OpenAPI document is not a complete map of the platform**, and `sb_api_call` is a
  CLOSED LIST (`src/tools/api.ts:191`), so what it omits is UNREACHABLE. 34 operations carry
  `@Router` annotations and are missing from the checked-in `swagger.json` (`swag init` has not
  been re-run; `npm run codegen` CANNOT recover them — it reads that same file, and a no-diff
  run is the evidence, not the all-clear). A further 41 merchant-facing routes carry no
  annotation at all and are findable only through the route-map comment blocks in each
  `internal/*/rest/*.go` — among them payment-gateway config, which is the fix for
  `sb_review`'s own `payment` gap, and the whole `pages/{pageId}` cluster: no page metadata
  read, no SEO, no delete, and none of the five version/history/restore routes. See
  `docs/superpowers/specs/2026-09-07-phase-7-drop-time-and-signals-design.md`.

- **`/api/media/{siteId}` takes a session JWT only.** It is mounted behind `RequireAuth`,
  not the `RequireAuthOrDefer` that lets a `wbk_` key open `/api/sites`. So `sb_media_upload`
  — the one tool `sb_api_call` cannot replace, because the body is multipart — does not work
  on a key-only install, which is the install the store's Agent app hands out.
  `src/transport/media.ts` says that in as many words rather than passing on `unauthorized`.

## The five traps

Each fails SILENTLY. Each is encoded in `src/domains/site/traps.ts` (trap 5 in
`src/core/tree.ts` and `src/domains/site/builder.ts`) with its own test, because this
platform treats an unproven guard as indistinguishable from an absent one.

1. **Site overlays** — the cart drawer and pop-ups are composed onto ROOT on read and
   stripped on write. Stamped `specials.overlayId`, and only a DIRECT child of ROOT may be
   one. `pageChildren()` is the walk every ROOT-level rule must use; `childrenOf()` on the
   root is the mistake that reads correctly and behaves wrongly.
2. **Global sections** — stamped `specials.globalId`/`globalKind`; shared masters. Editing
   one changes every page carrying it, and publish cascades. Results say so.
3. **Band order** — ROOT's children must read `[header*][middle*][footer*]`. The platform
   refuses EVERY save otherwise (`checkBands`, `server/internal/page/decompose.go`). It
   strips overlays before checking, which is why the rule needs no overlay exception — and
   why ours strips them too.
4. **Responsive by default, not by refusal.** `setKeys` writes per breakpoint because a
   design should respond — but base is legitimate and is NOT a trap. This entry used to say
   a base value "vanishes on publish" and `setKeys` threw for one; both were wrong, and the
   correction is worth keeping because the misreading is easy to repeat.

   The platform's mandate ("if a key CAN be responsive it MUST be") is about ELEMENT
   IMPLEMENTATION: an element whose Go renderer reads `n.Config[...]` directly — `nodes.ConfigInt`
   in `html.go`, an SVG `width=` attribute — bypasses the cascade, so a per-breakpoint value the
   author sets renders on the canvas and never reaches publish. Nothing a DOCUMENT stores can
   cause that. `server/render/style/cascade.go`'s MergeNamespace resolves a key
   *current slot → wider slots → BASE → narrower slots*, so base is the fallback layer, and
   every element's `meta.defaults.style` is seeded straight into it.
5. **App blocks** — a marketplace app's subtree. The document stores ONE reference node
   stamped `specials.appBlockRef`; on read the platform composes the app's markup under it
   and stamps the block root `appBlockId`; on save `DecomposeAppBlocks`
   (`server/internal/page/globalservice.go:56`, after overlays, before `Decompose`) reduces
   the subtree back to the reference, so an edit inside is stored nowhere and reported
   nowhere. `appBlockRoot()` in `src/core/tree.ts` finds the nearest stamped self-or-ancestor;
   every write refuses a strict descendant through `refuseAppBlockInterior` (and `sb_add` /
   `sb_move` refuse the root as a destination), the outline flags the root `app: true`, and
   `sb_review` skips the interior. Tested in `test/traps.test.ts`.

## The yield rule

The live-edit client is NEVER the authority on a document. It does not answer `snapreq` for
anyone and publishes no convergence checkpoint of its own. On any evidence of divergence —
a gap in `seq`, a checkpoint at its own seq, a rejected save — it discards its copy,
re-pulls, and makes the next save FAIL LOUDLY so the caller re-reads and reapplies.

This is what lets `src/live/session.ts` be one small class instead of the editor's outbox
deferral plus inbox arbitration plus "who pulls" tie-break — roughly a thousand lines whose
entire purpose is arbitrating between two EQUALLY authoritative editors. Alone in the room
the agent is the sole writer and the rule costs nothing, so it is a mode rather than a
permanent sacrifice. Do not "fix" it by making this client answer snapshots.

A tool that writes must go through `PageSession.applyAndPublish`, never `doc.apply`
directly — otherwise the local document is right, the save is right, and only the humans
watching see nothing happen.

## Adding a tool

1. Put it in a group under `src/tools/*.ts`, registered via `server.registerTool(...)` with
   MCP annotations (`readOnlyHint` for a read; `destructiveHint` where a write destroys).
2. Return through `text()`. Take `dry_run` if it writes. Say a directive through
   `ctx.notices.once(...)`, never inline.
3. Register the group in `src/server.ts`.
4. Add a test under `test/`.
5. Document it in `docs/tools.md` **and** `docs/tools.vi.md`, and in both READMEs' table.
6. Run the gate.

The `sbuilder-mcp-tools` skill in `.claude/skills/` carries the same rules in the form the
agent reads at the moment it starts the work. Specialist subagents in `.claude/agents/`
enforce them: **mcp-tool-author** (add or modify a tool) and **mcp-verifier** (run the gate
and check conventions; never edits).

## Phases

All three phases are shipped, and their plans live in `docs/superpowers/plans/`:
auth and full API reach; the element catalog, patch core, four traps, document, builder,
validation and page tools; the live-edit socket, the yield rule, the vision loop and
`sb_bind`. Twenty-five tools reach 412 API operations. The 2026-09-07 token diet plan in
`docs/superpowers/plans/` (compact results, once-per-process notices, the `sb_api_find`
call sheet, trap 5, auto-release) is shipped too, and `test/token-budget.test.ts` holds its
ceilings.

`SB_BROWSER_TEST=1 npm test` adds the one test that launches Chrome. Run it after touching
`src/vision/**` — the default suite skips it, and a skip that reads as green is the failure
this repo keeps closing.

Phase 7 (2026-09-07) closed ten silent failures reachable through this server's OWN tools —
the drop-time contract (satellites and seeded content), the satellite-aware walk and the two
`sb_duplicate` defects it exposed, the compose warnings / publish skip / slug rename this
client received and discarded, and three render rules a valid document can break. It added no
tools. Its spec also records the two axes it deliberately did NOT take, so the measurements
are not re-derived: REACH (75 operations unreachable, see the OpenAPI bullet above) and
CAPABILITY (only 45 of 180 write operations declare a body; `PUT /settings` is a
whole-document replace, so a partial body erases the store's configuration).

Deferred with the seam left open: `expand`/`compact` sparse authoring (`createNode` already
seeds from `meta.defaults`, so the write-path win is banked; the read-path inverse waits for
a measured need) and `sb_bind`, which belongs with Phase 3's binding work.
