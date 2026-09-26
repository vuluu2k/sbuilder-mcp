import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';

const chars = (r: unknown) =>
  (r as { content: Array<{ type: string; text?: string }> }).content
    .filter((c) => c.type === 'text')
    .reduce((n, c) => n + (c.text?.length ?? 0), 0);

/**
 * Ceilings, measured over the real transport. Each number is the shape's cost
 * after the diet with headroom, not a target to grow into: tools/list was
 * 13,606 before, "list orders" 44,407, "hero" 7,195, list-dataset 74,190.
 */
describe('token budget — a diet without a scale comes back', () => {
  it('tools/list and instructions stay small, and the instructions are true', async () => {
    const { client, close } = await connectedClient();
    const { tools } = await client.listTools();
    // 13,606 before the diet. What sits above that is bought on purpose: annotations
    // (~1,000), the sb_bind source enum (~500), sb_set edits[] and sb_api_call pick /
    // max_items (~700) — each one saves more per session than it costs.
    //
    // 16,000 -> 17,000 buys `sb_event` (~700). It is the only way to put a click action on a
    // node — `NodeSpec` carries no events, `sb_set` writes style/config/specials, and
    // `createNode` always minted `events: []` — so without it `open_cart` could not be
    // authored and a site built from scratch had no way to open its own cart drawer, while
    // `sb_review` reported that gap and named a fix nothing could apply. A tool that closes
    // a hole a whole storefront falls through is worth 700 characters of every session.
    //
    // 17,000 -> 19,000 buys two tools, ~1,400 together, with headroom rather than
    // a ceiling the next doc edit trips over.
    //
    // `sb_store` (~850): a checkout is FOUR writes in a fixed order, written down
    // in exactly one place — the editor's `checkoutPage.ts` — and the order is not
    // guessable. The form must be PUT back whole or `Normalize()` turns it custom
    // and refuses the document; the page must be PUBLISHED because /checkout
    // resolves to the published page of the type. Miss one and the Checkout button
    // every cart drawer ships with answers 404, on a store that reviews clean.
    //
    // `sb_undo` (~550): the platform has no page history and no restore, so every
    // whole-document replace is one-way. A merchant clicking through the editor
    // has undo; an agent had nothing, and one call does more damage.
    //
    // `sb_import` (~400): reading a page from elsewhere is a translation, not a
    // clone, and the description has to say so — the platform HAS an escape
    // hatch that would clone it (`custom-code` embeds raw markup) and a caller
    // who reaches for that gets a page no inspector can edit.
    //
    // 20,500 -> 23,000 buys `sb_import_site` (~1,360, measured at 21,751).
    //
    // It is the most expensive tool here and the cost is its ARGUMENTS, not its
    // description: eleven of them, because it points at a stranger's site and
    // every bound is a decision the caller has to be able to make — how many
    // pages, how deep to follow links when there is no sitemap, which paths to
    // keep or drop, how many images to copy, and whether the entry URL lands on
    // this site's own home page. A crawl with those hard-coded imports the wrong
    // twelve pages of a forty-page shop and there is nothing the caller can do
    // about it but delete them.
    //
    // What it buys back is the gap this server had at the top of the funnel:
    // `sb_import` reads ONE page into the OPEN page, so "here is our site, put it
    // on Store Builder" was a loop the agent had to run by hand — discover the
    // pages, create each, open each, import each — and getting one step wrong
    // (creating over a taken slug, reading tokens off the blank page it just
    // made) fails silently in the ways this repo keeps a file about.
    //
    // 24,500 rather than 23,400. The previous ceiling said in as many words
    // that it had "room for one more" — `sb_theme` is that one, so the room is
    // spent and the same discipline applies again rather than a ceiling set
    // just above today's number. A palette write earns its bytes: it is the
    // layer every style preset resolves from, so one token repaints every page,
    // and the alternative an agent reaches for without it — a literal on each
    // node — detaches that node from the theme permanently.
    //
    // raised for the raw form of sb_api_call (method, path) — 24,647 measured on 2026-09-19.
    //
    // 26,147 -> 27,864: THREE `sb_store` actions, not one. The note that raised this
    // ceiling credited `overlay_attach` alone at "~200" and cited 26,364 — a number that
    // was right on the day and is wrong now, and an attribution that was never right,
    // which is what a ledger entry costs when it is estimated from the change in hand
    // rather than measured. Measured per commit, this branch: `menu` +247
    // (25,351 -> 25,598), `overlay_attach` +766 (-> 26,364, the one that crossed the old
    // 26,147 and forced the raise), `app` +437 (-> 26,801). **tools/list IS 26,801,
    // measured 2026-09-20.**
    //
    // The ceiling STAYS at 27,864 rather than being re-cut to today's number. 1,063
    // characters is about one more action's description — room the next one should find
    // rather than a raise it has to ask for — and this repo's own rule is that a ceiling
    // set just above today's measurement gets raised again without anybody looking.
    //
    // What the three buy. `menu`: a menu node drops holding its own placeholder rows and
    // nothing here ever wrote `specials.menuId`, so every page carried its own copy of
    // "Home / Categories / Contact / About us" and rewording the menu was one edit per
    // page. `overlay_attach`: a pop-up cannot reach a page through an ordinary save — the
    // platform derives the edge set from the COMPOSED document, so attaching one is its
    // own call and the caller must re-read afterwards or the next save takes it straight
    // back off, exactly as `editor/src/features/overlays/usePopupOverlay.ts` documents;
    // and a quick view is worse to guess, being a `list-dataset` pointed at a panel
    // through `config.quickviewId`, which the platform's own compose step reads from BASE
    // ONLY with no responsive merge, so a value written at any breakpoint composes
    // nothing and the panel never renders — silently, like every other base-only key this
    // repo has already paid for once. `app`: installing a built-in app is one call the
    // catalog already answers, and the pages it needs but does not create are not — a
    // `courses` install with no course pages is an app a shopper cannot reach.
    //
    // 27,864 -> 30,500, measured at 28,546. What the 682 over the old ceiling
    // buys, and the headroom is 1,954 — about two more actions, room the next
    // one should find rather than a raise it has to ask for.
    //
    // `sb_page_state` (~950, a whole tool): a page is THREE documents — the
    // draft the editor canvas shows, the published row the storefront serves,
    // and what this session holds — and nothing could say which was which. The
    // failure that costs most is "the live page has data and the canvas is
    // blank", which is not a cache: the editor's `hydrate` silently discards a
    // document whose root_node_id names no node and shows an empty ROOT, while
    // the Go renderer draws the same document without complaint, so a
    // screenshot and a review both pass. Its next save then stores that blank.
    // This tool simulates that gate, so the answer arrives before the save
    // that makes the loss permanent rather than after it.
    //
    // `sb_store` global_attach / global_detach (~330): putting an EXISTING
    // shared header on a page had no tool at all — `action:"chrome"` builds a
    // new master, which is the wrong answer for the ordinary case and puts two
    // headers on the site. Measured on a live storefront: seven of twenty-four
    // pages carried neither the header nor the footer while both masters
    // existed, and the only fix was hand-writing a reference node — the write
    // whose one plausible spelling (`globalId`, the COMPOSED stamp) decomposes
    // over the master and empties it for every page carrying it.
    //
    // `sb_publish verify` (~110): a 200 proves a row was stored, not that a
    // visitor is served it. The storefront answers `max-age=60`, so the two
    // legitimately differ for a minute — long enough for a caller to reload,
    // see the old page, and go looking for a bug that is not there.
    expect(JSON.stringify(tools).length).toBeLessThan(30_500);
    for (const t of tools) expect(t.description, t.name).not.toMatch(/vanishes on publish/);
    const instructions = client.getInstructions() ?? '';
    expect(instructions.length).toBeGreaterThan(200);
    expect(instructions.length).toBeLessThan(1_000);
    expect(instructions).not.toMatch(/vanishes on publish/);
    await close();
  });

  it('search results are lists, not schemas', async () => {
    const { client, close } = await connectedClient();
    const find = await client.callTool({ name: 'sb_api_find', arguments: { query: 'list orders' } });
    expect(chars(find)).toBeLessThan(3_000);
    const catalog = await client.callTool({ name: 'sb_catalog_search', arguments: { query: 'hero' } });
    expect(chars(catalog)).toBeLessThan(2_500);
    const traits = await client.callTool({ name: 'sb_traits_for', arguments: { type: 'list-dataset' } });
    // 16,000 rather than 13,000, and this ceiling has now caught the SAME field
    // twice, which is the argument for keeping it rather than for freezing it.
    //
    //   - the first catch, at 12,396: a six-field animation object repeated on
    //     two thirds of the catalog. That was dilution, and it was compacted.
    //   - the second, at 14,347: the platform shipped 4 entrance effects → 46.
    //     That is not dilution — 643 bytes of type NAMES an agent cannot author
    //     an animation without, on one element per call. The prose around them
    //     was still fat and went from 1,842 to 1,347; the names stayed.
    //
    // So the rule the budget exists for held both times: it caught real growth
    // and real waste, and only the waste was removed. Raised WITH HEADROOM
    // (measured 13,852) rather than to just above today's number, because a
    // ceiling set at the measurement gets raised again without anybody looking.
    expect(chars(traits)).toBeLessThan(16_000);
    await close();
  });

  it('a call sheet carrying a body shape still fits in a few hundred tokens', async () => {
    const { client, close } = await connectedClient();
    // The heaviest one measured, and the reason there is a ceiling at all: a body
    // shape is a whole struct's worth of field names, types and trap notes, and
    // an unbounded one would put a domain model into the context of anybody who
    // asked what an endpoint takes. Median is 632; an order is the outlier at
    // 5,084, because an order genuinely is the platform's largest object and its
    // line items are expanded one level — the level that carries the price.
    const orders = await client.callTool({
      name: 'sb_api_find',
      arguments: { id: 'post:/api/sites/{siteId}/orders' },
    });
    //
    // Raised 5,500 → 6,500 when the shape reader stopped dropping every field
    // that carries a trailing `// comment`: the order gained `subtotalCents`,
    // `discountCents` and `totalCents` with the notes that say they are DERIVED
    // (measured 5,778). Real fields the struct always had, not dilution.
    expect(chars(orders)).toBeLessThan(6_500);
    // The one every storefront build calls, and the one that must stay cheap.
    //
    // The ceiling MOVED once, deliberately, and the reason is the shape of a
    // legitimate change: the platform grew product BUNDLES, so `products.Product`
    // gained `kind`, `bundlePricing`, `bundleValue` and a `bundleItems` array
    // expanded one level (productId, variantId, quantity, position) — 16 fields,
    // and the sheet went 2,446 → 2,946. That is capability an agent needs in
    // order to sell a combo, not padding.
    //
    // Raised to 3,500 rather than to 3,000: a ceiling set just above today's
    // measurement has to be raised again on the next honest field, which trains
    // a reader to raise it without looking. This one has room for a comparable
    // addition and still refuses a schema dump.
    //
    // AND IT WAS RAISED AGAIN ANYWAY, which is the ceiling working rather than
    // failing: the platform gave `products.Product` a `modelUrl` — the product's
    // 3D model, the catalogue half of the same background-scene feature that
    // arrived on `flex-section` — and the sheet landed on EXACTLY 3,500. One
    // honest field, caught by a bound that had 554 characters of room and spent
    // every one of them. 4,200 restores the headroom the paragraph above argues
    // for; it is not a target, and a growth that reaches it is again a question
    // about what the platform added rather than about this number.
    const products = await client.callTool({
      name: 'sb_api_find',
      arguments: { id: 'post:/api/sites/{siteId}/products' },
    });
    //
    // 4,200 → 8,500, and this one is not growth at all: the shape reader dropped
    // every field with a trailing `// comment`, which on `products.Product` was
    // `description`, `images`, `attributes`, the whole of `seo`, and — inside
    // `variants` — `priceCents`, `stock` and `compareAtCents`. The sheet an agent
    // used to create a product was missing the PRICE. Measured 7,398 once the
    // fields came back; the headroom is the paragraph above's argument again.
    expect(chars(products)).toBeLessThan(8_500);
    await close();
  });
});
