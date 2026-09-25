import { describe, it, expect, vi } from 'vitest';
import { LiveSession } from '../src/live/session.js';
import { RealtimeSocket, type SocketLike } from '../src/transport/socket.js';
import { PageSession } from '../src/tools/page.js';
import { request } from '../src/transport/http.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readyState = 1;
  sent: Array<Record<string, any>> = [];
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() {}
}

type Doc = { schema_version: number; root_node_id: string; nodes: Record<string, any> };
const page = (): Doc => ({
  schema_version: 2,
  root_node_id: 'ROOT',
  nodes: {
    ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['sec'] } },
    sec: { id: 'sec', data: { type: 'flex-section', parent: 'ROOT', nodes: ['he', 'tx'] }, style: {} },
    he: { id: 'he', data: { type: 'heading', parent: 'sec', nodes: [] }, specials: { text: 'Hi' } },
    tx: { id: 'tx', data: { type: 'text', parent: 'sec', nodes: [] }, specials: { text: 'Body' } },
  },
});

/** A site whose page sources live in memory; every call recorded. */
function world() {
  const docs: Record<string, Doc> = { pg_a: page(), pg_b: page() };
  const calls: string[] = [];
  const f = vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${path}`);
    const id = path.split('/')[5];
    if (method === 'PUT') docs[id] = JSON.parse(String(init!.body)).document;
    return new Response(JSON.stringify({ source: { pageId: id, document: docs[id] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  const s = new Session('http://x', f);
  (s as unknown as { access: string }).access = 'jwt';
  const ctx = { base: 'http://x', session: s, fetchImpl: f, notices: new Notices(), undo: new UndoLog() };

  const fake = new FakeSocket();
  const sock = new RealtimeSocket('ws://x', () => 'tok', () => fake);
  const live = new LiveSession(sock, { onRemote: () => {}, onDesync: () => {} });
  sock.connect();
  fake.onopen!();
  const ps = new PageSession(ctx);
  ps.attachLive(live, 's1');
  const deliver = (e: Record<string, unknown>) => fake.onmessage!({ data: JSON.stringify(e) });
  deliver({ t: 'welcome', peerId: 'me', peers: [{ id: 'h1', userId: 'u', name: 'Vu', color: '#f00', pageId: 'pg_b' }] });
  return { ctx, ps, fake, calls, deliver, docs };
}

const ops = (fake: FakeSocket) => fake.sent.filter((f) => f.t === 'ops');

describe('every page-document write this server makes reaches the live room', () => {
  it('a raw PUT of a watched page is announced as node-level ops for THAT page', async () => {
    const { ctx, fake } = world();
    const next = page();
    next.nodes.he.specials.text = 'Changed';
    next.nodes.sec.data.nodes = ['he'];
    delete next.nodes.tx;
    await request({
      base: ctx.base,
      method: 'PUT',
      path: '/api/sites/s1/pages/pg_b/source',
      token: 'jwt',
      body: { document: next, schemaVersion: 2 },
      fetchImpl: ctx.fetchImpl,
    });
    const sent = ops(fake);
    expect(sent.length).toBe(1);
    expect(sent[0].pageId).toBe('pg_b');
    expect(sent[0].ops).toEqual([
      { op: 'set', path: ['nodes', 'sec'], value: next.nodes.sec },
      { op: 'set', path: ['nodes', 'he'], value: next.nodes.he },
      { op: 'unset', path: ['nodes', 'tx'] },
    ]);
  });

  it('a page nobody is watching costs no extra read and sends nothing', async () => {
    const { ctx, fake, calls } = world();
    await request({
      base: ctx.base,
      method: 'PUT',
      path: '/api/sites/s1/pages/pg_a/source',
      token: 'jwt',
      body: { document: page(), schemaVersion: 2 },
      fetchImpl: ctx.fetchImpl,
    });
    expect(calls).toEqual(['PUT /api/sites/s1/pages/pg_a/source']);
    expect(ops(fake)).toEqual([]);
  });

  it("the session's own save is not announced twice", async () => {
    const { ps, fake, calls } = world();
    await ps.open('s1', 'pg_b');
    calls.length = 0;
    await ps.applyAndSave([{ op: 'set', path: ['nodes', 'he', 'specials', 'text'], value: 'Mine' }]);
    expect(ops(fake).length).toBe(1);
    expect(ops(fake)[0].ops).toEqual([{ op: 'set', path: ['nodes', 'he', 'specials', 'text'], value: 'Mine' }]);
    expect(calls.filter((c) => c.endsWith('/source'))).toEqual(['PUT /api/sites/s1/pages/pg_b/source']);
  });

  it('a root rename is not sent as ops the editor cannot follow', async () => {
    const { ctx, fake, docs } = world();
    // Stored with a minted root; the write (healed on the way out) renames it.
    docs.pg_b = JSON.parse(JSON.stringify(page()).split('"ROOT"').join('"sppro_1"'));
    await request({
      base: ctx.base, method: 'PUT', path: '/api/sites/s1/pages/pg_b/source', token: 'jwt',
      body: { document: page(), schemaVersion: 2 }, fetchImpl: ctx.fetchImpl,
    });
    expect(ops(fake)).toEqual([]);
  });
});

describe('a raw write to the page this session has open', () => {
  it.each(['pg_a', 'pg_b'])('%s: the next edit does not resurrect what the raw write removed', async (pg) => {
    const { ctx, ps, docs } = world();
    await ps.open('s1', pg);
    const next = page();
    next.nodes.sec.data.nodes = ['he'];
    delete next.nodes.tx;
    await request({
      base: ctx.base, method: 'PUT', path: `/api/sites/s1/pages/${pg}/source`, token: 'jwt',
      body: { document: next, schemaVersion: 2 }, fetchImpl: ctx.fetchImpl,
    });
    await ps.applyAndSave([{ op: 'set', path: ['nodes', 'he', 'specials', 'text'], value: 'Mine' }]);
    expect(docs[pg].nodes.tx).toBeUndefined();
    expect(docs[pg].nodes.sec.data.nodes).toEqual(['he']);
    expect(docs[pg].nodes.he.specials.text).toBe('Mine');
  });

  it('a throwing announce does not fail a write that succeeded', async () => {
    const { ctx, fake, docs } = world();
    fake.send = () => { throw new Error('socket gone'); };
    const next = page();
    next.nodes.he.specials.text = 'Changed';
    await expect(request({
      base: ctx.base, method: 'PUT', path: '/api/sites/s1/pages/pg_b/source', token: 'jwt',
      body: { document: next, schemaVersion: 2 }, fetchImpl: ctx.fetchImpl,
    })).resolves.toBeTruthy();
    expect(docs.pg_b.nodes.he.specials.text).toBe('Changed');
  });
});

describe('a raw write to the open page with NO live room', () => {
  it('still marks the copy stale, so the next edit does not overwrite it', async () => {
    const docs: Record<string, Doc> = { pg_a: page() };
    const calls: string[] = [];
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${path}`);
      const id = path.split('/')[5];
      if (method === 'PUT') docs[id] = JSON.parse(String(init!.body)).document;
      return new Response(JSON.stringify({ source: { pageId: id, document: docs[id] } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const s = new Session('http://x', f);
    (s as unknown as { access: string }).access = 'jwt';
    const ctx = { base: 'http://x', session: s, fetchImpl: f, notices: new Notices(), undo: new UndoLog() };
    const ps = new PageSession(ctx as never);
    await ps.open('s1', 'pg_a');
    const next = page();
    next.nodes.sec.data.nodes = ['he'];
    delete next.nodes.tx;
    calls.length = 0;
    await request({
      base: ctx.base, method: 'PUT', path: '/api/sites/s1/pages/pg_a/source', token: 'jwt',
      body: { document: next, schemaVersion: 2 }, fetchImpl: ctx.fetchImpl,
    });
    // Nobody to announce to: the raw write costs no extra read.
    expect(calls).toEqual(['PUT /api/sites/s1/pages/pg_a/source']);
    await ps.applyAndSave([{ op: 'set', path: ['nodes', 'he', 'specials', 'text'], value: 'Mine' }]);
    expect(docs.pg_a.nodes.tx).toBeUndefined();
    expect(docs.pg_a.nodes.he.specials.text).toBe('Mine');
  });
});
