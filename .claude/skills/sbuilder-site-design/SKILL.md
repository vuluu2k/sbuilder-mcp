---
name: sbuilder-site-design
description: How to build a storefront with the sb_* tools that can actually take money — the ordered build recipe (catalogue before pages, delivery before payment, paths that resolve by page type), where the design comes from (a Figma or Stitch source outranks invention), what separates a real site from a generated one, the three widths, the responsive cascade's tail, the satellites that hold an element's look, the form's two-level field skin, and which artifact to judge a page from. Triggers when designing or editing pages through sb_add / sb_set / sb_look / sb_review, when porting a Figma or Stitch design onto a site, or when a rendered page looks wrong.
---

# Building and designing a site with the `sb_*` tools

Every step and every rule here comes from a defect that SHIPPED in this repo's own storefront
build. None of it is taste. Each names the check that would have caught it.

## Building a store that can actually take money

The order below is not a preference. Each step exists because doing it later
costs a rebuild, and every one of them was learned by doing it wrong first.

**1. Connect, and know your site.** `sb_connect`. With `SB_SITE` set, every
`site_id` is optional.

**2. The CATALOGUE before the pages.** Products first, then categories, then
media — because a page binds to data, and a product grid built against an empty
catalogue is judged against its empty state. Three facts that cost a retry each:

- `priceCents` is MINOR UNITS: VND × 100. A 189.000 ₫ shirt is `18900000`.
- `PATCH /api/v1/products/{id}` is **405**. Use PUT, and send the whole object —
  read it back first.
- The variant picker reads the product's `attributes` array, NOT its variants'
  `options`. Set both, or the shopper picks from the element's seed values
  ("Red / Green / Blue", "S / M / L") while the real sizes sit unused.

**3. Media.** `sb_media_upload`, or `POST /api/v1/media` (multipart) — the second
door, and the key's own.

**4. Delivery, then payment.** Shipping methods first: the checkout seeds a
shipping select whose options ARE the site's own methods, so a store with none
shows a required-looking field with nothing in it. Then a gateway:
`PUT /api/sites/{siteId}/payment-gateways/{provider}` with
`{enabled, sandbox, label, credentials}`.

**5. The checkout, through the editor's own four-step flow.** Do not hand-build
it — the field document's `mapTo` values are a vocabulary the server validates
(`customer.fullName`, not `customer.name`). See CLAUDE.md's checkout entry.

**6. The pages, BY TYPE.** Four paths resolve by page type and ignore slugs
entirely: `/checkout`, `/checkout/complete`, `/account`, `/search`. Plus
`/products/{slug}` needs a published `product` page and `/categories/…` a
`category` one. Only `/checkout/complete` backstops itself; the rest 404.

**6a. `/account` IS THE SIGN-IN DESTINATION, and it is ONE page.** There is no
`login` or `register` page type — `page.FixedPathTypes` is search, checkout,
complete, account — and `membersonly.go`'s `membersOnlyRedirectTarget` sends
every anonymous visitor who hits a members-only page to `/account`, with its own
comment ruling out "a page-document scan hunting for a login form". So splitting
sign-in onto its own page breaks the platform's own redirect: the shopper lands
on `/account` with nowhere to sign in.

Build the PAIR `member-gate`'s hint names — one gate `audience: "guests"`, one
`audience: "members"` — because the seed only gives you the members half
(`accountPageSeed.ts`: heading + `account-info` + `order-history` +
`address-book`). The guest half is yours, and it is the half that goes wrong.

**BUT DO NOT SHOW TWO AUTH FORMS AT ONCE.** Shipped here: a login form and a
register form side by side in the guest gate, two headings and two submit
buttons competing for one decision, and at 390px one long double form. Put them
in a `tab` — its button row is synthesized from each `tab-content` child's
`specials.label` (`render/nodes/tab/html.go:2`), so there is no items config to
discover — and style its `tabItemId` satellite, which ships `#f5f5f5` / `#7b7b7b`
with a `#171717` active state (rule 4).

**7. The design.** Rule 0 first — read the source, or read the page. Then
sections, then the surfaces the page does not show you: satellites, field skin,
the cart drawer, every empty state.

**8. The purchase controls.** `sb_bind` with `action: "add_to_cart"` on the buy
button — a purchase is a BINDING. `sb_event` with `open_cart` on a standalone
cart control in the header — that one is an EVENT. Getting these two backwards
is the commonest mistake here, and both tools refuse the other's job by name.

**9. Publish.** It CASCADES through shared globals: publishing one page
republishes every page carrying a global it touched.

**10. Verify, in this order.** `sb_look` at three widths → read `layout` → the
published storefront URL, not the preview → open the cart drawer → `sb_review`
for the store gaps.

`sb_review` answers step 10's last question with eight checks: `checkoutPage`,
`payment`, `productPage`, `catalogue`, `shipping`, `accountPage`, `searchPage`,
`cartTrigger`. The first five stand between the store and a PAID ORDER; the rest
stand between it and a finished website. All eight survive publish silently, and
a real shopper is otherwise what finds them.

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

Stitch (`https://stitch.googleapis.com/mcp`) is a **generator with a design system attached**,
which makes it a different kind of source from Figma: you can read tokens out of it, and you
can also ask it for screens. Fifteen tools, in three groups:

| Group | Tools |
| --- | --- |
| Projects | `list_projects`, `get_project`, `create_project`, `delete_project` |
| Screens | `list_screens`, `get_screen`, `generate_screen_from_text`, `edit_screens`, `generate_variants` |
| **Design systems** | `list_design_systems`, `create_design_system`, `update_design_system`, `apply_design_system`, `upload_design_md`, `create_design_system_from_design_md` |

**The design-system half is the half that matters here.** A Stitch design system carries the
colour palette, typography, corner roundness and light/dark backgrounds — which is the token
set rule 0 asks you to establish, already decided. So the order is:
`list_projects` → `list_design_systems` → take the palette, the fonts and the shape values →
apply them through `sb_set` as the page's tokens. Ask for screens second, if at all: a screen
is one width and one composition, and rules 1–3 still own the responsive answer.

Four operational facts, from the tools' own instructions:

- `generate_screen_from_text` and `edit_screens` **take minutes, and must not be retried**. On
  a timeout, poll `get_screen` every 30 seconds, up to ten times. A retry starts a second
  generation.
- A connection error does **not** mean the generation failed — it may still be running. Poll
  before concluding anything.
- `upload_design_md` must be followed **immediately** by `create_design_system_from_design_md`;
  the upload alone creates nothing.
- `delete_project` asks for an explicit yes/no and cannot be undone. Never call it to tidy up.

`DESIGN.md` is also the bridge in the other direction: when you have established a token set
for a site (rule 0, no-source case), `upload_design_md` +
`create_design_system_from_design_md` turns that written set into a Stitch design system, so
the next screen it generates is already on-brand.

**Check the server is exposed in THIS session before planning around it.** An MCP server can
be configured project-scoped — Stitch was, here, under one sibling repo — so `claude mcp list`
shows it connected while `ToolSearch` finds nothing, in a different directory. Say that, and
name the fix (move the entry to the global `mcpServers`), rather than inventing a workflow.

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
4. **Open the cart drawer** on the published page and look at it. `sb_review` now walks
   overlays and flags their findings `overlay: true` — site-wide, so fix once, not per page —
   but a picture still catches what no rule states.
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
