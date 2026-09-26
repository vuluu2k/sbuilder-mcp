---
name: sbuilder-codegen
description: How the committed catalog is generated from a web_builder checkout and how it goes stale — the published-checkout refusals, swagger vs the routes, REQUEST_SHAPES read off handlers, the config/element vocabulary readers and their join rules, field-skin, animation, translations, inert-on-add and dead-key drift. Triggers when running or changing `npm run codegen` / `codegen:check`, touching scripts/gen-catalog.ts, scripts/shapes.ts, scripts/inert-drift.ts, scripts/deadkey-scan.ts or src/catalog/*.generated.ts, or when a platform change (new element, operation, vocabulary, skin knob) must reach the catalog.
---

# The catalog generator (`npm run codegen`)

**Triggers:** `scripts/**`, `src/catalog/**`, `npm run codegen[:check]`, a codegen assertion exiting 1, a count in a README/test that moved with the platform.

## Running it

```bash
cd <web_builder> && git fetch && git worktree add --detach <scratch>/wb origin/main
ln -s <web_builder>/node_modules <scratch>/wb/node_modules   # plus schema/editor/runtime node_modules
WB_REPO=<scratch>/wb npm run codegen:check    # exits 1 naming every stale file
WB_REPO=<scratch>/wb npm run codegen          # writes src/catalog/*.generated.ts
```

**A WHOLE-DIRECTORY `node_modules` SYMLINK UNDOES THE PIN.** `node_modules/@webbuilder/*` are
workspace links (`../../editor`, `../../schema`, `../../runtime`), so through a symlinked root
they resolve to the ORIGINAL checkout's live working tree, not the worktree's ref. Measured:
`codegen:check` against a clean detached e183370a6 read "current" in the morning and "STALE —
checkout.generated.ts" that afternoon, because the other checkout's `editor/` had moved on
(`var(--wb-sc-buttonBg, …)` in the form seeds). Make `<scratch>/wb/node_modules` a real
directory: symlink every entry of the original EXCEPT `@webbuilder`, and point
`@webbuilder/{editor,schema,runtime}` at `<scratch>/wb/…`. The check then read "current" again.

Never point it at a working tree somebody is editing — it refuses one (see below). After a
regen, the counts pinned in `test/readme-counts.test.ts`, `test/inert-*.test.ts` and both
READMEs move with the platform; update them, never loosen the assertion.

A reader assertion that exits 1 (e.g. "the field-skin vocabulary has drifted") means the
PLATFORM changed shape — teach the reader the new shape; do not delete the assertion.
Two WARNINGS never fail `--check` by design: undocumented routes and inert-on-add drift —
both are fixed upstream or by a human audit, not by regenerating.

Each entry below is a fact that cost real investigation, kept verbatim from the era when
`CLAUDE.md` carried all of them. Do not re-derive them, and do not "fix" the code that accounts
for them. Counts inside an entry are what was measured THAT day — trust the generator or the
repo over a number here, and fix the line when you catch one stale.

## Is the catalog still current?

`npm run codegen` is a MANUAL step, so the catalog goes stale in SILENCE — and the platform
moves fast enough that this is the normal state, not the exception. Measured in one
afternoon: 107 → 108 elements and 484 → 486 operations while this repo sat still.

```bash
WB_REPO=/path/to/web_builder npm run codegen:check
```

**Codegen now REFUSES a checkout that is not published** — uncommitted changes in the five
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
(`schema/src`, `editor/src`, `server/render`, `server/docs`, `runtime/src`), naming the files
and the worktree
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

## Generated tables and their readers

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

    **AND THAT ONE SENTENCE WAS THE WHOLE OF WHAT GOT FIXED — the same block also copies the
    SUMMARY, the DESCRIPTION and every `@Param`, and for three phases nothing corrected any of
    them.** `REQUEST_SHAPES` answers "what shape is the body", so it repaired that and left the
    rest of the block's fallout in the call sheet an agent actually reads. Measured
    2026-09-14, and all three are now corrected in `src/catalog/search.ts`:

    - **302 of 524 operations share a summary.** Most of it is harmless and must stay
      unflagged: "List, create, update or delete a course's lessons" on all four CRUD routes
      is an UMBRELLA, true of each member, and 105 of the 119 shared summaries are that shape
      — flagging them would bury the rest. The discriminator is the TRAILING LITERAL SEGMENT,
      the same signal `scripts/shapes.ts` already trusts to pick a handler out of a dispatcher
      that routes by path: routes differing only by METHOD or by a trailing `{param}` are one
      resource, routes whose literal tails DIFFER are separate ACTIONS and one sentence
      describes at most one. That leaves 14 groups, 41 operations, and `summary_covers` names
      the siblings rather than guessing the missing sentence.

      THE COSTLIEST IS MONEY, and this file already records the distinction it erases:
      `/refund` RECORDS a refund made outside the platform, `/refund-via-gateway` ASKS the
      gateway to send it. The document gives both — and `POST /payment-transactions`, which
      opens a pay link — the single summary "ASK the gateway to send the money back". An agent
      told to refund a customer reaches for the obvious name, reads a sentence promising the
      money moves, and records a refund that never pays anybody. `POST .../versions`
      (snapshot) and `.../restore` share one summary while running in OPPOSITE directions, and
      `/invitations/{id}/accept` and `/decline` are both described as "Withdraw an invitation".

      THE PER-ROUTE TEXT EXISTS AND IS DELIBERATELY NOT READ. Each rest package's route-map
      comment has it (`POST /payment-transactions/{id}/refund  RECORDS a refund made outside
      this platform`), but those maps write paths relatively, abbreviate methods (`PATCH/DEL`),
      append query strings and often carry no description at all — so recovering a summary
      from them would invent exactly the confident wrong sentence this removes. `description`
      is no use either: swag copies it to every route in the block AND MERGES the stacked
      blocks' text, so the four payment routes share one description built from two of them.

    - **90 GET and DELETE operations declare a request body**, and the call sheet inlined the
      DEFINITION for each — ~83 KB, about 927 bytes apiece, describing a body the route cannot
      take. `GET /api/sites/{siteId}/customers`, a listing, shipped the whole customer object
      and reported `body: "described"`. The decode sites CANNOT answer this: `scripts/shapes.ts`
      sets `WRITE_METHODS = POST | PUT | PATCH` and never looks at a read, so "0 of 90
      confirmed" is structural silence, and reading it as a no would be this file's own
      "the absence of a string is evidence about the string, not about the behaviour". The
      test is the MECHANISM instead — a stacked block gives every route the same `@Param` byte
      for byte — and all 90 carry a body param identical to some write's, with the donor on
      the same path or resource for 86. A WRITE's body claim is still believed, because the
      risk there runs the other way: most writes are UNDER-annotated and a shared `@Param` may
      be the only description of a real body.

    - **29 operations list a parameter more than once** (`POST /payment-transactions` reports
      `siteId` three times), and **30 declare a `{param}` in their path that no `@Param`
      mentions** — `POST /api/sites/{siteId}/pages` listed NONE of its own, and
      `PUT .../courses/{id}/questions/{questionId}` listed every one but `questionId`. The
      second half cost a round trip rather than a call: `callOperation` walks the PATH and not
      this list, so it demanded an argument the sheet never mentioned. The path is the
      authority and the sheet now agrees with it.

    Net effect on what an agent reads: 61 KB off the 524 call sheets, and the sentences that
    remain are about the route they sit on. A test that pinned the OPPOSITE of the body rule
    was replaced rather than deleted — it asserted a GET's declared body is still reported,
    behind an `if (odd)` guard, because its author took such a GET for a rarity that might not
    exist. There are 90.
  - **A FIELD WITH A TRAILING `// comment` WAS DROPPED, SILENTLY, for as long as the reader
    existed.** `FIELD` and `EMBED` both anchored on `$` right after the tag, so
    `Slug string \`json:"slug"\` // unique per site` matched neither. Found 2026-09-26 by an E2E
    run that could not create a nested category (`slug`, `parentId`, `position` absent) —
    and the same bug had taken `description`, `images`, `attributes` and
    `variants[].priceCents` off the product sheet: the PRICE. The trailing comment is now the
    field's doc. Lesson: a shape that LOOKS complete is not evidence; the diff was 7,628 →
    8,516 lines and no count anywhere had moved.
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

- **The element registry holds 120 types, and `getElementAI` covers 120/120** (2026-09-25 regen; 106 when
  `order-receipt` landed, 107, then `rating-stars`, `chat-widget` and `cart-count` — codegen
  asserts the coverage, so this number moves with the platform and a stale one here is caught
  by the next run, not by a reader). The
  directory has more entries than that because the loose `.ts` files beside the elements
  are not elements. 79 binding sources, read from BOTH renderers — the Go scope and the
  editor's own binding context, which carries keys the Go side never spells out
  (`product.moneyOverride`, `site.*`, `course.*`). Reading one alone made `sb_review` call
  the platform's own seeded pricing binding dead on every page that showed a price.

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

  **THE ROUTES WITH NO ANNOTATION AT ALL ARE NOW MEASURABLE, and measuring them found 16.**
  This paragraph used to say there was "no mechanical way to enumerate them from the router" —
  true, and the wrong place to look. The dispatchers mount wildcard subtrees and route
  internally, so the router says nothing; but every rest package in this platform OPENS WITH A
  ROUTE-MAP COMMENT, a house convention (`//  GET  /chat-conversations  the inbox, newest
  first`), and that map is the package's own statement of what it serves. Diffing each map
  against that package's `@Router` lines is exact, needs no running server, and is what the
  count could never do: swag reads annotations, so a surface with NONE is invisible to
  `swagger.json`, to this catalog and to the arithmetic that is supposed to notice.

  Measured 2026-09-12 and fixed upstream (`ed0b869f`), 508 → 524 operations, nothing removed:

  - **chatbot (9) — the AI assistant's ENTIRE conversation surface.** The inbox, one thread's
    messages, a human's reply, bot/closed, the unread badge, the worklist stats, plus
    `chat-settings/test`, `/models` and `/usage`. `chat-settings` itself WAS annotated, which
    is precisely what made the package look finished. Same shape as `relations/rest`.
  - **payments (4) — INCLUDING BOTH REFUNDS.** `/refund` records one a human made elsewhere;
    `/refund-via-gateway` asks the gateway to send the money back and moves the record only if
    it confirms. Also `POST /payment-transactions`, which opens a pay link for an order — the
    route map said GET/POST and only the GET was annotated. Refunding a customer is the most
    basic thing that happens after a sale, and no tool here could name it.
  - **sitedomain (3)** — canonical (www vs bare), redirect, and redirect-code (301 vs 302).
    The last was missing from the package's own route map too, and that is now corrected.

  Four routes registered DIRECTLY on the gin router are also outside the catalog, and only one
  of them is a gap worth closing: `/api/permissions` answers the RBAC matrix, the content
  domains, and `scopes` — the delegation vocabulary a marketplace app may ask for. This file
  has recorded a credential rule too strictly TWICE; that endpoint is the platform's own answer
  and would end the guessing. `/api/plans` and `/api/locales` are public catalogues (pricing,
  the language list with each locale's currency — the latter is what a caller needs before
  configuring a multilingual store's locales). `/api/realtime/ws` is the socket `sb_live_join`
  already speaks and is correctly not an HTTP operation.

  The false positives are worth knowing so the next run is not re-litigated: a route map that
  writes its query string (`/translations?locale=`, `/relation-slots/{id}/picks?ownerId=`,
  `/media/assets/by-url?url=`, `/wishlist-demand?limit=50`) does not match a documented path by
  string, and all of those ARE annotated. `/_wb/feed/*`, `/_wb/css/*` and `/_wb/runtime/*` are
  the shopper and asset surfaces, correctly absent.

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

- **`swag init` had not been re-run for a long time, and re-running it recovered 44
  operations** — 278 paths / 412 ops → 306 / 456. Among them the three that matter most:
  `GET/PUT/DELETE /api/sites/{siteId}/payment-gateways/{provider}`, which had no `@Router`
  and were therefore reachable to a browser and to nothing else. A store built through the
  API could read its gateways and never switch one on, and the cause was a missing comment
  rather than a missing route. Annotations now live on `payments/rest/manage.go`'s
  `gateways` method.

- **A CONFIG KEY'S LEGAL VALUES WERE UNREADABLE, AND GUESSING ONE FAILS SILENTLY.**
  `sb_traits_for` names 505 controls, 139 with a declared write target — and NOT ONE said what
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

  **AND THE PLATFORM NOW DECLARES OUTRIGHT WHAT THIS REPO SPENT FOUR RULES INFERRING.** Every
  reader here had to answer the hard half itself — not "what are the words" but "WHICH KEY do
  they govern" — from the seeded value, the declaration's own name and its locality, and that
  join provably cannot reach everything. `VOCAB` on an element's meta ends it:
  `{ '<namespace>.<key>': LIST } satisfies ElementVocabulary`, attached to that meta's own
  `meta.type` (web_builder `a401a1c5`). 35 entries across 18 metas at the 2026-09-14 regen.

  Read as Source D, and it is worth more than the scan because it is GUARDED UPSTREAM:
  `schema/test/element-vocabularies.test.ts` asks four things of every entry — is the seed a
  member at base AND at every breakpoint, does the inspector row RENDER from the list rather
  than merely import it, is every member reachable, and is it the RIGHT list, checked by array
  IDENTITY against a second independent table because so many of these lists are
  near-neighbours. Nothing on this side can prove any of that.

  THREE VOCABULARIES WERE UNREACHABLE BY ANY AMOUNT OF INFERENCE, and they are ordinary keys:
  `cart-drawer` and `hamburger-menu` write `config.direct` from the SHARED `DRAWER_EDGES`, and
  no name rule turns `DRAWER_EDGES` into `direct` — which edge the cart drawer slides in from
  is not exotic. `tab` seeds `tabAlign: 'left'` while carrying BOTH `TAB_ALIGNS` and
  `TAB_POSITIONS`, which intersect at `left`, so the seed proves nothing and both candidates
  are dropped; the platform's own guard names that exact pair as why it added the identity
  check. 81 → 84 entries.

  IT IS A MIGRATION IN PROGRESS, which is the real argument for reading the declaration rather
  than patching the join. The platform audited its inspector and found 42 rows holding a value
  list privately against 15 that imported one; 18 elements have moved. A reader keyed on the
  declaration takes each of the rest on the next codegen with no edit here — every one of which
  would otherwise arrive as another hole in the table or another special case in the join.

  TWELVE OF THE 35 ARE SKIPPED AND THAT IS NOT A LOSS. The three carriers of the
  background-scene layer declare its keys in their own `VOCAB`, and `sceneVocab` already
  publishes them at `*`, which `vocabularyForWrite` falls through to for EVERY element. An
  identical element-scoped copy answers nothing the table did not already answer. Skipped only
  where the values MATCH — a carrier that narrowed its own layer would be real news.

  **AND READING IT EXPOSED A LOSS THE OVERWRITE HAD BEEN MAKING SILENTLY: `values` AND
  `fallback`/`open` ARE TWO DIFFERENT FACTS FROM TWO DIFFERENT PLACES.** A schema list says
  which words MEAN something, and a declaration rightly outranks a Go list for that — a
  renderer enumerates what it can DRAW, a subset that drifts on purpose. But only the renderer
  can say what happens to a word OUTSIDE the list: `fallback` is the normaliser's trailing
  `return Fallback`, `open` is its `default: return mode` passthrough, and a declaration is
  silent on both. `put` overwrote the whole entry, so a superseding declaration threw away a
  fact it never had.

  MEASURED RATHER THAN ANTICIPATED: `tab.tabPosition` carried `fallback: "top"` from
  `nodes/tab/html.go` until the platform moved that list into `TAB_POSITIONS`, after which
  `sb_set` could no longer say what `tabPosition: "start"` renders as. NOTHING WENT RED — the
  entry stayed correct and got less informative — which is exactly how this accumulates while
  the platform keeps migrating vocabularies out of its renderers. `open` is the half that would
  cost more: dropping a fallback costs a sentence, dropping `open` makes `unknownWriteNote`
  report a CORRECT value as a mistake (`mediaImageRatio: "4 / 5"` really is handed to CSS) and
  sends a caller to "fix" a working page. Nothing declares that key today, so the guard is in
  place before the first declaration that would spring it.

  THE ATTRIBUTION HAD TO RIDE WITH IT, and the existing suite is what caught that. `readBy` now
  names the declaration that won the VALUES, so the note would have read "TAB_POSITIONS
  normalises anything unrecognised to top" — crediting a plain `as const` list with behaviour
  only `html.go` has. `fallbackReadBy` carries the Go site, set ONLY where it differs, and the
  table-wide invariant still holds against it: a fallback comes from a Go `default:` arm or from
  nowhere, never from a picker or a bare declaration. The carry is also CONDITIONAL — a fallback
  the declared list no longer contains means the Go reading went stale, and naming it would tell
  an agent a value the platform says is not one.

  **AND THE FIRST SYMPTOM OF ALL THIS WAS `codegen:check` REFUSING TO RUN AT ALL**, which is the
  reader working rather than failing. The same platform commit left `ScenePaletteRows.vue` with
  `const COLOR_MODES = SCENE_COLOR_MODES` — an alias, not a list — and the 3D reader exited 1
  naming the slot instead of publishing a short vocabulary. Absent is silent,
  present-and-unparseable exits 1; the `colors` slot now reads `SCENE_COLOR_MODES` from the
  schema beside the two word scales it belongs with.

  **AND THIS ENTRY'S CENTRAL RULING WAS FALSE FOR ONE SHAPE OF SWITCH, WHICH SHIPPED A WRONG
  VOCABULARY TO npm IN 0.42.0.** The reader that grew out of the paragraphs above took *a Go
  `switch` over a config key with a `default:` arm is a complete vocabulary* — the `default:`
  catches everything the cases do not, so the cases ARE the list. That is true of a NORMALISER
  and false of a GUARD, and `nodes/helpers.go:bgSceneColorRule` is a guard:

  ```go
  switch ConfigString(node, "backgroundSceneSource", "") {
  case "effect", "gallery":      // ← EMPTY ARM. no return, no value.
  default:
      return ""                  // ← an early exit; "" is a CSS string here,
  }                              //   not a value of backgroundSceneSource.
  ```

  It asks *does this source support custom colours*, which is a different question from *what
  may this key hold* — and the catalog published `['', 'effect', 'gallery']` for a key that
  holds five words, so an agent was told `spline` and `model` were invalid. A partial list is
  the failure this table exists to prevent, arriving through the thing that was supposed to
  fix it.

  **THE DISCRIMINATOR IS MECHANICAL, and it is the fix rather than the value: a normaliser's
  case arms RETURN; a guard's matching arm is EMPTY**, because falling through to the code
  after the switch is its whole purpose. Go has no implicit fallthrough, so an empty arm can
  mean nothing else. Checked against all seven sites the reader kept — `popup`'s `triggerType`,
  both `position` readers, `media-dataset`'s `layout` and `mediaRatioCss`,
  `product-image-feature`'s two — every one returns from every arm, and this was the only
  guard. A rejected switch falls back to SILENCE.

  **THE RIGHT ANSWER WAS NOT IN THE GO AT ALL, and taking it from there would have been wrong
  one value smaller.** `bgSceneProps` (`helpers.go:1686`) switches on the four sources that
  DRAW something; the key's own declaration — `BACKGROUND_SCENE_SOURCES` in
  `schema/src/elements/backgroundScene.ts` — carries FIVE, because `''` is OFF, is the seeded
  default, and its header calls it "the load-bearing state". A list built from `bgSceneProps`
  would have called every unconfigured section in the shop invalid.

  So there is a **Source C: the platform's own declared list**, and it closed TEN more keys
  that were in no catalog because both older readers read an IMPLEMENTATION. The 3D feature
  enumerates nothing either can see — four shader ids in the browser ISLAND, six built-in
  scenes derived from a catalogue of builder functions, two word scales as `as const` arrays —
  and every one is a NAME an agent cannot author without the list, the same argument that put
  46 animation type names here. `sb_traits_for` grew by ~900 bytes on the four carriers, on a
  16,000 ceiling measured against `list-dataset` (14,385, unmoved).

  **`runtime/src` IS THE FIFTH SOURCE DIRECTORY, and `runtime/dist` is deliberately not.** The
  island's `EFFECT_IDS` and `GALLERY_CATALOGUE` live there; `dist` is minified and generated,
  which is why the dead-key scan already skipped it. The published/dirty checks cover the new
  directory exactly as they cover the other four — a vocabulary read from unpushed runtime work
  is the same failure those checks exist to prevent — and `runtime/` had been read by the
  dead-key scan while being covered by neither.

  **THE KEY MAPPING IS READ, NEVER GUESSED.** `editor/src/trait/sceneKeys.ts` declares both
  surfaces as `SceneVocabulary` objects naming each slot's own namespace and key, so one idea's
  two spellings come from the file that owns them: `config.backgroundSceneEffect` behind a
  section against `config.effect` on the inline `spline-scene`, and `config.backgroundSceneSource`
  against `specials.source` — a NAMESPACE change no name-mangling would produce. That is
  `KEY_FOR`'s rule one level up.

  **ABSENT IS SILENT; PRESENT-AND-UNPARSEABLE EXITS 1 — and the assertions had to move for that
  to be true.** `runtime/` is a standalone workspace a checkout may lack, so each list is read
  independently and a missing one drops its own entry. The first version put the
  `gradient-mesh` / `podium` assertions in codegen's table-level block, where they cannot tell
  "the reader drifted" from "this deployment lacks the feature": measured, a checkout without
  `runtime/` fell correctly to eight vocabularies and the assertion turned that into an exit 1.
  They live inside the reader now, where the file is in hand.

  **AND SOURCE C THEN CLOSED THE LARGEST HOLE LEFT, WHICH WAS THE STOREFRONT FILTER SURFACE —
  six elements, thirteen values, and the catalog carried none of them.**
  `specials.filterSource` decides what a filter control is POINTED AT. Measured against each
  element's own prose (`contentTips` + `useWhen` + `avoidWhen` + `description`), the six named
  between 0 and 5 of the 13 and not one named the full set: `filter-checkbox` 5,
  `filter-color` 3, `filter-radio` 2, `filter-slider` 1, `select` 1, `filter-tag` 0.
  `search-input` is the counter-example that proves the platform CAN do this — seven lines of
  `contentTips` naming `searchEntity`, `searchBehavior`, `searchScope` and `searchDisplay` with
  the meaning of each value — and it is prose, which is why its siblings have none.

  The miss is worse than the normaliser cases above. `getFilterSource(id)` returns `undefined`
  without throwing (`schema/src/filters/sources.ts`), and `filtershared.go:187` writes
  `data-filter-source="<whatever was stored>"` VERBATIM into the published markup — so the
  island hydrates owning a query parameter the server answers for nobody, and the shopper gets
  a filter control that narrows NOTHING. Stored, saved, published, rendered.

  `schema/src/filters/sources.ts` is the best source in the whole set: it opens by declaring
  itself "PURE DATA — no imports, and nothing here may import element meta", it is the one
  place a source is spelled, and it exports its own accessors. 57 element vocabularies across
  23 scopes, from 34 across 18.

  - **THE THIRTEENTH VALUE IS `sort`, AND IT IS DELIBERATELY NOT IN `FILTER_SOURCES`.** Its own
    header says every consumer of that table would be wrong about it — the facet endpoint would
    derive values from the catalogue, the query parsers would write `f.sort=` — while a sort
    actually writes `s=` / `s.<node>=`. It is still a value the key legally holds: the config
    dialog's Sort | Filter tab writes it, and `select` SEEDS it. A twelve-value list would
    declare that element's own default invalid, which is `backgroundSceneSource` from the other
    direction.
  - **THE SLIDER IS THE ONE FILTER THAT CANNOT SORT, and it gets `price` ALONE.** Its meta says
    so outright — "Its SOURCE is fixed to `price`, and that is identity rather than a setting …
    the other four plus the select open their config dialog on a Sort | Filter choice; this one
    has no dialog to put that choice in". It renders
    `nodes.SpecialString(n, "filterSource", "price")`, so a slider aimed at `category` publishes
    a numeric range against a categorical facet and matches nothing. DERIVED (the ids whose
    `valueMode` is `range`) rather than the literal the meta names, so a second range source
    reaches it on the next codegen. It is the only legitimate one-value vocabulary in the
    table, and `test/config-vocabulary.test.ts` refuses singletons everywhere else BY NAME
    rather than by loosening the bound.
  - **FOUR SIBLING KEYS RIDE ALONG AND ARE NOT HAND-LISTED.** Every key the config dialog
    writes into `specials` from a draft field whose type in `FilterConfig`
    (`editor/src/features/filters/types.ts`) is a closed union of string literals is published
    with that union: `filterValueMode` (all | manual), `filterMatch` (any | all), `filterArity`
    ('' | single | multi), `filterBehavior` (filter | event).
  - **THE JOIN IS READ OFF THE DIALOG'S OWN `setNodeValue` CALLS**, because no name-mangling
    produces `matchMode` from `filterMatch` or `label` from `customName`. The value expression
    is PAREN-MATCHED and must name exactly ONE draft field, and both halves of that were a
    defect this reader had first: a fixed 200-character window does not merely lose precision,
    `matchAll` CONSUMES it, so four of the thirteen calls fell inside an earlier one's tail and
    were never seen. And "the first `draft.value.X`" is wrong on the one call that reads two —
    `filterTargets` is `draft.value.behavior === 'event' ? [] : draft.value.targets.slice()` —
    which joined a list of node ids to the BEHAVIOUR's union and would have published
    `filter | event` as its legal values.
  - **`''` ON `filterArity` IS LOAD-BEARING AND THE DIALOG NEVER WRITES IT.** It means "follow
    the SHAPE" — a radio holds one value, everything else many — and it is what all four
    option-list filters SEED, while `FilterConfig.arity` resolves it away and names only the
    two an author picks. So the SEEDED value is unioned in: a value the platform itself seeds
    is legal by construction and can never be missing from a list this catalog publishes. That
    is `backgroundSceneSource`'s lesson stated as code rather than as a paragraph.
  - **THE NAME COLLISION IS THE TRAP THE JOIN AVOIDS.** `sources.ts` exports a type called
    `FilterValueMode` whose members are `catalog | fixed | range | authored | text` — a
    property of the SOURCE. `specials.filterValueMode` is `all | manual`, under the same type
    name in a different file. A reader that matched on the type NAME would publish five words
    for a key whose seeded default is not one of them.
  - **MEMBERSHIP IS THE SEED**, the rule `sharedVocabularies` already applies to the `*` scope:
    a key an element does not seed is a key it does not have. So the slider never hears about a
    match mode it has no control for, and the `select` — which holds one value by construction
    — never hears about an arity its island ignores.

  **NO NEW TOOL AND NO PROSE.** It rides in `sb_traits_for`'s `specials_values` and `sb_set`'s
  warning. Measured: `filter-checkbox` 6,478 bytes, `filter-tag` 6,347, `select` 5,199,
  `filter-slider` 5,452 — against a 16,000 ceiling the budget test measures on `list-dataset`,
  still 14,385 and unmoved, because a filter element is not a repeater.

  **AND BOTH OF THOSE READERS WERE HAND-WRITTEN, ONE PER FEATURE, WHILE THE PLATFORM DECLARES
  FASTER THAN THIS REPO WRITES READERS.** Measured: `schema/src` holds 57 exported array
  declarations and the two above name FOUR of them. `form-calendar` alone declares three and
  seeds a key against each — `defaultMode`, `acceptedDates`, `picker`, three declarations in the
  file the element itself lives in — and `sb_traits_for form-calendar` said nothing about any of
  them. A READER gap on this side, not a declaration gap on theirs. `declaredVocab` scans for
  the shape instead, so the next declaration costs nothing: verified against a live branch
  where `SCENE_VIEWER_MODES` had just landed, which joins `specials.sceneViewer` with no code
  change at all.

  **THERE ARE TWO DECLARATION SHAPES AND THE SECOND IS THE COMMON ONE.** Reading only
  `export const X = [ … ] as const` sees 23 lists; the platform more often writes a TYPED array
  whose members are references into an `as const` enum object —
  `export const OPTION_SOURCES: OptionSource[] = [OPTION_SOURCE.MANUAL, OPTION_SOURCE.PRODUCT, …]`.
  That one is not academic: `optionSource` is seeded by `form-select`, `form-radio` AND
  `form-checkbox`, and the platform had declared it all along. A member that cannot be resolved
  to a string literal DROPS THE WHOLE LIST rather than shortening it — a vocabulary missing a
  value tells an agent a working word is invalid, which is this table's own defect history.

  Two rules decide whether a typed array is a vocabulary at all, and both exist because a typed
  array proves less than `as const`. Its element type must be NAMED (`OptionSource[]`,
  `Breakpoint[]`): `readonly string[]` says "some strings", not "the members of a closed type".
  And where every member comes from one enum object, the list must name EVERY member of it.
  `ADDRESS_PARTS` is why: it lists eight of `ADDRESS_PART`'s nine and omits `WHOLE` (`''`), the
  legacy value the platform's own comment says a stored node can still carry — publishing it
  would tell an agent that `form-address`'s own seeded `part: ""` is invalid, which is the
  `backgroundSceneSource` defect exactly. `ADDRESS_TEXT_PARTS` beside it is an explicit
  three-of-nine subset, and `CONDITION_OPS_WITH_VALUE` is another. **Measured, neither rule
  changes today's join count** — `form-address` seeds `part: ''`, which rule 4 below already
  refuses — so both are guards rather than fixes, kept because the shape they refuse is one this
  repo has already shipped once.

  An array of OBJECTS resolves to no literals at all, which is what turns away
  `FIELD_SKIN_KNOBS`, `STARTER_PRESETS` and the `*_TARGET_FIELDS` set — with no name
  special-cased anywhere. THE SCAN IS WIDE AND THE JOIN IS NARROW, deliberately: filtering a
  list out by its name would hide the day one of them starts surviving the join.

  THE JOIN IS THE WHOLE DIFFICULTY AND THE NAME IS NOT THE JOIN — `DATE_PICKERS` governs
  `picker`, and nothing mechanical turns one into the other. A join needs TWO INDEPENDENT pieces
  of evidence, one of which is always the seeded value:

  - **LOCALITY, for a declaration under `schema/src/elements/<type>/`** — a candidate for that
    element's own seeded keys and for nothing else.
  - **THE DECLARATION'S OWN NAME NAMES THE KEY, for a SHARED declaration, AND THAT WAS THE
    SURPRISE.** The plan was that a shared module could join on the seeded value alone. MEASURED,
    IT CANNOT: that produced 17 joins on this tree and **every single one was wrong**.
    `filterBehavior: "filter"` joined `HOVER_PRESET_STYLE_KEYS`, a list of CSS PROPERTY names
    that happens to contain the word `filter`; `qr-code`'s `source: "text"` joined
    `SCHEME_ROLES`; `datasetSource: "product"` and `filterSource: "category"` both joined
    `TRANSLATION_ENTITY_TYPES`. An ordinary English word sitting in an unrelated subsystem's
    list is indistinguishable from a governing vocabulary. Four of those would have OVERWRITTEN
    correct entries `filterVocab` and Source B already publish.

    So a shared list must ALSO be named for the key — `OPTION_SOURCES` for `optionSource`,
    ignoring case, underscores and a plural. **This is a REFUSAL and never a derivation**, which
    is what keeps it clear of the rule that name-derivation is forbidden: it can only reject a
    value match the name contradicts, never invent a key. Measured, it admits `optionSource` on
    all three elements that seed it and turns away all 27 shared value-matches on this tree, the
    original 17 among them. What silence costs is known and
    named: `FIELD_PATTERN_VALUES`' own doc comment says "Every value `specials.patternPreset`
    may hold", `form-text` seeds exactly that key, and this reader will not say so — that
    answer lives in the inspector row that WRITES the key (`FieldPatternRow.vue` →
    `setNodeValue(…, 'patternPreset', v)`), which is Source B's kind of evidence.
  - **THE SEED IS IN THE LIST**, the same reasoning that put `''` in `backgroundSceneSource`
    and kept it out of `filterSource`.
  - **EXACTLY ONE CANDIDATE, IN BOTH DIRECTIONS.** `spline-scene` seeds `speed: "normal"` AND
    `intensity: "normal"` while `SCENE_SPEEDS` and `SCENE_INTENSITIES` both carry `normal`, so
    neither is joined here. The mirror matters as much: one list matching two keys on one
    element is equally unresolvable, so all of its matches drop rather than the first winning.
  - **A SEED OF `''` IS NOT EVIDENCE.** 119 elements seed some key as the empty string, and
    `BACKGROUND_SCENE_SOURCES` carries `''` as a REAL value — the exact shape that would
    attach a scene vocabulary to every empty URL and label an element seeds.

  A LIST OF KEY NAMES PUBLISHED AS THE LEGAL VALUES OF A KEY is the one outcome this must never
  produce, AND NOTHING FILTERS ONE BY NAME. `BACKGROUND_SCENE_RESPONSIVE_KEYS`,
  `BACKGROUND_SCENE_BASE_ONLY_KEYS`, `HOVER_PRESET_STYLE_KEYS`, `TRANSLATION_ENTITY_TYPES` and
  `SCHEME_ROLES` are all read by the scan, offered to the join like any other list, and rejected
  by the rules above on their own — a `_KEYS`-suffix exclusion was tried and REMOVED, because a
  name filter would hide the day one of them starts surviving. The five are ASSERTED instead:
  each must still be FOUND, and each must have joined NOTHING. Both halves were checked by
  breaking them — dropping the name-corroboration requirement exits 1 naming
  `HOVER_PRESET_STYLE_KEYS`, and breaking the scan exits 1 naming the declaration it can no
  longer see — which is what makes the assertion live rather than shadowed by the filter.

  It runs FIRST among the Source C readers so the two hand-written ones keep the last word
  where they overlap — they read the platform's own KEY MAPPING where this one infers the key
  from the seed. NEITHER IS SUBSUMED and neither was forced: the general reader reaches 1 of
  `sceneVocab`'s 12 vocabularies and 0 of `filterVocab`'s 23. 57 → 64 vocabularies, purely
  additive, with `list-dataset` unmoved at 14,385 bytes.

  **AND THE RULE UNDERNEATH ALL OF IT IS ONE SENTENCE, worth more than the table it produced:
  DO NOT TAKE THE THING THAT ACTS AS THE THING THAT DEFINES.** A guard acts on a value; a
  vocabulary defines it. An emitter acts on a choice; an inspector row offers it. In a codebase
  with this much lockstep the acting side is always the easier one to find and always the wrong
  one to trust — and this repo paid for that twice in one day, reading `bgSceneColorRule` as a
  normaliser and then reading Go emitters for six keys whose inspector rows held the real list
  (`PopupTriggerRow.vue:70` is literally `(['once','always'] as const)`). Those looked like two
  separate mistakes and are one.

  The platform states the ordering as a LADDER, and every gap between two adjacent rungs is a
  defect this file already has a name for:

  > **declaration > row > emitter** — what the platform DEFINES, what an author may CHOOSE,
  > what the renderer can DRAW.

  - **declaration ahead of row** — a value only an agent can reach. `config.splitDirection`
    exactly: seeded, legal, stored, published, rendered identically, with no inspector row, so
    a merchant cannot reach it and `sb_set` can on every call.
  - **row ahead of emitter** — a control that silently does nothing, the shape this platform
    ranks worst. `gallery` and `model` each spent a wave here legitimately, which is why an
    emitter is a FLOOR: reading one under-declares by whatever has been declared and not yet
    drawn.
  - **row ahead of declaration** — the editor promising what the schema does not define. NO
    INSTANCE EXISTS, measured across all 61 vocabularies: one write key is answered by two
    source classes (`specials.source`) and it is three elements with three vocabularies, not a
    conflict. So the ordering here is deliberately NOT encoded for it — a rule written for a
    situation that has never occurred is one nobody can test, and the first real instance is
    when you learn which way it actually wants to go.

  Which is why `test/config-vocabulary.test.ts` asserts the SOURCE and not only the values: a
  catalog that gets the right answer from the wrong rung is right until the rungs disagree, and
  then it is wrong with no warning.

  **AND "LOCAL TO THE ELEMENT" IS REQUIRED RATHER THAN PREFERRED — measured, after being
  specified the other way.** The brief for this reader said a declaration in a SHARED module
  could be a candidate for any element seeding a matching value, with the seed-membership rule
  left to carry it alone. It cannot: allowing it produced 17 joins and **all 17 were wrong**,
  four of them overwriting correct entries. `filterBehavior: "filter"` joined
  `HOVER_PRESET_STYLE_KEYS` (CSS property names), `qr-code.source: "text"` joined
  `SCHEME_ROLES`, `datasetSource: "product"` joined `TRANSLATION_ENTITY_TYPES`. A seed value is
  a common English word and coincidental membership is the normal case, not the edge one.

  The cost is named rather than hidden: `FIELD_PATTERN_VALUES` genuinely governs
  `form-text.patternPreset` and lives in a shared module, so this reader stays SILENT on it.
  The evidence that would reach it is `FieldPatternRow.vue`'s own write — Source B's kind of
  evidence, and a separate reader, deliberately not bolted onto this one.

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

- **THE INERT-ON-ADD TABLE HAD THREE ENTRIES AGAINST 113 ELEMENTS, AND AN AUDIT OF ALL 113
  FOUND SEVENTEEN MORE.** `src/domains/site/inert.ts` existed for elements that render
  convincingly while wired to nothing — locale-switcher's fabricated chip, breadcrumb's
  English root word, spline-scene's borrowed demo — and it only knew about the three it was
  written for. `quickview` had ALREADY arrived and gone unnoticed: a site-level panel that
  renders nothing until a product list's `quickviewId` points at it, exactly the shape the
  table exists to catch, sitting undetected in the same catalog the table is checked against.

  The audit read all 113 elements' own prose against the file's own criterion — the first
  write succeeds completely, the element still does nothing useful, and a competent author
  would be SURPRISED because neither the tree nor the screenshot says so — and rejected far
  more matches than it kept. A crude regex over "renders nothing" / "hides itself" / "would be
  inert" catches real traps (`bundle-items`, `chat-widget`, `currency-switcher`,
  `theme-switcher`, `points-card`, `points-prompt`, `order-receipt`, `payment-status`,
  `form-step-count`, `form-step-button`, `list-empty`, `list-loading`, `rating-stars`,
  `menu-drawer`, `menu-panel`, `accordion-content`) and also catches ordinary "this control has
  a placeholder" prose (`form-text`, `form-number`, `search-input`, `cart-total`) that is not
  inert at all — the discriminator has to be read, not matched. Two distinctions did most of
  the rejecting:

  - **A list rendering ITS OWN empty state is not this.** An empty catalogue is a CORRECT list
    waiting for data, honestly shown as such, and the catalogue check already reports it.
    `rating-stars` is the opposite shape kept IN: it renders ZERO PIXELS with no reviews, no
    empty state at all, so a right placement and a forgotten one look identical — and it has NO
    config fix, since typing a fallback number "publishes a score nobody gave." That is worth
    keeping despite the table's own stated contract ("names the SECOND write"): sometimes the
    honest second fact is that no write helps, and staying silent about that would be worse.
  - **A fact already in the always-visible `description` is not this either.** Eight satellite
    types (`accordion-item`, `menu-dropdown`, `menu-item`, `product-variant-label`,
    `product-variant-option`, `quantity-button`, `quantity-input`, `tab-item`) already say
    "Never placed directly … a style-holder, not a rendered element" in the field
    `sb_catalog_search` returns BY DEFAULT, with no `detail:true` needed — an inert-on-add
    entry there would warn a caller of a fact they already have. `tab-content` and
    `carousel-slide` were rejected on close reading for the same shape from the other
    direction: their AVOID says "only VALID inside" (a semantic/wrong-tool note, the same
    register as `flex-block`'s "as the outermost wrapper — use flex-section"), where every kept
    entry's AVOID says "only RENDERS inside/through/as" — a claim about what actually happens
    on screen, not about which element is more idiomatic. `accordion-content` keeps the
    opposite of that sibling pair: its AVOID is the render-language ("it only renders as an
    accordion child"), and nothing refuses placing it under a permissive parent instead, since
    only `accordion` itself restricts its own children.

  **It cannot be generated, and re-deriving why matters more than the conclusion.** Eighteen
  element types appear in some parent's `childAllows`, and that set mixes genuine host-bound
  components (`tab-content`, `list-item`, `carousel-slide`) with general elements a permissive
  parent happens to accept (`heading` inside `search-input`, `image` inside `image-marquee`) —
  no flag on the meta separates the two. `locked` is true for the eight hidden satellites
  above and false on entries that belong just as much — `bundle-items`, `chat-widget` and
  `theme-switcher` are none of those things: ordinary, unlocked, visible elements whose second
  dependency is a site setting or an app, not a parent. `hideInLayer` is false on every entry
  in the table. `category` puts a real trap (`menu-panel`) in the same bucket as ordinary
  content (`heading`) that carries none of this. The durable fix is upstream: a flag on the
  element meta saying it renders only through a named host, or only once a named condition (an
  app installed, a locale count, a signed grant) is met. Until the platform declares that, this
  table — hand-kept, and stale again the next time an element like `quickview` ships — is the
  only place the fact lives, and the next audit should re-read all of it rather than trust the
  count.

  **THE STALENESS IS DETECTABLE NOW, even though the table still cannot be generated.** The
  paragraph above predicted the next `quickview`, and a prediction is not a check —
  `quickview` itself was found by a person reading 113 elements' prose, not by anything that
  runs. `reportInertDrift` (`scripts/inert-drift.ts`) asks on every `codegen` and every
  `codegen:check`, using the discriminator the audit itself produced: every KEPT entry
  describes itself in RENDER language ("only renders inside/through/as" — a claim about what
  happens on screen), while every rejected one uses VALIDITY language ("only VALID inside" — a
  note about which element is idiomatic). Measured against the 113-element catalog: **15 of
  the 20 entries match, 5 do not** (`spline-scene`, `form-step-button`, `form-step-count`,
  `theme-switcher`, `breadcrumb` — real traps described in other words), and **one element
  outside the table matches** (`text-dataset`, whose avoid says the description kind "renders
  only the product's own sanitized rich text" — render language about CONTENT, not about being
  inert). 75% recall is nowhere near enough to GENERATE the table and plenty to WARN — and
  `quickview`'s own avoid reads "this panel only renders through the list that names it", so
  the check would have caught the one element that actually slipped through.

  **DO NOT WIDEN THE PATTERN UNTIL IT CATCHES ALL TWENTY.** A pattern tuned to fit today's
  twenty describes the twenty rather than the property — the same mistake this file already
  records for the `node.States` grep that "found only four files" and produced a conclusion a
  probe then disproved. The five misses are the check's stated limit, written into its header
  and pinned by `test/inert-drift.test.ts` so a header that overstates its reach goes red.

  It WARNS and does not fail `--check`, for the reason `reportUndocumentedRoutes` does not
  either: this drift is not fixable by regenerating anything here, so failing would send the
  caller to run the one command that cannot help. The message names the AUDIT instead — read
  the element against the criterion above, then either add an entry naming the second write it
  needs, or record the rejection in `AUDIT_REJECTED` with the reason. That ledger is the other
  half of the fix, not a skip list: an unexplained line in it is indistinguishable from a bug
  being hidden, which is why `text-dataset` carries its reasoning and not just its name.

- **AN ELEMENT SEEDS A CONFIG KEY THAT NOTHING READS, AND WRITING IT DOES NOTHING AT ALL.**
  Every silent failure above is "this value means something other than you think". This is the
  quieter one: the KEY is read by nothing, so NO value means anything. `sb_node_read` returns
  it with a plausible value, an agent following design rule 0 reads it off the node and writes
  a different one, and the write stores, saves, publishes and renders EXACTLY AS BEFORE — no
  error at any step, nothing on the page to see. Same family as a binding outside the
  `specials` namespace, a `stuck` override with no host, and `payCard*` written on a `form`.

  **IT PROTECTS THE HUMAN AND NOT THE AGENT**, which is the asymmetry trap 4 already records
  for `BASE_ONLY_CONFIG`: the inspector draws no row for a key nothing renders, so a merchant
  cannot reach it, and an agent can reach it on every call.

  **THE PLATFORM'S OWN CENSUS CANNOT ANSWER THIS, and reaching for it is the first thing that
  looks right.** `server/render/tests/testdata/config_keys.json` lists the config keys the Go
  renderer reads and is INCOMPLETE: `config.panelBg` is read for real at
  `server/render/nodes/chat-widget/css.go:115` — from a table rather than through a `cfg*`
  helper — and is absent from it, and its own header comment records ten keys having left it
  silently once before. A check built on that census would tell an agent a working key is
  DEAD, which is strictly worse than saying nothing.

  So the index is RAW: every identifier in `schema/src`, `editor/src`, `server` and `runtime`,
  with one load-bearing exclusion — an element's own `meta.ts`, because A SEED IS NOT A READER
  and every key would otherwise find itself. **READ ONLY BY THE EDITOR IS NOT A DEFECT AND IS
  NOT REPORTED**: `config.textGlobalStyle` records the author's pick while the rendering
  travels as a `var(--wb-ts-…)` in `style`, and `customImageRatio{Width,Height}` are the same
  shape. The question is narrower and it is the only one worth asking — read by NOTHING,
  ANYWHERE.

  MEASURED against `origin/main` of 2026-09-14 (`3b9ade0c`): 3,966 files, 76,235 distinct
  identifiers, **0.86 seconds**; 385 seeded `(namespace, key)` pairs over 384 distinct names;
  **exactly one key read nowhere — `config.splitDirection` on `image-comparison`, zero false
  positives.** The platform's own comment three lines above that seed confirms it — the
  inspector editor that would write it "is still an inert placeholder" — and its sibling
  `splitPosition` IS read, so the element renders a split at a direction no document can move.

  It is GENERATABLE, which is what separates it from `INERT_ON_ADD` next door, so it is
  GENERATED (`scripts/deadkey-scan.ts` → `src/catalog/deadkeys.generated.ts`) and never
  hand-kept; `test/deadkey-scan.test.ts` pins the file against its own emitter, so a hand edit
  goes red rather than surviving to the next codegen. Codegen WARNS and does not fail
  `--check` — this drift is not fixable by regenerating anything here, so the message names
  the two upstream fixes instead: wire the key up, or drop the seed from
  `schema/src/elements/<type>/meta.ts`. `sb_set` says the same thing at the moment of the
  write, once per key per process, as a WARNING and never a refusal, for the reason
  `unknownValueNote` records: the platform stores what it is given, and a refusal would also
  turn away the write a deployment newer than this catalog has finally wired up.

  An identifier index cannot see a key assembled at runtime (`cfg['split' + 'Direction']`),
  and it counts a MENTION as a read — an element's `ai.ts` prose naming a key it no longer
  renders would keep that key out of the table. Both are stated in the header as a FLOOR
  rather than chased: the measured configuration already finds the one real defect with no
  false positives, and widening a scan until it can prove a negative is what this repo paid
  for when a grep for `node.States` "found only four files" and produced a conclusion a probe
  then disproved.

- **The form field-skin rule is generated (`FIELD_SKIN_BY_NODE`).**
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
