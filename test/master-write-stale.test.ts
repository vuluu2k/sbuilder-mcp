import { describe, it, expect, vi } from 'vitest';
import { LiveSession } from '../src/live/session.js';
import { RealtimeSocket, type SocketLike } from '../src/transport/socket.js';
import { PageSession } from '../src/tools/page.js';
import { Session } from '../src/transport/auth.js';
import { request } from '../src/transport/http.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

/**
 * A SHARED MASTER'S WRITE MUST REACH THE OPEN COPY. The page composes a global
 * header (and the cart drawer); a write to that master — `sb_api_call` on
 * `/global-sections/{id}[/document]`, or a peer's save announced as a
 * `global` / `overlay` frame — replaces what this copy was composed from, and
 * the next page save would decompose the old composition back over it.
 */
const page = () => ({
  schema_version: 2,
  root_node_id: 'ROOT',
  nodes: {
    ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['hdr', 'sec', 'cart'] } },
    hdr: { id: 'hdr', data: { type: 'flex-section', parent: 'ROOT', nodes: [] }, specials: { globalId: 'g1', globalKind: 'header', globalRev: 5 } },
    sec: { id: 'sec', data: { type: 'flex-section', parent: 'ROOT', nodes: ['he'] }, style: {} },
    he: { id: 'he', data: { type: 'heading', parent: 'sec', nodes: [] }, specials: { text: 'Hi' } },
    cart: { id: 'cart', data: { type: 'cart-drawer', parent: 'ROOT', nodes: [] }, specials: { overlayId: 'ov1', overlayRev: 3 } },
  },
});

function world() {
  let gets = 0;
  const f = vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    if (!path.endsWith('/source')) return json({});
    if (method === 'GET') gets += 1;
    return json({ source: { pageId: 'pg', document: page() } });
  }) as unknown as typeof fetch;
  const s = new Session('http://x', f);
  (s as unknown as { access: string }).access = 'jwt';
  const ctx = { base: 'http://x', session: s, fetchImpl: f, notices: new Notices(), undo: new UndoLog() };
  const ps = new PageSession(ctx as never);
  return { ps, ctx, f, gets: () => gets };
}

const setText = [{ op: 'set' as const, path: ['nodes', 'he', 'specials', 'text'], value: 'Mine' }];

describe('a raw write to a global-section master', () => {
  it.each([
    ['PUT', '/api/sites/s1/global-sections/g1/document'],
    ['PATCH', '/api/sites/s1/global-sections/g1'],
    ['DELETE', '/api/sites/s1/global-sections/g1'],
  ])('%s %s: the next write re-pulls first', async (method, path) => {
    const w = world();
    await w.ps.open('s1', 'pg');
    await request({ base: 'http://x', method, path, body: method === 'PUT' ? { document: {} } : undefined, fetchImpl: w.f });
    const before = w.gets();
    await w.ps.applyAndSave(setText);
    expect(w.gets()).toBe(before + 1);
  });

  it.each([
    ['a master this page does not compose', 's1', 'g2'],
    ['the same id on another site', 's2', 'g1'],
  ])('%s leaves the copy alone', async (_, site, id) => {
    const w = world();
    await w.ps.open('s1', 'pg');
    await request({ base: 'http://x', method: 'PUT', path: `/api/sites/${site}/global-sections/${id}/document`, body: { document: {} }, fetchImpl: w.f });
    const before = w.gets();
    await w.ps.applyAndSave(setText);
    expect(w.gets()).toBe(before);
  });
});

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readyState = 1;
  send(_data: string) {}
  close() {}
}

describe("the room's global / overlay frames (realtime/event.go EvGlobal, EvOverlay)", () => {
  async function room() {
    const w = world();
    const fake = new FakeSocket();
    fake.send = (data: string) => {
      const f = JSON.parse(data);
      if (f.t === 'ops') queueMicrotask(() => fake.onmessage!({ data: JSON.stringify({ t: 'ack', opId: f.opId, seq: 1 }) }));
    };
    const sock = new RealtimeSocket('ws://x', () => 'tok', () => fake);
    const live = new LiveSession(sock, {
      onRemote: (p) => w.ps.applyRemote(p),
      onDesync: (r) => w.ps.markStale(r),
      onMaster: (kind, id, op, rev) => w.ps.masterSaved(kind, id, op, rev),
    });
    sock.connect();
    fake.onopen!();
    w.ps.attachLive(live, 's1');
    const deliver = (e: Record<string, unknown>) => fake.onmessage!({ data: JSON.stringify(e) });
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    await w.ps.open('s1', 'pg');
    return { w, deliver };
  }

  it.each([
    [{ t: 'global', op: 'saved', globalId: 'g1', rev: 6 }, true],
    [{ t: 'global', op: 'deleted', globalId: 'g1', rev: 0 }, true],
    [{ t: 'overlay', op: 'saved', overlayId: 'ov1', rev: 4 }, true],
    // Our own save's echo: the rev the save already re-stamped.
    [{ t: 'global', op: 'saved', globalId: 'g1', rev: 5 }, false],
    [{ t: 'global', op: 'meta', globalId: 'g1', rev: 9 }, false],
    [{ t: 'global', op: 'saved', globalId: 'g2', rev: 9 }, false],
    [{ t: 'overlay', op: 'saved', overlayId: 'ov2', rev: 9 }, false],
  ])('%j → re-pull before the next write: %s', async (frame, repull) => {
    const { w, deliver } = await room();
    deliver(frame);
    await Promise.resolve();
    const before = w.gets();
    await w.ps.applyAndSave(setText);
    expect(w.gets()).toBe(before + (repull ? 1 : 0));
  });
});
