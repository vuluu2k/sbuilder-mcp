import { describe, it, expect, vi } from 'vitest';
import { PageSession } from '../src/tools/page.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import { setKeys } from '../src/domains/site/builder.js';

/**
 * A PUT THAT CHANGES NOTHING IS NOT FREE.
 *
 * `sb_look` saves before it renders — correctly, a shot of an unsaved edit is a
 * shot of the past — and a vision loop looks far more often than it edits. So
 * the same bytes went back over the wire on every look, costing a round trip
 * and, worse, BUMPING THE REVISION of every shared master the page carries.
 * That fence is the one `restampPatches` exists to keep honest; churning it for
 * no reason is how a session collides with a real editor.
 *
 * Measured before the guard: six consecutive looks, six writes. After: the
 * page's `updatedAt` is untouched by six looks and moves on the first real edit.
 */
const SOURCE = {
  source: {
    pageId: 'pg_1',
    siteId: 'site_1',
    schemaVersion: 2,
    updatedAt: '',
    document: {
      schema_version: 2,
      root_node_id: 'ROOT',
      nodes: {
        ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['fs_1'] }, specials: {} },
        fs_1: {
          id: 'fs_1',
          data: { type: 'flex-section', parent: 'ROOT', nodes: [] },
          style: {},
          config: {},
          specials: {},
          responsive: {},
        },
      },
    },
  },
};

function harness() {
  const puts: unknown[] = [];
  const fetchImpl = vi.fn(async (_url: string, init?: { method?: string }) => {
    if ((init?.method ?? 'GET') === 'PUT') puts.push(1);
    return new Response(JSON.stringify(SOURCE), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  const ctx = {
    base: 'http://x',
    session: new Session('http://x'),
    apiKey: 'wbk_k',
    fetchImpl,
    notices: new Notices(), undo: new UndoLog(),
  } as never;
  return { session: new PageSession(ctx), puts };
}

describe('PageSession.save() skips an unchanged document', () => {
  it('writes nothing when the page was only opened and looked at', async () => {
    const { session, puts } = harness();
    await session.open('site_1', 'pg_1');
    await session.save();
    await session.save();
    await session.save();
    expect(puts).toHaveLength(0);
  });

  it('writes once when something actually changed', async () => {
    const { session, puts } = harness();
    await session.open('site_1', 'pg_1');
    const d = session.current();
    session.applyAndPublish(setKeys(d, 'fs_1', { color: '#fff' }, { namespace: 'style', base: true }));
    await session.save();
    expect(puts).toHaveLength(1);
  });

  it('does not write the same change twice', async () => {
    const { session, puts } = harness();
    await session.open('site_1', 'pg_1');
    const d = session.current();
    session.applyAndPublish(setKeys(d, 'fs_1', { color: '#fff' }, { namespace: 'style', base: true }));
    await session.save();
    await session.save();
    expect(puts).toHaveLength(1);
  });

  it('writes again after a further change', async () => {
    const { session, puts } = harness();
    await session.open('site_1', 'pg_1');
    const d = session.current();
    session.applyAndPublish(setKeys(d, 'fs_1', { color: '#fff' }, { namespace: 'style', base: true }));
    await session.save();
    session.applyAndPublish(setKeys(d, 'fs_1', { color: '#000' }, { namespace: 'style', base: true }));
    await session.save();
    expect(puts).toHaveLength(2);
  });
});
