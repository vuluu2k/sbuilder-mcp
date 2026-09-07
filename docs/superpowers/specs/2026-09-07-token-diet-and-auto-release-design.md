# Token diet, platform catch-up, and auto-release — design

Date: 2026-09-07. Builds on `2026-08-27-sbuilder-mcp-design.md`; nothing here moves a
boundary that spec drew. It changes what crosses the boundaries, and how the package ships.

## 1. Why

Three things were measured on the tree as of v0.1.2 (`npm run build`, then a scripted
`initialize` + `tools/list`, then each tool over an in-memory transport):

| Cost | Measured |
| --- | --- |
| `tools/list` + `instructions`, paid once per session | 13,606 + 1,672 chars ≈ 4,250 tokens |
| `sb_api_find "list orders"`, default limit 12 | 44,407 chars ≈ 12,300 tokens |
| `sb_api_find "products"` | 28,852 chars |
| `sb_traits_for` mean / worst (`list-dataset`, 99 controls) | 9,245 / 74,190 chars |
| `sb_catalog_search`, default limit 10 | 7,195 chars (720 per element) |
| `sb_look` boxes, 200-node page, pretty-printed | ~27,000 chars, on top of three PNGs |
| `JSON.stringify(v, null, 2)` on every result | +15 % on structured payloads |

The static surface (the tool list) is already small; the spend is in **responses**, and
in one place above all: `describeOperation` inlines the whole `$ref` body schema for every
match, so a search returns twelve full schemas when the agent will call one.

Two other findings shaped the scope:

- The committed catalog was generated on 2026-08-27. web_builder has had 820 commits since.
  Regenerating gives **106 elements** (was 85), **412 operations / 97 definitions** (was
  310 / 85), **26 binding sources** (was 22). The gate stays green on the regenerated files.
  Every platform fact in CLAUDE.md was re-verified against today's web_builder and holds,
  with one addition (app blocks, §4) and one extension (error envelope, §4).
- `INSTRUCTIONS` in `src/server.ts` still says a base style value "vanishes on publish" —
  the exact misreading CLAUDE.md records as corrected — and the SDK **does** send it on
  every handshake (verified: `InitializeResult.instructions`, 1,672 chars).

And the user asked for release automation shaped like `webcake-landing-mcp`'s.

## 2. Goals and non-goals

Goals, in priority order:

1. Cut per-call response size where it is largest, **without removing any capability**:
   everything that was returned by default is still reachable with one more argument.
2. Ship the current platform: regenerated catalog, corrected instructions, the fifth trap.
3. Make the release a push, not a ritual.

Non-goals: no new tools beyond what a schema-on-demand step needs (none — `id` rides on
`sb_api_find`); no change to the wire protocol, the yield rule, or credential routing; no
renderer work; no `expand`/`compact` sparse authoring.

## 3. Response diet

### 3.1 `text()` stops pretty-printing

`JSON.stringify(value)` with no indent. The reader is a model, not a person; the 15 % was
pure whitespace. Strings still pass through untouched. `test/response.test.ts` changes with
it.

### 3.2 `sb_api_find`: a list, then one call sheet

Two modes on the same tool, chosen by argument. One of `query` or `id` is required.

- **Search** (`query`, optional `tag`, `limit` default **8**, max 50). Each match is
  `{ id, method, path, summary, credential, params, body }` where `params` is the list of
  non-body parameter names with `?` suffixed on optional ones (`["siteId", "?limit"]`), and
  `body` is one of `"described" | "undescribed" | "none_declared"` or absent for a GET.
  The response is `{ matches, next }` where `next` is one sentence: pass `id` to this tool
  for a match's full call sheet. No tags, no schemas, no verdict prose in the list.
- **Describe** (`id`). Returns `describeOperation(op)` exactly as today — `params` with
  types, `tags`, and the single body verdict with its full wording (`body_schema`, or the
  `body_warning` / `body_note` sentences). Unknown id → error naming the search mode.

The three-verdict distinction is unchanged and still tested; it just moves to the moment the
agent has picked an operation. Budget: `"list orders"` at the default limit ≤ 3,000 chars.

### 3.3 `sb_catalog_search`: pick first, read hints second

Default `limit` **8**. Each match is `{ type, label, category, description }` plus
`isContainer: true` / `isRootOnly: true` only when true. `detail: true` restores
`useWhen`, `avoidWhen`, `contentTips` on every match. The AI hints are not lost: they move
to `sb_traits_for`, which is the call the agent makes once it has chosen the element.

### 3.4 `sb_traits_for`: names, and the declared ones in full

Without `control`, the response becomes:

```
{ type, hints: { useWhen, avoidWhen, contentTips },
  inspector: [{ tab, groups: [{ group, controls: ["font_size", ...] }] }],
  declared: { <control>: { label, writes, defaults? } },   // only controls with a declared write target
  defaults, isContainer, isRootOnly, childAllows,
  undeclared_note, style_is_open_css }
```

Today every undeclared control repeats a 150-char note; 317 of 435 controls are undeclared,
which is where `list-dataset`'s 74 KB comes from. The note is said once. `control: "x"`
is unchanged and remains the way to read one control. Budget: `list-dataset` ≤ 12,000 chars (it was 74,190; what remains is the platform's own 4 KB of hints and 99 control names).

### 3.5 Notices are said once per session

`REVIEW_NOTICE`, `RESPONSIVE_NOTICE`, `MEASURE_NOTICE` are directives, and a directive
repeated on every call is skimmed on the third. A `Notices` object on `ToolContext`
(`src/mcp/notices.ts`, `once(key, text) → text | undefined`) returns each text the first
time it is asked for in a process and `undefined` after. The field (`findings_notice`,
`layout_notice`, `note`) is simply absent after the first time. Tests construct their own
`Notices` so each test starts fresh.

### 3.6 Findings carry a kind; fixes are a legend

`Finding` and `VisualFinding` gain `kind` (a short slug: `empty_band`, `unknown_type`,
`empty_container`, `missing_content`, `placeholder`, `unknown_source`, `bad_field`,
`overflow`, `small_text`, `overlap`). Each finding keeps `id`, `problem`, and whatever
per-finding value the fix needs (`key`, `sources`). `fix` leaves the finding and becomes
`fixes: { <kind>: "template with <id> / <key>" }` alongside the findings array, containing
only the kinds present. Twenty placeholder findings cost one template instead of twenty
sentences. `reviewDesign` / `measure` return the findings; a `withFixes(findings)` helper
in each module builds the legend, and the tool layer spreads both.

### 3.7 `sb_look`: boxes as tuples, near the top by default

`boxes` becomes an array of `[id, type, x, y, w, h]` tuples with a one-line `boxes_format`
legend (subject to §3.5). A new `box_depth` argument (default **2**) keeps boxes for nodes
at depth ≤ 2 in the open document — bands and their direct children, which is what a layout
judgement needs; `with_boxes: false` still drops them, and `box_depth: 6` gives everything.
The full box list is still kept in the session for the presence cursor and for `measure`,
which read every box as before. `widths` is unchanged: three viewports by default is the
responsive-by-default rule applied to seeing.

### 3.8 Passthrough tools return what the caller will use

`sb_page_list`, `sb_templates`, `sb_media_list` return the platform's JSON today, verbatim.
Each gets a projection to the fields the follow-up call needs. The OpenAPI document does
not describe list responses, so the names were read off the Go structs' json tags
(`page.go:163`, `media.go:245` + `library.go:339`, `sectiontemplate.go:129`): page id, name,
slug, path, isHomepage, type, status, updatedAt, publishedAt; template id, name, description,
categoryIds, source, listed, updatedAt; media id, name, url, mediaType, contentType,
sizeBytes, width, height, folderId, state; plus `total`. The projection is by whitelist: unknown extra keys drop, and if an item is
not an object the response is returned untouched, so a platform shape change degrades to
today's behaviour rather than to an empty list. `sb_site_list` and `sb_connect` already
project and are unchanged.

### 3.9 Tool annotations

Every `server.tool` registration gains MCP annotations (`registerTool` form of the SDK):
`readOnlyHint: true` on `sb_connect`, `sb_site_list`, `sb_api_find`, `sb_page_open`,
`sb_outline`, `sb_node_read`, `sb_catalog_search`, `sb_traits_for`, `sb_review`,
`sb_templates`, `sb_page_list`, `sb_media_list`; `destructiveHint: true` on `sb_remove`,
`sb_api_call`, `sb_publish`; `idempotentHint: true` on `sb_look` (it saves, so it is not
read-only) and `sb_live_join`; `openWorldHint: true` on `sb_api_call`. Clients that honour
hints stop asking a person to confirm a read.

### 3.10 Instructions: short, true, not a copy of the descriptions

`INSTRUCTIONS` is rewritten to ≤ 900 chars: the call order, the two credential surfaces,
the dry-run default said once, the corrected responsive rule (per-breakpoint by default,
base is the fallback layer and legitimate), and "read hints with `sb_traits_for`, schemas
with `sb_api_find id`". Counts come from the generated source records, never literals.

### 3.11 Budgets are tests

`test/token-budget.test.ts` runs the server over `InMemoryTransport` and asserts character
ceilings: `tools/list` ≤ 15,000; `instructions` ≤ 1,000; `sb_api_find "list orders"` ≤
3,000; `sb_catalog_search "hero"` ≤ 2,500; `sb_traits_for list-dataset` ≤ 12,000. A diet
without a scale is a diet that comes back.

## 4. Platform catch-up

- **Catalog.** Commit the regenerated `api.generated.ts` / `elements.generated.ts`. Prose
  counts in `docs/tools.md`, `docs/tools.vi.md`, both READMEs, CLAUDE.md, `src/tools/api.ts`
  and `src/server.ts` follow (412 / 106 / 26). `sb_bind`'s `source` description lists 26
  sources; it stays, because the enum is the whole tool.
- **Trap 5, app blocks.** A marketplace app contributes a subtree. The document stores one
  reference node stamped `specials.appBlockRef` (`server/internal/page/appblocks.go:97`);
  on read `ComposeAppBlocks` materializes it and stamps `appBlockId` on the block root; on
  write `DecomposeAppBlocks` runs after overlays and before `Decompose`
  (`globalservice.go:56`) and reduces the subtree back to the reference. So an edit INSIDE
  a composed block is stored nowhere and reported nowhere. `src/core/tree.ts` gains
  `SPEC_APP_BLOCK_ID` / `SPEC_APP_BLOCK_REF` and `appBlockRoot(doc, id)` (the nearest self-or-
  ancestor carrying either stamp, or null). The outline flags the block root `app: true`.
  `setKeys`, `addSubtree` (as parent), `moveNode` (as destination), `removeNode` and
  `duplicateNode` (on a strict descendant) and `bindNode` refuse with a message that names
  the block root and says the edit would be lost on save; removing or moving the block root
  itself is allowed, because that is the reference. `reviewDesign` skips block interiors as
  it skips overlays: their placeholder text is the app's. Tested in `test/traps.test.ts`.
- **Error envelope.** `WriteErrorCodeDetails` adds `details` and `fielderrors.go` adds
  `fields` beside `code: "validation"`. `ApiError` carries both when present and its message
  appends them, so a 400 says which field.
- **Live edit is JWT-only.** `server/internal/server/realtime.go:38` refuses `wbk_` keys.
  `sb_live_join` checks for a session up front and refuses with "set SB_EMAIL / SB_PASSWORD;
  an API key cannot join the room" instead of letting the socket fail after `onopen`.
- **Not changed**, because verified to hold: `PUT /pages/{id}/source` body, schema version
  2, 15-minute rotating token, frame caps and the silent `ops` drop, `specials`-only
  bindings, band order, cascade order. The `/api/sites` surface now takes a `wbk_` key
  (`router.go:2576`, `RequireAuthOrDefer`), which v0.1.1 already relies on.

## 5. Auto-release

`.github/workflows/auto-release.yml`, copied from `webcake-landing-mcp` and adapted:

| Landing-mcp | Here |
| --- | --- |
| branch `main`, paths `src/**`, `workflow_dispatch` bump | same |
| Node 20 | **Node 22** (the global `WebSocket` floor) |
| gate `build` + `smoke` | `build` + **`test`** + `smoke` |
| skip when head commit contains `chore(release):` | also skip **`release: v`**, the manual script's subject |
| bilingual notes → `CHANGELOG.md` + `CHANGELOG.vi.md` | same; `CHANGELOG.vi.md` is created and added to `files` |
| `server.json` version sync | same (this repo already has `server.json` and `mcpName`) |
| `npm publish --ignore-scripts` with `NPM_ACCESS_TOKEN` | same |
| GitHub Release from the notes | same |
| MCP Registry publish via `mcp-publisher` + GitHub OIDC | same |
| `environment: prod` | same |
| resume mode when the tag exists but npm does not | same |

Secrets the repository needs: `NPM_ACCESS_TOKEN` (automation token) and
`CLAUDE_CODE_OAUTH_TOKEN`. The registry step needs no secret. The Claude prompt is
rewritten for this server: tool names are `sb_*`, and the two changelogs keep English
section headers.

`CHANGELOG.md` headings change from `## 0.1.2 — date` to Keep-a-Changelog `## [0.1.2] - date`,
because the workflow's prepend matches `^## \[` and would otherwise append under the oldest
entry. The 0.1.2 entry, which currently reads as a stray six-digit number, is rewritten to say
what 0.1.2 shipped (agent identity; measured layout defects).

`scripts/release.mjs` stays as the offline path — a machine with no CI, or a release cut
while the secret is being rotated — and its header comment is rewritten: CI is the normal
path now, and the script writes the same `## [x.y.z] - date` heading so the two never
disagree about the format. It also commits as `chore(release): vX.Y.Z` so the workflow's
skip guard matches either way.

## 6. Documentation

`docs/tools.md` and `docs/tools.vi.md` document every changed argument and shape (`id` on
`sb_api_find`, `detail`, `box_depth`, the tuple boxes, `fixes`, the once-per-session
notices). Both READMEs update the counts and gain a Release section. CLAUDE.md gains trap 5,
the new counts, and one paragraph on how a release happens. The CHANGELOG entry for this
work is written by the workflow on the release push.

## 7. Testing

- Existing suites keep passing with the shapes updated where the shape changed
  (`api-search`, `element-catalog`, `review`, `measure`, `response`, `vision`, `page-tools`).
- New: `test/traps.test.ts` app-block cases; `test/notices.test.ts`; `test/token-budget.test.ts`;
  `test/http.test.ts` gains the `details` / `fields` envelope cases; `test/live-tools.test.ts`
  gains the no-session refusal; a projection test per passthrough tool with a fixture item
  and a non-object item.
- `SB_BROWSER_TEST=1 npm test` after the `sb_look` change, since it touches `src/vision/**`
  consumers.
- The gate: `npm run build && npm test && npm run smoke`.

## 8. Out of scope, deliberately

Screenshot size (a PNG's token cost is the client's image tokenizer, not JSON); a
server-side renderer (web_builder has none — `sitepreview` stores a JPEG the browser
captured); resources/prompts on the MCP server (nothing today would read them); a
`fields` argument on `sb_api_call` (the platform's list endpoints have their own paging,
which the call sheet shows).
