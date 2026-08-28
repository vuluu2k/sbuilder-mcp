# `sbuilder-mcp`

An MCP **stdio** server that lets an AI agent operate a [Store Builder](https://sbuilder.io.vn)
site end to end — design its pages, fill them with real data, look at the result, and
publish it — with no human clicking anything.

*[Tiếng Việt](./README.vi.md)*

## Install

```bash
npx -y sbuilder-mcp
```

Claude Code / Claude Desktop:

```json
{
  "mcpServers": {
    "sbuilder": {
      "command": "npx",
      "args": ["-y", "sbuilder-mcp"],
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

## Installing it

One command writes this server into every agent client on your machine:

```bash
npx -y sbuilder-mcp install --token wbk_… --api https://your-host
```

It knows Claude Code, Claude Desktop, Cursor, Windsurf, VS Code and Codex, and by default
installs into the ones it finds. Name them explicitly with `--client cursor,codex`, or
rehearse with `--dry-run`.

It **merges**: the servers already in those files stay, whatever it replaces is copied to
`<file>.sbuilder-backup`, and a config it cannot parse is refused rather than overwritten —
a file with a trailing comma is far likelier than one worth discarding, and it is what you
need to fix it.

The store's **Apps → AI agent** screen hands you this command with the key already in it.

## Getting the key

Open your store, go to **Apps → AI agent**, and press **Create key**. That screen hands you
the config block for your client with the key already in it — this whole section is what it
saves you reading.

One key is all you need. It reaches both the partner surface (`/api/v1`) and the private
site API, including the page document and the live-edit socket, and it is bounded three ways
on every request: its own scopes, the live role of the member who created it, and the single
store it belongs to.

`SB_EMAIL` + `SB_PASSWORD` remain optional, and buy exactly one thing: **account-level**
calls — listing your sites, managing members and roles — which a key deliberately cannot
make, because those mean "this person's account".

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
| `sb_duplicate` | Copy a node and its subtree under fresh ids, right after the original |
| `sb_templates` | The store's saved section templates — designed sections to start from |
| `sb_template_use` | Instantiate a template into a page |
| `sb_page_list` | Every page on the site |
| `sb_page_create` | Create a page |
| `sb_publish` | Compile the draft into the live page (cascades to shared globals) |
| `sb_live_join` | Join the editor's live-edit room as a visible peer — edits then appear live |
| `sb_look` | Save, render, and return screenshots plus measured node boxes |
| `sb_bind` | Bind a node's content to real store data |

Twenty-two tools, **310 API operations**. `sb_api_find` is an index rather than a tool per endpoint,
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
