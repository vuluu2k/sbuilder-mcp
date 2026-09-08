import { describe, it, expect, vi } from 'vitest';
import { request, redact } from '../src/transport/http.js';

function fakeFetch(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

function calls(f: typeof fetch) {
  return (f as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}

describe('request()', () => {
  it('returns the parsed body on 200', async () => {
    const f = fakeFetch(200, { menus: [], total: 0 });
    const out = await request({ base: 'http://x', method: 'GET', path: '/api/m', fetchImpl: f });
    expect(out).toEqual({ menus: [], total: 0 });
  });

  it('throws ApiError carrying the platform code, not the status text', async () => {
    const f = fakeFetch(401, { error: 'API key required', code: 'api_key_required' });
    await expect(
      request({ base: 'http://x', method: 'GET', path: '/api/v1/products', fetchImpl: f }),
    ).rejects.toMatchObject({ status: 401, code: 'api_key_required' });
  });

  it('sends the bearer token when given one', async () => {
    const f = fakeFetch(200, {});
    await request({ base: 'http://x', method: 'GET', path: '/a', token: 'tok', fetchImpl: f });
    const init = calls(f)[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('drops undefined query values', async () => {
    const f = fakeFetch(200, {});
    await request({
      base: 'http://x',
      method: 'GET',
      path: '/a',
      query: { limit: 10, cursor: undefined },
      fetchImpl: f,
    });
    expect(calls(f)[0][0]).toBe('http://x/a?limit=10');
  });

  it('carries details and fields when the platform sends them, and names the field in the message', async () => {
    const f = fakeFetch(400, { error: 'invalid', code: 'validation', fields: { slug: 'taken' }, details: { hint: 'x' } });
    await expect(request({ base: 'http://x', method: 'POST', path: '/a', fetchImpl: f })).rejects.toMatchObject({
      code: 'validation',
      fields: { slug: 'taken' },
      details: { hint: 'x' },
      message: expect.stringContaining('slug'),
    });
  });

  it('reports a non-JSON error body without inventing a code', async () => {
    const f = vi.fn(
      async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
    ) as unknown as typeof fetch;
    await expect(
      request({ base: 'http://x', method: 'GET', path: '/a', fetchImpl: f }),
    ).rejects.toMatchObject({ status: 502, code: 'non_json_response' });
  });
});

describe('redact()', () => {
  it('masks anything that looks like a credential', () => {
    expect(redact({ Authorization: 'Bearer abc', token: 'wbk_secret', name: 'ok' })).toEqual({
      Authorization: '[redacted]',
      token: '[redacted]',
      name: 'ok',
    });
  });

  it('recurses into nested objects and arrays', () => {
    expect(redact({ a: [{ password: 'p' }] })).toEqual({ a: [{ password: '[redacted]' }] });
  });
});

describe('redact() is the second line under a platform-sourced body', () => {
  it('catches a credential key the platform spells its own way', () => {
    // `sb_undo` echoes a body read back from the PLATFORM, whose vocabulary this
    // repo does not choose. An anchored `^secret$` lets every one of these
    // through, and the platform's masking would be the only thing standing
    // between a gateway key and a transcript.
    const out = redact({
      clientSecret: 'x',
      secretKey: 'x',
      checksumKey: 'x',
      credentials: { partnerCode: 'p', accessKey: 'k' },
      privateKey: 'x',
      label: 'VNPay',
    }) as Record<string, unknown>;
    for (const k of ['clientSecret', 'secretKey', 'checksumKey', 'credentials', 'privateKey']) {
      expect(out[k], k).toBe('[redacted]');
    }
    // Over-redaction is the safe direction, but it must not eat everything: a
    // translation row's `key` has to stay readable, and a bare `key` is safe
    // because it only appears inside `credentials`, which is replaced whole
    // before the recursion reaches its children.
    expect(out.label).toBe('VNPay');
    expect((redact({ key: 'home.title', value: 'Trang chủ' }) as Record<string, unknown>).key).toBe(
      'home.title',
    );
  });
});
