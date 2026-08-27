# `@sbuilder/mcp` Phase 3 — Live Editing and Sight

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent visible and self-correcting — it joins the editor's live-edit room as a real peer whose edits appear as they happen, and it can look at the rendered page and judge its own work.

**Architecture:** A WebSocket client speaks the platform's own live-edit protocol; a live session batches the builder's patches into `ops` frames and accounts for their server-assigned `seq`. Presence frames carry a cursor whose coordinates come from real element bounding boxes, measured by the same Playwright pass that takes the screenshots.

**Tech Stack:** Node's **native** `WebSocket` (no dependency) and `playwright-core` driving **system Chrome** (no browser download). Otherwise as Phases 1–2.

**Spec:** `docs/superpowers/specs/2026-08-27-sbuilder-mcp-design.md`

## What Phases 1–2 established

Transport (`http`, `auth`, `credential`, `pages`), the generated API and element catalogs,
`core/{patch,tree}`, `domains/site/{traps,ids,node,document,builder,validate}`, and 13 tools.
Gate: `npm run build && npm test && npm run smoke`, smoke ending `ALL GOOD`.

## Global Constraints

Every Phase 1–2 constraint still holds. What this phase adds:

- **Node ≥22, not ≥20.** `engines` moves up because this phase uses the **global
  `WebSocket`**, which is unflagged from Node 22. The alternative was a `ws` dependency for
  a runtime the platform's own dev stack already exceeds; a version floor is the cheaper
  cost and it is stated rather than discovered.
- **No browser download.** `playwright-core` launches with `channel: 'chrome'` — the
  system Chrome. Verified before this plan: a screenshot plus `[data-node-id]` bounding
  boxes came back with nothing fetched. When Chrome is absent, `sb_look` **says so by
  name**; it never degrades to a blank image.
- **The agent never answers `snapreq`.** See the yield rule below. This is the one rule
  that makes a simple client safe in a room with a human.
- **Cursor coordinates are LAYOUT pixels, never screen pixels.** The canvas is zoomed per
  viewer, so a screen coordinate lands somewhere else on a peer with a different window.

## The wire protocol — measured, not remembered

Read from `server/internal/realtime/event.go` and `ws/ws.go`.

Connect: `GET <SB_API as ws>/api/realtime/ws?site=<siteId>`. **No `Origin` header** — the
origin gate explicitly permits that (`"reachable by curl/tests"`), so a Node client needs no
operator change.

The **first frame** must be `{"t":"auth","token":"<session JWT>"}`, inside a 5s deadline and
under 64 KiB. Everything else is refused before it.

| Frame | Direction | Fields that matter |
| --- | --- | --- |
| `auth` | → | `token` |
| `welcome` | ← | `peerId`, `peers[]`, `globals[]`, `globalsKnown` |
| `join` / `leave` | ← | `peer` / `peerId` |
| `page` | ↔ | `pageId` — "this peer opened another page" |
| `cursor` | ↔ | `x`, `y` (layout px), `pageId` |
| `select` | ↔ | `pageId`, `nodeId` (empty = cleared) |
| `ops` | ↔ | `pageId`, `ops[]`, `opId` out; `peerId`, `seq` back |
| `ack` | ← | `to`, `opId`, `seq` — **to the sender only** |
| `snapreq` | → | `pageId`, `req` |
| `snap` | ← | `to`, `req`, `doc?`, `seq` — absent `doc` means "your HTTP load is authoritative" |
| `ckpt` | ↔ | `pageId`, `seq`, `hash` |

Frame-size rule: `ops` and `snap` may reach 4 MiB; **every other kind is capped at 64 KiB**.
A batch that would exceed it must be split, or the socket is closed with
`StatusMessageTooBig` — which is a dropped connection, not a rejected frame.

The server drops `ops` with an empty `pageId` or an empty `ops[]` **silently** (`continue`),
so a malformed batch is not an error anyone reports. Guard before sending.

### The yield rule

> When a human peer is in the room, the agent is never the authority. It does not answer
> `snapreq` for anyone. On any evidence of divergence — a gap in `seq`, a `ckpt` mismatch,
> or a rejected `PUT /source` — it discards its copy, re-pulls, and replays whatever intent
> was still outstanding.

This is what lets the client skip the editor's outbox deferral, inbox gap arbitration and
"who pulls" tie-break — roughly a thousand lines whose entire purpose is arbitrating between
**two equally authoritative** editors. Alone in the room the agent is the sole writer and
the rule costs nothing, so it is a mode rather than a permanent sacrifice.

---

### Task 1: The socket client

**Files:**
- Create: `src/transport/socket.ts`
- Modify: `package.json` (engines → `>=22`)
- Test: `test/socket.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface SocketLike { send(data: string): void; close(): void; readyState: number; onopen: (() => void) | null; onmessage: ((ev: { data: unknown }) => void) | null; onclose: (() => void) | null; onerror: ((e: unknown) => void) | null }`; `interface RealtimeEvent { t: string; [k: string]: unknown }`; `class RealtimeSocket { constructor(url: string, token: () => string, factory?: (url: string) => SocketLike); connect(): void; send(e: RealtimeEvent): void; on(handler: (e: RealtimeEvent) => void): void; close(): void; readonly attempts: number }`.

Two bugs the editor already shipped and fixed are designed out here from the start
(`editor/src/features/realtime/socket.ts`, MF1):

- **The token is a getter, read per attempt.** Captured once, a reconnect after the ~15
  minute rotation replays an expired token forever.
- **The backoff counter resets on the first MESSAGE, not on `onopen`.** A rejected auth
  still fires `onopen` — the handshake succeeded and the server only closes after reading
  the auth frame — so resetting there produces `open → attempt=0 → auth → close → 500ms →
  forever`: a 2 Hz reconnect storm with no `onerror` (a policy close is not an error) and
  nothing at all in any UI.

- [ ] **Step 1: Bump the engine floor**

In `package.json`: `"engines": { "node": ">=22" }`, and add a line to `CLAUDE.md`'s
invariants saying why (global `WebSocket` is unflagged from 22; the alternative was a `ws`
dependency).

- [ ] **Step 2: Write the failing test**

```ts
// test/socket.test.ts
import { describe, it, expect, vi } from 'vitest';
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
    expect(s.attempts).toBe(1); // an open alone proves nothing — auth may still be refused
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
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run test/socket.test.ts`
Expected: FAIL — `Cannot find module '../src/transport/socket.js'`.

- [ ] **Step 4: Write `src/transport/socket.ts`**

```ts
/**
 * One connection to the editor's live-edit room.
 *
 * The browser-shaped surface this needs, narrowed to a `SocketLike` so tests can
 * drive a hand-written fake — fire `onopen`, deliver a message, fire `onclose`
 * at a chosen moment — without a network or a real server. This is the editor's
 * own testing seam, and it is the reason every rule below has a test.
 */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
}

/** Every frame on this socket. `t` is the kind; the rest is per-kind. */
export interface RealtimeEvent {
  t: string;
  [k: string]: unknown;
}

/** WebSocket.OPEN per spec. A literal, so this module never touches a global. */
const OPEN = 1;
const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 15_000;

export class RealtimeSocket {
  private ws: SocketLike | null = null;
  private closed = false;
  private attempt = 0;
  private handlers: Array<(e: RealtimeEvent) => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    /**
     * A GETTER, read per attempt. The access token lives ~15 minutes and
     * rotates; a socket holding the string it was constructed with replays an
     * expired token on every reconnect, and the failure is silent — a rejected
     * auth still fires `onopen`, so there is no error event anywhere.
     */
    private readonly token: () => string,
    private readonly factory: (url: string) => SocketLike = (u) =>
      new WebSocket(u) as unknown as SocketLike,
  ) {}

  get attempts(): number {
    return this.attempt;
  }

  on(handler: (e: RealtimeEvent) => void): void {
    this.handlers.push(handler);
  }

  connect(): void {
    if (this.closed) return;
    const ws = this.factory(this.url);
    this.ws = ws;
    this.attempt += 1;

    ws.onopen = () => {
      // Auth is the FIRST message, never a header (a browser cannot set one on
      // a WebSocket) and never a query parameter (a token in a URL lands in
      // logs). The server enforces a 5s deadline, so it goes out immediately.
      ws.send(JSON.stringify({ t: 'auth', token: this.token() }));
    };

    ws.onmessage = (ev) => {
      // A frame ARRIVING is the only evidence this connection is usable. An
      // open proves nothing: a refused auth opens, then closes. Resetting on
      // open instead produced a 2 Hz reconnect storm with the backoff never
      // engaging and nothing whatsoever surfacing.
      this.attempt = 0;
      let parsed: RealtimeEvent;
      try {
        parsed = JSON.parse(String(ev.data)) as RealtimeEvent;
      } catch {
        return; // a malformed frame must never throw into the socket
      }
      for (const h of this.handlers) h(parsed);
    };

    ws.onclose = () => {
      if (this.closed) return;
      const wait = Math.min(RETRY_BASE_MS * 2 ** this.attempt, RETRY_MAX_MS);
      this.timer = setTimeout(() => this.connect(), wait);
    };

    ws.onerror = () => {
      // A policy close is not an error, so this is genuinely rare. Nothing to
      // do: onclose runs either way and owns the reconnect.
    };
  }

  send(e: RealtimeEvent): void {
    if (this.closed) return;
    if (this.ws?.readyState !== OPEN) return;
    this.ws.send(JSON.stringify(e));
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
  }
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npx vitest run test/socket.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/transport/socket.ts test/socket.test.ts package.json CLAUDE.md
git commit -m "feat(transport): the live-edit socket, with the editor's two reconnect bugs designed out"
```

---

### Task 2: The live session

**Files:**
- Create: `src/live/session.ts`
- Test: `test/live-session.test.ts`

**Interfaces:**
- Consumes: `RealtimeSocket`, `RealtimeEvent`; `Patch`, `syncable` from `src/core/patch.js`; `PageDoc`.
- Produces: `class LiveSession { constructor(socket: RealtimeSocket, opts: LiveOpts); start(pageId: string): void; publish(patches: Patch[]): void; readonly peers: Peer[]; readonly maxSeq: number; readonly humanPresent: boolean; readonly pendingAcks: number }`; `interface LiveOpts { onRemote(patches: Patch[]): void; onDesync(reason: string): void; selfName?: string }`; `interface Peer { id: string; userId: string; name: string; color: string; pageId: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// test/live-session.test.ts
import { describe, it, expect, vi } from 'vitest';
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
    live.publish([{ op: 'set', path: ['nodes'], value: {} }]); // inadmissible, filtered out
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
    const { fake, live, deliver, remote } = harness();
    live.start('pg_1');
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    deliver({
      t: 'ops', peerId: 'p2', pageId: 'pg_1', seq: 3,
      ops: [{ op: 'set', path: ['nodes', 'b', 'style', 'gap'], value: '4px' }],
    });
    expect(remote.length).toBe(1);
    deliver({
      t: 'ops', peerId: 'me', pageId: 'pg_1', seq: 4,
      ops: [{ op: 'set', path: ['nodes', 'c', 'style', 'gap'], value: '4px' }],
    });
    expect(remote.length).toBe(1); // own echo, already applied locally
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

  it('ignores frames for another page', () => {
    const { live, deliver, remote } = harness();
    live.start('pg_1');
    deliver({ t: 'welcome', peerId: 'me', peers: [] });
    deliver({ t: 'ops', peerId: 'p2', pageId: 'pg_OTHER', seq: 2, ops: [{ op: 'set', path: ['nodes', 'b', 'style', 'g'], value: 1 }] });
    expect(remote.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/live-session.test.ts`
Expected: FAIL — `Cannot find module '../src/live/session.js'`.

- [ ] **Step 3: Write `src/live/session.ts`**

```ts
import { randomBytes } from 'node:crypto';
import { syncable, isSyncablePatch, type Patch } from '../core/patch.js';
import type { RealtimeSocket, RealtimeEvent } from '../transport/socket.js';

export interface Peer {
  id: string;
  userId: string;
  name: string;
  color: string;
  pageId: string;
}

export interface LiveOpts {
  /** A batch from another peer, already admission-checked. */
  onRemote(patches: Patch[]): void;
  /** "I can no longer prove my document matches the room." */
  onDesync(reason: string): void;
}

/**
 * The agent's seat in the live-edit room.
 *
 * THE YIELD RULE governs everything here: this client never answers `snapreq`,
 * never publishes a checkpoint, and re-pulls on any evidence of divergence. That
 * is what lets it skip the editor's outbox deferral, inbox arbitration and
 * "who pulls" tie-break — about a thousand lines whose whole purpose is
 * arbitrating between two EQUALLY authoritative editors. This one is not.
 */
export class LiveSession {
  private selfId = '';
  private pageId = '';
  private roster = new Map<string, Peer>();
  private pending = new Map<string, number>();
  private seq = 0;

  constructor(
    private readonly socket: RealtimeSocket,
    private readonly opts: LiveOpts,
  ) {
    this.socket.on((e) => this.receive(e));
  }

  get peers(): Peer[] {
    return [...this.roster.values()];
  }

  /** Is anyone else here? The yield rule only bites when someone is. */
  get humanPresent(): boolean {
    return this.roster.size > 0;
  }

  get maxSeq(): number {
    return this.seq;
  }

  get pendingAcks(): number {
    return this.pending.size;
  }

  start(pageId: string): void {
    this.pageId = pageId;
    // If the welcome has already arrived, announce now; otherwise `receive`
    // does it. Either order happens depending on how fast the server answers.
    if (this.selfId) this.announcePage();
  }

  private announcePage(): void {
    if (!this.pageId) return;
    this.socket.send({ t: 'page', pageId: this.pageId });
  }

  /**
   * Put a batch of my own patches on the wire.
   *
   * Filtered through `syncable` first, and an EMPTY result is not sent at all:
   * the server drops an ops frame with no ops silently (`continue` in readPump),
   * so sending one is indistinguishable from success while achieving nothing.
   */
  publish(patches: Patch[]): void {
    if (!this.pageId) return;
    const ops = syncable(patches);
    if (ops.length === 0) return;
    const opId = randomBytes(8).toString('hex');
    this.pending.set(opId, Date.now());
    this.socket.send({ t: 'ops', pageId: this.pageId, ops, opId });
  }

  /** Move the cursor and selection — presence only, never document state. */
  cursor(x: number, y: number): void {
    if (!this.pageId) return;
    this.socket.send({ t: 'cursor', pageId: this.pageId, x, y });
  }

  select(nodeId: string): void {
    if (!this.pageId) return;
    this.socket.send({ t: 'select', pageId: this.pageId, nodeId });
  }

  private receive(e: RealtimeEvent): void {
    switch (e.t) {
      case 'welcome': {
        this.selfId = String(e.peerId ?? '');
        this.roster.clear();
        for (const p of (e.peers as Peer[]) ?? []) this.roster.set(p.id, p);
        this.announcePage();
        break;
      }
      case 'join': {
        const p = e.peer as Peer | undefined;
        if (p?.id && p.id !== this.selfId) this.roster.set(p.id, p);
        break;
      }
      case 'leave': {
        this.roster.delete(String(e.peerId ?? ''));
        break;
      }
      case 'page': {
        const p = this.roster.get(String(e.peerId ?? ''));
        if (p) p.pageId = String(e.pageId ?? '');
        break;
      }
      case 'ack': {
        this.pending.delete(String(e.opId ?? ''));
        const s = Number(e.seq ?? 0);
        if (s > this.seq) this.seq = s;
        break;
      }
      case 'ops': {
        if (e.pageId !== this.pageId) return;
        const s = Number(e.seq ?? 0);
        // A GAP means frames this client never received. It cannot be repaired
        // by anything local, so it goes straight to the caller as a re-pull.
        if (this.seq > 0 && s > this.seq + 1) {
          this.opts.onDesync(`gap in seq: expected ${this.seq + 1}, received ${s}`);
        }
        if (s > this.seq) this.seq = s;
        // My own batch, echoed to the room. It was applied locally when it was
        // made; re-applying would be harmless for a set and wrong for a splice.
        if (e.peerId === this.selfId) return;
        const raw = (e.ops as Patch[]) ?? [];
        // Admission is checked on the RECEIVING side too. This is the only
        // guard that exists against a peer not running our code.
        const ok = raw.filter((p) => isSyncablePatch(p));
        if (ok.length > 0) this.opts.onRemote(ok);
        break;
      }
      case 'snapreq':
        // THE YIELD RULE. Never answered. A snapshot from this client would
        // make it an authority on the document, which is exactly the position
        // it declines to hold.
        break;
      case 'ckpt': {
        if (e.pageId !== this.pageId) return;
        // Compared only at the SAME seq — two documents at different points in
        // the order are supposed to differ. This client publishes no digest of
        // its own: it yields rather than arbitrates.
        if (Number(e.seq ?? 0) === this.seq && this.pending.size === 0) {
          this.opts.onDesync(`checkpoint mismatch at seq ${this.seq}`);
        }
        break;
      }
      default:
        break;
    }
  }
}
```

The `ckpt` branch needs the local digest to compare against, which this client does not
compute. **Implement it as written** — raising desync on any same-seq checkpoint while idle
is the conservative direction for a client whose repair is "re-pull from HTTP", and a
comment must say so. If it proves noisy in practice, the fix is to compute a digest, not to
delete the branch.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/live-session.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/live/session.ts test/live-session.test.ts
git commit -m "feat(live): the live-edit session, with the yield rule as its organising decision"
```

---

### Task 3: Sight — preview link and screenshots

**Files:**
- Create: `src/vision/preview.ts`
- Create: `src/vision/shoot.ts`
- Test: `test/vision.test.ts`

**Interfaces:**
- Consumes: `request`; `ToolContext`.
- Produces: `previewUrl(ctx, siteId, pageId): Promise<string>`; `shoot(url: string, opts?: { widths?: number[] }): Promise<Shot[]>`; `interface Shot { width: number; pngBase64: string; boxes: Box[] }`; `interface Box { id: string; type: string; x: number; y: number; w: number; h: number }`.

`GET /api/sites/{siteId}/pages/{pageId}/preview` answers `{"preview":{"url":"…"}}` — a
signed, short-lived link to `/_wb/preview`, which renders the **stored draft** through the
Go renderer. So the sequence is always save → mint → shoot; a screenshot never reflects
unsaved local edits.

The bounding boxes are not a bonus feature. `cursor` frames carry **layout pixels**, and
without a real measurement an agent cursor is a random number. Measured here, it moves to
the thing the agent is about to edit.

- [ ] **Step 1: Write the failing test**

```ts
// test/vision.test.ts
import { describe, it, expect, vi } from 'vitest';
import { previewUrl } from '../src/vision/preview.js';
import { shoot } from '../src/vision/shoot.js';
import { Session } from '../src/transport/auth.js';

function ctxWith(f: typeof fetch) {
  const s = new Session('http://x', f);
  (s as unknown as { access: string }).access = 'jwt';
  return { base: 'http://x', session: s, fetchImpl: f };
}

describe('previewUrl()', () => {
  it('unwraps the preview envelope', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ preview: { url: 'http://store/_wb/preview?t=abc' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    expect(await previewUrl(ctxWith(f), 's1', 'pg_1')).toBe('http://store/_wb/preview?t=abc');
  });

  it('says what is missing when the server sends no url', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ preview: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    await expect(previewUrl(ctxWith(f), 's1', 'pg_1')).rejects.toThrow(/no preview url/i);
  });
});

// Opt-in: launches the system Chrome. Not part of the default run, because a
// machine without Chrome must FAIL LOUDLY when sb_look is used rather than have
// a test quietly skip and read as green.
describe.runIf(process.env.SB_BROWSER_TEST === '1')('shoot()', () => {
  it('returns a png and the real bounding box of every data-node-id', async () => {
    const html = '<div data-node-id="fs_1" data-node-type="flex-section" style="width:300px;height:120px"></div>';
    const shots = await shoot(`data:text/html,${encodeURIComponent(html)}`, { widths: [1440] });
    expect(shots.length).toBe(1);
    expect(shots[0].width).toBe(1440);
    expect(shots[0].pngBase64.length).toBeGreaterThan(100);
    expect(shots[0].boxes).toEqual([
      { id: 'fs_1', type: 'flex-section', x: 8, y: 8, w: 300, h: 120 },
    ]);
  }, 30_000);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/vision.test.ts`
Expected: FAIL — `Cannot find module '../src/vision/preview.js'`.

- [ ] **Step 3: Write `src/vision/preview.ts`**

```ts
import { request } from '../transport/http.js';
import type { ToolContext } from '../tools/context.js';

/**
 * Mint a signed link to this page's DRAFT preview.
 *
 * The link is short-lived and is the only gate on the public `/_wb/preview`
 * route, which renders the STORED draft through the Go renderer. So a screenshot
 * always shows the last SAVED state — save first, or you photograph the past.
 */
export async function previewUrl(
  ctx: ToolContext,
  siteId: string,
  pageId: string,
): Promise<string> {
  const out = (await request({
    base: ctx.base,
    method: 'GET',
    path: `/api/sites/${encodeURIComponent(siteId)}/pages/${encodeURIComponent(pageId)}/preview`,
    token: ctx.session.token(),
    fetchImpl: ctx.fetchImpl,
  })) as { preview?: { url?: string } };
  const url = out?.preview?.url;
  if (!url) {
    throw new Error(
      'sbuilder: the server returned no preview url for this page. A page with no saved ' +
        'draft has no preview — save it first.',
    );
  }
  return url;
}
```

- [ ] **Step 4: Write `src/vision/shoot.ts`**

```ts
import { chromium, type Browser } from 'playwright-core';

export interface Box {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Shot {
  width: number;
  pngBase64: string;
  boxes: Box[];
}

/** The three widths the platform's own breakpoints care about. */
export const DEFAULT_WIDTHS = [1440, 768, 390];

/**
 * Launch the SYSTEM Chrome — `channel: 'chrome'`, not a bundled browser.
 *
 * `playwright-core` ships no browsers, so this downloads nothing on install.
 * When Chrome is absent the launch throws, and this re-throws NAMING it: a
 * vision loop that silently returns a blank image is worse than one that
 * refuses, because the agent would go on to judge a page it never saw.
 */
async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch (err) {
    throw new Error(
      'sbuilder: could not launch Google Chrome for the screenshot. sb_look needs Chrome ' +
        `installed (playwright-core bundles no browser). Underlying error: ${String(err)}`,
    );
  }
}

/**
 * Photograph a rendered page at several widths, and measure every node.
 *
 * The boxes are the load-bearing half. `cursor` frames on the live-edit socket
 * carry LAYOUT pixels — the canvas is zoomed per viewer, so a screen coordinate
 * lands somewhere else on a peer with a different window — and nothing else in
 * this server knows where a node ended up. Measured here, the agent's cursor can
 * move to the element it is about to change instead of to a made-up number.
 */
export async function shoot(url: string, opts: { widths?: number[] } = {}): Promise<Shot[]> {
  const widths = opts.widths ?? DEFAULT_WIDTHS;
  const browser = await launch();
  try {
    const shots: Shot[] = [];
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(url, { waitUntil: 'networkidle' });
      const png = await page.screenshot({ type: 'png', fullPage: true });
      const boxes = (await page.evaluate(() =>
        [...document.querySelectorAll('[data-node-id]')].map((el) => {
          const r = el.getBoundingClientRect();
          return {
            id: el.getAttribute('data-node-id') ?? '',
            type: el.getAttribute('data-node-type') ?? '',
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        }),
      )) as Box[];
      shots.push({ width, pngBase64: png.toString('base64'), boxes });
      await page.close();
    }
    return shots;
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 5: Run both test groups**

Run: `npx vitest run test/vision.test.ts` — expected PASS, 2 tests (the browser group skipped).
Run: `SB_BROWSER_TEST=1 npx vitest run test/vision.test.ts` — expected PASS, 3 tests.

Both must be run. The second is the one that proves the vision loop exists.

- [ ] **Step 6: Commit**

```bash
git add src/vision package.json package-lock.json test/vision.test.ts
git commit -m "feat(vision): preview links and Chrome screenshots with real node bounding boxes"
```

---

### Task 4: Binding sources, generated

**Files:**
- Modify: `scripts/gen-catalog.ts`
- Create (generated, committed): appended to `src/catalog/elements.generated.ts` as `BINDING_SOURCES`
- Test: `test/binding-sources.test.ts`

**Interfaces:**
- Produces: `const BINDING_SOURCES: string[]` — the 22 keys the renderer's scope actually provides.

`applyBindings` (`schema/src/binding.ts`) accepts **only** `field` values under the
`specials` namespace, and a `source` the render scope does not provide is a binding that
silently does nothing. Both facts become validation rather than documentation.

- [ ] **Step 1: Write the failing test**

```ts
// test/binding-sources.test.ts
import { describe, it, expect } from 'vitest';
import { BINDING_SOURCES } from '../src/catalog/elements.generated.js';

describe('BINDING_SOURCES', () => {
  it('carries the keys the renderer actually provides', () => {
    expect(BINDING_SOURCES).toContain('product.title');
    expect(BINDING_SOURCES).toContain('product.price');
    expect(BINDING_SOURCES).toContain('category.title');
    expect(BINDING_SOURCES).toContain('article.title');
    expect(BINDING_SOURCES.length).toBeGreaterThan(15);
  });

  it('is sorted and unique, so a diff of the generated file is readable', () => {
    expect([...BINDING_SOURCES].sort()).toEqual(BINDING_SOURCES);
    expect(new Set(BINDING_SOURCES).size).toBe(BINDING_SOURCES.length);
  });
});
```

- [ ] **Step 2: Extend the generator**

Add to `scripts/gen-catalog.ts`, near `readDocSchemaVersion`:

```ts
/**
 * The binding source keys the RENDERER provides, read out of the Go scope
 * builder. A `source` this list does not contain is a binding that resolves to
 * nothing and renders as the element's own placeholder — a silent no-op, which
 * is the failure class this repo exists to close.
 */
function readBindingSources(repo: string): string[] {
  const src = readFileSync(resolve(repo, 'server/render/scope/scope.go'), 'utf8');
  const found = new Set<string>();
  for (const m of src.matchAll(/"((?:product|category|article|collection)\.[a-zA-Z]+)"/g)) {
    found.add(m[1]);
  }
  if (found.size < 15) {
    console.error(`only ${found.size} binding sources found — has scope.go moved?`);
    process.exit(1);
  }
  return [...found].sort();
}
```

And append to the generated elements file, inside the same template:

```ts
export const BINDING_SOURCES: string[] = ${JSON.stringify(readBindingSources(repo), null, 2)};
```

- [ ] **Step 3: Run the generator and the test**

Run: `WB_REPO=/Volumes/workspace/webcake/web_builder npm run codegen && npx vitest run test/binding-sources.test.ts`
Expected: generator reports the element line as before; test PASSES, 2 tests.

- [ ] **Step 4: Commit**

```bash
git add scripts/gen-catalog.ts src/catalog/elements.generated.ts test/binding-sources.test.ts
git commit -m "feat(catalog): generate the renderer's binding source vocabulary"
```

---

### Task 5: The live and vision tools

**Files:**
- Create: `src/tools/live.ts`
- Modify: `src/tools/page.ts` (publish patches to the room; `sb_bind`), `src/server.ts`
- Test: `test/live-tools.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `registerLiveTools(server, ctx, session): void`; `bindNode(doc, id, source, field): Patch[]`.

Three tools: `sb_live_join`, `sb_look`, `sb_bind`. Total surface reaches **16**.

The page session gains an optional live channel. When one is attached, every write tool
publishes its patches to the room **as well as** applying them locally — that is what makes
the agent visible.

- [ ] **Step 1: Write the failing test**

```ts
// test/live-tools.test.ts
import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { bindNode } from '../src/tools/live.js';

function docWithHeading() {
  const d = PageDoc.from({
    schema_version: 2,
    root_node_id: 'rt',
    nodes: {
      rt: { id: 'rt', data: { type: 'root', parent: null, nodes: ['he_1'], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
      he_1: { id: 'he_1', data: { type: 'heading', parent: 'rt', nodes: [], isCanvas: false, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
    },
  });
  return d;
}

describe('bindNode()', () => {
  it('appends a binding the renderer can resolve', () => {
    const d = docWithHeading();
    d.apply(bindNode(d, 'he_1', 'product.title', 'specials.text'));
    const b = (d.node('he_1') as unknown as { bindings: Array<Record<string, string>> }).bindings;
    expect(b.length).toBe(1);
    expect(b[0].source).toBe('product.title');
    expect(b[0].field).toBe('specials.text');
    expect(typeof b[0].id).toBe('string');
  });

  it('refuses a source the renderer never provides - it would silently do nothing', () => {
    const d = docWithHeading();
    expect(() => bindNode(d, 'he_1', 'product.nonsense', 'specials.text')).toThrow(/source/i);
  });

  it('refuses a field outside the specials namespace - applyBindings ignores those', () => {
    const d = docWithHeading();
    expect(() => bindNode(d, 'he_1', 'product.title', 'style.color')).toThrow(/specials/i);
  });

  it('refuses a field with no key after the dot', () => {
    const d = docWithHeading();
    expect(() => bindNode(d, 'he_1', 'product.title', 'specials.')).toThrow(/specials/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/live-tools.test.ts`
Expected: FAIL — `Cannot find module '../src/tools/live.js'`.

- [ ] **Step 3: Write `src/tools/live.ts`**

```ts
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text, images } from '../mcp/response.js';
import { BINDING_SOURCES } from '../catalog/elements.generated.js';
import { previewUrl } from '../vision/preview.js';
import { shoot, DEFAULT_WIDTHS } from '../vision/shoot.js';
import { RealtimeSocket } from '../transport/socket.js';
import { LiveSession } from '../live/session.js';
import type { Patch } from '../core/patch.js';
import type { PageDoc } from '../domains/site/document.js';
import type { ToolContext } from './context.js';
import type { PageSession } from './page.js';

/**
 * Bind a node's content to real store data.
 *
 * Two validations, both closing a SILENT no-op:
 *
 *  - the `source` must be one the renderer's scope actually provides. An unknown
 *    one resolves to nothing and the element renders its own placeholder, which
 *    looks exactly like "the data has not loaded yet".
 *  - the `field` must live under `specials`. `applyBindings` (schema/src/binding.ts)
 *    reads the namespace off the field and `continue`s on anything else — so a
 *    `style.color` binding is stored, saved, published, and ignored forever.
 */
export function bindNode(doc: PageDoc, id: string, source: string, field: string): Patch[] {
  doc.node(id);
  if (!BINDING_SOURCES.includes(source)) {
    throw new Error(
      `sbuilder: "${source}" is not a binding source the renderer provides. Valid sources: ` +
        `${BINDING_SOURCES.join(', ')}.`,
    );
  }
  const dot = field.indexOf('.');
  if (dot < 0 || field.slice(0, dot) !== 'specials' || !field.slice(dot + 1)) {
    throw new Error(
      `sbuilder: binding field must be "specials.<key>", not "${field}". The renderer ignores ` +
        'every other namespace, so the binding would be stored and never applied.',
    );
  }
  const node = doc.node(id) as unknown as { bindings: unknown[] };
  return [
    {
      op: 'insert',
      path: ['nodes', id, 'bindings'],
      index: node.bindings.length,
      value: { id: randomBytes(6).toString('hex'), source, field },
    },
  ];
}

export function registerLiveTools(
  server: McpServer,
  ctx: ToolContext,
  session: PageSession,
): void {
  server.tool(
    'sb_live_join',
    'Join the editor\'s live-edit room for this site, as a visible peer. Once joined, every ' +
      'sb_add / sb_set / sb_move / sb_remove also goes out as a live op, so anyone with the ' +
      'editor open watches the page assemble. Safe alongside a human: this client always ' +
      'yields — it never answers a snapshot request and re-pulls on any divergence.',
    { site_id: z.string() },
    async ({ site_id }) => {
      const wsBase = ctx.base.replace(/^http/, 'ws').replace(/\/$/, '');
      const socket = new RealtimeSocket(
        `${wsBase}/api/realtime/ws?site=${encodeURIComponent(site_id)}`,
        () => ctx.session.token(),
      );
      const live = new LiveSession(socket, {
        onRemote: (patches) => session.applyRemote(patches),
        onDesync: (reason) => session.markStale(reason),
      });
      socket.connect();
      session.attachLive(live);
      return text({
        joined: site_id,
        note: 'Edits now publish to the room as they are made. Call sb_page_open next.',
      });
    },
  );

  server.tool(
    'sb_look',
    'Save the open page, render it through the platform\'s own renderer, and return ' +
      'screenshots at desktop, tablet and mobile widths — plus the measured bounding box of ' +
      'every node. Use it to judge your own work, not to guess at it.',
    {
      widths: z.array(z.number().int().min(320).max(2560)).optional(),
      with_boxes: z.boolean().optional(),
    },
    async ({ widths, with_boxes }) => {
      await session.save();
      const { siteId, pageId } = session.location();
      const url = await previewUrl(ctx, siteId, pageId);
      const shots = await shoot(url, { widths: widths ?? DEFAULT_WIDTHS });
      // The boxes feed the presence cursor as well as the agent's own reading.
      session.noteBoxes(shots[0]?.boxes ?? []);
      return images(
        shots.map((s) => ({ dataBase64: s.pngBase64 })),
        with_boxes === false
          ? { widths: shots.map((s) => s.width) }
          : { widths: shots.map((s) => s.width), boxes: shots[0]?.boxes ?? [] },
      );
    },
  );

  server.tool(
    'sb_bind',
    'Bind a node\'s content to real store data, so the page shows actual products rather ' +
      'than placeholder text.',
    {
      id: z.string(),
      source: z.string().describe(`One of: ${BINDING_SOURCES.join(', ')}`),
      field: z.string().describe('Where the value lands, always "specials.<key>"'),
      dry_run: z.boolean().optional(),
    },
    async ({ id, source, field, dry_run }) => {
      const d = session.current();
      const patches = bindNode(d, id, source, field);
      if (dry_run !== false) return text({ dry_run: true, patches });
      session.applyAndPublish(patches);
      await session.save();
      return text({ bound: id, source, field, rev: d.rev });
    },
  );
}
```

- [ ] **Step 4: Extend `PageSession` in `src/tools/page.ts`**

Add the live channel and the box memo:

```ts
  private live: LiveSession | null = null;
  private stale: string | null = null;
  private boxes: Box[] = [];

  attachLive(live: LiveSession): void {
    this.live = live;
  }

  location(): { siteId: string; pageId: string } {
    this.current();
    return { siteId: this.siteId, pageId: this.pageId };
  }

  noteBoxes(boxes: Box[]): void {
    this.boxes = boxes;
  }

  /**
   * Apply MY patches and, when joined, put them on the wire.
   *
   * One method rather than two calls at every site, because "apply locally and
   * forget to publish" is invisible: the agent's own document is right, the save
   * is right, and only the humans watching see nothing happen.
   */
  applyAndPublish(patches: Patch[]): void {
    const d = this.current();
    d.apply(patches);
    this.live?.publish(patches);
    // Move the cursor to what was just touched, when a measurement exists.
    // Presence with a made-up coordinate is theatre; presence with a measured
    // one is information.
    const touched = String(patches[0]?.path[1] ?? '');
    const box = this.boxes.find((b) => b.id === touched);
    if (box && this.live) {
      this.live.select(touched);
      this.live.cursor(box.x + box.w / 2, box.y + box.h / 2);
    }
  }

  applyRemote(patches: Patch[]): void {
    this.doc?.apply(patches);
  }

  /** The yield rule's local half: the next save re-pulls instead of overwriting. */
  markStale(reason: string): void {
    this.stale = reason;
  }
```

And in `save()`, before validating:

```ts
    if (this.stale) {
      // THE YIELD RULE. The room moved in a way this client cannot reconcile, so
      // it must not write its copy over whatever is there now. Re-pull, and let
      // the caller redo the intent against the current tree.
      const reason = this.stale;
      this.stale = null;
      await this.open(this.siteId, this.pageId);
      throw new Error(
        `sbuilder: the page changed under this session (${reason}). It has been re-loaded from ` +
          'the server; re-read it with sb_outline and reapply your change.',
      );
    }
```

Then replace every `d.apply(patches)` in the write tools with `session.applyAndPublish(patches)`.

- [ ] **Step 5: Register the group in `src/server.ts`**

`registerPageTools` must return its `PageSession` so `registerLiveTools` can share it:

```ts
  const pageSession = registerPageTools(server, ctx);
  registerLiveTools(server, ctx, pageSession);
```

Change `registerPageTools` to `export function registerPageTools(...): PageSession` and
return the session it built.

Add to `INSTRUCTIONS`:

```
- sb_live_join makes the agent VISIBLE: edits then appear in anyone's open editor as they
  happen. sb_look renders the saved page and hands back screenshots plus measured node
  boxes — judge the design from those, do not guess.
```

- [ ] **Step 6: Run the test and the gate**

Run: `npx vitest run test/live-tools.test.ts && npm run build && npm test && npm run smoke`
Expected: live-tools 4 tests PASS; build clean; whole suite green; smoke `ALL GOOD`.

- [ ] **Step 7: Verify the tool list over the real protocol**

Run the stdio probe.
Expected: **16 tools** — the 13 from Phases 1–2 plus `sb_live_join`, `sb_look`, `sb_bind`.

- [ ] **Step 8: Commit**

```bash
git add src/tools/live.ts src/tools/page.ts src/server.ts test/live-tools.test.ts
git commit -m "feat(tools): sb_live_join, sb_look and sb_bind; writes publish to the room"
```

---

### Task 6: Smoke, docs, and the phase close

**Files:**
- Modify: `src/smoke.ts`, `CLAUDE.md`, `README.md`, `README.vi.md`, `docs/tools.md`, `docs/tools.vi.md`, `.claude/skills/sbuilder-mcp-tools/SKILL.md`

- [ ] **Step 1: Extend the smoke gate (offline only)**

```ts
  const { BINDING_SOURCES } = await import('./catalog/elements.generated.js');
  check('binding sources are populated', BINDING_SOURCES.length > 15);

  const { bindNode } = await import('./tools/live.js');
  const { PageDoc: PD } = await import('./domains/site/document.js');
  const bd = PD.from({
    schema_version: 2,
    root_node_id: 'rt',
    nodes: {
      rt: { id: 'rt', data: { type: 'root', parent: null, nodes: ['he_1'], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
      he_1: { id: 'he_1', data: { type: 'heading', parent: 'rt', nodes: [], isCanvas: false, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
    },
  });
  bd.apply(bindNode(bd, 'he_1', 'product.title', 'specials.text'));
  check('a valid binding lands', (bd.node('he_1') as unknown as { bindings: unknown[] }).bindings.length === 1);

  let bindRefused = false;
  try {
    bindNode(bd, 'he_1', 'product.title', 'style.color');
  } catch {
    bindRefused = true;
  }
  check('a non-specials binding field is REFUSED', bindRefused);
```

Smoke must stay offline — it never launches Chrome and never opens a socket.

- [ ] **Step 2: Document the three tools**

Add `sb_live_join`, `sb_look` and `sb_bind` to `docs/tools.md`, `docs/tools.vi.md`, and both
README tables. State: `sb_look` **saves first** (the preview renders the stored draft, so an
unsaved edit is not in the picture); `sb_look` needs system Chrome and says so by name if it
is missing; `sb_live_join` makes the agent visible and always yields.

- [ ] **Step 3: Update `CLAUDE.md` and the skill**

Move Phase 3 to shipped. Add to the platform-facts list: the frame-size split (64 KiB for
everything but `ops`/`snap` at 4 MiB), the silent drop of an empty `ops` batch, and that
`applyBindings` only honours the `specials` namespace. Add the yield rule as its own short
section. In `.claude/skills/sbuilder-mcp-tools/SKILL.md`, add: a tool that writes must go
through `applyAndPublish`, never `doc.apply` directly, or the room sees nothing.

- [ ] **Step 4: Run the full gate, both ways**

Run: `npm run build && npm test && npm run smoke`
Run: `SB_BROWSER_TEST=1 npm test`
Expected: both green; smoke `ALL GOOD`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: phase 3 tools, the yield rule, and the wire-protocol facts"
```

---

## Self-review

**Spec coverage.** Spec §4 `transport/socket.ts` → Task 1. §4 `live/{session,presence}` →
Tasks 2 and 5 — presence is **not** a separate module: it is three lines inside
`applyAndPublish`, because a cursor that moves anywhere other than "the node just touched"
would be invention, and a module for three lines is surface without substance. Recorded
rather than silently merged. §4 `vision/{preview,shoot}` → Task 3. §5.2 the yield rule →
Task 2 (never answers `snapreq`, desync on gap and checkpoint) and Task 5 (`markStale` →
re-pull on save). §7 `sb_bind` → Tasks 4–5. §8 the vision loop, including boxes feeding the
cursor → Tasks 3 and 5. §9 anti-drift → Task 4 extends the generator with the binding
vocabulary, asserted for size.

**Autosave is still explicit, not debounced.** The spec's §4 lists `live/autosave.ts`. Every
write tool already calls `session.save()`, so a debounce would only *delay* durability while
adding a window in which a crash loses work. Deferred deliberately, with the note here.

**Placeholder scan.** No TBD/TODO. Task 2 Step 3 carries an explicit instruction about the
`ckpt` branch's conservatism rather than leaving it ambiguous. Task 3 Step 5 requires **both**
test runs, so the browser path cannot be skipped into a green-looking suite.

**Type consistency.** `SocketLike`/`RealtimeEvent` are defined once (Task 1) and consumed by
Task 2. `Patch` comes from `core/patch.js` throughout. `Box` is defined in `vision/shoot.ts`
(Task 3) and imported by `tools/page.ts` (Task 5). `PageSession` is Phase 2's class, extended
in Task 5 and returned by `registerPageTools`. `LiveSession` is Task 2's, consumed in Task 5.
