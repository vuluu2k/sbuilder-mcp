---
name: sbuilder-site-design
description: The design contract for building a storefront with the sb_* tools — the three widths, the responsive cascade's tail, the satellites that hold an element's look, the form's two-level field skin, and which artifact to judge a page from. Triggers when designing or editing pages through sb_add / sb_set / sb_look / sb_review, or when a rendered page looks wrong.
---

# Designing a site with the `sb_*` tools

Every rule here is a defect that SHIPPED in this repo's own storefront build. None of them
is taste. Each names the check that would have caught it.

## Before you call a page done

Run these four, in this order. Three of them catch things `sb_review` cannot see.

1. `sb_look` at **1440, 768 and 390** — the tree cannot overflow, so a layout defect is
   invisible to every check that only reads the document.
2. Read `layout` in the result, not just the picture. `off_canvas` and `overlap` are
   measured on the render.
3. Open the **published storefront URL**, not the draft preview, for any page with a
   repeater. Pass it to `sb_look` as `url`.
4. `sb_review` last, for the store gaps — they survive publish silently and a shopper is
   what finds them.

## The eight rules

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
