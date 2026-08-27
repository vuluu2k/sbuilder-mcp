import { describe, it, expect } from 'vitest';
import { RealtimeSocket, type SocketLike } from '../src/transport/socket.js';

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
});
