import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';

const READ_ONLY = [
  'sb_connect', 'sb_site_list', 'sb_api_find', 'sb_page_open', 'sb_outline', 'sb_node_read',
  'sb_catalog_search', 'sb_traits_for', 'sb_review', 'sb_templates', 'sb_page_list', 'sb_media_list',
];

describe('tool annotations', () => {
  it('every tool carries annotations; the read set is readOnlyHint', async () => {
    const { client, close } = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(27);
    for (const t of tools) expect(t.annotations, t.name).toBeDefined();
    for (const name of READ_ONLY) {
      expect(tools.find((t) => t.name === name)!.annotations!.readOnlyHint, name).toBe(true);
    }
    for (const name of ['sb_remove', 'sb_api_call']) {
      expect(tools.find((t) => t.name === name)!.annotations!.destructiveHint, name).toBe(true);
    }
    await close();
  });
});
