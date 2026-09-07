# Changelog

**English** · [Tiếng Việt](./CHANGELOG.vi.md)

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-07

### Added
- sb_review reports static_in_dataset when an element inside a repeater (such as a plain image in a product card) can only render one authored value across every record, and names the record-capable element to swap in instead.
- sb_review reports unbound_dataset_element when a dataset element capable of showing a record carries no binding at all, instead of silently rendering the same authored content on every row.
- sb_page_open reports blank_page_repair when a page's stored document names its root under rootId instead of root_node_id, the alias that renders as an empty page.

### Fixed
- Opening a page whose document names its root under rootId no longer fails as a damaged document; the document adopts the alias so the next save writes the canonical key and the page stops rendering blank.

## [0.1.5] - 2026-09-07

### Added
- sb_review reports store_gaps: the platform's own readiness rules — no published checkout page, no live payment gateway, no published product page, no shipping method, nothing that opens the cart — none of which any API exposes and all of which survive publish silently.
- sb_page_create takes type, slug and is_homepage, so an agent can create the checkout and product pages that /checkout and /products/{slug} resolve by type rather than by slug.
- sb_look takes url to shoot a given address (typically the published storefront) instead of the draft preview, which threads no store data and renders every repeater's empty state.

### Changed
- sb_set re-derives a dataset element's bindings when config.datasetSource or config.kind changes, instead of leaving them pointing at the entity they used to describe.
- sb_add and sb_set now refuse a caller writing specials.globalId, specials.appBlockId or specials.appBlockHash, which are stamps the server writes on compose; authoring one decomposes the node over its shared master on the next save.
- Binding sources for sb_bind and sb_review grew from 26 to 77 by also reading the editor's own binding context, so a platform-seeded binding such as price is no longer reported as dead.
- sb_bind's source argument no longer lists every binding source in its schema; an unknown source is still refused with the full list.

### Fixed
- Newly added dataset elements (text-dataset, pricing-dataset, list-dataset, and others) now carry the bindings the editor would have given them at drop time, instead of saving, publishing and rendering their placeholder forever.
- Removing a node now also removes its satellite nodes (list-empty, list-loading, the quantity and product-variant-label nodes), which attach by parent pointer alone and used to survive removal and fail the next save with unrecognized ids.
- sb_publish now posts to the site's publish endpoint with pageIds instead of a per-page publish route that the platform answers with 404.
- A tool result built from an empty response body (such as a 204 on delete) no longer fails client-side validation.
- sb_page_open, sb_set and sb_look no longer refuse a real page's satellite nodes (list-empty, list-loading, the quantity and product-variant-label nodes) as orphans; the save check now verifies attachment to the tree instead of exact parent/child-list agreement.
- sb_media_upload reports that a key-only install cannot upload media, since /api/media is mounted behind session auth only, instead of surfacing a bare unauthorized error.

## [0.1.4] - 2026-09-07

### Added
- sb_set accepts an edits[] batch so many nodes save and publish in one call instead of one round trip per node.
- sb_api_call shapes list answers with pick and max_items, and cuts an oversized list to fit the result cap while saying how many items were shown and how to narrow the call.
- All 25 tools carry MCP annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint), so compliant clients stop asking for confirmation on reads.
- Trap 5 is now guarded in code: an edit inside an app block's interior is refused instead of being silently lost on save.
- The catalog is regenerated from the platform: 106 elements, 412 API operations, and 26 binding sources.

### Changed
- sb_look keeps Chrome open across calls, launching it lazily and reusing it while connected, and captures multiple widths in parallel instead of one at a time.
- sb_look screenshots are JPEG by default (format: "png" still available), which cuts image size and cost without changing token count.
- sb_look's node_id boxes now count depth from the framed node and cover only its subtree.
- sb_page_list, sb_templates and sb_media_list return a smaller, whitelisted set of fields instead of the whole document or settings blob.
- sb_look's measured layout boxes are returned as compact tuples ([id, type, x, y, w, h]) instead of pretty-printed objects, with box_depth controlling how deep the tree goes.
- Tool descriptions for sb_bind, sb_look, sb_live_join, sb_review and sb_api_find are shorter; sb_bind no longer interpolates all 26 binding sources into its schema.
- The server's handshake instructions are shorter, take their tool/element/operation counts from generated source records, and no longer claim a base style value vanishes on publish.
- Findings from sb_page_open, sb_review and sb_look reuse one fix template per kind of defect, and directives such as FIX THESE are said once per process instead of on every call.
- Every tool result is now compact JSON.

### Fixed
- sb_live_join reports why an API key cannot join a live session instead of joining silently into a socket that never opens, since the platform refuses wbk_ keys.
- Multipart uploads now surface the platform's per-field validation errors instead of a generic failure.
- Duplicating a subtree that contains an app block is refused instead of being silently reduced.
- fill() throws when a code has no template instead of returning an empty fix.
- sb_api_call's publish step splits an ops batch to stay under the live socket's 4 MiB frame cap instead of risking a dropped connection.
- A non-list answer's size is no longer silently cut, and asking for max_items on a non-list answer is now reported instead of ignored.
- A platform response field named truncated is no longer overwritten by the result-shaping logic.
- Each screenshot page now closes in its own finally block, so a tab lost to a first rejection can no longer leak for the life of the process.

## [0.1.2] - 2026-08-29

### Added
- The server reports which machine and which client it runs on, so the store's Agent app can show every connected agent.
- sb_look measures the render: content past the viewport, overlapping siblings, and text too small to read are reported with the width they happen at.

## [0.1.1] - 2026-08-28

- fix(release): ask for the one-time password instead of dying on it
- feat: sb_media_upload — the agent can add images
- feat(vision): sb_look frames one element
- feat: sb_review — the defects a visitor sees, not the ones a save catches
- fix: base style is the cascade's fallback layer, not a trap
- docs: one install section per README, not two
- feat: sbuilder-mcp install — one command, six clients
- feat: close the gap with a human designer — 22 tools
- docs: phase-6 plan — close the gap with a human designer
- fix: three defects a live run found that no unit test could
- docs: point the setup at the store's Agent app, which hands over the config
- feat(transport): one credential — an API key now opens the private surface too
- docs: phase 3 tools, the yield rule, and the wire-protocol facts
- feat(tools): sb_live_join, sb_look and sb_bind; writes publish to the room
- feat(catalog): generate the renderer's 22 binding source keys
- feat(vision): preview links and Chrome screenshots with real node bounding boxes
- feat(live): the live-edit session, with the yield rule as its organising decision
- feat(transport): the live-edit socket, with the editor's two reconnect bugs designed out
- docs: phase-3 plan (live editing and sight)
- docs: phase 2 tools, traps, and an end-to-end smoke check
- feat(tools): the page tools - open, outline, catalog search, add, set, move, remove
- feat(transport): load and save a page's draft document
- feat(site): pre-save validation mirroring the platform's own refusals
- feat(site): the builder - nested subtrees, per-breakpoint writes, containment rules
- feat(site): the in-memory page document with a compressed outline
- feat(site): node ids and catalog-seeded node construction
- feat(site): encode the four silent-failure traps as tested code
- feat(core): overlay-aware tree walking, with pageChildren as the safe default
- feat(core): the document patch primitive and its three admission rules
- feat(catalog): generate the 85-element catalog with its AI hints
- docs: phase-2 plan (the page document) and corrected element count
- docs: mark phase-1 plan steps complete
- docs: repo kit, bilingual docs, and the tool-authoring skill
- feat(tools): sb_connect and sb_site_list; wire the server end to end
- feat(tools): sb_api_find and sb_api_call - full 310-operation reach in two tools
- feat(catalog): intent search over the API index, with three honest body verdicts
- feat(catalog): generate the 310-operation API index from the platform OpenAPI doc
- feat(transport): route credentials by path prefix, which the OpenAPI doc cannot
- feat(transport): session login/refresh with a per-use token getter
- feat(transport): shared HTTP client with the platform error envelope and redaction
- feat: repo skeleton, response helpers, and a green build/test/smoke gate
- docs: design spec and phase-1 implementation plan for @sbuilder/mcp

## [0.1.0]

First release.

An MCP stdio server that designs and operates a Store Builder site.

- **Full API reach in two tools.** `sb_api_find` searches a generated index of the
  platform's 310 API operations — real parameter schemas, the credential each needs, and an
  explicit flag when the platform's own document fails to describe a request body.
  `sb_api_call` executes one, defaulting to a dry run.
- **Page building.** An 85-element catalog carrying the platform's own AI hints
  (`useWhen` / `avoidWhen` / `contentTips`), the live-edit patch primitive with its three
  admission rules, and a builder that takes a whole nested section in one call.
- **Four platform traps encoded as tested code**, each of which fails silently otherwise:
  site overlays are excluded from every ROOT-level rule; global sections warn that edits
  cascade; ROOT's children are held to `[header][middle][footer]`, which the platform
  refuses every save without; and style writes go per breakpoint, because a visual quantity
  written at base renders on the canvas and vanishes on publish.
- **Live editing.** `sb_live_join` joins the editor's room as a visible peer — edits appear
  in anyone's open editor as they happen. The client always yields: it never answers a
  snapshot request and re-pulls on any divergence.
- **Sight.** `sb_look` saves, renders through the platform's own renderer, and returns
  screenshots plus the measured bounding box of every node.
- **One credential.** `SB_TOKEN` alone opens everything, from the store's **Apps → AI agent**
  screen.
