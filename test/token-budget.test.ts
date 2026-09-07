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
    expect(JSON.stringify(tools).length).toBeLessThan(15_000);
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
});
