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
npm run codegen:check  # same, but writes nothing and exits 1 if the catalog is stale
npm start         # node dist/index.js (stdio server)
```

**The gate for every change is `npm run build && npm test && npm run smoke`.**
`prepublishOnly` runs build + smoke, so a broken smoke blocks publishing.

### Dogfooding this server on this repo

`npx -y sbuilder-mcp` **cannot start when the cwd IS this repo**, and the failure looks like
a broken install rather than a cwd problem:

```
sh: sb-mcp: command not found     → the MCP client reports CONNECTION_CLOSED
```

npx sees a `package.json` whose name is `sbuilder-mcp`, decides the package is the local
project, reads `bin` off it and execs `sb-mcp` — which is not in this repo's
`node_modules/.bin`, because a package is not installed into itself. Nothing is wrong with
the published package: the same command works from any other directory.

Restore it — and get the LOCAL build served to the agent, which is what dogfooding wants:

```bash
ln -sf ../../dist/index.js node_modules/.bin/sb-mcp && chmod +x dist/index.js
```

`node_modules/` is not tracked, so **`npm ci` removes this and the server stops connecting
again**. The exec bit survives `tsc`, so after the first setup a plain `npm run build` is
enough for an edit to reach the agent — followed by a reconnect in the MCP client, which
does not re-read a running server.

### Is the catalog still current?

`npm run codegen` is a MANUAL step, so the catalog goes stale in SILENCE — and the platform
moves fast enough that this is the normal state, not the exception. Measured in one
afternoon: 107 → 108 elements and 484 → 486 operations while this repo sat still.

```bash
WB_REPO=/path/to/web_builder npm run codegen:check
```

**Codegen now REFUSES a checkout that is not published** — uncommitted changes in the four
directories it reads, OR commits those directories carry that the upstream does not have. The
second half was added the day after the first, because the first had a hole exactly the size
of the next thing that happened: a `hoverSwapImage` feature sat COMMITTED on a local main,
unpushed, so the tree was clean and the check waved it through. The catalog is read against
DEPLOYED platforms; an agent told about a config key no deployment has is in the same position
as one told about a half-written element. A detached worktree has no upstream, so a third check
asks the honest question instead — is this commit on ANY remote branch? That one exists
because the recommendation became the hole: `da5df0f` in this repo regenerated the catalog for
a `rating-stars` element from a detached worktree at the platform's LOCAL head, and that commit
was on no remote branch, so the catalog described an element no deployment had. A repo with no
remotes at all says nothing rather than refusing — nothing to measure against is not a
failure. Originally, and still, for
uncommitted changes
(`schema/src`, `editor/src`, `server/render`, `server/docs`), naming the files and the worktree
command. It had to become a check rather than another paragraph: the warning below was written
after a `bundle-items` element went in from one concurrent session, and a `cart-count` element
plus 193 lines around it went in from another **on the day that warning was being read**. The
output looks exactly like a real platform addition, because it is one — just not one that
exists anywhere yet. `--dirty` is the deliberate override, and says so.

Writes nothing; exits 1 naming every file that would change. Point it at a COMMITTED ref
rather than a working tree — a checkout somebody is mid-edit in will bake half-finished work
into the catalog, which happened here (a `bundle-items` element and its relation-slot
operations, from a concurrent session). A `git worktree add --detach <path> origin/main`
with `node_modules` symlinked in is the cheap way to get one.

Expect the token budget to move with it: a real platform addition grows a call sheet, and
`test/token-budget.test.ts` is meant to catch RUNAWAY growth, not to freeze a byte count.
Raise the ceiling with the reason written down, and leave headroom — a ceiling set just
above today's measurement gets raised again without anybody looking.

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
- **The bump is read from the HEAD COMMIT ALONE**, not from the range being pushed:
  `github.event.head_commit.message`. So a ten-commit push carrying two `feat(` commits
  released as a PATCH because the last commit was a `fix(`. Nothing was wrong with the
  release — the changelog described the features correctly — but the version understated
  them. If a push is meant to land a minor, either make the LAST commit the `feat`, or
  dispatch the run with `bump=minor` instead of relying on the push trigger.
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
  repo is public. No secret reaches a file, a log, or a tool result. `SB_SITE` rides in the
  same envelope without being one: a key belongs to exactly ONE site, so the id is a
  constant the install knows, and every `site_id` argument falls back to it through
  `siteFor()`. An explicit argument still wins, so a session spanning two sites works by
  naming each.
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

- **The OpenAPI document holds no `operationId`.** Ids are synthesized as `method:path`; the
  generator asserts uniqueness. The counts move with the platform and live in `SWAGGER_SOURCE`
  and `SHAPE_SOURCE` rather than here — 484 operations / 99 definitions at the 2026-09-08
  regen. (A tag-assignment count is always higher: an operation with two tags is counted twice.)
- **Bodies are under-described in two different ways, AND THE HANDLER ANSWERS BOTH.** 62 of
  171 body-carrying operations declare a body with no `$ref`; most write operations declare no
  body *at all*, and that second group mixes genuine action endpoints
  (`POST /orgs/{id}/leave`) with missing annotations (`PUT /pages/{id}/source` carries a whole
  page document). `describeOperation` still gives the two cases different words — saying "no
  body" for the second would have a model send an empty PUT and wipe a page — but they are now
  the FALLBACK, behind `body_shape`. See the `REQUEST_SHAPES` bullet below.
- **THE BODY SHAPES WERE NEVER UNDISCOVERABLE — THEY WERE MERELY ABSENT FROM `swagger.json`.**
  46 of 212 write operations carried a schema, so every merchant operation through
  `sb_api_call` was a guess, and the documented recovery ("read the matching GET and send back
  a modified copy") cannot help a CREATE: there is nothing to GET before the first product,
  the first delivery option, the first gateway. But the handler decodes into a NAMED STRUCT —
  `var m shipping.Method` — so `scripts/shapes.ts` reads the decode site, resolves the struct
  out of `server/internal/**`, and emits `REQUEST_SHAPES` (158 of 212, committed as
  `src/catalog/shapes.generated.ts`). Three things worth keeping:
  - **The decode site is MORE ACCURATE than swagger, not merely broader.** One doc comment
    block serves several `@Router` lines — `products/rest/rest.go:206` attaches
    `@Param product body products.Product` to the GET as well as the POST — so a listing
    claimed a body it does not take. A decode site sits inside one `case http.Method*`.
  - **A struct is keyed by DIRECTORY, not package name.** Every `internal/*/rest/*.go` file
    declares `package rest`, so `products/rest` and `loyalty/rest` both define
    `adjustRequest`; keying on the package name silently gave one of them the other's fields.
  - **The field's own doc comment is the half that decides a body**, so the note keeps the
    first sentence AND every sentence that shouts. `shipping.Method` documents `FreeOverCents`
    as "ZERO MEANS 'never free', not 'always free'" and `Disabled` as "NEGATIVE, so the zero
    value is the enabled default" — both are second sentences, and a shape without them ships
    a store that delivers everything for nothing. `readOnly` comes from the editor's own
    `Omit<…>` input types, INTERSECTED with the struct's fields rather than required whole:
    `CatalogProduct` omits `priceCents` and `totalStock`, which are not columns on
    `products.Product` at all, because price lives on the variant.

  A nested struct is expanded ONE level, and that level is load-bearing:
  `POST /api/v1/products` takes `variants: VariantInput[]`, and `products.Product` has no
  price column at all — price lives on the variant. A shape that stopped at the type name
  told an agent everything except the field that decides whether the store can take money.

  The generator's own evidence that it is right: it recovers `{ document, schemaVersion }` for
  `PUT /pages/{id}/source` — the shape the bullet three below records somebody having to read
  out of the editor by hand.
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
- **The element registry holds 111 types, and `getElementAI` covers 111/111** (106 when
  `order-receipt` landed, 107, then `rating-stars`, `chat-widget` and `cart-count` — codegen
  asserts the coverage, so this number moves with the platform and a stale one here is caught
  by the next run, not by a reader). The
  directory has more entries than that because the loose `.ts` files beside the elements
  are not elements. 78 binding sources, read from BOTH renderers — the Go scope and the
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
- **`sb_review` now answers EIGHT readiness questions, and the newest is the most basic.** A
  store with a published product template, a checkout page, a live gateway and a delivery
  option reported READY on an EMPTY CATALOGUE — every repeater rendering its empty state to a
  shopper, the product template bound to nothing. `catalogue` reports that, and reports the
  near-miss too: every active product priced at zero renders, adds to the cart and totals
  nothing, which reads as a working store right up to the money. Read off
  `/api/sites/{siteId}/products` rather than `/api/v1/products`, because that one takes either
  credential and the check must answer for a session install as well as a key-only one.

- **NOTHING ASKED WHETHER THE PAGES WERE ONE SITE.** Every tool here authors ONE page, so a
  build that never reaches for a global section gives each page its own header and footer — and
  then changing the menu is one edit per page, the copies drift, and a visitor meets a slightly
  different site on every click. It is the most basic thing a website has that a generated one
  does not, and it is INVISIBLE to `sb_review`, which reads one page and finds it perfect.
  `siteChrome` reports it, asked BEFORE the `isStore` gate because it is true of every site;
  the precedent is `accountPage` / `searchPage`, already there on the same reasoning in the
  other direction. Two pages is the threshold — a one-page site has nothing to share with — and
  an unread list is silent rather than an empty one. The list was ALREADY being fetched for
  `cartTrigger`; only its length was thrown away.

- **AND THE BASKET HAD NO NUMBER ON IT.** `cart-count` is opt-in by design — `open_cart` is an
  ACTION any element can carry, not an element type, so there is no "cart icon" to badge by
  default and minting one unasked would put a number on every social glyph in every footer.
  This file already recorded the consequence ("the defect the platform shipped `cart-count` to
  fix is the default state of every icon this server authors") and nothing checked for it.
  `cartCount` fires only when something DOES open the cart, so it never doubles up with
  `cartTrigger`.

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
- **A SATELLITE hangs off `config[key]`, and the editor mints it on ADD.** Nine elements own
  one — `accordion`, `tab`, `menu`, `list-dataset`, `dataset-block`, `cart-order`,
  `product-variants`, `quantity-dataset` and `icon`. The table is generated from the element
  METAS (`SATELLITE_RULES`), never from Go's `SatelliteConfigKeys`, because only the metas carry
  `optional` — and TWO are now opt-in rather than one: `list-loading` (`loadingStateId`), because
  a list with no loading design shows a silhouette of its own cards, and `cart-count`
  (`cartCountId`), the basket badge on the corner of a cart glyph. The second is why the flag
  matters. `open_cart` is an ACTION any element can carry, not an element type, so there is no
  "cart icon" type to give a badge to by default — minting it unasked would put one on every
  social glyph in every footer. An `icon` that never asks renders exactly the bytes it did
  before. So a header cart icon ships WITHOUT a count unless something adds the satellite, and a
  shopper who adds an item gets a toast that fades and no evidence anywhere on the page that
  their basket holds anything: the defect the platform shipped `cart-count` to fix is the
  default state of every icon this server authors. `schema_gen.go:245` states
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
  CLOSED LIST (`src/tools/api.ts:191`), so what it omits is UNREACHABLE. The annotated half of
  that gap closed on 2026-09-09 — 486 `@Router` annotations, 486 operations in the checked-in
  `swagger.json`, 486 in this catalog — when `swag init` was finally re-run after being un-run
  long enough to hide 34 operations, payment-gateway config among them.

  **IT RE-OPENED THE NEXT DAY, AND IT IS NOW CLOSED AT THE SOURCE — 495 = 495 = 495, measured
  2026-09-10 after the platform commit below.** This paragraph is why it took a hand-count to
  notice the first time. The
  fix it recorded was a three-command shell recipe and an instruction to re-measure rather than
  trust the number — which is a thing a reader skips, and which over-counted anyway, because
  the platform stacks one doc block over several `@Router` lines and `courses/rest/rest.go`
  declares the same two enrollment routes in two blocks, so a raw `grep | wc -l` reads 492 for
  490 distinct routes. Measured 2026-09-10: 490 annotated, 486 documented. The four missing were
  `GET /api/chat-providers` and `GET/PUT/DELETE /api/sites/{siteId}/chat-settings` — the AI chat
  assistant's ENTIRE configuration surface, mounted and live
  (`server/internal/server/router.go` wires `chatbotrest`), describable by nothing. The
  `chat-widget` element had already shipped in the catalog, so an agent could put a chat
  launcher on a page, publish it, and hand over a storefront whose chat answers 404 —
  `chatbot/public/public.go:220` collapses "never configured" and "switched off" into one — with
  no call anywhere in its reach that could turn it on.

  **AND THE CHECK THEN FOUND A SECOND, OLDER GAP THAT NO COUNT COULD SEE: a surface annotated so
  PARTIALLY that the totals agreed.** `relations/rest/rest.go` carried ONE `@Router`, on the list
  GET, over a dispatcher that also serves create, update, delete and both pick verbs — so
  curated shelves were readable and unmanageable, and nothing in the 490-vs-486 arithmetic
  pointed at them. Fixed upstream in `8e40bbab` (web_builder) by annotating the five and
  re-running `swag init`, which recovered all nine at once: **495 annotated, 495 documented, 495
  in this catalog**, no removals. `slotBody` and `picksBody` arrived with shapes automatically,
  and so did `chat-settings`' PUT — an INLINE anonymous struct, which `scripts/shapes.ts`
  already handled. The lesson for the next re-measure: equal totals prove nothing about a
  dispatcher that routes several verbs behind one annotated method.

  **So the recipe is now a CHECK.** `reportUndocumentedRoutes` in `scripts/gen-catalog.ts` asks
  the question on every `codegen` and every `codegen:check`, comparing DISTINCT annotated routes
  against the document and matching on route SHAPE, so a path parameter spelled `{siteID}` in
  one place and `{siteId}` in the other is not a false gap. There are two staleness questions
  and `--check` only ever asked the second:

  - is the catalog current against `swagger.json`? — `reportDrift`, and it exits 1;
  - is `swagger.json` current against the ROUTES? — this, and it WARNS without failing.

  The asymmetry is deliberate. This drift is not fixable by regenerating anything here, so
  failing `--check` would send the caller to run the one command that cannot help. The message
  names the upstream fix instead: `swag init` in `web_builder/server`, commit `server/docs/`,
  then regenerate this catalog against that commit. Pinned by
  `test/codegen-undocumented.test.ts`.

  What remains unmeasured is the routes with NO annotation at all. The old count (41) was
  never re-verified and is not repeated here: the dispatchers mount wildcard subtrees
  (`/*rest`, `/site/*rest`) and each context routes internally, so there is no mechanical way
  to enumerate them from the router, and the running server is in release mode with no route
  table in its log.

  **AND A PUT NOW READS BEFORE IT WRITES, because every whole-document replace is one-way.**
  `PUT /settings` is not a patch and a partial body erases the store's configuration. A
  merchant clicking through the editor has undo; an agent had nothing, and one call does more
  damage. `sb_api_call` therefore GETs before any PUT that
  has both a shape and a matching GET, and `sb_undo` puts one state back through the same
  operation, carrying only the fields that operation's handler decodes. In process, capped at
  20, silent when the read fails — an undo that could not be prepared must never stop the
  write the caller asked for. The envelope rule is the part worth keeping: shape field names
  are looked for at the TOP LEVEL first and inside a single-key envelope only if none are
  there, because `{ document: … }` IS what `PUT .../document` wants back while `{ source: … }`
  holds `document` and `schemaVersion` one level down. Unwrapping blindly would have restored
  the document's own first field.

  **But the PRIVATE surface is not the whole map, and reading only it overstates the gap.**
  `/api/v1` — the partner surface, `SB_TOKEN` — carries 49 reachable operations, including
  `GET/PATCH/DELETE /api/v1/pages/{id}` and `POST /api/v1/pages/{id}/publish`, all with a
  DESCRIBED body (`internal_publicapi.PagePatch`), plus full CRUD for products, articles,
  blog categories, customers, media, orders, translations and webhooks. So a page CAN be
  read, patched and deleted, and a catalogue CAN be filled — through the key, not the
  session. See `docs/superpowers/specs/2026-09-07-phase-7-drop-time-and-signals-design.md`.

  **AND THIS FILE SAID FOR THREE PHASES THAT A WRECKED DRAFT WAS UNRECOVERABLE. IT WAS NOT.**
  Page versions and history were recorded here, repeatedly, as having "no route on either
  surface" — which was true of the DOCUMENT and false of the platform. `saveDraftRaw` appends
  an autosave checkpoint on EVERY draft save, bounded by the service's own keep count;
  `SaveVersion` mints a labelled snapshot; `RestoreVersion` and `RestoreHistory` put either
  back; and `pageSub` has routed `versions` and `history` all along. Five working operations,
  carrying no `@Router` line — so they reached a browser and reached `swagger.json`, this
  catalog and every call sheet by no route at all. The same shape as `relations/rest/rest.go`,
  with a worse consequence: this is the surface that recovers a page somebody overwrote.

  Annotated upstream (`beb4562f`), 501 → 506 operations:

  - `GET .../pages/{pageId}/versions` and `POST` the same path — list, and snapshot the
    current draft under a label. The POST's `document` is OPTIONAL, and omitting it is the
    ordinary use: label what is there before changing it.
  - `POST .../pages/{pageId}/versions/{versionId}/restore`
  - `GET .../pages/{pageId}/history` — the checkpoints nobody asked for and everybody needs.
  - `POST .../pages/{pageId}/history/{historyId}/restore`

  A RESTORE CHANGES THE DRAFT. Publish afterwards, or the merchant reloads the storefront
  after a successful restore and sees the old page. And `sb_undo` is now the SECOND answer
  rather than the only one: it covers any shaped PUT but lives in this process and dies with
  it, while the page surface is the platform's own and survives everything. Its description
  said "the platform has no page history or restore, so this is the only way back" — which
  would have steered an agent away from the better answer, and is corrected.

  A page DELETE is still one-way.

- **An AGENT KEY now opens media upload AND the live-edit socket. Both of this repo's
  "session only" rules are DEAD, and the corrections are recorded because the old ones read
  as settled facts.** `/api/media` is mounted behind `RequireAuthOrDefer`
  (`server/internal/server/router.go:2821`), the same gate as `/api/sites`, pinned by
  `media/rest/upload_agentkey_test.go`; the platform's own comment gives the reason — the
  media LIBRARY already took a key while the UPLOAD refused one, so a merchant could hand an
  agent a key that manages every image the store has and cannot add one. And
  `server/internal/server/realtime.go:44` gives a `wbk_` bearer "the same door as a session"
  on the socket, gated on `member.read` through the key's delegated principal.

  So the client's two refusals were both wrong, and both have been removed. The lesson worth
  keeping: a credential rule verified once is not a constant. The platform is actively
  WIDENING what a key opens, and a stale "only a session can do this" guard turns away a
  setup that works — which is worse than no guard, because it sends the caller to fix
  something that was never broken.

- **On the canvas the agent's avatar is the KEY, not a person — AND SINCE `8e40bbab` it also
  says so.** `realtime.go` returns `key.ID` and `key.Name` rather than the minter's name,
  deliberately: an avatar borrowing a human's name would tell the room a person is editing when
  a machine is. But it stopped there, so the only thing separating an agent from a colleague was
  the WORDING the merchant happened to choose for the key — a key named "Trang" put a convincing
  person in the room, moving a cursor around the page, and the editor had no signal it could
  draw a badge from.

  `realtime.Peer.Kind` carries it now (`PeerKindAgent`), and A PERSON IS THE ZERO VALUE: with
  `omitempty` a human peer serializes byte-identically to the one before the field existed, so
  the addition could not break a client that has not been taught it. The editor draws a GLYPH
  rather than a word — no i18n key, same in every language — on the avatar and on the CURSOR,
  which is the surface a merchant actually watches.

  What this server sends is unchanged: `sb_live_join` still publishes `ops`, and `cursor` /
  `select` still only move when a real `sb_look` measurement exists (`PageSession.noteBoxes`),
  because presence with an invented coordinate is theatre. The read path is still HTTP — the
  socket BROADCASTS edits, it does not fetch or save them.

- **THE DATA AXIS OF A REPEATER WAS UNREACHABLE THROUGH EITHER TOOL, silently.** `sb_add`
  with `config.datasetSource: "category"` minted a `list-dataset` still bound to
  `product_list`: `createNode` seeded the element's DEFAULT bindings and ignored the config
  in the same call. And `sb_set` could not repair it — `rebindPatch` looked up
  `${source}|${kind}`, and TEN elements with a `bindingsFor` table declare no default
  `config.kind` (`list-dataset`, `dataset-block`, `media-dataset`, `collection-media`,
  `product-variants`, `quantity-dataset` …), so the key came out `category|` and matched
  nothing. A category shelf repeated PRODUCTS under a heading that said collections, through
  save, publish and render, with no warning at any step. Both paths now share
  `bindingsForConfig()` (`domains/site/node.ts`), which falls back to the first row for the
  source when the element has no kind axis — every `<source>|*` row of such an element is
  identical, because there is nothing for it to vary on.

- **A PURCHASE BUTTON COULD NOT BE AUTHORED AT ALL.** The renderer decides what a button IS
  by reading `target.action` and nothing else (`server/render/nodes/helpers.go:1166`);
  `sb_set` writes only style/config/specials, and `sb_bind` wrote a binding with no target.
  So a store built entirely through these tools had no Add-to-cart control, while `sb_review`
  reported the missing purchase action and named no fix that worked. `sb_bind` now takes
  `action`, writing the reserved id `bind-product-action`
  (`schema/src/elements/datasetBindings.ts:852`) with `buy_now` stored as its document
  vocabulary `dynamic_checkout`.

- **`empty_container` fired on an element that paints the record itself.** A bound
  `media-dataset` with no children publishes the product photo and its thumbnail strip;
  the rule called it an empty band on a page that rendered correctly. The discriminator is
  not "is it bound" — `dataset-block` binds too, and only the LINK (`boundHref`), so an
  empty card really is empty. It is whether `BOUND_SPECIALS` holds a key outside the link
  set.

- **A CHECKOUT IS FOUR STEPS IN A FIXED ORDER, AND `sb_store` NOW RUNS THEM.** The flow was
  documented here and reachable by nothing: an agent had to read the editor's own file,
  reproduce four writes in order, and rebuild two documents it could not author. `sb_store`
  with `action: "checkout"` runs them, generating both documents from the editor's
  `formTemplates.ts` and `checkoutPageSeed.ts` at codegen time — with the form id substituted
  through a sentinel codegen asserts appears exactly once, because a substitution that
  silently matched nothing would make a checkout page bound to no form, which renders and
  takes no orders. `dry_run` (the default) returns the ordered plan and the payment and
  delivery options the form will actually carry.

  The original note stands as the reason it had to be a tool:
  `editor/src/features/pages/checkoutPage.ts` — create an order form, PUT it
  back WHOLE (name and type ride along, or `Normalize()` renames it and turns it `custom`,
  after which the document is refused), save the field document with the payment methods and
  shipping options filled in at that one moment, then create the page from
  `buildCheckoutPageDocument` and PUBLISH, because /checkout resolves to the published page
  of the TYPE. Both seed modules import only `@webbuilder/schema` plus editor-internal
  files, so codegen imports them directly. Copy that flow; do not rebuild a checkout by hand.

- **`swag init` had not been re-run for a long time, and re-running it recovered 44
  operations** — 278 paths / 412 ops → 306 / 456. Among them the three that matter most:
  `GET/PUT/DELETE /api/sites/{siteId}/payment-gateways/{provider}`, which had no `@Router`
  and were therefore reachable to a browser and to nothing else. A store built through the
  API could read its gateways and never switch one on, and the cause was a missing comment
  rather than a missing route. Annotations now live on `payments/rest/manage.go`'s
  `gateways` method.

- **A SATELLITE CARRIES THE ELEMENT'S WHOLE LOOK, and the outline used to hide it.** The
  variant option's box, its label, the quantity stepper's two buttons and its input, a
  repeater's empty state — all real nodes with `style` and `states`, all hanging off
  `config[<key>]` instead of `data.nodes`, so every walk of the child lists missed them. A
  storefront therefore shipped with the platform's grey `#d0d0d0` selects and a grey stepper
  on a rose-and-ink page, and nothing in any tool said the nodes existed. `sb_outline` now
  lists them under their owner as `satellite: "<config key>"`, ahead of the real children and
  NOT counted in `children` — that number still means `data.nodes.length`, which is what every
  index-taking call is written against.

- **A FORM'S FIELDS ARE STYLED BY CONFIG KEYS THAT BECOME CSS VARIABLES**, not by style on
  the field. `schema/src/elements/fieldSkin.ts` and its lockstep mirror
  `server/render/nodes/fieldskin/fieldskin.go` hold the vocabulary: `fieldBg`,
  `fieldBorderColor`, `fieldRadius`, `fieldPadY/X`, the chrome trio, and separate tables for
  choice, timeslot, file and pay-card. TWO LEVELS: the FORM node dresses every field it
  holds, a FIELD node overrides its own — and the split matters, because `form/css.go` emits
  only `Knobs + ChromeKnobs`, so `payCard*` written on the form is stored and rendered
  nowhere. Those belong on the `form-payment` field, inside the FORM DOCUMENT
  (`PUT /api/sites/{siteId}/forms/{id}/document`) — as does the submit button, which is a
  `form-submit` node in that document and not on the page at all. A page republish is what
  makes a form-document edit visible, since the page inlines the form (`id` =
  `<pageFormId>_<formNodeId>`).

- **The page's CSS is a LINKED STYLESHEET, not the HTML.** `static-*.css`, `desktop-*.css`,
  `tablet-*.css` off the assets host. Grepping the HTML for a rule and finding nothing proves
  nothing — twice here it read as "the style did not apply" when it had.

- **STOREFRONT CUSTOMER ACCOUNTS EXIST, and an element hint said they did not.** `form`'s
  `avoidWhen` carried "Sign-in, registration or password reset: those need storefront customer
  accounts, which do not exist yet, so a form there would submit into nothing" — read at build
  time and believed, which is why a storefront shipped with no way to sign in. They exist in
  full: `/_wb/account/{login,register,logout,forgot,addresses,cart,courses,…}`, the `account`
  page type served at the fixed path `/account`, form types `login` / `register` / `forgot` /
  `reset` / `verify` (`forms.Type.IsAuth`, submitting through `customerauth` rather than the
  submissions table), the `logout_customer` click action, and the elements `account-info`,
  `member-gate`, `member-field`, `address-book`, `wishlist-list`, `points-card`,
  `points-prompt` — several already shipping VIETNAMESE defaults. Corrected at the source
  (`schema/src/elements/form/ai.ts`). The lesson is the one this file already records for
  agent keys: a hint written when something was true survives long after it stops being, and
  a stale one that says "you cannot" costs more than no hint at all. `customer.name` is not a
  mapping either — the field is `customer.fullName`.

- **FOUR PATHS RESOLVE BY PAGE TYPE, and only one backstops itself.** `page.FixedPathTypes` is
  search, checkout, complete, account. `/checkout/complete` serves a built-in receipt when the
  store has no completion page — measured 200 on a store that had none. `/account` and
  `/search` measured 404 on the same store, QUIETLY, because nothing links to them by default:
  the merchant finds out when a shopper who wants their order history does. `readinessGaps`
  now reports both, after the five that stand between the store and a paid order and before
  the cart trigger — a shop with no account page still takes money, so they are a different
  question, asked second.

- **A SHARED MASTER IS FENCED, AND THE FENCE MOVES ON EVERY SAVE.** Compose stamps
  `specials.globalRev` / `specials.overlayRev` on the node it materialises; the save sends it
  back as `expectRev`; the platform refuses a stale one WITH A WARNING AND A 200. The save
  response reports each master's new revision (`source.globals`, `source.overlays`) precisely
  so the client can re-stamp — and this client typed both fields and read neither, for as
  long as they have existed. So the FIRST edit to a global header, a global footer or the
  cart drawer landed and every edit after it in the same session was dropped while the tool
  answered success. Measured: two `sb_remove` calls against the drawer, the second answering
  `{"removed": …}` and changing nothing. `PageSession.save` now applies `restampPatches`.
  The platform's own comment on the field says the same thing about the editor, which had
  the bug first.

- **`sb_review` USED TO SKIP OVERLAYS, on a reason that was false.** The comment said the cart
  drawer "is not this page's to fix" — but an overlay's content reaches storage through the
  PAGE SAVE, so `sb_set` on a drawer node lands, and the skip meant nothing ever reported what
  shipped inside one. Measured: a rose-and-ink storefront whose drawer carried a static mock
  row reading "Product name / 0₫", a DUPLICATE cart list rendering every item twice, and
  English copy throughout — none of it mentioned, on a site that reviewed clean ten pages
  running, and all of it found by a person opening the drawer. Overlays are now walked, and
  their findings carry `overlay: true` because the master is SHARED: without the flag one
  drawer defect reads as ten problems on a ten-page site.

- **AN OVERLAY'S CONTENT IS WRITTEN THROUGH THE PAGE SAVE, never through the overlays API.**
  `PATCH /api/sites/{siteId}/overlays/{id}` accepts `name`, `kind` and `allPages` — a
  `document` in that body is ignored and the call answers 200. The route-map comment on
  `overlays/rest/rest.go` says content "is deliberately NOT written here": the page save
  carries the composed drawer and the page context decomposes it. So `sb_set` on a drawer
  node is the right tool and it works; `refuseOverlay` fires only on the overlay ROOT, which
  is correct, because moving or removing THAT is not a page-level fact.

- **THE PLATFORM CAN NOW FETCH THE IMAGE ITSELF, and the client asks it to first.**
  `POST /api/media/{siteId}/from-url` takes `{ url, folderId?, name? }` and runs the same
  `media.Ingest` the multipart door does — added upstream (web_builder `46b4d8b1`) because an
  agent bringing a page over from elsewhere has the image as a URL and never as bytes. Two hops
  became one, and the content type is decided by the origin's own answer rather than
  reconstructed here from a header and an extension.

  **A REFUSED ADDRESS IS TERMINAL, and that is a security rule rather than tidiness.** The
  platform refuses anything that is not on the public internet — loopback, private ranges, the
  cloud metadata endpoint — checked at CONNECT time so a name that resolves inward is caught
  too. A client that answered `remote_blocked` by fetching that same URL from its OWN machine
  and uploading the bytes would walk straight around the guard, so `uploadMedia` raises instead.
  Only a MISSING ROUTE (404/405) falls through to the old download-and-post path, which is the
  same deployment-age shape the `/api/v1/media` retry below already has.

- **`POST /api/v1/media` is a SECOND upload door, and it is the key's own.** `/api/media`
  takes a `wbk_` key only since `feat(media): a wbk_ API key may upload`, so a deployment
  older than that commit refuses a valid key — measured against a server binary 26 minutes
  older than the fix, with a key holding `media.write` on its own site. `uploadMedia` now
  retries on the partner surface before blaming the key, and its refusal names the
  deployment as a suspect alongside the scopes.

- **`sb_look` PAID 2.5 SECONDS FOR A TIMEOUT THAT COULD NOT RESOLVE.** It waited on
  `networkidle` with a 2500 ms cap, under a comment correctly explaining that a storefront
  never goes idle — the cart island polls, a session endpoint answers 401 forever. So the wait
  ran to its cap every single time: measured 2502 ms of a 2847 ms shot, three runs of three.
  On the one tool a vision loop calls after every edit. A MutationObserver asks the question
  actually being asked — has the page stopped changing — and answers when it becomes true:
  400-460 ms on the same pages, identical content on screen. `sb_look` went 3211 ms → 923 ms
  warm, 3566 → 1564 for three widths. Bounded twice (250 ms quiet, 2000 ms cap), because a
  page that never settles must be photographed anyway. Everything else in the server is
  1-181 ms; this was the whole latency budget.

- **A PUT THAT CHANGES NOTHING IS NOT FREE.** `sb_look` saves before it renders — correctly, a
  shot of an unsaved edit is a shot of the past — and a vision loop LOOKS far more often than
  it edits, so the same bytes went back over the wire on every look. It costs a round trip,
  and it bumps the REVISION of every shared master the page carries: the fence
  `restampPatches` exists to keep honest, churned for no reason, which is how a session
  collides with a real editor. `PageSession.save` now compares the document's revision against
  the one it last stored and returns early. Measured: six consecutive looks leave `updatedAt`
  untouched, and the first real edit moves it.

- **`sb_set`'s `state` PARAMETER WAS READ BY NOTHING USEFUL, and its documented call
  corrupted the base style.** A state has TWO homes and the platform names both
  (`schema/src/node.ts`, mirrored by `render/style/cascade.go`'s `MergeStateNs`): base is
  `node.states[state][ns]`, per breakpoint is `node.responsive[bp].states[state][ns]`.
  `setKeys` wrote neither — its path was `states[state][bp][ns]`, a breakpoint buried inside
  the base-state cluster where nothing reads it — and worse, `if (opts.base)` was tested
  BEFORE `if (opts.state)`, so `base:true` + `state:"hover"` fell into the base branch and
  wrote the hover value straight into the plain style. The node then wore its hover colour
  permanently and had no hover at all, while the tool reported success. The call that does
  this is the one the `sbuilder-site-design` skill documents:
  `sb_set pr_option style base:true state:"active"`. A test pinned the wrong shape, so the
  defect had a green suite over it. Base is NOT a degenerate case: it is where every element
  seeds `meta.defaults.states` (`tab-item`, `quantity-button`), and `MergeStateNs` reads it
  first. `specials` now REFUSES a state rather than dropping it.

- **`sb_review` NEVER WALKED A SATELLITE, so an element's whole chrome was outside it.** Its
  recursion used `childrenOf` — `data.nodes` only — which is precisely the mistake `walk`'s
  own comment warns a caller against ("satellite-aware is the DEFAULT ... a caller who writes
  the obvious thing must not be silently wrong"). So every repeater's empty state, every
  variant-option skin, every quantity stepper and every menu/tab item skin was invisible to
  the one check that exists to say what a visitor meets. `childrenWithSatellites` in
  `core/tree.ts` is the one-level form for a caller carrying its own scope down.

- **AND THE SEED COPY IT COULD THEN SEE HAD NO CHECK.** `placeholder_content` compares a
  node's `specials.text` against `ELEMENTS[type].defaults.specials` — the element's OWN
  default, which for a heading is `"Heading"`. An empty state's heading is minted from
  `SATELLITE_RULES`' seed tree and says `"No products yet"`, so it matched nothing. The
  consequence is general, not incidental: EVERY store built with these tools ships the
  platform's English empty states, in `#171717` ink and `#d4d4d4` icons, and reviews clean.
  Measured on a Vietnamese storefront — home, category, product and search each reported
  "nothing a visitor would notice" while four repeaters said "No products yet" and "New
  arrivals will show up here. Check back soon." `default_seed_copy` reports it, off both
  generated seed tables so a new empty state is covered by the next codegen.

- **THE DRAFT PREVIEW DOES THREAD STORE DATA, and the note said the opposite.** `sb_look`
  told every caller that "every repeater renders its empty state there, however correct the
  page is" — measured false: a home page previewed four real products at their real prices,
  matching the catalogue exactly. `ServePreview` runs `RenderDraft` → `gather` → `assemble`,
  the SAME path as a published page, and the platform's comment on it says the result is
  "byte-identical to what publishing this source would serve" (`storefront.go:1260`). The
  shoot path's own comment had already recorded the observation ("identical content on
  screen — images, prices, no empty states") while the note contradicted it. The REAL caveat
  is the opposite population of pages: entity routing lives in `ServeHost`, not
  `ServePreview`, so an entity TEMPLATE previews with nothing bound — blank title, zero
  price, and the variant picker showing the element's seed options ("Color / Size",
  "Red / S") rather than the product's own. That last one reads exactly like the
  attributes-vs-options defect the build recipe warns about, and is not it.

- **AN OVERLAY WRITE IS SITE-WIDE AND `sb_set` SAID NOTHING.** `globalWarning` asked only
  `isGlobal`, so restyling the cart drawer's quantity stepper changed ten pages and the
  result read as a plain page-local success. It is the write-side of the reason `sb_review`
  flags overlay findings `overlay: true`. `overlayRoot()` answers for a node ANYWHERE inside
  one, which is the case that matters — the caller edits the stepper, not the drawer root.

- **`sb_api_call` DEMANDED `{siteId}` ON ALL 289 OPERATIONS THAT NAME IT**, while `siteFor()`
  defaulted it for every other tool. On a key-only install that is a 32-character constant
  the environment already holds. It now falls back to `SB_SITE` for `{siteId}`/`{siteID}`
  only — `{productId}` and `{id}` name a record the caller chose — and an explicit argument
  still wins.

- **`sb_look` COULD NOT PHOTOGRAPH THE ONE SURFACE THIS FILE INSISTS YOU LOOK AT.** A closed
  drawer is `visibility:hidden` and translated 105% off-screen
  (`render/nodes/cart-drawer/css.go`), so it measures at x=1461 on a 1440 viewport and
  `page.screenshot({clip})` fails outright — "Clipped area is either empty or outside the
  resulting image", naming neither the overlay nor the reason. `sb_look` now adds the
  platform's OWN `is-open` class (plus the scrim's) before measuring, whenever `node_id`
  resolves inside an overlay.

- **A `media-dataset`'s `style.aspectRatio` SHAPES THE BOX, NOT THE PHOTO.** The image's own
  ratio is `config.mediaImageRatio` (`"auto"`, `"custom"` + `mediaCustomImageRatio{Width,Height}`,
  or a ratio string verbatim — `render/nodes/media-dataset/css.go`); with the config unset the
  `<img>` keeps the static `aspect-ratio: 1 / 1`, so a portrait product photo is centre-cropped
  to a square inside a correctly-shaped frame. `sb_traits_for media-dataset` names all three
  controls. Rule 6 of the design skill — "match a frame's aspect ratio to the asset" — is
  therefore only half the job on this element.

  **And the platform's own CSS defeated even that**, which is worth knowing because the symptom
  reads as an authoring mistake. `ImgAttrs` writes the intrinsic `width`/`height` ATTRIBUTES
  onto every `<img>` (that is what keeps CLS at zero), and a presentational `height` attribute
  is a USED height — so with no CSS `height`, `aspect-ratio` has no auto dimension to solve for
  and is IGNORED. Measured on a live product page at 390px: a 900×1100 photo in a 326px frame
  rendered 326×**1100**, and the node's `overflow:hidden` showed the shopper the top third of a
  t-shirt. It was invisible at 1440 only because a taller container clipped a smaller fraction,
  which is why it survived a desktop review. Fixed upstream by adding `height:auto` to
  `__feature-img`, `__cell-img`, `product-image-feature__img` and `wishlist-list__card-img`, in
  the Go static CSS AND the editor SFCs that must stay byte-identical to it.

- **A FORM STACKED ITS FIELDS WITH ZERO GAP, on every store.** `form`'s
  `meta.defaults.style` seeded `display:flex` + `flexDirection:column` + `width` + `height`
  and no `gap`, while `form-segment` — the sibling with the IDENTICAL trait signature and the
  identical four keys — seeded `gap: '12px'`. So the same form spaced itself differently
  depending on whether its fields sat in a segment or directly in the form. Measured on a
  published checkout at 1440px: eleven consecutive fields, every gap between them EXACTLY 0,
  so each label sat nearer the previous control than its own. The Layout group offers a Gap
  row, which is the same "the panel reports a value the box does not have" shape
  `schema/test/direction-default.test.ts` was written for. Fixed at the seed (`gap: '12px'`,
  matching the sibling) with `schema/test/form-gap-default.test.ts` pinning that the three
  field stacks agree AND stay clear of `fieldStackGap` — of the 33 elements offering a Gap
  row, 29 seed one, and the four that do not are the layout primitives, so the guard is an
  AGREEMENT rather than a blanket rule.

  `defaults` seeds at CREATION, so every form authored before the fix keeps zero — which is
  why `sb_review` reports `form_fields_flush` rather than trusting the new default. That
  check reads the container's own style, NOT its children: a form's fields live in the FORM
  DOCUMENT and compose on the render path, so the page's node has `nodes: []` and a
  child-count test would call every form empty.

- **`/account` IS THE SIGN-IN DESTINATION, so it cannot be split — and it must not show
  two auth forms at once.** There is no `login` or `register` page type (`FixedPathTypes` is
  search, checkout, complete, account), and `membersonly.go`'s `membersOnlyRedirectTarget`
  sends every anonymous visitor who hits a members-only page to `/account`, its comment
  ruling out "a page-document scan hunting for a login form". So the instinct to give
  sign-in and registration their own pages breaks the platform's own redirect: the shopper
  arrives at `/account` with nowhere to sign in.

  The shape the platform intends is `member-gate`'s own hint — "build the pair: one gate set
  to Members and one set to Guests" — and the seed gives you only the members half
  (`accountPageSeed.ts`: heading + `account-info` + `order-history` + `address-book`), so
  the guest half is authored blind. What shipped here was both auth forms SIDE BY SIDE in
  the guest gate: two headings, two submit buttons and one decision, becoming one long
  double form at 390px. A `tab` is the fix — its button row is synthesized from each
  `tab-content` child's `specials.label` (`render/nodes/tab/html.go:2`), so the undeclared
  `tab_items` inspector control is not something you have to reverse-engineer — and its
  `tabItemId` satellite ships `#f5f5f5` / `#7b7b7b` with a `#171717` active state, which is
  rule 4 again.

- **SIXTEEN OF THE PLATFORM'S SEVENTEEN FORM TEMPLATES WERE UNREACHABLE.** `formTemplates.ts`
  ships `contact`, `subscribe`, `order`, `checkout`, `address`, `consult`, `booking`, `stay`,
  `feedback`, `event`, `quote`, `apply`, `login`, `register`, `forgot`, `verify` and `reset`,
  and codegen picked exactly ONE (`checkout`). So a store built entirely with these tools had
  a checkout and nothing else: no contact form on its contact page, no newsletter, and none of
  the five auth forms — even though `forms.Type` declares them, `customerauth` serves them,
  and `Type.IsAuth` gates them. Hand-authoring one means writing a field document whose
  `mapTo` values are a vocabulary the server validates, which is the guess this catalog exists
  to remove. `FORM_TEMPLATES` now carries all seventeen with their documents, and
  `sb_store action:"form"` runs the same three ordered writes the checkout does minus the page
  (create → PUT back WHOLE → save the document, with the delete-on-failure guard).

  It deliberately makes NO page: where a login form belongs is a design decision, and
  `/account` is the one page that is not a free choice — see the entry above.

- **AN IMPORT FROM ELSEWHERE IS A TRANSLATION, AND THE CLONE IS THE TRAP.** `custom-code`
  embeds raw author markup verbatim, so dumping a fetched page into one is both possible and
  the obvious shortcut — and it produces a Store Builder page that no inspector can edit, with
  no responsive cascade, bound to nothing, carrying somebody else's CSS and scripts. `sb_import`
  therefore reduces a page to SIX kinds — section, heading, text, image, button, list — in the
  browser, so what crosses the boundary is small and the element choices stay testable without
  a network (`domains/site/importmap.ts` is pure; `vision/capture.ts` holds the DOM half).

  The tokens come off the TARGET page, not the source, which is rule 0 applied to the one
  operation that most threatens it: first heading's ink and weight, first body line's colour
  and size, first NON-transparent button's fill and radius — a transparent one is a nav link,
  and taking its fill would leave every imported button with none. An empty target yields NO
  tokens rather than an invented palette.

  Images are uploaded into the site's own library, and a failed upload keeps the original URL:
  a visible image beats an empty frame, and a hotlinked one is a product photo that disappears
  when somebody else's site changes.

  A SWEEP ACROSS FOUR REAL SITES found the one defect a single page could not:
  `section` matches NESTED sections, so an outer band and the bands inside it were both taken
  and the inner content came back twice — 15 duplicated strings out of 22 on one page, 12 on
  another, which on an imported page reads as a stutter nobody typed. Only the INNERMOST
  candidates are kept, because a `<section>` wrapping the whole document is a candidate too
  and keeping the outermost would reduce every page to one band. Images are capped (24) for a
  different reason: every one is an upload, and a sponsors wall measured 36 logos — that many
  sequential round trips inside one tool call is slow, half-fails interestingly, and is not
  what anybody meant by "import this page".

  TWO MORE CAME OUT OF SWEEPING A JS-BUILT PAGE. A short BLOCK-LEVEL link is navigation, not
  a call to action — the rule stopped at "not inline" and a documentation sidebar came back as
  38 buttons, a page of pink pills where the source had a list of links. A real CTA is
  PAINTED, and the border half must check WIDTH: Tailwind's preflight sets
  `border-style: solid; border-width: 0` on every element, so testing the style alone is true
  of an entire site built with it and the first fix changed nothing. 38 → 13.

  And `capture` waited a flat 600ms, which is wrong at BOTH ends — example.com is finished
  long before it and a script-built page is not finished after it, which is the page an import
  is most likely to be pointed at. It now reuses `shoot.ts`'s own `settleDom`, the same
  MutationObserver answer for the same question: example.com 1,884 → 1,104 ms.

  A SWEEP THAT MEASURED COVERAGE — how much of the text a READER sees survives the import —
  found the three that mattered most, and none of them showed up as an error:

  - **Most of the web does not use `<p>`.** Capturing only paragraphs meant a page whose prose
    sits in a `<div>`, a `<td>` or a `<span>` came back EMPTY: news.ycombinator.com (a table
    layout) and tailwindcss.com each kept 0 of ~4,000 and ~6,000 characters. Text is now taken
    from any block that holds it, and only when nothing INSIDE it offered anything — which is
    what stops a paragraph being captured twice, once through its `<p>` and again through the
    `<div>` around it. 0% → 41% and 22%.
  - **The fallback fired on an empty candidate LIST, not an empty RESULT.** A page can offer
    `<section>`s that hold nothing this platform draws, and taking "we found candidates" as
    "we found content" returned an empty page.
  - **`maxPerSection: 40` was truncating ordinary pages, not guarding against strange ones.**
    Three dense pages each stopped at exactly 40 leaves. The bound that is actually wanted is
    on the WHOLE import (`maxNodes`, 300), so that is where it lives.

  **COVERAGE NEEDS THE RIGHT DENOMINATOR, and the first one was wrong.** Measured against
  `document.body.innerText` the sweep read 44-77%, which looked like a broken importer. Diffing
  what a reader sees against what was kept showed where it actually went: on rust-lang.org and
  python.org, 100% of the loss was NAV, HEADER and FOOTER — chrome the importer skips on
  purpose and a merchant would never want, because the target site has its own as globals.
  Content loss there was ZERO. Only the honest denominator tells you whether there is a bug,
  and the first measurement said "fix this" about something that was already right.

  What the honest measure then found was real, and both were structural:

  - **A link that is not a button contributed NOTHING.** On a page whose content IS a list of
    links that is the whole page — news.ycombinator.com lost 1,595 characters of story titles.
    The platform has no inline-link element; its own idiom is a `button` carrying `href`,
    styled flat. So an unpainted link is captured with `variant: 'link'` and takes the target's
    accent as INK rather than as fill. Painting them all is the opposite mistake: it turned a
    documentation sidebar into 38 pink pills.
  - **Two caps for one quantity meant the tighter one was always the real limit.** A page whose
    `<body>` has a single child is ONE section, so the per-section cap silently became the page
    cap: HN stopped at exactly 120 nodes. One bound now, on the whole import, and the skip is
    reported on the REAL run and not only the dry one.

  Content loss after both: 0 on three of the four pages, and the fourth is a marketing page of
  code samples hitting the 400-node ceiling, which is the ceiling doing its job.

  **FLATNESS WAS THE BIGGEST THING LEFT.** Everything arrived as one vertical column, so a
  source's three-column feature row came back as three stacked blocks and a card — image,
  heading, copy, button — as four siblings with nothing saying they belonged together.
  Everything a reader understands from the ARRANGEMENT was gone, and no amount of correct
  colour brings it back. The walk now returns a TREE: a container that genuinely lays its
  children out (`display:flex`/`grid`) with two or more of them becomes a row; a `<div>` that
  merely wraps is flattened, because reproducing it would nest the result ten deep for
  nothing. tailwindcss.com went 21.8% → 54%.

  That change needed one in the builder: **`NodeSpec` could not carry `responsive`**, so no
  node could be created with a per-breakpoint value at all — every one arrived base-only and
  needed a second `sb_set` the caller had to remember, on a repo whose design rules 1-3 are
  entirely about writing the responsive answer. An imported ROW is the case that made it
  undeniable: it must stack at mobile or the columns shrink to slivers with no box overflowing
  and nothing for `measure` to see. Merged per NAMESPACE, so seeding `mobile.style` does not
  drop an element's own `mobile.config`.

  `capture.ts` launches its OWN browser rather than sharing `shoot.ts`'s process-lifetime one:
  an import is rare, slow and runs untrusted script, and coupling that to the tool a vision
  loop calls every few hundred milliseconds is how the fast path gets slow.

- **`tagName` ON AN SVG ELEMENT IS LOWERCASE, so the ignore list's `'SVG'` and `'PATH'` had
  never once matched.** `tagName` preserves case for XML-namespaced elements while every HTML
  element reports uppercase. The entry looked like it worked because an `<svg>` that falls
  through to the text fallback contributes nothing — its `textContent` is empty. The walk now
  uppercases the tag, which is also what let `<svg>` be handled at all. Its sibling trap:
  `el.className` on an SVG element is an `SVGAnimatedString`, so `String(el.className)` is the
  literal `"[object SVGAnimatedString]"` and every class-named icon went unrecognised —
  `getAttribute('class')` is the only form that answers for both.

- **AN ICON IS LOOKED UP, NEVER GUESSED — `ICON_NAMES` is generated for exactly that.**
  `specials.name` is a PascalCase RemixIcon id and the platform ships 3,227 of them
  (`schema/src/iconManifest.json`, the same JSON the editor's picker and the Go renderer
  share). Nothing in this catalog carried them, so an `<svg>` could not become an `icon` at
  all. The name is read the way a page writes it — a sprite `<use>`, an `aria-label`, a
  `<title>`, an icon set's class — normalised, and tried as itself, `…Line` and `…Fill`.
  ANYTHING THAT DOES NOT LAND IS SKIPPED, and there is deliberately no last-word fallback:
  "Open main menu" → `MenuLine` would be right and "Acme Store" → `StoreLine` would put a shop
  glyph where a wordmark was, which is a WRONG icon and indistinguishable downstream from a
  right one. The colour is never written either — it lives in the `icon-default` preset, and a
  literal detaches every imported icon from the theme permanently.

  **AND THE `aria-hidden` RULE HAD TO YIELD TO IT.** Almost every real icon carries
  `aria-hidden="true"` — that is correct authoring, the label beside it does the talking — so
  testing the attribute before the svg branch would put the `icon` element permanently out of
  reach of a real page. An aria-hidden CONTAINER is still skipped before the walk descends.

- **A COLLAPSED `<details>` MEASURES AS ZERO**, so an FAQ imported as questions with no
  answers. The source's collapsed state is not content — this platform's accordion has its own
  `openItems` — so every one is opened before anything is measured. Consecutive `<details>`
  merge into ONE accordion: eight siblings is one list to the author, and eight accordions is
  seven wrappers nobody asked for with no shared open/close behaviour. `accordion` accepts only
  `accordion-content`, whose `specials.label` is the summary; the `accordion-item` skin is a
  satellite `createNode` mints on its own. The label is OMITTED when the source had none rather
  than defaulted, because inventing one ships English copy into a store that is not in English.

- **A PAGE AN AGENT CREATED WAS NOT PART OF THE SITE.** A page created through the editor
  carries the site's header and footer; `sb_page_create` attached NEITHER, so a site built with
  these tools was a stack of pages with no navigation and no footer — on a site that has both.
  Nothing reported it: `sb_review` reads the page and the page is fine, `siteChrome` asks
  whether the SITE has globals and it does, and `measure` sees no defect in a band that is
  simply absent. Measured by building one: three pages, every one bare, beside a store page
  carrying its header as ROOT's first child.

  **READ OFF THE HOME PAGE, never picked by name or by order.** A site can hold several globals
  of each kind — the store measured here holds four headers and two footers, most of them
  experiments — so "the first header" is a guess and a name is a label nobody promised to keep.
  Whatever chrome the home page wears IS this site's chrome. The reference is the platform's own
  shape (`decompose.go:382`) and goes in FIRST and LAST, because compose turns them into real
  bands and ROOT's children must read header, middle, footer. Silent when there is no home page
  to read: a page created without its chrome is one a person can fix, and a page created with
  the WRONG chrome is one nobody notices.

- **A SEARCH IS NOT A GUESS, and that distinction is the whole of rule 7.** The rule says
  "keyword stock imagery is not a source" and proves it — `loremflickr` answered
  "kids,clothing" with a cat statue and a photo of an adult. The fault was never stock
  photography: it was GUESSING. A keyword glued into a URL returns something nobody looked at.
  A search API returns results that each carry WHAT THEY SHOW, so the caller reads the
  descriptions and CHOOSES, which is what a person does. `sb_media_upload` takes a `query` and
  refuses to upload anything without a `pick` — uploading the first hit unread would rebuild the
  cat statue with better plumbing.

  **PEXELS, BECAUSE IT IS ALREADY THIS FAMILY'S ANSWER.** `webcake-landing-mcp` ships the same
  client — down to the shared proxy at `mcp.toolvn.io.vn/api/images/search`, which holds a key
  so an `npx` install with no configuration finds images anyway — and a second house standard
  for one job is a second place for it to drift. Its licence is free for commercial use with
  attribution APPRECIATED rather than required, which is what lets a storefront carry a photo
  without printing a credit line the merchant did not ask for.

  **LUMMI WAS THE OTHER CANDIDATE AND THE READING OF IT MATTERS.** Its licence page says
  outright "You don't have to ask for permission or credit the creator or Lummi", commercial use
  with no limits, forbidding only resale, bundling into a competing stock service, and claiming
  ownership. Its API reference separately says developers MUST attribute every image displayed.
  Those are two different obligations — one on the IMAGE (none) and one on API ACCESS (a
  guideline whose sanction is your key) — and conflating them, which the first reading here did,
  turns a free image into an imagined legal burden on the merchant. What actually ruled it out
  was operational: 10 requests per minute by default and an API key granted by application.

- **A PICTURE SLOT TAKES A REAL IMAGE OR SAYS SO IN WORDS — never a grey box, never stock.**
  A pattern library invites a placeholder, and both kinds are worse than an empty slot: rule 7
  already records that keyword stock is not a source (`loremflickr` answered "kids,clothing"
  with a cat statue), and a grey box reads as unfinished because it is. The site's OWN library
  is the honest source — measured on a live store, 164 assets, 50 of them images — so
  `sb_template_use` reads it and hands the pattern what the merchant already owns. A landscape
  is preferred where the layout wants one, which is rule 6 before the fact rather than after
  it. An empty library produces a sentence naming `sb_media_upload`, not a frame.

  **AND WHAT THE PAGE IS ALREADY SHOWING COMES OUT OF THE POOL.** Each call starts its own
  selection, so a hero added first and a gallery added second both reached for the same best
  landscape and the page showed one photo twice — which reads as a mistake because it is one.

- **AN AGENT ASKED FOR "A HERO" HAD 111 ELEMENTS AND NO LAYOUT.** Every band was invented from
  flex-blocks on the spot, which is why a generated page reads as generated — the elements are
  right, the composition is a guess, and the guess is different on every section of the same
  site. The platform's own library is the first place to look and it is THIN: measured on a live
  site, TWO section templates. `LAYOUT_PATTERNS` adds six defaults, listed by `sb_templates`
  under `built_in` (the site's own always first) and applied by `sb_template_use`, which needed
  no new tool and no new argument.

  **BUILT AS `Captured` TREES THROUGH `toSpecs`, never hand-assembled** — that is the whole
  design. The mapper already knows how to dress a section in the page's own tokens, give a row
  a stack breakpoint, and stop a stacked column becoming 280px of air; a pattern written by hand
  would re-derive all of it and drift from it on the next fix. The test pins the PROPERTY rather
  than any pattern's shape: every one is storable, every row has a mobile answer, and no pattern
  contains a colour that is not a token it was given.

  **AND A BLANK PAGE'S LOOK IS THE SITE'S THEME, NOT NOTHING.** Rule 0 says read the page's own
  pattern; a page that has none is the case the rule does not cover, and the next authority is
  the theme every element's style preset already resolves from — not invention. Carried as
  `var(--wb-color-…)` rather than the hex it resolves to, because a literal on a node OUTRANKS
  the preset beneath it permanently: a band that baked today's colour in would stop following
  the theme the moment the merchant changed it, which is the detachment this file already
  records for imported icons.

- **A `column` GROUP WAS BUILT AS A ROW, and `direction` had been read by nothing.** The capture
  never emits one — a column is what a page already IS, so it is flattened in the browser — so
  the field sat in `Captured` unread. The moment a caller composes a tree BY HAND (a layout
  pattern, a design ported out of Figma or Stitch) that stops being true, and every column came
  back as a row: a hero's heading, its sentence and its button side by side instead of stacked.
  Found by rendering the first pattern, not by reading the mapper.

- **A STACKED ROW'S COLUMNS WERE 280px TALL WHATEVER WAS IN THEM, and nothing could see it.**
  An imported row gives each column `flex: 1 1 280px`, which sizes the MAIN axis — and the
  row's own mobile override turns the main axis from width into HEIGHT. So at 390 a paragraph
  of two lines sat in a 280px box, and one real import measured **6,009px of page with most of
  it empty**. Zero review findings and zero layout findings at every width, because no box
  overflowed and no two boxes overlapped: **`measure` cannot see AIR**. Rule 3's mirror image —
  the stack breakpoint was there and correct, and the thing it changed underneath was the axis
  a basis applies to. Mobile-only reset to `0 1 auto`, base keeping the wide answer, because
  the row is still a row at tablet. 6,009px → 3,884px, same content.

- **AND THEN NOTHING LINKED THE IMPORTED PAGES TOGETHER, which the directive had been saying
  out loud since the tool shipped.** `sb_import_site` now builds ONE global `header` from the
  pages it created and gives every one of them a reference to it. Built from THOSE pages, never
  from the source's own nav — that one points at the site this was copied from, half of it at
  pages the cap left out, and its structure is somebody else's, which is why the capture skips
  page chrome in the first place.

  The shapes, both read off the platform rather than guessed and both verified against a live
  server: a global's `document` is page-document SHAPED but its `root_node_id` IS THE SECTION —
  compose carries its nodes over and re-parents that root onto the page's ROOT
  (`compose.go:133`) — so the section is built under a throwaway ROOT and lifted out with its
  parent cleared. A page REFERENCES one with a ROOT child that is a `flex-section` carrying
  `specials.globalRef` + `globalKind`, which is exactly what the platform's own decompose writes
  (`decompose.go:382`). It goes in FIRST: compose turns it into a real header, and a header
  after middle content is a band-order refusal on the next save. Measured end to end — create
  201, save 200, and the re-read page came back with the reference expanded into a stamped
  header whose menu carried the local paths.

  SKIPPED WHEN THE SITE ALREADY HAS A HEADER, because a second one is two headers rather than a
  menu, and under two pages, because a menu to one page is a link to itself. A page that will
  not take the header does not undo the header: the master exists and the others carry it.

- **AN IMPORTED SITE'S MENU LED BACK TO THE SITE IT WAS COPIED FROM.** A captured link keeps
  the source's ABSOLUTE URL, so `sb_import_site` built twelve pages and left no way to reach any
  of them — every click went off to the original. The most basic feature a website has, and the
  import was working against it. `relink` rewrites only the targets that were ACTUALLY
  imported: a same-origin link the page cap left out keeps its original URL and is COUNTED,
  because an off-site link that works beats a local one that 404s, and the count is what tells
  the caller to raise `max_pages`. The map is built before the first page is written, since
  page two's link to page seven has to work and page seven does not exist yet. **The FRAGMENT
  survives the rewrite**: `normalizeUrl` drops it because it is not part of a page's IDENTITY —
  that is exactly what folds `/a` and `/a#top` into one page — but it is very much part of the
  link, and blender.org's community page carries sixteen of them (`#vi`, `#de`, one per
  language section) that would all have collapsed onto the top of the page.

- **A FORM IS SEEN AND NOT REBUILT.** `FORM` sat in the ignore list, so a contact page arrived
  with no way to contact anybody and nothing saying why. Rebuilding one means guessing the
  `mapTo` vocabulary the server validates, which is the guess this catalog exists to remove —
  and `sb_store action:"form"` already owns it with all 17 templates. So the capture RECORDS
  what it saw (`forms_found`: field count and labels) and the result names the tool. The
  controls stay in the ignore list: a stray input outside a form is chrome, and the fields of a
  form that IS reported are counted rather than walked into.

- **THE IMPORT'S BIGGEST LOSS WAS A `<div class="footer-navigation">`.** Page chrome was
  detected by asking whether a `<header>`/`<footer>` was a DIRECT CHILD of `<body>`, which
  almost no real site satisfies — one wrapper div defeats it — and blender.org marks its site
  map with a class rather than the tag at all. Measured on `/about`: eleven sections of
  somebody else's link columns arrived as the page, and the page's own eleven headings and
  twenty-five paragraphs did not. Three corrections, each of which was necessary and none of
  which was sufficient:
  - **PAGE-LEVEL IS A SPEC QUESTION, NOT A DEPTH ONE.** A `<header>`/`<footer>` belongs to its
    nearest SECTIONING ancestor (`article`, `aside`, `nav`, `section`), so one with none of
    those above it is the page's however deeply wrapped. `<main>` is not sectioning content and
    does not shield a footer.
  - **ASK ABOUT CONTAINMENT, NOT EQUALITY.** The candidate walk deliberately takes the
    INNERMOST sections, and a real footer holds `<section>`s — so the candidates were the
    footer's own columns, none of which IS the footer.
  - **A CLASS NAME IS EVIDENCE FOR A FOOTER AND NOT FOR A HEADER.** The token must START with
    `footer` (so `card-footer` is not swept up), and the same trick on the header side would
    eat HEROES — blender's first band is `<div class="hero header-size-large">`. Losing the
    first thing on a landing page costs more than a stray footer, so a header is caught by its
    tag or `role="banner"` only; its links are `<nav>`, which is ignored already.

  **AND THE FIX'S OWN FIRST ATTEMPT NAMED THE SET `chrome`, WHICH IS A BROWSER GLOBAL.** The
  `const` landed in a nested scope, so every other scope resolved the name to `window.chrome`
  and threw `chrome.has is not a function` inside `evaluate` — killing the whole capture. Same
  shape as the closure trap this file already records for `page.evaluate`, reached from the
  opposite direction: not a name that is missing, a name that is already taken.

- **IFRAME WAS IN THE IGNORE LIST, so every embedded video and every map was unimportable.**
  The platform has `video`, `youtube`, `vimeo`, `soundcloud` and `google-map`, and a hero video
  or a contact page's map is an ordinary thing to bring over — it was the one class of content
  that could not survive the trip at all, and it left as a skip count. `youtube` and `vimeo`
  store the ID ALONE (`specials.videoId`); a whole watch URL renders an empty frame.
  `google-map` takes the embed URL under `src`, `soundcloud` takes it under `trackUrl`, and
  `<hr>` is a `divider`. None of them is given a style: every one seeds `width: 100%` +
  `height: fit-content` and `google-map` seeds a height per breakpoint, so a literal detaches
  the node from the element's own responsive answer to be less correct than it. What still has
  no element — an advert, a tracker, a comment system — is counted rather than guessed at.

- **FOUR MORE THINGS A CRAWL GOT WRONG, all measured on real sites.**
  - **`<link rel="canonical">` IS NOT A FLOURISH.** modelcontextprotocol.io's home page names a
    dated docs path as its own address, so `/` and that path are one page — imported twice
    under two slugs, with nothing in the plan looking wrong. Folded on the crawl path (where
    the answer is in hand) and again in the import pass (a sitemap cannot know it; only the
    open page can).
  - **ONE PAGE PER PAGE, NOT ONE PER LANGUAGE.** A multilingual sitemap lists every
    translation. Folded ONLY on a collision — a rule that simply dropped a `/xx/` prefix would
    empty the plan for nodejs.org, which serves everything under `/en`.
  - **PAGE 2 OF A LIST IS NOT A PAGE.** nodejs.org offered 539 of them. Narrow on purpose: an
    explicit `page` segment only, because `/blog/2024` is a year archive and a real page.
  - **`robots.txt` IS THE SITE'S OWN ANSWER** to the question the plumbing list guesses at, and
    a tool that fetches a dozen pages should obey it. Longest match wins, so an `Allow` under a
    `Disallow` is honoured; an empty `Disallow:` means allow everything and reading it as the
    empty prefix would block every path. The ENTRY is exempt — the caller typed it.
  - **`aria-hidden="true"` IS THE AUTHOR'S OWN MARK** for decoration and for duplicates: a
    carousel's clones, the mobile copy of a menu the desktop layout also carries. Measured 53
    on one page and 15 on another, every one walked. Nothing here reads the accessibility tree,
    so the attribute is the only place that answer exists — and re-measuring after showed it
    reclassifies rather than loses: the captured content was unchanged.

- **A NESTED LIST WAS TAKEN TWICE.** `querySelectorAll('li')` returns nested items as well as
  outer ones, and an outer item's `textContent` ALREADY contains its sublist — so every nested
  entry arrived once inside its parent's line and once again on its own, which on an imported
  page reads as a stutter nobody typed. Walked by DIRECT children, each item's own words
  separated from its sublist's, the sublist flattened after it. This platform's `list` is flat,
  so flattening is the honest translation and the reader's order survives.

- **A PATCH CARRIED THE NODE BY REFERENCE, AND `applyAndSave` APPLIES EVERY BATCH TWICE.**
  `addSubtree` emits `set nodes/<id>` whose value IS the node object it just built, then
  `insert` patches that push child ids into that node's own `data.nodes`. Assigning the
  reference means the first apply MUTATES THE PATCH: the batch is no longer the batch, and the
  second pass re-establishes a node that already holds its children and inserts them again.

  The second pass is not hypothetical — `6980ebb` (v0.16.1) added
  `validateForSave(d.preview(patches))` in front of `applyAndPublish(patches)` precisely so a
  refused write never lands, and that is a second application of the same objects. So from
  v0.16.1 until this fix, **every nested `sb_add` stored each child TWICE and every
  `sb_import` THREE times** (a third pass, through the staging copy). Measured on a real
  import: 106 of 231 containers listing one child id three times.

  It is silent in every direction. The tree is well formed, every id resolves, `validateForSave`
  passes, the platform accepts the save, and the page simply renders its content twice — so
  neither `sb_review` nor `sb_look` can name it. **No test caught it because nothing else in
  the suite applies a batch more than once**; the tests build patches and apply them exactly
  once, which is the one arrangement that is correct either way.

  `applyPatches` now clones an object value on `set` and `insert`, which makes the batch
  IDEMPOTENT for this shape: the re-`set` puts a pristine node back and the inserts rebuild the
  same list. Primitives pass through — a style key is a string, and cloning one on every
  `sb_set` would be pure cost. Pinned in `test/patch.test.ts` (the property) and
  `test/page-tools.test.ts` (the document that actually goes over the wire, which is the only
  place the defect was ever visible).

- **A GRID IS NOT A ROW, AND A ROW OF 279 IS NOT A ROW EITHER.** The import's flatness fix
  reads `display:flex|grid` and turns a container with two or more children into a real row.
  Every grid was taken as a single row with no upper bound, so a documentation site — whose
  content wrapper IS a grid — came back as one flex row of 279 columns: each column a sliver,
  every line of prose broken to one word, 80 nodes hanging past the viewport, on a page whose
  tree was perfect. A design row is a feature trio, a card shelf, a logo wall; past a dozen
  the container is the page's own content column and the browser is wrapping it. Capped at 12,
  and a grid now carries `wrap: true` — `flexWrap` reads `nowrap` on a grid because the
  property does not apply, and carrying that literally gave the columns nowhere to go.

- **WALKING INTO A CODE BLOCK PRODUCES RUBBLE.** Every syntax highlighter wraps each token in
  its own `<span>`, so the leaf walk took them one at a time: a twenty-line JSON config
  arrived as forty text nodes — `{`, `"mcpServers"`, `: {` — each its own block on its own
  line, and forty of the node budget spent to say what one node says. `PRE` and `CODE` are
  taken whole. Whitespace collapses like any other text, because this platform has no code
  element to preserve it in.

- **THE IMPORT COULD READ A PAGE AND NOT A SITE, and the missing half was never the
  capture.** `sb_import` takes a URL and writes into the OPEN page, so "here is our website,
  put it on Store Builder" — the thing people actually ask for — was a loop the agent had to
  run by hand: find the pages, create each, open each, import each, and get every step right
  with no tool checking any of them. `sb_import_site` runs it. What the work taught, each of
  which fails quietly:

  - **APPENDING TO ROOT BREAKS TRAP 3 ON ANY PAGE THAT HAS A GLOBAL FOOTER**, and this is the
    DEFAULT path: the entry URL is imported into the site's existing home page, which is
    exactly the page most likely to carry both globals. `data.nodes.length` puts the section
    after the footer, `checkBandOrder` refuses the save, and the caller is told about a band
    rule they did not knowingly break. `middleEnd()` is the index to add at — before the first
    footer-banded ROOT child — and `sb_import` had the same append, predating this.
  - **`URL.pathname` IS PERCENT-ENCODED, and this platform is Vietnamese first.** A slug
    derived from it turns `/trang-chủ` into `trang-ch-e1-bb-a7`, and an `include: ['/tin-tức']`
    matches nothing. `pathOf` decodes, guarded — a malformed sequence throws, and a path that
    cannot be decoded is better matched raw than not at all. NFD does not decompose `đ`
    either: it is a letter, not a d with a stroke, so `Đẹp` strips to `ep` without the
    explicit replacement.
  - **A SUBSTRING TEST DROPS REAL PAGES.** The plumbing list (`/cart`, `/feed`, `/comments`)
    matched with `includes`, so `/cartier-watches`, `/feedback` and `/comments-policy` were all
    thrown away and reported only as a number. A plain entry matches at a BOUNDARY — end, `/`,
    or `.` so `/wp-login.php` is still caught — and an entry written with a trailing slash
    matches that segment anywhere, which is how `/blog/tag/x` is caught. **Anchoring it at the
    START of the path was the first fix and it was half a fix**: a locale prefix is the
    ordinary shape of the sites this is pointed at and this platform's market is Vietnamese,
    so `/en/cart` and `/vi/account` sailed through. The needle begins with `/`, so its left
    boundary comes free — scan anywhere, test the right boundary only.
  - **FILTERING TWICE AND COUNTING ONCE IS HOW A REASON DISAPPEARS.** `canonFor` exists to
    stop a CRAWL spending a navigation on a PDF; `choosePages` decides what becomes a page and
    counts every rejection. A sitemap costs no navigation, so running it through the crawl
    filter saved nothing and meant the cart page vanished with no line in `skipped` saying so.
  - **ORDER IS PART OF THE ANSWER.** A sitemap lists what its generator emitted first, which
    on a shop is a hundred products; taking the first twelve gives a site with no home page.
    Shallowest first, entry always first.
  - **N URLS UNDER ONE PREFIX ARE NOT N PAGES HERE.** `/products/{slug}` resolves to the
    published page of type `product`. Imported as static pages they render a shop where every
    price is a literal and nothing is buyable, and `sb_review` then reports a missing purchase
    action on forty pages at once. The prefix and its count are reported BEFORE anything is
    created, because afterwards the fix is forty deletes.
  - **A COLLIDING SLUG IS SKIPPED, NOT CREATED.** The platform renames and answers 200 (the
    `uniqueSlug` trap this file already records), so a second run of the tool would silently
    double the site.
  - **TOKENS COME OFF THE SITE ONCE, NOT OFF EACH TARGET PAGE.** Most targets do not exist yet
    and the rest are blank, so per-page reading gives the first page element defaults and
    every later page the defaults of the blank page before it — rule 0 failing on every page
    at once.
  - **IT IS NOT ATOMIC AND MUST NOT PRETEND TO BE.** Each page is its own create and its own
    save, so one failure is an OUTCOME (`built` / `failed`, per URL with a reason), never an
    abort that leaves three pages built, nine not, and no report saying which.
  - **`depth` IS HOW FAR FROM THE ENTRY A PAGE MAY BE**, so the pages at that distance are
    results and are never opened — opening them would pay a navigation each for links the
    bound has already ruled out. The import pass opens them anyway.
  - **A SITEMAP FETCH LEAVES THE PLATFORM, so it carries no credential.** Every path through
    `request()` attaches one; a sitemap read through it would hand this install's `SB_TOKEN`
    to a stranger's server because the caller pasted a link.

  It publishes nothing, and it says so once: the source's header and footer are skipped on
  purpose (this site has its own as globals), no menu links the new pages together, and
  nothing has been seen at 390px.

- **A FUNCTION PASSED TO `page.evaluate` IS SERIALIZED, so anything it closes over is not
  there.** It compiles, every pure test passes, and it dies on the first real page. Measured:
  `capturePage` closed over a module-level `const HEADINGS` and threw
  `ReferenceError: HEADINGS is not defined` — in a file that already carried a comment saying
  exactly that about itself. The rule is therefore mechanical rather than a matter of care:
  everything such a function uses is either declared INSIDE it or passed as an argument
  (`settleDom` takes `{quiet, cap}`; the overlay opener takes `id`), and every evaluate site
  has a test behind `SB_BROWSER_TEST=1`, because nothing cheaper can catch it. A sweep after
  the fix found `shoot.ts`'s five sites already clean.

  The same run found the second half of the pair: `new URL(rel, base)` THROWS on a
  non-hierarchical base (a `data:` page), and a throw inside `evaluate` kills the whole
  capture rather than one link — so URL resolution falls back to the raw value.

- **`shoot()` POOLS ITS BROWSER FOR THE PROCESS LIFETIME, and a caller that forgets
  `closeBrowser()` never exits.** The pooling is deliberate — a vision loop shoots constantly
  and must not pay a launch each time — but the cost lands on every other call site, and there
  was a `beforeExit` handler that looked like it covered them and could not. `beforeExit` runs
  when the event loop DRAINS, and an open browser connection is precisely what stops it
  draining: in the one situation the handler described it was unreachable, and in the other it
  had nothing to do. Measured: a script that took one screenshot and returned was still alive
  twenty seconds later, and two such scripts were killed by the OS for memory during this
  repo's own work. `playwright-core` exposes no `browser.process()` for `launch()`, so there is
  nothing to `unref` and no way to make the handler reachable — it is gone, and the contract is
  written down instead. SIGINT/SIGTERM still close Chrome, which is the path the stdio server
  actually takes.

- **`sb_media_upload` FROM A URL WAS BROKEN FOR EVERY IMAGE TYPE, and the error blamed the
  file.** `uploadMedia` built `new Blob([bytes])` with no `type`, so the multipart part went
  out as `application/octet-stream`. The platform accepts a file whose DECLARED type starts
  with `image/` or `video/`, or whose EXTENSION is a known font or document — octet-stream is
  none of those, so a PNG fetched from a URL came back "only image, video, or font
  (woff2/woff/ttf/otf) uploads are supported". A message about the file, caused by a missing
  argument.

  IT ALSO PRODUCED A WRONG FACT IN THIS FILE. The same refusal on an SVG was recorded as "the
  platform deliberately refuses SVG". It does not — `ResolveUploadContentType` takes any
  `image/*`, and `image/svg+xml` is one. The lesson is the one this file already keeps for
  stale hints: a refusal quoted verbatim is evidence, but the READING of it is a guess until
  something else confirms it, and here the confirming step (upload a PNG) took one call.

  The header wins only when it says something: a CDN answering `application/octet-stream` for
  a PNG is ordinary, and it is exactly the value the platform refuses, so the extension is
  consulted whenever the declared type does not identify the file. The old tests pinned the
  file NAME and never the type, which is how this survived.

- **PINNING ARRIVED IN SEPTEMBER 2026, AND ALL THREE OF ITS FAILURES ARE SILENT.**
  `position: sticky` changes nothing a stylesheet can see when it engages — CSS has no
  `:stuck` — so `schema/src/stickyState.ts` (Go mirror `render/style/sticky.go`) has a runtime
  island toggle ONE class, `wb-stuck`, on the pinned element, and compiles every rule written
  for the pinned look against it: `#self.wb-stuck` for the node itself, `#host.wb-stuck #self`
  for a DESCENDANT, which is what lets a pinned header shrink its logo without the logo
  knowing what pinned it. Three things follow, and `src/domains/site/sticky.ts` holds all
  three because each is a write that disappears:
  - **The state needs a HOST.** `render/css.go` emits stuck rules inside
    `if stuckHost := stuckHostFor(...); stuckHost != ""`. A `stuck` override with no pinned
    self-or-ancestor compiles to nothing — stored, saved, published, ignored forever, the same
    shape as a binding outside the `specials` namespace. `sb_set` refuses it and names the node
    to pin; `sb_review` reports `stuck_no_host` for the document that got there another way.
  - **The seeds are not cosmetic.** The inspector writes `top: 0px` AND `zIndex: 10` the moment
    an author picks "Stick on scroll", and the platform's commit records the measurement:
    in Chromium, a pinned header with no z-index is painted OVER by any `position: relative`
    element in a later section the moment it scrolls past. 10 is specific, not large — above
    page content, below the overlay ladder the static CSS owns (cart scrim 40, drawer 41,
    pop-up scrim 50, pop-up 51), because a header outranking those would cover the drawer it
    opens. `sb_set` seeds both, never over an answer the caller gave.
  - **A clipping ancestor defeats it entirely.** Sticky resolves against its nearest SCROLLING
    ancestor, so `overflow: hidden|auto|scroll|clip|overlay` above it becomes that ancestor and
    the node pins inside a box that never scrolls. Warned by `sb_set` (in the dry run too, so
    the caller is not told after committing) and reported as `sticky_blocked`. The check starts
    at the PARENT: a sticky element's own overflow clips its children, not itself.

  `fixed` counts as pinned — "the moment the page has scrolled past where it would have been"
  is the same design — but it is not seeded, because it arrives as a deliberate placement, and
  it is exempt from the clip warning because the viewport is not an ancestor. `absolute` is
  deliberately not pinned: it scrolls away with the page. `stuckDecls` translates exactly ONE
  config key, `hidden`, into `display: none`, and only `true` — `false` would need
  `display: revert`, which `render/css.go` documents as wrong here because it rolls past the
  element's own static CSS to the UA default. `config.stuckAfter` (px of page scroll, per
  breakpoint) overrides when the island decides, and is refused on a node that cannot pin —
  `stuckAfterCss` emits it only for one that can, so it is the FOURTH silent drop in the same
  feature. IT USED TO BE THE ONLY GENERAL SCROLL HOOK THE PLATFORM HAD — the island toggles
  `wb-stuck` on a PINNED element and nothing else, and the only other scroll-driven behaviour in
  the runtime was `popup`'s `triggerType: "scroll"`, which opens a pop-up rather than styling
  anything. **That is no longer true**: `config.animation`'s `trigger: "view"` is reveal-on-
  scroll, compiled as `animation-timeline: view()` with no island at all. See the entrance
  animation entry below — and do not reach for a sticky host to fake one. `sb_import` carries `sticky`/`fixed` off a
  source page's computed style with all three keys, because a section pinned to stay in view
  is a layout decision and a copy that scrolls away is not the same section.

  **AND THE FIRST LIVE USE FOUND THAT THE MARKER NEVER REACHED A PUBLISHED PAGE.** `markStuckHosts`
  ran in `renderDoc`; a publish does not go through it — `pagerender.Render` compiles an
  artifact and assembles it — so `StuckIslandAttrs` returned "" for every node ever published,
  while `BundleCSS` (which runs on the document, OUTSIDE the artifact) shipped every stuck rule
  correctly. A live header had `#…​.wb-stuck{box-shadow:…}` in its desktop lane, its transition
  applied, and the class never once appeared. Every island test passed, because they all call
  the direct route. Fixed upstream (web_builder PR #98) with the assertion made through
  `Assemble(Compile(doc))` — what a browser actually receives. The lesson for THIS repo is the
  one the browser-server section of the design skill now carries: when a class never appears,
  the cart drawer is the control, because if no island hydrates the question is the deployment
  and not the page. The dev stack wired no runtime bundle in at all, so every island there was
  dead and the page looked fine — `docker-compose.yml` builds `./server`, which ships the
  binary alone by design, and nothing brought a bundle in from the host (web_builder PR #99).

  **AND THE HOST IS NOT ALWAYS THE PARENT — that seam opened three days later.**
  `specials.hoverHostDepth` (base-only, 1-based, NEAREST FIRST) picks which ancestor a
  parent-hover rule hangs off, because the moment an author groups a few things inside a card
  the nearest box becomes the group and "hover the whole card" stops being reachable. A depth
  past the end of the chain CLAMPS to the outermost box rather than going dead — the chain
  shortens whenever a wrapper is deleted. The inspector has a picker AND a label naming the
  box; an agent has neither, so `sb_set` reports which box the rule hung off, lists the wider
  ones on offer, and says when a depth clamped. Depth is a DEPTH rather than an id on purpose:
  duplicate a card and the copy's state points at the copy's own ancestor.

  The same work also landed the thing this repo had already fixed independently: **state
  overrides write PER BREAKPOINT** (`responsive[bp].states`), which both compilers had always
  read and only the editor never wrote.

- **HOVER HAS TWO HOMES, AND THE OBVIOUS ONE IS WRONG FOR TWELVE ELEMENT TYPES.** The platform
  grew a UNIVERSAL hover state in September 2026 alongside the pinned one
  (`schema/src/hoverState.ts`, Go mirror `render/style/hover.go`): `states.hover` compiles to
  `<self>:hover`, and `states.parentHover` to `<parent>:hover <self>`, both inside
  `@media (hover:hover)`. But the universal compiler DELIBERATELY STANDS ASIDE for every element
  whose meta declares a Hover variant of its own — twelve of them — and the meta's `storage`
  field says where each of those actually keeps it. A `button` keeps it in `config.stateHover`, a
  FLAT, BASE-ONLY map its own renderer compiles; the editor routes a hover edit there on purpose
  ("a hover edit on a button must go on being the button's :hover rule",
  `editor/src/trait/values.ts`). MEASURED on one publish of one page: `state:"hover"` on a
  product card's dataset-block emitted `#card:hover{…}`; the identical write on the BUTTON inside
  it emitted nothing, and writing the same values to `config.stateHover` produced the rule on the
  next publish. Every hover this server had ever written onto a button was stored where no
  compiler looks. `HOVER_HOMES` is generated from `storage`, and `sb_set` routes and says so.

  **THE FIRST DIAGNOSIS OF THIS WAS WRONG, AND THE WAY IT WAS WRONG IS THE POINT.** Grepping the
  renderers for `node.States` found only four files — none of them an element's own `css.go` —
  so the conclusion was "no element compiles `states.hover`; the exclusion list is false for all
  seven non-satellites". A probe that rendered one node per type and looked for the value in
  `BundleCSS` disproved it: the filters and `text-dataset` DO paint, through shared helpers the
  grep could not see, and a patch built on the grep would have emitted a SECOND rule for each of
  them — exactly what the exclusion exists to prevent. The absence of a string is evidence about
  the string, not about the behaviour; only rendering a node answers "does this paint".

  What the probe DID find looked like a platform gap and was a SECOND namespace mistake of the
  same kind: **`product-image-list` declares `storage: 'node'`, and nothing compiles its
  `states.hover.style`** — but its own compiler was already reading the state slot's CONFIG.
  `render/style/satellite.go`'s `CompileImageListItemBorderCSS` takes
  `MergeStateNs(node, state, "config", bp)` and emits
  `.wb-product-image-list__item:hover::after`, for exactly `listItemBorderWidth` (which must be
  PRESENT on the state, even 0, or the whole rule is skipped — the state is read RAW, with no
  fallback to base), `listItemBorderColor` and `listItemBorderStyle`. So the probe was right
  about the namespace it probed and wrong about the element, and the note it produced told
  callers to give up and style a wrapper. `hoverRoutingNote` now names the route that works.
  The lesson is the probe's own, applied one level down: rendering a node answers "does this
  paint" only for the namespace you rendered.

- **A CATEGORY TEMPLATE NOW SCOPES ITSELF TO THE CATEGORY IN THE URL, and this file said the
  opposite for a day.** `/collections/{slug}` (the prefix is `collections`, not `categories`)
  resolves through `PublishedForEntity`: the category's OWN page when a page-link names one,
  else the DEFAULT TEMPLATE for the `category` page type. That template is one document serving
  every category, and until 2026-09-09 nothing narrowed its product feed — `entityScope` threaded
  the entity into the ARTICLE feed for a `blogCategory` and the REVIEW feed for a `product`, and
  `productCategory` reached the products feed as nothing at all, so every category listed the
  whole catalogue with no error anywhere.

  `b4ca5645` closed it, and closed it where the product KINDS are decided rather than by
  narrowing the feed. `pagerender.go:2264` threads the entity as `pageCollection` for
  `linkType == "productCategory"`; `render/nodes/list-dataset/html.go:328` reads it. So:

  - **`all_products` on a category page means THAT category.** The shared default template is
    now correct for every category, which is what an agent should reach for first — one page,
    one repeater, left on the kind it is born with.
  - **A repeater pointed at a NAMED collection keeps naming it** (`collectionType: "collection"`
    + its own `collectionId`). Deliberate: a "you may also like" shelf of another category on a
    category page is a real design, and the page must not overrule it.
  - `related` / `featured` / the curated slots read no `collectionId` at all, so the scope
    reaches none of them.

  The two older shapes still WORK and are still the way to give one category a page of its own —
  `PUT /api/sites/{siteId}/page-links/{linkType}/{linkId}` with `{pageId}` (or
  `POST …/page-links/bulk` with `{linkType, linkIds, pageId}` for many), and
  `PUT /api/sites/{siteId}/pages/{pageId}/default-template`, which decodes NO body. They are no
  longer required for correct scoping, and building a page per category to get it is now work
  for nothing.

  **THE SCOPE IS EMPTY IN THE DRAFT PREVIEW** (`render/html.go:637` answers "" with no scope),
  so a category template previews listing the whole catalogue however right it is — the same
  population of pages the `sb_look` entity-template caveat already covers. Judge it at
  `/collections/{slug}` on the published storefront.

  This entry is kept in the shape "it used to be X, it is now Y" on purpose. The previous
  version was written the same afternoon the platform fixed it and prescribed a page per
  category as the remedy, which is exactly the stale-hint cost this file records for agent keys
  and for storefront accounts: a fact verified once is not a constant, and a hint that says
  "you cannot" outlives the thing that made it true.

- **DESIGN RULE 0 FAILED BY CONSTRUCTION ON NINE ELEMENTS, and nothing said so.** "Read the
  page's pattern off what is there" assumes a node's `style` HOLDS what it paints. Since
  `THEME_VERSION` 6 that is false: element defaults are moving OUT of `meta.defaults.style` and
  into theme PRESETS the element wears, and `icon/meta.ts` states it outright — "The COLOUR
  lives in the `icon-default` style preset, not here: a node's own slot outranks its preset, so
  seeding it made every other icon preset unable to repaint it." Nine metas already carry one
  (`icon`, `button`, `heading`, `text`, `image`, `flex-section`, `text-dataset`,
  `quantity-input`, `search-input`), and `DEFAULT_THEME` ships 58 presets.

  A preset compiles to a CLASS rule BENEATH the node's own values (`compilePresetCSS`), so the
  layer is real and ordered — and it was invisible to every tool here. `sb_node_read` on an icon
  returned a style with no colour, on a page visibly painting one, so an agent following rule 0
  read nothing and invented a literal. That literal then OUTRANKS the preset permanently: the
  node stops following the theme, and the next palette change moves every other node and not
  that one.

  `sb_node_read` now returns a `preset` block — what it paints, with every `var()` chain
  flattened, plus which keys the node has already overridden — and `sb_set` says once per preset
  when a literal is about to detach a node. The chain is three deep in the ordinary case
  (`var(--wb-sc-heading, var(--wb-color-heading))` → scheme role → palette token → `#111827`),
  which is why the raw string is not an answer.

  **THE SITE'S THEME IS THE AUTHORITY AND THE STARTER IS NOT.** `GET /api/sites/{siteId}/theme`
  is fetched and cached per site; `STARTER_THEME` is the fallback and the origin travels with
  the value, because handing an agent the starter's `#111827` for a site whose heading token is
  rose is a confident wrong colour — worse than none. A node naming a preset the theme does not
  hold is reported by id rather than resolving to nothing, which is the exact failure
  `THEME_VERSION` 6 was bumped for. `src/domains/site/theme.ts`, pinned by
  `test/theme-preset.test.ts`.

- **THREE ELEMENTS RENDER CONVINCINGLY WHILE WIRED TO NOTHING, and it is the one silent shape
  neither check can catch.** `sb_review` reads the tree and the tree is correct; `sb_look`
  photographs the page and the page looks right. So the fact has to be delivered when the
  element is ADDED, which is what `src/domains/site/inert.ts` does.
  - `locale-switcher` below two locales gets a FABRICATED chip. `localeSwitchPayload` returns ""
    and the renderer falls back to `sample = {Code:"VI", Name:"Tiếng Việt", Currency:"VND",
    Flag:"🌐"}`, deliberately, "so the element is never an empty box". It names a language and
    switches nothing.
  - `breadcrumb`'s ROOT crumb is the one word no entity supplies: `specials.homeLabel`,
    defaulting to the English "Home". **The trail itself IS derived and the labels ARE
    authorable** — the hardcoded "Home" / "Product detail" in `html.go:126,132` is the PRE-TRAIL
    branch, kept byte for byte so that adding the trail republished nobody's page differently,
    and reading it as the live path was a misreading worth recording: the element's own AI hint
    ("Always start with 'Home'") is CORRECT, not stale.
  - `spline-scene` — the platform's 112th element, and the SHARPEST of the three, because its
    placeholder is not a placeholder. `specials.sceneUrl` is seeded with a REAL
    `prod.spline.design` link, so a scene added and never configured loads, renders, responds
    to the mouse and publishes — somebody else's 3D work, on the merchant's domain, looking
    completely finished. The other two describe an element that is unfinished; a screenshot
    ENDORSES this one. Set it to the merchant's own export (Spline: Export → Viewer, the
    `…/scene.splinecode` link) and set `posterUrl`, or the box is blank until the ~600 KB
    engine chunk arrives.

- **EVERY STORE PAGE TYPE OPENED PRE-BUILT FOR A MERCHANT AND BLANK FOR AN AGENT, and this
  server's own tool description asserted the blank as if it were the platform's.**
  `sb_page_create` said "It arrives empty" for as long as `editor/src/element/storePageSeeds.ts`
  has been seeding — a product page opens with "gallery, title, price, variant picker,
  description, quantity stepper, Add to cart and Buy it now — already arranged and already
  bound".

  That file's opening comment is the argument for taking it, and it is about the AUTHOR rather
  than the canvas: "the blank was not the problem — what the author had to already know was."
  An agent was in exactly the position the merchant was rescued from, and worse — it cannot see
  the palette card it is failing to reproduce, and the button's `add_to_cart` is a BINDING
  rather than a click action, which is the single thing hardest to guess.

  `STORE_PAGE_SEEDS` is generated by CALLING `buildStorePageDocument`, never by copying it, so
  the day a palette card gains a piece it arrives at both doors. Six types: product (24 nodes),
  category, search, blog, post, complete. Codegen asserts the buy box still carries
  `add_to_cart` AND `bind-product-action`, because "it has nodes" is not proof a product page
  still buys anything. `sb_page_create` seeds by default and takes `seed:false`; the seed is a
  SECOND write and a refused one leaves the page created and blank rather than failing the call.

  **AND IT FOUND THE ROOT CAUSE OF A DEFECT THIS FILE ONLY HAD THE SYMPTOM OF.** The `rootId`
  entry above records that a page document carrying the alias "renders an EMPTY `<body>` with a
  200 — the order-complete page of a real store did exactly that", and never said where the
  alias came from. It came from the platform's own seed:
  `editor/src/element/completionPage.ts:91` was `return { rootId: 'ROOT', nodes }` — no
  `root_node_id`, and no `schema_version` either. So that real store got its blank page from the
  editor, and so did every merchant who created a completion page through it; the canvas reads
  the alias, and only the RENDERER disagrees.

  FIXED UPSTREAM in `8e40bbab` (web_builder), which is where it belonged — this client could
  only ever repair its own copy while the editor kept minting blank pages. The type system had
  forbidden that line the whole time (`PageDocument` requires both fields, `schema/src/node.ts`),
  and it survived because `npm test` there is `vitest run` and never typechecks; only
  `npm run build` does. **A generated catalog is a typechecker pointed at the platform**: this
  surfaced as a TS error the moment the seed was captured into a typed table, which is the
  argument for capturing rather than copying.

  The normaliser stays, and it now passes the fixed source through byte-identically — which is
  what a good normaliser should do. The OTHER five seeds are asserted alias-free so it can never
  become a blanket coercion that hides the next one.

  The thank-you sentence is read from `editor/src/i18n/locales/{vi,en}/payments.json` rather
  than defaulted here: seeding an English line into a Vietnamese store is the defect
  `default_seed_copy` reports on everybody else's seeds.

- **A CONFIG KEY'S LEGAL VALUES WERE UNREADABLE, AND GUESSING ONE FAILS SILENTLY.**
  `sb_traits_for` names 471 controls, 138 with a declared write target — and NOT ONE said what
  that target accepts, because every trait in `schema/src/traits/registry.ts` declares
  `schema: { type: 'string' }`. The vocabulary lives in the Vue component that draws the picker,
  which is a place no agent can read.

  The platform's own test states the consequence:
  `EffectiveCollectionType("bestseller")` returns `all_products`
  (`render/tests/collection_test.go:227`). `EffectiveX` is a NORMALISER, not a validator — so a
  repeater set to a plausible word (`bestseller`, `featured_products`, `newest`) stores, saves,
  publishes and renders THE WHOLE CATALOGUE under whatever heading the author wrote above it,
  with no error at any step. Same shape for the two siblings: an unknown `articleSourceType`
  reads as `category`, an unknown `collectionListType` as every collection.

  `CONFIG_VALUES` is generated from the GO normalizers rather than the editor's frozen objects,
  because the Go is what RENDERS — `EffectiveX(stored)` IS the answer to "what will this do".
  Each is a run of `if stored == Const { return Const }` arms over a trailing `return Fallback`,
  which recovers the vocabulary AND the value a guess collapses to. It also recovers the
  ALIASES, which are half the answer: `category` is a working spelling of `collection` that the
  picker never writes, so a document holding it is CORRECT and an agent told otherwise would
  "fix" a working page.

  Two things this closes that nothing else did. `slot` and `featured` were **unnameable through
  any tool** — the curated-shelf and merchandising kinds existed in the renderer and in no
  catalog. And the keys that most need a vocabulary are the UNDECLARED ones: `collectionType` is
  in `list-dataset`'s defaults and its control list with no `TRAIT_WRITES` entry, so the first
  version of this — attaching a vocabulary to the control that declares the write — reached
  exactly none of them. It attaches to the ELEMENT, over its own config keys.

  **NO NEW TOOL, deliberately.** It rides inside `sb_traits_for`'s result as `config_values` and
  `sb_set`'s `value` warning; `tools/list` did not grow by a byte and the budget test still
  passes. This server answers 495 operations through one call sheet rather than a tool per
  surface — a vocabulary is knowledge, not a verb, and knowledge belongs in a result.

  A WARNING, never a refusal: the platform accepts the value, so refusing would invent a rule
  it does not have and would block a caller writing a word a newer deployment understands and
  this catalog does not.

- **A MULTI-LANGUAGE STORE WAS REACHABLE AND UNSAFE, and the unsafe half breaks the page
  rather than degrading it.** Every translations route is in the catalog — read, write,
  `/auto`, `/pending`, `/progress`, `/review` — so an agent could call all of them and had NO
  way to know which fields are content.

  `schema/src/elements/translatableFields.ts` is the registry, and its opening comment states
  the danger: the element registry declares 117 `(element, special)` pairs across 66 keys and
  they are INTERLEAVED in one object —

  ```
  text · label · alt · emptyText · searchPlaceholder            ← content
  htmlTag · videoId · filterSource · contentType · src · name   ← NOT
  ```

  — and translating one of the second group "does not degrade the page, it breaks the
  render": `name` is a lucide ICON id, `src` is a URL, `filterSource` is a registry id the Go
  predicate switches on. An agent walking a page document and translating every string it
  finds hits all three, and the page it hands back renders wrong with nothing saying why.

  Generated whole rather than as an allow-list — 141 translatable specials across 58 elements,
  **156 keys classified NEVER**, 12 entity types with their columns and SEO fields — because
  the registry's own tripwire asserts every special is CLASSIFIED rather than asserting the
  translatable ones are listed: "a positive-only test stays green forever while new elements
  quietly add strings that are untranslatable by omission". Taking the classification keeps
  that property on this side. Codegen asserts the two poles — `icon.name` still never,
  `heading.text` still yes — because if either flips the table describes a different platform.

  AN EMPTY ANSWER IS THE COMPLETE ANSWER. `icon` has no translatable special at all, and
  `sb_traits_for` reports the empty list rather than omitting the field, so a caller cannot
  read silence as "nobody classified this yet".

  `node` is in the entity-type list with NO column list, deliberately: a node translation is
  keyed by (node id, specials key), so its vocabulary is per element and lives in
  `sb_traits_for`. Recording an empty answer for it would read as "nothing on a node is
  translatable", which is the opposite of true — so the call sheet says that in a sentence.

  **NO NEW TOOL.** It rides inside `sb_traits_for`'s result as `translatable` and on the call
  sheet `sb_api_find` already prints for any `/translations` operation — the surface the agent
  is already reading when it decides what to send.

- **THE ENTRANCE ANIMATION WAS OFFERED BY 73 OF 111 ELEMENTS AND DESCRIBED BY NOTHING, and all
  FOUR ways of missing it are silent.** `config.animation` is the panel every visible element
  carries, and `AnimationTypeOf` answers `""` for each miss — no keyframes, no per-node rule, no
  error — through save, publish and render. The catalog now carries `ANIMATION`, read from
  `server/render/style/animation.go` for the reason `CONFIG_VALUES` is read from the Go: that is
  what RENDERS.
  - **It is an OBJECT, not the string the control's name invites** —
    `{active, type, easing, delay, duration}`. `readAnimConfig` asserts
    `map[string]interface{}`, so a bare `"fade_in"` is the zero value.
  - **`active: true` is REQUIRED and a stored `type` is deliberately NOT consent.** The panel
    keeps `type` when the switch goes off so switching back restores the choice; the platform's
    own comment says treating it as consent "would animate a node the author had explicitly
    turned off".
  - **The type is UNDERSCORED.** `AnimKeyframes`'s comment flags it outright — "keyed by the
    STORED value (`fade_in`, not `fade-in`)" — and `fade-in` is what every other web tool spells
    it, so it is the spelling an agent reaches for first.
  - **IT WAS BASE-ONLY AND IS NOT ANY MORE — this bullet is kept as a correction because it
    was written here as a settled fact.** `render/css.go` used to emit it into the base lane
    under the comment "Base-only, because the config object is base-only", and `readAnimConfig`
    indexed `node.Config["animation"]` with no responsive merge, so `sb_set` wrote it per
    breakpoint into a slot the renderer never read. That was fixed upstream by adding
    `animation` to `BASE_ONLY_CONFIG` so `baseonly.ts` would ROUTE it to base.

    Then intensity arrived and ended the justification, in the platform's own words: the old
    defence was "one behaviour declaration, not a quantity", and **a distance IS a quantity**,
    which this repo's mandate says must reach the page per breakpoint.
    `CompileEntranceAnimationCSS` took a `bp`, the key LEFT the ledger, and the routing stopped
    on its own — because the table is GENERATED rather than copied, which is the whole argument
    for generating it. What the caller gains is the thing merchants ask for most: an animation
    that is off on mobile.

    The tripwire that caught this was written on BOTH sides and fired on the platform side
    first (`schema/test/responsive-defaults.test.ts` pinned the ledger entry to the compiler's
    signature, and the platform's own commit records that it was "caught by the tripwire rather
    than by review"). The mirror here now pins the key OUT of the ledger, so a reappearance —
    which would silently force every animation back to base and drop the mobile answer — is
    caught from the other direction.

  `easing` is the mild case and is reported differently: an unrecognised value falls back to
  `ease`, so the animation RUNS wearing a curve nobody chose. The first version of the trait
  attachment was a six-field object on 73 elements; `test/token-budget.test.ts` caught it
  at 12,396 bytes, correctly — the facts fit in one line, and the long form belongs in
  `sb_set`'s warning, which fires at the moment the mistake is made.

  **AND THE OBJECT IS NOW TEN KEYS, NOT FIVE — `intensity`, `trigger`, `range`, `repeat`,
  `alternate`.** A catalog describing five of ten is worse than one describing none: an agent
  reads the table, sees the shape it names, and concludes the rest does not exist. Two of them
  change what is POSSIBLE rather than how it looks, and one publishes a node nobody can see:

  - **`trigger: "view"` IS REVEAL-ON-SCROLL, and this file said for months that it had no
    answer at all** ("a section that fades in as the visitor reaches it cannot be authored by
    any tool here, because the platform has nowhere to put it"). It has one:
    `animation-timeline: view()` now ships in all four engines, so the trigger compiles to an
    `@supports` OVERRIDE on top of the plain rule — no island, no JavaScript, no HTML change,
    and the engines that lack it keep animating at first paint, so nobody gets nothing. `range`
    is the completion point as a percentage of entry, clamped 1-100, default 60.

    THIS IS THE THIRD TIME A "YOU CANNOT" HERE OUTLIVED THE THING THAT MADE IT TRUE — after the
    agent-key rules and storefront customer accounts. The pattern is now unmistakable enough to
    state as a rule: a capability this file reports as ABSENT is worth re-measuring before
    building around its absence, because the cost is not a wrong fact, it is work designed
    around a limit that is gone.

    What genuinely has no answer is a FIXED-DURATION play-once on entry: a view timeline
    scrubs with the scroll, and the platform's own comment says that mode needs JavaScript and
    will arrive as a THIRD trigger value rather than by redefining `view`.

    **AND ENABLING IT IMMEDIATELY BROKE `sb_look`, which is worth reading before adding any
    other motion.** A view timeline's progress is a function of where the element sits in the
    SCROLLPORT — and `shoot`'s lazy-image walk scrolls the page and then RETURNS TO THE TOP, so
    every revealed section is back at its `from` keyframe, `opacity: 0`, at the moment the
    shutter opens. MEASURED on a four-band probe: the revealed band photographed ENTIRELY
    BLANK and the other three came out correct. The honest reading of that picture is "this
    band is broken", which sends the caller to fix a page that works — the same cost the walk
    itself exists to prevent, arriving by a route the walk CANNOT fix, because the walk's own
    return to the top is what causes it. `fill: both` gives a second way in: it applies the
    `from` keyframe during a `delay`, so a long enough delay photographs blank too.

    `settleAnimations` puts `animation: none` on everything before the shot, because a still
    picture wants the page a visitor ENDS UP looking at and the settled state of every entrance
    effect is "visible". Forcing `animation-timeline: auto` instead was tried and is wrong: it
    RESTARTS the animation against the document timeline and the shot catches it mid-flight,
    measured at opacity 0.317.

    The test diffs two shots — the same page with and without the `@supports` block — because
    they must photograph identically once settled. The FIRST version applied the override
    inside the test and asserted on the result, which stays green with the fix deleted from
    `shoot.ts` entirely; it was replaced after checking that the new one actually goes red.
  - **`alternate` with a FINITE repeat publishes an INVISIBLE node**, which is why the renderer
    refuses it rather than shipping it. An even iteration count finishes on the `from` keyframe
    and every entrance keyframe starts at `opacity: 0` — so the author watches it play on the
    canvas and the visitor sees a node that is never shown, with nothing on screen to explain
    it. `alternate` is honoured only alongside `repeat: "infinite"`; `sb_set` warns.
  - **An absent `intensity` is NOT `medium`.** It keeps the old 0.5s duration fallback rather
    than the one the intensity implies (0.4 / 0.6 / 0.9), because a node marked `strong` would
    otherwise travel 64px in the time meant for 30.

  All ten are generated (`ANIMATION`), each under one rule: a field ABSENT from the platform
  means this deployment lacks it and the catalog says nothing; a field PRESENT but no longer
  parsing exits 1, because the table would then be WRONG rather than missing. The 46 type names
  ride in `sb_traits_for` as DATA (`animation_values`) rather than in prose — the budget test
  caught this same field a second time, at 14,347, and the fix was to cut the explanation, not
  the names: a name is the one part an agent cannot author an animation without.

- **THE SITE'S THEME WAS READABLE AND, IN PRACTICE, UNWRITABLE — the highest-leverage design act
  was the one thing the tools pushed an agent away from.** `src/domains/site/theme.ts` carried
  read helpers only, and `PUT /api/sites/{siteId}/theme` has the body shape `{theme: object}`
  because the SERVER genuinely does not know the shape (`sitetheme.Theme.Data` is a
  `json.RawMessage`; its comment says the editor owns it). So an agent wanting a rose-and-ink
  storefront had exactly one move — paint literals on nodes — which this file already records as
  detaching each node from its preset PERMANENTLY.

  `sb_theme` is a tool rather than a call-sheet entry for one reason: the write is a
  WHOLE-DOCUMENT REPLACE against a surface with NO HISTORY, and the operation an author actually
  wants is a PATCH. The only safe way to spell a patch on a replace-only endpoint is to read the
  document, change the named fields and send the whole thing back — so there is deliberately no
  argument here that can express "drop everything else". A token id or style slug the site does
  not have is REFUSED with the real ones named, because every preset resolves through those ids
  and an invented one would be stored and read by nothing.

  A site that has never saved a theme answers `200 {"theme": null}` — the platform calls that
  "the NORMAL first-visit state" — so the first write is built from `STARTER_THEME` and stores a
  COMPLETE theme rather than a palette with one token in it.

  **AND THE PLATFORM USED TO ACCEPT `{}`.** `validTheme` asked only "is this a JSON object", so a
  body missing `colors` was stored: the site lost every colour token, every text style and all 58
  presets, with a 200 and nothing to restore from. Fixed upstream — the gate is deliberately WEAK
  (one recognised top-level key, not a required set), because requiring `colors` would refuse a
  shape the editor has not shipped yet, and the colour/text-style shape stays the editor's to own.

- **AN APP'S BLOCKS WERE REACHABLE AND UNUSABLE, and a marketplace app cannot be installed from
  here at all.** Trap 5 already records what an app block IS; what nothing recorded is how to
  make one. `page/appblocks.go` holds the format — `specials.appBlockRef` is
  `"<installId>/<blockKey>"` — and both halves come back on every row of
  `GET /api/sites/{siteId}/apps/blocks`. So an agent had the list, the route, and no way to turn
  a row into a node. It rides on the `/apps` and `/builtin-apps` call sheets now, with the two
  silent traps beside it (never author the composed stamp; an edit inside a composed block is
  stored nowhere), because placing one is `sb_add` and no tool needed adding.

  The install half splits cleanly and the split is the platform's, not this client's.
  `POST /api/sites/{siteId}/builtin-apps/{key}` is reachable and takes one of EIGHT keys — mail,
  multilingual, agent, chat, booking, loyalty, payments, courses.

  **AND "A MARKETPLACE APP NEEDS A HUMAN" WAS TOO COARSE, WHICH IS THE SECOND TIME THIS FILE
  HAS RECORDED A CREDENTIAL RULE MORE STRICTLY THAN THE PLATFORM HOLDS IT.** Two of the five
  `/oauth` routes are the MERCHANT's rather than the app's, and reading them says exactly who
  may do what:
  - `GET /oauth/authorize-info` answers the app, its publisher, its privacy policy, the SCOPES
    it would hold, and the money half — `paid` is always present, so "free" is an answer rather
    than a missing key. SUGGESTING an app is therefore always available, on any credential.
  - `POST /oauth/authorize` records the grant, and `Authenticate` parses an ACCESS TOKEN — so a
    SESSION reaches it and a `wbk_` agent key does not. That is a deliberate line, not an
    oversight: an installed app holds scopes against the store, so the decision belongs to
    whoever owns the account. With `SB_EMAIL`/`SB_PASSWORD` this server can complete one.
  - `acceptedPrice` is a POINTER. Omitting it means a FREE app; omitting it for a PAID one is
    REFUSED rather than having a price assumed on the merchant's behalf. Nothing automated can
    commit anybody to a subscription.

  So the answer is neither "ask a human" nor "just install it": always be able to SUGGEST, show
  the scopes, and install only what the credential in hand is allowed to install. Both routes
  carried no `@Router` line until `831801fa`, so the flow was findable only by reading Go.

  **AND THE ONE PLACE THE INSTALLABLE SET EXISTS ON THE WIRE NAMED TWO OF THE EIGHT.**
  `GET /builtin-apps` answers what is INSTALLED, so the `key` parameter's own description is the
  whole answer to "what can I install" — and it read `"App key (mail | multilingual)"`, written
  when those were the only two. swag copies that string into `swagger.json`, this catalog copies
  it out, and it reached the call sheet verbatim. Fixed upstream and pinned there against
  `builtinapps.Keys` rather than a retyped list. The lesson is the one this file keeps for stale
  hints: a description is not a comment when a generator reads it.

- **A PAGE BUILT ENTIRELY BY THESE TOOLS WAS MEASURABLY WRONG, AND `sb_review` CALLED IT
  CLEAN.** Four bands from the built-in patterns, real photographs, the theme's own palette —
  and photographed at 1440 it carried four defects, every one of them invisible to a check that
  reads the tree. This is rule 1 restated from the other end: a tree cannot be badly
  proportioned, so only the render can report proportion.
  - **NO MEASURE.** Every block came out 1392px wide, so every heading and paragraph was set on
    a 1392px line — around 200 characters where prose reads at 60-75. `sectionMaxWidth` existed
    and is read off the TARGET page, which answers nothing on a blank one. Unbounded was a
    decision too, and the worse one; `THEME_TOKENS` now carries `1200px`, the same class of
    answer as the `64px 24px` padding the mapper already commits to.
  - **A WRAPPING ROW CANNOT MAKE EQUAL CELLS.** `flex: 1 1 <basis>` lets every item absorb the
    free space on ITS OWN LINE, so a gallery of five photographs came out as four cells of
    330×220 and a fifth of **1392×420** — the same picture, four times the size, under the
    others. Dropping the grow factor buys a ragged right edge on every full line;
    `repeat(auto-fill, minmax(280px, 1fr))` is the thing actually wanted, and the platform
    renders it (verified against a live server before it was written). Mobile gets
    `gridTemplateColumns: 1fr` BY NAME, because `flexDirection: column` says nothing to a grid
    and a mobile override that silently does nothing is rule 3 failing with a value in the
    document to prove it tried.
  - **THE PAGE HAD ONE TYPE SIZE.** The theme ships `heading-1` (48px) through `heading-6` and
    `text-1`..`text-3` — a real scale — and every heading rendered at 48px whatever its level,
    because the mapper wrote `htmlTag` and nothing else and the `heading-default` preset pins
    `fontSize: 48px` FLAT. A section title and the three item titles beneath it came out
    identical on a document that correctly said h2 and h3. "About four type sizes rather than a
    fifth that differs by 2px" is the checklist item; the page had ONE. Worn BY REFERENCE —
    `var(--wb-ts-<slug>-<prop>)`, which is what the editor's own picker stamps, plus
    `config.textGlobalStyle` to record the pick — because a literal `36px` would outrank the
    preset permanently. SIZE AND LINE HEIGHT ONLY of the eight keys a style controls: colour and
    weight are already answered by the tokens read off the target page, and overwriting those
    would make an imported band stop matching the page it landed on. `TEXT_STYLE_KEYS` is
    generated from `editor/src/theme/textStyle.ts`; every ref carries the element's former
    answer as its CSS fallback, so a slimmer theme renders exactly as it did before.
  - **A ROW HAD ONE CROSS-AXIS ANSWER FOR TWO DIFFERENT SHAPES.** `alignItems: flex-start` is
    right for a row of equal-weight columns — three blurbs of different lengths should share a
    top edge — and wrong for a row of unequal ones: the hero's 154px text column sat beside a
    420px photograph with 266px of dead space under it. `Captured.align` carries the answer, the
    hero asks for `center`, and `capture` now reads the SOURCE's own `alignItems` for the same
    reason it reads `position` — a hero that centres its words against a tall photograph is
    making a layout decision, and a copy that top-aligns them is not the same band.

- **TWO MORE THE RENDER SHOWED ONLY AFTER THE FIRST PASS WAS FIXED.**
  - **A CENTRED BAND WAS CENTRED IN ONE PLACE AND NOT THE OTHER.** The pattern set
    `textAlign: center` on its section, and every descendant should have inherited it — except
    the theme's `heading-default` preset declares `textAlign: left`, and a CLASS RULE BEATS AN
    INHERITED VALUE. Measured: the heading and the sentence sat hard left at x=120 while the
    button, being `width: fit-content` under `alignItems: center`, sat in the middle. One band,
    two alignments, and nothing reported it. `Captured.textAlign` writes it on the NODE, where
    it outranks the preset — and `capture` reads the source's own for the same reason it reads
    `position`. `left`/`start` is deliberately NOT carried: stamping a literal on every
    imported paragraph would override the target page's own centred preset, which is rule 0
    inverted.
  - **A GALLERY WALL HAD NO FRAME.** Rule 6 says match a frame's ratio to the ASSET, and a wall
    of photographs is the case that rule does not cover: there is no single asset. Left alone
    every tile keeps its own shape and the grid's rows come out different heights, which reads
    as unfinished. The frame is MEASURED rather than invented — the MEDIAN of the pictures
    actually being shown, so most crop by nothing, the outliers crop least, and a library of
    portraits gets a portrait wall rather than a landscape one imposed on it. A picture whose
    size the library did not report votes for nothing, and a wall with no measurements at all
    keeps `contain`. `height: auto` rides with every framed image, because the platform writes
    intrinsic width/height ATTRIBUTES and a presentational height is a USED height that would
    otherwise make `aspect-ratio` ignored — the same fix the platform applied to its own media
    CSS.

- **`genId` COULD REPEAT ITSELF, and the suite proved it rather than argued it.** Four random
  bytes is 32 bits, which puts a collision at roughly 1 in 34,000 across 500 draws — and the
  uniqueness test HIT one in an ordinary run, 499 of 500. One `sb_import_site` mints thousands.
  The consequence has no error attached: two nodes sharing an id means one OVERWRITES the other
  in `doc.nodes`, the parent's child list points at the survivor, and the document validates,
  saves and publishes with content silently gone. The width stays four bytes, because the
  platform's own ids are eight hex characters and a document this server builds should be
  indistinguishable from one a human built; uniqueness comes from REMEMBERING what has been
  issued, which is the right scope since one process builds one document.

- **THE ONE THING A SITE HAS THAT A GENERATED ONE DOES NOT WAS REACHABLE BY EXACTLY ONE TOOL.**
  `sb_review` has reported `siteChrome` since it learned to ask — two pages and no global section
  means every page carries its own header, changing the menu is that many edits, and a visitor
  meets a slightly different site on every click. The FIX existed and was locked inside
  `sb_import_site`, which builds exactly this from the pages it just created. A site built any
  other way — patterns, `sb_add`, a store seeded by `sb_store` — had to reproduce it by hand:
  create the master, know its `document` is page-shaped but rooted at the SECTION, then give every
  page a ROOT child carrying `globalRef` + `globalKind`, FIRST, because a header after middle
  content is a band-order refusal on the next save. So a check that named the gap sat beside a
  tool that could close it and no way to ask. `sb_store action:"chrome"` asks; the flow itself
  moved to `src/tools/chrome.ts` and both callers share it rather than one copying the other.

  **AND BUILDING IT SHOWED THAT A ROW HAD ONE ANSWER FOR TWO SHAPES.** The menu came out with its
  three links at x=120, x=428 and x=735 — each in its own third of a 1200px row — because the
  group mapping gives every column an equal share, which is right for a feature trio and wrong
  for a nav. `Captured.pack` is the other shape: columns at their CONTENT width, wrapping when
  they run out, which is what a menu should do and needs no stack breakpoint of its own.

  `width: auto` is the load-bearing half of that and leaving it out looked like the whole idea had
  failed. `flex-block` seeds `width: 100%` from its element defaults, and `flex: 0 0 auto` only
  says "do not grow or shrink from the BASIS" — the basis being `auto`, which reads the width. So
  every packed cell stayed full width and the menu came out as a vertical list: measured, three
  links stacked in a 140px header where the equal-share version had been 52. Only the render
  showed it; the spec was correct to read at every step.

- **A `<video>` WITH A POSTER WAS DROPPED, AND IT WAS THE ONE MOST WORTH TAKING.** `visible()`
  treated a zero box as hidden, which is right for an element that sizes itself from its
  CONTENT and wrong for one that sizes itself from its MEDIA: a `<video>` measures its
  `poster` before anything plays, so one whose poster has not resolved measures 0×0 while
  being perfectly present — Chrome only falls back to 300×150 once that load has actually
  FAILED. Measured across four spellings: `<video src poster>` with no width/height was
  skipped with nothing but a `hidden` count, while the same element carrying `width`/`height`
  — or carrying NO poster — came through. So the import kept the bare videos and lost the ones
  with a still frame on them, on exactly the pages slow enough to lose the race.

  The fix is narrow on purpose — a `<video>` only, and only when it names something to play or
  to show, so an empty `<video></video>` goes on being skipped.

  **IT HAD BEEN BROKEN ON THE COMMITTED TREE AND NOTHING SAID SO.** The browser suite is
  opt-in (`SB_BROWSER_TEST=1`) and the standard gate — `build && test && smoke` — does not run
  it, so the test that names this case sat green-by-absence. That is the "a skip that reads as
  green" failure this file already records about `src/vision/**`, caught this time only
  because the suite was finally run. Run `SB_BROWSER_TEST=1 npx vitest run` after touching
  anything under `src/vision/`, and periodically even when you have not.

- **AN IMPORT WAITED FOR THIRD-PARTY IFRAMES IT NEVER READS.** `capture` navigated with
  `waitUntil: 'load'`, which waits for every SUBRESOURCE — and the walk reads an iframe's `src`
  ATTRIBUTE and never needs the frame to render at all. So a page carrying an ad frame, a chat
  widget or a slow video embed stalled the whole capture for up to thirty seconds and then
  THREW, losing an import whose DOM had been ready the entire time.

  Found by this repo's own suite rather than by reading: the embed test's fixture carries real
  YouTube, Vimeo and Google Maps frames, and it began failing at exactly 30,000 ms with nothing
  about the page or the test having changed. A network dependency inside what reads as a pure
  DOM test — which is the second lesson, and the reason the failure looked like a regression in
  code that had not moved.

  `domcontentloaded` plus `settleDom`, which is the SAME correction `sb_look` already paid for
  one wait earlier: the right question is "has the DOM stopped changing", and the MutationObserver
  answers it directly and bounded. ttgshop.vn is unchanged to the node — 4 sections, 1,617 texts,
  96 images, 83 buttons. The SHOOT path still waits for `load`, because a photograph genuinely
  wants its images.

- **THE RECOVERY LISTING WAS TOO BIG TO READ.** `GET .../versions` and `.../history` answer with
  the DOCUMENTS — right, since a restore has to have something to restore from, and useless to
  read. MEASURED against a live server: one version of a TWO-NODE page is 1,690 bytes, so a
  realistic 120-node page runs about 70 KB per version and a listing of twenty is **1.4 MB in one
  answer**. An agent choosing which version to restore would be handed a truncated blob and no
  reliable way to pick.

  `sb_publish` had this exact problem and the same answer — a published row carries `document`,
  `html` and `css` for every page the cascade touched, so it PROJECTS the rows. `LIST_PROJECTIONS`
  in `src/tools/api.ts` is that, applied where the caller cannot know to ask: id, versionNo,
  label, createdBy, createdAt, isLive. 392 bytes for two versions instead of kilobytes each. A
  DEFAULT rather than a rule — an explicit `pick` still wins, so `pick: ["document"]` reads one.

  And the projected listing shows something worth knowing: the platform writes a `__pre_restore`
  version of its own before restoring, so a RESTORE is itself undoable.

- **A CAPTURE COULD NOT SAY IT HAD READ ALMOST NOTHING, because SETTLING IS NOT FAILING.** A
  page read while it is still building returns a small, correct-looking result: `skipped` empty,
  no error, a handful of nodes. MEASURED on ttgshop.vn on an afternoon it was taking 45 SECONDS
  to answer for 151 KB, having served the same page in 4.6s all morning — the capture kept 6 text
  nodes and 114 characters, and nothing in the answer said so. A thin import that says so is one
  a caller retries; a silent one ships.

  `coverage` is the per cent of the page's own NON-CHROME text that survived, against the
  denominator this file already argues for — chrome is skipped ON PURPOSE, so counting it would
  make every correct import of a nav-heavy site look broken. Both halves were already computed
  for the fallback decision, so it costs nothing. 100 for a page with no text, because an empty
  page is not a failed import and a zero would send a caller to fix what is already right.

  **AND THE NUMBER THEN EARNED ITS KEEP IMMEDIATELY, by exonerating the importer.** `/tin-tuc`
  came back with 7 text nodes and reported 20%, which reads as a defect — and the page itself
  holds SEVEN content links, all of them breadcrumb and category tabs, with no article rendered
  at all. The tool was right and the page was empty. Without the number that is indistinguishable
  from a thin import, and the afternoon goes into the walk.

  Two knobs arrived with it, both because a bound tuned for a healthy origin is wrong for a
  struggling one and neither could be reached: `nav_timeout_ms` (how long to wait for an answer
  at all, default 30,000 — a merchant importing their OWN slow site had no recourse) and
  `settleMs` (how long to let the DOM keep changing, default 2,000). The timeout message names
  the remedy rather than the browser — and it reads the number OUT OF THE ERROR, because the
  first version printed the default and told a caller who had already raised the budget to 90s
  that the page "did not answer within 30s", which is a confidently wrong number that sends them
  to change the setting they just changed.

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
   author sets renders on the canvas and never reaches publish.
   `server/render/style/cascade.go`'s MergeNamespace resolves a key
   *current slot → wider slots → BASE → narrower slots*, so base is the fallback layer, and
   every element's `meta.defaults.style` is seeded straight into it.

   **AND THIS ENTRY THEN SAID "NOTHING A DOCUMENT STORES CAN CAUSE THAT", WHICH IS FALSE — the
   document is exactly what causes it.** `ConfigInt` and `ConfigString`
   (`render/nodes/helpers.go:1421,1433`) index `node.Config[key]` with no responsive merge, and
   ONE html document serves all three widths, so a key an `html.go` decides can only ever come
   from base. `setKeys` writes config per breakpoint unless the caller passes `base`. For those
   keys that default IS the bug the paragraph above describes — the value updates the editor
   canvas and vanishes on publish, with no error at any step — reached not by writing a bad
   element but by writing an ordinary document.

   The platform keeps the list, as a deliberate MIGRATION ledger
   (`schema/test/responsive-defaults.test.ts`, `BASE_ONLY_CONFIG`, 13 keys), and its own comment
   records three that shipped and had to be reverted: `icon` iconSize, `text-dataset`
   descriptionLines, `media-dataset` layout. It also protects the human and not the agent — the
   editor's `MediaLayoutPickerRow` and `AccountRowLimitRow.vue` force `desktop` explicitly, so a
   merchant cannot make this mistake through the inspector and an agent could make it on every
   call.

   THE DATA AXIS IS THE WORST OF THEM, and this repo had already paid for it from the other
   direction. `datasetSource`, `kind`, `collectionId` and `collectionType` are all on the list,
   while `rebindPatch` writes the derived bindings at NODE level. So
   `sb_set config {datasetSource:"category"}` left the bindings saying category and the config
   in `responsive.desktop`, where `dataset-block/html.go` never looks — it read base and still
   said product. Both halves reported success: the same shape as "THE DATA AXIS OF A REPEATER
   WAS UNREACHABLE THROUGH EITHER TOOL" above, re-entering through the breakpoint layer instead
   of the kind axis.

   `src/domains/site/baseonly.ts` splits a config write across the two layers and `sb_set`
   reports the move as `base_only`, once per KEY per process — routed and said rather than
   refused or silently done, which is the `hoverRoutingNote` precedent. The table is GENERATED
   from the platform's ledger, never copied, because that ledger is meant to shrink: a stale
   copy would keep forcing a key to base long after the platform made it responsive. The
   EXCEPTIONS are per `type:key` and load-bearing — `quantity-button:iconSize` really is
   per-breakpoint, through the satellite compiler's `--icon-size` var.

   THE TAIL OF THAT ORDER BITES. Because narrower slots are consulted last but ARE consulted,
   a key written only at `tablet` reaches `desktop` whenever neither desktop nor base declares
   it. A `flexWrap: wrap` added to a header for tablet broke the desktop header into two rows,
   and the fix is not to remove the tablet value — it is to say the desktop answer out loud, at
   base. When you write a responsive override, write its wide-screen counterpart too.
5. **App blocks** — a marketplace app's subtree. The document stores ONE reference node
   stamped `specials.appBlockRef`; on read the platform composes the app's markup under it
   and stamps the block root `appBlockId`; on save `DecomposeAppBlocks`
   (`server/internal/page/globalservice.go:56`, after overlays, before `Decompose`) reduces
   the subtree back to the reference, so an edit inside is stored nowhere and reported
   nowhere. `appBlockRoot()` in `src/core/tree.ts` finds the nearest stamped self-or-ancestor;
   every write refuses a strict descendant through `refuseAppBlockInterior` (and `sb_add` /
   `sb_move` refuse the root as a destination), the outline flags the root `app: true`, and
   `sb_review` skips the interior. Tested in `test/traps.test.ts`.

## Designing a site with these tools

Not taste — every rule below is a defect that SHIPPED in this repo's own storefront build,
and each names the check that would have caught it. The `sbuilder-site-design` skill carries
them as a checklist at the moment the work starts.

**Before any of them: a design source outranks invention.** If the work has a Figma file,
read it — the MCP must be AUTHENTICATED first (unauthenticated it exposes only
`authenticate`), `figma-design-to-code` is a mandatory load before `get_design_context`, and
`figma-use` before `use_figma`. Read VARIABLES AND STYLES, never a screenshot: the file
carries the token, its name, its variants and its hover value; a picture carries an
approximation of one colour. With no source you are the designer, and the professional move
is to decide the token set FIRST and write it down, so every later section has something to
obey.

Google Stitch is a source of a different shape — a generator with a design system attached.
Its fifteen tools split into projects, screens and DESIGN SYSTEMS, and the last group is the
one that matters here: a Stitch design system already carries the palette, the typography,
the corner roundness and the light/dark backgrounds, which is exactly the token set rule 0
wants. So `list_projects` → `list_design_systems` → port those values through `sb_set`, and
ask for screens second if at all — a screen is one width, and rules 1–3 still own the
responsive answer. Its own instructions carry four facts worth obeying:
`generate_screen_from_text` and `edit_screens` take MINUTES and must not be retried (poll
`get_screen` every 30s, ten times); a connection error does not mean the generation failed;
`upload_design_md` does nothing until `create_design_system_from_design_md` follows it; and
`delete_project` is irreversible and asks for a yes/no.

Check either server is exposed in THIS session before planning around it. An MCP server can
be configured project-scoped — Stitch is, in this workspace, under one sibling repo — so
`claude mcp list` reports it connected while a session in another directory has none of its
tools.

That translation is lossy in known places: a Figma frame is ONE width and says nothing about
390; and satellites, the field-skin keys, the cart drawer and every empty state exist in no
design file at all — they are exactly the surfaces that shipped platform-grey here.

0. **Read the page's pattern before you add to it, and obey it.** A page already answers
   what the accent is, how round a button is, how much air a section gets — and a section
   that answers differently does not read as a different section, it reads as a different
   website. Take the values off what is there (`sb_node_read` a heading, a primary button, a
   card, a section) and reuse THOSE, not a near-miss.

   The parts a page does not show you are what break this: the cart drawer, the checkout
   form's fields, an element's satellites and every empty state are authored out of sight and
   ship the PLATFORM's defaults — `#171717`, `#d4d4d4`, square corners, English copy. This
   build shipped a rose-and-ink storefront whose drawer said "Cart" / "Checkout" / "Your cart
   is empty" in black on white. `sb_review` SKIPS overlays, so nothing reported it. Open the
   drawer and look, before calling a site done.

1. **Nothing is finished until it has been seen at 390px.** The global header was authored
   desktop-only and had no responsive block at all: at 390 the nav ran 408 → 460, the cart
   button 488 → 584, and two nav buttons overlapped. It reviewed clean the whole time,
   because `sb_review` reads the tree and a tree cannot overflow. `sb_look` the three widths.

2. **Write the wide-screen counterpart whenever you write a responsive override.** The
   cascade resolves *current slot → wider slots → BASE → narrower slots*, so a key written
   only at `tablet` REACHES `desktop` when neither desktop nor base declares it. One
   `flexWrap: wrap` for tablet broke the desktop header into two rows. Say the wide answer
   out loud, at base.

3. **A flex row with two or more real columns needs an explicit stack breakpoint.** Nothing
   catches this for you: the columns SHRINK to fit, so no box overflows and `measure` is
   silent. On the product page at 390 that left the photo a sliver, the title truncated
   mid-word and the Add-to-cart label clipped — a page with zero findings.

4. **Style the satellites, or ship the platform's grey.** A page carrying `product-variants`,
   `quantity-dataset`, `menu`, `tab`, `accordion` or any repeater is NOT styled until the
   nodes listed under them as `satellite: "<config key>"` are. They hold the element's whole
   look and default to `#d0d0d0` borders and `#f8f8f8` fills, which is off-brand on every
   site that has a brand. They take `state`, so hover and the selected option are yours too.

5. **A form's fields are config keys, and the level matters.** `fieldBg` /
   `fieldBorderColor` / `fieldRadius` / `fieldPadY` / `fieldPadX` plus the chrome trio on the
   FORM node dress every field it holds. `payCard*`, `choice*`, `slot*`, `file*` do NOT —
   `form/css.go` emits only `FieldKnobs` (`ChromeKnobs + Knobs`), so those written on the
   form are stored and rendered nowhere. They belong on the field node, which lives in the FORM DOCUMENT,
   as does the submit button.

   **THAT RULE IS GENERATED NOW, NOT PROSE.** It summarised a 55-key table across 11 form nodes
   by hand, which is what this repo's codegen exists to replace. `FIELD_SKIN_BY_NODE` records
   which keys each node's `css.go` actually emits — the groups from `fieldSkin.ts` (pure data),
   the mapping from each `css.go`'s `fieldskin.<Group>` identifier — and `sb_set` warns once per
   node type, NAMING THE NODE THAT WOULD RENDER THE KEY. That half is what makes it a fix rather
   than a complaint: `payCardBg` is real and rendered on `form-payment`, and dead on `form`.

   The cross-check is a VOCABULARY check, not a composition parse, and the reason is worth
   keeping. A first version walked Go's `withChrome(append(...))` and compared key-for-key; it
   was wrong twice — a name pattern that could not match the group literally called `Knobs`, and
   a body slice that ran past a one-line var inside a `var (…)` block and swept in half the
   file. An assertion that fails on its own bugs teaches the next reader to bypass it. What
   actually drifts is the vocabulary, and matching every `Key:` literal in the Go against the TS
   tables both ways catches that with nothing to get wrong.

6. **Match a frame's aspect ratio to the asset it holds.** `aspectRatio: 4 / 5` with
   `objectFit: cover` over 900×1100 artwork cropped the garment out of its own product photo.
   Ratio to the asset, or `contain` with a ground colour.

7. **One visual language across a catalogue.** Keyword stock imagery is not a source:
   `loremflickr` answered "kids,clothing" with a cat statue and a photo of an adult. A
   generated set that shares a palette, a stroke weight and a shoulder line reads as
   intentional; ten photos from ten sources read as a scrape.

8. **Delete by what you ADDED, never by "not in my list".** A cleanup that trashed every
   media asset whose name was not in the new set took the site's 54 Roboto font files with
   it. They were recoverable — `POST /api/v1/media/{id}/restore` — and only because the
   platform soft-deletes.

### What separates a real site from a generated one

Six checkable things, all missing from the first pass here: a hover state on every
interactive element and a selected state that looks selected (`sb_set` takes `state`); a
designed empty state, since an empty cart is the most-visited one on a store; about four type
sizes rather than a fifth that differs by 2px; a spacing scale reused rather than guessed per
section; copy in the shopper's language on EVERY surface, the drawer and the submit button
included; and one accent doing one job, because an accent on the button and the price and the
active link points at nothing.

### Judge the page from the right artifact

Three ways this build read a correct page as broken, and each cost real time:

- **The draft preview threads no store data.** Every repeater renders its empty state there,
  however right the page is. `sb_look` says so in `preview_note`; pass the published
  storefront address as `url` to see products.
- **The page's CSS is a LINKED STYLESHEET** — `static-*.css`, `desktop-*.css`, `tablet-*.css`
  off the assets host. Grepping the HTML for a rule and finding nothing proves nothing. It
  read as "the style did not apply" twice, when it had both times.
- **A fullPage screenshot does not scroll**, so `loading="lazy"` images below the fold never
  enter the viewport and photograph as empty boxes. `sb_look` walks the page before it fires;
  any script of your own must do the same.
- **A REVEAL-ON-SCROLL BAND WOULD PHOTOGRAPH BLANK**, and `sb_look` settles it. `trigger:
  "view"` ties an animation's progress to the element's place in the scrollport, so after the
  walk returns to the top it is back at `opacity: 0` — measured, one band of four came out
  empty on a correct page. Every animation is stopped before the shutter opens; a script of
  your own must do the same.

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
agent reads at the moment it starts the work, and `sbuilder-site-design` does the same for
"Designing a site with these tools" above — the two jobs are different, and the design rules
are needed by an agent that is not editing this repo at all. Specialist subagents in
`.claude/agents/` enforce the tool contract: **mcp-tool-author** (add or modify a tool) and
**mcp-verifier** (run the gate and check conventions; never edits).

## Phases

All three phases are shipped, and their plans live in `docs/superpowers/plans/`:
auth and full API reach; the element catalog, patch core, four traps, document, builder,
validation and page tools; the live-edit socket, the yield rule, the vision loop and
`sb_bind`. Twenty-eight tools reach 484 API operations. The 2026-09-07 token diet plan in
`docs/superpowers/plans/` (compact results, once-per-process notices, the `sb_api_find`
call sheet, trap 5, auto-release) is shipped too, and `test/token-budget.test.ts` holds its
ceilings.

Phase 8 (2026-09-08) made the agent an OPERATOR rather than only a designer, and its spec is
`docs/superpowers/specs/2026-09-08-phase-8-operating-a-store-design.md`. The measurement that
framed it: 46 of 212 write operations carried a body schema, so every merchant operation
through `sb_api_call` was a guess, while the editor exposes 58 feature areas and this server
covered about six. It shipped `REQUEST_SHAPES` (46 → 158, read off the handlers), `sb_store`
(the four ordered writes that make a checkout) and `sb_undo` (a PUT reads before it writes,
because a PUT is not a patch). It did NOT add a tool per surface: the finishing
surfaces — theme, fonts, menus, translations, settings, blog, orders, customers, shipping,
discounts — became reachable the moment the shapes landed, and what is still unshaped there
is action endpoints that take no JSON body.

`SB_BROWSER_TEST=1 npm test` adds the one test that launches Chrome. Run it after touching
`src/vision/**` — the default suite skips it, and a skip that reads as green is the failure
this repo keeps closing.

Phase 7 (2026-09-07) closed ten silent failures reachable through this server's OWN tools —
the drop-time contract (satellites and seeded content), the satellite-aware walk and the two
`sb_duplicate` defects it exposed, the compose warnings / publish skip / slug rename this
client received and discarded, and three render rules a valid document can break. It added no
tools. Its spec also records the two axes it deliberately did NOT take, so the measurements
are not re-derived. BOTH HAVE MOVED, and the Phase 7 numbers are kept only as the before:
REACH was 75 operations unreachable and is now zero for the annotated surface (see the OpenAPI
bullet above); CAPABILITY was 45 of 180 write operations declaring a body, and measured
2026-09-09 is **276 write operations, 162 shaped, 114 not** — of which 64 are DELETEs that
take no body and 14 are action endpoints with a verb tail. The genuinely risky remainder is
**5 PUTs with no shape**, down from 8 once the parser learned three readings it was
getting wrong — and NOT all of them are guesses: `…/pages/{pageId}/default-template` decodes
nothing at all, so "no shape" is the correct answer there rather than a gap. The three that
came back are the ones that mattered — `roles/{roleId}`, `products/{productId}/categories`
(filing a product under a collection) and `sites/{siteId}/org`. The three readings, each
pinned by `test/shapes.test.ts` against the real catalog:
  - **a case arm may list SEVERAL methods.** `case http.MethodPatch, http.MethodPut:` is how
    this platform spells "the same body either way", and matching only the first name left the
    arm unrecognised entirely — the trailing `:` never followed it.
  - **A DOC BLOCK IS NOT ALWAYS ABOVE ITS FUNCTION.** `products/rest/rest.go` stacks
    handleProductLinks's block and handleProductBundles's together and then declares the two
    functions in the OPPOSITE order, so walking up from a function reaches the block
    documenting the other one. That is worse than a miss: a route takes the wrong handler's
    body. Blocks are now attributed by the name they OPEN with — Go's own convention — and
    only fall back to "the function below" when the block names nothing.
  - a dispatcher that routes by PATH rather than by method has no arm to read at all; the
    route's own trailing literal segment picks the callee, which is exact rather than a guess. `sb_undo` cannot prepare an undo for
any of them either, because it needs the shape to know which fields to carry back. The 33
unshaped POSTs left over are almost entirely the SHOPPER's surface (`/_wb/account/*`,
`/_wb/checkout/*`), webhooks and multipart uploads — not an agent's to call.

Deferred with the seam left open: `expand`/`compact` sparse authoring (`createNode` already
seeds from `meta.defaults`, so the write-path win is banked; the read-path inverse waits for
a measured need) and `sb_bind`, which belongs with Phase 3's binding work.
