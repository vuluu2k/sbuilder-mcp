import { request } from './http.js';

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
 * rather than capture its result. The access token lives ~15 minutes and rotates
 * on refresh; a client holding the string it was built with replays an expired
 * token forever, and the failure is SILENT — a rejected socket auth still fires
 * onopen, so there is no error event and nothing in any UI. The editor shipped
 * exactly that bug and documents the fix on its own socket (MF1). Phase 3's
 * socket takes `() => session.token()`, which is why the getter exists now
 * rather than when it is first needed.
 */
export class Session {
  private access: string | null = null;
  private refreshToken: string | null = null;
  private name = '';

  constructor(
    private readonly base: string,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  get userName(): string {
    return this.name;
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
    const out = (await request({
      base: this.base,
      method: 'POST',
      path: '/api/auth/login',
      body: { email, password },
      fetchImpl: this.fetchImpl,
    })) as LoginResponse;
    this.access = out.tokens.accessToken;
    this.refreshToken = out.tokens.refreshToken;
    this.name = out.user?.name ?? '';
  }

  /** Rotate. The platform issues a NEW refresh token each time; keep that one. */
  async refresh(): Promise<void> {
    if (!this.refreshToken) throw new Error('sbuilder: no refresh token — log in first');
    const out = (await request({
      base: this.base,
      method: 'POST',
      path: '/api/auth/refresh',
      body: { refreshToken: this.refreshToken },
      fetchImpl: this.fetchImpl,
    })) as { tokens: TokenPair };
    this.access = out.tokens.accessToken;
    this.refreshToken = out.tokens.refreshToken;
  }

  /**
   * Sign this device out. Best effort, never throws.
   *
   * EVERY password sign-in is its own DEVICE SESSION since web_builder 9db1b2a9e,
   * capped at 10 per account; past the cap the one that has gone longest
   * without a REFRESH is deleted. This client never refreshes (the access token
   * lives 30 days), so a process that exits without signing out leaves a slot
   * held, and about ten agent runs later the evicted session is the merchant's
   * own editor — signed out mid-edit, by nothing they can see. A SIGKILLed
   * process still leaks its slot; nothing on this side can prevent that.
   */
  async logout(): Promise<void> {
    const refreshToken = this.refreshToken;
    this.access = null;
    this.refreshToken = null;
    if (!refreshToken) return;
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
