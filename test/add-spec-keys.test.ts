import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';

/**
 * sb_add's spec KEEPS `responsive` and REFUSES a key it cannot apply (`states`
 * included — a hover's home is per element, which sb_set routes). The zod schema used to strip both in silence: AURA's header nav,
 * hidden on tablet and phone, saved visible there, and a close icon's
 * `events` list vanished — the node rendered, wrong, with no word.
 */
const DOC = {
  schema_version: 2,
  root_node_id: 'ROOT',
  nodes: { ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: [] }, specials: {} } },
};

async function openClient() {
  const f = (async (url: unknown) => {
    const path = new URL(String(url)).pathname;
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/source')) return json({ source: { pageId: 'pg_1', siteId: 's1', document: structuredClone(DOC), schemaVersion: 2, rev: 1 } });
    return json({});
  }) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  const { client, close } = await connectedClient({ fetchImpl: f, session, siteId: 's1' });
  await client.callTool({ name: 'sb_page_open', arguments: { page_id: 'pg_1' } });
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text?: string }>; isError?: boolean };
    const raw = res.content.map((c) => c.text ?? '').join('');
    return { raw, isError: !!res.isError, json: (() => { try { return JSON.parse(raw); } catch { return null; } })() };
  };
  return { call, close };
}

describe('sb_add spec keys', () => {
  it('keeps responsive per breakpoint, on the spec root and on a nested child', async () => {
    const { call, close } = await openClient();
    try {
      const added = await call('sb_add', {
        parent_id: 'ROOT',
        dry_run: false,
        spec: {
          type: 'flex-section',
          children: [{
            type: 'button',
            specials: { text: 'Go' },
            responsive: { tablet: { config: { hidden: true } }, mobile: { config: { hidden: true }, style: { marginLeft: 'auto' } } },
          }],
        },
      });
      expect(added.isError, added.raw).toBe(false);
      const btn = Object.keys(added.json.added as Record<string, string>)[1];
      const node = (await call('sb_node_read', { id: btn })).json.node;
      expect(node.responsive.tablet.config.hidden).toBe(true);
      expect(node.responsive.mobile.config.hidden).toBe(true);
      expect(node.responsive.mobile.style.marginLeft).toBe('auto');
    } finally {
      await close();
    }
  });

  it('routes a base-only config key in a breakpoint slot to base, as sb_set does', async () => {
    const { call, close } = await openClient();
    try {
      const added = await call('sb_add', {
        parent_id: 'ROOT',
        dry_run: false,
        spec: { type: 'flex-section', children: [{ type: 'list-dataset', responsive: { mobile: { config: { quantity: 3, itemsPerRow: 1 } } } }] },
      });
      expect(added.isError, added.raw).toBe(false);
      const list = Object.keys(added.json.added as Record<string, string>)[1];
      const node = (await call('sb_node_read', { id: list })).json.node;
      expect(node.config.quantity).toBe(3);
      expect(node.responsive.mobile.config.quantity).toBeUndefined();
      expect(node.responsive.mobile.config.itemsPerRow).toBe(1);
      expect(added.json.base_only).toMatch(/quantity/);
    } finally {
      await close();
    }
  });

  it('refuses what it cannot apply — events, states, an unknown breakpoint or slot key', async () => {
    const { call, close } = await openClient();
    try {
      const bad: Array<[Record<string, unknown>, RegExp]> = [
        [{ type: 'icon', events: [{ name: 'click', action: 'close_menu' }] }, /sb_event/],
        [{ type: 'text', states: { hover: { style: { color: 'red' } } } }, /sb_set/],
        [{ type: 'text', responsive: { phone: { style: { color: 'red' } } } }, /phone/],
        [{ type: 'text', responsive: { tablet: { styles: { color: 'red' } } } }, /styles/],
      ];
      for (const [child, re] of bad) {
        const r = await call('sb_add', { parent_id: 'ROOT', spec: { type: 'flex-section', children: [child] } });
        expect(r.isError, JSON.stringify(child)).toBe(true);
        expect(r.raw, JSON.stringify(child)).toMatch(re);
      }
    } finally {
      await close();
    }
  });
});
