---
name: sbuilder-document-model
description: How a page document behaves under this server's writes — satellites, overlays, global sections, app blocks, band order, the responsive cascade and base-only config, bindings, hover and pinned states, theme presets, the patch batch, and what sb_review can and cannot see. Triggers when touching src/core/**, src/domains/site/** (document, builder, node, traps, guard, validate, review, readiness, hover, sticky, baseonly, theme, vocabulary, fieldskin), src/tools/page.ts, or when sb_add / sb_set / sb_remove / sb_move / sb_bind / sb_review / sb_outline stores something that renders wrong or not at all.
---

# The page document and the writes against it

**Triggers:** `src/core/**`, `src/domains/site/**` (not import/pattern files), `src/tools/page.ts`, a write that reported success and changed nothing on the page.

The five traps are summarised in `CLAUDE.md` because they are dangerous to learn late; their
full text is at the end of this skill. Every trap and most entries below fail SILENTLY — the
save succeeds, the publish succeeds, and the page is wrong.

Each entry below is a fact that cost real investigation, kept verbatim from the era when
`CLAUDE.md` carried all of them. Do not re-derive them, and do not "fix" the code that accounts
for them. Counts inside an entry are what was measured THAT day — trust the generator or the
repo over a number here, and fix the line when you catch one stale.

- **A plain `image` inside a repeater can never show a product photo.** Its renderer reads
  `specials.src` — what the DOCUMENT holds — so every card gets the same picture. Only the
  elements whose renderer reads a `bound…` special can show a record; that list is generated
  (`BOUND_SPECIALS`, read from `server/render/nodes/*/html.go`) rather than hand-kept, and
  `sb_review` reports the mistake as `static_in_dataset` with the element swap as the fix.
  A live storefront shipped with six identical placeholder cards before this check existed.

- **`rootId` is the app-block key for the same idea `root_node_id` names in a page.** A page
  document carrying it renders an EMPTY `<body>` with a 200 — the order-complete page of a
  real store did exactly that. `PageDoc.from` adopts the alias, drops it, and `sb_page_open`
  reports `blank_page_repair`, so one save fixes the page.

- **`applyBindings` honours only the `specials` namespace.** A binding whose `field` names
  any other namespace is stored, saved, published, and ignored forever.

- **`sb_review` now answers EIGHT readiness questions, and the newest is the most basic.** A
  store with a published product template, a checkout page, a live gateway and a delivery
  option reported READY on an EMPTY CATALOGUE — every repeater rendering its empty state to a
  shopper, the product template bound to nothing. `catalogue` reports that, and reports the
  near-miss too: every active product priced at zero renders, adds to the cart and totals
  nothing, which reads as a working store right up to the money. Read off
  `/api/sites/{siteId}/products` rather than `/api/v1/products`, because that one takes either
  credential and the check must answer for a session install as well as a key-only one.

- **NOTHING ASKED WHETHER THE PAGES WERE ONE SITE.** Every tool here authors ONE page, so a
  build that never reaches for a global section gives each page its own header and footer — and
  then changing the menu is one edit per page, the copies drift, and a visitor meets a slightly
  different site on every click. It is the most basic thing a website has that a generated one
  does not, and it is INVISIBLE to `sb_review`, which reads one page and finds it perfect.
  `siteChrome` reports it, asked BEFORE the `isStore` gate because it is true of every site;
  the precedent is `accountPage` / `searchPage`, already there on the same reasoning in the
  other direction. Two pages is the threshold — a one-page site has nothing to share with — and
  an unread list is silent rather than an empty one. The list was ALREADY being fetched for
  `cartTrigger`; only its length was thrown away.

- **AND THE BASKET HAD NO NUMBER ON IT.** `cart-count` is opt-in by design — `open_cart` is an
  ACTION any element can carry, not an element type, so there is no "cart icon" to badge by
  default and minting one unasked would put a number on every social glyph in every footer.
  This file already recorded the consequence ("the defect the platform shipped `cart-count` to
  fix is the default state of every icon this server authors") and nothing checked for it.
  `cartCount` fires only when something DOES open the cart, so it never doubles up with
  `cartTrigger`.

- **Store readiness lives ONLY in the editor.** `editor/src/editor/storeReadiness.ts` computes
  five gaps between a site and a paid order — no checkout page, no live gateway, no published
  product template, no delivery option, nothing that opens the cart — and no API exposes any
  of it. `src/domains/site/readiness.ts` mirrors the table and `sb_review` reports it, SILENT
  on any input it could not fetch. A storefront built entirely through these tools reviewed
  clean and the editor then listed all five.

- **A composed stamp is not a reference.** `globalId` / `appBlockId` are what the server
  writes when it composes a shared subtree onto a page; the document stores `globalRef` /
  `appBlockRef`. Authoring the composed one makes the next save decompose that node OVER the
  master and empties it for every page carrying it — four pages went blank before `sb_add`
  and `sb_set` learned to refuse it.

- **`DOC_SCHEMA_VERSION` is 2** and lives in `editor/src/theme/legacyScopes.ts`, not in the
  schema package. Codegen reads it with a regex — importing an editor module would drag Vue
  into a build script for one integer.

- **A real document carries SATELLITE nodes, attached by `parent` alone.** `list-empty`,
  `list-loading`, `quantity-button`, `quantity-input`, `product-variant-label` and their
  contents set `parent` to their owner and are deliberately absent from that owner's
  `data.nodes`. Measured on a live page: 55 nodes, 16 of them satellites. So "every node is
  reachable from ROOT through child lists" is FALSE of documents the platform itself serves,
  and `validateForSave` checks ATTACHMENT — reachable, or hanging off something reachable —
  not reachability. The two stricter rules that used to live there refused every save of
  every real page, and only a live run could show it.

- **A SATELLITE hangs off `config[key]`, and the editor mints it on ADD.** Nine elements own
  one — `accordion`, `tab`, `menu`, `list-dataset`, `dataset-block`, `cart-order`,
  `product-variants`, `quantity-dataset` and `icon`. The table is generated from the element
  METAS (`SATELLITE_RULES`), never from Go's `SatelliteConfigKeys`, because only the metas carry
  `optional` — and TWO are now opt-in rather than one: `list-loading` (`loadingStateId`), because
  a list with no loading design shows a silhouette of its own cards, and `cart-count`
  (`cartCountId`), the basket badge on the corner of a cart glyph. The second is why the flag
  matters. `open_cart` is an ACTION any element can carry, not an element type, so there is no
  "cart icon" type to give a badge to by default — minting it unasked would put one on every
  social glyph in every footer. An `icon` that never asks renders exactly the bytes it did
  before. So a header cart icon ships WITHOUT a count unless something adds the satellite, and a
  shopper who adds an item gets a toast that fades and no evidence anywhere on the page that
  their basket holds anything: the defect the platform shipped `cart-count` to fix is the
  default state of every icon this server authors. `schema_gen.go:245` states
  the walk contract outright: subtree collection, copy and delete must consult the table.
  `createNode` mints them, `walk` follows them, and `duplicateNode` deep-copies them with the
  owner's pointer rewritten — before which a duplicated accordion pointed at the ORIGINAL's
  skin. Three list-empty owners are born as a SUBTREE, not a bare node, so the empty state is
  generated per dataset source from the editor's own `buildEmptyStateTree`.
  A satellite given as a NESTED child spec takes the same path as a top-level `sb_add` of one
  (`seeded()` in builder.ts): its key is reserved before `mintSatellites`, so it REPLACES the
  minted one instead of being refused as an ordinary child of a non-container, and it gets its
  seed subtree when it brings no children — it used to arrive bare.

- **`ELEMENT_SEEDS` is content an element is not USABLE without.** A `dropdown` without its
  trigger and panel is "a bare relative box"; a `select` renders INTO those two nodes.
  Generated from `editor/src/element/seeds.ts`. Both that module and `emptyState.ts` import
  only `@webbuilder/schema`, so codegen imports them directly — unlike `legacyScopes.ts`,
  which is still read by regex because importing it would drag Vue into a build script.

- **`list-dataset` clones `Data.Nodes[0]` and drops every sibling** (`html.go:60`). It is the
  ONLY renderer that does, which is why `FIRST_CHILD_ONLY` is generated: `dataset-block` is a
  dataset container too and renders ALL of its children, so the obvious
  `isContainer && category === 'dataset'` predicate restricts the wrong element.

- **`GET .../source` returns compose `warnings`, and one of them is destructive.**
  `globalMissing` means the server could not find the master and `delete`d the reference from
  the composed document it handed back (`compose.go:118`), so the page opens with the section
  already gone and the next save stores that loss permanently. The field was typed on the
  response and read by nothing for three phases.

- **THE DATA AXIS OF A REPEATER WAS UNREACHABLE THROUGH EITHER TOOL, silently.** `sb_add`
  with `config.datasetSource: "category"` minted a `list-dataset` still bound to
  `product_list`: `createNode` seeded the element's DEFAULT bindings and ignored the config
  in the same call. And `sb_set` could not repair it — `rebindPatch` looked up
  `${source}|${kind}`, and TEN elements with a `bindingsFor` table declare no default
  `config.kind` (`list-dataset`, `dataset-block`, `media-dataset`, `collection-media`,
  `product-variants`, `quantity-dataset` …), so the key came out `category|` and matched
  nothing. A category shelf repeated PRODUCTS under a heading that said collections, through
  save, publish and render, with no warning at any step. Both paths now share
  `bindingsForConfig()` (`domains/site/node.ts`), which falls back to the first row for the
  source when the element has no kind axis — every `<source>|*` row of such an element is
  identical, because there is nothing for it to vary on.

- **A PURCHASE BUTTON COULD NOT BE AUTHORED AT ALL.** The renderer decides what a button IS
  by reading `target.action` and nothing else (`server/render/nodes/helpers.go:1166`);
  `sb_set` writes only style/config/specials, and `sb_bind` wrote a binding with no target.
  So a store built entirely through these tools had no Add-to-cart control, while `sb_review`
  reported the missing purchase action and named no fix that worked. `sb_bind` now takes
  `action`, writing the reserved id `bind-product-action`
  (`schema/src/elements/datasetBindings.ts:852`) with `buy_now` stored as its document
  vocabulary `dynamic_checkout`.

- **`empty_container` fired on an element that paints the record itself.** A bound
  `media-dataset` with no children publishes the product photo and its thumbnail strip;
  the rule called it an empty band on a page that rendered correctly. The discriminator is
  not "is it bound" — `dataset-block` binds too, and only the LINK (`boundHref`), so an
  empty card really is empty. It is whether `BOUND_SPECIALS` holds a key outside the link
  set.

- **A SATELLITE CARRIES THE ELEMENT'S WHOLE LOOK, and the outline used to hide it.** The
  variant option's box, its label, the quantity stepper's two buttons and its input, a
  repeater's empty state — all real nodes with `style` and `states`, all hanging off
  `config[<key>]` instead of `data.nodes`, so every walk of the child lists missed them. A
  storefront therefore shipped with the platform's grey `#d0d0d0` selects and a grey stepper
  on a rose-and-ink page, and nothing in any tool said the nodes existed. `sb_outline` now
  lists them under their owner as `satellite: "<config key>"`, ahead of the real children and
  NOT counted in `children` — that number still means `data.nodes.length`, which is what every
  index-taking call is written against.

- **`sb_remove`'s DRY RUN COUNTED PATCHES AND CALLED THEM `removing`, on a tool described as
  "Remove a node and its whole subtree".** Every caller reads that as a node count, and
  `removeNode` emits one `unset` per doomed node PLUS one `remove` that takes the id out of its
  parent's child list — a patch that exists only while the parent is still in the document. So
  the number is OFF BY ONE IN THE ORDINARY CASE and EXACT IN THE RARE ONE, which is the worst
  arrangement available: plausible, usually close, and wrong in the direction nobody checks.

  Both readings were believed here, on the same live page. A childless `flex-section` under
  ROOT reported `removing: 2`, which this file recorded as evidence of "a second node attached
  to it by `parent` alone that the outline does not show" — and dumping that page's 118 nodes
  proved NO node names it as a parent. The orphaned `list-empty` subtree next to it reported
  `removing: 4` and was right, because its owner had already been deleted so there was no child
  list to edit. Two numbers, one wrong, and the wrong one is the one a section normally gives.

  It reports `removing` (nodes) and `patches` (what it takes) as separate fields now. The node
  count is exactly the `unset` patches whose path names a node directly — two segments, where
  the parent-list patch is four — so it needs no second walk of the tree.

  THE TEST FOR IT IS AT THE TOOL, not at `removeNode`. Three tests pin the patch composition
  and every one of them stays GREEN with the tool put back to `patches.length`; that is the
  "a test that survives its own fix being deleted" shape this repo keeps closing, and it is
  why the distinction is asserted in the dry run's BYTES, where a caller meets it.

- **AND THE DEFECT `6980ebb` NAMED WAS ONLY HALF CLOSED — a refused write still
  landed on the next successful save.** That commit is titled "a refused write left its patches
  in the draft and blamed the next command", and it taught `applyAndSave` to refuse only what a
  write INTRODUCES, so a page that arrived broken stays editable. It left the INHERITED damage
  to be discovered by `save()` — one step too late, because `applyAndPublish` has already run
  by then. The patches sit in the draft and on the live socket, and the next save that passes
  writes them out.

  MEASURED ON A LIVE PAGE, and it is how this was found rather than an argument for why it
  could happen. Removing an empty `flex-section` was refused over four orphaned nodes it had
  nothing to do with. The next command removed the orphans, succeeded, and stored a document
  missing FIVE nodes: the four it asked for and the section whose removal had been refused an
  instant earlier. `rev: 3` after one command is the same fact from the other side, and a
  diff of the page source before and after says 118 → 113.

  `applyAndSave` now refuses BEFORE applying whenever the write would leave the page still
  unstorable, naming what it inherited and saying nothing was applied. A write that REPAIRS the
  damage still passes — the check is on the state the write would LEAVE, not on the state it
  found — which is what keeps a broken page editable, the property `6980ebb` was protecting.

  ROLLING BACK AFTER A FAILED SAVE WAS THE OTHER CANDIDATE AND IS WORSE: `applyAndPublish` has
  already broadcast the patches over the live-edit socket, so a local rollback leaves every
  watching editor showing an edit this session no longer holds.

  The test that covered this ASSERTED THE DEFECT. Its last line read "its own edit survived,
  because it was never the problem" — and a surviving edit is precisely what the next save
  commits. It now asserts the opposite, plus a second case proving a repairing write still goes
  through, and both were checked by removing the guard and watching them go red.

- **A FORM'S FIELDS ARE STYLED BY CONFIG KEYS THAT BECOME CSS VARIABLES**, not by style on
  the field. `schema/src/elements/fieldSkin.ts` and its lockstep mirror
  `server/render/nodes/fieldskin/fieldskin.go` hold the vocabulary: `fieldBg`,
  `fieldBorderColor`, `fieldRadius`, `fieldPadY/X`, the chrome trio, and separate tables for
  choice, timeslot, file and pay-card. TWO LEVELS: the FORM node dresses every field it
  holds, a FIELD node overrides its own — and the split matters, because `form/css.go` emits
  only `Knobs + ChromeKnobs`, so `payCard*` written on the form is stored and rendered
  nowhere. Those belong on the `form-payment` field, inside the FORM DOCUMENT
  (`PUT /api/sites/{siteId}/forms/{id}/document`) — as does the submit button, which is a
  `form-submit` node in that document and not on the page at all. A page republish is what
  makes a form-document edit visible, since the page inlines the form (`id` =
  `<pageFormId>_<formNodeId>`).

- **The page's CSS is a LINKED STYLESHEET, not the HTML.** `static-*.css`, `desktop-*.css`,
  `tablet-*.css` off the assets host. Grepping the HTML for a rule and finding nothing proves
  nothing — twice here it read as "the style did not apply" when it had.

- **A SHARED MASTER IS FENCED, AND THE FENCE MOVES ON EVERY SAVE.** Compose stamps
  `specials.globalRev` / `specials.overlayRev` on the node it materialises; the save sends it
  back as `expectRev`; the platform refuses a stale one WITH A WARNING AND A 200. The save
  response reports each master's new revision (`source.globals`, `source.overlays`) precisely
  so the client can re-stamp — and this client typed both fields and read neither, for as
  long as they have existed. So the FIRST edit to a global header, a global footer or the
  cart drawer landed and every edit after it in the same session was dropped while the tool
  answered success. Measured: two `sb_remove` calls against the drawer, the second answering
  `{"removed": …}` and changing nothing. `PageSession.save` now applies `restampPatches`.
  The platform's own comment on the field says the same thing about the editor, which had
  the bug first.

- **`sb_review` USED TO SKIP OVERLAYS, on a reason that was false.** The comment said the cart
  drawer "is not this page's to fix" — but an overlay's content reaches storage through the
  PAGE SAVE, so `sb_set` on a drawer node lands, and the skip meant nothing ever reported what
  shipped inside one. Measured: a rose-and-ink storefront whose drawer carried a static mock
  row reading "Product name / 0₫", a DUPLICATE cart list rendering every item twice, and
  English copy throughout — none of it mentioned, on a site that reviewed clean ten pages
  running, and all of it found by a person opening the drawer. Overlays are now walked, and
  their findings carry `overlay: true` because the master is SHARED: without the flag one
  drawer defect reads as ten problems on a ten-page site.

- **AN OVERLAY'S CONTENT IS WRITTEN THROUGH THE PAGE SAVE, never through the overlays API.**
  `PATCH /api/sites/{siteId}/overlays/{id}` accepts `name`, `kind` and `allPages` — a
  `document` in that body is ignored and the call answers 200. The route-map comment on
  `overlays/rest/rest.go` says content "is deliberately NOT written here": the page save
  carries the composed drawer and the page context decomposes it. So `sb_set` on a drawer
  node is the right tool and it works; `refuseOverlay` fires only on the overlay ROOT, which
  is correct, because moving or removing THAT is not a page-level fact.

- **`sb_set`'s `state` PARAMETER WAS READ BY NOTHING USEFUL, and its documented call
  corrupted the base style.** A state has TWO homes and the platform names both
  (`schema/src/node.ts`, mirrored by `render/style/cascade.go`'s `MergeStateNs`): base is
  `node.states[state][ns]`, per breakpoint is `node.responsive[bp].states[state][ns]`.
  `setKeys` wrote neither — its path was `states[state][bp][ns]`, a breakpoint buried inside
  the base-state cluster where nothing reads it — and worse, `if (opts.base)` was tested
  BEFORE `if (opts.state)`, so `base:true` + `state:"hover"` fell into the base branch and
  wrote the hover value straight into the plain style. The node then wore its hover colour
  permanently and had no hover at all, while the tool reported success. The call that does
  this is the one the `sbuilder-site-design` skill documents:
  `sb_set pr_option style base:true state:"active"`. A test pinned the wrong shape, so the
  defect had a green suite over it. Base is NOT a degenerate case: it is where every element
  seeds `meta.defaults.states` (`tab-item`, `quantity-button`), and `MergeStateNs` reads it
  first. `specials` now REFUSES a state rather than dropping it.

- **`sb_review` NEVER WALKED A SATELLITE, so an element's whole chrome was outside it.** Its
  recursion used `childrenOf` — `data.nodes` only — which is precisely the mistake `walk`'s
  own comment warns a caller against ("satellite-aware is the DEFAULT ... a caller who writes
  the obvious thing must not be silently wrong"). So every repeater's empty state, every
  variant-option skin, every quantity stepper and every menu/tab item skin was invisible to
  the one check that exists to say what a visitor meets. `childrenWithSatellites` in
  `core/tree.ts` is the one-level form for a caller carrying its own scope down.

- **AND THE SEED COPY IT COULD THEN SEE HAD NO CHECK.** `placeholder_content` compares a
  node's `specials.text` against `ELEMENTS[type].defaults.specials` — the element's OWN
  default, which for a heading is `"Heading"`. An empty state's heading is minted from
  `SATELLITE_RULES`' seed tree and says `"No products yet"`, so it matched nothing. The
  consequence is general, not incidental: EVERY store built with these tools ships the
  platform's English empty states, in `#171717` ink and `#d4d4d4` icons, and reviews clean.
  Measured on a Vietnamese storefront — home, category, product and search each reported
  "nothing a visitor would notice" while four repeaters said "No products yet" and "New
  arrivals will show up here. Check back soon." `default_seed_copy` reports it, off both
  generated seed tables so a new empty state is covered by the next codegen.

- **AN OVERLAY WRITE IS SITE-WIDE AND `sb_set` SAID NOTHING.** `globalWarning` asked only
  `isGlobal`, so restyling the cart drawer's quantity stepper changed ten pages and the
  result read as a plain page-local success. It is the write-side of the reason `sb_review`
  flags overlay findings `overlay: true`. `overlayRoot()` answers for a node ANYWHERE inside
  one, which is the case that matters — the caller edits the stepper, not the drawer root.

- **A `media-dataset`'s `style.aspectRatio` SHAPES THE BOX, NOT THE PHOTO.** The image's own
  ratio is `config.mediaImageRatio` (`"auto"`, `"custom"` + `mediaCustomImageRatio{Width,Height}`,
  or a ratio string verbatim — `render/nodes/media-dataset/css.go`); with the config unset the
  `<img>` keeps the static `aspect-ratio: 1 / 1`, so a portrait product photo is centre-cropped
  to a square inside a correctly-shaped frame. `sb_traits_for media-dataset` names all three
  controls. Rule 6 of the design skill — "match a frame's aspect ratio to the asset" — is
  therefore only half the job on this element.

  **And the platform's own CSS defeated even that**, which is worth knowing because the symptom
  reads as an authoring mistake. `ImgAttrs` writes the intrinsic `width`/`height` ATTRIBUTES
  onto every `<img>` (that is what keeps CLS at zero), and a presentational `height` attribute
  is a USED height — so with no CSS `height`, `aspect-ratio` has no auto dimension to solve for
  and is IGNORED. Measured on a live product page at 390px: a 900×1100 photo in a 326px frame
  rendered 326×**1100**, and the node's `overflow:hidden` showed the shopper the top third of a
  t-shirt. It was invisible at 1440 only because a taller container clipped a smaller fraction,
  which is why it survived a desktop review. Fixed upstream by adding `height:auto` to
  `__feature-img`, `__cell-img`, `product-image-feature__img` and `wishlist-list__card-img`, in
  the Go static CSS AND the editor SFCs that must stay byte-identical to it.

- **A FORM STACKED ITS FIELDS WITH ZERO GAP, on every store.** `form`'s
  `meta.defaults.style` seeded `display:flex` + `flexDirection:column` + `width` + `height`
  and no `gap`, while `form-segment` — the sibling with the IDENTICAL trait signature and the
  identical four keys — seeded `gap: '12px'`. So the same form spaced itself differently
  depending on whether its fields sat in a segment or directly in the form. Measured on a
  published checkout at 1440px: eleven consecutive fields, every gap between them EXACTLY 0,
  so each label sat nearer the previous control than its own. The Layout group offers a Gap
  row, which is the same "the panel reports a value the box does not have" shape
  `schema/test/direction-default.test.ts` was written for. Fixed at the seed (`gap: '12px'`,
  matching the sibling) with `schema/test/form-gap-default.test.ts` pinning that the three
  field stacks agree AND stay clear of `fieldStackGap` — of the 33 elements offering a Gap
  row, 29 seed one, and the four that do not are the layout primitives, so the guard is an
  AGREEMENT rather than a blanket rule.

  `defaults` seeds at CREATION, so every form authored before the fix keeps zero — which is
  why `sb_review` reports `form_fields_flush` rather than trusting the new default. That
  check reads the container's own style, NOT its children: a form's fields live in the FORM
  DOCUMENT and compose on the render path, so the page's node has `nodes: []` and a
  child-count test would call every form empty.

- **A PATCH CARRIED THE NODE BY REFERENCE, AND `applyAndSave` APPLIES EVERY BATCH TWICE.**
  `addSubtree` emits `set nodes/<id>` whose value IS the node object it just built, then
  `insert` patches that push child ids into that node's own `data.nodes`. Assigning the
  reference means the first apply MUTATES THE PATCH: the batch is no longer the batch, and the
  second pass re-establishes a node that already holds its children and inserts them again.

  The second pass is not hypothetical — `6980ebb` (v0.16.1) added
  `validateForSave(d.preview(patches))` in front of `applyAndPublish(patches)` precisely so a
  refused write never lands, and that is a second application of the same objects. So from
  v0.16.1 until this fix, **every nested `sb_add` stored each child TWICE and every
  `sb_import` THREE times** (a third pass, through the staging copy). Measured on a real
  import: 106 of 231 containers listing one child id three times.

  It is silent in every direction. The tree is well formed, every id resolves, `validateForSave`
  passes, the platform accepts the save, and the page simply renders its content twice — so
  neither `sb_review` nor `sb_look` can name it. **No test caught it because nothing else in
  the suite applies a batch more than once**; the tests build patches and apply them exactly
  once, which is the one arrangement that is correct either way.

  `applyPatches` now clones an object value on `set` and `insert`, which makes the batch
  IDEMPOTENT for this shape: the re-`set` puts a pristine node back and the inserts rebuild the
  same list. Primitives pass through — a style key is a string, and cloning one on every
  `sb_set` would be pure cost. Pinned in `test/patch.test.ts` (the property) and
  `test/page-tools.test.ts` (the document that actually goes over the wire, which is the only
  place the defect was ever visible).

- **PINNING ARRIVED IN SEPTEMBER 2026, AND ALL THREE OF ITS FAILURES ARE SILENT.**
  `position: sticky` changes nothing a stylesheet can see when it engages — CSS has no
  `:stuck` — so `schema/src/stickyState.ts` (Go mirror `render/style/sticky.go`) has a runtime
  island toggle ONE class, `wb-stuck`, on the pinned element, and compiles every rule written
  for the pinned look against it: `#self.wb-stuck` for the node itself, `#host.wb-stuck #self`
  for a DESCENDANT, which is what lets a pinned header shrink its logo without the logo
  knowing what pinned it. Three things follow, and `src/domains/site/sticky.ts` holds all
  three because each is a write that disappears:
  - **The state needs a HOST.** `render/css.go` emits stuck rules inside
    `if stuckHost := stuckHostFor(...); stuckHost != ""`. A `stuck` override with no pinned
    self-or-ancestor compiles to nothing — stored, saved, published, ignored forever, the same
    shape as a binding outside the `specials` namespace. `sb_set` refuses it and names the node
    to pin; `sb_review` reports `stuck_no_host` for the document that got there another way.
  - **The seeds are not cosmetic.** The inspector writes `top: 0px` AND `zIndex: 10` the moment
    an author picks "Stick on scroll", and the platform's commit records the measurement:
    in Chromium, a pinned header with no z-index is painted OVER by any `position: relative`
    element in a later section the moment it scrolls past. 10 is specific, not large — above
    page content, below the overlay ladder the static CSS owns (cart scrim 40, drawer 41,
    pop-up scrim 50, pop-up 51), because a header outranking those would cover the drawer it
    opens. `sb_set` seeds both, never over an answer the caller gave.
  - **A clipping ancestor defeats it entirely.** Sticky resolves against its nearest SCROLLING
    ancestor, so `overflow: hidden|auto|scroll|clip|overlay` above it becomes that ancestor and
    the node pins inside a box that never scrolls. Warned by `sb_set` (in the dry run too, so
    the caller is not told after committing) and reported as `sticky_blocked`. The check starts
    at the PARENT: a sticky element's own overflow clips its children, not itself.

  `fixed` counts as pinned — "the moment the page has scrolled past where it would have been"
  is the same design — but it is not seeded, because it arrives as a deliberate placement, and
  it is exempt from the clip warning because the viewport is not an ancestor. `absolute` is
  deliberately not pinned: it scrolls away with the page. `stuckDecls` translates exactly ONE
  config key, `hidden`, into `display: none`, and only `true` — `false` would need
  `display: revert`, which `render/css.go` documents as wrong here because it rolls past the
  element's own static CSS to the UA default. `config.stuckAfter` (px of page scroll, per
  breakpoint) overrides when the island decides, and is refused on a node that cannot pin —
  `stuckAfterCss` emits it only for one that can, so it is the FOURTH silent drop in the same
  feature. IT USED TO BE THE ONLY GENERAL SCROLL HOOK THE PLATFORM HAD — the island toggles
  `wb-stuck` on a PINNED element and nothing else, and the only other scroll-driven behaviour in
  the runtime was `popup`'s `triggerType: "scroll"`, which opens a pop-up rather than styling
  anything. **That is no longer true**: `config.animation`'s `trigger: "view"` is reveal-on-
  scroll, compiled as `animation-timeline: view()` with no island at all. See the entrance
  animation entry below — and do not reach for a sticky host to fake one. `sb_import` carries `sticky`/`fixed` off a
  source page's computed style with all three keys, because a section pinned to stay in view
  is a layout decision and a copy that scrolls away is not the same section.

  **AND THE FIRST LIVE USE FOUND THAT THE MARKER NEVER REACHED A PUBLISHED PAGE.** `markStuckHosts`
  ran in `renderDoc`; a publish does not go through it — `pagerender.Render` compiles an
  artifact and assembles it — so `StuckIslandAttrs` returned "" for every node ever published,
  while `BundleCSS` (which runs on the document, OUTSIDE the artifact) shipped every stuck rule
  correctly. A live header had `#…​.wb-stuck{box-shadow:…}` in its desktop lane, its transition
  applied, and the class never once appeared. Every island test passed, because they all call
  the direct route. Fixed upstream (web_builder PR #98) with the assertion made through
  `Assemble(Compile(doc))` — what a browser actually receives. The lesson for THIS repo is the
  one the browser-server section of the design skill now carries: when a class never appears,
  the cart drawer is the control, because if no island hydrates the question is the deployment
  and not the page. The dev stack wired no runtime bundle in at all, so every island there was
  dead and the page looked fine — `docker-compose.yml` builds `./server`, which ships the
  binary alone by design, and nothing brought a bundle in from the host (web_builder PR #99).

  **AND THE HOST IS NOT ALWAYS THE PARENT — that seam opened three days later.**
  `specials.hoverHostDepth` (base-only, 1-based, NEAREST FIRST) picks which ancestor a
  parent-hover rule hangs off, because the moment an author groups a few things inside a card
  the nearest box becomes the group and "hover the whole card" stops being reachable. A depth
  past the end of the chain CLAMPS to the outermost box rather than going dead — the chain
  shortens whenever a wrapper is deleted. The inspector has a picker AND a label naming the
  box; an agent has neither, so `sb_set` reports which box the rule hung off, lists the wider
  ones on offer, and says when a depth clamped. Depth is a DEPTH rather than an id on purpose:
  duplicate a card and the copy's state points at the copy's own ancestor.

  The same work also landed the thing this repo had already fixed independently: **state
  overrides write PER BREAKPOINT** (`responsive[bp].states`), which both compilers had always
  read and only the editor never wrote.

- **HOVER HAS TWO HOMES, AND THE OBVIOUS ONE IS WRONG FOR TWELVE ELEMENT TYPES.** The platform
  grew a UNIVERSAL hover state in September 2026 alongside the pinned one
  (`schema/src/hoverState.ts`, Go mirror `render/style/hover.go`): `states.hover` compiles to
  `<self>:hover`, and `states.parentHover` to `<parent>:hover <self>`, both inside
  `@media (hover:hover)`. But the universal compiler DELIBERATELY STANDS ASIDE for every element
  whose meta declares a Hover variant of its own — twelve of them — and the meta's `storage`
  field says where each of those actually keeps it. A `button` keeps it in `config.stateHover`, a
  FLAT, BASE-ONLY map its own renderer compiles; the editor routes a hover edit there on purpose
  ("a hover edit on a button must go on being the button's :hover rule",
  `editor/src/trait/values.ts`). MEASURED on one publish of one page: `state:"hover"` on a
  product card's dataset-block emitted `#card:hover{…}`; the identical write on the BUTTON inside
  it emitted nothing, and writing the same values to `config.stateHover` produced the rule on the
  next publish. Every hover this server had ever written onto a button was stored where no
  compiler looks. `HOVER_HOMES` is generated from `storage`, and `sb_set` routes and says so.

  **THE FIRST DIAGNOSIS OF THIS WAS WRONG, AND THE WAY IT WAS WRONG IS THE POINT.** Grepping the
  renderers for `node.States` found only four files — none of them an element's own `css.go` —
  so the conclusion was "no element compiles `states.hover`; the exclusion list is false for all
  seven non-satellites". A probe that rendered one node per type and looked for the value in
  `BundleCSS` disproved it: the filters and `text-dataset` DO paint, through shared helpers the
  grep could not see, and a patch built on the grep would have emitted a SECOND rule for each of
  them — exactly what the exclusion exists to prevent. The absence of a string is evidence about
  the string, not about the behaviour; only rendering a node answers "does this paint".

  What the probe DID find looked like a platform gap and was a SECOND namespace mistake of the
  same kind: **`product-image-list` declares `storage: 'node'`, and nothing compiles its
  `states.hover.style`** — but its own compiler was already reading the state slot's CONFIG.
  `render/style/satellite.go`'s `CompileImageListItemBorderCSS` takes
  `MergeStateNs(node, state, "config", bp)` and emits
  `.wb-product-image-list__item:hover::after`, for exactly `listItemBorderWidth` (which must be
  PRESENT on the state, even 0, or the whole rule is skipped — the state is read RAW, with no
  fallback to base), `listItemBorderColor` and `listItemBorderStyle`. So the probe was right
  about the namespace it probed and wrong about the element, and the note it produced told
  callers to give up and style a wrapper. `hoverRoutingNote` now names the route that works.
  The lesson is the probe's own, applied one level down: rendering a node answers "does this
  paint" only for the namespace you rendered.

- **DESIGN RULE 0 FAILED BY CONSTRUCTION ON NINE ELEMENTS, and nothing said so.** "Read the
  page's pattern off what is there" assumes a node's `style` HOLDS what it paints. Since
  `THEME_VERSION` 6 that is false: element defaults are moving OUT of `meta.defaults.style` and
  into theme PRESETS the element wears, and `icon/meta.ts` states it outright — "The COLOUR
  lives in the `icon-default` style preset, not here: a node's own slot outranks its preset, so
  seeding it made every other icon preset unable to repaint it." Nine metas already carry one
  (`icon`, `button`, `heading`, `text`, `image`, `flex-section`, `text-dataset`,
  `quantity-input`, `search-input`), and `DEFAULT_THEME` ships 58 presets.

  A preset compiles to a CLASS rule BENEATH the node's own values (`compilePresetCSS`), so the
  layer is real and ordered — and it was invisible to every tool here. `sb_node_read` on an icon
  returned a style with no colour, on a page visibly painting one, so an agent following rule 0
  read nothing and invented a literal. That literal then OUTRANKS the preset permanently: the
  node stops following the theme, and the next palette change moves every other node and not
  that one.

  `sb_node_read` now returns a `preset` block — what it paints, with every `var()` chain
  flattened, plus which keys the node has already overridden — and `sb_set` says once per preset
  when a literal is about to detach a node. The chain is three deep in the ordinary case
  (`var(--wb-sc-heading, var(--wb-color-heading))` → scheme role → palette token → `#111827`),
  which is why the raw string is not an answer.

  **THE SITE'S THEME IS THE AUTHORITY AND THE STARTER IS NOT.** `GET /api/sites/{siteId}/theme`
  is fetched and cached per site; `STARTER_THEME` is the fallback and the origin travels with
  the value, because handing an agent the starter's `#111827` for a site whose heading token is
  rose is a confident wrong colour — worse than none. A node naming a preset the theme does not
  hold is reported by id rather than resolving to nothing, which is the exact failure
  `THEME_VERSION` 6 was bumped for. `src/domains/site/theme.ts`, pinned by
  `test/theme-preset.test.ts`.

- **THREE ELEMENTS RENDER CONVINCINGLY WHILE WIRED TO NOTHING, and it is the one silent shape
  neither check can catch.** `sb_review` reads the tree and the tree is correct; `sb_look`
  photographs the page and the page looks right. So the fact has to be delivered when the
  element is ADDED, which is what `src/domains/site/inert.ts` does.
  - `locale-switcher` below two locales gets a FABRICATED chip. `localeSwitchPayload` returns ""
    and the renderer falls back to `sample = {Code:"VI", Name:"Tiếng Việt", Currency:"VND",
    Flag:"🌐"}`, deliberately, "so the element is never an empty box". It names a language and
    switches nothing.
  - `breadcrumb`'s ROOT crumb is the one word no entity supplies: `specials.homeLabel`,
    defaulting to the English "Home". **The trail itself IS derived and the labels ARE
    authorable** — the hardcoded "Home" / "Product detail" in `html.go:126,132` is the PRE-TRAIL
    branch, kept byte for byte so that adding the trail republished nobody's page differently,
    and reading it as the live path was a misreading worth recording: the element's own AI hint
    ("Always start with 'Home'") is CORRECT, not stale.
  - `spline-scene` — the platform's 112th element, and the SHARPEST of the three, because its
    placeholder is not a placeholder. `specials.sceneUrl` is seeded with a REAL
    `prod.spline.design` link, so a scene added and never configured loads, renders, responds
    to the mouse and publishes — somebody else's 3D work, on the merchant's domain, looking
    completely finished. The other two describe an element that is unfinished; a screenshot
    ENDORSES this one. Set it to the merchant's own export (Spline: Export → Viewer, the
    `…/scene.splinecode` link) and set `posterUrl`, or the box is blank until the ~600 KB
    engine chunk arrives.

- **`genId` COULD REPEAT ITSELF, and the suite proved it rather than argued it.** Four random
  bytes is 32 bits, which puts a collision at roughly 1 in 34,000 across 500 draws — and the
  uniqueness test HIT one in an ordinary run, 499 of 500. One `sb_import_site` mints thousands.
  The consequence has no error attached: two nodes sharing an id means one OVERWRITES the other
  in `doc.nodes`, the parent's child list points at the survivor, and the document validates,
  saves and publishes with content silently gone. The width stays four bytes, because the
  platform's own ids are eight hex characters and a document this server builds should be
  indistinguishable from one a human built; uniqueness comes from REMEMBERING what has been
  issued, which is the right scope since one process builds one document.

## The five traps

Each fails SILENTLY. Each is encoded in `src/domains/site/traps.ts` (trap 5 in
`src/core/tree.ts` and `src/domains/site/builder.ts`) with its own test, because this
platform treats an unproven guard as indistinguishable from an absent one.

1. **Site overlays** — the cart drawer and pop-ups are composed onto ROOT on read and
   stripped on write. Stamped `specials.overlayId`, and only a DIRECT child of ROOT may be
   one. `pageChildren()` is the walk every ROOT-level rule must use; `childrenOf()` on the
   root is the mistake that reads correctly and behaves wrongly.
2. **Global sections** — stamped `specials.globalId`/`globalKind`; shared masters. Editing
   one changes every page carrying it, and publish cascades. Results say so.
3. **Band order** — ROOT's children must read `[header*][middle*][footer*]`. The platform
   refuses EVERY save otherwise (`checkBands`, `server/internal/page/decompose.go`). It
   strips overlays before checking, which is why the rule needs no overlay exception — and
   why ours strips them too.
4. **Responsive by default, not by refusal.** `setKeys` writes per breakpoint because a
   design should respond — but base is legitimate and is NOT a trap. This entry used to say
   a base value "vanishes on publish" and `setKeys` threw for one; both were wrong, and the
   correction is worth keeping because the misreading is easy to repeat.

   The platform's mandate ("if a key CAN be responsive it MUST be") is about ELEMENT
   IMPLEMENTATION: an element whose Go renderer reads `n.Config[...]` directly — `nodes.ConfigInt`
   in `html.go`, an SVG `width=` attribute — bypasses the cascade, so a per-breakpoint value the
   author sets renders on the canvas and never reaches publish.
   `server/render/style/cascade.go`'s MergeNamespace resolves a key
   *current slot → wider slots → BASE → narrower slots*, so base is the fallback layer, and
   every element's `meta.defaults.style` is seeded straight into it.

   **AND THIS ENTRY THEN SAID "NOTHING A DOCUMENT STORES CAN CAUSE THAT", WHICH IS FALSE — the
   document is exactly what causes it.** `ConfigInt` and `ConfigString`
   (`render/nodes/helpers.go:1421,1433`) index `node.Config[key]` with no responsive merge, and
   ONE html document serves all three widths, so a key an `html.go` decides can only ever come
   from base. `setKeys` writes config per breakpoint unless the caller passes `base`. For those
   keys that default IS the bug the paragraph above describes — the value updates the editor
   canvas and vanishes on publish, with no error at any step — reached not by writing a bad
   element but by writing an ordinary document.

   The platform keeps the list, as a deliberate MIGRATION ledger
   (`schema/test/responsive-defaults.test.ts`, `BASE_ONLY_CONFIG`, 13 keys), and its own comment
   records three that shipped and had to be reverted: `icon` iconSize, `text-dataset`
   descriptionLines, `media-dataset` layout. It also protects the human and not the agent — the
   editor's `MediaLayoutPickerRow` and `AccountRowLimitRow.vue` force `desktop` explicitly, so a
   merchant cannot make this mistake through the inspector and an agent could make it on every
   call.

   THE DATA AXIS IS THE WORST OF THEM, and this repo had already paid for it from the other
   direction. `datasetSource`, `kind`, `collectionId` and `collectionType` are all on the list,
   while `rebindPatch` writes the derived bindings at NODE level. So
   `sb_set config {datasetSource:"category"}` left the bindings saying category and the config
   in `responsive.desktop`, where `dataset-block/html.go` never looks — it read base and still
   said product. Both halves reported success: the same shape as "THE DATA AXIS OF A REPEATER
   WAS UNREACHABLE THROUGH EITHER TOOL" above, re-entering through the breakpoint layer instead
   of the kind axis.

   `src/domains/site/baseonly.ts` splits a config write across the two layers and `sb_set`
   reports the move as `base_only`, once per KEY per process — routed and said rather than
   refused or silently done, which is the `hoverRoutingNote` precedent. The table is GENERATED
   from the platform's ledger, never copied, because that ledger is meant to shrink: a stale
   copy would keep forcing a key to base long after the platform made it responsive. The
   EXCEPTIONS are per `type:key` and load-bearing — `quantity-button:iconSize` really is
   per-breakpoint, through the satellite compiler's `--icon-size` var.

   THE TAIL OF THAT ORDER BITES. Because narrower slots are consulted last but ARE consulted,
   a key written only at `tablet` reaches `desktop` whenever neither desktop nor base declares
   it. A `flexWrap: wrap` added to a header for tablet broke the desktop header into two rows,
   and the fix is not to remove the tablet value — it is to say the desktop answer out loud, at
   base. When you write a responsive override, write its wide-screen counterpart too.
5. **App blocks** — a marketplace app's subtree. The document stores ONE reference node
   stamped `specials.appBlockRef`; on read the platform composes the app's markup under it
   and stamps the block root `appBlockId`; on save `DecomposeAppBlocks`
   (`server/internal/page/globalservice.go:56`, after overlays, before `Decompose`) reduces
   the subtree back to the reference, so an edit inside is stored nowhere and reported
   nowhere. `appBlockRoot()` in `src/core/tree.ts` finds the nearest stamped self-or-ancestor;
   every write refuses a strict descendant through `refuseAppBlockInterior` (and `sb_add` /
   `sb_move` refuse the root as a destination), the outline flags the root `app: true`, and
   `sb_review` skips the interior. Tested in `test/traps.test.ts`.

- **`node.events` IS NEVER READ BY A RENDERER, so every navigation this server authored was
  DEAD.** A SOLE navigation click renders as `specials.href` and from nothing else:
  `nodes.EventAttrs` (`render/nodes/helpers.go:621`) skips it outright —
  `if ev.Name == "click" && clicks == 1 && purchaseItem == "" && (go_to_url || open_page)
  { continue // the <a href> form }` — on the stated assumption that the href is already
  there, because "a call beside an anchor would navigate twice". The editor upholds that by
  writing the event AND its href in ONE undo step (`projectHref`, `stores/node.ts:618`),
  whose own comment says `node.events` is never read by a renderer. `setEvent` wrote the
  event alone, for as long as `sb_event` has existed.

  So `sb_event action:"go_to_url"` produced a node with neither an anchor nor an `on:click`:
  a control that renders, saves, publishes, and does nothing when a shopper clicks it. SILENT
  at every step — `sb_review` reads the tree and the tree is correct, `sb_look` photographs
  the page and the page looks right. MEASURED on a live storefront: three home-page images
  carrying `click: go_to_url {"url":"/bo-suu-tap"}` published as bare `<img>` tags, beside a
  button that carried the href and published as `<a href="/bo-suu-tap">`. Fixed, and verified
  end to end: after the fix the same three publish as
  `<a class="wb-image-link" href="/bo-suu-tap">`.

  `domains/site/navhref.ts` holds the projection, pure and in its own module because two
  callers need it for opposite reasons — `setEvent` must WRITE it, `sb_review` must REPORT a
  document that arrived another way (`dead_nav`). The rule is the editor's exactly: projected
  only for a SOLE `go_to_url`/`open_page` click on a node with no purchase binding, cleared
  otherwise. `go_to_checkout` is never projected — a checkout hop is not a plain link — and an
  `open_page` with no resolved `url` projects nothing rather than inventing one, since neither
  renderer can resolve a page id. Through `sb_event` the purchase-bound case is ALREADY
  unreachable (binding a purchase swaps the element to `meta.bindingEvents`, which offers no
  `go_to_url`), so that clause is for documents that arrive by another road; the test pins
  that rather than asserting a combination the tool refuses.

- **THE EDITOR CANVAS AND THE RENDERER DISAGREE BY CONSTRUCTION, and "the live page has data
  but the canvas is blank" is that, not a cache.** A page is THREE documents: the DRAFT
  (`GET /pages/{id}/source`, what the canvas shows), the PUBLISHED row (compiled at publish
  time, what the storefront serves), and a session's own copy. `hydrate`
  (`editor/src/stores/node.ts:3418`) gates the first —

  ```ts
  const rootId = doc?.root_node_id ?? '';
  if (!rootId || !nodes[rootId]) { this.seedRoot(opts?.pageId); return; }
  ```

  — and a document failing it is SILENTLY REPLACED by an empty ROOT, with nothing in the log,
  after which the editor's next save stores that blank. The Go renderer has no such gate. This
  file already records the measured incident from the other side: a product template of 24
  nodes read back bare and stored bare, the published copy untouched, all 19 product pages
  still rendering, invisible until a person opened the editor.

  `sb_page_state` reports all three and SIMULATES that gate — against the RAW document, never
  a `PageDoc`, because `PageDoc.from` repairs a `rootId` alias in memory and the editor reads
  the stored bytes. Three verdicts with different fixes, and the middle one inverts the usual
  advice: a root naming nothing means do NOT open the page in the editor, because that save is
  what makes the loss permanent. The cache is real and is only on the LIVE page —
  `cache-control: public, max-age=60`, measured — which is why `sb_publish verify` reports
  `max_age` beside `serving`.

- **A PAGE THIS SERVER CREATES KEEPS `schema_version: 1` FOREVER, and it is one character.**
  `PageDoc.from` reads `if (!d.schema_version) d.schema_version = 2;` — and the server's empty
  seed supplies `1`, which is truthy, so the upgrade never fires. Measured on a live site: 12 of
  24 page documents at v1 against `DOC_SCHEMA_VERSION` 2. The consequence is mild and real: the
  editor's version-gated one-shot `stripLegacySchemeScopes` re-runs on every hydrate of those
  pages instead of once.

  DELIBERATELY NOT "FIXED" BY STAMPING 2 HERE. The editor strips the v1 scheme scopes and THEN
  stamps; stamping without stripping would rob the document of a migration it has not had, and
  pin every stamped node to one colour scheme forever. `sb_page_state` reports `schemaVersion`
  instead, and the real fix is either to port the strip or to leave the stamp to the editor. Two
  of the v1 documents are not this repo's doing either — `editor/src/features/courses/pageScaffold.ts:157`
  returns `{ schema_version: 1, … }`, which codegen captures verbatim into `APP_SCAFFOLDS`.

- **AN OPT-IN SATELLITE COULD NOT BE CREATED, and the remedy named a call that did nothing.**
  `readiness`' `cartCount` fix said `sb_set {cartCountId}` "mints one"; it writes a string and
  mints nothing (pinned in `test/satellite-add.test.ts`), and `sb_add` into an icon was refused
  because an icon is no container. `addSubtree` now attaches a spec whose type the parent
  declares in `SATELLITE_RULES` exactly as the editor's `addDetachedNode` + `setNodeValue`
  does (parent = host, absent from `data.nodes`, base `config[key]` = id), and `removeNode`
  clears the host's key first, as `IconCartBadgeRow.remove` does.
  A satellite whose rule carries a `seed`/`seedBySource` (the list-empty owners) is born from
  that seed through `sb_add` too, unless the caller brings children — a bare `list-empty` is
  blank space where the editor shows a glyph, a headline and a line of body.
