# Phase 8 — Operating a store without a human

Phases 1–7 made the agent a **designer**: it can author a page, see it, review it and
publish it. This phase makes it an **operator** — the half of the job a merchant still has
to open the editor for.

## What a human still does that the agent cannot

Measured on the checked-in catalog (481 operations, regenerated 2026-09-07) and on
`web_builder` at the same commit:

| | |
|---|---|
| Editor feature areas | **58** (`editor/src/features/`) |
| Covered by a task-level `sb_*` tool | ~6 — pages, liveedit, media, overlays/globals (through the page save), publish, review |
| Write operations (POST/PUT/PATCH) | **211** |
| …carrying a body schema | **46** |
| …body declared, no `$ref` | 40 |
| …**no body declared at all** | **125** |

The reach is not the problem — `sb_api_call` can already send any of the 481. The problem is
that **165 of 211 writes have no shape**, so every merchant operation is a guess. And a guess
is exactly what `describeOperation` correctly refuses to let the model make: it tells the
caller to `GET` an existing item and send back a modified copy. That recovery works for an
update and is useless for a **create** — there is nothing to GET before the first product,
the first delivery option, the first payment gateway.

So `sb_review` detects all eight readiness gaps and the agent can fix none of the commerce
ones without inventing a body.

## P1 — `REQUEST_SHAPES`: the body shapes are knowable

The bodies are not undiscoverable; they are merely absent from `swagger.json`. The handler
decodes into a **named struct**:

```go
// server/internal/shipping/rest/rest.go:130
case http.MethodPost:
    var m shipping.Method
    if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
```

45 such decode sites sit in the commerce packages alone; across `server/internal/*/rest/*.go`
the decode targets are 25 anonymous structs declared in place and 20 named domain types. Both
forms are readable.

**And the decode site is more accurate than swagger, not merely more complete.** One doc
comment block serves several `@Router` lines: `products/rest/rest.go:206–213` attaches
`@Param product body products.Product` to the GET *and* the POST, so the call sheet for
`get:/api/sites/{siteId}/products` currently claims a body. A decode site sits inside one
`case http.Method*` and is therefore per-method by construction.

### Sources, in precedence order

1. **The Go decode site** — `var v <pkg>.<Type>` immediately before `Decode(&v)`, then the
   struct resolved out of `server/internal/<pkg>/*.go`: JSON tag names, Go types, and **the
   field's own doc comment**, which is where this platform keeps the knowledge that decides
   whether a body is right:

   > `FreeOverCents` — *"ZERO MEANS 'never free', not 'always free'."*
   > `Disabled` — *"NEGATIVE, so the zero value is the enabled default."*

   A shape without those two sentences produces a store that ships everything for free, or a
   delivery option that is switched off and looks configured.

2. **The editor** — `editor/src/features/*/{api,types}.ts`, resolved with the TypeScript
   compiler API (`typescript` is already a devDependency). This gives what Go cannot: which
   fields a caller is **allowed to write**. `CatalogProductInput = Partial<Omit<CatalogProduct,
   'id' | 'siteId' | 'priceCents' | 'totalStock' | 'createdAt' …>>` — the struct carries those
   fields and a create must not send them.

3. **swagger `$ref`** — the existing fallback, correct for the 46 already described.

Source 1 gives the *shape*, source 2 gives the *writable subset*. This is the rule CLAUDE.md
already states for `PUT /pages/{id}/source`: copy the working client; never guess a body.

### Output

`src/catalog/shapes.generated.ts` — generated, committed, never hand-edited:

```ts
export const REQUEST_SHAPES: Record<string, {
  fields: { name: string; type: string; note?: string }[];
  writable?: string[];
  readOnly?: string[];
  source: 'go' | 'editor' | 'swagger';
}>;
```

Field notes are trimmed to the first sentence plus any sentence containing a run of two or
more capitalised words — this repo's own convention for marking a trap — capped at 240
characters. The cap is a budget, not an opinion: an uncapped `shipping.Method` is 40 lines of
prose for one struct.

`describeOperation` gains `body_shape` and **drops** `body_warning` / `body_note` for an
operation that has one. Those two exist because the shape was unknown; keeping them once it
is known is noise the model has to read past.

### Codegen assertions

In the style the repo already uses for `getElementAI` covering 107/107:

- every write operation either has a shape or appears in an explicit **actionless allowlist**
  (`POST /api/orgs/{id}/leave` genuinely takes no body); one that is in neither fails the run;
- a shape whose method disagrees with its decode site fails the run;
- the counts are pinned in a `SHAPE_SOURCE` metadata block, so a stale catalog is caught by
  the next codegen rather than by a reader.

**The parser never guesses.** Anything it cannot read confidently fails the whole run rather
than emitting an approximate shape — the reasoning `searchOperations` already records: a
confident wrong answer is the expensive failure, an empty one is cheap and recoverable.

### Cost

`tools/list` is unchanged — shapes ride only in the `sb_api_find({ id })` call sheet, which is
fetched on demand. `token-budget.test.ts` gains a ceiling for that branch; it currently caps
only the `query` branch.

## P2 — `sb_store`: one tool that closes the eight readiness gaps

`sb_review` names eight gaps. Seven of them are fixable, and the fixes differ in kind:

| Gap | Fix | Needs orchestration? |
|---|---|---|
| `catalogue` | `POST /api/sites/{id}/products` | No — P1 is enough |
| `shipping` | `POST /api/sites/{id}/shipping-methods` | No — P1 is enough |
| `payment` | `PUT /api/sites/{id}/payment-gateways/{provider}` | No — P1 is enough |
| `cartTrigger` | `sb_event` with `open_cart` | Already shipped |
| `productPage`, `accountPage`, `searchPage` | `sb_page_create` + `sb_publish` | Already shipped |
| **`checkoutPage`** | **four writes in a fixed order** | **Yes** |

So P1 dissolves most of the table, and what is left needing a tool is the ordered flow the
editor keeps in one file:

```
editor/src/features/pages/checkoutPage.ts
  1. create an order form                 POST /api/sites/{id}/forms
  2. PUT it back WHOLE with settings      PUT  /api/sites/{id}/forms/{formId}
     (name and type ride along, or Normalize() renames it and turns it `custom`,
      after which the document below is refused)
  3. save the field document, with the payment methods and the delivery options
     filled in at that one moment                PUT .../forms/{formId}/document
  4. create the page of TYPE `checkout` and PUBLISH — /checkout resolves to the
     PUBLISHED page of the type, so a draft is the same as no page
```

`sb_store` is one tool with an `action` enum rather than one tool per surface, because the
`tools/list` ceiling is 17,000 characters and 26 tools already sit under it. Per-surface tools
would cost 4–6k; this costs ~1.2k.

- `dry_run: true` (the default, per the repo contract) returns the **ordered plan** — each
  step's method, path and redacted body. That is the recipe, in the same shape as the
  execution, so there is no second artifact to keep in sync.
- `dry_run: false` executes the steps and **asserts each one** before continuing. The editor's
  own comment records why that matters: a version of this flow shipped that created a form,
  409'd on the document, and left an orphan behind. Its recovery — delete the form if any step
  after the create fails — is copied, not reinvented.

The checkout form document and the checkout page document are **generated**, not hand-written:
`editor/src/element/formTemplates.ts` and `editor/src/element/checkoutPageSeed.ts` import only
`@webbuilder/schema` plus editor-internal files, so codegen imports them directly — the same
route already taken for `ELEMENT_SEEDS` and `buildEmptyStateTree`. A hand-copied checkout
document is one that silently rots the next time the platform edits its own.

Actions, first cut: `checkout_setup`, and the readiness-driven `status` that reports which of
the eight gaps a fix exists for. Further actions are added when a flow proves to need ordering
— not before, because a `sb_store` action that only wraps one API call is a tool tax on every
session for something `sb_api_call` already does.

## P3 — Undo: the platform has no history and a human has Ctrl+Z

Confirmed in Phase 7 and unchanged: page versions / history / restore have no route on either
surface; the only `restore` in `/api/v1` is `media/{id}/restore`. Several writes this server
can now make are whole-document replaces — `PUT .../pages/{id}/source`,
`PUT .../forms/{id}/document`, `PUT /settings` — and each is one-way.

Before any such write, the prior state is kept in an **in-process ring buffer** (cap 20), and
`sb_undo` lists what is undoable and puts one entry back.

In-process, not on disk, deliberately. This server "only ever holds the document and the
screenshots"; a snapshot directory is a new kind of thing to own, with a retention question
and a privacy question attached. And the window that matters is the one where undo is
actually reached for: the agent discovers the damage in the same session that caused it. A
durable store is left for a measured need, with the seam in the right place.

## P4 — Finishing a site

Theme and fonts, menus, translations, domains, SEO. Almost all of it becomes reachable the
moment P1 lands, so this phase adds **no tools** — it adds the shapes, and whatever `sb_review`
needs to notice the gap in the first place.

## Non-goals

- **No per-surface tool explosion.** The ceiling is real and is paid on every request.
- **No new renderer, no client-side authority.** The yield rule stands.
- **No durable snapshot store** until an in-process one is measured insufficient.
