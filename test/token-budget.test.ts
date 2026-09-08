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
    // 17,000 -> 18,000 buys `sb_store` (~850). A checkout is FOUR writes in a
    // fixed order that exist written down in exactly one place — the editor's
    // `checkoutPage.ts` — and the order is not guessable: the form must be PUT
    // back whole or `Normalize()` turns it custom and refuses the document, and
    // the page must be PUBLISHED because /checkout resolves to the published page
    // of the type. Miss one and the Checkout button every cart drawer ships with
    // answers 404, which is a store that cannot take money while reviewing clean.
    expect(JSON.stringify(tools).length).toBeLessThan(18_000);
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
    expect(chars(traits)).toBeLessThan(12_000);
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
    const products = await client.callTool({
      name: 'sb_api_find',
      arguments: { id: 'post:/api/sites/{siteId}/products' },
    });
    expect(chars(products)).toBeLessThan(2_500);
    await close();
  });
});
