import { describe, it, expect } from 'vitest';
import { LiveSession } from '../src/live/session.js';
import { RealtimeSocket, type SocketLike } from '../src/transport/socket.js';

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readyState = 1;
  sent: Array<Record<string, unknown>> = [];
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() {}
}

function harness() {
  const fake = new FakeSocket();
  const sock = new RealtimeSocket('ws://x', () => 'tok', () => fake);
  const remote: unknown[] = [];
  const desync: string[] = [];
  const live = new LiveSession(sock, {
    onRemote: (p) => remote.push(...p),
    onDesync: (r) => desync.push(r),
  });
  sock.connect();
  fake.onopen!();
  const deliver = (e: Record<string, unknown>) => fake.onmessage!({ data: JSON.stringify(e) });
  return { fake, live, deliver, remote, desync };
}

describe('LiveSession', () => {
  it('announces the page it opened after the welcome', () => {
    const { fake, live, deliver } = harness();
    live.start('pg_1');
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    expect(fake.sent.some((f) => f.t === 'page' && f.pageId === 'pg_1')).toBe(true);
  });

  it('tracks the roster and knows when a human is present', () => {
    const { live, deliver } = harness();
    live.start('pg_1');
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    expect(live.humanPresent).toBe(false);
    deliver({ t: 'join', peer: { id: 'p2', userId: 'u2', name: 'Vu', color: '#f00', pageId: 'pg_1' } });
    expect(live.humanPresent).toBe(true);
    deliver({ t: 'leave', peerId: 'p2' });
    expect(live.humanPresent).toBe(false);
  });

  it('publishes patches as one ops frame carrying an opId', () => {
    const { fake, live, deliver } = harness();
    live.start('pg_1');
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    live.publish([{ op: 'set', path: ['nodes', 'a', 'style', 'gap'], value: '8px' }]);
    const ops = fake.sent.find((f) => f.t === 'ops')!;
    expect(ops.pageId).toBe('pg_1');
    expect((ops.ops as unknown[]).length).toBe(1);
    expect(typeof ops.opId).toBe('string');
    expect(live.pendingAcks).toBe(1);
  });

  it('never sends an empty ops frame - the server drops it silently', () => {
    const { fake, live, deliver } = harness();
    live.start('pg_1');
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    live.publish([]);
    live.publish([{ op: 'set', path: ['nodes'], value: {} }]);
    expect(fake.sent.filter((f) => f.t === 'ops').length).toBe(0);
  });

  it('clears the pending ack when the server orders the batch', () => {
    const { fake, live, deliver } = harness();
    live.start('pg_1');
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    live.publish([{ op: 'set', path: ['nodes', 'a', 'style', 'gap'], value: '8px' }]);
    const opId = fake.sent.find((f) => f.t === 'ops')!.opId;
    deliver({ t: 'ack', to: 'me', opId, seq: 7 });
    expect(live.pendingAcks).toBe(0);
    expect(live.maxSeq).toBe(7);
  });

  it('applies another peer ops batch but ignores the echo of its own', () => {
    const { live, deliver, remote } = harness();
    live.start('pg_1');
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    deliver({ t: 'ops', peerId: 'p2', pageId: 'pg_1', seq: 3, ops: [{ op: 'set', path: ['nodes', 'b', 'style', 'gap'], value: '4px' }] });
    expect(remote.length).toBe(1);
    deliver({ t: 'ops', peerId: 'me', pageId: 'pg_1', seq: 4, ops: [{ op: 'set', path: ['nodes', 'c', 'style', 'gap'], value: '4px' }] });
    expect(remote.length).toBe(1);
  });

  it('drops a remote patch that fails admission rather than applying it', () => {
    const { live, deliver, remote } = harness();
    live.start('pg_1');
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    deliver({ t: 'ops', peerId: 'p2', pageId: 'pg_1', seq: 3, ops: [{ op: 'set', path: ['nodes'], value: {} }] });
    expect(remote.length).toBe(0);
  });

  it('raises desync on a gap in seq', () => {
    const { live, deliver, desync } = harness();
    live.start('pg_1');
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    deliver({ t: 'ops', peerId: 'p2', pageId: 'pg_1', seq: 1, ops: [{ op: 'set', path: ['nodes', 'b', 'style', 'g'], value: 1 }] });
    deliver({ t: 'ops', peerId: 'p2', pageId: 'pg_1', seq: 5, ops: [{ op: 'set', path: ['nodes', 'b', 'style', 'g'], value: 2 }] });
    expect(desync.join(' ')).toMatch(/gap/i);
  });

  it('NEVER answers a snapshot request - the yield rule', () => {
    const { fake, live, deliver } = harness();
    live.start('pg_1');
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    deliver({ t: 'snapreq', peerId: 'p2', pageId: 'pg_1', req: 'r1', to: 'me' });
    expect(fake.sent.some((f) => f.t === 'snap')).toBe(false);
  });

  it('never publishes a checkpoint of its own - it yields rather than arbitrates', () => {
    const { fake, live, deliver } = harness();
    live.start('pg_1');
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    live.publish([{ op: 'set', path: ['nodes', 'a', 'style', 'gap'], value: '8px' }]);
    expect(fake.sent.some((f) => f.t === 'ckpt')).toBe(false);
  });

  it('ignores frames for another page', () => {
    const { live, deliver, remote } = harness();
    live.start('pg_1');
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    deliver({ t: 'ops', peerId: 'p2', pageId: 'pg_OTHER', seq: 2, ops: [{ op: 'set', path: ['nodes', 'b', 'style', 'g'], value: 1 }] });
    expect(remote.length).toBe(0);
  });
});
