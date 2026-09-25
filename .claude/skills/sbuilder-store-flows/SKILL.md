---
name: sbuilder-store-flows
description: The multi-step store flows this server runs for an agent and why each is shaped that way — sb_store actions (checkout, form templates, site chrome, overlays, apps), the store page seeds sb_page_create applies, the four fixed paths that resolve by page type, /account, category templates, layout patterns and sb_template_use, and media search. Triggers when touching src/tools/store.ts, chrome.ts, overlay.ts, menu.ts, project.ts, src/domains/site/{patterns,storepage,inventory,readiness}.ts, or when building a store's checkout, account, category or home page.
---

# Store flows, page seeds and layout patterns

**Triggers:** `src/tools/{store,chrome,overlay,menu,project}.ts`, `src/domains/site/{patterns,storepage,inventory}.ts`, a store that renders but cannot take an order.

For DESIGNING a store with these flows (build order, the nine design rules, which artifact to
judge from), load `sbuilder-site-design` — that skill is for an agent using the tools; this
one is for changing the flows themselves.

Each entry below is a fact that cost real investigation, kept verbatim from the era when
`CLAUDE.md` carried all of them. Do not re-derive them, and do not "fix" the code that accounts
for them. Counts inside an entry are what was measured THAT day — trust the generator or the
repo over a number here, and fix the line when you catch one stale.

- **A CHECKOUT IS FOUR STEPS IN A FIXED ORDER, AND `sb_store` NOW RUNS THEM.** The flow was
  documented here and reachable by nothing: an agent had to read the editor's own file,
  reproduce four writes in order, and rebuild two documents it could not author. `sb_store`
  with `action: "checkout"` runs them, generating both documents from the editor's
  `formTemplates.ts` and `checkoutPageSeed.ts` at codegen time — with the form id substituted
  through a sentinel codegen asserts appears exactly once, because a substitution that
  silently matched nothing would make a checkout page bound to no form, which renders and
  takes no orders. `dry_run` (the default) returns the ordered plan and the payment and
  delivery options the form will actually carry.

  The original note stands as the reason it had to be a tool:
  `editor/src/features/pages/checkoutPage.ts` — create an order form, PUT it
  back WHOLE (name and type ride along, or `Normalize()` renames it and turns it `custom`,
  after which the document is refused), save the field document with the payment methods and
  shipping options filled in at that one moment, then create the page from
  `buildCheckoutPageDocument` and PUBLISH, because /checkout resolves to the published page
  of the TYPE. Both seed modules import only `@webbuilder/schema` plus editor-internal
  files, so codegen imports them directly. Copy that flow; do not rebuild a checkout by hand.

- **STOREFRONT CUSTOMER ACCOUNTS EXIST, and an element hint said they did not.** `form`'s
  `avoidWhen` carried "Sign-in, registration or password reset: those need storefront customer
  accounts, which do not exist yet, so a form there would submit into nothing" — read at build
  time and believed, which is why a storefront shipped with no way to sign in. They exist in
  full: `/_wb/account/{login,register,logout,forgot,addresses,cart,courses,…}`, the `account`
  page type served at the fixed path `/account`, form types `login` / `register` / `forgot` /
  `reset` / `verify` (`forms.Type.IsAuth`, submitting through `customerauth` rather than the
  submissions table), the `logout_customer` click action, and the elements `account-info`,
  `member-gate`, `member-field`, `address-book`, `wishlist-list`, `points-card`,
  `points-prompt` — several already shipping VIETNAMESE defaults. Corrected at the source
  (`schema/src/elements/form/ai.ts`). The lesson is the one this file already records for
  agent keys: a hint written when something was true survives long after it stops being, and
  a stale one that says "you cannot" costs more than no hint at all. `customer.name` is not a
  mapping either — the field is `customer.fullName`.

- **FOUR PATHS RESOLVE BY PAGE TYPE, and only one backstops itself.** `page.FixedPathTypes` is
  search, checkout, complete, account. `/checkout/complete` serves a built-in receipt when the
  store has no completion page — measured 200 on a store that had none. `/account` and
  `/search` measured 404 on the same store, QUIETLY, because nothing links to them by default:
  the merchant finds out when a shopper who wants their order history does. `readinessGaps`
  now reports both, after the five that stand between the store and a paid order and before
  the cart trigger — a shop with no account page still takes money, so they are a different
  question, asked second.

- **`/account` IS THE SIGN-IN DESTINATION, so it cannot be split — and it must not show
  two auth forms at once.** `login` and `register` ARE page types since web_builder
  `8459371d9`, but SLUG-routed purpose types (with `about`, `contact`, `policy`, `faq`) — not
  fixed paths (`FixedPathTypes` is still search, checkout, complete, account) — and `membersonly.go`'s `membersOnlyRedirectTarget`
  sends every anonymous visitor who hits a members-only page to `/account`, its comment
  ruling out "a page-document scan hunting for a login form". So the instinct to give
  sign-in and registration their own pages breaks the platform's own redirect: the shopper
  arrives at `/account` with nowhere to sign in.

  The shape the platform intends is `member-gate`'s own hint — "build the pair: one gate set
  to Members and one set to Guests" — and the seed gives you only the members half
  (`accountPageSeed.ts`: heading + `account-info` + `order-history` + `address-book`), so
  the guest half is authored blind. What shipped here was both auth forms SIDE BY SIDE in
  the guest gate: two headings, two submit buttons and one decision, becoming one long
  double form at 390px. A `tab` is the fix — its button row is synthesized from each
  `tab-content` child's `specials.label` (`render/nodes/tab/html.go:2`), so the undeclared
  `tab_items` inspector control is not something you have to reverse-engineer — and its
  `tabItemId` satellite ships `#f5f5f5` / `#7b7b7b` with a `#171717` active state, which is
  rule 4 again.

- **SIXTEEN OF THE PLATFORM'S SEVENTEEN FORM TEMPLATES WERE UNREACHABLE.** `formTemplates.ts`
  ships `contact`, `subscribe`, `order`, `checkout`, `address`, `consult`, `booking`, `stay`,
  `feedback`, `event`, `quote`, `apply`, `login`, `register`, `forgot`, `verify` and `reset`,
  and codegen picked exactly ONE (`checkout`). So a store built entirely with these tools had
  a checkout and nothing else: no contact form on its contact page, no newsletter, and none of
  the five auth forms — even though `forms.Type` declares them, `customerauth` serves them,
  and `Type.IsAuth` gates them. Hand-authoring one means writing a field document whose
  `mapTo` values are a vocabulary the server validates, which is the guess this catalog exists
  to remove. `FORM_TEMPLATES` now carries all seventeen with their documents, and
  `sb_store action:"form"` runs the same three ordered writes the checkout does minus the page
  (create → PUT back WHOLE → save the document, with the delete-on-failure guard).

  It deliberately makes NO page: where a login form belongs is a design decision, and
  `/account` is the one page that is not a free choice — see the entry above.

- **A PAGE AN AGENT CREATED WAS NOT PART OF THE SITE.** A page created through the editor
  carries the site's header and footer; `sb_page_create` attached NEITHER, so a site built with
  these tools was a stack of pages with no navigation and no footer — on a site that has both.
  Nothing reported it: `sb_review` reads the page and the page is fine, `siteChrome` asks
  whether the SITE has globals and it does, and `measure` sees no defect in a band that is
  simply absent. Measured by building one: three pages, every one bare, beside a store page
  carrying its header as ROOT's first child.

  **READ OFF THE HOME PAGE, never picked by name or by order.** A site can hold several globals
  of each kind — the store measured here holds four headers and two footers, most of them
  experiments — so "the first header" is a guess and a name is a label nobody promised to keep.
  Whatever chrome the home page wears IS this site's chrome. The reference is the platform's own
  shape (`decompose.go:382`) and goes in FIRST and LAST, because compose turns them into real
  bands and ROOT's children must read header, middle, footer. Silent when there is no home page
  to read: a page created without its chrome is one a person can fix, and a page created with
  the WRONG chrome is one nobody notices.

- **A SEARCH IS NOT A GUESS, and that distinction is the whole of rule 7.** The rule says
  "keyword stock imagery is not a source" and proves it — `loremflickr` answered
  "kids,clothing" with a cat statue and a photo of an adult. The fault was never stock
  photography: it was GUESSING. A keyword glued into a URL returns something nobody looked at.
  A search API returns results that each carry WHAT THEY SHOW, so the caller reads the
  descriptions and CHOOSES, which is what a person does. `sb_media_upload` takes a `query` and
  refuses to upload anything without a `pick` — uploading the first hit unread would rebuild the
  cat statue with better plumbing.

  **PEXELS, BECAUSE IT IS ALREADY THIS FAMILY'S ANSWER.** `webcake-landing-mcp` ships the same
  client — down to the shared proxy at `mcp.toolvn.io.vn/api/images/search`, which holds a key
  so an `npx` install with no configuration finds images anyway — and a second house standard
  for one job is a second place for it to drift. Its licence is free for commercial use with
  attribution APPRECIATED rather than required, which is what lets a storefront carry a photo
  without printing a credit line the merchant did not ask for.

  **LUMMI WAS THE OTHER CANDIDATE AND THE READING OF IT MATTERS.** Its licence page says
  outright "You don't have to ask for permission or credit the creator or Lummi", commercial use
  with no limits, forbidding only resale, bundling into a competing stock service, and claiming
  ownership. Its API reference separately says developers MUST attribute every image displayed.
  Those are two different obligations — one on the IMAGE (none) and one on API ACCESS (a
  guideline whose sanction is your key) — and conflating them, which the first reading here did,
  turns a free image into an imagined legal burden on the merchant. What actually ruled it out
  was operational: 10 requests per minute by default and an API key granted by application.

- **A PICTURE SLOT TAKES A REAL IMAGE OR SAYS SO IN WORDS — never a grey box, never stock.**
  A pattern library invites a placeholder, and both kinds are worse than an empty slot: rule 7
  already records that keyword stock is not a source (`loremflickr` answered "kids,clothing"
  with a cat statue), and a grey box reads as unfinished because it is. The site's OWN library
  is the honest source — measured on a live store, 164 assets, 50 of them images — so
  `sb_template_use` reads it and hands the pattern what the merchant already owns. A landscape
  is preferred where the layout wants one, which is rule 6 before the fact rather than after
  it. An empty library produces a sentence naming `sb_media_upload`, not a frame.

  **AND WHAT THE PAGE IS ALREADY SHOWING COMES OUT OF THE POOL.** Each call starts its own
  selection, so a hero added first and a gallery added second both reached for the same best
  landscape and the page showed one photo twice — which reads as a mistake because it is one.

- **AN AGENT ASKED FOR "A HERO" HAD 111 ELEMENTS AND NO LAYOUT.** Every band was invented from
  flex-blocks on the spot, which is why a generated page reads as generated — the elements are
  right, the composition is a guess, and the guess is different on every section of the same
  site. The platform's own library is the first place to look and it is THIN: measured on a live
  site, TWO section templates. `LAYOUT_PATTERNS` adds six defaults, listed by `sb_templates`
  under `built_in` (the site's own always first) and applied by `sb_template_use`, which needed
  no new tool and no new argument.

  **BUILT AS `Captured` TREES THROUGH `toSpecs`, never hand-assembled** — that is the whole
  design. The mapper already knows how to dress a section in the page's own tokens, give a row
  a stack breakpoint, and stop a stacked column becoming 280px of air; a pattern written by hand
  would re-derive all of it and drift from it on the next fix. The test pins the PROPERTY rather
  than any pattern's shape: every one is storable, every row has a mobile answer, and no pattern
  contains a colour that is not a token it was given.

  **AND A BLANK PAGE'S LOOK IS THE SITE'S THEME, NOT NOTHING.** Rule 0 says read the page's own
  pattern; a page that has none is the case the rule does not cover, and the next authority is
  the theme every element's style preset already resolves from — not invention. Carried as
  `var(--wb-color-…)` rather than the hex it resolves to, because a literal on a node OUTRANKS
  the preset beneath it permanently: a band that baked today's colour in would stop following
  the theme the moment the merchant changed it, which is the detachment this file already
  records for imported icons.

- **A STORE BUILDER SHIPPED SEVEN LAYOUT PATTERNS AND NONE OF THEM WAS A STORE.** The bullet
  above closes "an agent asked for a hero had 111 elements and no layout" and left the same gap
  open one level up: an agent asked for a shelf of featured products had `list-dataset` and
  nothing telling it how to compose one. `sb_product_shelf` and `sb_category_strip` fixed it as
  a REAL `list-dataset` repeater bound to the catalogue — never static tiles, which is a shop
  where every price is a literal and nothing is buyable, a failure this file already records
  twice elsewhere. Both name only `config.datasetSource` (and, where an element has a kind
  axis, `config.kind`); `bindingsForConfig` derives the actual binding at add time, so the
  pattern cannot drift from the platform's own factory the way a hand-copied binding already has
  twice in this repo's history.

  `dataset-block` / `media-dataset` / `text-dataset` / `pricing-dataset` have no `Captured` kind
  and cannot: nothing an IMPORT ever walks produces a repeater, since a browser discovers markup
  and a repeater is a document's own data axis. So these four are the one deliberate exception to
  "built as `Captured` trees, never hand-assembled" — raw `NodeSpec`, spliced in after a section's
  own capture-built heading, because the mapper has nothing to say about a shape it was never
  taught. `sb_brand_wall` (logos from the library, framed with `contain` rather than a wall's
  median-ratio crop — a transparent logo forced into a photograph's crop loses its own shape) and
  The card's PICTURE follows the editor's own presets: a category's is `collection-media`
  (`category.image`) — a `media-dataset` on a category derives `product.image` and shows no
  picture — and a product's is the childless `media-dataset` at `layout:'single'`
  (`seedBoundMediaTile`), since the default `bottom` drew three empty thumbnails under every card.
  `sb_trust_band` (icon-plus-line reassurances, naming exact platform icon ids) needed no such
  exception; both are ordinary `Captured` compositions.

  A fifth candidate — a newsletter signup — was judged and rejected rather than faked. The
  platform's `form` node on a page is a bare reference to a SEPARATE form document
  (`specials.formId`); building one honestly is the multi-step write `sb_store action:"form"`
  already owns (create → PUT back whole → save the field document), not a `NodeSpec` a pattern
  can compose offline. A `form` with no `formId`, or an input whose button submits nowhere, is
  exactly the class of convincing-but-inert element `INERT_ON_ADD` exists to stop this server
  from adding.

- **A CATEGORY TEMPLATE NOW SCOPES ITSELF TO THE CATEGORY IN THE URL, and this file said the
  opposite for a day.** `/collections/{slug}` (the prefix is `collections`, not `categories`)
  resolves through `PublishedForEntity`: the category's OWN page when a page-link names one,
  else the DEFAULT TEMPLATE for the `category` page type. That template is one document serving
  every category, and until 2026-09-09 nothing narrowed its product feed — `entityScope` threaded
  the entity into the ARTICLE feed for a `blogCategory` and the REVIEW feed for a `product`, and
  `productCategory` reached the products feed as nothing at all, so every category listed the
  whole catalogue with no error anywhere.

  `b4ca5645` closed it, and closed it where the product KINDS are decided rather than by
  narrowing the feed. `pagerender.go:2264` threads the entity as `pageCollection` for
  `linkType == "productCategory"`; `render/nodes/list-dataset/html.go:328` reads it. So:

  - **`all_products` on a category page means THAT category.** The shared default template is
    now correct for every category, which is what an agent should reach for first — one page,
    one repeater, left on the kind it is born with.
  - **AND THERE IS NOW AN EXPLICIT SPELLING OF IT: `page_collection`.** It renders the
    collection the PAGE IS — the one `/collections/{slug}` named — so one template serves them
    all by saying so rather than by relying on `all_products` narrowing itself. Reach for it
    when a repeater must FOLLOW THE URL; keep `collection` + `collectionId` when it must name
    one of its own. It arrived in the catalog on the 2026-09-11 regen and is generated like the
    rest of the vocabulary, so it needed no hand-kept list — but the test that pinned the five
    older values as an exact array went red for it, which is the wrong shape for a generated
    table and is now an assertion about the values that must be PRESENT.
  - **A repeater pointed at a NAMED collection keeps naming it** (`collectionType: "collection"`
    + its own `collectionId`). Deliberate: a "you may also like" shelf of another category on a
    category page is a real design, and the page must not overrule it.
  - `related` / `featured` / the curated slots read no `collectionId` at all, so the scope
    reaches none of them.

  The two older shapes still WORK and are still the way to give one category a page of its own —
  `PUT /api/sites/{siteId}/page-links/{linkType}/{linkId}` with `{pageId}` (or
  `POST …/page-links/bulk` with `{linkType, linkIds, pageId}` for many), and
  `PUT /api/sites/{siteId}/pages/{pageId}/default-template`, which decodes NO body. They are no
  longer required for correct scoping, and building a page per category to get it is now work
  for nothing.

  **THE SCOPE IS EMPTY IN THE DRAFT PREVIEW** (`render/html.go:637` answers "" with no scope),
  so a category template previews listing the whole catalogue however right it is — the same
  population of pages the `sb_look` entity-template caveat already covers. Judge it at
  `/collections/{slug}` on the published storefront.

  **`sb_review`'s `categoryScope` now reports ONLY the one shape still broken**: the open page
  is the shared category template and EVERY product repeater on it is pinned to a named
  `collection`. It used to fire on "categories > 1 and no page-links" and prescribe a page per
  category — a count that is now the correct setup. A pinned shelf beside a URL-following one
  is a design and stays silent.

  This entry is kept in the shape "it used to be X, it is now Y" on purpose. The previous
  version was written the same afternoon the platform fixed it and prescribed a page per
  category as the remedy, which is exactly the stale-hint cost this file records for agent keys
  and for storefront accounts: a fact verified once is not a constant, and a hint that says
  "you cannot" outlives the thing that made it true.

- **EVERY STORE PAGE TYPE OPENED PRE-BUILT FOR A MERCHANT AND BLANK FOR AN AGENT, and this
  server's own tool description asserted the blank as if it were the platform's.**
  `sb_page_create` said "It arrives empty" for as long as `editor/src/element/storePageSeeds.ts`
  has been seeding — a product page opens with "gallery, title, price, variant picker,
  description, quantity stepper, Add to cart and Buy it now — already arranged and already
  bound".

  That file's opening comment is the argument for taking it, and it is about the AUTHOR rather
  than the canvas: "the blank was not the problem — what the author had to already know was."
  An agent was in exactly the position the merchant was rescued from, and worse — it cannot see
  the palette card it is failing to reproduce, and the button's `add_to_cart` is a BINDING
  rather than a click action, which is the single thing hardest to guess.

  `STORE_PAGE_SEEDS` is generated by CALLING `buildStorePageDocument`, never by copying it, so
  the day a palette card gains a piece it arrives at both doors. Six types: product (24 nodes),
  category, search, blog, post, complete. Codegen asserts the buy box still carries
  `add_to_cart` AND `bind-product-action`, because "it has nodes" is not proof a product page
  still buys anything. `sb_page_create` seeds by default and takes `seed:false`; the seed is a
  SECOND write and a refused one leaves the page created and blank rather than failing the call.

  **AND IT FOUND THE ROOT CAUSE OF A DEFECT THIS FILE ONLY HAD THE SYMPTOM OF.** The `rootId`
  entry above records that a page document carrying the alias "renders an EMPTY `<body>` with a
  200 — the order-complete page of a real store did exactly that", and never said where the
  alias came from. It came from the platform's own seed:
  `editor/src/element/completionPage.ts:91` was `return { rootId: 'ROOT', nodes }` — no
  `root_node_id`, and no `schema_version` either. So that real store got its blank page from the
  editor, and so did every merchant who created a completion page through it; the canvas reads
  the alias, and only the RENDERER disagrees.

  FIXED UPSTREAM in `8e40bbab` (web_builder), which is where it belonged — this client could
  only ever repair its own copy while the editor kept minting blank pages. The type system had
  forbidden that line the whole time (`PageDocument` requires both fields, `schema/src/node.ts`),
  and it survived because `npm test` there is `vitest run` and never typechecks; only
  `npm run build` does. **A generated catalog is a typechecker pointed at the platform**: this
  surfaced as a TS error the moment the seed was captured into a typed table, which is the
  argument for capturing rather than copying.

  The normaliser stays, and it now passes the fixed source through byte-identically — which is
  what a good normaliser should do. The OTHER five seeds are asserted alias-free so it can never
  become a blanket coercion that hides the next one.

  The thank-you sentence is read from `editor/src/i18n/locales/{vi,en}/payments.json` rather
  than defaulted here: seeding an English line into a Vietnamese store is the defect
  `default_seed_copy` reports on everybody else's seeds.

- **A PAGE BUILT ENTIRELY BY THESE TOOLS WAS MEASURABLY WRONG, AND `sb_review` CALLED IT
  CLEAN.** Four bands from the built-in patterns, real photographs, the theme's own palette —
  and photographed at 1440 it carried four defects, every one of them invisible to a check that
  reads the tree. This is rule 1 restated from the other end: a tree cannot be badly
  proportioned, so only the render can report proportion.
  - **NO MEASURE.** Every block came out 1392px wide, so every heading and paragraph was set on
    a 1392px line — around 200 characters where prose reads at 60-75. `sectionMaxWidth` existed
    and is read off the TARGET page, which answers nothing on a blank one. Unbounded was a
    decision too, and the worse one; `THEME_TOKENS` now carries `1200px`, the same class of
    answer as the `64px 24px` padding the mapper already commits to.
  - **A WRAPPING ROW CANNOT MAKE EQUAL CELLS.** `flex: 1 1 <basis>` lets every item absorb the
    free space on ITS OWN LINE, so a gallery of five photographs came out as four cells of
    330×220 and a fifth of **1392×420** — the same picture, four times the size, under the
    others. Dropping the grow factor buys a ragged right edge on every full line;
    `repeat(auto-fill, minmax(280px, 1fr))` is the thing actually wanted, and the platform
    renders it (verified against a live server before it was written). Mobile gets
    `gridTemplateColumns: 1fr` BY NAME, because `flexDirection: column` says nothing to a grid
    and a mobile override that silently does nothing is rule 3 failing with a value in the
    document to prove it tried.
  - **THE PAGE HAD ONE TYPE SIZE.** The theme ships `heading-1` (48px) through `heading-6` and
    `text-1`..`text-3` — a real scale — and every heading rendered at 48px whatever its level,
    because the mapper wrote `htmlTag` and nothing else and the `heading-default` preset pins
    `fontSize: 48px` FLAT. A section title and the three item titles beneath it came out
    identical on a document that correctly said h2 and h3. "About four type sizes rather than a
    fifth that differs by 2px" is the checklist item; the page had ONE. Worn BY REFERENCE —
    `var(--wb-ts-<slug>-<prop>)`, which is what the editor's own picker stamps, plus
    `config.textGlobalStyle` to record the pick — because a literal `36px` would outrank the
    preset permanently. SIZE AND LINE HEIGHT ONLY of the eight keys a style controls: colour and
    weight are already answered by the tokens read off the target page, and overwriting those
    would make an imported band stop matching the page it landed on. `TEXT_STYLE_KEYS` is
    generated from `editor/src/theme/textStyle.ts`; every ref carries the element's former
    answer as its CSS fallback, so a slimmer theme renders exactly as it did before.
  - **A ROW HAD ONE CROSS-AXIS ANSWER FOR TWO DIFFERENT SHAPES.** `alignItems: flex-start` is
    right for a row of equal-weight columns — three blurbs of different lengths should share a
    top edge — and wrong for a row of unequal ones: the hero's 154px text column sat beside a
    420px photograph with 266px of dead space under it. `Captured.align` carries the answer, the
    hero asks for `center`, and `capture` now reads the SOURCE's own `alignItems` for the same
    reason it reads `position` — a hero that centres its words against a tall photograph is
    making a layout decision, and a copy that top-aligns them is not the same band.

- **TWO MORE THE RENDER SHOWED ONLY AFTER THE FIRST PASS WAS FIXED.**
  - **A CENTRED BAND WAS CENTRED IN ONE PLACE AND NOT THE OTHER.** The pattern set
    `textAlign: center` on its section, and every descendant should have inherited it — except
    the theme's `heading-default` preset declares `textAlign: left`, and a CLASS RULE BEATS AN
    INHERITED VALUE. Measured: the heading and the sentence sat hard left at x=120 while the
    button, being `width: fit-content` under `alignItems: center`, sat in the middle. One band,
    two alignments, and nothing reported it. `Captured.textAlign` writes it on the NODE, where
    it outranks the preset — and `capture` reads the source's own for the same reason it reads
    `position`. `left`/`start` is deliberately NOT carried: stamping a literal on every
    imported paragraph would override the target page's own centred preset, which is rule 0
    inverted.
  - **A GALLERY WALL HAD NO FRAME.** Rule 6 says match a frame's ratio to the ASSET, and a wall
    of photographs is the case that rule does not cover: there is no single asset. Left alone
    every tile keeps its own shape and the grid's rows come out different heights, which reads
    as unfinished. The frame is MEASURED rather than invented — the MEDIAN of the pictures
    actually being shown, so most crop by nothing, the outliers crop least, and a library of
    portraits gets a portrait wall rather than a landscape one imposed on it. A picture whose
    size the library did not report votes for nothing, and a wall with no measurements at all
    keeps `contain`. `height: auto` rides with every framed image, because the platform writes
    intrinsic width/height ATTRIBUTES and a presentational height is a USED height that would
    otherwise make `aspect-ratio` ignored — the same fix the platform applied to its own media
    CSS.

- **THE ONE THING A SITE HAS THAT A GENERATED ONE DOES NOT WAS REACHABLE BY EXACTLY ONE TOOL.**
  `sb_review` has reported `siteChrome` since it learned to ask — two pages and no global section
  means every page carries its own header, changing the menu is that many edits, and a visitor
  meets a slightly different site on every click. The FIX existed and was locked inside
  `sb_import_site`, which builds exactly this from the pages it just created. A site built any
  other way — patterns, `sb_add`, a store seeded by `sb_store` — had to reproduce it by hand:
  create the master, know its `document` is page-shaped but rooted at the SECTION, then give every
  page a ROOT child carrying `globalRef` + `globalKind`, FIRST, because a header after middle
  content is a band-order refusal on the next save. So a check that named the gap sat beside a
  tool that could close it and no way to ask. `sb_store action:"chrome"` asks; the flow itself
  moved to `src/tools/chrome.ts` and both callers share it rather than one copying the other.

  **AND BUILDING IT SHOWED THAT A ROW HAD ONE ANSWER FOR TWO SHAPES.** The menu came out with its
  three links at x=120, x=428 and x=735 — each in its own third of a 1200px row — because the
  group mapping gives every column an equal share, which is right for a feature trio and wrong
  for a nav. `Captured.pack` is the other shape: columns at their CONTENT width, wrapping when
  they run out, which is what a menu should do and needs no stack breakpoint of its own.

  `width: auto` is the load-bearing half of that and leaving it out looked like the whole idea had
  failed. `flex-block` seeds `width: 100%` from its element defaults, and `flex: 0 0 auto` only
  says "do not grow or shrink from the BASIS" — the basis being `auto`, which reads the width. So
  every packed cell stayed full width and the menu came out as a vertical list: measured, three
  links stacked in a 140px header where the equal-share version had been 52. Only the render
  showed it; the spec was correct to read at every step.

- **A GLOBAL-SECTION EDGE IS RECORDED FROM THE COMPOSED STAMP ALONE, so attaching one takes
  TWO saves.** `Decompose` (`page/decompose.go:312`) builds its `GlobalWrite` list from nodes
  carrying `specials.globalId`; a node carrying `specials.globalRef` — the STORED form, the
  only one a client may write, and literally what `makeRefNode` writes — takes the
  `if !stamped { continue }` branch and produces no write. `SaveDraftComposed` then calls
  `SetPageRefs(siteID, pageID, refIDs)` with a list that does not include it, and
  `SetPageRefs` REPLACES the page's whole ref set.

  So planting a reference and saving once leaves the page composing the section perfectly on
  every read — Compose resolves `globalRef` fine — while `page_global_refs` never hears about
  it. What that costs is `usageCount` and `GET /global-sections/{id}/pages`, which is the list
  the DELETE dialog shows: a master reported as used by seventeen pages, deleted, and the
  eighteenth goes blank. MEASURED: attaching the shared header left `usageCount` at 17 with
  the page absent from the referencing list; re-reading and storing the composed document back
  moved it to 18 and the page appeared.

  `PageSession.recompose` is that round trip. `sb_store action:"global_attach"` /
  `"global_detach"`, `action:"chrome"` and `sb_page_create`'s own chrome attach all make it —
  without it every page they touch wears the site's chrome and none is counted as doing so. It
  REFUSES to run on a read that came back empty, for the reason `save()` does: a read that
  failed open must not become a write that empties the page. That guard was not foresight — the
  repo's own page-create test went red on the first run without it.

- **A PAGE SEED'S ROOT MUST STAY `ROOT`, and codegen once renamed it to `sppro_1`.** `stableIds()`
  numbered EVERY node, root included, and `sb_store`'s fresh-id pass minted `rt_<hex>`. The Go
  renderer follows `root_node_id` wherever it points, so every storefront looked fine — while
  editors before web_builder `7322af49a` painted those pages white and, before `469815330`,
  autosaved them blank. Measured on a live site: 9 of 15 pages. Now: a `root`-typed node keeps
  `ROOT` (`stableIds`, `withFreshIds`), codegen exits 1 on a page seed that does not, every page
  write heals on the way out (`withPageRoot` in `src/transport/http.ts`), and `sb_page_repair`
  fixes stored drafts. Overlays and forms root at their own element BY DESIGN — do not "fix"
  them. The id rename is structural (`remapIds`): the old JSON-wide substitution also rewrote
  any text that quoted an id.

- **EVERY GENERATED DOCUMENT IS SENT THROUGH `withFreshIds`** (`src/domains/site/ids.ts`):
  `seedDocument`, `layoutDocument`, overlay seeds, app scaffolds, checkout and form templates.
  Their ids are codegen placeholders; shipped verbatim, two category pages both carried
  `spcat_3…`. `remapIds` renames only `id`, `data` and `config` — a heading whose text IS an
  id stays text.

- **A CONTENT PAGE'S PURPOSE IS ITS TYPE since web_builder `8459371d9`.** `about`, `contact`,
  `policy`, `faq`, `login`, `register` route at their own slug exactly like `page`, any number of
  each, with their own icon — so a page list says what a page is FOR. `sb_page_create` infers the
  type from the name when none is passed (`purposeTypeForName`, the `USUAL_PAGES` keywords) and
  opens it as the layout of the same name; `sb_store action:"form"` makes a login/register/contact
  page of that type. Never login/register via the layout alone: its form is unbound until the
  form flow builds one. `checkout` is a form template AND a fixed-path type, so only slug-routed
  types are ever inferred.

- **A CART ICON OPENED NOTHING, because nothing but the editor made the drawer.** `open_cart`
  opens the site's ONE overlay of kind `cart`; only the editor's "Edit cart"
  (`useCartOverlay` → `ensureCart`) ever created it, so a site built with these tools shipped
  cart icons wired to nothing and `sb_review` said nothing. `sb_store action:"cart"` creates it
  from `OVERLAY_SEEDS.cart` (codegen, the editor's `cartDrawerSeed()`), under fresh ids, and
  `readiness` reports `cartDrawer` off `GET /overlays` — silent when that list is unread.

- **`action:"chrome"` BUILT ITS NAVIGATION AS A ROW OF BUTTONS, and `sb_review` flagged it as
  `handbuilt_menu`.** No drawer on a phone, no site menu to edit once, a cart that was a box
  wrapping an icon with the click on the icon only, in a `container-section` capped at 1440px.
  It now creates the SITE MENU first (`POST /menus`, reused BY NAME so a re-run makes no
  duplicate — EXCEPT a menu whose every row links nowhere (`menuSnapshot`'s unlinked +
  unresolved = all rows, e.g. `sb_menu`'s four `type:'none'` placeholders), whose rows are PUT
  with the real ones: reusing it by name put a header linking nowhere on every page and
  reported only `reused:true`; a menu with any working link is the merchant's and is kept) with rows that are REFERENCES — `{type:"page", pageId}`, `{type:"productCategory",
  entityId}`, `{type:"product", entityId}` — because a stored address dies when a slug changes;
  resolves them through `menuSnapshot` (the same code `action:"menu"` binds with); and builds the
  editor's own Navigation composition (`pickerPresets.ts` navigationTree): desktop `menu` hidden
  on mobile, `hamburger-menu` → `menu-drawer` (✕ `close_menu` + vertical collapse menu) shown only
  on mobile — `config.hidden` is NON-cascading, so each width must say its own. Cart = the icon
  carrying `open_cart` with a `cart-count` SATELLITE (nested satellites in a spec now attach by
  `config[key]`), and a header run also runs `ensureCartDrawer` — the icon it wires would
  otherwise open no overlay on a site that never had one. No colour literals: the menu-item / dropdown skins still carry the platform's
  own `#171717`/Inter defaults, which are being moved to tokens upstream — regenerate, do not
  paint over them here.

