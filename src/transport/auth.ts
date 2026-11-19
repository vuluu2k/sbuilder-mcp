import { onUnauthorized, request } from './http.js';
import { RELOGIN, rotate, takePair, type TokenPair as StoredPair } from './stored.js';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

interface LoginResponse {
  user: { id: string; name: string };
  tokens: TokenPair;
}

/**
 * A user session against the platform's private API.
 *
 * `token()` is a GETTER, deliberately, and every consumer must call it per use
 * rather than capture its result. The access token's lifetime is the operator's (AUTH_ACCESS_TTL) and it rotates
 * on refresh; a client holding the string it was built with replays an expired
 * token forever, and the failure is SILENT — a rejected socket auth still fires
 * onopen, so there is no error event and nothing in any UI. The editor shipped
 * exactly that bug and documents the fix on its own socket (MF1). Phase 3's
 * socket takes `() => session.token()`, which is why the getter exists now
 * rather than when it is first needed.
 */
export class Session {
  private access: string | null = null;
  /** When the access token stops working (ms epoch), from the pair's expiresIn; 0 = unknown. */
  private expiresAt = 0;
  private refreshToken: string | null = null;
  private name = '';
  /**
   * The pair came from the machine's shared login file (sb login / sb_login),
   * not from a password sign-in of this process. Two consequences: a refresh
   * goes through the file's lock (other processes hold the same pair), and
   * exiting does NOT sign it out — the login belongs to the machine.
   */
  private stored = false;

  constructor(
    private readonly base: string,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  /**
   * Answer a 401 on THIS session's current token with one refresh — see
   * onUnauthorized in http.ts. Concurrent 401s share one refresh: refresh
   * tokens are single-use, and presenting one twice ends the session.
   * Registered while signed in only, so a signed-out session holds nothing.
   */
  private unrenew: (() => void) | null = null;
  private listen(): void {
    this.unrenew ??= onUnauthorized(async (stale) => {
      // A request that carried a token THIS session already replaced (a second
      // 401 landing after the first one renewed) takes the current one.
      if (this.retired.has(stale) && this.access) return this.access;
      if (stale !== this.access || !this.refreshToken) return null;
      this.renewing ??= this.refresh().finally(() => {
        this.renewing = null;
      });
      await this.renewing;
      return this.access;
    });
  }

  private renewing: Promise<void> | null = null;
  /** Access tokens this session has replaced, so a late 401 on one still renews. */
  private readonly retired = new Set<string>();

  get userName(): string {
    return this.name;
  }

  set userName(v: string) {
    this.name = v;
  }

  /** True when this session is the machine's shared account login. */
  isStored(): boolean {
    return this.stored && this.access !== null;
  }

  /**
   * Take over the machine's stored login. A password session this process
   * opened is signed out first, so it does not strand a device slot.
   */
  async adoptStored(pair: StoredPair): Promise<void> {
    // No await when nothing is held, so a boot-time adoption is synchronous.
    if (!this.stored && this.access) await this.logout();
    this.stored = true;
    this.access = pair.accessToken;
    this.refreshToken = pair.refreshToken;
    // A stored pair carries no expiresIn; the token's own `exp` says when, so
    // ensureFresh() can renew before a call that cannot retry (uploads, socket).
    this.expiresAt = jwtExpiry(pair.accessToken);
    this.listen();
  }

  /**
   * Sign the MACHINE out: revoke the stored login on the server and remove it
   * from the shared file. Every MCP window and the sb CLI lose it together.
   */
  async forgetStored(): Promise<void> {
    await this.renewing?.catch(() => undefined);
    const mine = this.refreshToken;
    this.stored = false;
    this.access = null;
    this.refreshToken = null;
    this.unrenew?.();
    this.unrenew = null;
    // Revoke what the FILE holds — `sb login` may have replaced the pair this
    // process adopted — and the one in memory if it differs.
    const filed = await takePair(this.base);
    for (const rt of new Set([filed?.refreshToken, mine].filter(Boolean) as string[])) {
      await request({
        base: this.base,
        method: 'POST',
        path: '/api/auth/logout',
        body: { refreshToken: rt },
        fetchImpl: this.fetchImpl,
      }).catch((err) => console.error('[sbuilder-mcp] sign-out failed:', (err as Error).message));
    }
  }

  token(): string {
    if (!this.access) throw new Error('sbuilder: not logged in — call sb_connect first');
    return this.access;
  }

  loggedIn(): boolean {
    return this.access !== null;
  }

  private pending: Promise<void> = Promise.resolve();

  /** Serialised: two concurrent sb_connect calls would each sign in and strand one device. */
  login(email: string, password: string): Promise<void> {
    const run = this.pending.then(() => this.signIn(email, password));
    this.pending = run.catch(() => {});
    return run;
  }

  private async signIn(email: string, password: string): Promise<void> {
    // A second sb_connect in one process would otherwise strand the first
    // device session — see logout().
    await this.logout();
    this.stored = false;
    const out = (await request({
      base: this.base,
      method: 'POST',
      path: '/api/auth/login',
      body: { email, password },
      fetchImpl: this.fetchImpl,
    })) as LoginResponse;
    this.access = out.tokens.accessToken;
    this.refreshToken = out.tokens.refreshToken;
    this.expiresAt = expiry(out.tokens.expiresIn);
    this.name = out.user?.name ?? '';
    this.listen();
  }

  /** Rotate. The platform issues a NEW refresh token each time; keep that one. */
  async refresh(): Promise<void> {
    const rt = this.refreshToken;
    if (!rt) throw new Error('sbuilder: no refresh token — log in first');
    if (this.stored) {
      const stale = this.access;
      let next: StoredPair;
      try {
        next = await rotate(this.base, stale ?? '', this.fetchImpl ?? fetch);
      } catch (err) {
        // The login is gone (or the file is): stop presenting a dead token.
        if ((err as Error).message === RELOGIN) {
          this.access = null;
          this.refreshToken = null;
          this.unrenew?.();
          this.unrenew = null;
        }
        throw err;
      }
      if (this.refreshToken !== rt) return;
      if (this.access) this.retired.add(this.access);
      this.access = next.accessToken;
      this.refreshToken = next.refreshToken;
      this.expiresAt = jwtExpiry(next.accessToken);
      return;
    }
    const out = (await request({
      base: this.base,
      method: 'POST',
      path: '/api/auth/refresh',
      body: { refreshToken: rt },
      fetchImpl: this.fetchImpl,
    })) as { tokens: TokenPair };
    // Signed out, or signed in afresh, while this was in flight: the pair it
    // brought back belongs to a session that no longer exists here.
    if (this.refreshToken !== rt) return;
    if (this.access) this.retired.add(this.access);
    this.access = out.tokens.accessToken;
    this.refreshToken = out.tokens.refreshToken;
    this.expiresAt = expiry(out.tokens.expiresIn);
  }

  /**
   * Renew BEFORE a call that cannot retry itself — a media upload sends its
   * own fetch, outside the 401 retry in http.ts. Within 30s of the lifetime the
   * pair was issued with, refresh first (shared with any 401 renewal in flight).
   */
  async ensureFresh(): Promise<void> {
    if (!this.refreshToken || !this.expiresAt || Date.now() < this.expiresAt - 30_000) return;
    this.renewing ??= this.refresh().finally(() => {
      this.renewing = null;
    });
    await this.renewing;
  }

  /**
   * Sign this device out. Best effort, never throws.
   *
   * EVERY password sign-in is its own DEVICE SESSION since web_builder 9db1b2a9e,
   * capped at 10 per account; past the cap the one that has gone longest
   * without a REFRESH is deleted. This client refreshes only when refused (the
   * access token lives 30 days by default), so a process that exits without
   * signing out leaves a slot held, and about ten agent runs later the evicted session is the merchant's
   * own editor — signed out mid-edit, by nothing they can see. A SIGKILLed
   * process still leaks its slot; nothing on this side can prevent that.
   */
  async logout(): Promise<void> {
    // A renewal in flight is about to rotate the refresh token; revoke the one it
    // brings back, not the one it just spent (presenting a used one ends the session).
    await this.renewing?.catch(() => undefined);
    const refreshToken = this.refreshToken;
    const shared = this.stored;
    this.access = null;
    this.refreshToken = null;
    this.unrenew?.();
    this.unrenew = null;
    // THE MACHINE'S login, shared with other windows and the sb CLI: a process
    // exiting is not the person signing out. forgetStored() is that.
    if (!refreshToken || shared) return;
    try {
      await request({
        base: this.base,
        method: 'POST',
        path: '/api/auth/logout',
        body: { refreshToken },
        fetchImpl: this.fetchImpl,
      });
    } catch (err) {
      console.error('[sbuilder-mcp] sign-out failed:', (err as Error).message);
    }
  }
}

/** A JWT's `exp` as an epoch-ms deadline; 0 when it is not a JWT or has none. */
export function jwtExpiry(token: string): number {
  try {
    const part = token.split('.')[1];
    if (!part) return 0;
    const exp = (JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { exp?: unknown }).exp;
    return typeof exp === 'number' && exp > 0 ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** expiresIn seconds → an epoch deadline; 0 when the pair carried none. */
function expiry(seconds: unknown): number {
  return typeof seconds === 'number' && seconds > 0 ? Date.now() + seconds * 1000 : 0;
}
