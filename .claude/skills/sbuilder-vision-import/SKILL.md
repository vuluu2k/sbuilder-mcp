---
name: sbuilder-vision-import
description: The browser half of the server — sb_look's screenshot path (shoot, settle, lazy images, animations, overlays), measure's layout checks, sb_import / sb_import_site's capture and mapping (sections, rows, grids, lists, icons, embeds, chrome detection, relinking, sitemap kinds, theme tokens), coverage and the fidelity harness. Triggers when touching src/vision/**, src/tools/importpage.ts, src/domains/site/{importmap,discover,shape,sourcetokens,scoreboard}.ts, test/fidelity/**, or when an import comes back thin or duplicated, or a screenshot shows a blank band.
---

# Vision (`sb_look`) and import (`sb_import*`)

**Triggers:** `src/vision/**`, `src/tools/importpage.ts`, `src/domains/site/{importmap,discover,shape,sourcetokens,scoreboard}.ts`, `test/fidelity/**`, `npm run fidelity`.

**Touching `src/vision/**` means the browser suite**: `SB_BROWSER_TEST=1 npm test`, run FROM THE
REPO ROOT (several tests resolve paths through `process.cwd()`). The default gate skips it, and
a skip that reads as green is the failure this repo keeps closing.

**A function passed to `page.evaluate` is serialized** — anything it closes over (a module
constant, a transpiler-injected `__name`) is not there. Declare everything inside it or pass
it as an argument.

Each entry below is a fact that cost real investigation, kept verbatim from the era when
`CLAUDE.md` carried all of them. Do not re-derive them, and do not "fix" the code that accounts
for them. Counts inside an entry are what was measured THAT day — trust the generator or the
repo over a number here, and fix the line when you catch one stale.

- **`sb_look` PAID 2.5 SECONDS FOR A TIMEOUT THAT COULD NOT RESOLVE.** It waited on
  `networkidle` with a 2500 ms cap, under a comment correctly explaining that a storefront
  never goes idle — the cart island polls, a session endpoint answers 401 forever. So the wait
  ran to its cap every single time: measured 2502 ms of a 2847 ms shot, three runs of three.
  On the one tool a vision loop calls after every edit. A MutationObserver asks the question
  actually being asked — has the page stopped changing — and answers when it becomes true:
  400-460 ms on the same pages, identical content on screen. `sb_look` went 3211 ms → 923 ms
  warm, 3566 → 1564 for three widths. Bounded twice (250 ms quiet, 2000 ms cap), because a
  page that never settles must be photographed anyway. Everything else in the server is
  1-181 ms; this was the whole latency budget.

- **A PUT THAT CHANGES NOTHING IS NOT FREE.** `sb_look` saves before it renders — correctly, a
  shot of an unsaved edit is a shot of the past — and a vision loop LOOKS far more often than
  it edits, so the same bytes went back over the wire on every look. It costs a round trip,
  and it bumps the REVISION of every shared master the page carries: the fence
  `restampPatches` exists to keep honest, churned for no reason, which is how a session
  collides with a real editor. `PageSession.save` now compares the document's revision against
  the one it last stored and returns early. Measured: six consecutive looks leave `updatedAt`
  untouched, and the first real edit moves it.

- **THE DRAFT PREVIEW DOES THREAD STORE DATA, and the note said the opposite.** `sb_look`
  told every caller that "every repeater renders its empty state there, however correct the
  page is" — measured false: a home page previewed four real products at their real prices,
  matching the catalogue exactly. `ServePreview` runs `RenderDraft` → `gather` → `assemble`,
  the SAME path as a published page, and the platform's comment on it says the result is
  "byte-identical to what publishing this source would serve" (`storefront.go:1260`). The
  shoot path's own comment had already recorded the observation ("identical content on
  screen — images, prices, no empty states") while the note contradicted it. The REAL caveat
  is the opposite population of pages: entity routing lives in `ServeHost`, not
  `ServePreview`, so an entity TEMPLATE previews with nothing bound — blank title, zero
  price, and the variant picker showing the element's seed options ("Color / Size",
  "Red / S") rather than the product's own. That last one reads exactly like the
  attributes-vs-options defect the build recipe warns about, and is not it.

- **`sb_look` COULD NOT PHOTOGRAPH THE ONE SURFACE THIS FILE INSISTS YOU LOOK AT.** A closed
  drawer is `visibility:hidden` and translated 105% off-screen
  (`render/nodes/cart-drawer/css.go`), so it measures at x=1461 on a 1440 viewport and
  `page.screenshot({clip})` fails outright — "Clipped area is either empty or outside the
  resulting image", naming neither the overlay nor the reason. `sb_look` now adds the
  platform's OWN `is-open` class (plus the scrim's) before measuring, whenever `node_id`
  resolves inside an overlay.

- **AN IMPORT FROM ELSEWHERE IS A TRANSLATION, AND THE CLONE IS THE TRAP.** `custom-code`
  embeds raw author markup verbatim, so dumping a fetched page into one is both possible and
  the obvious shortcut — and it produces a Store Builder page that no inspector can edit, with
  no responsive cascade, bound to nothing, carrying somebody else's CSS and scripts. `sb_import`
  therefore reduces a page to SIX kinds — section, heading, text, image, button, list — in the
  browser, so what crosses the boundary is small and the element choices stay testable without
  a network (`domains/site/importmap.ts` is pure; `vision/capture.ts` holds the DOM half).

  The tokens come off the TARGET page, not the source, which is rule 0 applied to the one
  operation that most threatens it: first heading's ink and weight, first body line's colour
  and size, first NON-transparent button's fill and radius — a transparent one is a nav link,
  and taking its fill would leave every imported button with none. An empty target yields NO
  tokens rather than an invented palette.

  Images are uploaded into the site's own library, and a failed upload keeps the original URL:
  a visible image beats an empty frame, and a hotlinked one is a product photo that disappears
  when somebody else's site changes.

  A SWEEP ACROSS FOUR REAL SITES found the one defect a single page could not:
  `section` matches NESTED sections, so an outer band and the bands inside it were both taken
  and the inner content came back twice — 15 duplicated strings out of 22 on one page, 12 on
  another, which on an imported page reads as a stutter nobody typed. Only the INNERMOST
  candidates are kept, because a `<section>` wrapping the whole document is a candidate too
  and keeping the outermost would reduce every page to one band. Images are capped (24) for a
  different reason: every one is an upload, and a sponsors wall measured 36 logos — that many
  sequential round trips inside one tool call is slow, half-fails interestingly, and is not
  what anybody meant by "import this page".

  TWO MORE CAME OUT OF SWEEPING A JS-BUILT PAGE. A short BLOCK-LEVEL link is navigation, not
  a call to action — the rule stopped at "not inline" and a documentation sidebar came back as
  38 buttons, a page of pink pills where the source had a list of links. A real CTA is
  PAINTED, and the border half must check WIDTH: Tailwind's preflight sets
  `border-style: solid; border-width: 0` on every element, so testing the style alone is true
  of an entire site built with it and the first fix changed nothing. 38 → 13.

  And `capture` waited a flat 600ms, which is wrong at BOTH ends — example.com is finished
  long before it and a script-built page is not finished after it, which is the page an import
  is most likely to be pointed at. It now reuses `shoot.ts`'s own `settleDom`, the same
  MutationObserver answer for the same question: example.com 1,884 → 1,104 ms.

  A SWEEP THAT MEASURED COVERAGE — how much of the text a READER sees survives the import —
  found the three that mattered most, and none of them showed up as an error:

  - **Most of the web does not use `<p>`.** Capturing only paragraphs meant a page whose prose
    sits in a `<div>`, a `<td>` or a `<span>` came back EMPTY: news.ycombinator.com (a table
    layout) and tailwindcss.com each kept 0 of ~4,000 and ~6,000 characters. Text is now taken
    from any block that holds it, and only when nothing INSIDE it offered anything — which is
    what stops a paragraph being captured twice, once through its `<p>` and again through the
    `<div>` around it. 0% → 41% and 22%.
  - **The fallback fired on an empty candidate LIST, not an empty RESULT.** A page can offer
    `<section>`s that hold nothing this platform draws, and taking "we found candidates" as
    "we found content" returned an empty page.
  - **`maxPerSection: 40` was truncating ordinary pages, not guarding against strange ones.**
    Three dense pages each stopped at exactly 40 leaves. The bound that is actually wanted is
    on the WHOLE import (`maxNodes`, 300), so that is where it lives.

  **COVERAGE NEEDS THE RIGHT DENOMINATOR, and the first one was wrong.** Measured against
  `document.body.innerText` the sweep read 44-77%, which looked like a broken importer. Diffing
  what a reader sees against what was kept showed where it actually went: on rust-lang.org and
  python.org, 100% of the loss was NAV, HEADER and FOOTER — chrome the importer skips on
  purpose and a merchant would never want, because the target site has its own as globals.
  Content loss there was ZERO. Only the honest denominator tells you whether there is a bug,
  and the first measurement said "fix this" about something that was already right.

  What the honest measure then found was real, and both were structural:

  - **A link that is not a button contributed NOTHING.** On a page whose content IS a list of
    links that is the whole page — news.ycombinator.com lost 1,595 characters of story titles.
    The platform has no inline-link element; its own idiom is a `button` carrying `href`,
    styled flat. So an unpainted link is captured with `variant: 'link'` and takes the target's
    accent as INK rather than as fill. Painting them all is the opposite mistake: it turned a
    documentation sidebar into 38 pink pills.
  - **Two caps for one quantity meant the tighter one was always the real limit.** A page whose
    `<body>` has a single child is ONE section, so the per-section cap silently became the page
    cap: HN stopped at exactly 120 nodes. One bound now, on the whole import, and the skip is
    reported on the REAL run and not only the dry one.

  Content loss after both: 0 on three of the four pages, and the fourth is a marketing page of
  code samples hitting the 400-node ceiling, which is the ceiling doing its job.

  **FLATNESS WAS THE BIGGEST THING LEFT.** Everything arrived as one vertical column, so a
  source's three-column feature row came back as three stacked blocks and a card — image,
  heading, copy, button — as four siblings with nothing saying they belonged together.
  Everything a reader understands from the ARRANGEMENT was gone, and no amount of correct
  colour brings it back. The walk now returns a TREE: a container that genuinely lays its
  children out (`display:flex`/`grid`) with two or more of them becomes a row; a `<div>` that
  merely wraps is flattened, because reproducing it would nest the result ten deep for
  nothing. tailwindcss.com went 21.8% → 54%.

  That change needed one in the builder: **`NodeSpec` could not carry `responsive`**, so no
  node could be created with a per-breakpoint value at all — every one arrived base-only and
  needed a second `sb_set` the caller had to remember, on a repo whose design rules 1-3 are
  entirely about writing the responsive answer. An imported ROW is the case that made it
  undeniable: it must stack at mobile or the columns shrink to slivers with no box overflowing
  and nothing for `measure` to see. Merged per NAMESPACE, so seeding `mobile.style` does not
  drop an element's own `mobile.config`.

  `capture.ts` launches its OWN browser rather than sharing `shoot.ts`'s process-lifetime one:
  an import is rare, slow and runs untrusted script, and coupling that to the tool a vision
  loop calls every few hundred milliseconds is how the fast path gets slow.

- **`tagName` ON AN SVG ELEMENT IS LOWERCASE, so the ignore list's `'SVG'` and `'PATH'` had
  never once matched.** `tagName` preserves case for XML-namespaced elements while every HTML
  element reports uppercase. The entry looked like it worked because an `<svg>` that falls
  through to the text fallback contributes nothing — its `textContent` is empty. The walk now
  uppercases the tag, which is also what let `<svg>` be handled at all. Its sibling trap:
  `el.className` on an SVG element is an `SVGAnimatedString`, so `String(el.className)` is the
  literal `"[object SVGAnimatedString]"` and every class-named icon went unrecognised —
  `getAttribute('class')` is the only form that answers for both.

- **AN ICON IS LOOKED UP, NEVER GUESSED — `ICON_NAMES` is generated for exactly that.**
  `specials.name` is a PascalCase RemixIcon id and the platform ships 3,227 of them
  (`schema/src/iconManifest.json`, the same JSON the editor's picker and the Go renderer
  share). Nothing in this catalog carried them, so an `<svg>` could not become an `icon` at
  all. The name is read the way a page writes it — a sprite `<use>`, an `aria-label`, a
  `<title>`, an icon set's class — normalised, and tried as itself, `…Line` and `…Fill`.
  ANYTHING THAT DOES NOT LAND IS SKIPPED, and there is deliberately no last-word fallback:
  "Open main menu" → `MenuLine` would be right and "Acme Store" → `StoreLine` would put a shop
  glyph where a wordmark was, which is a WRONG icon and indistinguishable downstream from a
  right one. The colour is never written either — it lives in the `icon-default` preset, and a
  literal detaches every imported icon from the theme permanently.

  **AND THE `aria-hidden` RULE HAD TO YIELD TO IT.** Almost every real icon carries
  `aria-hidden="true"` — that is correct authoring, the label beside it does the talking — so
  testing the attribute before the svg branch would put the `icon` element permanently out of
  reach of a real page. An aria-hidden CONTAINER is still skipped before the walk descends.

  **AND THE CLASS BRANCH RANKED BY LENGTH, WHICH IS BACKWARDS FOR A UTILITY FRAMEWORK.** The
  comment on that branch argued "the longest hyphenated token is the id in every set seen here
  ... and a bare `w-4` cannot outrank it" — true of `w-4`, false of Tailwind. MEASURED on
  `modelcontextprotocol.io`: the candidates it produced were `["shrink-0", "text-current",
  "text-current"]`, plain utility classes, on a page whose four icons the mapper built zero of.
  Worse than a miss: running ten plausible class tokens through `iconFor` found **six of ten
  resolve to a REAL icon** (`arrow-right`, `arrow-left`, `search-line`, `menu-fold`, `user-add`,
  `shopping-cart`, `close-circle` all land; `text-current`, `shrink-0`, `chevron-down` do not) —
  so a class naming a wrapper's purpose or a layout role, not the glyph, can become a CONFIDENT
  WRONG icon, and because the rule ranked by length, a longer utility class could outrank a
  shorter genuine icon-set class sitting right beside it. The class branch now takes a token only
  when it carries a prefix a real icon set actually stamps — `ri-`, `fa-`/`fas-`/`far-`/`fal-`/
  `fab-`/`fad-`, `bi-`, `lucide-`, `mdi-`, `feather-`, `ion-`, and the generic icon-font
  convention `icon-`/`icons-` (Fontello, IcoMoon ship exactly that prefix, and no utility
  framework claims it) — the same prefixes `iconFor` already strips before matching — and ranks
  by length only AMONG those, as a tie-break rather than the whole rule. No prefixed token means
  no candidate, which is the same outcome those pages got before, now for a stated reason instead
  of a guess that could have gone either way.

- **A COLLAPSED `<details>` MEASURES AS ZERO**, so an FAQ imported as questions with no
  answers. The source's collapsed state is not content — this platform's accordion has its own
  `openItems` — so every one is opened before anything is measured. Consecutive `<details>`
  merge into ONE accordion: eight siblings is one list to the author, and eight accordions is
  seven wrappers nobody asked for with no shared open/close behaviour. `accordion` accepts only
  `accordion-content`, whose `specials.label` is the summary; the `accordion-item` skin is a
  satellite `createNode` mints on its own. The label is OMITTED when the source had none rather
  than defaulted, because inventing one ships English copy into a store that is not in English.

- **A `column` GROUP WAS BUILT AS A ROW, and `direction` had been read by nothing.** The capture
  never emits one — a column is what a page already IS, so it is flattened in the browser — so
  the field sat in `Captured` unread. The moment a caller composes a tree BY HAND (a layout
  pattern, a design ported out of Figma or Stitch) that stops being true, and every column came
  back as a row: a hero's heading, its sentence and its button side by side instead of stacked.
  Found by rendering the first pattern, not by reading the mapper.

- **A STACKED ROW'S COLUMNS WERE 280px TALL WHATEVER WAS IN THEM, and nothing could see it.**
  An imported row gives each column `flex: 1 1 280px`, which sizes the MAIN axis — and the
  row's own mobile override turns the main axis from width into HEIGHT. So at 390 a paragraph
  of two lines sat in a 280px box, and one real import measured **6,009px of page with most of
  it empty**. Zero review findings and zero layout findings at every width, because no box
  overflowed and no two boxes overlapped: **`measure` cannot see AIR**. Rule 3's mirror image —
  the stack breakpoint was there and correct, and the thing it changed underneath was the axis
  a basis applies to. Mobile-only reset to `0 1 auto`, base keeping the wide answer, because
  the row is still a row at tablet. 6,009px → 3,884px, same content.

- **AND `measure` REPORTED A COLLISION ON EVERY STOREFRONT CARD THAT HAS A BADGE, under a
  comment saying it would not.** The overlap rule's own words are that "an absolutely-positioned
  decoration over a band is a design choice" — and nothing checked, because `Box` carried no
  `position`. Every quickview badge, sale ribbon and wishlist heart sits over its product image
  BY CONSTRUCTION, so the rule fired on pages that were built correctly. MEASURED on a live home
  page: `collection-media` reported against the `icon` in its own corner, at 390px, on a page
  whose four category cards and four product cards were all exactly as designed.

  A comment describing behaviour the code does not have is the shape this file keeps finding —
  the same week as `sb_remove`'s `removing` counting patches, and as a guard being read as a
  normaliser. `Box.position` is carried now and the pair is skipped when either side is out of
  the flow.

  `relative` IS STILL REPORTED, and the line matters: a relative box still takes its space, so
  one overlapping a sibling is the negative-margin defect this check exists to find. The
  exemption is `absolute`/`fixed`/`sticky` only, and a test pins both directions so it cannot
  widen into "anything that is not static".

  Touching `src/vision/**` means the browser suite: `SB_BROWSER_TEST=1 npm test`, 992 passing.
  RUN IT FROM THE REPO ROOT — several tests resolve paths through `process.cwd()`, so
  `npx vitest --root <repo>` from elsewhere fails 8 of them on cwd alone and the failure looks
  like a code defect rather than an invocation one.

- **AND THEN NOTHING LINKED THE IMPORTED PAGES TOGETHER, which the directive had been saying
  out loud since the tool shipped.** `sb_import_site` now builds ONE global `header` from the
  pages it created and gives every one of them a reference to it. Built from THOSE pages, never
  from the source's own nav — that one points at the site this was copied from, half of it at
  pages the cap left out, and its structure is somebody else's, which is why the capture skips
  page chrome in the first place.

  The shapes, both read off the platform rather than guessed and both verified against a live
  server: a global's `document` is page-document SHAPED but its `root_node_id` IS THE SECTION —
  compose carries its nodes over and re-parents that root onto the page's ROOT
  (`compose.go:133`) — so the section is built under a throwaway ROOT and lifted out with its
  parent cleared. A page REFERENCES one with a ROOT child that is a `flex-section` carrying
  `specials.globalRef` + `globalKind`, which is exactly what the platform's own decompose writes
  (`decompose.go:382`). It goes in FIRST: compose turns it into a real header, and a header
  after middle content is a band-order refusal on the next save. Measured end to end — create
  201, save 200, and the re-read page came back with the reference expanded into a stamped
  header whose menu carried the local paths.

  SKIPPED WHEN THE SITE ALREADY HAS A HEADER, because a second one is two headers rather than a
  menu, and under two pages, because a menu to one page is a link to itself. A page that will
  not take the header does not undo the header: the master exists and the others carry it.

- **AN IMPORTED SITE'S MENU LED BACK TO THE SITE IT WAS COPIED FROM.** A captured link keeps
  the source's ABSOLUTE URL, so `sb_import_site` built twelve pages and left no way to reach any
  of them — every click went off to the original. The most basic feature a website has, and the
  import was working against it. `relink` rewrites only the targets that were ACTUALLY
  imported: a same-origin link the page cap left out keeps its original URL and is COUNTED,
  because an off-site link that works beats a local one that 404s, and the count is what tells
  the caller to raise `max_pages`. The map is built before the first page is written, since
  page two's link to page seven has to work and page seven does not exist yet. **The FRAGMENT
  survives the rewrite**: `normalizeUrl` drops it because it is not part of a page's IDENTITY —
  that is exactly what folds `/a` and `/a#top` into one page — but it is very much part of the
  link, and blender.org's community page carries sixteen of them (`#vi`, `#de`, one per
  language section) that would all have collapsed onto the top of the page.

- **A FORM IS SEEN AND NOT REBUILT.** `FORM` sat in the ignore list, so a contact page arrived
  with no way to contact anybody and nothing saying why. Rebuilding one means guessing the
  `mapTo` vocabulary the server validates, which is the guess this catalog exists to remove —
  and `sb_store action:"form"` already owns it with all 17 templates. So the capture RECORDS
  what it saw (`forms_found`: field count and labels) and the result names the tool. The
  controls stay in the ignore list: a stray input outside a form is chrome, and the fields of a
  form that IS reported are counted rather than walked into.

- **THE IMPORT'S BIGGEST LOSS WAS A `<div class="footer-navigation">`.** Page chrome was
  detected by asking whether a `<header>`/`<footer>` was a DIRECT CHILD of `<body>`, which
  almost no real site satisfies — one wrapper div defeats it — and blender.org marks its site
  map with a class rather than the tag at all. Measured on `/about`: eleven sections of
  somebody else's link columns arrived as the page, and the page's own eleven headings and
  twenty-five paragraphs did not. Three corrections, each of which was necessary and none of
  which was sufficient:
  - **PAGE-LEVEL IS A SPEC QUESTION, NOT A DEPTH ONE.** A `<header>`/`<footer>` belongs to its
    nearest SECTIONING ancestor (`article`, `aside`, `nav`, `section`), so one with none of
    those above it is the page's however deeply wrapped. `<main>` is not sectioning content and
    does not shield a footer.
  - **ASK ABOUT CONTAINMENT, NOT EQUALITY.** The candidate walk deliberately takes the
    INNERMOST sections, and a real footer holds `<section>`s — so the candidates were the
    footer's own columns, none of which IS the footer.
  - **A CLASS NAME IS EVIDENCE FOR A FOOTER AND NOT FOR A HEADER.** The token must START with
    `footer` (so `card-footer` is not swept up), and the same trick on the header side would
    eat HEROES — blender's first band is `<div class="hero header-size-large">`. Losing the
    first thing on a landing page costs more than a stray footer, so a header is caught by its
    tag or `role="banner"` only; its links are `<nav>`, which is ignored already.

  **AND THE FIX'S OWN FIRST ATTEMPT NAMED THE SET `chrome`, WHICH IS A BROWSER GLOBAL.** The
  `const` landed in a nested scope, so every other scope resolved the name to `window.chrome`
  and threw `chrome.has is not a function` inside `evaluate` — killing the whole capture. Same
  shape as the closure trap this file already records for `page.evaluate`, reached from the
  opposite direction: not a name that is missing, a name that is already taken.

- **IFRAME WAS IN THE IGNORE LIST, so every embedded video and every map was unimportable.**
  The platform has `video`, `youtube`, `vimeo`, `soundcloud` and `google-map`, and a hero video
  or a contact page's map is an ordinary thing to bring over — it was the one class of content
  that could not survive the trip at all, and it left as a skip count. `youtube` and `vimeo`
  store the ID ALONE (`specials.videoId`); a whole watch URL renders an empty frame.
  `google-map` takes the embed URL under `src`, `soundcloud` takes it under `trackUrl`, and
  `<hr>` is a `divider`. None of them is given a style: every one seeds `width: 100%` +
  `height: fit-content` and `google-map` seeds a height per breakpoint, so a literal detaches
  the node from the element's own responsive answer to be less correct than it. What still has
  no element — an advert, a tracker, a comment system — is counted rather than guessed at.

- **FOUR MORE THINGS A CRAWL GOT WRONG, all measured on real sites.**
  - **`<link rel="canonical">` IS NOT A FLOURISH.** modelcontextprotocol.io's home page names a
    dated docs path as its own address, so `/` and that path are one page — imported twice
    under two slugs, with nothing in the plan looking wrong. Folded on the crawl path (where
    the answer is in hand) and again in the import pass (a sitemap cannot know it; only the
    open page can).
  - **ONE PAGE PER PAGE, NOT ONE PER LANGUAGE.** A multilingual sitemap lists every
    translation. Folded ONLY on a collision — a rule that simply dropped a `/xx/` prefix would
    empty the plan for nodejs.org, which serves everything under `/en`.
  - **PAGE 2 OF A LIST IS NOT A PAGE.** nodejs.org offered 539 of them. Narrow on purpose: an
    explicit `page` segment only, because `/blog/2024` is a year archive and a real page.
  - **`robots.txt` IS THE SITE'S OWN ANSWER** to the question the plumbing list guesses at, and
    a tool that fetches a dozen pages should obey it. Longest match wins, so an `Allow` under a
    `Disallow` is honoured; an empty `Disallow:` means allow everything and reading it as the
    empty prefix would block every path. The ENTRY is exempt — the caller typed it.
  - **`aria-hidden="true"` IS THE AUTHOR'S OWN MARK** for decoration and for duplicates: a
    carousel's clones, the mobile copy of a menu the desktop layout also carries. Measured 53
    on one page and 15 on another, every one walked. Nothing here reads the accessibility tree,
    so the attribute is the only place that answer exists — and re-measuring after showed it
    reclassifies rather than loses: the captured content was unchanged.

- **A NESTED LIST WAS TAKEN TWICE.** `querySelectorAll('li')` returns nested items as well as
  outer ones, and an outer item's `textContent` ALREADY contains its sublist — so every nested
  entry arrived once inside its parent's line and once again on its own, which on an imported
  page reads as a stutter nobody typed. Walked by DIRECT children, each item's own words
  separated from its sublist's, the sublist flattened after it. This platform's `list` is flat,
  so flattening is the honest translation and the reader's order survives.

- **A GRID IS NOT A ROW, AND A ROW OF 279 IS NOT A ROW EITHER.** The import's flatness fix
  reads `display:flex|grid` and turns a container with two or more children into a real row.
  Every grid was taken as a single row with no upper bound, so a documentation site — whose
  content wrapper IS a grid — came back as one flex row of 279 columns: each column a sliver,
  every line of prose broken to one word, 80 nodes hanging past the viewport, on a page whose
  tree was perfect. A design row is a feature trio, a card shelf, a logo wall; past a dozen
  the container is the page's own content column and the browser is wrapping it. Capped at 12,
  and a grid now carries `wrap: true` — `flexWrap` reads `nowrap` on a grid because the
  property does not apply, and carrying that literally gave the columns nowhere to go.

- **WALKING INTO A CODE BLOCK PRODUCES RUBBLE.** Every syntax highlighter wraps each token in
  its own `<span>`, so the leaf walk took them one at a time: a twenty-line JSON config
  arrived as forty text nodes — `{`, `"mcpServers"`, `: {` — each its own block on its own
  line, and forty of the node budget spent to say what one node says. `PRE` and `CODE` are
  taken whole. Whitespace collapses like any other text, because this platform has no code
  element to preserve it in.

- **THE IMPORT COULD READ A PAGE AND NOT A SITE, and the missing half was never the
  capture.** `sb_import` takes a URL and writes into the OPEN page, so "here is our website,
  put it on Store Builder" — the thing people actually ask for — was a loop the agent had to
  run by hand: find the pages, create each, open each, import each, and get every step right
  with no tool checking any of them. `sb_import_site` runs it. What the work taught, each of
  which fails quietly:

  - **APPENDING TO ROOT BREAKS TRAP 3 ON ANY PAGE THAT HAS A GLOBAL FOOTER**, and this is the
    DEFAULT path: the entry URL is imported into the site's existing home page, which is
    exactly the page most likely to carry both globals. `data.nodes.length` puts the section
    after the footer, `checkBandOrder` refuses the save, and the caller is told about a band
    rule they did not knowingly break. `middleEnd()` is the index to add at — before the first
    footer-banded ROOT child — and `sb_import` had the same append, predating this.
  - **`URL.pathname` IS PERCENT-ENCODED, and this platform is Vietnamese first.** A slug
    derived from it turns `/trang-chủ` into `trang-ch-e1-bb-a7`, and an `include: ['/tin-tức']`
    matches nothing. `pathOf` decodes, guarded — a malformed sequence throws, and a path that
    cannot be decoded is better matched raw than not at all. NFD does not decompose `đ`
    either: it is a letter, not a d with a stroke, so `Đẹp` strips to `ep` without the
    explicit replacement.
  - **A SUBSTRING TEST DROPS REAL PAGES.** The plumbing list (`/cart`, `/feed`, `/comments`)
    matched with `includes`, so `/cartier-watches`, `/feedback` and `/comments-policy` were all
    thrown away and reported only as a number. A plain entry matches at a BOUNDARY — end, `/`,
    or `.` so `/wp-login.php` is still caught — and an entry written with a trailing slash
    matches that segment anywhere, which is how `/blog/tag/x` is caught. **Anchoring it at the
    START of the path was the first fix and it was half a fix**: a locale prefix is the
    ordinary shape of the sites this is pointed at and this platform's market is Vietnamese,
    so `/en/cart` and `/vi/account` sailed through. The needle begins with `/`, so its left
    boundary comes free — scan anywhere, test the right boundary only.
  - **FILTERING TWICE AND COUNTING ONCE IS HOW A REASON DISAPPEARS.** `canonFor` exists to
    stop a CRAWL spending a navigation on a PDF; `choosePages` decides what becomes a page and
    counts every rejection. A sitemap costs no navigation, so running it through the crawl
    filter saved nothing and meant the cart page vanished with no line in `skipped` saying so.
  - **ORDER IS PART OF THE ANSWER.** A sitemap lists what its generator emitted first, which
    on a shop is a hundred products; taking the first twelve gives a site with no home page.
    Shallowest first, entry always first.
  - **N URLS UNDER ONE PREFIX ARE NOT N PAGES HERE.** `/products/{slug}` resolves to the
    published page of type `product`. Imported as static pages they render a shop where every
    price is a literal and nothing is buyable, and `sb_review` then reports a missing purchase
    action on forty pages at once. The prefix and its count are reported BEFORE anything is
    created, because afterwards the fix is forty deletes.
  - **A COLLIDING SLUG IS SKIPPED, NOT CREATED.** The platform renames and answers 200 (the
    `uniqueSlug` trap this file already records), so a second run of the tool would silently
    double the site.
  - **TOKENS COME OFF THE SITE ONCE, NOT OFF EACH TARGET PAGE.** Most targets do not exist yet
    and the rest are blank, so per-page reading gives the first page element defaults and
    every later page the defaults of the blank page before it — rule 0 failing on every page
    at once.
  - **IT IS NOT ATOMIC AND MUST NOT PRETEND TO BE.** Each page is its own create and its own
    save, so one failure is an OUTCOME (`built` / `failed`, per URL with a reason), never an
    abort that leaves three pages built, nine not, and no report saying which.
  - **`depth` IS HOW FAR FROM THE ENTRY A PAGE MAY BE**, so the pages at that distance are
    results and are never opened — opening them would pay a navigation each for links the
    bound has already ruled out. The import pass opens them anyway.
  - **A SITEMAP FETCH LEAVES THE PLATFORM, so it carries no credential.** Every path through
    `request()` attaches one; a sitemap read through it would hand this install's `SB_TOKEN`
    to a stranger's server because the caller pasted a link.

  It publishes nothing, and it says so once: the source's header and footer are skipped on
  purpose (this site has its own as globals), no menu links the new pages together, and
  nothing has been seen at 390px.

- **A FUNCTION PASSED TO `page.evaluate` IS SERIALIZED, so anything it closes over is not
  there.** It compiles, every pure test passes, and it dies on the first real page. Measured:
  `capturePage` closed over a module-level `const HEADINGS` and threw
  `ReferenceError: HEADINGS is not defined` — in a file that already carried a comment saying
  exactly that about itself. The rule is therefore mechanical rather than a matter of care:
  everything such a function uses is either declared INSIDE it or passed as an argument
  (`settleDom` takes `{quiet, cap}`; the overlay opener takes `id`), and every evaluate site
  has a test behind `SB_BROWSER_TEST=1`, because nothing cheaper can catch it. A sweep after
  the fix found `shoot.ts`'s five sites already clean.

  The same run found the second half of the pair: `new URL(rel, base)` THROWS on a
  non-hierarchical base (a `data:` page), and a throw inside `evaluate` kills the whole
  capture rather than one link — so URL resolution falls back to the raw value.

- **`shoot()` POOLS ITS BROWSER FOR THE PROCESS LIFETIME, and a caller that forgets
  `closeBrowser()` never exits.** The pooling is deliberate — a vision loop shoots constantly
  and must not pay a launch each time — but the cost lands on every other call site, and there
  was a `beforeExit` handler that looked like it covered them and could not. `beforeExit` runs
  when the event loop DRAINS, and an open browser connection is precisely what stops it
  draining: in the one situation the handler described it was unreachable, and in the other it
  had nothing to do. Measured: a script that took one screenshot and returned was still alive
  twenty seconds later, and two such scripts were killed by the OS for memory during this
  repo's own work. `playwright-core` exposes no `browser.process()` for `launch()`, so there is
  nothing to `unref` and no way to make the handler reachable — it is gone, and the contract is
  written down instead. SIGINT/SIGTERM still close Chrome, which is the path the stdio server
  actually takes.

- **A `<video>` WITH A POSTER WAS DROPPED, AND IT WAS THE ONE MOST WORTH TAKING.** `visible()`
  treated a zero box as hidden, which is right for an element that sizes itself from its
  CONTENT and wrong for one that sizes itself from its MEDIA: a `<video>` measures its
  `poster` before anything plays, so one whose poster has not resolved measures 0×0 while
  being perfectly present — Chrome only falls back to 300×150 once that load has actually
  FAILED. Measured across four spellings: `<video src poster>` with no width/height was
  skipped with nothing but a `hidden` count, while the same element carrying `width`/`height`
  — or carrying NO poster — came through. So the import kept the bare videos and lost the ones
  with a still frame on them, on exactly the pages slow enough to lose the race.

  The fix is narrow on purpose — a `<video>` only, and only when it names something to play or
  to show, so an empty `<video></video>` goes on being skipped.

  **IT HAD BEEN BROKEN ON THE COMMITTED TREE AND NOTHING SAID SO.** The browser suite is
  opt-in (`SB_BROWSER_TEST=1`) and the standard gate — `build && test && smoke` — does not run
  it, so the test that names this case sat green-by-absence. That is the "a skip that reads as
  green" failure this file already records about `src/vision/**`, caught this time only
  because the suite was finally run. Run `SB_BROWSER_TEST=1 npx vitest run` after touching
  anything under `src/vision/`, and periodically even when you have not.

- **AN IMPORT WAITED FOR THIRD-PARTY IFRAMES IT NEVER READS.** `capture` navigated with
  `waitUntil: 'load'`, which waits for every SUBRESOURCE — and the walk reads an iframe's `src`
  ATTRIBUTE and never needs the frame to render at all. So a page carrying an ad frame, a chat
  widget or a slow video embed stalled the whole capture for up to thirty seconds and then
  THREW, losing an import whose DOM had been ready the entire time.

  Found by this repo's own suite rather than by reading: the embed test's fixture carries real
  YouTube, Vimeo and Google Maps frames, and it began failing at exactly 30,000 ms with nothing
  about the page or the test having changed. A network dependency inside what reads as a pure
  DOM test — which is the second lesson, and the reason the failure looked like a regression in
  code that had not moved.

  `domcontentloaded` plus `settleDom`, which is the SAME correction `sb_look` already paid for
  one wait earlier: the right question is "has the DOM stopped changing", and the MutationObserver
  answers it directly and bounded. ttgshop.vn is unchanged to the node — 4 sections, 1,617 texts,
  96 images, 83 buttons. The SHOOT path still waits for `load`, because a photograph genuinely
  wants its images.

- **A CAPTURE COULD NOT SAY IT HAD READ ALMOST NOTHING, because SETTLING IS NOT FAILING.** A
  page read while it is still building returns a small, correct-looking result: `skipped` empty,
  no error, a handful of nodes. MEASURED on ttgshop.vn on an afternoon it was taking 45 SECONDS
  to answer for 151 KB, having served the same page in 4.6s all morning — the capture kept 6 text
  nodes and 114 characters, and nothing in the answer said so. A thin import that says so is one
  a caller retries; a silent one ships.

  `coverage` is the per cent of the page's own NON-CHROME text that survived, against the
  denominator this file already argues for — chrome is skipped ON PURPOSE, so counting it would
  make every correct import of a nav-heavy site look broken. Both halves were already computed
  for the fallback decision, so it costs nothing. 100 for a page with no text, because an empty
  page is not a failed import and a zero would send a caller to fix what is already right.

  **AND THE NUMBER THEN EARNED ITS KEEP IMMEDIATELY, by exonerating the importer.** `/tin-tuc`
  came back with 7 text nodes and reported 20%, which reads as a defect — and the page itself
  holds SEVEN content links, all of them breadcrumb and category tabs, with no article rendered
  at all. The tool was right and the page was empty. Without the number that is indistinguishable
  from a thin import, and the afternoon goes into the walk.

  Two knobs arrived with it, both because a bound tuned for a healthy origin is wrong for a
  struggling one and neither could be reached: `nav_timeout_ms` (how long to wait for an answer
  at all, default 30,000 — a merchant importing their OWN slow site had no recourse) and
  `settleMs` (how long to let the DOM keep changing, default 2,000). The timeout message names
  the remedy rather than the browser — and it reads the number OUT OF THE ERROR, because the
  first version printed the default and told a caller who had already raised the budget to 90s
  that the page "did not answer within 30s", which is a confidently wrong number that sends them
  to change the setting they just changed.

- **AND THAT NUMBER THEN REACHED NOBODY FOR AS LONG AS IT EXISTED, while the measure behind it
  scored every list at ZERO.** `coverage` was computed, typed on `CaptureResult` and asserted by
  three tests — and not ONE of the three places that answer a caller carried it: the dry run, the
  real single-page run, and each page of `sb_import_site`. The same shape this file already
  records for the compose `warnings` ("typed on the response and read by nothing for three
  phases"), on the one field whose whole purpose is to say the import was thin. Found by crawling
  ttgshop.vn and having to read it out of `dist/` with a script to see it at all.

  The measure was also wrong wherever a list appeared. `textOf` summed `c.text` alone, and a list
  `Captured` carries `items: string[]` and NEVER a `text` — so a page's lists counted for nothing.
  Measured on `ttgshop.vn/quy-dinh-bao-hanh`: 800 characters counted against 4,012 characters of
  list, reported **28%** for a capture that had taken the page nearly whole.

  **And the report was the least of it, because that function does three jobs.** It decides
  whether the wider-root fallback runs (`< contentChars * 0.5`, which a list-heavy page could not
  help tripping), and then WHICH OF THE TWO TREES WINS — where a zero does not miscount, it
  LOSES CONTENT. Measured on a heading over a four-item list: the correct capture scored 0, the
  wider root scored the four items as four loose paragraphs and won, and the page came back with
  its heading GONE and each item its own section. A structural loss, caused by a reporting bug,
  on a page whose `skipped` said nothing.

  The order matters and is worth keeping: printing `coverage` FIRST would have been worse than
  silence, telling callers to retry the imports that were already right. Fixed the measure, then
  the report — 28% → 100% on that page, 18% unchanged on the shop's home, which is the node
  ceiling doing its job on a 2,400-product catalogue. Clamped at 100, because a number above 100
  makes the honest ones untrustworthy too — see the entry below for what the clamp is guarding
  against now.

- **AND THEN `coverage` UNDER-REPORTED EVERY PAGE MADE OF MORE THAN ONE BLOCK, because the two
  sides of the ratio were never the same units.** `kept` is every captured node's own text,
  CONCATENATED WITH NO SEPARATOR; the denominator was `body.innerText`, which inserts a newline
  between every block-level element. So a page built of many separate blocks — every one of them
  kept, nothing dropped — read under 100% anyway, and the gap widened with the block count rather
  than with anything actually missing. MEASURED: a 40-paragraph fixture with every paragraph
  captured (`skipped: {}`) read 80%. On the offline fidelity baseline: rust-lang.org 90% → 92%,
  example.com 97% → 100%, ttgshop.vn's warranty page unchanged at 100% (few enough blocks that
  the old gap rounded away).

  Fixed by stripping ALL whitespace — not collapsing it to one space, which would still count
  the between-block gap as a character — from both `kept` and `contentChars` before dividing.
  `structure` is untouched by construction: the fix only changes how the same captured tree is
  MEASURED, never what the walk keeps.

  The old clamp comment blamed "the numerator is the walk's own text and the denominator is
  `innerText`" for the possibility of landing over 100 — which was really the whitespace mismatch
  wearing a different hat, on a page that is almost all list. Stripping whitespace on both sides
  removes that specific cause; the clamp stays anyway, because the two sides are still built by
  two different walks of the page and a small positive drift on an unusual page is not ruled out.

  **A SECOND CAUSE SURVIVED THE FIX, AND IT HAS SINCE BEEN CLOSED — IT WAS NEVER ONLY
  `aria-hidden`.** `aria-hidden="true"` does not affect layout, so `innerText` counted that text
  while the walk deliberately skipped it — the author's own mark for decoration and for
  duplicates. MEASURED on `modelcontextprotocol.io`: 351 of 2,588 non-whitespace characters,
  13.6%, which accounted for that fixture reading 73-75% rather than the high eighties. This was
  recorded as a residual the denominator could not reach, because the denominator subtracted
  page chrome ALONE — every other reason the walk turns something away (an element it judges
  `hidden`, a `<nav>`, a form control and its labels, a `<script>`/`<style>` body, a panel set
  with no readable labels) read as lost content by the exact same mistake, `aria-hidden` was
  simply the loudest instance of it on this one fixture.

  `DECLINED` in `capturePage` is now that whole set — every `skip()` reason that is the walk
  DECIDING something is not content, as opposed to running OUT OF ROOM for content it never
  disputed was real. `skip` sums each decline's own `innerText` into `declinedChars`, subtracted
  from the denominator beside `chromeChars` — the exact treatment `pageChromeRoots` already gave
  chrome, generalised to every other considered decline. What is deliberately NOT in `DECLINED`:
  `over-node-limit`, `over-section-limit`, `over-image-limit`, `text-too-long` — a quota running
  out is the walk FAILING to reach real content, not deciding it is not content, and it has to
  keep pulling the number down or a page read before it finished building would look no
  different from one read whole. Pinned by two tests in `test/import.test.ts`: a page the walk
  takes entirely, plus an `aria-hidden` block holding real text, now reads at or near 100 where
  it read 44 before the fix; a page whose `maxNodes` is set below its own paragraph count still
  reads well under 50.

  **THE BIMODAL FIXTURE IS STILL BIMODAL, and that is the honest result of this fix rather than a
  failure of it.** `modelcontextprotocol.io` used to settle into one of two `content` values two
  points apart — 73 or 75 — because `capture`'s settle window catches a script-built page at one
  of two DOM states some fraction of the time; RULED OUT as a `settleDom` bound before this work
  (four captures each at `settleMs` 2,000/5,000/9,000 stayed bimodal at every setting, both
  values appearing at 9 seconds). This fix changes how the SAME captured tree is MEASURED, never
  which tree gets captured, so it could not touch that and did not: five offline runs after
  landing it read 76/9.6 once and 87/11.9 four times — the same two `structure` values as
  before, unmoved, which is exactly the property this fix is required to hold — each now paired
  with a HIGHER `content` because both states carry declinable material the old denominator was
  charging against them regardless. The gap between the two `content` readings widened, from 2
  points to 11, which says the two DOM states differ in how much of THAT gap is decline-shaped
  and not only in how much is genuinely missing — but the cause of the bimodality itself is
  exactly as open as it was. This fix answers "how much of a captured page is honestly missing";
  it was never going to answer "why does this one page settle into two different trees", and it
  has not.

  **AND THE DENOMINATOR USED A NARROWER DEFINITION OF CHROME THAN THE WALK DID, on a fixture
  neither residual above is about.** `inPageChrome` recognises a footer by a class or id
  starting with `footer` as well as by tag — deliberately, since blender.org's own site map
  carried no `<footer>` tag anywhere near it — and the walk honours that. The `chromeChars`
  subtraction did not: it re-derived chrome with its own `querySelectorAll('header, nav,
  footer')` and filtered by TAG, so a class-only footer the walk correctly skipped was still
  counted as lost content in the denominator. Fixed by summing `pageChromeRoots` ITSELF rather
  than re-deriving chrome by tag — one source of truth for what chrome is — with no membership
  test needed on top of it, because `pageChromeRoots` is built so that no root it holds contains
  another (a nested candidate is dropped at construction), so summing every root's own
  `innerText` double-counts nothing.

  MEASURED ON A SYNTHETIC FIXTURE: a `<div class="footer-navigation">` of link text beside a
  `<main>` the walk kept whole read **25%** under the old rule, **≥97%** after —
  `test/import.test.ts`'s `does not count a footer-shaped DIV against the denominator`. This was
  a real, general defect, closed and tested.

  **It is NOT the explanation for the paragraph below, though it looked like it should be.**
  Re-measured against the live `rust-lang.org` page the same day this was fixed: the page's
  chrome sums to the identical 479 characters (one `<header>`, one `<footer>`, both already
  caught by tag) under the old rule and the new one, because it currently carries no class- or
  id-matched footer distinct from the ones tag alone already catches. So this fix changed
  nothing on this page, and the gap below stayed open a while longer.

  **`rust-lang.org` READ 92% FOR A DIFFERENT REASON, AND THE DECLINE FIX ABOVE DID NOT TOUCH IT
  EITHER — MEASURED, NOT ASSUMED, and the measurement named the cause.** Capturing the page
  directly with a generous `maxNodes` returns `skipped: {}` — literally nothing the walk ever
  visited was declined, so `declinedChars` was zero on this page and the fix in this entry
  changed its number by construction. Diffing `body.innerText` against every top-level section
  candidate PLUS every chrome root found the 180 missing characters by hand: `Install`, `Learn`,
  `Playground`, `Tools`, `Governance`, `Funding`, `Community`, `Blog`, and a hidden language
  `<select>` — the page's own top navigation. It is a bare `<nav>` sitting as a DIRECT CHILD OF
  `<body>`, not inside a `<header>` — so `inPageChrome` does not count it as chrome — and not
  inside any of `main > section, body > section, section, main > div` either, so it is never
  among the section CANDIDATES. Its text sits in `body.innerText`, the denominator, and was
  visited by NOTHING: it never reached a `skip()` call at all, which is exactly why it showed up
  as a gap with an empty `skipped` rather than a `nav` count.

  That was a THIRD kind of gap, distinct from both halves this entry otherwise names: not a
  decline (the walk never looked at it to decline it) and not a budget failure (nothing ran
  out) — a piece of the page the section-CANDIDATE scan simply never reaches. First left open
  rather than folded into that fix, on the reasoning that closing it well meant deciding whether
  a bare top-level `<nav>` should join `inPageChrome`'s definition of chrome — a documentation
  page's own in-content table-of-contents `<nav>` is not page chrome, and the two are not
  distinguishable by tag alone, so that looked like a real design question rather than an
  obvious yes.

  **IT IS FIXED NOW, AND THE DESIGN QUESTION TURNED OUT TO BE THE WRONG ONE TO ASK.** Whether a
  bare top-level `<nav>` is CHROME was never the thing the denominator needed to know — chrome
  is a classification the WALK cares about (it decides what `sb_import` keeps), and coverage
  only needs to know what the walk will NEVER keep, which the walk already states outright as
  its own `IGNORE` set. A `<nav>` is unconditionally in it regardless of where it sits, whether
  it is a docs page's table of contents or a shop's top menu — this platform's `sb_import`
  builds no page chrome from either, ever. So the fix asks that question instead: `NAV`,
  `SELECT` and `TEXTAREA` are the three `IGNORE` members that can carry real text (`SCRIPT`,
  `STYLE`, `NOSCRIPT` and `TEMPLATE` are never rendered; `CANVAS` and `PATH` carry no prose on
  any page measured here; `INPUT` is a void element with no children; `SVG` already routes
  through `declinedChars` via its own branch whenever the walk reaches one), and a document-wide
  scan for them — `ignoredTextRoots`, run once, statically, before the walk, the same treatment
  `pageChromeRoots` already gives chrome — sums their text out of the denominator whether the
  walk ever visits them or not. `SELECT` is not a guess either: the same diff that found the bare
  `<nav>` found a "hidden" language `<select>` beside it, and a native `<select>`'s `<option>`
  text turns out to surface through `innerText` even though the control shows only one value at
  a time — a second, quieter instance of the identical gap.

  Guarded against the same double-counting hazard `pageChromeRoots` already reasons about, and
  by the same means: a candidate already inside `pageChromeRoots` is skipped (chrome already
  subtracts it once, via `chromeChars`); a candidate inside a `<form>` or an `[aria-hidden="true"]`
  block is skipped too, because either one swallows its WHOLE subtree — select, textarea and nav
  included — into `declinedChars` the moment the walk actually visits it, and counting the same
  characters again here would double them without this scan ever being able to tell whether that
  visit will happen; and a candidate already inside another `ignoredTextRoots` entry (a
  `<select>` inside a `<nav>` menu) is skipped for the reason `pageChromeRoots` itself relies on
  — `querySelectorAll` returns matches in document order, so a parent is always pushed before
  any descendant that also matches. `nav`, `select` and `textarea` came OUT of `DECLINED`
  in the same motion, so the walk-time path and this static one never price the same
  characters twice: whichever of the two ends up being the one that saw a given element, it is
  the only one that ever will.

  **So the three mysteries this file once treated as one turned out to be two, and now zero.**
  The `aria-hidden` residual and "coverage counts a decline as a loss" were the same mistake,
  and the earlier fix in this entry closed both — every fixture with declinable content moved
  with it, which was the confirmation the diagnosis was right about the part it was right about.
  `rust-lang.org`'s 92% was never that mistake: an earlier pass through this file had already
  measured `aria-hidden` at zero on this page and ruled it out, correctly. It read 92% for the
  reason traced above, and this fix closes it: measured offline, `www.rust-lang.org/` moved
  92 → 100 on both widths, `structure` unmoved at 0 (this fix only changes how the same captured
  tree is MEASURED, never what the walk keeps). The honest label for it went from "nobody knows
  why" to "known, and deliberately not fixed here" to fixed.

- **AND `shape.ts` REPEATED `textOf`'s EXACT MISTAKE, ON THE OTHER AXIS, BECAUSE NOTHING SAID A
  CAPTURED TREE HAS TWO PLACES CONTENT CAN LIVE.** `textOf` above summed `c.text` alone and
  scored a list's `items: string[]` as zero — this file's own record of that bug was written
  first. `shapeOf` (`src/domains/site/shape.ts`) was written AFTER it and walked `children`
  alone, which is the identical omission one level up: a captured `list` never carries
  `children`, so every list counted as a LEAF in the histogram while the `list-item` nodes the
  mapper actually builds from those same `items` are real children with a real fanout. The two
  trees disagreed in shape BY CONSTRUCTION, on every page that has a list, and `structure`
  reported the disagreement as arrangement lost when nothing was lost. Measured on
  `ttgshop.vn/quy-dinh-bao-hanh` (7 captured lists): `structure` read **21.7**, the largest
  non-zero value in the whole fixture set, entirely this artifact.

  Fixed the same way `textOf` was: `TreeLike.items?: unknown[]` (structural, so the module still
  takes both `Captured` and `NodeSpec` without importing either), each entry counted as a leaf
  child, composing with the transparency rule rather than bypassing it — a list of exactly one
  item is a single-child node like any other and collapses. Offline baseline:
  `quy-dinh-bao-hanh` 21.7 → 0; `modelcontextprotocol.io` (which also carries lists) 11.9 → 4.3;
  `content` unmoved on every fixture, because this touches only the shape histogram.

  **The lesson is the pattern, not the bug**: a measure that walks a captured tree by `children`
  and does not also check `items` will silently score every list as empty, on whichever axis it
  measures. Two functions have now made that exact mistake independently. The next one written
  against `Captured` should check both before it ships, not after a fixture measures it.

- **AN IMPORTED PAGE COULD LOOK LIKE ITS SOURCE, OR STAY RE-THEMABLE, BUT NOT BOTH — until the
  colour moved to the layer that outranks nothing.** A literal written on a node OUTRANKS its
  style preset PERMANENTLY, which this file already records for a plain `sb_set` call; it is
  just as true of a colour an importer stamps onto every heading and every button. The only way
  to get the source's own look without paying that price is to never touch the node at all: move
  the source's design into the TARGET site's theme and leave the nodes referring to it, the same
  layer `sb_node_read`'s preset flattening already reads from.

  So `sb_import_site` now reads the entry page's own capture — the SAME one it already fetched to
  build that page's content, never a second fetch — into `sourceTokens` (five colour roles:
  heading, text, primary, muted, background; a heading/text type scale) and patches them onto
  `PUT /api/sites/{siteId}/theme`. `themePatchFor` builds the patch and `null`s out rather than
  sending `{}` when the source expressed nothing, because an empty-looking body against this
  replace-only endpoint is the shape that once cost a live site its whole palette; a colour role
  the source did not express is left alone, never zeroed. Reported as `theme.changed`
  (`sb_theme`'s own `what`/`from`/`to` shape) and never allowed to fail the import — the pages are
  the deliverable, and a theme write that does not take is a reported line, the same rule an
  image-upload failure already follows by keeping the node's original URL.

  **The limit worth saying plainly rather than papering over:** `content` and `structure` scoring
  cannot see a colour at all, so neither can show this helped. Only `visual` scoring could, and no
  online run of it has been possible in this environment. What would settle it is a `visual`
  comparison, over a live network, of an imported page against its source before and after this
  patch — not a claim this file cannot back with a measurement.

  **Measured after landing, offline, twice:** `SB_FIDELITY_OFFLINE=1 npm run fidelity` came back
  with `content` and `structure` unchanged on four of five fixtures — the fifth,
  `modelcontextprotocol.io/`, is the already-documented bimodal one (below) and both runs landed
  on its `73 / 11.9` state, not a new one. That is the expected result, not a demonstrated
  benefit: it confirms the mapper still ignores what `capture` samples (the property Task 1's own
  test pins — `'DOES NOT change what the mapper produces'`, `test/import.test.ts`), which is a
  check for a REGRESSION, not for whether an imported page now looks more like its source. This
  phase's benefit STAYS unmeasured until someone runs `SB_FIDELITY=1` against a live site and
  reads `visual`, before and after — no online run has happened in any environment this work has
  had access to, so that number does not exist yet anywhere, not just here.

- **TWO CORRECT FEATURES CANCELLED EACH OTHER, AND THE CASCADE DECIDED WHICH WON.** The theme
  write above and `tokensFromPage`/`toSpecs` (Task 2, `importmap.ts`) were built in different
  phases, each unaware of the other, and each individually correct: one moves the source's
  palette into the TARGET site's theme, the other dresses every imported heading, text and
  button in that SAME site's own tokens so an import matches the page it lands on. Running
  BOTH in one call means `toSpecs` stamps `color`/`fontSize` as a LITERAL on the very nodes the
  theme write just gave a matching preset value to — and a literal on a node outranks the
  preset beneath it PERMANENTLY (the THEME_VERSION 6 rule this file already keeps for icons).
  So the theme write landed, correctly, and was invisible on every page built in the same run.

  MEASURED on a live site this install points at: the theme's `colors.heading` sat at the
  starter's untouched `#111827` while the hero heading carried `style.color: #d64569` as a
  literal, `specials.stylePreset` unset (so it resolves to `heading-default`) — every visible
  design decision on that site lived on nodes, and the theme had never been written at all.
  `sb_import_site` would have reproduced exactly that shape: write the theme, then stamp the
  same colours over it.

  The symptom is SILENT in the same way the rest of this section's failures are: the theme PUT
  answers 200 with `theme.changed` non-empty, the pages render with the right colours (because
  the literal happens to hold the same value the preset would have resolved to), and nothing
  anywhere reports that the palette the write just moved into the theme never actually reaches
  the pages through it — a later `sb_theme` edit would repaint everything on the site except
  the pages this tool just built.

  `stripThemeColors` (`importmap.ts`) is the fix, and which fields it drops is not "all of
  `PageTokens`": only `headingColor`/`textColor`/`buttonBg`/`buttonColor` resolve through a
  DEFAULT preset's own `var()` chain to a theme colour id the patch writes
  (`heading-default`/`text-default`'s `color`, `button-default`'s `backgroundColor`/`color`).
  `headingWeight`, `textSize`, `buttonRadius`, and the section's own `padding`/`maxWidth` are
  NOT stripped even when the theme write lands — no preset carries a font weight or a
  body-text size, and the theme patch is `{colors, text_styles}` only (no shape or spacing
  token exists to carry a radius or a measure), so withholding those would not hand the value
  to the theme, it would just drop it. `sb_import_site` strips only once the write actually
  produced `changes.length > 0`; `theme:false`, an entry with nothing readable, or a failed
  write all leave the full token set in place, because then there is no preset for a literal to
  conflict with and stamping is what makes the page match the site at all. `sb_import` (single
  page, no theme write) is unaffected on purpose — matching rule 0 is correct there.

- **A SHOP'S SITEMAP INDEX NAMES ITS OWN KINDS, AND THIS CLIENT READ THOSE NAMES AND THREW
  THEM AWAY.** `sitemapUrls` has distinguished an index from a leaf since the sitemap path
  existed — that is the whole reason `<sitemapindex>` locs come back as `sitemaps` and not
  `pages` — but the loader in `fromSitemap` fetched every child and merged every URL into one
  flat set, discarding the CHILD SITEMAP'S OWN FILENAME the moment it had been read. Measured
  against `https://ttgshop.vn/` — a real shop, ~2,400 products and 177 categories —
  `sb_import_site` planned the home page plus **eleven product-detail pages**: ten keyboards
  and a mouse pad, chosen because their URLs sit at the site's ROOT with no shared prefix at
  all, so the one existing defence (`groups`, a shared PATH PREFIX) never saw them and they
  simply won the alphabetical tie-break inside the twelve-page cap. This file already records
  why that shape is wrong — imported as static pages they render a shop where every price is a
  literal and nothing is buyable, and the fix afterwards is forty deletes, not ten.

  ttgshop's own `sitemap.xml` is an index naming its children exactly what they hold —
  `sitemap_product.xml` (2,101 urls, measured), `sitemap_category.xml` (177),
  `sitemap_brand.xml` (116), `sitemap_article.xml` (2), `sitemap_page.xml` (8) — and other
  generators say the same thing in other words: `product-sitemap.xml` (Yoast),
  `sitemap_products_1.xml` (Shopify). `Found` now carries a `kind` alongside `from`, read off
  the CHILD SITEMAP'S FILENAME (`sitemapKind`, `discover.ts`) at the moment `fromSitemap`
  reads it — never guessed from the URL itself. `choosePages` excludes every RECORD-shaped
  kind (`product`, `category`, `collection`, `brand`, `tag`) from the plan by default, the
  same reason the prefix rule exists, and reports each one's count (`kinds`, surfaced as
  `entity_pages` beside any prefix groups); a PAGE-shaped kind (`page`, `article`, `post`,
  `blog`) is left as an ordinary candidate. `include` still outranks it, same as the plumbing
  list. Re-measured after the fix: the plan becomes the home page plus the eight static pages
  (`/chinh-sach-*`, `/dieu-khoan-su-dung`, `/quy-dinh-bao-hanh`, `/phuong-thuc-thanh-toan`,
  `/tai-khoan-ngan-hang`, `/giai-phap-pc-doanh-nghiep-tron-goi`) and one article — eleven pages,
  none of them a keyboard — with `entity_pages` naming 2,101 products, 116 brands and 176
  categories excluded (the 177th sitemap-tagged category URL normalizes to the site's own
  root, so it becomes the home page instead, exempt from the entity rule the same way the
  entry URL is exempt from every other filter in `choosePages`).

  MATCHED BY WHOLE TOKEN, not a raw substring: the filename is split on anything that is not a
  letter or digit, and a word has to appear on its own to count. A plain substring test on
  `"category"` risks a coincidental hit inside an unrelated word (`isPlumbing`'s boundary bug,
  above, is this repo's own precedent for exactly that mistake), and tokenizing is what lets
  `sitemap-blog-categories.xml` — a filename naming BOTH a page word and an entity word —
  resolve predictably: entity words are checked first, because excluding a few thousand
  catalogue records is the safe direction to be wrong in and importing them as static pages is
  the defect this exists to prevent. A sitemap that never names its own kinds
  (`sitemap1.xml`, `sitemap2.xml`, one flat `sitemap.xml`) tags nothing, and every URL out of
  it plans exactly as it always has — this rule fires only when the site's own sitemap says
  so, never as a guess laid on top of one that stays silent.

## Measuring whether an import actually got closer

Every defect on this list, including the four bullets above it, was found by a PERSON looking
at ONE screenshot. That is also the method's ceiling: "A PAGE BUILT ENTIRELY BY THESE TOOLS
WAS MEASURABLY WRONG, AND `sb_review` CALLED IT CLEAN" (above, under "The platform facts that
shaped this code") reviewed clean and carried four defects anyway — no measure, unequal grid
cells, one type size instead of four, one cross-axis answer for two different shapes — every
one invisible to a check that reads the tree, all four visible only in the render. Until
something scored the RENDER rather than the document, no change to `capture` or `toSpecs`
could be shown to have helped rather than merely felt like it should.

`SB_FIDELITY=1 npm run fidelity` (`test/fidelity/run.ts`) is that score. Three numbers per
page per width, because they fail independently: `visual` (per cent of pixels differing from
the source, lower is better), `content` (`coverage`, higher is better) and `structure`
(tree-shape distance from the source, lower is better). A blank page scores perfectly on two
of the three, which is why one number would lie.

**AND THE ABSOLUTE NUMBER IS NOT THE THING TO READ — ONLY ITS MOVEMENT IS.** `visual` carries
a permanent floor: the scratch page is created with a bare `{name, slug, type}` body, so it
gets none of `sb_page_create`'s `siteChrome` global header or footer, while the source
screenshot keeps its own chrome, which `capture` skips on purpose — no importer change can
ever close that gap. `visual` moves for a SECOND reason that is not even stable: `diffImages`
divides by `width × max(sourceHeight, builtHeight)`, so a source page that got taller between
runs — a carousel on a different slide, a lazy image that resolved — re-scales the denominator
and reports a different number with nothing in the importer having changed. `visual`'s own
noise floor is still unmeasured — it needs the site-write permission this environment refuses
— but the OFFLINE half (`content` and `structure`) has now been run enough times on an
unchanged tree to answer the question for itself, and the answer is not what a first look
suggested.

**MEASURED: 13 offline runs on an unchanged tree, minutes apart. Four of five fixtures were
BYTE-IDENTICAL every single time** — `ttgshop.vn/quy-dinh-bao-hanh` (100/21.7),
`ttgshop.vn/` (18/0), `rust-lang.org/` (90/0), `example.com/` (97/0). The fifth,
`modelcontextprotocol.io/`, is NOT one outlier among many stable runs — it alternates between
exactly two states, both of which recur: `content 71 / structure 9.6` seven times, `content 73
/ structure 11.9` six times, no third value seen. The page builds itself with scripts, and
`capture`'s settle window (`settleDom`) catches it at a different point some fraction of the
runs — plausibly one slow-loading section that either finishes inside the window or does not,
rather than continuous jitter, which is why the split is two sharp values rather than a spread.

The excursion between the two states — 2.0 points on `content`, 2.3 on `structure` — is BIGGER
than `scoreboard.ts`'s `DEFAULT_TOLERANCE` of 1.5. So comparing two ordinary runs against each
other on this one fixture will sometimes report a phantom move that is pure measurement noise,
roughly as often as not, with nothing in the importer having changed either time.

**DO NOT RAISE THE TOLERANCE TO COVER THIS.** One page's bimodal noise is not a sample to set
a global threshold from, and this repo's own rule about raising a ceiling — leave headroom,
write the reason down, and a ceiling set just above today's measurement gets raised again
without anybody looking — cuts against picking 2.3 (or anything just above it) because it
happens to clear this one number today. The more likely right answer is to make `capture`'s
settle more deterministic for a page that is still building itself, not to widen what the
scoreboard accepts as unchanged; that decision needs more data than one fixture's two states
and is left to whoever gathers it.

`structure` USED TO carry the same kind of floor, and it was fixed rather than merely noted.
`toSpecs` always inserts exactly one `flex-block` between a section and its children — a
constant of the MAPPER's construction, not a fact about the page — and `shapeOf` counted it as
a real level, so the built tree was structurally deeper than the captured one BY CONSTRUCTION,
on every page, regardless of how good the import was. Measured directly: `example.com` — one
heading, two sentences — scored a `structure` distance of 40 against its own correctly-built
copy, purely from that one wrapper; across five real fixtures the same artifact produced 40,
42.2, 44.4, 48.1, 49.1, a nine-point spread driven by page size rather than fidelity. `shapeOf`
(`src/domains/site/shape.ts`) now treats a single-child node as TRANSPARENT — the child takes
its place, adding no depth and no fanout entry — collapsing a whole chain of such wrappers in
both trees before the histograms are built, the same rule `src/vision/capture.ts` already
applies on the way in for a `<div>` that merely wraps. Recomputed on the same five fixtures:
40→0, 42.2→0, 44.4→9.6, 48.1→0, 49.1→21.7 — three of five now land on the wrapper floor exactly
and the other two keep a real, non-artifact distance. The rule does not hide a genuine loss: a
container that actually disappears is never a single-child wrapper of the thing that replaced
it, so it keeps more than one child and is never transparent (`test/shape.test.ts` pins both
the collapse and this guarantee).

**A BASELINE IS NOW RECORDED, AND IT IS OFFLINE-ONLY.** Two of the three scores need no site at
all: `content` comes straight off `capture()`, and `structure` needs `capture()` plus the pure
`toSpecs()` — neither creates a page, saves, screenshots or deletes anything. Only `visual`
needs a render to diff against, and building one needs the live-site write that the PERMISSION
LAYER refuses in some environments — checked from two separate sessions before this one,
denied both times, so it is not one session's quirk; this session did not attempt the full run
again, on instruction. `SB_FIDELITY_OFFLINE=1 npm run fidelity` runs the first
two and skips everything downstream of the create; `visual` is left ABSENT on those rows
rather than reported as a fabricated zero, and every row carries `mode: 'offline'` so a later
`SB_FIDELITY=1` (`full`) run's `visual` appearing is never misread as a regression against a
metric the offline run never touched (`compareBaseline` in `scoreboard.ts` skips a metric
either side is missing, rather than comparing a real number against an invented one). The
committed `test/fidelity/baseline.json` was produced this way, and whoever can grant the
site-write permission (or run it outside this harness) should run `SB_FIDELITY=1 npm run
fidelity` to add `visual`, reading the two checks Task 5 of
`docs/superpowers/plans/2026-09-12-crawl-fidelity-harness.md` names before trusting the
numbers (`content` for `https://example.com/` should be high; `visual` must not be identical
across every page — either failing means the harness is wrong, not the importer).

**AND `npm run fidelity` USED TO NOT RUN AT ALL, in every environment, on every fixture, in
both modes — the same trap the bullet above already names, reached this time from the
TRANSPILER's side rather than the author's.** That bullet is about a function closing over a
module-scope constant it does not carry with it once serialized. This is the second way to
reach the identical failure without writing a closure at all: `tsx` (this repo's
devDependency) hardcodes `keepNames: true` in its esbuild transform for every file it loads —
not a tsconfig setting, not an env var, nothing a caller can turn off — and `keepNames` wraps
every named function and class declaration, INCLUDING NESTED ones, in a call to an injected
`__name` helper that lives in the TRANSFORMED MODULE's scope. `capturePage`
(`src/vision/capture.ts`) is handed to `page.evaluate`, which takes its source via
`.toString()` and re-evaluates that text inside Playwright's isolated browser context — a
context that never had the module `__name` was injected into — so every `__name(...)` call
left inside `capturePage`'s nested helpers threw `ReferenceError: __name is not defined`,
before either mode ever reached a site. THE LESSON IS GENERAL, NOT ABOUT `tsx` SPECIFICALLY:
any function handed to `page.evaluate` is unsafe under ANY transpiler that rewrites function
bodies, whether the rewrite is something the author wrote (a closure over `HEADINGS`, above)
or something the tool injected on its own (`__name`, here) — this repo has now paid for both
shapes of the same mistake. If a THIRD one ever appears, look for exactly this pattern:
something the evaluated function's own source text depends on that is not IN that text.

Fixed rather than merely documented: `npm run fidelity` (`scripts/run-fidelity.mjs`) now
compiles `test/fidelity/run.ts` and everything it reaches with plain `tsc` — which adds no
`__name` wrapper — into a scratch directory (`.fidelity-run/`, gitignored, deleted before and
after every run so nothing can measure against a stale compile), and runs the result with
plain `node`. `tsx` never touches this path at all any more. `SB_FIDELITY_OFFLINE=1 npm run
fidelity` now runs to completion from a clean checkout with no manual compile step, which is
how the committed baseline above is kept current.

- **THE NODE CEILING WAS A TRUNCATION, NOT A GUARD, AND IT IS GONE.** `sb_import` and
  `sb_import_site` capped how many nodes a captured page could contribute — 400 inside
  `capture()` itself, 300 named in `sb_import`'s own schema, 900 actually used (not 300) by
  `sb_import_site` — three numbers for one idea, agreeing with none of each other. On an
  ordinary marketing page that never mattered; on a real shop's home page it was the whole
  story: `https://ttgshop.vn/`, a 2,400-product catalogue, measured **19% content coverage
  capped, 100% uncapped** — 2,095 captured nodes, 2,680 built specs, ~420 KB of spec JSON, 2.4
  seconds. The walk is over a finite DOM, so an absent ceiling cannot run away; it was chosen
  against marketing pages and then quietly truncating a different kind of page it was never
  measured against. `capture()`'s own default (`limitsFrom` in `src/vision/capture.ts`) is now
  `Infinity`, and both tools pass `max_nodes` straight through with no fallback of their own —
  a caller who wants a bound still gets one by passing the argument; omitting it is the only
  way to ask for none, because a numeric `0` reads as "keep nothing" everywhere else a count
  appears in this file. `max_images` is UNCHANGED and deliberately so: every image is an
  upload — a network round trip each — which is a different cost with a different argument,
  and the user asking for this asked about nodes.

  **MORE NODES IS NOT SIMPLY BETTER, and that is now the caller's judgement rather than a
  ceiling's.** A shop's product grid arriving as hundreds of static tiles is content that
  cannot sell anything — no price update, no stock check, nothing bound to the catalogue — and
  belongs in a repeater bound to the catalogue (`list-dataset` / `dataset-block`, see the
  "FORTY URLS UNDER ONE PREFIX" bullet above for the platform-level reason why), not as literal
  imported nodes. This server does not draw that line for you now that it no longer draws the
  node line either; look at a dense import before publishing it.

  `max_sections` (`sb_import`'s own top-level-band cap, default 24, unchanged) was checked
  rather than assumed clean: on the fixture that motivated this change it was never the
  binding constraint — a shop home's dozen-or-so collection BANDS sit well under 24, and it
  was the hundreds of PRODUCT CARDS inside each band (nodes, not sections) that the old ceiling
  was cutting off. A page whose density comes from having many top-level bands rather than many
  cards within a few of them would hit `max_sections` first; nothing measured here showed that
  shape, so the cap was left alone rather than raised without a reason.

  Pinned by `test/import.test.ts`'s browser-gated suite: a fixture of 450 blocks (past the OLD
  400 default) with no `max_nodes` given must arrive whole, with no `over-node-limit` in
  `skipped`. The offline half of `SB_FIDELITY_OFFLINE=1 npm run fidelity` moved as predicted —
  `ttgshop.vn/` 19 → 100 on `content`, 0 → 0.4 on `structure` (a different node count is a
  different tree, so this `structure` move is the change working, not a regression) — and the
  other four fixtures were unaffected, none of them close to the old ceiling.

- **`measure` SKIPPED OVERLAYS BY THEIR COMPOSITION STAMP, AND BEING OFF-SCREEN IS A RENDER
  FACT.** The skip was built from `isOverlay` — `overlayId` plus a ROOT parent — which is the
  right question for trap 1 and the wrong one here: `cart-drawer` hides and translates ITSELF
  (`render/nodes/cart-drawer/css.go`), so a drawer authored straight into a page document parks
  off-screen with no stamp at all. MEASURED: every page of one storefront carried exactly that,
  so the skip came out EMPTY and `sb_look` reported THIRTEEN off-canvas findings per page at
  every width on pages that were correct — the "list nobody reads" the skip's own comment
  exists to prevent. With the render-side test the same pages report ONE finding, a real
  overlap in the shared header that had been buried under it. The same blind spot made
  `sb_look node_id:<anything in the drawer>` fail outright, because `overlayRoot` decides what
  to open and it asks the same stamp question.

  `domains/site/offscreen.ts` is the render-side test, and `overlayRoot` is deliberately NOT
  widened to match: it answers the composition question every write guard asks, and widening it
  would make `refuseOverlay` start refusing writes to a drawer the page genuinely owns. Two
  questions, two functions, pinned apart by a test. HAND-KEPT with the replacement named — the
  honest source is an element whose `css.go` hides itself until `.is-open`, which is
  mechanically readable, and the element metas carry nothing to derive it from (all five report
  `category: "basic"`). The same standing debt `INERT_ON_ADD` carries.

  This is the `Box.position` lesson again, one field along: a comment described behaviour the
  code did not have, because the code asked a question ADJACENT to the one the comment was
  about.
