# Tools

Four tools reach 495 platform operations, and 166 of the 216 writes among them carry a body
shape read off the handler that decodes it. `sb_api_find` is an index, not a tool per
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
| `body_shape` | The fields the handler actually decodes, read out of the platform's Go source: `{ fields: [{ name, type, note? }], readOnly?, goType, source: "go" }`. Covers 158 of 212 write operations |
| `body_schema` | Swagger resolved a `$ref` and no handler shape was found |
| `body_warning` | A body is declared but nothing describes its shape. Read the matching GET and modify a copy |
| `body_note` | A write operation declares **no** body at all. Sometimes true — `POST /orgs/{id}/leave` is a pure action — and sometimes a missing annotation |

Never more than one of the four, and `body_shape` outranks the rest. It outranks them
because the handler is the code that runs: `swagger.json` describes 46 of 212 write bodies,
and it attaches one doc comment's `@Param body` to **every** `@Router` line beneath it, so a
listing GET can claim a body it does not take. A decode site sits inside one
`case http.Method*`.

`note` on a field is that field's own doc comment, trimmed to its first sentence plus any
sentence that shouts — which is where this platform keeps what decides a body.
`shipping.Method` says `freeOverCents` is *"ZERO MEANS 'never free', not 'always free'"*, and
a shape without that sentence produces a store that delivers everything for nothing.
`readOnly` lists the fields the platform owns, read off the editor's own `Omit<…>` input
types, so a create does not try to supply an `id`.

The distinction between the last two is still load-bearing: treating `body_note` as
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
| `keys` | object | Optional when `unset` carries the work |
| `unset` | string[]? | Keys to REMOVE from the same slot — the only way to undo a write. `null` is not the same: it is a stored value, so the override still counts as present |
| `breakpoint` | `desktop` \| `laptop` \| `tablet` \| `mobile` | Defaults to `desktop` |
| `base` | boolean? | Write at base instead of per breakpoint |
| `edits` | array? | Many nodes in one call: `[{ id, namespace, keys, breakpoint?, base?, state?, unset? }]`; the single-node fields above are then ignored |
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


**The draft preview DOES thread store data — judge a list page from it.** `ServePreview`
runs `RenderDraft` → `gather` → `assemble`, the same path as a published page, and the
platform's own comment says the result is "byte-identical to what publishing this source
would serve" (`storefront.go:1260`). A home page previews its real products at their real
prices.

What the preview cannot do is resolve ONE RECORD from the address: entity routing lives in
`ServeHost`, not `ServePreview`, so an **entity template** — the product or category detail
page — previews with nothing bound. The title is blank, the price reads zero, and a variant
picker shows the element's seed options ("Color / Size", "Red / S") instead of the product's
own. That is the preview, not the page. Pass the PUBLISHED storefront address as `url` to
judge a template; the result echoes it back as `shot`. `url` is also the way out when the
minted preview origin is unreachable, which a dev host with `STOREFRONT_BASE_DOMAIN` set and
no TLS is.

The page is waited for with `load` plus a bounded settle, never `networkidle` alone: a
storefront keeps connections open (the cart island polls, a visitor's session endpoint answers
401 forever), so waiting for a quiet moment that never comes made the only page where store
data renders impossible to photograph.

## `sb_event`

| Arg | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `action` | string | An action this element allows, or `"none"` to clear |
| `trigger` | string? | Defaults to `click` |
| `payload` | object? | |
| `dry_run` | boolean? | Defaults to true |

The only way to put a click action on a node. `NodeSpec` carries no `events`, `sb_set` writes
style / config / specials, and `createNode` always minted `events: []` — so `open_cart` could
not be authored at all, and a site built from scratch had no way to open its own cart drawer
while `sb_review` reported that gap and named a fix nothing could apply.

The action is checked against the element's own allow-list, and a wrong one is refused with
the list. WHICH list is live depends on the node: a purchase-bound control gets
`bindingEvents` instead — an unbound button navigates, a bound one hands off to the cart or
the checkout, and the two sets are mutually exclusive because "add this product, then go to
an arbitrary URL" is not a thing the cart runtime can express.

**A purchase is not an event.** `add_to_cart` and `buy_now` appear in no element's allow-list;
the button meta says why in as many words. The intent is the BINDING — `sb_bind` with
`action` — and the event is what happens alongside it. Asking for one here is refused and
pointed at `sb_bind`.

One action per trigger, replaced in place: a second `click` on one node is two answers to one
question.

---

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
  defaults, translatable?, config_values?, isContainer, isRootOnly, childAllows,
  undeclared_note, style_is_open_css }
```

`translatable` names which of this element's specials a translation may rewrite, and which of
the ones it carries must NEVER be — translating those does not degrade the page, it BREAKS the
render (`name` is a lucide icon id, `src` a URL, `filterSource` a registry id the renderer
switches on). An EMPTY `specials` list is the complete answer, not an omission: an icon's only
string is an icon id. Any `/translations` operation's call sheet carries the entity half.

`sb_set` also warns when a FIELD-SKIN key lands on a form node that renders none of it — the
FORM dresses every field it holds with the input vocabulary, while a payment card, choice group,
timeslot or file field carries its own, and a knob on the wrong one is stored and read by
nothing. The warning names the node that would render it.

`config_values` names the LEGAL VALUES of the few config keys where guessing wrong is silent.
Every trait in the platform's registry declares schema type `string`, so a control's
vocabulary lives in the Vue picker — unreadable to an agent — and `EffectiveCollectionType`
is a NORMALISER, not a validator: the platform's own test pins `"bestseller"` → `all_products`,
so a repeater set to a plausible word repeats the whole catalogue under your heading with no
error anywhere. Generated from the Go, so it carries the fallback and the aliases (`category`
is a working spelling of `collection`). It attaches to the ELEMENT, not to a control, because
the keys that need it most — `collectionType` among them — are precisely the UNDECLARED ones.

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

### Built-in layouts

`sb_templates` lists the site's own section templates first and a set of BUILT-IN layouts
second, under `built_in`. A template a merchant designed is this site's answer; these are
defaults for a page that has none — measured on a live site, the platform's own library held
**two**, which is why an agent asked for "a hero" was inventing one from flex-blocks every time.

`sb_template_use` takes either id. The site's own is copied BY THE SERVER, so it arrives exactly
as designed. A built-in is **composed here**, against the target page's own tokens — the same
heading ink, button fill and section padding the page already uses. On a page that has none yet
it falls back to the SITE'S THEME, carried as `var(--wb-color-…)` rather than the hex those
resolve to: a literal on a node outranks the style preset beneath it permanently, so a band
that baked today's colour in would stop following the theme the moment it changed.

**A picture slot takes a REAL image, from the site's own library.** `sb_template_use` reads the
library and hands the pattern what the merchant already owns, preferring a landscape where the
layout wants one and never repeating a photo the page is already showing. It is the only honest
source: keyword stock is not one (this repo's own build got a cat statue for "kids,clothing"),
and a grey box reads as unfinished because it is. A site with an empty library gets a sentence
naming `sb_media_upload` instead of a placeholder.

The patterns are built as capture trees through the same mapper an import goes through, so each
one inherits its answers to rules 0, 1 and 3 — the page's tokens, a stack breakpoint on every
row, and a column that is as tall as its content once the row stacks.

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

**A STORE PAGE ARRIVES BUILT.** `product`, `category`, `search`, `blog`, `post` and `complete`
open with the document the editor gives a merchant, generated by calling the palette's own
cards rather than by copying them — a product page carries the whole buy box (gallery, title,
price, variant picker, description, quantity stepper, Add to cart, Buy it now) already bound,
with the `add_to_cart` BINDING that is the hardest part to guess. Pass `seed:false` for a blank
page. `locale` (`vi` default, or `en`) and `headline` pick the completion page's thank-you
line, read from the platform's own i18n so a Vietnamese store does not open in English. The
seed is a second write: if it fails, the page exists and is blank, and the result says so
rather than failing the create.

**The new page WEARS THE SITE'S CHROME.** A page created through the editor carries the site's
header and footer; one created here carried neither, so an agent building a site produced pages
with no navigation and no footer on a site that has both — and nothing reported it, because
`sb_review` reads the page and the page is fine while `siteChrome` asks whether the SITE has
globals and it does. The header and footer are read off the HOME PAGE rather than picked by
name or by order: a site can hold several of each (the store measured here holds four headers),
and the home page is the site's own answer to which one is its chrome. The reference goes in
first and last, which is the band order every save is checked against. `chrome: false` opts
out, and a site with no home page to read is left alone rather than guessed at.

`sb_publish` **cascades**: a page sharing a global section with others republishes them too,
because a header edited once must not go live on one page and stay stale on the rest.

## Working with the other MCP servers

These tools answer three of the five questions a site raises. The other two need a design
source and a browser you can drive, and reaching for the wrong server costs either a browser
launch inside an edit loop or an hour proving something one call would have settled.

| Server | Answers | Reach for it |
| --- | --- | --- |
| **Figma MCP** | what the design SAYS — the token, its name, its variants, its hover value | tokens IN, before the first section |
| **Google Stitch MCP** | a design system already decided — palette, type, radius, light/dark | tokens IN, when there is no Figma file |
| **`sb_look`** | what the page looks like now, three widths, ~900ms warm | after every edit. This is the loop |
| **Chrome DevTools MCP** | WHY it looks like that — computed style, the linked stylesheet, console, network, Lighthouse | the tree is right and the page is wrong |
| **Playwright MCP** | what happens when somebody USES it — click, scroll, fill, submit | anything a screenshot cannot show without being told |

**tokens in → build → look → diagnose → prove.** Do not put a browser server inside the edit
loop: `sb_look` is ~900ms warm because it pools its browser for the process lifetime, while
DevTools and Playwright attach or launch per session.

Six questions only a browser server can settle, all of them real to this platform:

1. **Does the sticky header actually stick?** A screenshot is one scroll position. Open the
   published page, scroll, and read `classList` for `wb-stuck` — the class the platform's own
   island toggles, and the entire contract behind the `stuck` state. If it never appears,
   every stuck override on the page is stored and never painted. `sb_look` says so once, in
   `stuck_note`, on any page that pins something.
2. **"The style did not apply."** It almost always did: the page's CSS is a LINKED stylesheet
   (`static-*.css`, `desktop-*.css`), so grepping the HTML proves nothing. Ask the browser
   what it computed — `getComputedStyle(el)` — never the markup what it said.
3. **Does the cart drawer open when a shopper clicks?** `sb_look` photographs it by adding the
   platform's own `is-open` class itself, which says nothing about the trigger. Click the real
   control instead; an untriggerable drawer is a store nobody can buy from.
4. **Does the checkout take an order?** `sb_store` builds it and `sb_review` reports the gaps;
   neither submits anything. Fill the form and check the shopper lands on `/checkout/complete`
   — against a **sandbox** gateway, never live credentials.
5. **What does an entity template look like with a real record?** Entity routing lives in
   `ServeHost`, not `ServePreview`, so a product or category TEMPLATE previews bound to
   nothing. Use the published `/products/{slug}`.
6. **Is it fast, and does it hold still?** Lighthouse on the published storefront. CLS is the
   one that matters here — the renderer writes intrinsic `width`/`height` on every `<img>` to
   keep it at zero, so a frame whose `aspect-ratio` fights those attributes shows up as
   layout shift and not in a still screenshot.

Two things not to do: run DevTools MCP and Playwright MCP against the same page at once (they
are two browsers, not one view of one), and point either at the draft preview when the
question is about data or routing. Check each server is exposed in THIS session before
planning around it — an MCP server can be configured project-scoped, and an unauthenticated
Figma exposes only `authenticate`.

---

## Hover, and other states

`sb_set` takes `state` — `hover` is the one the inspector offers. A state has **two homes**,
and the platform names both (`schema/src/node.ts`, mirrored by `render/style/cascade.go`'s
`MergeStateNs`):

| Call | Written to | Use it for |
| --- | --- | --- |
| `state:"hover"` + `breakpoint:"mobile"` | `responsive.mobile.states.hover.style` | a state that differs on one screen size |
| `state:"hover"` + `base:true` | `states.hover.style` | the usual case — a state that does not vary |

Base is not a degenerate case to route away from: it is where every element seeds its own
`meta.defaults.states` (`tab-item`'s hover, `quantity-button`'s hover), and `MergeStateNs`
reads it first, letting breakpoint slots overlay it exactly as it does the plain namespace.

`specials` takes no state and says so rather than dropping it — content and identity do not
vary by hover.

---


### Hover has TWO homes, and `states.hover` is not always the one

The platform grew a universal hover state alongside the pinned one, and the obvious reading —
"hover is `states.hover` now" — is wrong for the twelve element types that declare a Hover
variant of their own: the universal compiler deliberately stands aside for all of them.
`sb_set` writes each one where its meta says its hover lives, and says so when that is not the
state slot.

| Call | Lands in | Rendered as |
| --- | --- | --- |
| `state:"hover"` on most elements | `states.hover` | `@media (hover:hover){#self:hover{…}}` |
| `state:"hover"` on a `button` | `config.stateHover` — flat, **base-only** | the button's own `:hover` rule |
| `state:"hover"` on a filter, `text-dataset`, or a satellite (`tab-item`, `quantity-button`…) | `states.hover` | that element's own skin, or its OWNER's |
| `state:"parentHover"` — universal on every element | `states.parentHover` | `@media (hover:hover){#parent:hover #self{…}}` |

**The card effect every storefront ships** is rows one and four together: hover the card, and
the image zooms while a quick-add button appears.

```
sb_set ds_card style base:true state:"hover"       { boxShadow: "0 8px 24px #0002", transform: "translateY(-3px)" }
sb_set img_1   style base:true state:"parentHover" { transform: "scale(1.05)" }
sb_set btn_add config                              { revealOnHover: true }
sb_set btn_add style base:true state:"hover"       { backgroundColor: "<darker accent>" }   # → config.stateHover
```

**`parentHover` hangs off an ANCESTOR BOX — by default the nearest one, and `sb_set` tells you
which.** `specials.hoverHostDepth` (base-only, 1-based, nearest-first) picks a wider one: the
moment somebody groups a few things inside a card, the nearest box becomes the group and
"hover the whole card" needs depth 2. A depth past the end of the chain CLAMPS to the
outermost box rather than going dead, and the result says when it did. Three structural cases
give it nothing to key off — `sb_set` refuses each by name rather than storing a rule that never matches: a SATELLITE
(it hangs off its owner's config and renders no element to name), a direct child of ROOT (the
pointer is inside the page whenever it is inside the window), and an orphan.

**`config.revealOnHover`** hides an element until the box around it is hovered — compiled to
opacity + visibility + pointer-events, never `display`, so it can transition and never resizes
the card under the pointer. It needs the same host and is refused without one: the platform
emits neither half, and the element would simply stay visible.

**Every hover rule sits behind `@media (hover:hover)`.** On a touch screen `:hover` latches, so
a device with no pointer matches neither half of a reveal and the element is simply visible.
Never put anything a shopper must reach behind hover alone.

`hidden: true` is the one config key a hover state translates (to `display: none`), and only
`true` — the same contract the stuck state has.

One element is known broken upstream: `product-image-list` declares `storage: 'node'`, so its
hover belongs in `states.hover`, and measured on 2026-09-09 nothing compiles it. `sb_set`
writes it where the meta says and warns.

---
### Pinning, and the `stuck` state

`position: sticky` changes nothing observable when it engages — CSS has no `:stuck` — so the
platform toggles one class (`wb-stuck`) on the pinned element from a runtime island and
compiles every rule written for the pinned look against it. That makes `stuck` **the one
state with a precondition**, and three separate silent failures around it:

| What you write | What happens without the guard |
| --- | --- |
| `state:"stuck"` on a node with nothing pinned | The renderer emits no rule at all (`render/css.go` compiles stuck CSS only under a stuck host). Stored, saved, published, never painted. `sb_set` refuses it and names the node to pin |
| `position: "sticky"` alone | Half-works. Measured in Chromium by the platform: a pinned section with no `z-index` is painted OVER by any `position: relative` element in a later section the moment it scrolls past. `sb_set` seeds `top: 0px` and `zIndex: 10` with it, exactly as the inspector does, and never over an answer you gave |
| A sticky node under an ancestor that clips | Sticky resolves against its nearest **scrolling** ancestor, so `overflow: hidden\|auto\|scroll\|clip\|overlay` above it becomes that ancestor and the node pins inside a box that never scrolls. `sb_set` warns naming the ancestor — in the dry run too — and `sb_review` reports it as `sticky_blocked` |

A **descendant** styles itself through the host: the rule compiles to `#host.wb-stuck #self`,
so a pinned header can shrink its logo and hide its tagline without either child knowing what
pinned it. Pin the section, then write `stuck` on the children.

```
sb_set hd_1 style base:true { position: "sticky" }      # seeds top:0px, zIndex:10
sb_set hd_1 style base:true state:"stuck" { boxShadow: "0 2px 8px #0002" }
sb_set logo style base:true state:"stuck" { height: "24px" }
sb_set tag  config      state:"stuck" { hidden: true }   # the ONE config key a state translates
```

`hidden` is the only config key the stuck state turns into a declaration (`display: none`),
and only `true`: `false` would need `display: revert`, which rolls past the element's own CSS
to the UA default. To stop hiding something, remove the override. `fixed` counts as pinned
too — "the moment the page has scrolled past where it would have been" is the same design —
but it is not seeded, because it arrives as a deliberate placement. `config.stuckAfter` (px of
page scroll, per breakpoint) overrides when the island decides the element is stuck — it is
the closest thing here to "restyle after N pixels of scroll", and `sb_set` refuses it on a
node that cannot pin, and refuses a value no scroll position can satisfy, because the
renderer emits the threshold for neither and falls back to the automatic answer without
saying so.

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
| `default_seed_copy` | A seeded satellite still carrying the PLATFORM's own English copy — a repeater's empty state saying "No products yet" in `#171717` ink. Only ever visible when the list is empty, which is why nobody writes it |
| `form_fields_flush` | A `form` / `form-segment` / `form-step-nav` stacking its fields with no `gap`, so each label reads as belonging to the control above it. Distinct from `config.fieldStackGap`, the smaller label-to-control gap INSIDE one field |
| `dead_menu_link` | A menu entry with no `href` — the renderer reads `specials.menuItems` and never `menuId` |
| `extra_repeater_child` | A repeater holding more than the one child it clones per record; the rest never appear |
| `sticky_blocked` | A pinned node under an ancestor that clips its overflow. Sticky resolves against its nearest SCROLLING ancestor, so that one becomes it and the node pins inside a box that never scrolls. It does not move, and nothing reports it. `key` names the ancestor to fix, not the node |
| `order_goes_nowhere` | A page that totals a cart and carries a form, with nothing on `form:success` to send the shopper anywhere. The order is created and the page stays put, every total now reading 0 because the cart was just emptied — a completed order that looks like a failed one. The form record's own `afterSubmit: "redirect"` does NOT fix it: the API stores that and the platform carries it nowhere |
| `hover_dead` | A hover stored in `states.hover` on an element that keeps its hover somewhere else — a `button` keeps it in the flat `config.stateHover` map its own renderer compiles. Stored, published, painted by nobody. Every site this server built before it learned the difference carries these |
| `stuck_no_host` | A `stuck` override on a node with nothing pinned above it. `render/css.go` emits stuck CSS only under a stuck host, so the styling is stored, saved, published and never painted. Usually a host that was un-pinned later, or an import |

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
| `siteChrome` | Two or more pages and NO global section, so each page carries its own header and footer. Changing the menu is one edit per page, the copies drift, and a visitor meets a slightly different site on every click. Asked of every site, not only a store — it is the one question here that is not about money |
| `cartCount` | Something opens the cart but nothing shows what is in it. `cart-count` is opt-in because `open_cart` is an ACTION any element can carry, so a site built with these tools never gets one: a shopper adds an item, sees a toast fade, and then no evidence anywhere that their basket is not empty |
| `categoryScope` | Two or more product categories and none points at a page of its own, so `/collections/{slug}` serves one default template for every one — and nothing on it narrows the product feed to the category in the URL. A shopper who picks a category sees the whole catalogue. The blog twin auto-scopes by slug; this one does not |

Each gap carries `draft: true` when the page EXISTS but is unpublished, because "publish the
one you made" and "create one" are different jobs. Ordered most-blocking first.

Four extra GETs pay for this (pages, payment-gateways, shipping-methods, global-sections) and
none of them can fail the review: a fetch that fails leaves that rule **silent** rather than
reporting a gap the store may not have. A warning that fires on a correct store is one the
reader learns to ignore.

## `sb_media_list` / `sb_media_upload`

**It can also SEARCH for one.** `query` returns real photographs, each with the description its
photographer wrote — "Cute child wearing a black t-shirt and hat standing near a doorway" — and
`pick: <id>` uploads the one you chose into this site's library. It never uploads an unread
result: rule 7 records what a keyword glued into a URL returns (`loremflickr` answered
"kids,clothing" with a cat statue), and the fault was never stock photography but that nobody
looked. `orientation` asks the search for the SHAPE, which is far cheaper than cropping
afterwards.

**`pick` also takes SEVERAL — `pick: [8633662, 35993723, …]` — and that is how a site this
server just built gets its pictures.** A new site's library is empty, so every picture slot in
every layout pattern is a sentence until somebody fills it; one search answers with eight
photographs and `sb_gallery` wants six of them, which at one pick per call was twelve round
trips for one band. Taking several does not weaken rule 7: what that rule protects is that
somebody LOOKED, and reading eight descriptions and choosing six is the same act of choosing as
reading eight and choosing one. No `pick` still uploads nothing.

It is **not atomic and does not pretend to be** — each photo is its own upload, so the answer
carries `uploaded` and, when anything went wrong, `failed` with the pick and the reason. A
partial *pick* is different and is refused whole: naming an id the search did not return uploads
nothing at all, because delivering half a set leaves the caller to work out which slots they can
still fill. One pick keeps the single-photo answer it has always had.

**The provider key is the PLATFORM'S, not this server's.** The search is
`GET /api/sites/{siteId}/images/search`, a rotated pool of Pexels keys behind the credential this
server already holds — so no second secret in every install, no quota shared with another
product, and one place for an operator to add a key (`PEXELS_API_KEYS` on the server). Pexels
because its licence is free for commercial use with attribution appreciated rather than required,
so a storefront can carry a photograph without printing a credit line nobody asked for; the
photographer comes back anyway.

An operator turns it on by adding a key in the admin Settings area (**Pexels keys**) or by
setting `PEXELS_API_KEYS` on the server. Several keys are walked round-robin — that provider
rate-limits per key, so each one added is another share of the limit — and a key it refuses sits
out for five minutes and comes back.

**When the platform cannot search, this client does not try to.** There is no fallback provider
here on purpose: one would put the very key the platform exists to hold back into every install.
The answer is an instruction instead — find a photograph by your own means and pass its URL, and
the platform fetches it server-side exactly as it would have.

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

## `sb_import`

Read a page from any public URL and add its structure and content to the **open page**, as
real elements dressed in **this page's** tokens.

| Arg | Type | Notes |
| --- | --- | --- |
| `url` | string | The page to read |
| `site_id` | string? | Falls back to `SB_SITE` |
| `max_sections` | number? | Default 24 |
| `max_images` | number? | Default 24 — every image is an upload |
| `max_nodes` | number? | Default 300 — the bound on the whole import |
| `upload_images` | boolean? | Copy images into this site's media library, default **true** |
| `dry_run` | boolean? | Defaults to **true** — returns what was found |

**Layout is kept where the source actually declared one.** A container that lays its
children out — `display:flex` or `grid` — with two or more of them becomes a real row, and
the row carries a **mobile stack** because nothing catches a too-narrow column for you: the
columns shrink, no box overflows, and `measure` stays silent while a photo becomes a sliver.
A `<div>` that merely wraps is flattened, because it is not a design decision. A row is
capped at **12 columns** — past that the container is the page's own content column and the
browser is wrapping it, not arranging things side by side — and a CSS grid always arrives
wrapping, since `flexWrap` reads `nowrap` on one only because the property does not apply.

**The source's own header and footer never come over**, and "page-level" is the spec's
question rather than a depth one: a `<header>`/`<footer>` belongs to its nearest sectioning
ancestor, so one with none above it is the page's however deeply wrapped. A footer is also
recognised by a class or id starting with `footer` — plenty of real sites mark it that way and
not with the tag — but a header is not, because `header` in a class name is as often a hero.
Anything the page marks `aria-hidden="true"` is skipped: that is the author's own mark for
decoration and for duplicates.

**An `<svg>` becomes an `icon` only when this platform has one by that name.** The name is read
the way the page writes it — a `<use href="#ri-search-line">`, an `aria-label`, a `<title>`, or
an icon set's own class (`ri-`, `fa-`, `lucide-`, `bi-`) — normalised, and LOOKED UP against the
3,227 RemixIcon names the platform ships. Anything that does not land is skipped, because a
wrong icon is worse than none: "Acme Store" resolving to a shop glyph where a wordmark was is
indistinguishable from a right answer. Its colour is never set, so an imported icon keeps
following the theme.

**Consecutive `<details>` become ONE accordion**, each `<summary>` its item's label — and every
one is opened before anything is measured, since a collapsed `<details>` measures as zero and
an FAQ would otherwise arrive as questions with no answers.

**A code block is taken whole.** Every syntax highlighter wraps each token in its own
`<span>`, so walking into one turns a twenty-line config into forty separate text blocks.
Whitespace collapses like any other text: this platform has no code element to preserve it
in, so the honest result is one paragraph you can restyle.

**A pinned section stays pinned.** It is the one thing the importer reads off computed style
rather than off the tree, because it is a layout DECISION — a sticky category bar or a fixed
buy bar is there to stay in view, and a copy that scrolls away is not the same section. It
arrives with the offset and the layer order alongside `position`, the same three keys
`sb_set` seeds, so it does not land underneath the section after it. `absolute` and
`relative` are deliberately not carried: they describe where a box sits inside a layout this
import is not copying.

**A translation, not a clone, and that is the whole design.** The platform HAS an escape
hatch that would clone a page — `custom-code` embeds raw markup verbatim — and reaching for
it produces a Store Builder page no inspector can edit, with no responsive cascade, bound to
nothing, carrying somebody else's CSS and scripts. Visually closest, structurally a dead end.

So six kinds of thing cross the boundary — section, heading, text, image, button, list — and
each arrives as the element that renders it. What is NOT copied: the source's colours,
fonts, spacing and layout.

**The tokens come off the page you have open**, which is rule 0 of the design skill done
literally: the first heading's ink and weight, the first body line's colour and size, the
first NON-transparent button's fill and radius (a transparent one is a nav link, and taking
its "fill" would give every imported button none), the first section's padding and the first
block's max-width. An empty target page yields no tokens and every element falls back to its
own defaults — inventing a palette for it is the invention rule 0 exists to prevent.

**The PLATFORM fetches the image when it can.** `sb_media_upload` and every image an import
copies now ask `POST /api/media/{siteId}/from-url` first: the bytes make one hop instead of
two, and the content type is decided by the origin's own answer rather than reconstructed here.
A deployment without that route falls through to downloading the file and posting it multipart,
unchanged. A REFUSED ADDRESS IS TERMINAL — the platform will not fetch anything off the public
internet (loopback, private ranges, the cloud metadata endpoint), and this server will not
fetch it on the platform's behalf either, because that would walk around the check rather than
satisfy it.

**Images are copied, not hotlinked.** Each source is uploaded into this site's media library
and the node points at the copy; a source whose upload fails keeps its original URL, because
a visible image beats an empty frame. Pass `upload_images: false` to skip.

**What arrives lands INSIDE the middle band** — before the first global footer, after the
header. Appending to ROOT is the obvious thing and it breaks trap 3 on every page that has a
global footer: the platform refuses the whole save, and the caller is told about a band rule
they did not knowingly break.

A page that builds itself with scripts after load, or one behind a login, reads as thin or
empty — the result says what was skipped and why.

## `sb_import_site`

Read a **whole site** from one URL and give each page it finds its own **draft page** here.
`sb_import` reads one page into the page you have open; this one finds out what the pages
ARE, creates one for each, and fills it.

| Arg | Type | Notes |
| --- | --- | --- |
| `url` | string | Any page of the site |
| `site_id` | string? | Falls back to `SB_SITE` |
| `max_pages` | number? | Default 12 |
| `depth` | number? | No sitemap: how far to follow links, default 1 |
| `include` | string[]? | Path substrings to keep — **outranks** the plumbing filter |
| `exclude` | string[]? | Path substrings to drop |
| `max_images` | number? | Default 24, across the **whole** import |
| `max_nodes` | number? | Per page, default 300 |
| `upload_images` | boolean? | Default **true** |
| `homepage` | boolean? | The entry URL lands on this site's own home page, default **true** |
| `dry_run` | boolean? | Defaults to **true** — returns the page list and creates nothing |

**One page per page.** A URL is folded onto the address the page itself declares in
`<link rel="canonical">`; a translation is folded onto its counterpart, but only when both are
found, so a site that serves everything under one locale keeps all of it; `/blog/page/2` is
dropped, since this platform renders its own pagination; and the site's `robots.txt` is
honoured, longest match winning, except for the entry URL the caller named.

**The publisher's own list first, a crawl second.** `robots.txt` is read for a `Sitemap:`
line before `/sitemap.xml` is guessed, because plenty of real sitemaps are somewhere else —
a shop platform names `/sitemap_products_1.xml`, a CMS a dated path. A sitemap is one fetch,
no browser, and it lists pages nothing links to. Only when there is none (or it lists a
single page, which is what a half-configured generator emits) does the link crawl run, one
browser navigation per page, bounded by `depth` and by the page budget. There is no knob to
force the crawl: a caller who wants fewer pages than the sitemap offers wants `include` or
`max_pages`, not a slower way to find the same list.

**Order is part of the answer.** A sitemap can list five thousand URLs and the cap takes a
dozen; taking the first dozen in file order gives a site made of whatever the generator
emitted first, which on a shop is twelve product pages and no home page. Shallowest first —
the root, then `/about`, then `/blog/a-post` — is the site's own outline.

**Repeated prefixes are reported, because they are not pages here.** Forty URLs under
`/products/` are ONE bound template plus a catalogue on this platform: `/products/{slug}`
resolves to the published page of type `product`. Imported as static pages they produce a
shop where every price is a literal and nothing is buyable. The result names the prefix and
its count before anything is created; `exclude` leaves them out.

**A shared header carries the menu.** The pages that were created become one global `header`
section — edit it once and every page changes — built from THOSE pages and never from the
source's own nav, which points at the site this was copied from and half of it at pages the cap
left out. Each page then carries a reference to it, first among ROOT's children, which is the
shape the platform's own decompose writes. Skipped when the site already has a header, because
a second one is two headers rather than a menu; `nav: false` turns it off. Under two pages it
does not fire — a menu to one page is a link to itself.

**Links between the imported pages point HERE, not back at the source.** A captured link keeps
the source's absolute URL, so before this a site arrived with twelve pages and not one way to
reach any of them — every click left for the site it was copied from. Only targets that were
actually imported are rewritten: a same-origin link the page cap left out keeps its original
URL and is counted under `links.still_off_site`, because an off-site link that works beats a
local one that 404s, and the count is what says to raise `max_pages`.

**A form is reported, not rebuilt.** Its fields are a `mapTo` vocabulary the server validates,
and `sb_store action:"form"` owns that — so `forms_found` names what the page carried and the
note names the tool. A contact page that silently arrives with no way to contact anybody is
the failure worth avoiding.

**The preview says where each page will LAND**, not just what was found: which one merges
into this site's existing home page, and which slug is already taken (that page is skipped,
because the platform renames a collision and answers 200). Reading this site's own pages
needs a credential and asking what is on a stranger's website does not, so a dry run that
cannot read the site reports `landing_unknown` rather than guessing.

**One page failing does not end the run.** A site import cannot be atomic — each page is its
own create and its own save — so the honest shape is per-page outcomes: `built` lists what
landed, `failed` lists each URL with the reason. A page whose slug is already taken is left
alone rather than created, because the platform RENAMES a colliding slug and answers 200,
which on a second run would silently double the site.

**The tokens come off this site, once.** `sb_import` reads them off the open page; here most
targets do not exist yet and the rest are blank, so reading per page would give the first
page element defaults and every later page the defaults of the blank page before it. The
open page if there is one, this site's home page otherwise.

**Images are uploaded once for the whole import.** A logo, a payment strip and a footer badge
appear on every page of a real site; uploading each per page would fill the merchant's
library with twelve copies of each.

**Nothing is published, and three things the import cannot do for you.** The source's header
and footer are skipped on purpose — this site has its own as globals, and a second menu
pointing at somebody else's site is worse than none. No menu links the new pages together.
And nothing has been seen at 390px. `sb_look` each page at the three widths, then
`sb_publish`.

### The entrance animation, and its four silent misses

`config.animation` is offered by **73 of the 111 element types** and was describable by
nothing. Every way of getting it wrong renders NOTHING — no keyframes, no rule, no error —
through save, publish and render. `sb_traits_for` now carries the answer on every element that
offers the control, and `sb_set` warns on each miss:

- **It is an OBJECT, not the string the control's name invites:**
  `{ active: true, type, easing, delay, duration }`. The renderer reads it as
  `map[string]interface{}`, so a bare `"fade_in"` is the zero value.
- **`active: true` is REQUIRED, and a stored `type` is deliberately not consent.** The panel
  keeps `type` when the switch goes off so switching back restores the choice — treating a
  stored type as consent would animate a node the author had explicitly turned off.
- **The type is UNDERSCORED** — `fade_in`, `slide_up`, `slide_down`, `zoom_in`. `fade-in` is
  what every other web tool spells it and the platform's own table comments on the trap.
- **It is BASE-ONLY**, and this one is ROUTED rather than warned about: `render/css.go` emits
  the rule into the base lane because the config object is read with no responsive merge, so
  `sb_set` writes it to base. It reached the platform's migration ledger late — it is not a key
  any element seeds — which meant a per-breakpoint write landed where nothing looks.

`easing` is the mild case and is reported differently: an unrecognised value falls back to
`ease`, so the animation still runs, wearing a curve nobody chose. The renderer emits its own
`prefers-reduced-motion` rule per animated node, so you do not have to.

**What has no answer at all is reveal-on-scroll.** These are ENTRANCE animations, fired at first
paint; the only scroll hooks in the runtime are the pinned element's `wb-stuck` class and
`popup`'s scroll trigger. A section that fades in as the visitor reaches it cannot be authored
here, by any tool, because the platform has nowhere to put it.

## `sb_theme`

**The one design decision that reaches every page.** A style preset compiles to a class rule
*beneath* a node's own values, so every node that has not been given a literal follows the
site's colour tokens and text styles. Changing one token here is the cheapest way to restyle a
whole site — and it was the one lever the tools pushed you away from: `sb_node_read` reported
what a node paints, and nothing could write the layer underneath it.

Call it with nothing to READ what the site actually has, keyed the way a preset resolves —
by token id (`heading`, `primary`) and by text-style slug. A site that has never saved a theme
answers with the STARTER and says so, because handing back the starter's `#111827` for a site
whose heading token is rose is a confident wrong colour.

`colors` and `text_styles` PATCH the saved document: **what you do not name is kept**. That is
not politeness, it is the only safe way to spell a patch on this endpoint. The write is a
WHOLE-DOCUMENT REPLACE and there is no theme history on either surface — no versions, no
restore — so a body missing `colors` used to store happily and take the palette, the text
styles and all 58 presets with it. (The platform now refuses a document that is not
recognisably a theme at all, which closes the worst of it and does not make a partial write
safe.) There is deliberately no argument here that can express "drop everything else".

A token id or style slug the site does not have is **refused**, with the real ones named: every
preset resolves through those ids, so an invented one would be stored and read by nothing.

Republish afterwards. A theme is compiled into each page's stylesheet, so a saved page keeps
the old palette until it is published again.

## `sb_store`

Run a store flow that must happen in a **fixed order**.

| Arg | Type | Notes |
| --- | --- | --- |
| `action` | `"checkout"` \| `"form"` | The flow to run |
| `site_id` | string? | Falls back to `SB_SITE` |
| `language` | `"vi"` \| `"en"`? | `checkout` — copy language, default `vi` |
| `page_name` | string? | `checkout` — overrides the editor's own page name |
| `headline` | string? | `checkout` — overrides the page's headline |
| `template` | enum? | `form` — which of the platform's 17 templates to seed |
| `name` | string? | `form` — the form's name in the merchant's list |
| `dry_run` | boolean? | Defaults to **true** |

### `action: "form"`

Seeds any of the platform's OWN form templates: `login`, `register`, `forgot`, `reset`,
`verify`, `contact`, `subscribe`, `booking`, `feedback`, `event`, `quote`, `apply`,
`address`, `consult`, `stay`, `order`, `checkout`.

The editor ships all seventeen and this server carried ONE, so a store built with these
tools could have a checkout and nothing else — no contact form, no newsletter, and none of
the five auth forms, even though `forms.Type` declares them and `customerauth` serves them.
Hand-authoring one means writing a field document whose `mapTo` values are a vocabulary the
server validates, which is exactly the guess this catalog exists to remove.

Three writes, the same ones the checkout makes minus the page: create, **PUT the form back
WHOLE** (name and type must ride along or `Normalize()` renames it "Form" and turns it
`custom`, after which the document is refused), then save the field document with fresh node
ids. If a later write fails the form is deleted again — a form nobody can see is the orphan
the obvious retry duplicates.

It makes **no page**. Where a login form belongs is a design decision, and `/account` is the
one page that is not a free choice: `membersOnlyRedirectTarget` sends every gated visitor
there. Place the form with `sb_add` and point `specials.formId` at the id this returns.

### `action: "checkout"`

`sb_review` names ten readiness gaps. Seven are now one call each — a delivery option, a
gateway, a product, a page of the right type — because the call sheet says what those calls
take. The checkout is the one that is not, because it is four writes whose order is the
whole contract, written down only in `editor/src/features/pages/checkoutPage.ts`:

1. `POST /forms` — create the order form.
2. `PUT /forms/{id}` — put it back **whole**, with the cart as its source. Name and type
   ride along, or `Normalize()` renames it "Form" and turns it `custom`, after which step 3
   is refused as *"mappings do not fit this form type"*.
3. `PUT /forms/{id}/document` — save the field document with this store's **real** payment
   methods and delivery options. The option string **is** the value: the server matches a
   payment answer against the ids of the gateways the store has switched on, and resolves a
   delivery answer to a fee by the method's name. A template's hand-typed label collects an
   answer worth nothing.
4. `POST /pages` of TYPE `checkout`, then `POST /publish` — `/checkout` resolves to the
   **published** page of the type, so a draft is the same as no page.

Miss any one and the Checkout button every cart drawer ships with answers 404.

**Dry run** (the default) returns the ordered `plan`, the `payment_methods` and
`delivery_options` the form will carry, and a warning when either list is empty — an empty
delivery select stops the order dead.

**Executing** returns `form_id`, `page_id`, `slug` and `published`. Two assertions ride
along, because both failures are silent:

- **Publish skips a page it has nothing to publish for and still answers 200**
  (`service.go:650`, a bare `continue`), so the page coming back is the only proof. Without
  it a checkout that 404s reports success.
- **If any step after the create fails the form is deleted again.** A form no page binds
  shows in the merchant's list as an empty "Form", and the obvious retry makes a second one.
  The editor shipped that bug first; its recovery is copied rather than reinvented.

Both documents are **generated** from the editor's own `formTemplates.ts` and
`checkoutPageSeed.ts` by `npm run codegen`, not hand-copied — a copy of the platform's seed
rots the next time the platform edits it, and the first person to notice is a shopper.

## `sb_undo`

Put back what a `PUT` through `sb_api_call` replaced.

| Arg | Type | Notes |
| --- | --- | --- |
| `index` | number? | 1 is the most recent write. Omit to **list** what is undoable |
| `dry_run` | boolean? | Defaults to **true** |

The platform has no page history, no versions and no restore — the only `restore` in
`/api/v1` is `media/{id}/restore`. So every whole-document replace this server can make is
one-way: `PUT /settings` is not a patch and a partial body erases the store's configuration;
`PUT .../forms/{id}/document` replaces a checkout's fields; `PUT .../pages/{id}/source`
replaces a page. A merchant clicking through the editor has undo. An agent had nothing, and
one call does more damage.

**A PUT therefore reads before it writes.** A PUT is a replace by definition, so what it is
about to destroy is exactly what the matching GET returns — one extra round trip on a write,
never on a read and never on a dry run. It is silent on failure: an undo that could not be
prepared must not stop the write the caller asked for, and a PUT that creates has nothing to
read.

Restoring goes back through the **same operation**, carrying only the fields that
operation's handler decodes — not the whole GET response, which holds identity and derived
columns the platform owns. Envelopes are not uniform, so those field names are looked for at
the top level first and inside a single-key envelope only if none are there:
`{ document: … }` **is** the body `PUT .../document` wants, while `{ source: … }` holds
`document` and `schemaVersion` one level down. An envelope it does not recognise records
nothing rather than guessing.

An entry is **dropped once it is put back**, so undo is a step backwards rather than a loop
between two states.

**In process, not on disk**, and capped at 20. This server only ever holds the document and
the screenshots; a snapshot directory is a new kind of thing to own, with a retention
question and a privacy question attached. The window that matters is the one where undo is
reached for — the agent discovers the damage in the session that caused it.
