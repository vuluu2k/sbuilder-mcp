import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';

/**
 * TTG gap #82: `sb_look` was handed `page_id` it does not take, dropped it in
 * silence and shot another page. An unknown argument is refused, by name.
 */
describe('an argument a tool does not take', () => {
  it('is refused by name instead of dropped', async () => {
    const { client, close } = await connectedClient();
    try {
      const out = await client.callTool({ name: 'sb_catalog_search', arguments: { query: 'button', page_id: 'pg_x' } });
      expect(out.isError).toBe(true);
      expect(JSON.stringify(out.content)).toMatch(/page_id/);
      const ok = await client.callTool({ name: 'sb_catalog_search', arguments: { query: 'button' } });
      expect(ok.isError).toBeFalsy();
    } finally {
      await close();
    }
  });

  it('is advertised: every tool schema closes its properties', async () => {
    const { client, close } = await connectedClient();
    try {
      const { tools } = await client.listTools();
      const open = tools.filter((t) => t.inputSchema.additionalProperties !== false).map((t) => t.name);
      expect(open).toEqual([]);
    } finally {
      await close();
    }
  });
});
