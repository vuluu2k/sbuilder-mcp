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
    // 31 since sb_theme. The count is asserted rather than left open because the
    // tools/list ceiling below is per-LIST, so a tool added without a look at its
    // own description is how that ceiling gets tripped by somebody else — which
    // is exactly what sb_theme did, and this pair of assertions is what caught
    // it in the same run.
    expect(tools.length).toBe(31);
    for (const t of tools) expect(t.annotations, t.name).toBeDefined();
    for (const name of READ_ONLY) {
      expect(tools.find((t) => t.name === name)!.annotations!.readOnlyHint, name).toBe(true);
    }
    for (const name of ['sb_remove', 'sb_api_call', 'sb_undo']) {
      expect(tools.find((t) => t.name === name)!.annotations!.destructiveHint, name).toBe(true);
    }
    await close();
  });
});
