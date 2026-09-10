# `sbuilder-mcp`

An MCP **stdio** server that lets an AI agent operate a [Store Builder](https://sbuilder.io.vn)
site end to end — design its pages, fill them with real data, look at the result, and
publish it — with no human clicking anything.

*[Tiếng Việt](./README.vi.md)*

## Install

One command writes this server into every agent client on your machine:

```bash
npx -y sbuilder-mcp install --token wbk_… --api https://your-host --site site_…
```

It knows Claude Code, Claude Desktop, Cursor, Windsurf, VS Code and Codex, and installs into
the ones it finds. Name them with `--client cursor,codex`, or rehearse with `--dry-run`. An
option it does not know is **refused**, not ignored — a flag that silently does nothing is
worse than one that does not exist.

`--site` is optional and worth passing: a key belongs to exactly one site, so it is written
as `SB_SITE` and every tool then defaults to it. Without it the model has to carry the id
through the session, which it can only get by listing pages and reading one back.

`--site-name "Your Store"` rides alongside it as `SB_SITE_NAME`. It is a label, never an
address — nothing resolves by it — but it lets the agent say the store's name back to you
instead of a 32-character id you did not choose. The **Apps → AI agent** screen appends it
whenever the store has a name.

It **merges**: the servers already in those files stay, whatever it replaces is copied to
`<file>.sbuilder-backup`, and a config it cannot parse is refused rather than overwritten —
a file with a trailing comma is far likelier than one worth discarding, and it is what you
need to fix it.

The store's **Apps → AI agent** screen hands you this command with the key already in it.

<details><summary>Or configure a client by hand</summary>

```json
{
  "mcpServers": {
    "sbuilder": {
      "command": "npx",
      "args": ["-y", "sbuilder-mcp"],
      "env": { "SB_API": "https://api.your-host", "SB_TOKEN": "wbk_…", "SB_SITE": "site_…" }
    }
  }
}
```

</details>

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
| `sb_api_find` | Find API operations by intent — one line per match — then read one operation's call sheet by id: real parameter schemas, the credential it needs, and the body's fields read off the handler that decodes them, each carrying the trap its own doc comment records |
| `sb_api_call` | Execute one operation. Defaults to a dry run that sends nothing |
| `sb_page_open` | Open a page for editing and return its outline |
| `sb_outline` | The open page as a compressed tree — never a raw document dump |
| `sb_node_read` | One node in full, with a warning if it is a shared global |
| `sb_catalog_search` | Find an element by what it should do, using the platform's own AI hints |
| `sb_traits_for` | An element's inspector — tabs, groups, controls and what each declared one writes — plus its AI hints, defaults and containment rules |
| `sb_add` | Add an element — or a whole nested subtree — in one call |
| `sb_set` | Write style/config/specials. Per breakpoint by default |
| `sb_move` | Move a node to another parent |
| `sb_remove` | Remove a node and its subtree |
| `sb_duplicate` | Copy a node and its subtree under fresh ids, right after the original |
| `sb_templates` | The store's saved section templates — designed sections to start from |
| `sb_template_use` | Instantiate a template into a page |
| `sb_page_list` | Every page on the site |
| `sb_page_create` | Create a page — a store type arrives with the editor's own starting document; `type` is the route for checkout, product, category, post, course |
| `sb_publish` | Compile the draft into the live page (cascades to shared globals) |
| `sb_review` | Every defect a visitor would see, each with its fix, plus the five gaps between this store and a paid order |
| `sb_media_list` | The site's media library |
| `sb_media_upload` | Add an image and get its URL — the only route, the upload is multipart |
| `sb_live_join` | Join the editor's live-edit room as a visible peer — edits then appear live |
| `sb_look` | Save, render, and return screenshots plus measured node boxes and layout defects measured on the render |
| `sb_event` | Give a node a click action — open the cart, go to a page, open a pop-up |
| `sb_bind` | Bind a node's content to real store data, or make a button add to the cart |
| `sb_import` | Read a page from any public URL and add its structure and content to the open page as real elements, styled with THIS page's own tokens — a translation, not a clone |
| `sb_import_site` | Read a WHOLE site from one URL — its sitemap, or the links on that page — and give each page found its own draft page here, built from this site's tokens |
| `sb_store` | Run a store flow that must happen in a fixed order — the four writes that make a working checkout, or any of the platform's 17 form templates (login, register, forgot, contact, subscribe …) with its own field document |
| `sb_undo` | Put back what a PUT replaced — the platform has no page history or restore, so this is the only way back |

Twenty-eight tools, **495 API operations** (166 of the 216 writes carrying a body shape read
off the handler), 111 elements, 78 binding sources. `sb_api_find`
is an index rather than a tool per endpoint, so the tool list stays short while everything
the platform can do stays reachable — and operations added to the platform arrive with the
next `npm run codegen`.

Every result is compact JSON, every directive is said once per process, and every tool
carries MCP annotations — a client that honours them stops asking a person to confirm a
read.

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

### Release

A push to `main` that touches `src/**` releases on its own
(`.github/workflows/auto-release.yml`): the gate runs (build, test, smoke), the version
bump is read off the commit subject — `feat` is minor, `BREAKING CHANGE` or `!` is major,
anything else is patch — Claude writes the changelog entry in both languages,
`server.json` is synced, the release is committed as `chore(release): vX.Y.Z` and tagged,
then published to npm, as a GitHub Release, and to the MCP Registry through GitHub OIDC.
`workflow_dispatch` runs the same flow with a bump you choose. A commit whose subject
contains `chore(release):` or `release: v` is skipped, so a release never triggers another.

The workflow needs two repository secrets in the `prod` environment: `NPM_ACCESS_TOKEN`
and `CLAUDE_CODE_OAUTH_TOKEN`. The registry step needs none.

`npm run release` (`scripts/release.mjs`) is the offline path — a machine with no CI, or a
release cut while a secret is being rotated. It runs the same gate and writes the same
`## [x.y.z] - date` changelog heading, so the two never disagree.

## Designing safely

Five platform rules fail **silently** if a client does not know them, so they are encoded
here as tested code rather than advice:

- **Band order** — ROOT's children must read `[header][middle][footer]`, or the platform
  refuses every save.
- **Site overlays** (the cart drawer, pop-ups) are composed onto ROOT on read and stripped
  on write; they are excluded from every ROOT-level rule and cannot be edited through the
  page tools.
- **Global sections** are shared masters — editing one changes every page carrying it, and
  publishing cascades. Any result touching one says so.
- **Responsive by default** — `sb_set` writes per breakpoint, because a design should
  respond. Base is the cascade's fallback layer, not a trap.
- **App blocks** — a marketplace app's subtree is composed onto the page on read and reduced
  back to one reference node on save, so an edit inside it is lost without a word. Every
  write refuses the interior; the outline flags the block root `app: true`.

## Status

All three phases shipped: authentication and full API reach; the page document, patch
protocol, builder and the five traps; the live-edit socket, the yield rule, and the vision
loop. Since then: a token diet across every result, and releases that cut themselves.

Requires **Node ≥22** (the global `WebSocket`) and, for `sb_look` only, **system Google
Chrome** — `playwright-core` bundles no browser, so installing downloads nothing.

MIT.
