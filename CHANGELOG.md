# Changelog

## 0.1.0

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
