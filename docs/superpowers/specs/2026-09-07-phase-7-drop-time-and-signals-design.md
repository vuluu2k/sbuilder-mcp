# `sbuilder-mcp` Phase 7 — the drop-time contract, and the signals we already receive

**Goal:** close every way this server's OWN tools write a document the platform
renders wrong, saves wrong, or publishes wrong without saying so.

**Spec it extends:** `docs/superpowers/specs/2026-08-27-sbuilder-mcp-design.md`.

Nothing here adds a tool. Ten silent failures, all reachable through `sb_add` / `sb_set` /
`sb_move` / `sb_remove` / `sb_duplicate` / `sb_page_create` / `sb_publish` — no raw
`sb_api_call` required to hit any of them — and every one is silent today. Section
2.1 is the eleventh item and the odd one out: it is not a failure of its own but
the walk both duplicate fixes are built on, so it is specified with them.

## Why this phase and not the other two

An audit of the platform against these tools found gaps on three axes. This phase
takes the first, and records the other two so the evidence is not re-derived:

- **Correctness** (this phase). The tools we already ship can corrupt a document.
- **Reach.** `sb_api_call` is a CLOSED LIST — `src/tools/api.ts:191` throws
  `unknown operation` on anything absent from the committed catalog — so what the
  OpenAPI document omits is unreachable, not merely undescribed. There are two
  groups, measured twice by different methods that agreed:

  **(a) Annotated in Go, absent from `swagger.json` — 34.** Diffing 446 `@Router`
  annotations against the 412 declared paths. The reverse diff is 0, so the
  catalog is a strict SUBSET of the annotations: this is pure staleness in the
  platform's checked-in artifact. Contents: all four `shipping-zones` routes,
  `inventory` and its history/adjust, seven `quizzes` routes, the
  `course-instructors` surface, `course-enrollments`, `admin/translation-keys`,
  and five `_wb` storefront routes including `POST /_wb/checkout/order` and
  `/checkout/quote`.

  **`npm run codegen` does NOT recover these.** The generator reads
  `server/docs/swagger.json`, which is the stale artifact itself — a codegen run
  against a current checkout produced no diff, which is how the staleness was
  found. Recovering them needs `swag init` re-run in `web_builder`, which is the
  platform repo's job, not this one's.

  **(b) Registered with NO `@Router` at all — 41.** No annotation diff can ever
  surface these, by definition. They are found through the route-map comment
  blocks at the top of each `server/internal/*/rest/*.go`
  (`//\tGET/PUT/DELETE  /path`), parsed and diffed against both the annotations
  and the catalog — note that some are written as paths RELATIVE to
  `/api/sites/{siteId}`, and a filter that assumes an absolute path silently
  drops them (it undercounted 41 as 27 on the first pass here). The clusters:
  `courses` lessons/sections (9), **`pages` (9)**, `blog` articles and categories
  (8), **`payments` (7)**, `integrations` (3), `templates` (2), domain
  canonical/redirect (2). One entry (`DEL /api/orgs/{}/members/{}`) is a parse
  artifact of an abbreviated comment.

  Two consequences worth stating plainly. `GET/PUT/DELETE
  /api/sites/{siteId}/payment-gateways/{provider}` is in group (b) — documented
  only in a plain Go comment (`server/internal/payments/rest/manage.go:15`) — so
  `sb_review` can diagnose its own `payment` store-gap and nothing can close it.
  And the whole `pages/{pageId}` cluster is in group (b): this server cannot read
  ONE page's metadata, cannot `PATCH` it (so no title, description, canonical, OG
  image or JSON-LD on any page it publishes, and `noIndex` can never be cleared),
  cannot delete a page, and cannot reach any of the five version/history/restore
  routes — while undo is client-local with no API at all
  (`editor/src/history/patchRecorder.ts:7-12`), so those checkpoints are the only
  thing that could recover a wrecked draft and they are unreachable too.
- **Capability.** Only 45 of 180 write operations declare a body. `PUT /theme`,
  `PUT /settings`, and all of global-sections and overlays declare none, and
  `PUT /settings` is a whole-document replace (`editor/src/features/settings/api.ts:18`),
  so a partial body silently erases the rest of the store's configuration.

Correctness comes first because capability built on a base that silently corrupts
documents compounds the damage, and because this repo's standing rule is that an
unproven guard is indistinguishable from an absent one.

## What the catalog is NOT stale on

Checked before designing: `npm run codegen` against the current `web_builder`
produced no diff — 106 elements, 412 operations, 77 binding sources. Every gap
below is a missing rule, not a stale table.

## Group 1 — creation is incomplete

The editor does two things when a node is added that `createNode` does not. This is
the same class of defect as the bindings bug already recorded in
`src/domains/site/node.ts` — "the editor derives them at drop time … every node
this server minted saved, published and rendered its placeholder forever" — and it
is that lesson unlearned twice more.

### 1.1 Satellites are never minted

A satellite is a real node in the document's node map referenced from
`config[configKey]` instead of `data.nodes`. The declaration carries three fields
(`schema/src/elements/types.ts:13-34`):

```
SatelliteRule { type, configKey, optional? }
```

`optional` is load-bearing and is why the Go map is the WRONG source. The comment
on the flag says it plainly: absent (the normal case) means "the owner MINTS its
satellite — at create time"; `list-loading` is opt-in because a list with no
loading design shows a silhouette of its own cards, which is the better default,
while `list-empty` is seeded because a list with no empty state ships ghost cards
to a shopper — "a lie". `server/render/generated/schema_gen.go:252` flattens both
into one map and loses the distinction.

Eight element types own satellites, and every satellite type is an element this
catalog already carries — verified, so minting one is an ordinary `createNode`:

| Owner | `configKey` → satellite type |
| --- | --- |
| `accordion` | `accordionItemId` → `accordion-item` |
| `cart-order` | `emptyStateId` → `list-empty` |
| `dataset-block` | `emptyStateId` → `list-empty` |
| `list-dataset` | `emptyStateId` → `list-empty`; `loadingStateId` → `list-loading` **(optional)** |
| `menu` | `menuItemId` → `menu-item`; `menuDropdownId` → `menu-dropdown` |
| `product-variants` | `variantLabelId` → `product-variant-label`; `variantOptionId` → `product-variant-option` |
| `quantity-dataset` | `quantityButtonId` → `quantity-button`; `quantityInputId` → `quantity-input` |
| `tab` | `tabItemId` → `tab-item` |

`list-loading` is the ONLY optional satellite in the whole platform (a grep of
every `meta.ts` returns exactly one `optional: true`), which is precisely why the
flag must be read rather than assumed: get it backwards and every list this server
mints either loses its empty state or gains a loading design nobody asked for.

**Today:** `createNode` returns `nodes: []` and seeds no satellite, and neither
`accordion` nor `tab` carries its satellite key in `meta.defaults`. So an
accordion added through `sb_add` has no `accordionItemId` at all, and the renderer
takes its degrade path — which `server/render/scope/capture.go:98-105` records as
a missing satellite "simply resolves to nothing at assemble time".

**Fix:** codegen emits `SATELLITE_RULES`; `createNode` mints each non-optional
satellite as a node whose `parent` is the owner, absent from the owner's
`data.nodes`, and points `config[configKey]` at it.

### 1.2 Seeded child content is never added

`ELEMENT_SEEDS` (`editor/src/element/seeds.ts:51`) is "content the element is not
USABLE without — an empty drawer, say, is a white rectangle with no way out of
it". Three entries: `dropdown` (a trigger and a panel; without them "a bare
relative box"), `select` (which renders INTO those two nodes, so without them it
"draws an empty box"), and `popover`.

**Fix:** codegen emits `ELEMENT_SEEDS`; `addSubtree` applies it when the caller
passes no `children` of its own. A caller who passes children has expressed an
intent and is not overridden.

The file says it is "EDITOR-SIDE ON PURPOSE … so this never reaches the render
contract or codegen". That boundary is about the RENDERER, which reads documents
it is given. This server creates nodes, which is exactly the editor-side role, so
it needs the table for the same reason the editor does.

## Group 2 — the walk does not know satellites exist

`src/core/tree.ts` follows `data.nodes` and `data.parent` only; the string
`menuItemId` appears zero times in this repository. The platform states the
contract in as many words at `schema_gen.go:245-251`: *"Anything that asks 'what is
inside this node?' (subtree collection, copy, delete) must consult this table as
well, exactly as the editor's `subtreeIds` does."*

### 2.1 `subtreeIds` walks satellites — the mechanism, not a defect of its own

`NodeLike` gains `config`, and `walk` follows `config[configKey]` for the node's
type as well as its child list. This follows the `pageChildren` / `childrenOf`
precedent already in that file: the CORRECT walk gets the shorter name, because a
caller who writes the obvious thing must not be silently wrong.

`removeNode` is already satellite-safe by a different route — a parent-pointer
closure it learned the hard way (`src/domains/site/builder.ts:411-421`) — and stays
correct, since the closure is a superset.

### 2.2 `sb_duplicate` shares the original's satellite

`duplicateNode` clones with `JSON.parse(JSON.stringify(src))` and rewrites only
`id` and `data` (`src/domains/site/builder.ts:345-347`). So `config.accordionItemId`
is copied VERBATIM and the copy points at the original's skin node. Two accordions
then share one item skin — editing one changes both — and removing the original
deletes that skin under the copy, leaving a dangling reference in the renderer's
silent degrade path.

**Fix:** deep-copy each satellite under a fresh id and rewrite the copy's
`config[configKey]`. The editor's `copyNode` is the reference implementation and
documents exactly this: *"Satellites are deep-copied and the owner's pointer
rewritten"* (`editor/src/stores/node.ts:373, 403`). A satellite id present but not
resolvable in `nodes` is left unset rather than copied (`node.ts:408-411`).

### 2.3 `sb_duplicate` copies composition stamps

The same verbatim clone carries `specials.globalId`. Duplicating a global header
therefore yields two ROOT children with one `globalId`, which the platform refuses
on a LATER save with `ErrDuplicateGlobal` (`server/internal/page/decompose.go:293`)
— by which time the agent has kept editing and gets a bare `duplicate_global` that
reads like a transport error.

**Decision — strip, do not refuse.** The copy loses `globalId` / `globalRef` /
`globalKind` and becomes a plain local section, and the result says the copy is no
longer shared. This is what a designer means by duplicating a header to make a
variant. It differs from the existing overlay and app-block refusals on purpose:
those refuse because the SERVER would destroy the copy, whereas a stripped global
copy is a perfectly valid document. Refusing would leave no path at all to "make a
variant of my header".

`validate.ts` also gains the guard for documents we did not author: no
`globalId` / `overlayId` on anything but a direct child of ROOT
(`decompose.go:256` `ErrGlobalNested`, `overlay.go:46-55`), and neither id twice
among ROOT's children.

## Group 3 — signals the platform sends and we discard

### 3.1 Compose warnings

`GET .../source` returns `warnings` alongside the document.
`src/transport/pages.ts:12` TYPES the field (`warnings?: unknown[]`) and no code
path anywhere reads it. Six codes ride it — `globalMissing`, `globalStale`,
`overlayStale`, `appBlockMissing`, `appBlockEdited`, `formMissing`
(`server/internal/page/rest/rest.go:271,309,323,350`).

`globalMissing` is the destructive one: the server DELETES the reference from the
composed document it hands back (`compose.go:124-138`, `delete(d.Nodes, cid)`). So
the page opens with the section already gone and the next save stores that loss
permanently, with no error at any step.

**Decision — report as a finding, do not block the save.** `sb_page_open` surfaces
the warnings in the findings shape it already uses, with text saying the section
was dropped and that saving will persist it. The stronger option — treating a
missing master as divergence under the yield rule so the next save fails loudly —
was considered and rejected: it needs an escape argument on the write path, and
without one a page whose master is genuinely gone becomes uneditable.

### 3.2 Publish silently skips a draftless page

`Publish` drops any target whose source is missing and still answers 200 with the
pages that did publish (`server/internal/page/service.go:650`, `continue // nothing
to publish yet`). `sb_page_create` followed by `sb_publish` with no save in between
does exactly this: success response, page never flips to published, URL 404s.

**Fix:** `sb_publish` asserts the requested page id appears in the returned list
and reports "no saved draft — nothing was published" when it does not.

### 3.3 A colliding slug is renamed, not refused

`uniqueSlug` suffixes `-1`, `-2`, … and its own comment says it "never errors"
(`server/internal/page/service.go:877-896`). `ErrSlugConflict` exists and maps to
409, and this path never reaches it. So the create returns 200 carrying a
DIFFERENT slug than the one asked for, and every link the agent then authors to
the slug it requested is dead.

**Fix:** `sb_page_create` compares the returned slug against the requested one and
reports the rename.

## Group 4 — render rules `sb_review` does not know

### 4.1 A repeater renders its first child only

`templateID` returns `n.Data.Nodes[0]`
(`server/render/nodes/list-dataset/html.go:60-65`). A second child is valid, saves
fine, and never appears in the published HTML.

**Decision — refuse the write, and report what we find.** `sb_add` and `sb_move`
refuse a second child into a dataset container (`isContainer && category ===
'dataset'`, the predicate `review.ts` already uses), naming the rule; `sb_review`
reports extra children in documents we did not author.

### 4.2 An unlinked form publishes an empty box

`form` seeds `specials.formId: ""` — verified in the generated catalog — and
`server/internal/page/form.go:221-225` skips an empty `formId` with an explicit
comment that this is deliberately NOT a warning, because it is the ordinary state
of a node just dropped. Forms compose on the RENDER path only, so the canvas looks
identical either way. An unlinked form is therefore the DEFAULT outcome of
`sb_add`, and it publishes a box with no fields in it.

**Fix:** a `sb_review` finding requiring a non-empty `formId` on a `form` node.

### 4.3 A menu publishes dead links

`menu` seeds `specials.menuId: ""` AND `menuItems: [{id:'mi-1',label:'Home',href:''}]`.
The Go renderer reads `menuItems` and never `menuId`
(`server/render/nodes/menu/html.go:52-58`); resolution from a menu id to hrefs is
client-side (`editor/src/features/menus/snapshot.ts:101`). So a freshly added menu
publishes a nav whose one link goes nowhere, and setting `menuId` — the natural
reading of the field name — renders an empty nav.

**Fix:** a `sb_review` finding requiring a non-empty `href` (or a resolving
`panelId`) on every entry of `specials.menuItems`.

## Where the code lands

| Rule | File |
| --- | --- |
| 1.1, 1.2 | `scripts/gen-catalog.ts`, `src/catalog/elements.generated.ts`, `src/domains/site/node.ts`, `src/domains/site/builder.ts` |
| 2.1 | `src/core/tree.ts` |
| 2.2, 2.3 | `src/domains/site/builder.ts`, `src/domains/site/validate.ts` |
| 3.1 | `src/transport/pages.ts`, `src/tools/page.ts`, `src/domains/site/findings.ts` |
| 3.2, 3.3 | `src/tools/page.ts` |
| 4.1 | `src/domains/site/traps.ts`, `src/domains/site/review.ts` |
| 4.2, 4.3 | `src/domains/site/review.ts`, `src/domains/site/findings.ts` |

No new tool is registered, so `tools/list` stays inside the 16,000-char ceiling
`test/token-budget.test.ts:23` holds it to. New finding codes cost a line in the
`fixes` legend only when a finding of that code is present, which is the shape
that phase already established.

## Codegen: two new tables

Both come from the platform, never hand-kept, because a hand-kept copy of a
platform table is the thing that goes stale silently.

- `SATELLITE_RULES` — from the element metas the generator already imports
  (`schema/src/elements/registry.ts`), carrying `type`, `configKey` and
  `optional`. Asserted non-empty for all eight owner types, so the table cannot
  silently empty the way the `attributes` bug did in Phase 6.
- `ELEMENT_SEEDS` — from `editor/src/element/seeds.ts`. It imports only
  `@webbuilder/schema` (types) and a factory importing the same, with no Vue, so a
  dynamic import under tsx is viable the way the schema imports already are.
  **Risk:** those imports use the PACKAGE specifier `@webbuilder/schema` rather
  than the relative paths the generator imports today, so resolution depends on
  the monorepo's workspace links. If it does not resolve, read the three entries
  through the TypeScript AST instead — the fallback is cheap because the table has
  three entries, and a coverage assertion keeps either route honest.

## Testing

Every rule gets a test; this repo treats an unproven guard as an absent one. Offline
fixtures throughout — several of these were originally found only by a live run,
and the fixtures encode what that run found.

- `test/node.test.ts` — a minted `list-dataset` carries `emptyStateId` pointing at
  a real `list-empty` node and NO `loadingStateId`; a `dropdown` arrives with its
  trigger and panel; a caller's own `children` are not overridden.
- `test/tree.test.ts` — `subtreeIds` returns satellites for all eight owner types.
- `test/builder.test.ts` — a duplicated accordion's `accordionItemId` differs from
  the original's and resolves; a duplicated global carries no `globalId`.
- `test/validate.test.ts` — nested and duplicated `globalId` / `overlayId` refused.
- `test/traps.test.ts` — a second child into a dataset container refused by both
  `sb_add` and `sb_move`.
- `test/review.test.ts` — findings for an unlinked form, a menu entry with an empty
  `href`, and a repeater with two children.
- `test/page-tools.test.ts` — compose warnings surfaced by `sb_page_open`; a publish
  omitting the requested page reported; a renamed slug reported.
- `test/token-budget.test.ts` — unchanged ceilings still pass.

## Out of scope

Reach and Capability, as recorded at the top. Also out: a live end-to-end run,
which needs credentials this repo does not hold.

## Gate

`npm run build && npm test && npm run smoke`, green at the end of each group.
