# `@sbuilder/mcp`

An MCP **stdio** server that lets an AI agent operate a [Store Builder](https://sbuilder.io.vn)
site end to end — design its pages, fill them with real data, look at the result, and
publish it — with no human clicking anything.

*[Tiếng Việt](./README.vi.md)*

## Install

```bash
npx -y @sbuilder/mcp
```

Claude Code / Claude Desktop:

```json
{
  "mcpServers": {
    "sbuilder": {
      "command": "npx",
      "args": ["-y", "@sbuilder/mcp"],
      "env": {
        "SB_API": "https://api.your-host",
        "SB_TOKEN": "wbk_…",
        "SB_EMAIL": "you@example.com",
        "SB_PASSWORD": "…"
      }
    }
  }
}
```

## Two credentials, and why you need both

The platform refuses each credential on the other's surface, so this is not a choice:

| Credential | Reaches |
| --- | --- |
| `SB_TOKEN` — a `wbk_` API key you mint in the app | `/api/v1`: products, orders, customers, media, blog, page metadata, webhooks |
| `SB_EMAIL` + `SB_PASSWORD` — a normal account | everything under `/api/sites/…`: pages, menus, theme, forms, overlays, translations, settings — and the live-edit socket |

Sending a session token to `/api/v1` answers `401 api_key_required`; sending an API key to
the private API is refused too. `sb_connect` reports which half you have.

`SB_API` defaults to `http://localhost:8080`. Secrets are read from the environment only.

## Tools

| Tool | What it does |
| --- | --- |
| `sb_connect` | Log in, list the sites this account can operate, report which credentials are present |
| `sb_site_list` | List the sites this account can operate |
| `sb_api_find` | Find API operations by intent — returns real parameter schemas, the credential each needs, and an explicit note when the platform's document fails to describe a request body |
| `sb_api_call` | Execute one operation. Defaults to a dry run that sends nothing |
| `sb_page_open` | Open a page for editing and return its outline |
| `sb_outline` | The open page as a compressed tree — never a raw document dump |
| `sb_node_read` | One node in full, with a warning if it is a shared global |
| `sb_catalog_search` | Find an element by what it should do, using the platform's own AI hints |
| `sb_traits_for` | Which trait groups an element accepts, plus defaults and containment rules |
| `sb_add` | Add an element — or a whole nested subtree — in one call |
| `sb_set` | Write style/config/specials. Per breakpoint by default |
| `sb_move` | Move a node to another parent |
| `sb_remove` | Remove a node and its subtree |
| `sb_live_join` | Join the editor's live-edit room as a visible peer — edits then appear live |
| `sb_look` | Save, render, and return screenshots plus measured node boxes |
| `sb_bind` | Bind a node's content to real store data |

Sixteen tools, **310 API operations**. `sb_api_find` is an index rather than a tool per endpoint,
so the tool list stays short while everything the platform can do stays reachable — and
operations added to the platform arrive with the next `npm run codegen`.

Full reference: [`docs/tools.md`](./docs/tools.md).

## How it stays in sync

The platform publishes two generated, committed artifacts. A build step reads them out of a
checkout and emits the catalog:

```bash
WB_REPO=/path/to/web_builder npm run codegen
```

So this repository vendors no platform code — it depends on two data files with a
maintained contract. `src/catalog/api.generated.ts` is committed, so `npm install` needs no
checkout at all.

## Development

```bash
npm run build     # tsc -> dist/
npm test          # vitest
npm run smoke     # offline self-test; must print ALL GOOD
```

Contributor guide: [`CLAUDE.md`](./CLAUDE.md). Design rationale:
[`docs/superpowers/specs/`](./docs/superpowers/specs/).

## Designing safely

Four platform rules fail **silently** if a client does not know them, so they are encoded
here as tested code rather than advice:

- **Band order** — ROOT's children must read `[header][middle][footer]`, or the platform
  refuses every save.
- **Site overlays** (the cart drawer, pop-ups) are composed onto ROOT on read and stripped
  on write; they are excluded from every ROOT-level rule and cannot be edited through the
  page tools.
- **Global sections** are shared masters — editing one changes every page carrying it, and
  publishing cascades. Any result touching one says so.
- **The responsive mandate** — a visual quantity written at base renders on the canvas and
  vanishes on publish, so `sb_set` writes per breakpoint by default and refuses a base-only
  write of anything that is not identity.

## Status

All three phases shipped: authentication and full API reach; the page document, patch
protocol, builder and the four traps; the live-edit socket, the yield rule, and the vision
loop.

Requires **Node ≥22** (the global `WebSocket`) and, for `sb_look` only, **system Google
Chrome** — `playwright-core` bundles no browser, so installing downloads nothing.

MIT.
