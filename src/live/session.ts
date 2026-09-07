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
 * never publishes a checkpoint of its own, and re-pulls on any evidence of
 * divergence. That is what lets it skip the editor's outbox deferral, inbox
 * arbitration and "who pulls" tie-break — roughly a thousand lines whose entire
 * purpose is arbitrating between two EQUALLY authoritative editors. This one is
 * not one of those, deliberately.
 */
/** Under the server's 4 MiB `ops` cap, with room for the frame envelope. */
export const OPS_FRAME_BUDGET = 3 * 1024 * 1024;

/** Greedy split by serialized size; one oversize op still goes alone rather than never. */
export function chunkBySize<T>(items: T[], budget: number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let used = 0;
  for (const it of items) {
    const size = JSON.stringify(it).length + 1;
    if (cur.length > 0 && used + size > budget) {
      out.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(it);
    used += size;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

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

  /** Is anyone else here? The yield rule only costs anything when someone is. */
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
    // The welcome may already have arrived, or may not — the order depends on
    // how fast the server answers. Announce now if we know who we are;
    // otherwise `receive` does it when the welcome lands.
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
   * the server drops an ops frame with no ops silently (a bare `continue` in
   * readPump), so sending one is indistinguishable from success while achieving
   * nothing at all.
   */
  publish(patches: Patch[]): void {
    if (!this.pageId) return;
    const ops = syncable(patches);
    if (ops.length === 0) return;
    // The wire caps an `ops` frame at 4 MiB and CLOSES the socket past it, so a
    // batch (sb_set edits[], a big sb_add) is split into frames under a budget
    // that leaves room for the envelope. Each frame gets its own opId, and a
    // peer applying them in order sees the same tree — patches are in creation
    // order and never reference a node a later frame creates.
    for (const chunk of chunkBySize(ops, OPS_FRAME_BUDGET)) {
      const opId = randomBytes(8).toString('hex');
      this.pending.set(opId, Date.now());
      this.socket.send({ t: 'ops', pageId: this.pageId, ops: chunk, opId });
    }
  }

  /** Presence only — never document state. */
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
        // A GAP means frames this client never received. Nothing local can
        // repair that, so it goes straight to the caller as a re-pull.
        if (this.seq > 0 && s > this.seq + 1) {
          this.opts.onDesync(`gap in seq: expected ${this.seq + 1}, received ${s}`);
        }
        if (s > this.seq) this.seq = s;
        // My own batch, echoed to the room. It was applied locally when it was
        // made; re-applying is harmless for a set and WRONG for a splice.
        if (e.peerId === this.selfId) return;
        const raw = (e.ops as Patch[]) ?? [];
        // Admission is checked on the RECEIVING side too. This is the only guard
        // that exists against a peer not running our code.
        const ok = raw.filter((p) => isSyncablePatch(p));
        if (ok.length > 0) this.opts.onRemote(ok);
        break;
      }
      case 'snapreq':
        // THE YIELD RULE. Never answered. Sending a snapshot would make this
        // client an authority on the document — exactly the position it declines
        // to hold, and the reason the rest of this class can stay this small.
        break;
      case 'ckpt': {
        if (e.pageId !== this.pageId) return;
        // Compared only at the SAME seq: two documents at different points in
        // the order are supposed to differ.
        //
        // This client computes no digest of its own, so it cannot tell a real
        // mismatch from a peer simply publishing. It treats a same-seq
        // checkpoint arriving while idle as reason enough to re-pull, which is
        // the CONSERVATIVE direction for a client whose repair is a cheap HTTP
        // GET rather than a document exchange. If this proves noisy in practice
        // the fix is to compute a digest and compare it — not to delete the
        // branch and go back to trusting a tree nobody verified.
        if (Number(e.seq ?? 0) === this.seq && this.pending.size === 0) {
          this.opts.onDesync(`checkpoint published at seq ${this.seq}; re-pulling to be sure`);
        }
        break;
      }
      default:
        break;
    }
  }
}
