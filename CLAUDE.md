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
- **The element registry holds 107 types, and `getElementAI` covers 107/107** (106 until
  `order-receipt` landed — codegen asserts the coverage, so this number moves with the
  platform and a stale one here is caught by the next run, not by a reader). The
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
- **`sb_review` now answers EIGHT readiness questions, and the newest is the most basic.** A
  store with a published product template, a checkout page, a live gateway and a delivery
  option reported READY on an EMPTY CATALOGUE — every repeater rendering its empty state to a
  shopper, the product template bound to nothing. `catalogue` reports that, and reports the
  near-miss too: every active product priced at zero renders, adds to the cart and totals
  nothing, which reads as a working store right up to the money. Read off
  `/api/sites/{siteId}/products` rather than `/api/v1/products`, because that one takes either
  credential and the check must answer for a session install as well as a key-only one.

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
  `sb_review`'s own `payment` gap, and the private `pages/{pageId}` cluster.

  **AND A PUT NOW READS BEFORE IT WRITES, because that gap is the one with no route at all.**
  Page versions / history / restore exist on neither surface, so every whole-document replace
  this server can make is one-way — `PUT /settings` is not a patch and a partial body erases
  the store's configuration. A merchant clicking through the editor has undo; an agent had
  nothing, and one call does more damage. `sb_api_call` therefore GETs before any PUT that
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
  session. What genuinely has no route on either surface is page VERSIONS / HISTORY /
  RESTORE: the only `restore` in `/api/v1` is `media/{id}/restore`. So a wrecked draft is
  still unrecoverable, and a page delete is still one-way. See
  `docs/superpowers/specs/2026-09-07-phase-7-drop-time-and-signals-design.md`.

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

- **On the canvas the agent's avatar is the KEY, not a person.** `realtime.go` returns
  `key.ID` and `key.Name` rather than the minter's name, deliberately: an avatar borrowing a
  human's name would tell the room a person is editing when a machine is. So the merchant
  watches the label they chose for the key move around the page.

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

  `capture.ts` launches its OWN browser rather than sharing `shoot.ts`'s process-lifetime one:
  an import is rare, slow and runs untrusted script, and coupling that to the tool a vision
  loop calls every few hundred milliseconds is how the fast path gets slow.

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
because the platform has no history). It did NOT add a tool per surface: the finishing
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
are not re-derived: REACH (75 operations unreachable, see the OpenAPI bullet above) and
CAPABILITY (only 45 of 180 write operations declare a body; `PUT /settings` is a
whole-document replace, so a partial body erases the store's configuration).

Deferred with the seam left open: `expand`/`compact` sparse authoring (`createNode` already
seeds from `meta.defaults`, so the write-path win is banked; the read-path inverse waits for
a measured need) and `sb_bind`, which belongs with Phase 3's binding work.
