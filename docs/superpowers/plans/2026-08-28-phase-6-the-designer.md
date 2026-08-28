# `sbuilder-mcp` Phase 6 — Close the gap with a human designer

**Goal:** Everything a person does in the editor, the agent can do — especially designing.

**Spec:** `docs/superpowers/specs/2026-08-27-sbuilder-mcp-design.md`

## What an audit of the editor found missing

Measured, not guessed:

| Gap | Evidence |
| --- | --- |
| **The catalog describes the inspector's SECTION HEADERS, not its controls** | `flattenTraits` recursed into `items`/`widgets`/`groups`; the real field is **`attributes`**. So `heading` reported 9 groups (`size`, `typography`, …) instead of its 24 real controls (`font_size`, `text_color`, `html_tag`, `border`, `corner`, `shadow`, …). |
| No write map for a control | `schema/src/traits/registry.ts` declares `writes: [{target, writeKey, schema}]` for 54 of the 373 widget keys. Nothing exposed it. |
| No duplicate | A designer duplicates a section constantly; the agent had to rebuild it. |
| No section templates | `/api/sites/{id}/section-templates/{id}/instantiate` exists — a human starts from a designed section rather than assembling one. |
| Page lifecycle buried | create/list/publish were reachable only through `sb_api_find` + `sb_api_call`. |
| `sb_set` cannot reach `states` | Hover styling is a real inspector capability. |

## Two facts that shape the answer

- **`style` is OPEN CSS.** `schema/src/satelliteCss.ts` turns any camelCase key into a CSS
  property (`camelToKebab`); there is no whitelist. So an agent that knows CSS can style
  anything — it does not need a widget→key map for `style`.
- **`config` and `specials` are NOT open.** They are per-element, and that is exactly where
  the 319 undescribed widgets live. The machine-readable substitute is the element's own
  `meta.defaults`, which names the keys it actually seeds.

So the honest deliverable is: show the inspector as a human sees it, attach the write target
where it is declared, show the seeded keys, and say plainly that style is open CSS.

## Tasks

1. **Catalog: walk `attributes`.** Emit the tab → group → control tree per element, plus
   `TRAIT_WRITES` joined from the schema trait registry. Assert coverage so the bug cannot
   come back silently.
2. **`sb_traits_for` returns the real inspector** — controls, write targets, seeded
   defaults, and the open-CSS note.
3. **`sb_duplicate`** — deep-copy a subtree under new ids, inserted after the original.
4. **`sb_templates` / `sb_template_use`** — list the store's section templates, instantiate
   one into the open page.
5. **`sb_page_create` / `sb_page_list` / `sb_publish`** as first-class tools.
6. **`sb_set` reaches `states`.**

Gate for every task: `npm run build && npm test && npm run smoke`.
