import { describe, it, expect, vi } from 'vitest';
import { LiveSession } from '../src/live/session.js';
import { RealtimeSocket, type SocketLike } from '../src/transport/socket.js';
import { PageSession } from '../src/tools/page.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

/**
 * web_builder 1dbc88a2c: GET/PUT …/source answer `rev`; a PUT carrying
 * `baseRev` the draft has moved past is refused 409 `source_stale`; every save
 * broadcasts `{t:'source', pageId, rev}` to the site's room.
 */
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

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readyState = 1;
  send() {}
  close() {}
}

/** One page in memory. `revs:false` is a platform older than the fence. `fence:false` ignores baseRev. */
function world(opts: { revs?: boolean; fence?: boolean } = {}) {
  const revs = opts.revs !== false;
  const server = { doc: page(), rev: 100 };
  const puts: any[] = [];
  let gets = 0;
  let hook: (() => void) | undefined;
  const f = vi.fn(async (url: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (!new URL(String(url)).pathname.endsWith('/source')) return json({});
    if (method === 'PUT') {
      const body = JSON.parse(String(init!.body));
      puts.push(body);
      if (opts.fence !== false && body.baseRev && body.baseRev !== server.rev) {
        return json({ error: 'page: the draft was saved elsewhere since it was loaded', code: 'source_stale', details: { rev: String(server.rev) } }, 409);
      }
      server.doc = body.document;
      server.rev += 1;
    } else {
      gets += 1;
      hook?.();
      hook = undefined;
    }
    return json({ source: { pageId: 'pg', document: server.doc, ...(revs ? { rev: server.rev } : {}) } });
  }) as unknown as typeof fetch;
  const s = new Session('http://x', f);
  (s as unknown as { access: string }).access = 'jwt';
  const ctx = { base: 'http://x', session: s, fetchImpl: f, notices: new Notices(), undo: new UndoLog() };
  const ps = new PageSession(ctx as never);
  /** Somebody else saves the page behind this session's back. */
  const elsewhere = (edit: (d: Doc) => void) => {
    edit(server.doc);
    server.rev += 1;
  };
  return { ps, server, puts, gets: () => gets, elsewhere, onGet: (f: () => void) => (hook = f) };
}

const setText = (id: string, text: string) => [{ op: 'set' as const, path: ['nodes', id, 'specials', 'text'], value: text }];

describe('PUT …/source carries baseRev', () => {
  it('sends the rev it read, then the rev its own save returned', async () => {
    const { ps, puts } = world();
    await ps.open('s1', 'pg');
    await ps.applyAndSave(setText('he', 'One'));
    await ps.applyAndSave(setText('he', 'Two'));
    expect(puts.map((p) => p.baseRev)).toEqual([100, 101]);
  });

  it('sends none to a platform that reports no rev', async () => {
    const { ps, puts } = world({ revs: false });
    await ps.open('s1', 'pg');
    await ps.applyAndSave(setText('he', 'One'));
    expect(puts[0]).not.toHaveProperty('baseRev');
  });

  it('409 source_stale: re-pulls and reapplies once when the other save touched nothing it edits', async () => {
    const { ps, server, elsewhere } = world();
    await ps.open('s1', 'pg');
    elsewhere((d) => {
      d.nodes.sec.data.nodes = ['he'];
      delete d.nodes.tx;
    });
    await ps.applyAndSave(setText('he', 'Mine'));
    expect(server.doc.nodes.tx).toBeUndefined();
    expect(server.doc.nodes.he.specials.text).toBe('Mine');
  });

  it('409 source_stale: fails loudly when the other save edited the same node', async () => {
    const { ps, server, elsewhere } = world();
    await ps.open('s1', 'pg');
    elsewhere((d) => {
      d.nodes.he.specials.text = 'Theirs';
    });
    await expect(ps.applyAndSave(setText('he', 'Mine'))).rejects.toThrow(/changed under this session.*he/);
    expect(server.doc.nodes.he.specials.text).toBe('Theirs');
  });
});

describe("the room's {t:'source'} frame", () => {
  function room(w: ReturnType<typeof world>) {
    const fake = new FakeSocket();
    const sock = new RealtimeSocket('ws://x', () => 'tok', () => fake);
    const live = new LiveSession(sock, {
      onRemote: (patches) => w.ps.applyRemote(patches),
      onDesync: () => {},
      onSource: (pageId, rev) => w.ps.sourceSaved(pageId, rev),
    });
    sock.connect();
    fake.onopen!();
    w.ps.attachLive(live, 's1');
    live.start('pg');
    return (e: Record<string, unknown>) => fake.onmessage!({ data: JSON.stringify(e) });
  }

  it("a save this session did not make: the next write re-pulls first", async () => {
    const w = world({ fence: false });
    const deliver = room(w);
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    await w.ps.open('s1', 'pg');
    w.elsewhere((d) => {
      d.nodes.sec.data.nodes = ['he'];
      delete d.nodes.tx;
    });
    deliver({ t: 'source', pageId: 'pg', rev: w.server.rev });
    await w.ps.applyAndSave(setText('he', 'Mine'));
    expect(w.server.doc.nodes.tx).toBeUndefined();
    expect(w.server.doc.nodes.he.specials.text).toBe('Mine');
  });

  // A peer's ops arrive, then that peer autosaves. Their edit is not an
  // unsaved LOCAL edit of this session, so the write re-pulls and reapplies.
  const peerEdits = (w: ReturnType<typeof world>, deliver: (e: Record<string, unknown>) => void, id: string) => {
    const op = { op: 'set', path: ['nodes', id, 'specials', 'text'], value: 'Peer' };
    deliver({ t: 'ops', pageId: 'pg', seq: 1, peerId: 'human', ops: [op] });
    expect(w.ps.current().doc.nodes[id].specials!.text).toBe('Peer');
    w.elsewhere((d) => {
      d.nodes[id].specials.text = 'Peer';
    });
    deliver({ t: 'source', pageId: 'pg', rev: w.server.rev });
  };

  it("a peer's applied ops then its save: a write to another node goes through", async () => {
    const w = world();
    const deliver = room(w);
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    await w.ps.open('s1', 'pg');
    peerEdits(w, deliver, 'tx');
    await w.ps.applyAndSave(setText('he', 'Mine'));
    expect(w.server.doc.nodes.he.specials.text).toBe('Mine');
    expect(w.server.doc.nodes.tx.specials.text).toBe('Peer');
  });

  it("a peer's applied ops then its save: a write to the SAME node fails loudly", async () => {
    const w = world();
    const deliver = room(w);
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    await w.ps.open('s1', 'pg');
    peerEdits(w, deliver, 'he');
    await expect(w.ps.applyAndSave(setText('he', 'Mine'))).rejects.toThrow(/changed under this session/);
    expect(w.server.doc.nodes.he.specials.text).toBe('Peer');
  });

  it('its own save, another page, and an unknown frame type change nothing', async () => {
    const w = world({ fence: false });
    const deliver = room(w);
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    await w.ps.open('s1', 'pg');
    await w.ps.applyAndSave(setText('he', 'One'));
    const reads = w.gets();
    deliver({ t: 'source', pageId: 'pg', rev: w.server.rev });
    deliver({ t: 'source', pageId: 'other', rev: w.server.rev + 5 });
    expect(() => deliver({ t: 'something-new', pageId: 'pg', rev: 1 })).not.toThrow();
    await w.ps.applyAndSave(setText('he', 'Two'));
    expect(w.gets()).toBe(reads);
  });
});
