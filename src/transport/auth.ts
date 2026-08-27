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

  async login(email: string, password: string): Promise<void> {
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
}
