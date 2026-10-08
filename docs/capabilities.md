# Capabilities — what the builder actually supports

*[Tiếng Việt](./capabilities.vi.md)*

What an agent can build from **native elements** through this server, where each capability
lives in the platform, and where it stops. Every row was read off source (paths are relative
to the `web_builder` repo, at the commit the catalog was generated from); a row marked
*absent* is absent in the platform, not hidden by this server.

The rule this page exists for: **compose native elements first; reach for `custom-code` only
for a gap named here.** A native element stays selectable and editable in the visual editor;
a block of HTML in `custom-code` does not, and its interior is invisible to `sb_review`.

## The workflow

1. **Discover** — `sb_catalog_search` with what you want (`"pagination"`, `"sort"`,
   `"popup"`), or an exact type (`"list-dataset"`). Exact type and name rank first.
2. **Read the schema** — `sb_traits_for <type>`: every inspector control, the key and
   namespace it writes, its default per breakpoint, its allowed values, which keys are read
   from base only, which specials a binding may target, and which events the element takes.
3. **Compose** — one nested `sb_add` per section; then `sb_set`, `sb_bind`, `sb_event`. Every
   write defaults to `dry_run: true`, and a dry run runs the same validation as the real save.
4. **Look and review** — `sb_look` (the platform's own render at three widths, plus measured
   layout defects) and `sb_review` (what the document cannot do at runtime).
5. **Custom code last** — only for a gap in the table below, and say which.

## Capability table

| Capability | Lives in (platform) | Editor | MCP | Runtime | Status |
| --- | --- | --- | --- | --- | --- |
| Containers, layout, responsive style | `schema/src/node.ts` (`style`, `responsive.{tablet,mobile}`) | inspector style panels | `sb_set` per breakpoint, `base_only` in `sb_traits_for` | Go renderer CSS (`server/render/css.go`) | full |
| Repeater with editable item template | `list-dataset` (`config.datasetSource`, `config.kind`) | children are ordinary nodes | `sb_add` seeds the bindings; `sb_review extra_repeater_child` | `server/render/nodes/list-dataset/html.go` | full — six sources: product, category, article, blogCategory, course, review |
| Bind text / image / link / input | `node.bindings` → `specials.*` (`schema/src/binding.ts`) | `BindingControl.vue` | `sb_bind` (field checked against the element's bindable specials) | `server/render/scope/scope.go` ApplyBindings | full; `binding.transform` is declared but read by no renderer |
| Search | `search-input`; the LIST may opt OUT with `specials.searchable: false` (absent = yes) | yes | `sb_add` + `sb_set` | `runtime/src/nodes/search-input.ts`, URL-synced | full |
| Filter | `filter-checkbox`, `filter-radio`, `filter-color`, `filter-slider`, `filter-tag` (`specials.filterSource`); list opts out with `specials.filterable: false` | yes | yes | `runtime/src/core/filterUrl.ts` (`f.` params), soft swap `filterSwap.ts` | full, URL-synced |
| Sort | **`select` with `specials.filterSource: "sort"`** — not its own element | yes | yes | `filterUrl.ts` (`s.` params); six keys: newest, oldest, price_asc, price_desc, name_asc, name_desc | full |
| Pagination / load more / infinite | **`list-dataset config.loadingMode`**: none, pagination, load_more, scroll_more | yes | yes | `runtime/src/nodes/list-paging.ts`, `p.<nodeId>` | full |
| Empty state | `list-empty` satellite via `config.emptyStateId` | seeded by the editor | seeded by `sb_add`'s satellite path | `list-dataset/html.go` | full |
| Loading state | opt-in `list-loading` | yes | yes | shown during a filter swap | partial — no designable *error* state; a failed swap falls back to a full navigation |
| Visibility | `config.hidden` per breakpoint; `member-gate` (`specials.audience` members/guests) | yes | yes | `css.go` hiddenAt; `runtime/src/nodes/member-gate.ts` | partial — no data- or state-driven visibility on ordinary nodes |
| Actions | `schema/src/actions/enum.ts` (21 actions; triggers click, form submit/success/error) | `ActionRow.vue` | `sb_event` (allowed list per element in `sb_traits_for`; payload checked) | `runtime/src/core/boot.ts` dispatch | full for the listed actions; add_to_cart / buy_now are BINDINGS, not events |
| Popups | `popup` in `site_overlays`, opened by the `popup` action with `payload.id` (the overlay id) | yes | `sb_store` overlays + `sb_event` | `runtime/src/nodes/popup-control.ts` | partial — a popup receives no item context; only `quickview` (products) does. Measured why: `wbState` seeds only product id + variations (`server/render/scope/seed.go:116`), and a popup is one overlay rendered once (`internal/page/overlay.go:244`) — the honest design is quick view's per-row render, a feature of its own |
| Forms | `form-*` fields; the form root's `specials.formRules` hides/shows/requires fields by other answers (is, isNot, filled, empty, contains, notContains) | `FormRulesPanel.vue` | `sb_store action:"form"`, then `sb_page_open form_id` + `sb_set specials.formRules` (checked against the generated rule vocabulary) | `runtime/src/nodes/form-conditions.ts`; server re-checks rules and required/format/length/range (`server/internal/forms/submit.go`, `rules.go`) | partial — 17 templates incl. booking and stay, seeded with record `settings` (booking rules); duplicate names/mappings refused before save, unanswerable fields warned. No derived fields, no numeric comparisons, cross-field validation only for confirm-phone and the stay range |
| Defaults | `form-select defaultValue`, text/number `prefillValue` (binding) | yes | yes | yes | full |
| Navigation keeping query params | — | — | — | filters keep non-filter params; UTM kept in session | **absent** as a general mechanism |
| Shared state / variables | — | — | — | — | **absent** (`node.states` is hover/active styling, not data) |
| Scroll to a section | `scroll_to` `{ targetId }` on button/icon/image — web_builder #112 (`66a8763e0`) | `ScrollEvent.vue` node picker | `sb_event` needs `payload.targetId`; a sole click projects `#<id>` | `runtime/src/nodes/scroll-control.ts` (smooth, reduced-motion aware, moves focus) | supported (v0.79.0) |
| Custom code | `custom-code` (`specials.code`) | Monaco, sandboxed iframe on the canvas | `sb_add`; `sb_review custom_code_native` advises when native elements cover it | written raw by the renderer | full — keep it for real third-party embeds |
| Binding expressions | none — bindings are lookups by source key | — | — | `runtime/src/core/define.ts` dotted path only, no eval | absent by design; nothing is evaluated |

## Recipes

Each recipe uses native elements only. Ids are placeholders the tools mint; read them back
from the `sb_add` result.

**Responsive content band** — `sb_template_use sb_feature_trio` / `sb_image_text` (or a nested `sb_add` of a
`flex-section` → `flex-block` row), then `sb_set` with `breakpoint: "mobile"` for the
stacked answer. `sb_look` shows all three widths.

**A list with filter, sort, empty state and paging**

```jsonc
// 1. the repeater — bindings are derived for you from datasetSource
// specials.searchable / specials.filterable are absent = yes; set false to excuse a curated shelf
{ "tool": "sb_add", "spec": { "type": "list-dataset", "config": { "datasetSource": "product", "loadingMode": "pagination" } } }
// 2. the controls, anywhere on the page
{ "tool": "sb_add", "spec": { "type": "filter-checkbox", "specials": { "filterSource": "category" } } }
{ "tool": "sb_add", "spec": { "type": "select", "specials": { "filterSource": "sort" } } }
{ "tool": "sb_add", "spec": { "type": "search-input" } }
```

The empty state is the `list-empty` satellite the list carries (`config.emptyStateId`);
design its children like any other node.

**A form with a dependent field** — create the form with `sb_store action:"form"`, open its
field document with `sb_page_open form_id`, then write the rule with `sb_set` on the FORM ROOT (a rule belongs to the form, since one rule can have several
targets): `specials.formRules`, a JSON array of
`{ id, join: "and"|"or", conditions: [{ field, op, value }], targets: [{ field, action }] }`
(`field` is the field's `specials.name`) with `op` one of is, isNot, filled, empty, contains, notContains and `action` one of hidden,
shown, optional, required. The server re-runs the same rules on submit
(`server/internal/forms/rules.go`), so a field required only in one branch is enforced there
too.

**Booking-shaped forms (appointment, salon, hotel stay)** — the platform already has a
server-side booking rulebook (capacity per slot and per day, notice and horizon, closed
dates, stay nights, deposits, `server/internal/forms/booking.go`).

1. Install the Booking app: `sb_store action:"app" app_key:"booking"`. Without it the
   platform refuses a booking-type form (`booking_app_required`).
2. `sb_store action:"form" template:"booking"` for an appointment (one date + a time slot),
   or `template:"stay"` for lodging (two dates), with `settings: { booking: { … } }` —
   `maxPerSlot` / `slotCapacity` for a salon, `minStayNights` / `maxStayNights` /
   `closedDates` for a hotel.
3. `sb_page_open form_id:<id>`, then `sb_add` fields — a "Dịch vụ" `form-select` with
   `options` and a `specials.name` — which land above the send button; add rules on the
   root as `specials.formRules`.
4. **The stay rule is positional:** on a booking form the FIRST TWO date fields
   (`form-calendar` / `form-date`), in document order, are check-in and check-out. Keep one
   date (appointment) or two (stay); a third is ignored by every booking rule and is warned
   about.
5. A head count is a `form-number` with `specials.step: 1` (the `event` and `stay` templates
   seed it): the browser and the server both refuse 2.5 (`step_mismatch`). Leave `step: 0`
   for a measurement.
6. Place the form on a page and republish that page. On submit the server also refuses a slot
   today that has already begun (`booking_slot_past`), a slot off the time-slot grid, and a
   select/radio answer that is not one of its options (`not_an_option`).

**A popup about the clicked item** — for products, `quickview` (list `config.quickviewId`)
is the native answer: the list renders one panel per card under that card's own record. A
general popup with item context is not supported by the platform yet (see the table); do not
fake it with custom code that reads the DOM.

**Jump to a section** — `sb_event` on a button with
`action: "scroll_to"`, `payload: { targetId: "<section id>" }`. The click stores
`specials.href: "#<id>"` too, so it still lands with JavaScript off.

## When something is not supported

The tools say so rather than storing it silently:

- an unknown config/specials key on `sb_add` / `sb_set` → an `unknown_key` check, and when
  the key lives in the other namespace the fix names it (`filterSource` is a SPECIAL);
- a binding into a special the element does not read → `sb_bind` refuses (override with
  `force`);
- an action not allowed on the element, or a navigation without a target → `sb_event`
  refuses with the expected payload;
- a stored value the renderer does not read, a dataset element with no data context, or an
  invalid action already in the document → `sb_review` (`unread_value`, `no_data_context`,
  `invalid_action`, `action_missing_target`).

## Reproducing it

`test/fixtures-native.test.ts` builds each fixture through the public tools against a small
stateful platform (`test/helpers/platform.ts`): a responsive content page, a list with search,
filter, sort, paging and its empty state, a pop-up opened from a button, and navigation.
`test/form-document.test.ts` covers the form with a dependent field. None uses custom code.
