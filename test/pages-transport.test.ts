import { describe, it, expect, vi } from 'vitest';
import { loadSource, saveSource } from '../src/transport/pages.js';
import { Session } from '../src/transport/auth.js';

function ctxWith(f: typeof fetch) {
  const s = new Session('http://x', f);
  (s as unknown as { access: string }).access = 'jwt';
  return { base: 'http://x', session: s, fetchImpl: f };
}

const sourceBody = {
  source: {
    pageId: 'pg_1',
    siteId: 's1',
    document: { schema_version: 2, root_node_id: 'rt', nodes: { rt: {} } },
    schemaVersion: 2,
    updatedAt: '2026-08-27T00:00:00Z',
  },
};

function okFetch() {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(sourceBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

function calls(f: typeof fetch) {
  return (f as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}

describe('loadSource()', () => {
  it('unwraps the source envelope', async () => {
    const f = okFetch();
    const out = await loadSource(ctxWith(f), 's1', 'pg_1');
    expect(out.pageId).toBe('pg_1');
    expect(calls(f)[0][0]).toBe('http://x/api/sites/s1/pages/pg_1/source');
  });

  it('uses the session credential', async () => {
    const f = okFetch();
    await loadSource(ctxWith(f), 's1', 'pg_1');
    const init = calls(f)[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
  });
});

describe('saveSource()', () => {
  it('PUTs document AND schemaVersion, exactly as the editor does', async () => {
    const f = okFetch();
    await saveSource(ctxWith(f), 's1', 'pg_1', { schema_version: 2, root_node_id: 'rt', nodes: {} });
    const init = calls(f)[0][1] as RequestInit;
    expect(init.method).toBe('PUT');
    const body = JSON.parse(String(init.body));
    expect(body.document.root_node_id).toBe('rt');
    expect(body.schemaVersion).toBe(2);
  });

  it('falls back to schema version 1 when the document carries none, as the editor does', async () => {
    const f = okFetch();
    await saveSource(ctxWith(f), 's1', 'pg_1', { root_node_id: 'rt', nodes: {} });
    expect(JSON.parse(String((calls(f)[0][1] as RequestInit).body)).schemaVersion).toBe(1);
  });

  it('surfaces the platform code on a rejected save rather than a bare status', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'band order', code: 'band_order' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    await expect(
      saveSource(ctxWith(f), 's1', 'pg_1', { schema_version: 2, root_node_id: 'rt', nodes: {} }),
    ).rejects.toMatchObject({ status: 409, code: 'band_order' });
  });
});
