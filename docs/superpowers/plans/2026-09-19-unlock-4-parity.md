# Unlock 4 — Editor parity: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the editor-parity gaps the audit ranked highest: annotate the platform's 20 unannotated routes and two misplaced annotations at the source; recover the three domain-action body shapes with one exact reader; and give the three multi-step editor flows with the most to gain one `sb_store` action each — `menu`, `overlay_attach`, `app`.

**Architecture:** Task 1 is a branch in the SIBLING repo `web_builder` (never merged or pushed to main without the user). Task 2 extends `scripts/shapes.ts` with a segment-arm reader and regenerates `shapes.generated.ts`. Tasks 3-5 add actions to the existing `sb_store` tool in `src/tools/store.ts`, each mirroring one editor flow write for write, each with a dry-run plan; Task 4 and Task 5 first capture the editor's own seed documents at codegen (`OVERLAY_SEEDS`, `APP_SCAFFOLDS`) the way `STORE_PAGE_SEEDS` already is, so nothing is copied by hand. Task 6 documents the three actions in both languages.

**Tech Stack:** TypeScript (ESM / Node16), zod, vitest, `tsx` codegen against a detached platform worktree; Go 1.26 + `swaggo/swag v1.16.4` for the upstream task.

**Spec:** `docs/superpowers/specs/2026-09-19-unlock-platform-reach-design.md`, section 6.

## Global Constraints

- The gate for every change in `sbuilder-mcp` is `npm run build && npm test && npm run smoke`; smoke MUST print `ALL GOOD`.
- **No new tool.** Every flow rides on `sb_store`'s `action` enum. `tools/list` ceiling in `test/token-budget.test.ts` is 26,147; raise only with the reason written in the test.
- Every `sb_store` action: `dry_run` defaults to true and returns the ordered plan (`Step[]` — `{ step, what, method, path, body? }`), the same shape the `checkout` action returns; the real run performs the writes in order and reports each step's outcome; every page write goes through `PageSession.applyAndSave` / `session.save()`.
- Every tool answers through `text()`; directives once per process through `ctx.notices.once`.
- `src/catalog/*.generated.ts` is written only by `npm run codegen` against a DETACHED worktree of `web_builder` `origin/main` (this session's is at `/private/tmp/claude-501/-Volumes-workspace-webcake-sbuilder-mcp/d10cb3d3-a76a-441b-9cf6-6c5d49687db0/scratchpad/wb`; recreate per Plan 2 Task 1 if gone). Codegen may import an editor module ONLY if it (transitively) imports nothing but `@webbuilder/schema` and editor-internal files that do the same — never Vue.
- Captured seed documents are RESTAMPED (ids made deterministic) the way `STORE_PAGE_SEEDS` is, or `codegen:check` reports drift on every run.
- Credential routing by path prefix only. Every relative import ends in `.js`. No prettier. Never push. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Nothing under `.superpowers/` is committed.
- Docs: `docs/tools.md` AND `docs/tools.vi.md` for every action added; both READMEs' `sb_store` row.

---

### Task 1: Annotate what the editor calls — a branch in `web_builder`

**Files (in `web_builder`, on a NEW worktree + branch, never the shared checkout):**
- Modify: `server/internal/page/rest/rest.go`, `server/internal/site/rest/rest.go`, `server/internal/plans/rest/api.go`, `server/internal/orgs/rest/*.go`, `server/internal/sitecopy/rest/rest.go`, `server/internal/locales/rest/*.go` (or wherever `/api/locales` is served — `router.go:2085` registers it), the permissions handler (`server/internal/server/router.go:3599` registers `/api/permissions`), `server/internal/adminunits/public/*.go`, `server/internal/courses/rest/rest.go`, `server/internal/page/rest/rest.go` (the misplaced POST)
- Regenerate: `server/docs/swagger.json`, `server/docs/swagger.yaml`, `server/docs/docs.go`

**Interfaces:**
- Produces: a commit on branch `feat/annotate-editor-routes` in a worktree at `/Volumes/workspace/webcake/web_builder-annotate`, whose `server/docs/swagger.json` documents 20 more routes, and whose `POST /api/sites/{siteId}/pages` and `POST /api/sites/{siteId}/courses` annotations sit on the functions that decode.

- [ ] **Step 1: Make the worktree**

```bash
git -C /Volumes/workspace/webcake/web_builder fetch -q origin
git -C /Volumes/workspace/webcake/web_builder worktree add -b feat/annotate-editor-routes /Volumes/workspace/webcake/web_builder-annotate origin/main
cd /Volumes/workspace/webcake/web_builder-annotate/server && go build ./... && echo BUILD_OK
```

Expected: `BUILD_OK`. If `go build` fails on a clean origin/main, stop: BLOCKED, the platform is broken upstream.

- [ ] **Step 2: Measure before**

```bash
cd /Volumes/workspace/webcake/web_builder-annotate/server
grep -rhoE '@Router\s+\S+\s+\[\w+\]' internal | sort -u | wc -l
node -e 'const s=require("./docs/swagger.json");let n=0;for(const p in s.paths)n+=Object.keys(s.paths[p]).length;console.log("documented",n)'
```

Record both numbers in the report (expected 560 documented; annotated ≥ 560).

- [ ] **Step 3: Move the two misplaced POST annotations**

In `server/internal/page/rest/rest.go`: the block above `listPages` (≈ line 553) carries both `// @Router /api/sites/{siteId}/pages [get]` and `[post]`. Leave the `[get]` on `listPages`. Move the `[post]` line into a NEW doc block directly above `func (a *API) createPage(` (≈ line 563), copying the `@Summary`/`@Tags`/`@Security` lines and adding `// @Param page body page.CreatePageInput true "Page to create"`. A doc block opens with the function name per Go convention: first line `// createPage creates a page in a site.`

In `server/internal/courses/rest/rest.go`: the block at ≈ line 167 stacks `[get]`+`[post]` for `/api/sites/{siteId}/courses` above `handleOverview`, which serves only GET `/courses/overview`. Move BOTH `/api/sites/{siteId}/courses` `@Router` lines (get and post), with the `@Summary List or create courses` block, into a new block directly above `func (a *API) handleCourseCollection(` (≈ line 190), adding `// @Param course body courses.Course true "Course to create (POST)"`. Leave the `/courses/overview` block on `handleOverview`.

- [ ] **Step 4: Annotate the 20 routes**

Copy the exact format of an existing block (`site/rest/rest.go:501-509`):

```go
// @Summary <one sentence, present tense>
// @Tags    <package tag already used in that file>
// @Produce json
// @Param   siteId path string true "Site ID"        // only when the path has it
// @Success 200 {object} map[string]interface{} "<what comes back>"
// @Security BearerAuth
// @Router  <path> [<method>]
```

Place each block on the FUNCTION THAT DECODES OR SERVES the route (read the dispatcher's `case` arm to find it; for a dispatcher serving several routes by method with the decode inline, put the block on the dispatcher and keep the `@Router` lines to the routes that arm actually serves). The 20, with where the audit found each:

| Route | Package / where served |
|---|---|
| `PATCH /api/sites/{siteId}/pages/{pageId}` | `page/rest/rest.go` `pageItem` (`case http.MethodPatch, http.MethodPut:` decodes `page.UpdatePageInput`) — add `@Param page body page.UpdatePageInput true "Fields to change"` |
| `DELETE /api/sites/{siteId}/pages/{pageId}` | `page/rest/rest.go` `pageItem` |
| `GET /api/sites/{siteId}/published` | `page/rest/rest.go` (route map at top names it) |
| `GET /api/sites/{id}` | `site/rest/rest.go` `siteItem` |
| `PATCH /api/sites/{id}` | `site/rest/rest.go` `siteItem` |
| `DELETE /api/sites/{id}` | `site/rest/rest.go` `siteItem` |
| `GET /api/sites/{siteId}/members` | `site/rest/rest.go` `members` |
| `POST /api/sites/{siteId}/members` | `site/rest/rest.go` `members` |
| `PATCH /api/sites/{siteId}/members/{userId}` | `site/rest/rest.go` `members` |
| `DELETE /api/sites/{siteId}/members/{userId}` | `site/rest/rest.go` `members` |
| `GET /api/sites/{siteId}/export` | `site/rest/rest.go` `siteExport` |
| `GET /api/plans` | `plans/rest/api.go` |
| `GET /api/sites/{siteId}/subscription` | `plans/rest/api.go` |
| `POST /api/sites/{siteId}/subscription` | `plans/rest/api.go` |
| `POST /api/orgs/{orgId}/sites` | `orgs/rest` (the GET is annotated; add the POST line to the same block or the function that serves it) |
| `DELETE /api/sites/{siteId}/template` | `orgs/rest` (the POST is annotated; same rule) |
| `POST /api/site-imports` | `sitecopy/rest/rest.go:246` |
| `GET /api/locales` | the handler `router.go:2085` registers |
| `GET /api/permissions` | the handler `router.go:3599` registers |
| `GET /_wb/address/units` | `adminunits/public` (its three siblings are annotated; match their block) |

If a route in this table does not exist on origin/main (the audit is a day old), leave it out and say so in the report. If a handler is a closure or an anonymous func swag cannot annotate, say so and skip it.

- [ ] **Step 5: Regenerate swagger**

`swag` is not installed; the platform pins `github.com/swaggo/swag v1.16.4` in `server/go.mod`:

```bash
cd /Volumes/workspace/webcake/web_builder-annotate/server
go run github.com/swaggo/swag/cmd/swag@v1.16.4 init -g cmd/server/main.go -o docs --parseInternal --parseDependency --parseDepth 2
go build ./... && echo BUILD_OK
git -C .. status --short
```

Expected: only the files you annotated plus `server/docs/{swagger.json,swagger.yaml,docs.go}` changed; `BUILD_OK`. Re-run Step 2's two counts: documented must have grown by the number of routes you annotated (target 580), and annotated must equal documented for the routes you touched.

- [ ] **Step 6: Prove it from this repo's side**

```bash
cd /Volumes/workspace/webcake/sbuilder-mcp
WB_REPO=/Volumes/workspace/webcake/web_builder-annotate npm run codegen:check 2>&1 | grep -E "annotated|documented|STALE|would change|shapes" 
```

Expected: the "annotated … absent from swagger" warning names only the two `ai-credits` routes (or none, if you annotated those too — optional); `shapes.generated.ts` would change (the two moved POST annotations give `POST /pages` and `POST /courses` a shape). Codegen REFUSES to write from this worktree (unpublished commits) — that is correct; do not pass `--dirty`. This step is read-only evidence for the report.

- [ ] **Step 7: Commit on the branch**

```bash
cd /Volumes/workspace/webcake/web_builder-annotate
git add server/internal server/docs
git commit -m "docs(api): annotate the 20 routes the editor calls that swagger did not carry, and move two POST annotations onto the functions that decode

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Do NOT push. Do NOT merge. Report the branch name and the commit; the user decides.

---

### Task 2: The segment arm — an exact reader for one dispatcher shape

**Files:**
- Modify: `scripts/shapes.ts` — `readDecodeSites` (≈ line 668-736), beside `segmentHop`
- Modify (generated): `src/catalog/shapes.generated.ts`
- Test: `test/shapes.test.ts` (append)

**Interfaces:**
- Consumes: `armLines`, `extractDecodes`, `GoFunc` in `scripts/shapes.ts`.
- Produces: `REQUEST_SHAPES['post:/api/sites/{siteId}/domains/{id}/canonical']`, `…/redirect`, `…/redirect-code` with fields `canonical`, `redirectTo`, `redirectCode` respectively; `…/verify` and `…/primary` still absent.

- [ ] **Step 1: Write the failing test**

Append to `test/shapes.test.ts`:

```ts
describe('the segment arm: one POST handler switching on the route\'s own tail', () => {
  it('gives each domain action the body its own case arm decodes', () => {
    const f = (id: string) => REQUEST_SHAPES[id]?.fields.map((x) => x.name) ?? null;
    expect(f('post:/api/sites/{siteId}/domains/{id}/canonical')).toEqual(['canonical']);
    expect(f('post:/api/sites/{siteId}/domains/{id}/redirect')).toEqual(['redirectTo']);
    expect(f('post:/api/sites/{siteId}/domains/{id}/redirect-code')).toEqual(['redirectCode']);
  });

  it('says nothing for an arm that decodes nothing', () => {
    expect(REQUEST_SHAPES['post:/api/sites/{siteId}/domains/{id}/verify']).toBeUndefined();
    expect(REQUEST_SHAPES['post:/api/sites/{siteId}/domains/{id}/primary']).toBeUndefined();
  });
});
```

(`REQUEST_SHAPES` is already imported at the top of that file; if the field names differ from the editor's `{canonical}`, `{redirectTo}`, `{redirectCode}` — read `sitedomain/rest/rest.go:256-285` — use the Go json tags.)

- [ ] **Step 2: Run it to see it fail**

`npx vitest run test/shapes.test.ts` — expected: the first test fails (`null`), the second passes already.

- [ ] **Step 3: Implement the reader**

In `readDecodeSites`, after `let decodes = arm.length > 0 ? extractDecodes(arm, dir) : [];` and BEFORE the `distinct.size !== 1` refusal, add a segment-arm pass that runs when the arm (or whole body) yielded MORE THAN ONE distinct decode:

```ts
/**
 * THE SEGMENT ARM. `sitedomain/rest`'s `action` serves five POST routes from
 * one handler that switches on the route's trailing literal segment, each
 * `case "redirect":` arm decoding its own inline struct. The method arm sees
 * three distinct bodies and, by its own rule, says nothing — so the three
 * domain writes the editor sends `{canonical}`, `{redirectTo}`, `{redirectCode}`
 * to had no shape. `segmentHop` already trusts that segment to pick a CALLEE;
 * this reads a `case "<tail>":` arm INSIDE the handler, taking only the decodes
 * between that arm and the next `case`/`default`. Exact for the same reason the
 * hop is: the literal comes from the route itself. An arm that decodes nothing
 * is a correct "no body", not silence.
 */
function segmentArm(body: string[], route: { path: string }, dir: string) {
  const tail = route.path.split('/').filter((x) => x && !x.startsWith('{')).pop();
  if (!tail) return [];
  const at = body.findIndex((l) => new RegExp(`^\\s*case\\s+"${tail}"\\s*:`).test(l));
  if (at === -1) return [];
  let end = at + 1;
  for (; end < body.length && !/^\s*(case\s|default\s*:)/.test(body[end]); end++);
  return extractDecodes(body.slice(at, end), dir);
}
```

and in `readDecodeSites`:

```ts
      const distinctBefore = new Set(decodes.map((d) => d.ref ?? JSON.stringify(d.inline?.fields))).size;
      if (distinctBefore > 1) {
        const byArm = segmentArm(arm.length > 0 ? arm : fn.body, route, dir);
        // An arm that exists and decodes nothing is a real answer: no body.
        const armExists = (arm.length > 0 ? arm : fn.body).some((l) => l.includes(`case "${route.path.split('/').filter((x) => x && !x.startsWith('{')).pop()}"`));
        if (armExists) decodes = byArm;
      }
```

Keep the existing `distinct.size !== 1` refusal after it, so any dispatcher this reader does not resolve still says nothing.

- [ ] **Step 4: Regenerate and run the tests**

```bash
WB_REPO=/private/tmp/claude-501/-Volumes-workspace-webcake-sbuilder-mcp/d10cb3d3-a76a-441b-9cf6-6c5d49687db0/scratchpad/wb npm run codegen
git diff --stat
npx vitest run test/shapes.test.ts
```

Expected: only `src/catalog/shapes.generated.ts` changed (plus `source.generated.ts` if its stamp carries counts); the `checked shapes.generated.ts:` line reports 3 more shaped writes (190 → 193 of 251); both new tests pass. If ANY other operation's shape changed, list it in the report and check it by reading its handler — a reader that widens beyond the five domain routes is doing more than it claims.

- [ ] **Step 5: Gate and commit**

```bash
npm run build && npm test && npm run smoke
git add scripts/shapes.ts src/catalog test/shapes.test.ts
git commit -m "feat(shapes): read the case arm the route's own tail names, so a domain action carries its body

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Record in the report the unshaped-write count after this task (from the `checked shapes.generated.ts` line): that is the re-measure spec §6.4 asks for, with the upstream-dependent remainder (`POST /pages`, `POST /courses`) named.

---

### Task 3: `sb_store action:"menu"`

**Files:**
- Create: `src/tools/menu.ts`
- Modify: `src/tools/store.ts` — the `action` enum and the handler
- Test: `test/store-menu.test.ts`

**Interfaces:**
- Consumes: `PageSession` (`session.current()`, `session.applyAndSave(patches)`, `session.location()`), `setKeys` from `src/domains/site/builder.ts`, `request` from `src/transport/http.ts`, `tokenFor` from `src/tools/api.ts`, `siteFor`.
- Produces: `export async function bindMenu(ctx, session, siteId, nodeId, opts: { menuId?: string; dryRun: boolean }): Promise<unknown>`.

The editor flow being mirrored (`editor/src/features/menus/sync.ts:37` `ensureMenuBinding` → `syncBoundMenuNode`), write for write:

1. `GET /api/sites/{siteId}/menus` → `{ menus: Menu[] }`. If `opts.menuId` is given, use that menu; else if the list is non-empty, use `menus[0]`; else **create one**: `POST /api/sites/{siteId}/menus` with `{ name: 'Main menu', items }` where `items` is the node's existing `specials.menuItems` converted back to `MenuItemInput` rows (`{ label, link: linkFromHref(href), items? }` — `linkFromHref`: `mailto:` → `{type:'email',url}`, `tel:` → `{type:'phone',url}`, `#x` → `{type:'anchor',url:'x'}`, else `{type:'url',url:href}`), or, when the node has none, the editor's default `['Home','Categories','Contact','About us'].map(label => ({ label, link: { type: 'none' } }))`.
2. Write `specials.menuId = menu.id` on the node (`setKeys(doc, nodeId, { menuId }, { namespace: 'specials' })`).
3. `GET /api/sites/{siteId}/menus/{id}` → `{ menu }` with `items: MenuItem[]` (`{ id, label, link: { type, url?, pageId?, entityId?, target? }, items? }`).
4. Resolve each item's link to an `href` the way `linkResolver.ts` does: `page` → `GET /api/sites/{siteId}/pages`, `href = page.path || '/' + page.slug`; `productCategory` / `article` / `blogCategory` → the listing routes `GET /api/sites/{siteId}/categories` (read the exact path off `editor/src/features/products/api.ts:233` and `blog/api.ts:6,56` in the worktree), `href = '/' + ENTITY_URL_PREFIX[kind] + '/' + slug` (read `ENTITY_URL_PREFIX` off `editor/src/features/pagelinks/entityUrl.ts`); `url`/`email`/`phone`/`anchor` → the inverse of `linkFromHref`; `none` → `''`. A kind whose listing fails resolves to `''` (the editor's own degrade: an unreachable list must not block the sync).
5. Build the snapshot rows `{ id, label, href, target? ('_blank' only), items? }` recursively, then `preservePanels`: any current row (matched by `id` at any depth) carrying a `panelId` keeps it.
6. Write `specials.menuItems = snapshot` on the node, and `applyAndSave` steps 2 and 6 together as one batch.

Dry run returns the `Step[]` plan naming the menu that would be used (or "create 'Main menu'") and the resolved hrefs; the real run returns `{ node, menu_id, created: boolean, items: snapshot.length, unresolved: <labels whose href came back ''> }`.

- [ ] **Step 1: Write the failing test**

`test/store-menu.test.ts`, using the same `connectedClient`/`callTool` pattern as `test/page-tools.test.ts` (copy its `scripted()`-style fetch and the `session.access = 'jwt'` hack). Serve a page document holding one `menu` node (build it with `PageDoc.from` + `addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'menu' }] })`), a fetch that answers by URL: `/menus` GET → `{ menus: [] }`; `/menus` POST → `{ menu: { id: 'mn_1', name: 'Main menu', items: [{ id: 'i1', label: 'Home', link: { type: 'page', pageId: 'pg_1' } }, { id: 'i2', label: 'Blog', link: { type: 'url', url: 'https://x' } }] } }`; `/menus/mn_1` GET → the same menu; `/pages` GET → `{ pages: [{ id: 'pg_1', slug: 'home', path: '/', name: 'Home' }] }`; the page source GET/PUT → the document. Assert:
- dry run: `calls` has only GETs (no POST, no PUT), and the plan names `POST …/menus` as step 1;
- real run: the PUT's document has the menu node with `specials.menuId === 'mn_1'` and `specials.menuItems` equal to `[{ id:'i1', label:'Home', href:'/' }, { id:'i2', label:'Blog', href:'https://x' }]`;
- a second real run against `{ menus: [menu] }` creates nothing (no POST) and reports `created: false`.

- [ ] **Step 2: Run it to see it fail** — `npx vitest run test/store-menu.test.ts`; expected: zod rejects `action: "menu"`.

- [ ] **Step 3: Implement** `src/tools/menu.ts` (`bindMenu`) and wire `action: z.enum(['checkout', 'form', 'chrome', 'menu'])` plus `node_id: z.string().optional().describe('action:"menu" — the menu node on the open page')` and `menu_id: z.string().optional()` in `src/tools/store.ts`; `if (action === 'menu') { if (!node_id) throw …; return text(await bindMenu(ctx, session, siteId, node_id, { menuId: menu_id, dryRun: dry_run !== false })); }`. Refuse a `node_id` whose element does not seed `menuItems` (read `ELEMENTS[type].defaults.specials`), naming the node's type.

- [ ] **Step 4: Tests + gate** — `npx vitest run test/store-menu.test.ts && npm run build && npm test && npm run smoke`.

- [ ] **Step 5: Commit**

```bash
git add src/tools/menu.ts src/tools/store.ts test/store-menu.test.ts test/token-budget.test.ts
git commit -m "feat(store): action menu binds a menu node to the site's menu and resolves its links, the way the editor does

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `sb_store action:"overlay_attach"` — pop-up and quick view

**Files:**
- Modify: `scripts/gen-catalog.ts` — capture `OVERLAY_SEEDS` beside `STORE_PAGE_SEEDS`
- Create (generated): `src/catalog/overlays.generated.ts`
- Create: `src/tools/overlay.ts`
- Modify: `src/tools/store.ts`
- Test: `test/store-overlay.test.ts`, plus a codegen assertion

**Interfaces:**
- Produces: `export const OVERLAY_SEEDS: Record<'popup' | 'quickview', OverlayDocument>` (generated); `export async function attachOverlay(ctx, session, siteId, opts: { kind: 'popup' | 'quickview'; overlayId?: string; name?: string; listId?: string; dryRun: boolean }): Promise<unknown>`.

- [ ] **Step 1: Capture the seeds at codegen**

`editor/src/features/overlays/seed.ts` exports `popupSeed()` and `quickviewSeed()` and imports only `@webbuilder/schema`, `../../element/factory`, `../../element/pickerPresets`, `../../element/cardTree` — the same dependency class `storePageSeeds.ts` has, so codegen imports it directly. In `scripts/gen-catalog.ts`, next to the `storeSeedMod` import (≈ line 3529), add:

```ts
  const overlaySeedMod = (await import(resolve(repo, 'editor/src/features/overlays/seed.ts'))) as {
    popupSeed: () => { rootId?: string; root_node_id?: string; nodes: Record<string, unknown> };
    quickviewSeed: () => { rootId?: string; root_node_id?: string; nodes: Record<string, unknown> };
  };
  const overlaySeeds = {
    popup: restampIds(overlaySeedMod.popupSeed()),
    quickview: restampIds(overlaySeedMod.quickviewSeed()),
  };
```

using the SAME restamp helper the store seeds use (find it by reading how `storeSeeds[type]` is made deterministic; reuse it, do not write a second one). Assert each seed has ≥ 1 node and a root id. Emit `src/catalog/overlays.generated.ts` with the `// GENERATED` header and `export const OVERLAY_SEEDS = … as const;` and a `checked overlays.generated.ts: popup N nodes, quickview M nodes` line. Run `WB_REPO=<worktree> npm run codegen` twice; the second `codegen:check` must report no drift.

- [ ] **Step 2: Write the failing test**

`test/store-overlay.test.ts` with the same harness. Serve a page whose document has a `flex-section` > `list-dataset` (for the quickview case). Fetch by URL: `/overlays` POST → `{ overlay: { id: 'ov_1', kind: 'popup', name: 'Sale' } }` (status 201); `/overlays/ov_1/pages/pg_1` POST → `{}`; page source GET → the document — BUT the SECOND page GET (the re-read after attach) answers a document that additionally holds a node with `specials.overlayId: 'ov_1'` under ROOT (this is what compose does); PUT → ok. Assert for `kind: 'popup', name: 'Sale', dry_run: false`: the call order is `PUT source` (save) → `POST /overlays` → `POST …/pages/pg_1` → `GET source`, and the result reports `overlay_id: 'ov_1'` and `node_id` = the composed node's id. For `kind: 'quickview', list_id, overlay_id: 'qv_1'`: the PUT'd document has the list node's `config.quickviewId === 'qv_1'` (at the slot `baseOnlyKeys` routes it to — `quickviewId` is in `BASE_ONLY_CONFIG`, so base), followed by a `GET source`, and the result's `node_id` is the node whose `specials.quickviewId === 'qv_1'` in the re-read. Dry run: no writes, the plan lists the steps.

- [ ] **Step 3: Run to see it fail**, then implement `src/tools/overlay.ts`:

`popup`: (1) `session.save()` — the page must be stored before the edge is added; (2) if no `overlayId`, `POST /api/sites/{siteId}/overlays` with `{ kind: 'popup', name, document: OVERLAY_SEEDS.popup }`; (3) `POST /api/sites/{siteId}/overlays/{id}/pages/{pageId}`; (4) `session.open(siteId, pageId)` — THE RE-READ, which the editor documents as mandatory: until the composer has put the panel into the document in hand, the next save derives an edge set without it and takes the attachment off; (5) find the node with `specials.overlayId === id`. `quickview`: (1) if no `overlayId`, create with `kind: 'quickview'` and `OVERLAY_SEEDS.quickview`; (2) write `config.quickviewId` on `listId` at base via `setKeys` with `base: true` (assert `BASE_ONLY_CONFIG` holds `quickviewId`; if it does not, write per breakpoint) and `applyAndSave`; (3) re-read; (4) find the node with `specials.quickviewId === id`. Wire `action: 'overlay_attach'`, `kind: z.enum(['popup','quickview']).optional()`, `overlay_id`, `list_id`, reuse `name`.

- [ ] **Step 4: Tests + gate + commit**

```bash
npx vitest run test/store-overlay.test.ts && npm run build && npm test && npm run smoke
git add scripts/gen-catalog.ts src/catalog/overlays.generated.ts src/catalog/source.generated.ts src/tools/overlay.ts src/tools/store.ts test/store-overlay.test.ts test/token-budget.test.ts
git commit -m "feat(store): action overlay_attach puts a pop-up on the open page or points a list at a quick view, and re-reads, as the editor must

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `sb_store action:"app"` — install a built-in app and scaffold its pages

**Files:**
- Modify: `scripts/gen-catalog.ts` — capture `APP_SCAFFOLDS`
- Create (generated): `src/catalog/appscaffolds.generated.ts`
- Create: `src/tools/app.ts`
- Modify: `src/tools/store.ts`
- Test: `test/store-app.test.ts`

**Interfaces:**
- Produces: `export const APP_SCAFFOLDS: Record<string, Array<{ slug: string; type: string; name: { vi: string; en: string }; document: { schema_version: number; root_node_id: string; nodes: Record<string, unknown> } }>>` (today only `courses`, four pages: `course` type with no slug, `courses`, `learn`, `my-courses`); `export const BUILTIN_APP_KEYS = ['mail','multilingual','agent','chat','booking','loyalty','payments','courses'] as const` — read off `builtinapps.Keys` in the worktree (`grep -rn "Keys" server/internal/builtinapps`) rather than typed from this list, and asserted equal to the `key` parameter's enum on `post:/api/sites/{siteId}/builtin-apps/{key}` in the catalog if that description carries one; `export async function installApp(ctx, session, siteId, key, opts: { language: 'vi'|'en'; dryRun: boolean }): Promise<unknown>`.

- [ ] **Step 1: Capture at codegen**

`editor/src/features/builtinapps/pageScaffold.ts` imports `@/i18n` (Vue) — do NOT import it. Import `editor/src/features/courses/pageScaffold.ts` directly: it imports only `@webbuilder/schema`, `../../element/factory`, `../../element/treeFactory` and a type. Call `coursesScaffold()`, take each `{ slug, type, nameKey, build }`, run `build()` through the same restamp helper, and resolve `nameKey` (`courses.scaffold.detail` etc.) against `editor/src/i18n/locales/{vi,en}/courses.json` (`scaffold.detail` → "Trang khoá học" / "Course page") the way the completion headline is already read from `payments.json`. Emit `src/catalog/appscaffolds.generated.ts`. Assert: `courses` has 4 pages, exactly one with `slug === ''` and `type === 'course'`, and every document has a root. `checked appscaffolds.generated.ts: 1 app, 4 pages`.

- [ ] **Step 2: Write the failing test**

`test/store-app.test.ts`: fetch by URL — `/builtin-apps/courses` POST → `{ builtinApp: { key: 'courses' } }`; `/pages` GET → `{ pages: [{ id:'p1', slug:'courses', type:'page' }] }` (one already present); `/pages` POST → `{ page: { id: 'p_new', slug: <from body>, type: <from body> } }`. Assert dry run lists step 1 install + the 3 missing pages (not `courses`, which is present by slug; the `course`-type one is missing because no page of that TYPE exists); real run POSTs `/builtin-apps/courses` once and `/pages` three times, each body carrying `name` (Vietnamese by default), `type`, `document`, and `slug` ONLY when non-empty (the editor: "sending '' would ask the server to claim the empty slug"); result `{ installed: 'courses', created: [names], present: ['courses'] }`. A key with no scaffold (`mail`) installs and reports `created: []`.

- [ ] **Step 3: Implement** `src/tools/app.ts`: `POST /builtin-apps/{key}` → `GET /pages` → for each scaffold page, `isPresent` = `slug !== '' ? pages.some(p => p.slug === slug) : pages.some(p => p.type === type)`, re-checked against the list AS IT GROWS (push each created page onto it) → `POST /pages` with `{ name, ...(slug ? { slug } : {}), type, document }`; per-page failures are reported, never abort the rest (the editor's own rule). Wire `action: 'app'` and `app_key: z.enum(BUILTIN_APP_KEYS).optional()`.

- [ ] **Step 4: Tests + gate + commit**

```bash
npx vitest run test/store-app.test.ts && npm run build && npm test && npm run smoke
git add scripts/gen-catalog.ts src/catalog/appscaffolds.generated.ts src/catalog/source.generated.ts src/tools/app.ts src/tools/store.ts test/store-app.test.ts test/token-budget.test.ts
git commit -m "feat(store): action app installs a built-in app and creates the pages it needs from the platform's own scaffold

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Document the three actions

**Files:**
- Modify: `docs/tools.md` (`## \`sb_store\`` and its `### action:` subsections), `docs/tools.vi.md` (same), `README.md` and `README.vi.md` (the `sb_store` row)

- [ ] **Step 1:** Under `## \`sb_store\``, add three subsections in each language following the existing `### action: "form"` shape: what the flow is, the ordered steps, the arguments (`node_id`/`menu_id`; `kind`/`overlay_id`/`list_id`/`name`; `app_key`), the dry-run answer, and the one trap each exists for (menu: the renderer reads `menuItems` and never `menuId`, so the snapshot is the page; overlay: the re-read, without which the next save removes the attachment; app: a page of the scaffold's TYPE counts as present when the spec has no slug).
- [ ] **Step 2:** README rows: extend the `sb_store` description with "menu, overlay_attach, app".
- [ ] **Step 3:** Gate and commit: `docs(store): the menu, overlay_attach and app actions, in both languages`.
