# Changelog

**English** · [Tiếng Việt](./CHANGELOG.vi.md)

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
