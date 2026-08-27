/**
 * Which credential opens a given path.
 *
 * This CANNOT come from the OpenAPI document. That document declares a single
 * `BearerAuth` scheme covering both the merchant API key and the user session
 * JWT — 212 operations carry it, 92 carry none — so it cannot tell the two
 * apart. The platform, meanwhile, refuses each on the other's surface: /api/v1
 * answers `401 api_key_required` to a session token, and the private API does
 * not accept a `wbk_` key at all. So the rule lives here, in one tested
 * function, rather than being guessed per call site.
 *
 * The default is `session`, not `apiKey`. The private API is much the larger
 * surface, and a session token is re-checked against the caller's RBAC role on
 * every request — so a mis-routed call fails closed against a role rather than
 * succeeding with a key whose scopes were granted for something else.
 */
export type Credential = 'apiKey' | 'session' | 'none';

export function credentialFor(path: string): Credential {
  if (path.startsWith('/api/auth/')) return 'none';
  if (path === '/api/v1' || path.startsWith('/api/v1/')) return 'apiKey';
  return 'session';
}
