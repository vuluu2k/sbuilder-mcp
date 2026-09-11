import { describe, it, expect, vi } from 'vitest';
import { callOperation, shapeResponse, RESULT_CAP } from '../src/tools/api.js';
import { Session } from '../src/transport/auth.js';

const ok = () =>
  vi.fn(
    async () =>
      new Response(JSON.stringify({ menus: [], total: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;

function calls(f: typeof fetch) {
  return (f as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}

async function ctxWith(fetchImpl: typeof fetch, apiKey?: string) {
  const loginFetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          user: { id: 'u1', name: 'Agent' },
          tokens: { accessToken: 'jwt', refreshToken: 'r', tokenType: 'Bearer', expiresIn: 900 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  ) as unknown as typeof fetch;
  const session = new Session('http://x', loginFetch);
  await session.login('e@x', 'pw');
  return { base: 'http://x', session, apiKey, fetchImpl };
}

describe('callOperation()', () => {
  it('substitutes path params', async () => {
    const f = ok();
    await callOperation(await ctxWith(f, 'wbk_k'), {
      id: 'get:/api/sites/{siteID}/menus',
      path_params: { siteID: 's1' },
      dry_run: false,
    });
    expect(calls(f)[0][0]).toBe('http://x/api/sites/s1/menus');
  });

  it('refuses when a required path param is missing', async () => {
    await expect(
      callOperation(await ctxWith(ok(), 'wbk_k'), {
        id: 'get:/api/sites/{siteID}/menus',
        dry_run: false,
      }),
    ).rejects.toThrow(/siteID/);
  });

  it('refuses an unknown operation id', async () => {
    await expect(
      callOperation(await ctxWith(ok(), 'wbk_k'), { id: 'get:/nope', dry_run: false }),
    ).rejects.toThrow(/unknown operation/i);
  });

  it('PREFERS the API key on a private path - it is the narrower credential', async () => {
    const f = ok();
    await callOperation(await ctxWith(f, 'wbk_k'), {
      id: 'get:/api/sites/{siteID}/menus',
      path_params: { siteID: 's1' },
      dry_run: false,
    });
    const init = calls(f)[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer wbk_k');
  });

  it('falls back to the session on a private path when no key is set', async () => {
    const f = ok();
    await callOperation(await ctxWith(f), {
      id: 'get:/api/sites/{siteID}/menus',
      path_params: { siteID: 's1' },
      dry_run: false,
    });
    const init = calls(f)[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
  });

  it('names both ways to authenticate when neither is present', async () => {
    const loginless = { base: 'http://x', session: new Session('http://x'), fetchImpl: ok() };
    await expect(
      callOperation(loginless, {
        id: 'get:/api/sites/{siteID}/menus',
        path_params: { siteID: 's1' },
        dry_run: false,
      }),
    ).rejects.toThrow(/SB_TOKEN.*SB_EMAIL|SB_EMAIL.*SB_TOKEN/s);
  });

  it('sends the API key for a /api/v1 path', async () => {
    const f = ok();
    await callOperation(await ctxWith(f, 'wbk_k'), { id: 'get:/api/v1/products', dry_run: false });
    const init = calls(f)[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer wbk_k');
  });

  it('says which env var is missing rather than sending an unauthenticated v1 call', async () => {
    await expect(
      callOperation(await ctxWith(ok()), { id: 'get:/api/v1/products', dry_run: false }),
    ).rejects.toThrow(/SB_TOKEN/);
  });

  it('defaults to a dry run that touches no network and redacts the token', async () => {
    const f = ok();
    const out = (await callOperation(await ctxWith(f, 'wbk_k'), {
      id: 'get:/api/sites/{siteID}/menus',
      path_params: { siteID: 's1' },
    })) as Record<string, unknown>;
    expect(calls(f).length).toBe(0);
    expect(out.dry_run).toBe(true);
    expect(JSON.stringify(out)).not.toContain('jwt');
  });

  it('encodes a path param rather than letting it inject a path segment', async () => {
    const f = ok();
    await callOperation(await ctxWith(f, 'wbk_k'), {
      id: 'get:/api/sites/{siteID}/menus',
      path_params: { siteID: 'a/../b' },
      dry_run: false,
    });
    expect(calls(f)[0][0]).toBe('http://x/api/sites/a%2F..%2Fb/menus');
  });
});

describe('shapeResponse()', () => {
  const list = (n: number) => ({
    products: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, title: `T${i}`, blob: 'x'.repeat(200) })),
    total: n,
  });

  it('pick keeps the named fields on every item and leaves the envelope', () => {
    const out = shapeResponse(list(2), { pick: ['id'] }) as { products: unknown[]; total: number };
    expect(out).toEqual({ products: [{ id: 'p0' }, { id: 'p1' }], total: 2 });
  });

  it('max_items cuts the list and says so', () => {
    const out = shapeResponse(list(5), { max_items: 2 }) as { products: unknown[]; truncated: { shown: number; of: number } };
    expect(out.products.length).toBe(2);
    expect(out.truncated).toMatchObject({ shown: 2, of: 5 });
  });

  it('a list over the cap is cut to fit, with a hint that names pick and max_items', () => {
    const out = shapeResponse(list(600), {}) as { products: unknown[]; truncated: { shown: number; of: number; hint: string } };
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(RESULT_CAP + 200);
    expect(out.truncated.of).toBe(600);
    expect(out.truncated.shown).toBeLessThan(600);
    expect(out.truncated.hint).toMatch(/pick/);
  });

  it('pick reaches inside a single-item answer', () => {
    expect(shapeResponse({ page: { id: 'p1', name: 'Home', settings: {} } }, { pick: ['id'] })).toEqual({ page: { id: 'p1' } });
  });

  it('a non-list answer is never cut — its payload survives, with a note that the cap did not apply', () => {
    const big = { thing: { blob: 'x'.repeat(RESULT_CAP + 10) } };
    const out = shapeResponse(big, { max_items: 1 }) as Record<string, unknown>;
    expect(out.thing).toEqual(big.thing);
    expect(String(out.shaping_note)).toMatch(/max_items|nothing was shaped/);
  });

  it('is identity when nothing was asked for', () => {
    const raw = { thing: { a: 1 } };
    expect(shapeResponse(raw, {})).toBe(raw);
  });

  it('a bare array is shaped too', () => {
    const out = shapeResponse([{ id: 1, x: 2 }, { id: 2, x: 3 }], { pick: ['id'], max_items: 1 }) as { items: unknown[]; truncated: unknown };
    expect(out.items).toEqual([{ id: 1 }]);
    expect(out.truncated).toBeDefined();
  });
});

describe('shapeResponse() — the edges the review found', () => {
  it('pick on a two-array answer returns it untouched and says so, never {}', () => {
    const raw = { items: [{ id: 1, blob: 'x' }], warnings: [{ w: 1 }] };
    const out = shapeResponse(raw, { pick: ['id'] }) as Record<string, unknown>;
    expect(out.items).toEqual(raw.items);
    expect(out.warnings).toEqual(raw.warnings);
    expect(String(out.shaping_note)).toMatch(/nothing was shaped/);
  });

  it('pick prefers the answer\'s own fields over its one nested object', () => {
    const out = shapeResponse({ id: 'p1', title: 'Home', config: { a: 1 } }, { pick: ['id', 'title'] });
    expect(out).toEqual({ id: 'p1', title: 'Home' });
  });

  it('max_items on a non-list answer is reported, not silently ignored', () => {
    const out = shapeResponse({ items: [1, 2, 3], warnings: [] }, { max_items: 1 }) as Record<string, unknown>;
    expect(out.items).toEqual([1, 2, 3]);
    expect(String(out.shaping_note)).toMatch(/max_items|nothing was shaped/);
  });

  it('a size cut fits under the cap INCLUDING its note', () => {
    const raw = { products: Array.from({ length: 600 }, (_, i) => ({ id: `p${i}`, blob: 'x'.repeat(200) })), total: 600 };
    const out = shapeResponse(raw, {});
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(RESULT_CAP);
  });

  it('when the non-list part alone is over the cap, nothing is cut and the note says why', () => {
    const raw = { products: [{ id: 'p1' }], meta: 'x'.repeat(RESULT_CAP + 10) };
    const out = shapeResponse(raw, {}) as { products: unknown[]; truncated: { hint: string } };
    expect(out.products.length).toBe(1);
    expect(out.truncated.hint).toMatch(/nothing was cut/);
  });

  it('never clobbers a platform field named truncated', () => {
    const out = shapeResponse({ rows: [1, 2, 3], truncated: 'platform' }, { max_items: 1 }) as Record<string, unknown>;
    expect(out.truncated).toBe('platform');
    expect(out._truncated).toMatchObject({ shown: 1, of: 3 });
  });
});

/**
 * THE RECOVERY SURFACE ANSWERS WITH THE DOCUMENTS THEMSELVES.
 *
 * Which is right — a restore has to have something to restore from — and
 * useless to read. MEASURED against a live server: one version of a TWO-NODE
 * page is 1,690 bytes, so a realistic 120-node page runs about 70 KB per
 * version and a listing of twenty is 1.4 MB in ONE answer. An agent choosing
 * which version to restore would be handed a truncated blob and no reliable way
 * to pick.
 *
 * `sb_publish` had this exact problem and the same answer: a published row
 * carries document, html and css for every page the cascade touched, so it
 * projects the rows. This is that, applied where the caller cannot know to ask.
 */
describe('a listing whose every row is a whole page', () => {
  const versions = {
    total: 2,
    versions: [
      { id: 'pv_2', versionNo: 2, label: 'b', createdBy: 'u', createdAt: 't', isLive: false, document: { nodes: { ROOT: {} } } },
      { id: 'pv_1', versionNo: 1, label: 'a', createdBy: 'u', createdAt: 't', isLive: true, document: { nodes: { ROOT: {} } } },
    ],
  };

  it('keeps what a caller needs to CHOOSE and drops what it cannot read', () => {
    const out = shapeResponse(versions, {
      pick: ['id', 'versionNo', 'label', 'createdBy', 'createdAt', 'isLive'],
    }) as { versions: Array<Record<string, unknown>> };
    expect(Object.keys(out.versions[0]).sort()).toEqual(
      ['createdAt', 'createdBy', 'id', 'isLive', 'label', 'versionNo'].sort(),
    );
    expect(JSON.stringify(out)).not.toContain('nodes');
  });

  it('still carries the version NUMBER and the label, which are how a human picks', () => {
    // An id alone is not a choice: "restore the one before I broke it" is
    // answered by the label somebody typed and by the order.
    const out = shapeResponse(versions, { pick: ['id', 'versionNo', 'label'] }) as {
      versions: Array<{ versionNo: number; label: string }>;
    };
    expect(out.versions.map((v) => v.versionNo)).toEqual([2, 1]);
    expect(out.versions.map((v) => v.label)).toEqual(['b', 'a']);
  });

  it('leaves the total alone, because a truncated list that lies about its size is worse', () => {
    const out = shapeResponse(versions, { pick: ['id'] }) as { total: number };
    expect(out.total).toBe(2);
  });
});
