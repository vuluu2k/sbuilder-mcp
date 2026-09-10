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
    expect(JSON.stringify(tools).length).toBeLessThan(24_500);
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
    // 13,000 rather than 12,300: the entrance animation's vocabulary now rides
    // on the 73 element types that offer the control, and this is the result an
    // agent reads before every styling decision. The FIRST attempt at it was a
    // six-field object and this ceiling caught it at 12,396 — correctly, since
    // 400 bytes across two thirds of the catalog is dilution. It is one line
    // now, carrying all four ways the write fails silently.
    expect(chars(traits)).toBeLessThan(13_000);
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
    expect(chars(orders)).toBeLessThan(5_500);
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
    const products = await client.callTool({
      name: 'sb_api_find',
      arguments: { id: 'post:/api/sites/{siteId}/products' },
    });
    expect(chars(products)).toBeLessThan(3_500);
    await close();
  });
});
