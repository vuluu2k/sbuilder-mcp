# Changelog

**English** · [Tiếng Việt](./CHANGELOG.vi.md)

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.22.0] - 2026-09-10

### Added
- sb_import_site now builds one shared global `header` section from the pages it created and gives every page a reference to it, so editing the menu once changes it on every page instead of leaving each page to carry its own copy.
- sb_import_site takes a `nav` argument (default true) to skip the shared header, and reports what happened under `shared_header` in its result.

## [0.21.1] - 2026-09-10

### Fixed
- sb_import_site now keeps the fragment (e.g. `#community`) when it rewrites a same-page section link to point at the imported page, instead of dropping it and sending every such link to the top of the page.

## [0.21.0] - 2026-09-10

### Added
- sb_import and sb_import_site now detect a `<form>` on the source page and report it as `forms_found` (field count and labels) instead of silently dropping it, pointing the caller at `sb_store action:"form"` to rebuild it with a valid field vocabulary.

### Fixed
- sb_import_site now rewrites links between the pages it imports so the new site's menu points at itself instead of back at the source it was copied from, and reports any same-origin links left pointing off-site under `links.still_off_site` so the caller knows to raise `max_pages`.

## [0.20.0] - 2026-09-10

### Added
- sb_review now reports a `siteChrome` gap when a site has two or more pages and no global section, so each page is carrying its own header and footer with no way to change the menu in one place.
- sb_review now reports a `cartCount` gap when something opens the cart but no `cart-count` element shows what is in it, since a shopper who adds an item otherwise sees a toast fade with no lasting sign their basket is not empty.

## [0.19.0] - 2026-09-10

### Added
- sb_import and sb_import_site can now turn a source page's `<svg>` into an `icon` element, looking up the name the page itself uses (a sprite reference, an `aria-label`, a `<title>`, an icon-set class) against the platform's own 3,227-icon vocabulary and skipping it rather than guessing when no name matches.
- sb_import and sb_import_site can now turn one or more consecutive `<details>` elements into a single `accordion`, with each `<details>` becoming one `accordion-content` item labeled from its `<summary>`.

### Fixed
- sb_import and sb_import_site no longer miss every `<svg>` icon on a page: `tagName` reports `"svg"` in lowercase, which never matched the capture's ignore list, and reading an SVG element's `class` attribute through `.className` returned the literal string `"[object SVGAnimatedString]"` instead of the class list.
- sb_import and sb_import_site now expand a collapsed `<details>` before measuring it, so an FAQ section no longer imports as a list of questions with no answers.

### Internal
- The generated catalog gained an icon-name table (`icons.generated.ts`, 3,227 RemixIcon ids read from the platform's own manifest) that the importer's icon lookup is checked against.

## [0.18.0] - 2026-09-10

### Added
- sb_import and sb_import_site can now bring over a `<video>` element, an embedded YouTube, Vimeo, Google Map or SoundCloud player, and an `<hr>` divider, instead of silently dropping every iframe as unsupported.

### Fixed
- sb_import and sb_import_site no longer capture a source site's own header or footer navigation when it sits inside a wrapper element rather than directly under `<body>`, and no longer mistake a footer marked only by a CSS class (with no `<footer>` tag) for page content.
- sb_import_site no longer imports the same page twice under two different slugs when the source declares a `<link rel="canonical">` pointing at a URL already in the plan, or when a sitemap or crawl lists per-language copies of the same page (`/about`, `/en/about`, `/vi/about`); the entry page's own language is kept.
- sb_import_site no longer imports pagination pages such as `/blog/page/2` as separate pages.
- sb_import_site now honors the site's robots.txt Disallow rules while crawling or reading a sitemap, except for the URL the caller explicitly named.
- sb_import and sb_import_site no longer duplicate a nested list's items: a `<ul>` inside an `<li>` was previously captured once inside its parent item's text and again as its own list item.
- sb_import and sb_import_site now skip any element marked `aria-hidden="true"`, so carousel clones and hidden mobile-menu copies no longer come through as duplicated content.

## [0.17.1] - 2026-09-10

### Fixed
- sb_add and sb_import no longer store a nested node's children twice: a patch batch that gets applied more than once (as every write already is, to validate it before it lands) mutated itself on the first pass by carrying an added node by reference, so the second pass re-inserted its children into a node that already held them.
- sb_import and sb_import_site now cap a flattened row at 12 columns and treat a grid container as wrapping rather than single-line, so a page whose content wrapper is a CSS grid (a documentation site, for example) no longer imports as one row of hundreds of slivered columns.
- sb_import and sb_import_site now capture a `<pre>`/`<code>` block as one node instead of one node per syntax-highlighting `<span>`, so a code sample no longer arrives broken into dozens of single-token fragments.

## [0.17.0] - 2026-09-10

### Added
- sb_import_site reads a whole site from one URL — the publisher's own sitemap first, a bounded link crawl only when there is none — and creates and fills a draft page here for every page it finds, replacing the by-hand loop of one sb_import call per page.
- sb_import_site reports every repeated path prefix (such as `/products/{slug}`) as one bound template before creating anything, since importing those URLs as static pages would produce a catalogue where nothing is buyable.
- sb_import_site previews where each page will land, including which URL merges into the site's existing home page and which slug is already taken, and skips a page whose slug collides instead of letting the platform silently rename it.

### Fixed
- sb_import and sb_import_site now insert imported content into the middle band, before the first global footer, instead of appending it to the end of the page, since appending broke the platform's band-order rule on every page carrying a global footer.

## [0.16.1] - 2026-09-10

### Fixed
- sb_add, sb_set, sb_move, sb_remove, sb_duplicate, sb_event and sb_bind now judge a write against a throwaway copy of the page before applying it, so a save the platform refuses is never applied to the draft or broadcast to a live session; previously the refused node stayed in the document and every later command was validated against a tree the caller never asked for, repeating the same complaint about an id it had never typed. A write is still refused only for problems it introduces, not for damage the page already had when the session opened it.
- sb_import_page now builds its whole run of sections on a copy and commits them in one save, so a refusal partway through no longer leaves a page half imported with no way to tell which sections landed.

## [0.16.0] - 2026-09-10

### Added
- sb_traits_for now returns a `translatable` block naming which of an element's specials a translation may safely rewrite, and which of its own specials must never be translated, since translating a non-content special (a lucide icon `name`, a `src` URL, a `filterSource` registry id) does not degrade the page, it breaks the render.
- sb_api_find and sb_api_call now attach a `translation_fields` call sheet to every `/translations` operation, listing the translatable columns for each entity type and pointing to sb_traits_for for the per-element `node` vocabulary, since every translations route was already reachable with no way to know which fields were safe to send.
- sb_set now warns once per node type when a field-skin config key (`payCardBg`, `choice*`, `slot*`, `file*`, and the rest of the 55-key vocabulary) is written on a form node whose renderer does not read it, naming the field node that actually renders it, since such a write is stored, saved and published but rendered nowhere.

### Internal
- The generated catalog gained a translations table (`translations.generated.ts`, 141 translatable specials across 58 elements, 156 keys classified as never-translate, 12 entity types with their columns) and a field-skin table (`fieldskin.generated.ts`), both cross-checked at codegen time against the platform's own registries rather than hand-kept.

## [0.15.0] - 2026-09-10

### Added
- sb_set now writes a config key that a page's `html.go` renderer reads only at base (13 keys, including the repeater data axis `datasetSource`, `kind`, `collectionId`, `collectionType`) to base instead of the current breakpoint, and reports the move as `base_only`, since a per-breakpoint write to one of these keys updated the editor canvas and silently vanished on publish.
- sb_traits_for now returns `config_values` for the config keys whose platform renderer treats an unrecognized value as a silent alias rather than an error, listing the accepted values and aliases (`category` as a working spelling of `collection`, among them), since a repeater set to a plausible-sounding word like "bestseller" previously published and rendered the whole catalogue under the wrong heading with no error anywhere.
- sb_set now warns once per config key/value pair when a write sets one of these config values to something the renderer does not recognize.
- sb_node_read now returns a `preset` block naming the theme preset a node paints through, its resolved colors and other values with every var() chain flattened, and which keys the node has already overridden, closing nine element types (including icon, button, heading, text, image) whose default look now lives in a site theme preset rather than the node's own style, and which previously read back as no color at all on a page visibly painting one.
- sb_set now warns once per theme preset when a plain style write is about to permanently detach a node from that preset, since the node's own value then outranks the preset on every future palette change.
- sb_add now returns an `inert` note when a subtree includes a locale-switcher (which paints a fabricated locale chip and switches nothing below two configured site locales) or a breadcrumb (whose root "Home" label is authorable and defaults to English), since both elements render convincingly while wired to nothing, in a way neither sb_review nor sb_look can detect after the fact.
- sb_page_create now seeds a store page type (product, category, search, blog, post, complete) with the same document the platform's editor gives a merchant — a product page arrives with its whole buy box, including the `add_to_cart` binding — instead of an empty page; pass `seed:false` for a blank page, and `locale`/`headline` to pick the completion page's thank-you line.
- npm run codegen and npm run codegen:check now warn (without failing) when a route is annotated in the platform's server code but absent from swagger.json, naming the missing routes, since this gap does not get fixed by regenerating anything in this repo.

### Fixed
- The element and operation catalog is refreshed to the platform's `8e40bbab`: five relation-slot operations (curated-shelf create/update/delete and both picks endpoints) that were reachable but shared one annotation with the list endpoint are now separately documented, and the AI chat assistant's whole configuration surface (`GET /api/chat-providers`, `GET/PUT/DELETE /api/sites/{siteId}/chat-settings`) is documented for the first time; the catalog now covers 495 operations, 166 of 216 write operations with a request body shape.

### Internal
- The generated catalog gained a store-page-seed table (`storepages.generated.ts`) and a theme-preset table (`theme.generated.ts`), both produced by calling the platform's own seed and theme-preset builders rather than by copying their output, so the next platform change to either reaches this server's next codegen run automatically.

## [0.14.1] - 2026-09-09

### Added
- Element catalog refreshed to 111 elements, adding `rating-stars` (a five-star score drawn as icons) and `chat-widget` (an AI assistant a merchant configures with their own key), both reachable through sb_catalog_search, sb_traits_for and sb_add with no code changes here.

### Fixed
- npm run codegen:check now also refuses a web_builder checkout whose HEAD is not contained by any remote branch, since a detached worktree pointed at a local, unpushed commit had passed every prior check and produced a catalog describing an element no deployment actually had; a repo with no remotes says nothing rather than refusing, since there is nothing to measure containment against.

## [0.14.0] - 2026-09-09

### Added
- sb_review now reports `categoryScope` when a store has more than one product category and none of them is linked to a page of its own, since `/collections/{slug}` then falls back to the category type's default template for every category, and nothing on that shared template narrows the product feed to the category in the URL, so a shopper sees the whole catalogue (or another category's products) no matter which one they open; the finding names the fix — a page per category with its repeater set to `{ "collectionType": "collection", "collectionId": "<category id>" }`, linked with `sb_api_call post:/api/sites/{siteId}/page-links/bulk`.

## [0.13.1] - 2026-09-09

### Fixed
- sb_store's checkout build now seeds a `form:success` event that sends the shopper to `/checkout/complete`, since the form record's own `settings.afterSubmit.action = "redirect"` is stored by the API but carried nowhere by the platform, leaving a completed order on the checkout page with every cart total reading 0.
- sb_review now reports `order_goes_nowhere` for a checkout-shaped page (a form alongside a cart total) whose form has no navigating `form:success` event, naming the sb_event call that fixes it.

## [0.13.0] - 2026-09-09

### Added
- sb_set now accepts `specials.hoverHostDepth` on a `state:"parentHover"` write, letting a rule hang off any ancestor box (1-based, nearest-first) instead of always the node's immediate parent, and reports which box it actually hung off, the wider ancestors on offer, and whether a depth past the end of the chain clamped to the outermost one.
- Element catalog refreshed to 109 elements, adding `cart-count` and a `hoverSwapImage` option on `product-image-feature` (shows the next gallery photo on pointer-hover, off by default).

## [0.12.0] - 2026-09-09

### Added
- npm run codegen:check now also refuses a checkout whose HEAD carries commits touching the directories it reads (schema/src, editor/src, server/render, server/docs) that its upstream branch does not have, naming the commits; an uncommitted-only check had already been fooled once, by a feature committed locally and never pushed, so the tree read clean while the catalog it fed was ahead of every deployed platform. A detached worktree checked out at origin/main has no upstream and is therefore exempt, which is the shape the check itself recommends; `--dirty` still overrides it.

### Fixed
- The generated request-shape catalog now covers three write operations its handler parser was missing or mis-attributing: `roles/{roleId}` (a case arm listing several HTTP methods together), `products/{productId}/categories` (a dispatcher that routes by a literal path segment rather than by method), and `sites/{siteId}/org` (a doc comment block shared by two adjacent handlers declared in the opposite order, now attributed by the name it opens with). 162 of 276 write operations now carry a shape, up from 157, so sb_api_call and sb_undo can act on all three without guessing a body.

## [0.11.3] - 2026-09-09

### Fixed
- sb_set now says its hover-routing note once per element type per process instead of once per node, since repairing every button on a page in one batch returned ten copies of the same 300-character paragraph; a different element type still gets its own note, because it says something different.

## [0.11.2] - 2026-09-09

### Fixed
- sb_set's routing of a hover write to an element's legacy home (a `button`, for instance) now also clears any leftover values in the unread `states.hover` slot in the same call, instead of leaving them behind for `sb_review` to keep reporting as `hover_dead`; the finding's own message previously named `unset` as the way to remove them, which could not reach the legacy home either, so the documented fix was unreachable.

## [0.11.1] - 2026-09-09

### Added
- sb_review now reports `hover_dead` for a node whose element keeps its hover state in a legacy home its own renderer reads instead of the universal `states.hover` slot — a `button`, for instance — naming the sb_set call that moves the values where they will actually paint.
- npm run codegen now refuses to run against a web_builder checkout with uncommitted changes in the directories it reads (schema/src, editor/src, server/render, server/docs), naming the dirty files instead of silently baking a concurrent session's half-finished work into the committed catalog; `--dirty` overrides it for generating against your own in-progress change.

### Fixed
- The generated element catalog is regenerated from a committed ref, removing a `cart-count` element and its satellite owner that had leaked in from another session's uncommitted platform change; the catalog is back to 108 elements.

## [0.11.0] - 2026-09-09

### Added
- sb_set's `state:"hover"` now routes each write to the home its element's own renderer actually reads, since the platform's universal hover compiler deliberately stands aside for twelve element types that declare their own Hover variant; a `button` write now lands in `config.stateHover` (flat, base-only) instead of the unread `states.hover` slot, and the response reports where it went so a caller reading the node back is not surprised.
- sb_set refuses a `state:"parentHover"` write on a node with no box to key off — a satellite, a direct child of the page root, or an orphan — naming the reason instead of storing a rule the platform would never match.
- sb_set refuses `config.revealOnHover` on a node with no such box for the same reason, since the platform emits neither half of the reveal without one and the element would simply stay visible.
- sb_set now translates `hidden: true` under a hover state into `display: none`, and refuses any other config key or a `false` value, matching the same contract already enforced for the `stuck` state.
- sb_set warns when a write targets `product-image-list`'s hover state: its meta promises `states.hover`, but measured on 2026-09-09 nothing in the platform compiles it yet, so the override is stored where it belongs and will start painting once the platform closes the gap.

## [0.10.0] - 2026-09-09

### Added
- sb_set now takes `unset`, an array of key names removed from the same slot a write would target — base, a breakpoint, or either home of a state — giving every finding that names "remove the override" as its fix a tool that can actually perform it. `keys` is now optional when `unset` carries the work, and a pure removal is exempt from the sticky-host guard so it can repair a `stuck_no_host` finding rather than being refused by it.

### Fixed
- sb_review's `stuck_no_host` check now counts the keys inside a stuck state slot instead of only checking whether the slot exists, matching the platform's own `HasStuckOverrides`; an empty slot (the state a repair with `unset` leaves behind) no longer keeps reporting the finding it was used to fix.

## [0.9.2] - 2026-09-09

### Added
- sb_look now reports `stuck_note` once per process when the page pins something (`position: sticky` or `fixed`), explaining that a screenshot cannot show whether the element is actually stuck and pointing at a browser server (Playwright MCP or Chrome DevTools MCP) to scroll and check for the `wb-stuck` class.

### Internal
- docs/tools.md and the sbuilder-site-design skill now document which of the other MCP servers (Figma, Google Stitch, Chrome DevTools, Playwright) answers which question, alongside sb_look, covering six cases a screenshot alone cannot settle: a sticky header actually engaging, a style that "did not apply", a cart drawer's click trigger, a checkout submission, an entity template previewed with a real record, and layout stability (CLS).

## [0.9.1] - 2026-09-09

### Fixed
- sb_set now refuses a `config.stuckAfter` write the renderer would drop on the floor — a negative, non-finite, or empty value, or one set on a node that cannot pin — instead of silently storing, saving, and publishing a threshold the runtime island never reads and quietly falling back to its automatic answer.

## [0.9.0] - 2026-09-08

### Added
- sb_set's `state` argument now accepts `"stuck"`, the look a pinned (`position: sticky` or `fixed`) element wears once the platform's runtime island marks it stuck, refusing the write when neither the node nor any ancestor can pin since the renderer would compile no rule for it and the override would be stored, published and never painted.
- sb_set now seeds `top`/`zIndex` alongside a `position: sticky` write, matching what the platform's own editor seeds, since a pinned header with no z-index is painted over by later content the moment it scrolls past.
- sb_set warns (in both dry_run and the real write) when a sticky node sits inside an ancestor whose overflow clips it, since sticky resolves against the nearest scrolling ancestor and a clipping one silently defeats the pin.
- sb_review reports `stuck_no_host` for a `stuck` state override with no pinned self-or-ancestor, and `sticky_blocked` for a sticky node whose ancestor's overflow defeats it, so a document that reached either state through an import, a template, or a later edit is caught even when sb_set's own write-time checks were bypassed.
- sb_import now carries a source section's `sticky`/`fixed` positioning onto the imported node, including the same offset and layer-order seeds sb_set writes, since a section pinned to stay in view is a layout decision distinct from one that scrolls away.

### Fixed
- sb_media_upload from a `url` no longer fails for every image and video type; the upload was sent with no declared content type, which the platform treats as neither an image nor a video, so it refused a plain PNG with a message that named the wrong cause. The source's own Content-Type header is used when it identifies the file, and the file extension otherwise.
- sb_import no longer drops a link's text when the link wraps markup (such as `<a><span>Docs</span></a>`) whose contents produce nothing importable; it now keeps the link's own words instead of importing nothing for it.

### Internal
- The generated element catalog is refreshed against a current platform checkout: `dataset-block` and `list-dataset` now carry a content tip warning that a dataset node inside a repeater must bind to its own `config.datasetSource`, not the element's default.

## [0.8.0] - 2026-09-08

### Added
- sb_add's `spec` argument now takes `responsive` on any node, seeding per-breakpoint style and config overrides at creation time instead of requiring a follow-up sb_set for every responsive value; it merges over the element's own seeded responsive defaults per namespace, so seeding a mobile style does not drop the element's own mobile config.
- sb_import takes max_nodes (default 300), a single bound on the whole import; it replaces the old per-section cap, which silently became the real limit on a page whose body has one top-level child, and the amount skipped is now reported on a real run too, not only a dry one.
- sb_import now preserves the source's layout: a container that actually lays its children out with flex or grid becomes a real row that stacks at mobile instead of every section flattening into one vertical column.

### Fixed
- sb_import now captures text from any element that holds it, not only `<p>` and `<blockquote>`, since most of the web does not use paragraph tags; a table-layout page or a utility-CSS page previously imported with none of its text at all.
- sb_import's empty-result fallback now retries against the page's `<main>` whenever the sections it found produced no content, instead of only when it found no candidate sections in the first place.
- sb_import now keeps an unpainted content link instead of dropping it, capturing it as a flat link-styled button rather than only capturing links that already look like a call to action; a painted button still requires a filled background or a border with actual width, so a Tailwind page's zero-width reset borders are no longer mistaken for one.
- sb_import no longer imports the source page's own page-level header and footer, since the target page already carries its own as shared globals; a `<header>` nested inside a section (a hero) is still kept.

## [0.7.2] - 2026-09-08

### Fixed
- sb_import no longer classifies a short block-level link as a button; it previously stopped at "not inline", so a documentation sidebar's list of navigation links came back as dozens of buttons. A real call to action must now be painted with a fill or a border, and a border only counts when it has width, since a Tailwind-built page sets `border-style: solid; border-width: 0` on every element.
- sb_import's page capture no longer waits a flat 600ms before reading the page; it now reuses sb_look's own settle check, which waits until the page actually stops changing rather than a fixed delay that is too long for a static page and too short for one that builds itself with scripts.

## [0.7.1] - 2026-09-08

### Added
- sb_import takes max_images (default 24), bounding how many images it uploads from the imported page, since every image is a real upload and a page shape like a sponsors wall can carry dozens of them in a single tool call.

### Fixed
- sb_import no longer duplicates content that sits inside a nested section; it previously matched every `<section>` on the page, so an outer band and the bands nested inside it were both captured and the inner content came back twice. Only the innermost matching section is now kept, since the outermost is a candidate too and keeping it would reduce the whole page to one band.

## [0.7.0] - 2026-09-08

### Added
- sb_import reads any public URL and adds its structure and content to the open page as real elements — section, heading, text, image, button, list — dressed in that page's own tokens (ink and weight off the first heading, colour and size off the first body line, fill and radius off the first non-transparent button) instead of embedding the source's raw markup. An image is bounded in both axes rather than only capped in width, since an SVG has no intrinsic pixel size and would otherwise stretch a section into thousands of pixels of empty space; each image is uploaded into the site's own media library, falling back to the original URL on a failed upload, and a failure is reported grouped and counted by reason rather than as a bare count. dry_run (the default) returns what was found before anything is added.
- npm run codegen:check runs the catalog generator against a committed platform ref and writes nothing, exiting 1 and naming every file that would change, so a stale catalog is caught before a tool starts describing an element or operation the platform no longer has.

### Changed
- The element and API catalog is regenerated: adds the bundle-items element and the kind, bundlePricing, bundleValue and bundleItems fields on a product, plus a set of relation-slot operations and a storefront-string levelling command; sb_api_find's token budget ceiling is raised to 3,500 to hold the larger product call sheet.

### Fixed
- sb_look can now photograph a node whose box sits below roughly the first 900px of the page; a clip request previously ran against the viewport alone and failed with Playwright's "Clipped area is either empty or outside the resulting image" for anything further down, and it now captures the full page first so the clip lines up regardless of where the node sits.

## [0.6.0] - 2026-09-08

### Added
- sb_store now takes action:"form" alongside action:"checkout", seeding any of the platform's 17 form templates (contact, subscribe, order, address, consult, booking, stay, feedback, event, quote, apply, and the five auth forms login, register, forgot, verify, reset) with their own field document, instead of the checkout order form being the only one this server could build; it creates the form, PUTs it back whole (a bare create is otherwise silently renamed and turned custom), then saves the template's field document, deleting the form again if either write fails. It makes no page, since where a login form belongs is a design decision — place it with sb_add and point specials.formId at the id returned.

### Fixed
- sb_review no longer reports empty_container on a global section's or app block's reference node, since a page stores its shared header or footer as an empty node stamped globalRef or appBlockRef that the platform composes the master into on read; the fix the finding used to name, adding something inside it, was decomposed away by the very next save.

## [0.5.0] - 2026-09-08

### Added
- sb_review reports default_seed_copy when a satellite's empty state still carries the platform's own English seed text, such as a repeater's empty state saying "No products yet", which previously matched no rule and reviewed clean.
- sb_review reports form_fields_flush when a form, form-segment or form-step-nav stacks its fields with no gap between them, so each label reads as belonging to the control above it.
- The install CLI accepts --site-name, matching the flag the platform's own Agent app install line already appends; it rides in as SB_SITE_NAME alongside the site id, and sb_connect reports it back so a session can display the store's name instead of its id.
- A dry run of the install CLI now reports its own preview outcome and exit code instead of reusing the failure marker and exit code of a real install.
- sb_api_call now falls back {siteId} and {siteID} path parameters to SB_SITE across all 289 operations that name the site, matching the fallback every other tool already applies through siteFor(); an explicit argument still wins.

### Fixed
- sb_set's state parameter now writes to the location the platform's cascade actually reads: node.states[state] at base, node.responsive[breakpoint].states[state] per breakpoint. Previously it wrote to a path nothing reads, and base:true combined with state:"hover" wrote the hover value straight into the plain style, leaving a node permanently styled as if hovered with no hover state at all.
- sb_set now refuses a state argument on specials instead of silently dropping it, since content and identity do not vary by interaction state.
- sb_review now walks into satellite nodes (a repeater's empty state, a variant option's skin, a quantity stepper's buttons, a menu or tab item's skin), so findings inside them are reported instead of being invisible to every check.
- sb_review and sb_set now report a site-wide edit as such: a change to a node inside a global section's interior, or inside a site overlay like the cart drawer, is flagged rather than reading as an ordinary page-local edit.
- sb_look now opens a closed overlay (such as the cart drawer) before measuring it, so a node_id resolving inside one can be photographed at all instead of failing with a clipping error that named neither the overlay nor the reason.
- sb_look's preview_note no longer claims the draft preview renders every repeater's empty state; the draft preview threads real store data just like a published page, and the note now describes the real caveat, which is that an entity template previews with nothing bound.

## [0.4.4] - 2026-09-08

### Added
- sb_api_find's call sheet now returns body_shape for 158 of the platform's 212 write operations, read directly off the Go handler that decodes each body instead of the 46 swagger.json describes, and expands one level of a nested struct (such as a product's variants, where the price actually lives) rather than stopping at the type name.
- sb_store runs the four fixed-order writes a working checkout needs — create an order form, save it back whole with the cart as its source, fill in the store's real payment methods and delivery options, then create and publish a checkout-type page — since building them by hand and missing one step ships a Checkout button that answers 404. dry_run (the default) returns the ordered plan and the payment_methods/delivery_options the form will carry; executing returns form_id, page_id, slug and published.
- sb_undo restores what a PUT made through sb_api_call just replaced, since the platform has no page history, versions or restore for pages, forms or settings; sb_api_call now reads a PUT's target through the matching GET before writing so there is something to put back.

### Fixed
- sb_review's checkoutPage gap now points to sb_store's checkout action instead of a fix that only creates a checkout-type page, which has no order form bound to the cart and takes no orders.
- Redacting a request preview (used by sb_api_call and sb_undo) now matches platform-sourced credential field names such as accessKey, apiKey, clientSecret, hashSecret, webhookSecret, orderToken and signature, not just an exact "secret", since a body sb_undo echoes back comes from the platform's own vocabulary rather than a caller's.

## [0.4.3] - 2026-09-08

### Changed
- sb_look and every other save no longer write an unchanged document back to the platform, since a vision loop looks far more often than it edits and a no-op save still costs a round trip and bumps the revision of every shared master the page carries; a save now returns early when the document's revision matches the one last stored.
- sb_look skips its lazy-image scroll walk on a page with nothing marked loading="lazy", instead of always paying the ~60ms scroll regardless of whether the page has anything below the fold to settle.
- The API catalog is regenerated: 481 operations (up from 456), recovering 25 merchant routes that were previously documented only in route-map comments and unreachable through sb_api_call, including article and blog-category detail routes, a course's sections/lessons/product-links/enrolments, an integration, and site templates.
- A handful of order-receipt trait labels (receipt_number_label, receipt_placed_label, receipt_status_label, receipt_items_label, receipt_total_label, receipt_due_label, receipt_unavailable_text) are shortened, e.g. "Order number label" to "Order number".

## [0.4.2] - 2026-09-08

### Changed
- sb_look now waits for the page to stop changing (a MutationObserver, 250 ms quiet / 2000 ms cap) instead of waiting on a networkidle timeout that a storefront's polling cart island and session checks could never satisfy, cutting a typical shot from ~3.2s to under 1s while still photographing a page that never settles rather than holding the shot forever.

## [0.4.1] - 2026-09-08

### Fixed
- sb_review now reports findings inside the cart drawer and other site overlays, tagged with overlay: true, instead of silently skipping them on the belief that an overlay is not the page's to fix; the review notice explains that an overlay:true finding is fixed the same way but is site-wide, so it only needs fixing once.
- sb_api_call's path_params now matches a parameter name case-insensitively as a fallback, so a call using the common siteId spelling no longer fails against the 8 operations that spell it siteID; an exact match still wins and a genuinely missing parameter is still refused.

## [0.4.0] - 2026-09-08

### Added
- sb_review reports a catalogue gap when a site has no active products, since every repeater on the site renders its empty state and the product template is bound to nothing on a store that otherwise reports ready.
- sb_review reports the same catalogue gap when every active product is priced at zero, since a zero-priced product still renders, adds to the cart and totals nothing.

## [0.3.0] - 2026-09-08

### Added
- sb_event authors a click action on any node (such as open_cart), with an allow-list per element read from the catalog; a purchase action is refused here and pointed at sb_bind instead of being silently accepted and doing nothing.
- sb_bind takes action, so a purchase control can be authored at all: the binding writes the reserved id bind-product-action and stores buy_now as the document's own dynamic_checkout, which is what the renderer reads to decide a button is a purchase button.
- sb_outline lists satellite nodes (an accordion item's skin, a tab's shared button, a quantity stepper's buttons and input, a repeater's empty state) under their owner as satellite: "<config key>", so a node that used to be invisible to every tool is now on the map; it is not counted in children.
- sb_review reports accountPage and searchPage gaps when a store has no page for the fixed /account or /search paths, alongside the existing checkout/gateway/product/shipping/cartTrigger gaps.
- The install CLI accepts --site (and refuses any unrecognized flag instead of silently ignoring it), writing SB_SITE so every site_id argument falls back to it through siteFor().
- A 204 response (such as a page delete) now reports what it did instead of answering null.

### Changed
- sb_look walks the full page before shooting a fullPage screenshot, so a lazy-loaded image below the fold is no longer photographed as an empty box.
- sb_review no longer reports empty_container for a bound media-dataset, which paints the record itself and needs no children; and no longer reports off_canvas for nodes inside the cart drawer, which is parked off-screen until a shopper opens it.
- sb_add's dataset elements (list-dataset, dataset-block, media-dataset, collection-media, product-variants, quantity-dataset, and others) now derive their bindings from the config.datasetSource supplied in the same call, instead of always seeding the element's default source; sb_set repairs a mismatched binding the same way.
- sb_site_list's error message no longer tells a key-only install to call sb_connect first, since listing sites is an account-only call a key deliberately cannot make.
- sb_api_call's error for a missing path parameter now says it belongs in path_params instead of naming the parameter without saying where it goes.
- sb_media_upload now retries on the partner upload endpoint before reporting the key's scopes as the problem, since a deployment that has not yet enabled key uploads on the primary endpoint otherwise blames a valid key.
- The API catalog is regenerated: 456 operations and 99 definitions (up from 412 and 97), recovering 44 previously-undocumented operations including the payment-gateway read/write endpoints; the element catalog grows to 107 with the addition of order-receipt.

### Fixed
- Saving an edit to a shared global section or an overlay (the cart drawer, a global header or footer) no longer silently drops every edit after the first one in a session; the save now re-stamps each master's revision from the platform's response instead of replaying a stale one that the platform rejects with a 200.

## [0.2.2] - 2026-09-07

### Fixed
- sb_live_join now accepts an API key (SB_TOKEN) to join the live-edit room, instead of refusing it and requiring a session; the platform now gates the socket on the key's delegated member permission and its own site, so a key-only install can join like every other tool.
- sb_media_upload now accepts an API key, instead of refusing it and requiring a session; the platform's upload endpoint moved behind the same gate as sb_sites, and a 401 with a key present now reports that the key lacks the media permission or belongs to another site, rather than telling the caller to switch credentials.

## [0.2.1] - 2026-09-07

### Added
- sb_add and sb_move now seed the same content the editor gives an element at drop time: satellite nodes such as an accordion's item skin or a tab's shared button, and seeded subtrees for a list's empty state and for dropdown, select and popover, which render as an empty box without them.
- sb_page_open reports compose_warnings from the platform, including globalMissing, which means the server could not find a shared section's master and deleted the reference node from the document it handed back — saving from there makes the loss permanent.
- sb_page_create reports slug_renamed when the requested slug was already taken; the platform silently stores a suffixed slug and answers success, so every link authored to the requested slug would otherwise be dead.
- sb_publish reports not_published when a page has no saved draft, since the platform skips it and still answers success with whatever else did publish.
- sb_review reports unlinked_form when a form element names no form, since it composes nothing and publishes as an empty box with no warning from the platform.
- sb_review reports dead_menu_link when a menu has no entries or an entry has no href, since the renderer reads specials.menuItems and never menuId.
- sb_review reports extra_repeater_child when a repeater element (such as list-dataset) carries more than one child, since only the first is ever rendered per record.

### Changed
- sb_add and sb_move now refuse adding or moving a second child into a repeater element, since only the first child renders; a reorder within the same parent is still allowed.
- sb_duplicate now refuses duplicating into a repeater element for the same reason, and deep-copies satellite nodes (such as an accordion's skin) with the owner's pointer rewritten instead of aiming the copy at the original's satellite.
- sb_duplicate strips the composition stamps (globalId, globalRef, globalKind, globalRev) from a duplicated node instead of copying them, since two nodes sharing one stamp is refused by the platform on the next save.
- sb_publish now returns only the fields a caller acts on (pageId, slug, isHomepage) for each published page instead of the platform's full rendered document, html and css for every page the cascade touched.
- sb_page_create's dry_run preview and live response now redact settings the same way sb_api_call does, since it is a free-form object a caller can pass a credential inside.
- The internal tree walk used by sb_remove, sb_duplicate and save validation now follows satellite nodes (attached through config, not the child list) in addition to the child list, so removing or duplicating a node also handles its satellites correctly.
- Save validation now refuses a document where a composition stamp (globalId, overlayId) sits on a node that is not a direct child of ROOT, or is duplicated across two nodes, since the platform refuses both later and reports it as an opaque error.

### Fixed
- Reordering a node within the same repeater parent no longer trips the new second-child guard.

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
