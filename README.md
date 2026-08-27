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

Four tools, **310 operations**. `sb_api_find` is an index rather than a tool per endpoint,
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

## Status

Phase 1 of three. Shipped: authentication, the generated API index, and full API reach.
Next: the page document (model, patch protocol, builder), then the live-edit socket,
presence, and a screenshot feedback loop.

MIT.
