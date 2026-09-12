# Phase 9 — An import that looks like the page it read

An import today is a TRANSLATION: six kinds of thing cross the boundary and the target
page's own tokens dress them. That was the right first answer and it is not the answer
asked for now. The goal here is a page that LOOKS LIKE THE SOURCE — while staying a real
Store Builder document: every node editable in the inspector, responsive through the
cascade, and bindable to the catalogue.

The measurement comes first, because nothing here is arguable by reading. A page that reads
correct in a tree can be badly proportioned, and this repo has already paid for that lesson
once: a page built entirely by these tools reviewed CLEAN and carried four defects visible
only in a screenshot.

## What "accurate" is, and what it is not

**It is not `custom-code`.** The platform has an escape hatch that would clone a page
verbatim, and the design document for this server already records what it produces: a page
no inspector can edit, with no responsive cascade, bound to nothing, carrying somebody
else's CSS and scripts. Visually closest, structurally a dead end — and on a shop it means
the product grid can never sell anything.

So accuracy is measured against a page made of REAL elements. Three numbers, per page, per
width, because they fail independently:

| number | question it answers | how it fails alone |
| --- | --- | --- |
| `visual` | does it look like the source | a blank page scores 100 on the other two |
| `content` | did the words and pictures survive | a correct-looking band with no text in it |
| `structure` | did the arrangement survive | every leaf present, stacked in one column |

`content` already exists as `coverage`. The other two are new.

## P1 — The harness, built first and changing nothing

`test/fidelity/`, outside the gate for the same reason the browser suite is: it needs the
network and a browser. Run on demand.

Per source URL: `capture` → `toSpecs` → build into a scratch page → shoot the source and the
built page at **390 / 768 / 1440** → score.

### Scoring

- **`visual`** — both shots downscaled to a common width and compared in a canvas inside
  `page.evaluate`. NO NEW DEPENDENCY: this repo's install downloads nothing, and a pixel
  comparison is a loop over an `ImageData` array. Compared after a blur, because an import
  that is right in every way except a 2px line-height offset must not read as 40% wrong.
- **`content`** — `coverage`, plus the node and image ceilings actually hit.
- **`structure`** — depth histogram and sibling-count histogram of the built tree against the
  source's own captured tree. A source three levels deep arriving two levels deep is the
  flatness failure this repo has fixed once already and has no guard against.

### The baseline is committed

`test/fidelity/baseline.json` holds the last scores. Every run diffs against it. That is
where the word "continuous" actually lives: a change that improves one page and quietly
breaks another is otherwise invisible, and this repo has shipped exactly that shape before.

### The fixtures are FOUR SITES, not one

Precedent, and it is this repo's own: a sweep across four real sites found the defect a
single page could not — `section` matching nested sections, so an outer band and the bands
inside it were both taken and 15 of 22 strings arrived twice. One site cannot find that.

ttgshop.vn (a dense Vietnamese shop, tables, carousels, 2,400 products) plus three of
deliberately different shape: a documentation site (grid-heavy, code blocks), a marketing
page (hero, feature rows, big type), and a text-heavy institutional page (lists, no design
system to speak of).

### Where the scratch page lives

On the site the key already addresses, as `zz-fidelity-<slug>`, deleted after the shot. A
page DELETE is one-way, so the harness deletes ONLY pages it created in that run and only by
the id it got back from the create — never by a slug scan, which is the shape that took 54
Roboto files out of a media library the last time this repo cleaned up by "not in my list".

## P2 — The source's design system, read once per site

`src/domains/site/sourcetokens.ts`, pure and unit-testable with no network.

`capture` collects, per node, the computed values it does not read today: `color`,
`backgroundColor`, `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `borderRadius`, and
each section's padding and gap. Those samples are clustered into a small system:

- colours by frequency AND ROLE (page background, body ink, heading ink, the first painted
  button's fill — the accent) — the same role reading `tokensFromPage` already does on the
  target page, applied to the source;
- font sizes into a scale of at most six steps;
- spacing into at most six steps;
- radius into at most three.

Written into the target site's theme through `sb_theme`, which is a READ-MODIFY-WRITE
against a replace-only endpoint with no history — so the patch names fields and never
expresses "drop everything else".

**Read ONCE for the site, not per page.** Per-page reading gives the first page element
defaults and every later page the defaults of the blank page before it, which is rule 0
failing on every page at once.

## P3 — Style on the node: reference first, literal second

`toSpecs` resolves each style key against the extracted system. Within tolerance it writes a
REFERENCE (`var(--wb-color-…)` for colour, `config.textGlobalStyle` plus the
`var(--wb-ts-<slug>-<prop>)` refs for type); outside tolerance it writes the literal.

This ordering is the whole point and it is not taste. A literal on a node OUTRANKS the
preset beneath it PERMANENTLY — the node stops following the theme, and the next palette
change moves every other node and not that one. `THEME_VERSION` 6 was bumped for exactly
this failure. An import that writes literals everywhere produces a site that can never be
re-themed, which is a worse dead end than the one `custom-code` produces, because it looks
fine.

Tolerance: colour by RGB distance, size within 1px, spacing to the nearest step. Every
threshold is a constant the harness can move, and moving one is a scored experiment rather
than an opinion.

### Responsive comes from THREE captures, not from one

The page is captured at 390, 768 and 1440. Per node, per key: write the value once at base
when the three agree, and write only the KEYS THAT DIFFER into the narrower slots.

Base carries the WIDE answer, because the cascade resolves *current slot → wider slots →
BASE → narrower slots* — so a key written only at tablet reaches desktop whenever neither
desktop nor base declares it. This repo has already broken a desktop header exactly that
way with one `flexWrap: wrap`.

Config keys on `BASE_ONLY_CONFIG` are routed to base by `baseonly.ts` as they are today; the
new work is style, and style is not on that ledger.

## P4 — What the platform has no destination for

Recorded and PRICED, never guessed at. The clearest one measured so far: the platform's 112
elements include no `table`, so ttgshop's warranty matrix — product class against warranty
term — arrives as ELEVEN loose text blocks in reading order (`DANH MỤC SẢN PHẨM`,
`PHƯƠNG ÁN XỬ LÝ`, `CPU - SSD - RAM - NGUỒN`, `100%`, `3 NĂM`, …). What is lost there is the
MEANING rather than the styling: nothing in the result says which term belongs to which
class.

Whether that becomes upstream work in `web_builder` is a decision the harness makes, not
this document. A platform element is Go renderer + Vue editor + schema + a regen here + a
DEPLOYMENT, and codegen refuses a commit no deployment carries — a catalog describing an
element nobody can render is worse than a catalog that is missing one.

## Order, and why

1. **P1 harness + baseline, changing nothing about fidelity.** The current score has to be
   on record before anything moves, or every later claim is unfalsifiable.
2. **P2 tokens → theme.** The largest visual gain per byte, and the layer everything else
   sits on.
3. **P3 per-node style + three captures.** The remainder, guided by what P1 says is still
   costing points.
4. **P4** whatever the scoreboard proves is worth platform work.

## Testing

- Pure units in the default suite, no network: clustering, role assignment, nearest-token
  resolution, the three-width diff that decides which keys go to which slot.
- Browser-gated (`SB_BROWSER_TEST=1`) for every `capture` addition — the default suite skips
  these, and a skip that reads as green is the failure this repo keeps closing.
- The harness itself is not in the gate. `npm run build && npm test && npm run smoke` stays
  the gate for every change.

## Non-goals

- Copying the source's CSS or scripts. Nothing from the source's stylesheet crosses; only
  computed VALUES, re-expressed as this platform's own style keys.
- Pixel-exact typography. A webfont the target site does not serve is mapped to the nearest
  family it does; chasing the last few per cent of a glyph shape is not what the score is
  for.
- Importing product grids as static tiles. They are repeaters bound to the catalogue, and no
  amount of fidelity makes a literal price buyable.
- Reproducing hover, animation and scroll behaviour. Out of scope for this phase and
  deliberately so: the score is taken on a settled still.
