/**
 * Which credential opens a given path.
 *
 * This CANNOT come from the OpenAPI document: it declares a single `BearerAuth`
 * scheme covering both the merchant API key and the user session JWT, so it
 * cannot tell the two apart. The platform can, and its two surfaces answer
 * differently:
 *
 *  - `/api/v1` accepts an API key ONLY. A session token there answers
 *    `401 api_key_required`, and that refusal is deliberate — accepting one
 *    would make the partner surface as powerful as whoever pasted it.
 *  - The private site API accepts EITHER, since agent keys landed. A `wbk_`
 *    key reaches the resource surface of the one site it belongs to, bounded by
 *    its own scopes intersected with the live role of the member who minted it.
 *
 * So the private surface is `siteScoped`, not `session`: it names what the path
 * needs (a credential for this site) rather than which one the caller happens to
 * hold. `tokenFor` then prefers the KEY, because a key is narrower — revocable
 * on its own, scoped, and bound to one store — while a session carries the whole
 * account.
 */
export type Credential = 'apiKey' | 'siteScoped' | 'none';

export function credentialFor(path: string): Credential {
  if (path.startsWith('/api/auth/')) return 'none';
  if (path === '/api/v1' || path.startsWith('/api/v1/')) return 'apiKey';
  return 'siteScoped';
}
