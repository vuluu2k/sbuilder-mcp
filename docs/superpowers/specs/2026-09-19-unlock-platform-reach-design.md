# Unlock platform reach — design

Date: 2026-09-19. Status: approved in conversation, pending written review.

## 1. Why

The request was "optimise the MCP so it unlocks every restriction against the web
builder". Measured before designing anything, the restrictions are four different things,
and each needs a different fix:

| Restriction | Measured | Where it lives |
|---|---|---|
| The server does not connect from this repo | `node_modules/.bin/sb-mcp` absent; the MCP client reports `CONNECTION_CLOSED` | dogfood wiring (CLAUDE.md records the recipe) |
| The catalog is stale | committed stamp 531 operations; platform origin/main 560; shapes 190 → 251 writes | `src/catalog/*.generated.ts` |
| `sb_api_call` is a closed list | 20 routes the platform never annotated plus anything newer than the last regen are unreachable | `src/tools/api.ts` |
| Write guards refuse rather than warn | 13 `refuse*` sites; every one asserts what a deployment renders, and the catalog can be older than the deployment | `src/domains/site/builder.ts`, `traps.ts`, `sticky.ts`, `hover.ts` |
| Editor parity | 413 editor calls; 374 catalogued, 390 after regen; 51 writes unshaped; 8 of 59 feature areas with a dedicated tool; 6 multi-step flows an agent must reproduce by hand | catalog + `src/tools/store.ts` |

Two of the parity gaps are not fixable here at all. `POST /api/sites/{siteId}/pages` and
`POST /api/sites/{siteId}/courses` both decode a named struct, and both are unshaped because
their `@Router [post]` line sits on a function that never decodes (`listPages`; a block
stacked above `handleOverview`, GET only). Recovering that by widening `scripts/shapes.ts`
to read sibling functions would guess, which is the failure the shape table exists to
remove. The fix is upstream, and it is the same fix the 20 unannotated routes need.

## 2. Goals and non-goals

Goals, in the order they are built:

1. The server connects from this repo; the in-progress `item_offset` work lands; the two
   codegen tests stop timing out under load.
2. Every operation the deployed platform documents is reachable with its shape, and any
   route it does not document is reachable by method and path.
3. A guard that asserts render behaviour can be overridden per call, and a guard that
   protects the platform's own invariants cannot.
4. The three multi-step editor flows with the most to gain are one `sb_store` action each,
   and the platform's annotation gaps are closed at the source.

Non-goals:

- No new tool. Every addition rides on an existing tool's arguments or on `sb_store`'s
  `action` axis. `tools/list` must stay under the token-budget ceiling; if it does not, the
  ceiling is raised with the reason written down.
- No change to credential routing, to `dry_run` defaulting to true, or to the yield rule.
- No shape guessed from anything but a decode site. The raw call carries no shape and says so.
- Section-template authoring and the media detach fan-out stay by hand; both are
  editor-side conveniences with low agent value.

## 3. Sub-project 1 — connection and work in progress

- `ln -sf ../../dist/index.js node_modules/.bin/sb-mcp && chmod +x dist/index.js`. The
  user reconnects the MCP client; a running server does not re-read itself.
- The `item_offset` diff (`src/tools/api.ts`, `test/api-call.test.ts`, both `docs/tools*.md`,
  both READMEs) is reviewed as is: it slices a list answer after the platform's own paging,
  refuses a positive offset on any method but GET/HEAD, keeps original fields when `pick`
  matches nothing on every item, and never reports a non-advancing `next_item_offset`. It
  commits as one `feat(api)` commit after the gate.
- `test/codegen-dirty.test.ts` and `test/codegen-undocumented.test.ts` spawn `tsx` per test
  and measured 6-8 s on a loaded machine against vitest's 5 s default. Each gets a 20 s
  per-test timeout, with the measurement in the comment.

## 4. Sub-project 2 — reach

### 4.1 Regenerate the catalog

`WB_REPO=<detached worktree at origin/main> npm run codegen`. The worktree is the one
codegen accepts: clean, on a remote branch. Expected: 531 → 560 operations, shapes
190 → 251, and the `ai-credits` routes still reported by `reportUndocumentedRoutes` as an
upstream `swag init` gap. If `test/token-budget.test.ts` trips, the ceiling moves with the
reason.

### 4.2 The raw form of `sb_api_call`

`sb_api_call` takes `id` today. It gains `method` and `path`, valid only when `id` is
absent; giving both, or neither, is an error naming the two forms.

Rules, each inherited rather than new:

- **Credential by path prefix**, through `credentialFor(path)` — `/api/v1/…` takes the key,
  everything else is site-scoped. Nothing in the raw form can choose a credential.
- **`path` is a bare platform path.** It must start with `/` and must not parse as a URL
  with an origin. `request()` prefixes `ctx.base`; a path carrying a host would send this
  install's credential to another server, the leak the sitemap fetch already guards against.
- **`{siteId}` / `{siteID}` default to `SB_SITE`** through the same substitution as the
  catalogued form; every other placeholder must be supplied in `params`.
- **`dry_run` defaults to true**, and the preview is redacted, exactly as today.
- **No undo is prepared.** `sb_undo` needs a shape to know which fields to carry back and a
  raw route has none. The result carries `uncatalogued: true`, and `ctx.notices.once` says,
  once per process, that a raw call has no call sheet, no shape, no body warnings and no
  undo, and that the durable fix is to annotate the route upstream.
- `pick`, `max_items`, `item_offset` and the 204 handling apply unchanged.

### 4.3 Discovery

When `sb_api_find` matches nothing for a query, its answer names the raw form and the
routes known to be outside the catalog by construction — today `/api/permissions`,
`/api/plans`, `/api/locales`, registered directly on the gin router. This is a fixed
three-entry list in `src/tools/api.ts` with the reason beside each, not a generated table:
the generated answer for unannotated routes is sub-project 4's upstream fix.

## 5. Sub-project 3 — forcible guards with a hard core

### 5.1 Argument

`force?: boolean`, default false, on `sb_add`, `sb_set`, `sb_move`, `sb_remove`,
`sb_duplicate`, `sb_bind` and `sb_event`. Off means today's behaviour byte for byte, so
every existing test stays green untouched.

### 5.2 Mechanism

The builder functions (`addSubtree`, `setKeys`, `moveNode`, `removeNode`, `duplicateNode`,
and the two in `live.ts`) take a `GuardOpts` (`{ force?, forced? }`) the CALLER owns. Every
soft guard CALL SITE is wrapped in `soft(guard, () => refuseX(...))`; the guard functions
themselves do not change. Without force the wrapper rethrows the guard's own message plus
`' Pass force:true to write anyway.'`; with force it pushes the message onto `forced` and
returns. No return type changes: the tool reads `guard.forced` after the call and puts it on
the result as `forced: string[]`, in the dry run too, so the caller sees what was overridden
before committing.

The suffix appears only on soft guards. A caller reading an error can therefore tell
whether force is an answer without trying it.

### 5.3 The split

Soft — every guard that asserts what a renderer does, because the catalog can be older than
the deployment:

| Guard | Why it is soft |
|---|---|
| `refuseAppBlockInterior`, `refuseAppBlockParent` | the write is stored nowhere today; a deployment that persists it may exist, and nothing is destroyed |
| `childAllows`, `isRootOnly` | element lists move with the platform |
| `refuseSecondTemplate` | `FIRST_CHILD_ONLY` is read off one renderer version |
| `refuseStuckConfig`, `refuseStuckAfter`, `refuseReveal`, `refuseHoverConfig`, `requireStuckHost`, `requireHoverHost` | each says "compiles to nothing" against one compiler version |

Hard — never overridden, and `force` is silently irrelevant to them:

| Guard | Why it is hard |
|---|---|
| band order (`validateForSave`) | the platform refuses the save; force would produce a refused write reported as a success |
| `refuseComposedStamp` | writing `globalId`/`appBlockId` decomposes over the master and empties it on every page |
| ROOT remove / duplicate | no document survives it |
| unknown element type | there is nothing to write |
| `refuseOverlay` (overlay ROOT as the target) | stripped on write, so the forced write is a no-op the tool would then report as done |
| the cycle check in `moveNode`, "contains an app block" in `duplicateNode`, `specials` with a state, `requireContainer` | each detaches or drops content the tool would then report as written |

### 5.4 Tests

One test per soft guard: forced, the write goes through and `forced` names it; unforced,
the error ends with the suffix. One test per hard guard: `force:true` changes nothing about
the refusal. The `sb_remove` dry-run bytes carry `forced` too, asserted at the tool the way
`removing`/`patches` already are.

## 6. Sub-project 4 — parity

### 6.1 Upstream: annotate what the editor calls

A branch in `web_builder` (never merged or pushed to `main` without the user):

- `@Router` lines for the 20 routes the editor calls and swagger does not carry: page
  `PATCH`/`DELETE` and `GET …/published`; site `GET/PATCH/DELETE /api/sites/{id}`, members
  `GET/POST`, member `PATCH/DELETE`, `GET …/export`; `GET /api/plans`, subscription
  `GET/POST`; `POST /api/orgs/{orgId}/sites`, `DELETE /api/sites/{siteId}/template`;
  `POST /api/site-imports`; `GET /api/locales`; `GET /api/permissions`;
  `GET /_wb/address/units`.
- Move `@Router /api/sites/{siteId}/pages [post]` onto `createPage` and
  `/api/sites/{siteId}/courses [post]` onto `handleCourseCollection`, so the decode sites
  are the annotated functions and `scripts/shapes.ts` reads them with no change.
- `swag init` with the flags `reportUndocumentedRoutes` prints; commit `server/docs`.
- The catalog is regenerated against that commit only once it is on origin/main, because
  codegen refuses an unpublished checkout and the catalog is read against deployed
  platforms. Until then the raw form of `sb_api_call` reaches every one of these.

### 6.2 Three `sb_store` actions

Each follows the pattern `sb_store` already has: dry run returns the ordered plan; the real
run performs the writes in order and reports each step's outcome; a failed step after a
create deletes what it created where the editor does the same.

- **`menu`** — mirrors `ensureMenuBinding` (`editor/src/features/menus/sync.ts:37`). Given a
  menu node id on the open page: list menus, create the default if none, write
  `specials.menuId`, resolve each item's link against the page list, write the
  `specials.menuItems` snapshot through `applyAndSave`. Closes the `dead_menu_link` review
  finding, which today names the failure and no fix.
- **`overlay_attach`** — mirrors `usePopupOverlay.attachToCurrentPage`
  (`editor/src/features/overlays/usePopupOverlay.ts:79`) and `useQuickviewOverlay.choose`.
  `kind: "popup"` with an overlay id (or `create: {name}`): save the open page, `POST
  …/overlays/{id}/pages/{pageId}`, re-read the page. `kind: "quickview"` with a list node
  id and the panel id: write `config.quickviewId`, save, re-read. The re-read is the whole
  point: the editor documents that the next save otherwise derives an edge set without the
  panel and takes the attachment off.
- **`app`** — mirrors `install` + `scaffoldAppPages`
  (`editor/src/features/builtinapps/store.ts:95`, `pageScaffold.ts:107`). `POST
  …/builtin-apps/{key}`, then list pages and create each missing page from the app's page
  specs, re-checked against the growing list. The specs are captured at codegen by calling
  the editor's builders, the way `STORE_PAGE_SEEDS` already is; codegen asserts each spec
  still builds a document with a root.

### 6.3 The segment arm — one exact reader, in `scripts/shapes.ts`

`sitedomain/rest/rest.go`'s `action` serves five annotated POST routes from one handler that
switches on the route's trailing segment, and three of the arms (`canonical`, `redirect`,
`redirect-code`) decode an inline struct of their own. The reader sees three distinct bodies
in one method arm and, by its own rule, says nothing — so the three domain writes the editor
sends `{canonical}`, `{redirectTo}` and `{redirectCode}` to have no shape.

`segmentHop` already trusts that segment to pick a CALLEE. The addition reads a `case
"<tail>":` arm INSIDE the annotated handler, taking only the decodes between that arm and the
next `case`. It is exact for the same reason the hop is: the literal comes from the route
itself. `verify` and `primary` resolve to an arm that decodes nothing, which is the correct
"no body" rather than silence. Pinned in `test/shapes.test.ts` against the real catalog, the
way the three earlier readings are.

### 6.4 Re-measure

After 6.1 lands on origin/main and the catalog is regenerated, the unshaped-write list is
recomputed. The expectation is that what remains is action endpoints with no JSON body,
multipart uploads and the shopper surface, none of which is an agent's to shape.

## 7. Order, gates, docs

1 → 2 → 3 → 4, the upstream branch in parallel with 2 and 3. Every sub-project ends with
`npm run build && npm test && npm run smoke`, `docs/tools.md` and `docs/tools.vi.md`
updated for every argument or action added, both READMEs' tables where a tool's one-line
description changes, and one commit whose subject decides the release bump (`feat` for 2,
3 and 4).
