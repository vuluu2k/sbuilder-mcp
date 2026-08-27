/**
 * One connection to the editor's live-edit room.
 *
 * The browser-shaped surface narrowed to a `SocketLike` so tests can drive a
 * hand-written fake — fire `onopen`, deliver a message, fire `onclose` at a
 * chosen moment — with no network and no server. This is the editor's own
 * testing seam, and it is why every rule below has a test rather than a comment.
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

/** WebSocket.OPEN per spec, as a literal so this module never reads a global. */
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
     * expired token on every reconnect, and the failure is SILENT — a rejected
     * auth still fires `onopen`, so no error event ever surfaces.
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
      // Auth is the FIRST message, never a header (a browser cannot set one on a
      // WebSocket) and never a query parameter (a token in a URL lands in logs).
      // The server enforces a 5s deadline, so it goes out immediately.
      ws.send(JSON.stringify({ t: 'auth', token: this.token() }));
    };

    ws.onmessage = (ev) => {
      // A frame ARRIVING is the only evidence this connection is usable. An open
      // proves nothing: a refused auth opens and then closes. Resetting the
      // counter on open instead produced open → attempt=0 → auth → close →
      // 500ms → forever: a 2 Hz reconnect storm with the backoff never engaging,
      // no onerror (a policy close is not an error), and nothing in any UI.
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
      // Genuinely rare: a policy close is not an error. Nothing to do here —
      // onclose runs either way and owns the reconnect.
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
