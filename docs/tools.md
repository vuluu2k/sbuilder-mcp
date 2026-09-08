# Tools

Four tools reach 412 platform operations. `sb_api_find` is an index, not a tool per
endpoint — see [why](../README.md#tools).

Every result is **compact JSON** — no indentation, because the reader is a model and the
whitespace was 15 % of every answer. A directive (`findings_notice`, `layout_notice`,
`note`, `boxes_format`) is said **once per process** and its field is simply absent after:
an instruction repeated on every call is skimmed by the third one. Every tool carries MCP
annotations — `readOnlyHint` on the twelve read tools, `destructiveHint` on `sb_remove`,
`sb_api_call` and `sb_publish` — so a client that honours them stops asking a person to
confirm a read.

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

Find operations by intent, then read one operation's call sheet. Two modes on one tool,
chosen by argument — pass `query` or `id`.

| Arg | Type | Notes |
| --- | --- | --- |
| `query` | string? | What you want to do, in words — **search** |
| `id` | string? | An id from a previous search — its **call sheet** |
| `tag` | string? | Narrow a search to one tag: `menus`, `products`, `theme`, … |
| `limit` | number? | Default 8, max 50 |

**Search** returns `{ matches, next }`, one line per match:
`{ id, method, path, summary, credential, params, body? }`. `params` lists the non-body
parameter names with `?` prefixed on optional ones (`["siteID", "?limit"]`); `body` is one
word — `described`, `undescribed` or `none_declared` — and absent on a read. No tags, no
schemas: twelve matches with their schemas inlined were measured at 44 KB, for a list the
agent calls one item of. `next` says to pass an id back for the call sheet.

**Call sheet** (`id`) returns the operation in full — typed `params`, `tags`, `credential` —
plus **one** body verdict:

| Field | Meaning |
| --- | --- |
| `body_schema` | The document resolved a `$ref`; this is the real shape |
| `body_warning` | A body is declared but has no schema (62 of 168 body-carrying operations). Read the matching GET and modify a copy |
| `body_note` | A write operation declares **no** body at all (95 of 180 write operations). Sometimes true — `POST /orgs/{id}/leave` is a pure action — and sometimes a missing annotation: `PUT /pages/{id}/source` carries an entire page document and is documented exactly like this |

Never more than one of the three. The distinction is load-bearing: treating `body_note` as
"takes no body" would send an empty PUT and wipe a page. It is unchanged from when it rode
on every match; it now arrives at the moment the agent has picked an operation, which is
when it is read.

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
| `pick` | string[]? | Fields to keep on each item of a list answer (or on the one item of a `{ page: {…} }` answer) |
| `max_items` | number? | Cap on a list answer's items, applied after the platform's own paging |

Credentials are chosen from the path, never from the argument: `/api/v1/…` uses `SB_TOKEN`,
everything else uses the session. A missing `SB_TOKEN` is reported by name rather than
letting the platform answer `401 api_key_required`, which reads like a permissions problem.

A failed call carries the platform's one error shape, `{ error, code }`, and — when the
platform sends them — `details` and `fields`. A `validation` error names the offending
field in its message, so a 400 says *which* field rather than that one exists.

**Shaping.** A product list is fifty objects of 2 KB for the ids and titles the agent wanted.
The platform's list answers (`{ <name>: [...], total }`, or a bare array) are shaped for the
reader: `pick` keeps the named fields on every item, `max_items` cuts the list, and a list
still over **60,000 characters** is cut to fit. Every cut is said — `truncated: { shown, of,
hint }` names how many came back, how many there were, and how to narrow the call (`pick`,
`max_items`, or the operation's own `limit`/`offset` query). A non-list answer is never cut:
there is no honest place to stop inside one object.

Three quieter rules, each of which exists because the alternative loses data silently. An
answer with **no single list** — two arrays, say — is returned untouched with a
`shaping_note`, rather than shaped into something the platform never sent; a `pick` that
matches nothing does the same, because `{}` reads as "the platform answered nothing". If the
platform's own answer already carries a `truncated` field, this one lands under `_truncated`
instead of overwriting it. And when the non-list part of an answer alone exceeds the cap,
nothing is cut — dropping items would not help — and the note says why.

---

# Page tools

Nine more tools that design the page itself. `sb_page_open` must come first — the rest act
on the one open document.

## `sb_page_open`

| Arg | Type | Notes |
| --- | --- | --- |
| `site_id` | string? | Defaults to `SB_SITE` |
| `page_id` | string | |

Every tool that takes a `site_id` treats it as optional and falls back to
`SB_SITE` — a key belongs to one site, so the install already knows it. An explicit
argument always wins.

Loads the page's **draft** document and returns its outline. What comes back is *composed*:
global sections, site overlays and app blocks have been merged onto ROOT. Findings ride
along in the same shape `sb_review` returns them — see below.

**SATELLITES ARE ON THE MAP.** Eight element types own nodes that hang off `config[<key>]`
instead of `data.nodes` — a variant option's box, the quantity stepper's buttons, a
repeater's empty state — and they carry the element's entire look. They are listed under
their owner with `satellite: "<the config key>"`, before its real children, and are NOT
counted in `children`: that number still means `data.nodes.length`, which is what every
index-taking call is written against. Style them with `sb_set` like any other node; they
take `state` too, so hover and the selected option are yours.

**`blank_page_repair`** comes back when the stored document names its root under `rootId`
(what an app block and a section template call the same idea) instead of `root_node_id`. The
page renderer finds no root, walks nothing and publishes a page that answers 200 with an
empty `<body>` — found on a live storefront's order-complete page, where the shopper who had
just paid saw a blank screen. The document is adopted rather than refused, so the next save
writes the canonical key and the page comes back.

**`compose_warnings`** comes back when the platform reports something it could not
compose. `globalMissing` is the destructive one: the server could not find the
master and DELETED the reference from the tree you were just handed, so the page
opens with the section already gone and saving makes that permanent. The others
(`globalStale`, `overlayStale`, `appBlockMissing`, `appBlockEdited`, `formMissing`)
say what was refused or reduced. The response has always carried these; nothing
read them until now.

## `sb_outline`

`depth` (1–6, default 1). One line per node: `id`, `type`, `name`, `children`, plus `band`
(`header`/`middle`/`footer`), `global: true` for a shared master, `overlay: true` for a
site overlay, and `app: true` for the root of a composed app block — nothing under it is
editable. **Never the raw document** — a real page is hundreds of KB.

## `sb_node_read`

`id`. One node in full. Attaches a `warning` when the node is a shared global.

**Many nodes at once.** The move after a look is "raise this heading, widen that card,
recolour the button" — pass them as `edits` and it is one batch of patches, one save and
one live frame instead of one of each per node. Every edit is checked before any patch is
emitted, so a bad id in the fourth edit refuses the whole batch. The result is then
`{ set: [{ id, keys }], rev, warnings? }` with `warnings` keyed by node id.

## `sb_catalog_search`

| Arg | Type | Notes |
| --- | --- | --- |
| `query` | string | What the element should do |
| `limit` | number? | Default 8, max 30 |
| `detail` | boolean? | Add `useWhen`, `avoidWhen`, `contentTips` to every match |

Searches the platform's own AI hints across all 106 elements. Each match is
`{ type, label, category, description }`, plus `isContainer: true` / `isRootOnly: true`
only when true — four fields to **choose** by. The hints themselves, written by the platform
team for exactly this purpose, come with `sb_traits_for` for the element chosen, or on every
match with `detail: true`; ten matches' worth of hints was 7 KB for a choice made from the
description.

## `sb_traits_for`

`type`, `control?`. Without `control`: the element's AI hints, its inspector as tab → group
→ control names, every control with a declared write target in full, its seeded defaults
and its containment rules — the shape is under [Designing like a person](#sb_traits_for--the-inspector-not-a-summary).
With `control`: that one control in full.

## `sb_add`

| Arg | Type | Notes |
| --- | --- | --- |
| `parent_id` | string | |
| `spec` | object | `{ type, name?, style?, config?, specials?, children? }` — **nested** |
| `index` | number? | Defaults to append |
| `dry_run` | boolean? | Defaults to true |

Pass `children` to build a whole section in one call. Refuses a root-only element inside a
section, a child a parent's whitelist excludes, and any add into a non-container.


A created element arrives with the BINDINGS its type needs: a `text-dataset` already reads
`product.title`, a `pricing-dataset` its six price keys, a `list-dataset` its repeater target.
The editor derives them at drop time and nothing in the element's defaults carried them, so
every dataset element this server minted used to save, publish and render its placeholder
forever.

## `sb_set`

| Arg | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `namespace` | `style` \| `config` \| `specials` | |
| `keys` | object | |
| `breakpoint` | `desktop` \| `laptop` \| `tablet` \| `mobile` | Defaults to `desktop` |
| `base` | boolean? | Write at base instead of per breakpoint |
| `edits` | array? | Many nodes in one call: `[{ id, namespace, keys, breakpoint?, base?, state? }]`; the single-node fields above are then ignored |
| `dry_run` | boolean? | Defaults to true |

**Base and breakpoints.** `sb_set` writes per breakpoint by default, because a design should respond. Base is legitimate too — the cascade resolves a key *current slot → wider → base → narrower*, so base is the fallback layer, and it is where every element's own defaults are seeded. Use base for a value that genuinely should not vary.

`specials` is always base: content is not a quantity.

A dry run returns the `patches` and, the first time in a process, a `note` restating the
base-and-breakpoint rule above. A real write returns the keys set and the new `rev`, with
a `warning` when the node is a shared global.


**A dataset element follows its data.** Writing `config.kind` or `config.datasetSource` also
re-derives that element's bindings, because the bindings ARE a function of those two keys.
Leaving them alone made a text-dataset switched from a product title to a collection title
keep reading `product.title`, which off a product page resolves to nothing: it rendered empty
and said nothing. A pair the generated table does not know leaves the bindings untouched
rather than clearing them — a wrong binding is bad, and no binding is worse.

**`globalId`, `appBlockId` and `appBlockHash` are refused.** They are the stamps the SERVER
writes when it composes a shared subtree onto a page; a document REFERENCES one with
`globalRef` / `appBlockRef`. Author the composed stamp and the next save decomposes your node
over the master, emptying it for every page that carries it. That is not hypothetical: it
took four pages blank in one run. Both `sb_add` and `sb_set` refuse it and name the right key.

## `sb_move` / `sb_remove`

`sb_move` takes `id`, `parent_id`, `index`. `sb_remove` takes `id` and deletes the whole
subtree. Both refuse to touch a **site overlay** — it is composed onto ROOT on read and
stripped on write, so editing it here would do nothing on save — and anything **inside an
app block**, for the same reason. `sb_move` refuses a move into the node's own descendant,
which would detach that subtree with nothing to report it, and a move *into* an app block.

## What every write checks before it saves

Five platform rules, encoded and tested rather than documented:

1. **Band order** — ROOT's children must read `[header][middle][footer]`. The platform
   refuses *every* save otherwise (`ErrBandOrder`).
2. **Overlays** are excluded from every ROOT-level rule, exactly as the platform excludes
   them before its own check.
3. **Globals** are shared masters; any result touching one carries a warning that edits
   change every page and publishing cascades.
4. **The responsive mandate** — see `sb_set` above.
5. **App blocks** — see next.

### App blocks

A marketplace app contributes a whole subtree to a page. The document stores **one
reference node**, stamped `specials.appBlockRef`; on read the platform materialises the
app's markup under it and stamps the block root `appBlockId`; on save `DecomposeAppBlocks`
(`server/internal/page/globalservice.go:56`, after overlays, before `Decompose`) reduces
the subtree back to that one reference. So an edit inside a composed block is stored
nowhere and reported nowhere — the local document is right, the save succeeds, and the
change is gone.

Every write therefore refuses a node **inside** a block, naming the block root and saying
the edit would be lost: `sb_set`, `sb_bind`, `sb_remove` and `sb_duplicate` on a strict
descendant, and `sb_add` or `sb_move` with any node of the block — root included — as the
destination. The root itself may be set, moved or removed, because it *is* the reference
and its `specials.appBlockValues` is where the merchant's settings live. The outline flags
it `app: true`, and `sb_review` skips the interior: its placeholder text is the app's, not
this page's to fix.

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

**An API key opens the room.** `realtime.go:44` gives a `wbk_` bearer the same door as a
session, decided from the token's own shape and gated on `member.read` through the key's
DELEGATED principal — so the key joins only if the member who minted it may, and only on the
site the key belongs to. (This used to require `SB_EMAIL` / `SB_PASSWORD`; that was true
before agent keys landed, and the old check turned away a setup that works.)

**The avatar on the canvas is the KEY, not a person.** The platform returns `key.ID` and
`key.Name` rather than the minter's name, deliberately: an avatar borrowing a human's name
would tell everyone in the room that a person is editing when a machine is. So whoever has
the editor open sees the label the merchant chose for the key moving around the page, and
knows what it is.

A rejected socket auth still fires `onopen`, so a bad credential cannot be detected from the
socket alone — which is why `sb_live_join` checks for one up front and names what is missing.

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
| `box_depth` | number? | Boxes for nodes down to this depth in the tree. Default 2, max 8 |
| `node_id` | string? | Frame just this element instead of the whole page |
| `format` | `"jpeg"` \| `"png"`? | `jpeg` (default) is smaller and faster; `png` for pixel-exact colour |

**Saves first**, then mints a signed preview link and renders the page through the
platform's own Go renderer — so the picture is of the *stored draft*, never of unsaved local
edits. Returns one image per width plus `boxes`: an array of `[id, type, x, y, w, h]`
tuples in CSS px at `widths[0]`, for nodes down to `box_depth` in the open document — the
default 2 is the bands and their direct children, which is what a layout judgement needs;
ROOT is always kept. With `node_id` the depth counts from that node and only its subtree
comes back. A one-line `boxes_format` legend comes with the first look in a
process. Every rendered node (its `id` attribute) is still measured and kept in the session for the presence
cursor and the layout checks; two hundred pretty-printed objects were 27 KB a look.
`with_boxes: false` drops them. Findings ride along as with `sb_review`, and layout defects
as `layout` — see the end of this document. Nodes inside a site OVERLAY are measured but not
reported: a cart drawer is parked outside the viewport until a shopper opens it, so every
node in it reads as off-canvas — two dozen findings on a page that is correct, none of them
fixable from that page.

The shot WALKS the page before it fires, so lazy images below the fold are loaded rather
than photographed as empty boxes. Measured on a real storefront: four of the page's images
unloaded before the walk, none after.

Needs **system Google Chrome**: `playwright-core` bundles no browser, so nothing is
downloaded on install. If Chrome is missing the tool says so by name rather than returning a
blank image — an agent that judges a page it never saw is worse than one that stops.
Chrome is launched on the first look and stays open for the life of the process, and the
widths are captured in parallel, each in its own tab — a three-width look is roughly a
second instead of three. Images come back as JPEG at quality 80 unless `format: "png"` is
asked for; the format changes bytes and latency only, since the client prices an image by
its pixel size, not its byte size.


**The draft preview threads NO store data.** `/_wb/preview` renders the document with an
empty scope, so every repeater falls back to its empty state — a product grid looks broken
there and is not. `sb_look` says so once per process when the open page holds a store-driven
element. Pass the PUBLISHED storefront address as `url` to photograph the real thing; the
result echoes it back as `shot`. `url` is also the way out when the minted preview origin is
unreachable, which a dev host with `STOREFRONT_BASE_DOMAIN` set and no TLS is.

The page is waited for with `load` plus a bounded settle, never `networkidle` alone: a
storefront keeps connections open (the cart island polls, a visitor's session endpoint answers
401 forever), so waiting for a quiet moment that never comes made the only page where store
data renders impossible to photograph.

## `sb_bind`

| Arg | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `source` | string | One of 77 keys the renderers provide — `product.title`, `product.price`, `category.title`, `course.title`, `site.*`, … The schema names four; a wrong one is refused with the full list, which keeps the tool list small |
| `field` | string | Always `specials.<key>` |
| `dry_run` | boolean? | Defaults to true |
| `action` | `"add_to_cart"` \| `"buy_now"`? | Makes the node a PURCHASE control instead of a field |

Both arguments are validated against generated vocabulary, because both failures are
**silent**: an unknown `source` resolves to nothing and renders as the element's own
placeholder (indistinguishable from "still loading"), and a `field` outside `specials` is
stored, saved, published, and ignored forever — `applyBindings` reads the namespace off the
field and skips anything else.


## The purchase binding

`action` writes the one binding a shop cannot take an order without. A purchase control is
not an ordinary binding and could not be authored as one: the renderer decides what a
button *is* by reading `target.action` and nothing else
(`server/render/nodes/helpers.go:1166`), `sb_set` writes only style / config / specials, and
this tool's plain path writes no `target` at all. So a store built entirely through these
tools had no Add-to-cart button, while `sb_review` reported the missing purchase action and
named no fix that worked.

Pass `product.id` as the `source` and `specials.boundProductId` as the `field` — the shape
the editor writes. The binding takes the reserved id `bind-product-action`, so a second call
re-points the same control rather than leaving two purchase bindings on one button. `buy_now`
is stored as `dynamic_checkout`, which is the document's own vocabulary for it; the picker's
word and the stored word differ deliberately, and hand-mapping either is how they drift.

---

# Designing like a person

## `sb_traits_for` — the inspector, not a summary

Returns the element's inspector as a person navigates it — **tabs → groups → control
names** — and, for each control the platform declares, what it writes:

```
{ type, hints: { useWhen, avoidWhen, contentTips },
  inspector: [{ tab, groups: [{ group, controls: ["font_size", …] }] }],
  declared: { font_size: { label, writes, defaults? }, … },
  defaults, isContainer, isRootOnly, childAllows,
  undeclared_note, style_is_open_css }
```

`hints` are the platform's own AI hints for the element, here because this is the call an
agent makes once it has chosen one. `declared` holds only the controls with a declared write
target — 118 of the 435 in the platform's trait registry. The rest come back **named only**,
and `undeclared_note` gives the reason once: their binding is built inside a Vue widget and
is not machine-readable. (It used to be repeated under each of them; `list-dataset` alone was
74 KB.) For those, read a node that already uses the control (`sb_node_read`), set the CSS
property directly, or pass `control` to read one control in full — that mode is unchanged.

**`style` is open CSS.** Any camelCase key becomes a CSS property, so you can set anything
CSS expresses whether or not a control exists for it. `config` and `specials` are **not**
open — they are per-element, and the element's `defaults` name the keys it really uses.

## `sb_duplicate`

`id`. Copies the node and everything under it under **fresh ids**, inserted right after the
original — the move a designer makes constantly. Styling comes with it, which is the point.
Refuses ROOT, site overlays, and a subtree that contains an app block — the copy would carry
the block's stamps and the save would reduce it back to a reference with a warning this
client does not surface.

## `sb_templates` / `sb_template_use`

`sb_templates` lists the store's saved section templates as
`{ sectionTemplates: [{ id, name, description, categoryIds, source, listed, updatedAt }], total }`
— the fields the next call needs, not the template's whole document. `sb_template_use`
instantiates one into a page — the server does the copy, so the section arrives exactly as
designed. Re-open the page afterwards; the open session still holds the older tree.

## `sb_page_list` / `sb_page_create` / `sb_publish`

The page lifecycle, first-class rather than through `sb_api_call`. `sb_page_list` returns
`{ pages: [{ id, name, slug, path, isHomepage, type, status, updatedAt, publishedAt }], total }`
— a page's settings blob stays behind. A created page arrives empty and `sb_page_open`
seeds its ROOT.

The three list tools project by whitelist. The OpenAPI document does not describe list
responses, so the field names were read off the Go structs' json tags; an item that is not
an object comes back untouched, so a platform shape change degrades to yesterday's
behaviour rather than to an empty list.

`sb_page_create` takes `name` plus `type`, `slug`, `is_homepage` and `settings`. **TYPE IS
THE ROUTE** for several kinds: `checkout`, `product`, `category`, `post` and `course` resolve
by type rather than by slug, so `/checkout` and `/products/{slug}` answer 404 until a page of
that type is PUBLISHED. The default is `page`. Without this argument an agent can build a
shop it can never let anyone buy from — which is the first gap `sb_review` reports.

`sb_publish` **cascades**: a page sharing a global section with others republishes them too,
because a header edited once must not go live on one page and stay stale on the rest.

## Hover, and other states

`sb_set` takes `state` — `hover` is the one the inspector offers. A state nests *under* a
breakpoint rather than replacing it, so it is written per breakpoint like any other visual
quantity, and never at base.

---

# Installing (`sbuilder-mcp install`)

```bash
npx -y sbuilder-mcp install --token wbk_… --api https://your-host
```

Writes this server into every agent client on the machine — Claude Code, Claude Desktop,
Cursor, Windsurf, VS Code, Codex. `--client cursor,codex` names them; `--dry-run` rehearses.

| Behaviour | Why |
| --- | --- |
| **Merges** into the existing file | Those files hold other people's servers. A whole-file write is the difference between installing one and deleting somebody's setup — and they would find out the next time they reached for a tool that had quietly gone. |
| Copies what it replaces to `<file>.sbuilder-backup` | The undo, named in the output. A config writer that changes a file without saying where the old one went leaves you with nothing to reach for. |
| **Refuses** a file it cannot parse | A config with a trailing comma is far likelier than one worth discarding, and it is the very thing you need to fix it. |
| Idempotent | A second identical run writes nothing and leaves no backup behind. |
| One broken client never stops the others | A bad Cursor config is no reason to leave Claude Code unconfigured. The report says which is which. |
| Writes the **key** alone when you have one | A key opens everything the agent does day to day. Putting an account password into six config files to buy a few account-level calls is a bad trade to make on someone's behalf. |

## `sb_review` — what a visitor would see

Distinct from whether the page saves: a perfectly storable document can publish as an empty
box. Returns `{ findings, fixes, findings_notice? }`, in document order:

| Code | The defect |
| --- | --- |
| `empty_page` | Nothing on it — publishes blank |
| `empty_container` | A section holding nothing — an empty band |
| `placeholder_content` | Still the copy the element ships with ("Enter your text here") |
| `empty_text` / `missing_media` | An element left blank — empty space, or a broken image |
| `static_in_dataset` | An element inside a repeater that renders only what the document authors — the same picture on every product card |
| `unbound_dataset_element` | A dataset element with no binding at all — it waits for a bound special nothing writes |
| `dead_binding_source` | A source the renderer never provides — shows the placeholder forever |
| `dead_binding_field` | A binding field outside `specials` — stored, published, and ignored |
| `unknown_element` | A type the catalog does not know; run `npm run codegen` |
| `unlinked_form` | A `form` naming no form — composes nothing and publishes an EMPTY BOX. The platform stays deliberately quiet about this one |
| `dead_menu_link` | A menu entry with no `href` — the renderer reads `specials.menuItems` and never `menuId` |
| `extra_repeater_child` | A repeater holding more than the one child it clones per record; the rest never appear |

The two dataset codes exist because the obvious advice is wrong inside a repeater. An
`image` in a product card renders `specials.src`, so setting it puts ONE picture on every
card and the product's own photo can never appear; the fix is a different element —
`collection-media`, `text-dataset`, `pricing-dataset` and the rest, read out of the Go
renderers at codegen time as the elements whose renderer reads a `bound…` special. A bound
element with an empty authored value is finished, not unfinished, and is not reported.

Each finding is `{ code, nodeId, type, problem, key? }` — `key` where the fix names a
specials key. **`fixes` is a legend**: one template per code present, with `<id>` and
`<key>` to substitute, so twenty placeholders cost one sentence rather than twenty copies
of it with a different id in each (measured at ~270 chars a finding). `findings_notice` is
the directive that says these are defects rather than suggestions — the sibling
`webcake-landing-mcp` records in its own source that without one, models read warnings as
advisory noise and save anyway. It comes with the first non-empty result in a process and is
absent after. An empty review is `{ findings: [], verdict }`.

The last three are render rules a perfectly storable document can break. `form`
seeds `formId: ""` and forms compose on the RENDER path only, so an unlinked form
looks identical on the canvas and is the DEFAULT outcome of `sb_add`; `menu` seeds
one entry whose `href` is `""`, so a freshly added menu publishes a nav that leads
nowhere; and `list-dataset` clones `Data.Nodes[0]` alone. `sb_add` and `sb_move`
now REFUSE a second child into a repeater (a reorder within it is still fine), so
`extra_repeater_child` only appears for documents this server did not write. The
list of first-child-only elements is generated from the renderers, because
`dataset-block` is a dataset container too and renders all of its children.

Findings ride along with `sb_page_open` and `sb_look` in exactly this shape. Overlays and
the inside of app blocks are skipped: their placeholders are not this page's to fix.

`node_id` frames one element — a designer does not judge a card by looking at the whole
page, and a full-page shot of a long storefront makes one card a few pixels tall. The clip
comes from the same measurement pass the boxes do, so what is framed is exactly what
`sb_set` addresses. A node that is not on the rendered page, or that renders with no size,
is **refused by name** rather than answered with the wrong picture.


**And what stands between this store and a paid order**, under `store_gaps`, with a
`store_notice` said once per process. These are the platform's OWN readiness rules, and they
live only in the editor (`editor/src/editor/storeReadiness.ts`) — no API exposes them, so an
agent that never opens the editor is blind to every one. A four-page storefront built
entirely through these tools reviewed clean, published and rendered correctly; the editor's
publish panel then listed five gaps.

| `id` | What it means |
| --- | --- |
| `checkoutPage` | No PUBLISHED page of the `checkout` type. /checkout routes by type, so the cart's Checkout button 404s |
| `payment` | No live gateway — nothing but cash on delivery, and an online order dead-ends |
| `productPage` | No published `product` page, so every link out of a product card 404s |
| `shipping` | No delivery option: the checkout's select is empty and every order ships free |
| `cartTrigger` | Nothing opens the cart on its own; a shopper who closes the drawer cannot get back |

Each gap carries `draft: true` when the page EXISTS but is unpublished, because "publish the
one you made" and "create one" are different jobs. Ordered most-blocking first.

Four extra GETs pay for this (pages, payment-gateways, shipping-methods, global-sections) and
none of them can fail the review: a fetch that fails leaves that rule **silent** rather than
reporting a gap the store may not have. A warning that fires on a correct store is one the
reader learns to ignore.

## `sb_media_list` / `sb_media_upload`

`sb_media_upload` is the **only** way to add an image. The endpoint takes multipart
(`file:formData/file`), and `sb_api_call` JSON-encodes every body — so reaching it that way
sent JSON to a multipart handler and got a rejection nothing could act on. A page with no
images is not a designed page, so this was the gap between laying a page out and finishing
one.

Takes a local `path` or a `url` to fetch. Returns the asset with its URL and the exact
`sb_set` call that puts it on a node. `sb_media_list` first — reuse what the store already
has before adding another copy.

Errors say which side failed: an unreachable `url` is `source_unreachable`, not a blamed
upload.

### Layout defects, measured on the render

`sb_look` also reports what only exists once the browser has laid the page out — things
reading the document cannot find:

| Code | Measured |
| --- | --- |
| `off_canvas` | Content past the viewport; on a phone it also drags a horizontal scrollbar across the page |
| `text_too_small` | Body text rendering under 12px, only where text actually shows |
| `overlap` | Two elements on top of each other — nesting and a pixel of rounding are not counted |

Each carries the **widths** it happens at, because that is most of the diagnosis: fine at
1440 and broken at 390 is a responsive failure, not a broken element. They arrive as
`layout`, with `layout_fixes` as the legend and `layout_notice` — measured, not read off the
document; fix at the breakpoint named — the first time in a process. None of the three is
present when nothing was measured, or when `node_id` frames one element.

It does not judge taste. Whether a hero reads well is not measurable, and pretending
otherwise would spend the agent's attention on what it cannot know.
