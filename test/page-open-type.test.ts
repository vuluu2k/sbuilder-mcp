import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

/**
 * sb_page_open reviews with the page's TYPE. A record detail page binds its
 * tiles outside any list; reviewed typeless, AURA's correctly rendering hotel
 * page drew a no_data_context on every tile.
 */
const doc = {
  schema_version: 2,
  root_node_id: 'ROOT',
  nodes: {
    ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['s'] }, specials: {} },
    s: { id: 's', data: { type: 'flex-section', parent: 'ROOT', nodes: ['t'] }, specials: {} },
    t: {
      id: 't',
      data: { type: 'text-dataset', parent: 's', nodes: [] },
      specials: {},
      bindings: [{ id: 'b', source: 'record.fld_0123456789abcdef', field: 'specials.boundText' }],
    },
  },
};

async function open(pageType: string | null | '') {
  const f = (async (url: unknown) => {
    const path = new URL(String(url)).pathname;
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/source')) return json({ source: { pageId: 'pg', document: structuredClone(doc) } });
    if (path.endsWith('/pages/pg')) {
      if (pageType === '') return new Response('', { status: 200 });
      return pageType ? json({ page: { id: 'pg', type: pageType } }) : json({ error: 'nope' }, 500);
    }
    return json({});
  }) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  const ctx = { base: 'http://x', session, fetchImpl: f, notices: new Notices(), undo: new UndoLog(), siteId: 's1' };
  const { client, close } = await connectedClient(ctx as never);
  const r = await client.callTool({ name: 'sb_page_open', arguments: { page_id: 'pg' } });
  await close();
  const out = JSON.parse((r as { content: Array<{ text: string }> }).content[0].text);
  return ((out.findings ?? []) as Array<{ code: string }>).map((x) => x.code);
}

describe('sb_page_open reviews with the page type', () => {
  it('a record detail page supplies the record its tiles bind', async () => {
    expect(await open('record')).not.toContain('no_data_context');
  });
  it('an ordinary page still reports the stranded tile, and so does a failed type read', async () => {
    expect(await open('page')).toContain('no_data_context');
    expect(await open(null)).toContain('no_data_context');
    expect(await open('')).toContain('no_data_context'); // an empty 200 body
  });
});
