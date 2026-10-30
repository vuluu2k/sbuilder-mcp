import { describe, it, expect, vi } from 'vitest';
import { callOperation } from '../src/tools/api.js';
import { redactSecretBody } from '../src/transport/http.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import type { ToolContext } from '../src/tools/context.js';

/**
 * A SECRET UNDER AN ORDINARY FIELD NAME. redact() keys off names like `secret`/`token`;
 * a function secret's body is `{value}` and a vendor key's is `{key}`, so sb_api_call's
 * preview printed both. CLAUDE.md: no secret reaches a tool result.
 */
const CANARY = 'sk_live_CANARY_7c1a2b';
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

function ctx() {
  const sent: Array<{ method: string; path: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    sent.push({ method: init.method ?? 'GET', path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (path.includes('/functions/secrets/')) return json({ secret: { key: 'STRIPE_KEY', updatedAt: 't' } });
    if (path === '/api/admin/geo-keys') return json({ geoKey: { id: 'g1', label: 'x' } }, 201);
    return json({ ok: true, echoed: 'nothing' });
  }) as unknown as typeof fetch;
  const c: ToolContext = { base: 'http://x', session: new Session('http://x', fetchImpl), apiKey: 'wbk_k', siteId: 's1', fetchImpl, notices: new Notices(), undo: new UndoLog() };
  return { c, sent };
}

describe('sb_api_call never shows a secret body value', () => {
  for (const id of ['put:/api/sites/{siteId}/functions/secrets/{key}', 'put:/api/v1/functions/secrets/{key}']) {
    it(`${id}: canary absent from the dry-run preview and the result, present on the wire`, async () => {
      const { c, sent } = ctx();
      const args = { id, path_params: { key: 'STRIPE_KEY' }, body: { value: CANARY } };
      const dry = await callOperation(c, args);
      expect(JSON.stringify(dry)).not.toContain(CANARY);
      expect((dry as { would_send: { body: unknown } }).would_send.body).toEqual({ value: '[redacted]' });
      expect(sent).toEqual([]);
      const real = await callOperation(c, { ...args, dry_run: false });
      expect(JSON.stringify(real)).not.toContain(CANARY);
      expect(sent.at(-1)).toMatchObject({ method: 'PUT', body: { value: CANARY } });
    });
  }

  it("a platform vendor key's bare `key` is hidden too", async () => {
    const { c } = ctx();
    const dry = await callOperation(c, { id: 'post:/api/admin/geo-keys', body: { label: 'Geo', key: CANARY } });
    expect(JSON.stringify(dry)).not.toContain(CANARY);
    expect((dry as { would_send: { body: unknown } }).would_send.body).toEqual({ label: 'Geo', key: '[redacted]' });
  });

  // Review probes: each spelling reaches the secret route once fetch / the router normalise it.
  const VARIANTS: Array<[string, Record<string, string>]> = [
    ['/api/sites/s1/functions/secrets/K/', { value: CANARY }],
    ['/api/sites/s1/functions/x/../secrets/K', { value: CANARY }],
    ['/api/sites/s1/functions/./secrets/K', { value: CANARY }],
    ['/api/sites/s1//functions/secrets/K', { value: CANARY }],
    ['//api/sites/s1/functions/secrets/K', { value: CANARY }],
    ['/api/sites/s1/functions%2Fsecrets%2FK', { value: CANARY }],
    ['/api/sites/s1/functions/%2e%2e/functions/secrets/K', { value: CANARY }],
    ['/api/sites/s1/functions%252Fsecrets%252FK', { value: CANARY }],
    ['/api/sites/s1\\functions\\secrets\\K', { value: CANARY }],
    ['/api/sites/s1/functions/secrets/K?x=1#f', { value: CANARY }],
    ['/api/v1/functions/secrets/K/', { value: CANARY }],
    // A route only at a MIDDLE decoding stage (re-verification).
    ['/api/sites/s1/functions/secrets/A%252FB', { value: CANARY }],
    ['/api/sites/s1/functions/secrets/STRIPE_KEY%2F..', { value: CANARY }],
    ['/api/sites/s1/functions/secrets/STRIPE_KEY%252F..%252F', { value: CANARY }],
    ['/api/v1/functions/secrets/A%252FB', { value: CANARY }],
    ['/api/admin/geo-keys/', { key: CANARY }],
    ['/_wb/account/password/', { current: CANARY, new: CANARY }],
  ];
  for (const [path, body] of VARIANTS) {
    it(`preview is canary-free for ${path}`, () => {
      expect(JSON.stringify(redactSecretBody(path, body))).not.toContain(CANARY);
    });
  }

  it('a malformed escape fails closed: every listed secret field is hidden', () => {
    const out = redactSecretBody('/api/sites/s1/functions/secrets/%E0%A4%A', { value: CANARY, key: CANARY, label: 'kept' });
    expect(out).toEqual({ value: '[redacted]', key: '[redacted]', label: 'kept' });
  });

  it('a path still encoded past the decode cap fails closed', () => {
    let p = '/api/x/K%2FB';
    for (let i = 0; i < 6; i++) p = p.replace(/%/g, '%25');
    expect(redactSecretBody(p, { value: CANARY })).toEqual({ value: '[redacted]' });
  });

  it('a key path param with a trailing slash, through sb_api_call', async () => {
    const { c } = ctx();
    const dry = await callOperation(c, { id: 'put:/api/sites/{siteId}/functions/secrets/{key}', path_params: { key: 'K/' }, body: { value: CANARY } });
    expect(JSON.stringify(dry)).not.toContain(CANARY);
  });

  it('an unrelated body with a `value` field is untouched', async () => {
    expect(redactSecretBody('/api/sites/s1/collections/c1/items', { value: 'visible' })).toEqual({ value: 'visible' });
    expect(redactSecretBody('/api/sites/s1/functions/secrets', { value: 'x' })).toEqual({ value: 'x' });
    expect(redactSecretBody('/api/sites/s1/functions/secrets/', { value: 'x' })).toEqual({ value: 'x' });
    expect(redactSecretBody('/api/sites/s1/functions/fn_1', { value: 'x', key: 'k' })).toEqual({ value: 'x', key: 'k' });
    expect(redactSecretBody('/api/admin/geo-keys/g1', { key: 'k' })).toEqual({ key: 'k' });
    expect(redactSecretBody('/api/sites/s1/translations', { key: 'heading', value: 'Xin chào' })).toEqual({ key: 'heading', value: 'Xin chào' });
    const { c } = ctx();
    const dry = await callOperation(c, { id: 'post:/api/sites/{siteId}/webhooks', body: { url: 'https://h.example', value: 'visible' } });
    expect((dry as { would_send: { body: unknown } }).would_send.body).toEqual({ url: 'https://h.example', value: 'visible' });
  });
});
