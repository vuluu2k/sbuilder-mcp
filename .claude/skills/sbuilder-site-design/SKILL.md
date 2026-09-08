---
name: sbuilder-site-design
description: The design contract for building a storefront with the sb_* tools — where the design comes from (a Figma or Stitch source outranks invention), what separates a real site from a generated one, the three widths, the responsive cascade's tail, the satellites that hold an element's look, the form's two-level field skin, and which artifact to judge a page from. Triggers when designing or editing pages through sb_add / sb_set / sb_look / sb_review, when porting a Figma or Stitch design onto a site, or when a rendered page looks wrong.
---

# Designing a site with the `sb_*` tools

Every rule here is a defect that SHIPPED in this repo's own storefront build. None of them
is taste. Each names the check that would have caught it.

## Where the design comes from

**A design source outranks your invention. Always look for one first.**

A professional does not open a blank canvas and start choosing hex codes. They open the
file the design already lives in, read the tokens out of it, and spend their judgement on
the translation. Improvising a palette when the brand has one is not creativity, it is
losing the brand.

### If the work has a Figma file

The Figma MCP is a real design source, not a picture. Check it is **authenticated** before
you promise anything — an unauthenticated server exposes only `authenticate` /
`complete_authentication`, and its real tools appear after the OAuth round trip.

Two of its tools have a MANDATORY skill to load first, and skipping it causes failures that
are hard to debug:

| You want | Load first | Then call |
| --- | --- | --- |
| Read a design to build from | `figma-design-to-code` | `get_design_context` |
| Write anything into Figma | `figma-use` | `use_figma` |
| Animation / motion | `figma-implement-motion` | `get_motion_context` |
| Map a component to code | `figma-code-connect` | — |

Read **variables and styles**, not a screenshot. A screenshot gives you an approximation of
one colour and none of the states; the file gives you the token, its name, every variant, and
the hover and disabled values you would otherwise never see. A design system's own naming is
also the naming your page should keep.

### If the work has a Google Stitch design

Same rule, same order: read it, derive tokens, then build. Verify the server's tools are
actually exposed in THIS session before planning around them — a server can be connected and
still surface nothing here, in which case say so rather than inventing a workflow.

### If there is no design source

Then you are the designer, and the professional move is to **decide the token set FIRST and
write it down**, before the first section — a palette with named roles, one type scale, one
spacing step, one radius per shape class. Every later section then has something to obey,
which is exactly what rule 0 asks the next agent to read back off the page.

### The translation is lossy in known places — mind these

- **A Figma frame is one width.** A 1440 frame says nothing about 390, and the platform's
  cascade has a tail that will bite you (rules 1–3). Design tokens port; layout decisions do
  not.
- **Figma has no counterpart for what this platform hides.** Satellites, the form's field-skin
  config keys, the cart drawer overlay and every repeater's empty state exist in no design
  file. They are the surfaces that shipped platform-grey on a rose-and-ink storefront in this
  repo's own build. Port your tokens onto them by hand (rules 0, 4, 5).
- **Figma px are CSS px at 1×**, and its auto-layout maps onto flex — but `sb_set` writes per
  breakpoint, so one frame is one slot, not the whole answer.

## What separates a real site from a generated one

Six things, all checkable, all missing from the first pass of this repo's own build. None is
a matter of taste — each is something a shopper meets.

1. **Every interactive element has a hover state, and the selected one looks selected.**
   `sb_set` takes `state`. A page where nothing responds to the pointer reads as a mockup.
2. **The empty state is designed, not defaulted.** Every repeater owns an `emptyStateId`
   satellite that ships English copy and `#d4d4d4` icons until you touch it. A shopper WILL
   see it — an empty cart is the most-visited empty state on a store.
3. **Fewer type sizes, not more.** A page needs about four: display, section heading, body,
   caption. A fifth size that differs by 2px from a neighbour is noise a reader feels and
   cannot name.
4. **Spacing is a scale, not a series of guesses.** Pick the steps once and reuse them. Two
   sections 64px and 68px apart is worse than both at 64.
5. **Copy is in the shopper's language, everywhere.** Including the drawer, the empty states,
   the submit button and the payment card descriptions — the surfaces that come from the
   platform in English and are never reviewed (rule 0).
6. **One accent, used for one job.** If the primary button, the price and the active link are
   all the accent, the accent has stopped pointing at anything.

## Before you call a page done

Run these four, in this order. Three of them catch things `sb_review` cannot see.

1. `sb_look` at **1440, 768 and 390** — the tree cannot overflow, so a layout defect is
   invisible to every check that only reads the document.
2. Read `layout` in the result, not just the picture. `off_canvas` and `overlap` are
   measured on the render.
3. Open the **published storefront URL**, not the draft preview, for any page with a
   repeater. Pass it to `sb_look` as `url`.
4. **Open the cart drawer** on the published page and look at it. `sb_review` SKIPS
   overlays — a placeholder or an English button in there is reported by nothing.
5. `sb_review` last, for the store gaps — they survive publish silently and a shopper is
   what finds them.

## The nine rules

### 0. Read the page's pattern before you add to it, and obey it

The FIRST rule, because everything below is downstream of it. A page already
answers the questions you are about to ask — what is the accent, how round is a
button, how much air between sections, how big is a heading — and a section that
answers them differently does not read as "a different section". It reads as a
different website.

So before the first `sb_add`, take the pattern off what is already there:

```
sb_outline depth:3                 # what sections exist, in what order
sb_node_read <a heading>           # the type scale and the ink
sb_node_read <a primary button>    # fill, radius, padding, weight
sb_node_read <a card>              # border colour, radius, inner padding
sb_node_read <a section>           # the page's vertical rhythm and max-width
```

Then reuse those exact values. Not "a pink", THE pink. Not "rounded", the same
`999px` every other button uses. A number that appears twice on a page is a
token; inventing a third value for the same job is how a build ends up with four
greys and three radii.

**The parts a page does not show you are the ones that break this.** The cart
drawer, the checkout form's fields, an element's satellites and every empty state
are authored somewhere you are not looking, and they ship the PLATFORM's defaults
— `#171717` ink, `#d4d4d4` borders, square corners, and English copy — on a page
that is none of those things. Measured on this build: a rose-and-ink storefront
whose drawer said "Cart", "Checkout", "Your cart is empty" in black-on-white,
next to a page that said everything else in Vietnamese.

Go and look at them, on purpose, before calling a site done:

| Surface | How to reach it |
| --- | --- |
| Cart drawer | `sb_outline` shows it as `overlay`; `sb_set` its nodes — the page save routes them to the overlay master |
| Element chrome | `satellite: "<config key>"` in the outline (rule 4) |
| Form fields | config keys on the form and field nodes (rule 5) |
| Empty states | the `emptyStateId` satellite on every repeater |
| Submit button | a `form-submit` node inside the FORM document |

And the copy is part of the pattern. A Vietnamese store with an English cart is
not a styling defect, it is a different shop.

### 1. Nothing is finished until it has been seen at 390px

The global header was authored desktop-only, with no responsive block at all. At 390 the nav
ran 408 → 460, the cart button 488 → 584, and two nav buttons overlapped. It reviewed clean
throughout.

### 2. Write the wide-screen counterpart whenever you write a responsive override

The cascade resolves **current slot → wider slots → BASE → narrower slots**. Narrower slots
are consulted LAST but they ARE consulted, so a key written only at `tablet` reaches
`desktop` whenever neither desktop nor base declares it.

```
sb_set fl_x style breakpoint:tablet { flexWrap: "wrap" }     # also hits desktop
sb_set fl_x style base:true        { flexWrap: "nowrap" }    # ← say the wide answer too
```

### 3. A flex row with 2+ real columns needs an explicit stack breakpoint

Nothing catches this for you. The columns SHRINK to fit, so no box overflows and `measure`
is silent. On the product page at 390 that left the photo a sliver, the title truncated
mid-word and the Add-to-cart label clipped — on a page with zero findings.

```
sb_set <row> style breakpoint:mobile { flexDirection: "column" }
sb_set <col> style breakpoint:mobile { flex: "1 1 100%", maxWidth: "100%" }
```

### 4. Style the satellites, or ship the platform's grey

`sb_outline` lists them under their owner as `satellite: "<config key>"`. They are real nodes
holding the element's whole look, and they default to `#d0d0d0` borders and `#f8f8f8` fills.

| Owner | Satellites |
| --- | --- |
| `product-variants` | `variantLabelId`, `variantOptionId` |
| `quantity-dataset` | `quantityButtonId`, `quantityInputId` |
| `menu` | `menuItemId`, `menuDropdownId` |
| `tab` / `accordion` | `tabItemId` / `accordionItemId` |
| `list-dataset`, `dataset-block`, `cart-order` | `emptyStateId` (+ optional `loadingStateId`) |

They take `state`, so hover and the selected option are yours:

```
sb_set pr_option style base:true state:"active" { borderColor: "<brand>" }
```

### 5. A form's fields are config keys, and the level matters

Two levels, one vocabulary — but the FORM emits only a subset.

- **On the FORM node** (dresses every field): `fieldBg`, `fieldBorderColor`,
  `fieldBorderWidth`, `fieldRadius`, `fieldPadY`, `fieldPadX`, `fieldStackGap`,
  `fieldReqColor`, `fieldHintOpacity`.
- **On the FIELD node only**: `payCard*`, `choice*`, `slot*`, `file*`. Written on the form
  they are stored and rendered NOWHERE — `form/css.go` emits `FieldKnobs`
  (`ChromeKnobs + Knobs`) and nothing else.

Field nodes and the submit button live in the **form document**, not the page:
`PUT /api/sites/{siteId}/forms/{id}/document`. A page republish is what makes that edit
visible, because the page inlines the form (`id` = `<pageFormId>_<formNodeId>`).

### 6. Match a frame's aspect ratio to the asset it holds

`aspectRatio: 4 / 5` with `objectFit: cover` over 900×1100 artwork cropped the garment out
of its own product photo. Ratio to the asset, or `contain` with a ground colour.

### 7. One visual language across a catalogue

Keyword stock imagery is not a source: `loremflickr` answered "kids,clothing" with a cat
statue and a photo of an adult. A generated set sharing a palette, a stroke weight and a
shoulder line reads as intentional; ten photos from ten sources read as a scrape.

### 8. Delete by what you ADDED, never by "not in my list"

A cleanup that trashed every media asset whose name was not in the new set took the site's
54 Roboto font files with it. Recoverable only because the platform soft-deletes
(`POST /api/v1/media/{id}/restore`).

## Judge the page from the right artifact

Three ways a correct page reads as broken:

- **The draft preview threads no store data.** Every repeater renders its empty state there.
  `sb_look` says so in `preview_note`; pass the published storefront address as `url`.
- **The page's CSS is a LINKED STYLESHEET** — `static-*.css`, `desktop-*.css`,
  `tablet-*.css` off the assets host. Grepping the HTML for a rule and finding nothing proves
  nothing. It read as "the style did not apply" twice here, when it had both times.
- **A fullPage screenshot does not scroll**, so `loading="lazy"` images below the fold never
  load and photograph as empty boxes. `sb_look` walks the page first; a script of your own
  must do the same.
