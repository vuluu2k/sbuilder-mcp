import { describe, it, expect, vi, afterEach } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

/**
 * web_builder e79cdb7f3: an editor tab with unsaved edits adopts a foreign save
 * without the conflict banner ONLY when `X-WB-Live-Peer` names a peer in the
 * room on that page — i.e. a save whose change already reached it as ops. So
 * the header rides on a PageSession save whose every patch was published, and
 * on nothing else: a raw write it adopted silently would be overwritten by the
 * human's next autosave.
 */
const PEER = 'pr_0123456789abcdef';

class FakeWS {
  static made: FakeWS[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeWS.made.push(this);
  }
  /** The server acks every ops frame, as a live room does. */
  send(data: string) {
    const f = JSON.parse(data);
    if (f.t === 'ops') queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ t: 'ack', opId: f.opId, seq: 1 }) }));
  }
  close() {}
}

const doc = (root = 'ROOT') => ({
  schema_version: 2,
  root_node_id: root,
  nodes: {
    [root]: { id: root, data: { type: 'root', parent: null, nodes: ['sec'] } },
    sec: { id: 'sec', data: { type: 'flex-section', parent: root, nodes: ['tx'] }, style: {} },
    tx: { id: 'tx', data: { type: 'text', parent: 'sec', nodes: [] }, specials: { text: 'Hi' } },
  },
});

function site() {
  const puts: Array<{ page: string; peer: string | undefined }> = [];
  const docs: Record<string, unknown> = { pg: doc(), pg2: doc('sppro_1') };
  const f = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    const src = /\/pages\/([^/]+)\/source$/.exec(path);
    if (src) {
      if (method === 'PUT') {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        puts.push({ page: src[1], peer: headers['X-WB-Live-Peer'] });
        docs[src[1]] = JSON.parse(String(init!.body)).document;
      }
      return json({ source: { pageId: src[1], document: docs[src[1]], rev: 100 + puts.length } });
    }
    if (path.endsWith('/pages')) return json({ pages: [{ id: 'pg', name: 'Home' }, { id: 'pg2', name: 'Old' }] });
    return json({});
  }) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  return { puts, ctx: { base: 'http://x', session, fetchImpl: f, notices: new Notices(), undo: new UndoLog(), siteId: 's1' } };
}

const welcome = () => {
  const ws = FakeWS.made.at(-1)!;
  ws.onopen!();
  ws.onmessage!({ data: JSON.stringify({ t: 'welcome', peerId: PEER, peers: [] }) });
};

describe('X-WB-Live-Peer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWS.made = [];
  });

  it('rides on an ops-carried save, and on no raw write beside it', async () => {
    vi.stubGlobal('WebSocket', FakeWS);
    const { ctx, puts } = site();
    const { client, close } = await connectedClient(ctx);
    await client.callTool({ name: 'sb_page_open', arguments: { page_id: 'pg' } });
    welcome();
    await client.callTool({ name: 'sb_remove', arguments: { id: 'tx', dry_run: false } });
    expect(puts.at(-1)).toEqual({ page: 'pg', peer: PEER });

    await client.callTool({
      name: 'sb_api_call',
      arguments: { method: 'PUT', path: '/api/sites/s1/pages/pg/source', body: { document: doc() }, dry_run: false },
    });
    expect(puts.at(-1)).toEqual({ page: 'pg', peer: undefined });

    await client.callTool({ name: 'sb_page_repair', arguments: { page_id: 'pg2', dry_run: false } });
    expect(puts.at(-1)).toEqual({ page: 'pg2', peer: undefined });
    await close();
  });

  it('is not sent outside the room', async () => {
    vi.stubGlobal('WebSocket', FakeWS);
    const { ctx, puts } = site();
    const { client, close } = await connectedClient(ctx);
    await client.callTool({ name: 'sb_page_open', arguments: { page_id: 'pg' } });
    // No welcome: the socket never became a seat in the room.
    await client.callTool({ name: 'sb_remove', arguments: { id: 'tx', dry_run: false } });
    expect(puts.at(-1)).toEqual({ page: 'pg', peer: undefined });
    await close();
  });
});
