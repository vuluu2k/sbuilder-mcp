import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';

/**
 * GAP #30 (TTG, 2026-10-29): `sb_page_open page_id:X` and `sb_outline` /
 * `sb_node_read` sent in ONE parallel batch — the read answered from the
 * PREVIOUSLY open document (the checkout form's outline after opening
 * /tao-tai-khoan; "no node … in this page"). The open awaits its source read and
 * the read ran in that gap. Tools on the one open document now run in arrival
 * order; a pure catalog read does not wait.
 */
const doc = (heading: string) => ({
  root_node_id: 'ROOT',
  schema_version: 2,
  nodes: {
    ROOT: { id: 'ROOT', data: { type: 'body', parent: null, nodes: [heading] }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
    [heading]: { id: heading, data: { type: 'heading', parent: 'ROOT', nodes: [] }, style: {}, config: {}, specials: { text: heading }, responsive: {}, events: [], bindings: [] },
  },
});

describe('a read sent beside sb_page_open answers from the page it opened', () => {
  it('sb_outline and sb_node_read wait for the in-flight open', async () => {
    const f = (async (url: unknown) => {
      const path = new URL(String(url)).pathname;
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
      const m = /\/pages\/(pg_[ab])\/source$/.exec(path);
      if (m) {
        // The second page answers slowly — the gap the parallel read fell into.
        if (m[1] === 'pg_b') await new Promise((r) => setTimeout(r, 50));
        const id = m[1] === 'pg_a' ? 'he_aaaaaaaa' : 'he_bbbbbbbb';
        return json({ source: { pageId: m[1], siteId: 's1', document: doc(id), schemaVersion: 2, updatedAt: 'now', rev: 1 } });
      }
      return json({});
    }) as unknown as typeof fetch;
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({ fetchImpl: f, session, siteId: 's1' });
    try {
      await client.callTool({ name: 'sb_page_open', arguments: { page_id: 'pg_a' } });
      const text = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0].text;
      const [, outline, node] = await Promise.all([
        client.callTool({ name: 'sb_page_open', arguments: { page_id: 'pg_b' } }),
        client.callTool({ name: 'sb_outline', arguments: {} }),
        client.callTool({ name: 'sb_node_read', arguments: { id: 'he_bbbbbbbb' } }),
      ]);
      expect(text(outline)).toContain('he_bbbbbbbb');
      expect(text(outline)).not.toContain('he_aaaaaaaa');
      expect(text(node)).not.toMatch(/no node/);
    } finally {
      await close();
    }
  });
});
