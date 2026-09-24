import { describe, it, expect } from 'vitest';
import { RealtimeSocket, type SocketLike } from '../src/transport/socket.js';
import { setAgentClient } from '../src/transport/identity.js';

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readyState = 1;
  sent: string[] = [];
  closed = false;
  send(d: string) { this.sent.push(d); }
  close() { this.closed = true; }
}

describe('RealtimeSocket', () => {
  it('sends the auth frame FIRST, from onopen', () => {
    const fake = new FakeSocket();
    const s = new RealtimeSocket('ws://x/api/realtime/ws?site=s1', () => 'tok', () => fake);
    s.connect();
    fake.onopen!();
    expect(JSON.parse(fake.sent[0])).toEqual({ t: 'auth', token: 'tok' });
  });

  it('reads the token per attempt, never captured', () => {
    let token = 'first';
    const sockets: FakeSocket[] = [];
    const s = new RealtimeSocket('ws://x', () => token, () => {
      const f = new FakeSocket();
      sockets.push(f);
      return f;
    });
    s.connect();
    sockets[0].onopen!();
    token = 'rotated';
    s.connect();
    sockets[1].onopen!();
    expect(JSON.parse(sockets[1].sent[0]).token).toBe('rotated');
  });

  it('delivers decoded frames to the handler', () => {
    const fake = new FakeSocket();
    const seen: unknown[] = [];
    const s = new RealtimeSocket('ws://x', () => 't', () => fake);
    s.on((e) => seen.push(e));
    s.connect();
    fake.onmessage!({ data: JSON.stringify({ t: 'welcome', peerId: 'p1', peers: [] }) });
    expect(seen).toEqual([{ t: 'welcome', peerId: 'p1', peers: [] }]);
  });

  it('ignores a frame that is not JSON rather than throwing into the socket', () => {
    const fake = new FakeSocket();
    const s = new RealtimeSocket('ws://x', () => 't', () => fake);
    s.on(() => { throw new Error('should not be called'); });
    s.connect();
    expect(() => fake.onmessage!({ data: 'not json' })).not.toThrow();
  });

  it('resets the backoff on the first MESSAGE, not on open', () => {
    const fake = new FakeSocket();
    const s = new RealtimeSocket('ws://x', () => 't', () => fake);
    s.connect();
    fake.onopen!();
    expect(s.attempts).toBe(1);
    fake.onmessage!({ data: JSON.stringify({ t: 'welcome', peers: [] }) });
    expect(s.attempts).toBe(0);
  });

  it('does not send once closed', () => {
    const fake = new FakeSocket();
    const s = new RealtimeSocket('ws://x', () => 't', () => fake);
    s.connect();
    s.close();
    s.send({ t: 'cursor', x: 1, y: 2 });
    expect(fake.sent.length).toBe(0);
  });

  it('does not send before the socket is open', () => {
    const fake = new FakeSocket();
    fake.readyState = 0;
    const s = new RealtimeSocket('ws://x', () => 't', () => fake);
    s.connect();
    s.send({ t: 'cursor', x: 1, y: 2 });
    expect(fake.sent.length).toBe(0);
  });

  // The edit made right after sb_page_open — before the handshake finished —
  // used to be DROPPED, so an open editor never saw it.
  it('holds frames sent before the welcome and flushes them after it, in order', () => {
    const fake = new FakeSocket();
    fake.readyState = 0;
    const s = new RealtimeSocket('ws://x', () => 't', () => fake);
    const order: string[] = [];
    s.on((e) => {
      if (e.t === 'welcome') s.send({ t: 'page', pageId: 'pg' });
    });
    s.connect();
    s.send({ t: 'ops', opId: 'a' });
    fake.readyState = 1;
    fake.onopen!();
    s.send({ t: 'ops', opId: 'b' }); // open, but not welcomed: auth may still fail
    expect(fake.sent.map((f) => JSON.parse(f).t), 'sent before the welcome').toEqual(['auth']);
    fake.onmessage!({ data: JSON.stringify({ t: 'welcome', peerId: 'p', peers: [] }) });
    for (const f of fake.sent) order.push(JSON.parse(f).opId ?? JSON.parse(f).t);
    expect(order, 'queued frames lost or out of order').toEqual(['auth', 'page', 'a', 'b']);
    s.send({ t: 'ops', opId: 'c' });
    expect(JSON.parse(fake.sent.at(-1)!).opId, 'ready socket did not send directly').toBe('c');
  });

  it('holds frames across a reconnect too', () => {
    const socks: FakeSocket[] = [];
    const s = new RealtimeSocket('ws://x', () => 't', () => {
      const f = new FakeSocket();
      socks.push(f);
      return f;
    });
    s.connect();
    socks[0].onopen!();
    socks[0].onmessage!({ data: JSON.stringify({ t: 'welcome', peers: [] }) });
    socks[0].onclose!();
    s.send({ t: 'ops', opId: 'during-gap' });
    expect(socks[0].sent.map((f) => JSON.parse(f).t), 'sent into a closed socket').toEqual(['auth']);
    s.connect();
    socks[1].onopen!();
    socks[1].onmessage!({ data: JSON.stringify({ t: 'welcome', peers: [] }) });
    expect(socks[1].sent.map((f) => JSON.parse(f).opId ?? JSON.parse(f).t)).toEqual(['auth', 'during-gap']);
    s.close();
  });
});

/**
 * WHICH HARNESS IS MOVING THE CURSOR.
 *
 * The editor paints one robot glyph for every `kind === 'agent'` peer
 * (`PresenceBar.vue`, `PeerCursors.vue`), so a merchant watching their own
 * canvas cannot tell Claude Code from Cursor from a cron job. The identity that
 * would answer it already exists — `X-Agent-Client` rides on every HTTP call —
 * and it structurally CANNOT reach this socket, because a browser cannot set a
 * header on a WebSocket, which is the very reason auth is a frame here.
 *
 * So the frame carries it, and the two properties below are what make that safe
 * to ship before the platform reads it.
 */
describe('the auth frame names the harness', () => {
  const frame = (fake: FakeSocket) => JSON.parse(fake.sent[0]) as Record<string, unknown>;

  it('is BYTE-IDENTICAL to the old frame when no client identified itself', () => {
    // The property that lets this land on its own. A client sending nothing is
    // legal (`setAgentClient` is explicit that an invented name would be worse
    // than none), and the frame it produces must not change at all — otherwise
    // the addition is a wire change for every install that never identified.
    setAgentClient(undefined, '');
    const fake = new FakeSocket();
    new RealtimeSocket('ws://x', () => 'tok', () => fake).connect();
    fake.onopen!();
    expect(frame(fake)).toEqual({ t: 'auth', token: 'tok' });
  });

  it('carries the client and its version once the handshake named them', () => {
    setAgentClient({ name: 'claude-code', version: '2.1.0' }, '0.43.0');
    const fake = new FakeSocket();
    new RealtimeSocket('ws://x', () => 'tok', () => fake).connect();
    fake.onopen!();
    expect(frame(fake)).toEqual({
      t: 'auth',
      token: 'tok',
      client: 'claude-code',
      clientVersion: '2.1.0',
    });
  });

  it('omits a half-identified client rather than sending it blank', () => {
    // `identityHeaders` draws this distinction on the HTTP side and the socket
    // must draw the same one: absent and empty-string must not mean two things
    // in two places.
    setAgentClient({ name: 'some-harness' }, '');
    const fake = new FakeSocket();
    new RealtimeSocket('ws://x', () => 'tok', () => fake).connect();
    fake.onopen!();
    expect(frame(fake)).toEqual({ t: 'auth', token: 'tok', client: 'some-harness' });
    expect(frame(fake)).not.toHaveProperty('clientVersion');
  });

  it('re-reads the identity per attempt, never captures it', () => {
    // The same trap the token getter exists for, one field over: a socket that
    // snapshotted the identity at construction would report the handshake that
    // had not happened yet, because `connect()` can precede `setAgentClient`.
    setAgentClient(undefined, '');
    const fake = new FakeSocket();
    const s = new RealtimeSocket('ws://x', () => 'tok', () => fake);
    s.connect();
    fake.onopen!();
    expect(frame(fake)).not.toHaveProperty('client');
    setAgentClient({ name: 'cursor-vscode', version: '0.9' }, '');
    fake.onopen!();
    expect(JSON.parse(fake.sent[1])).toMatchObject({ client: 'cursor-vscode' });
  });
});
