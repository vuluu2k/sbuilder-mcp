import { describe, it, expect, vi } from 'vitest';
import { PageSession } from '../src/tools/page.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import type { LiveSession } from '../src/live/session.js';

/**
 * THE ROOM IS JOINED BEFORE THE FIRST EDIT, NOT WHEN AN AGENT REMEMBERS.
 *
 * `sb_live_join` is one call and reads as cheap, which is exactly why it gets
 * skipped: nothing fails without it. The room is simply empty, so a merchant
 * watching their own site being built sees a static canvas and concludes the
 * agent is not working.
 *
 * MEASURED: one session built 17 pages and 19 products over two hours with an
 * editor open beside it and never joined, because no surface an agent reads on
 * the way in mentions the room.
 */

const DOC = {
  schema_version: 2,
  root_node_id: 'rt',
  nodes: {
    rt: {
      id: 'rt',
      data: { type: 'root', parent: null, nodes: [], isCanvas: true, hidden: false, custom: {} },
      style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [],
    },
  },
};

function ctxWith() {
  const f = vi.fn(async () =>
    new Response(
      JSON.stringify({ source: { pageId: 'pg_1', siteId: 's1', document: DOC, schemaVersion: 2 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  ) as unknown as typeof fetch;
  const s = new Session('http://x', f);
  (s as unknown as { access: string }).access = 'jwt';
  return { base: 'http://x', session: s, fetchImpl: f, notices: new Notices(), undo: new UndoLog() };
}

/** A room that records nothing but the fact that it was opened. */
function fakeLive(): LiveSession {
  return { publish: () => {}, select: () => {}, cursor: () => {} } as unknown as LiveSession;
}

describe('the live room is joined on the first page open', () => {
  it('joins, and names the site it joined for', async () => {
    const ps = new PageSession(ctxWith());
    const joined: string[] = [];
    ps.setLiveJoiner((siteId) => {
      joined.push(siteId);
      ps.attachLive(fakeLive());
    });

    expect(await ps.ensureLive('s1')).toBe('joined');
    expect(joined).toEqual(['s1']);
  });

  it('joins ONCE — a second open does not open a second socket', async () => {
    const ps = new PageSession(ctxWith());
    const joiner = vi.fn((_siteId: string) => ps.attachLive(fakeLive()));
    ps.setLiveJoiner(joiner);

    expect(await ps.ensureLive('s1')).toBe('joined');
    expect(await ps.ensureLive('s1')).toBe('already');
    expect(joiner).toHaveBeenCalledTimes(1);
  });

  it('A FAILED JOIN IS NOT FATAL — designing continues with nobody watching', async () => {
    const ps = new PageSession(ctxWith());
    ps.setLiveJoiner(() => {
      throw new Error('sbuilder: the live-edit room needs a credential.');
    });

    // Reports rather than throws, and the message survives for the caller.
    const out = await ps.ensureLive('s1');
    expect(out).toMatch(/needs a credential/);

    // And the session is still fully usable.
    await expect(ps.open('s1', 'pg_1')).resolves.toEqual([]);
  });

  it('says so when no live transport was registered at all', async () => {
    const ps = new PageSession(ctxWith());
    expect(await ps.ensureLive('s1')).toMatch(/no live transport/);
  });

  it('reports honestly when the joiner runs but attaches nothing', async () => {
    const ps = new PageSession(ctxWith());
    ps.setLiveJoiner(() => {
      /* connects, then drops before attaching */
    });
    expect(await ps.ensureLive('s1')).toMatch(/did not attach/);
  });
});

describe('every write re-checks the room', () => {
  it('a write joins when an earlier attempt failed', async () => {
    const ps = new PageSession(ctxWith());
    let allow = false;
    const joiner = vi.fn((_siteId: string) => {
      if (!allow) throw new Error('sbuilder: no network');
      ps.attachLive(fakeLive());
    });
    ps.setLiveJoiner(joiner);
    await ps.open('s1', 'pg_1');

    // The open tried and failed — the session edits with nobody watching.
    expect(joiner).toHaveBeenCalledTimes(1);

    // The network comes back. THE NEXT WRITE TRIES AGAIN rather than staying
    // silent for the rest of the session.
    allow = true;
    await ps.applyAndSave([
      { op: 'set', path: ['nodes', 'rt', 'style', 'gap'], value: '8px' },
    ]);
    expect(joiner).toHaveBeenCalledTimes(2);
    expect(await ps.ensureLive('s1')).toBe('already');
  });

  it('costs nothing once joined — a second write does not re-join', async () => {
    const ps = new PageSession(ctxWith());
    const joiner = vi.fn((_siteId: string) => ps.attachLive(fakeLive()));
    ps.setLiveJoiner(joiner);
    await ps.open('s1', 'pg_1');
    expect(joiner).toHaveBeenCalledTimes(1);

    await ps.applyAndSave([
      { op: 'set', path: ['nodes', 'rt', 'style', 'gap'], value: '8px' },
    ]);
    await ps.applyAndSave([
      { op: 'set', path: ['nodes', 'rt', 'style', 'gap'], value: '12px' },
    ]);
    expect(joiner).toHaveBeenCalledTimes(1);
  });
});
