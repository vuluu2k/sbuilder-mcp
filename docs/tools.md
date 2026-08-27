# Tools

Four tools reach 310 platform operations. `sb_api_find` is an index, not a tool per
endpoint — see [why](../README.md#tools).

---

## `sb_connect`

Log in and report what this server can reach. **Call this first.**

| Arg | Type | Notes |
| --- | --- | --- |
| `email` | string? | Defaults to `SB_EMAIL` |
| `password` | string? | Defaults to `SB_PASSWORD` |

Returns `{ user, sites: [{id, name}], api_key: "present"|"missing", operations, note? }`.

A missing `SB_TOKEN` is **reported, not thrown**: the session half of the surface works
without one, and failing the whole connect would hide that from a caller who never touches
`/api/v1`. The password is never echoed.

## `sb_site_list`

List the sites this account can operate. No arguments.

## `sb_api_find`

Find operations by intent.

| Arg | Type | Notes |
| --- | --- | --- |
| `query` | string | What you want to do, in words |
| `tag` | string? | Narrow to one tag: `menus`, `products`, `theme`, … |
| `limit` | number? | Default 12, max 50 |

Each match returns its id, method, path, summary, tags, required credential, and
non-body parameters — plus **one** body verdict:

| Field | Meaning |
| --- | --- |
| `body_schema` | The document resolved a `$ref`; this is the real shape |
| `body_warning` | A body is declared but has no schema (58 operations). Read the matching GET and modify a copy |
| `body_note` | A write operation declares **no** body at all (60 operations). Sometimes true — `POST /orgs/{id}/leave` is a pure action — and sometimes a missing annotation: `PUT /pages/{id}/source` carries an entire page document and is documented exactly like this |

Never more than one of the three. The distinction is load-bearing: treating `body_note` as
"takes no body" would send an empty PUT and wipe a page.

Scoring is term hits weighted by field (tag 5, path 3, summary 2), ties broken by id. It is
deliberately not fuzzy — an empty list is cheap to recover from, a confidently wrong
operation is not.

## `sb_api_call`

Execute one operation found by `sb_api_find`.

| Arg | Type | Notes |
| --- | --- | --- |
| `id` | string | From `sb_api_find`, e.g. `get:/api/sites/{siteID}/menus` |
| `path_params` | object? | Every `{name}` in the path; missing one is refused, values are URL-encoded |
| `query` | object? | Query string; `undefined` values are dropped |
| `body` | any? | Request body |
| `dry_run` | boolean? | **Defaults to `true`** — sends nothing, returns a redacted preview |

Credentials are chosen from the path, never from the argument: `/api/v1/…` uses `SB_TOKEN`,
everything else uses the session. A missing `SB_TOKEN` is reported by name rather than
letting the platform answer `401 api_key_required`, which reads like a permissions problem.

---

# Page tools

Nine more tools that design the page itself. `sb_page_open` must come first — the rest act
on the one open document.

## `sb_page_open`

| Arg | Type |
| --- | --- |
| `site_id` | string |
| `page_id` | string |

Loads the page's **draft** document and returns its outline. What comes back is *composed*:
global sections and site overlays have been merged onto ROOT.

## `sb_outline`

`depth` (1–6, default 1). One line per node: `id`, `type`, `name`, `children`, plus `band`
(`header`/`middle`/`footer`), `global: true` for a shared master, and `overlay: true` for a
site overlay. **Never the raw document** — a real page is hundreds of KB.

## `sb_node_read`

`id`. One node in full. Attaches a `warning` when the node is a shared global.

## `sb_catalog_search`

`query`, `limit`. Searches the platform's own AI hints across all 85 elements and returns
`description`, `useWhen`, `avoidWhen`, `contentTips` for each match — written by the
platform team for exactly this purpose.

## `sb_traits_for`

`type`. Which trait **groups** the element accepts (`size`, `typography`, `background`,
`spacing` …), its seeded defaults, and its containment rules.

## `sb_add`

| Arg | Type | Notes |
| --- | --- | --- |
| `parent_id` | string | |
| `spec` | object | `{ type, name?, style?, config?, specials?, children? }` — **nested** |
| `index` | number? | Defaults to append |
| `dry_run` | boolean? | Defaults to true |

Pass `children` to build a whole section in one call. Refuses a root-only element inside a
section, a child a parent's whitelist excludes, and any add into a non-container.

## `sb_set`

| Arg | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `namespace` | `style` \| `config` \| `specials` | |
| `keys` | object | |
| `breakpoint` | `desktop` \| `laptop` \| `tablet` \| `mobile` | Defaults to `desktop` |
| `base` | boolean? | Write at base instead of per breakpoint |
| `dry_run` | boolean? | Defaults to true |

**Style and config are written per breakpoint by default.** A visual quantity written at
base renders on the canvas and then vanishes on publish — the published cascade has no base
layer under it. `base: true` is refused for anything that is not an identity key
(`htmlTag`, `kind`, `href`, `src`, `alt`, …). `specials` is always base: content is not a
quantity.

## `sb_move` / `sb_remove`

`sb_move` takes `id`, `parent_id`, `index`. `sb_remove` takes `id` and deletes the whole
subtree. Both refuse to touch a **site overlay** — it is composed onto ROOT on read and
stripped on write, so editing it here would do nothing on save. `sb_move` refuses a move
into the node's own descendant, which would detach that subtree with nothing to report it.

## What every write checks before it saves

Four platform rules, encoded and tested rather than documented:

1. **Band order** — ROOT's children must read `[header][middle][footer]`. The platform
   refuses *every* save otherwise (`ErrBandOrder`).
2. **Overlays** are excluded from every ROOT-level rule, exactly as the platform excludes
   them before its own check.
3. **Globals** are shared masters; any result touching one carries a warning that edits
   change every page and publishing cascades.
4. **The responsive mandate** — see `sb_set` above.

Plus tree integrity: no dangling child ids, no parent pointer disagreeing with a child
list, no node unreachable from ROOT.

---

# Live editing and sight

## `sb_live_join`

`site_id`. Joins the editor's live-edit room as a visible peer. From then on every
`sb_add` / `sb_set` / `sb_move` / `sb_remove` / `sb_bind` **also goes out as a live op**, so
anyone with the editor open watches the page assemble, and the agent's cursor moves to the
node it is changing — whenever a real measurement from `sb_look` exists. Presence with an
invented coordinate would be theatre, so absent a measurement the cursor simply does not
move.

**The yield rule.** This client is never the authority on the document. It does not answer
a snapshot request for anyone, and it publishes no convergence checkpoint of its own. On any
evidence of divergence — a gap in the server's `seq`, a checkpoint arriving at its own seq,
a rejected save — it discards its copy, re-pulls from the server, and **fails the next save
loudly** so the caller re-reads and reapplies. Safe to run beside a human; the human wins
every disagreement.

## `sb_look`

| Arg | Type | Notes |
| --- | --- | --- |
| `widths` | number[]? | Defaults to 1440 / 768 / 390 |
| `with_boxes` | boolean? | Defaults to true |

**Saves first**, then mints a signed preview link and renders the page through the
platform's own Go renderer — so the picture is of the *stored draft*, never of unsaved local
edits. Returns one image per width plus the measured bounding box of every `[data-node-id]`.

Needs **system Google Chrome**: `playwright-core` bundles no browser, so nothing is
downloaded on install. If Chrome is missing the tool says so by name rather than returning a
blank image — an agent that judges a page it never saw is worse than one that stops.

## `sb_bind`

| Arg | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `source` | string | One of 22 keys the renderer provides — `product.title`, `product.price`, `category.title`, `article.title`, … |
| `field` | string | Always `specials.<key>` |
| `dry_run` | boolean? | Defaults to true |

Both arguments are validated against generated vocabulary, because both failures are
**silent**: an unknown `source` resolves to nothing and renders as the element's own
placeholder (indistinguishable from "still loading"), and a `field` outside `specials` is
stored, saved, published, and ignored forever — `applyBindings` reads the namespace off the
field and skips anything else.
