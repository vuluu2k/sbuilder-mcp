import { describe, it, expect } from 'vitest';
import { PageSession } from '../src/tools/page.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import type { LiveSession } from '../src/live/session.js';
import type { Patch } from '../src/core/patch.js';
import { fakePlatform } from './helpers/platform.js';

const n = (id: string, type: string, parent: string | null, nodes: string[] = [], specials: Record<string, unknown> = {}) => ({
  id,
  data: { type, parent, nodes, isCanvas: false, hidden: false, custom: {} },
  style: {},
  config: {},
  specials,
  responsive: {},
  events: [],
  bindings: [],
});

const PAGE = () => ({
  schema_version: 2,
  root_node_id: 'ROOT',
  nodes: {
    ROOT: n('ROOT', 'root', null, ['A', 'B']),
    A: n('A', 'flex-section', 'ROOT', ['ta']),
    ta: n('ta', 'text', 'A', [], { text: 'one' }),
    B: n('B', 'flex-section', 'ROOT', ['tb']),
    tb: n('tb', 'text', 'B', [], { text: 'two' }),
  },
});
const FORM = () => ({
  root_node_id: 'fm_1',
  nodes: {
    fm_1: n('fm_1', 'form', null, ['fm_2']),
    fm_2: n('fm_2', 'form-text', 'fm_1', [], { name: 'email', label: 'Email' }),
  },
});

/** A tiny stateful platform for one page and one form, PageSession-level. */
function rig() {
  let page = { document: PAGE() as unknown, rev: 1 };
  let form: unknown = FORM();
  const puts: Array<{ path: string; body: { document: Record<string, unknown> } }> = [];
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method === 'PUT') puts.push({ path, body });
    if (path.endsWith('/forms/f1/document')) {
      if (method === 'PUT') form = body.document;
      return json(method === 'PUT' ? { schema: {} } : { document: form });
    }
    if (path.endsWith('/pages/pg_1/source')) {
      if (method === 'PUT') page = { document: body.document, rev: page.rev + 1 };
      return json({ source: { pageId: 'pg_1', siteId: 's1', document: page.document, schemaVersion: 2, rev: page.rev } });
    }
    return json({});
  }) as unknown as typeof fetch;
  const s = new Session('http://x', fetchImpl);
  (s as unknown as { access: string }).access = 'jwt';
  const ctx = { base: 'http://x', session: s, fetchImpl, notices: new Notices(), undo: new UndoLog() };
  const ps = new PageSession(ctx as never);
  const published: Patch[][] = [];
  const live = {
    publish: (patches: Patch[]) => {
      published.push(patches);
      return { sent: true, opIds: [] };
    },
    select: () => {},
    cursor: () => {},
    start: () => {},
    close: () => {},
    peers: [],
    page: 'pg_1',
    peerId: '',
    whenAcked: async () => true,
  } as unknown as LiveSession;
  ps.setLiveJoiner((site) => ps.attachLive(live, site));
  return { ps, ctx, puts, published, page: () => page };
}

const humanEdit: Patch[] = [{ op: 'set', path: ['nodes', 'ta', 'specials', 'text'], value: 'human' }];

describe('a form document is in no live room', () => {
  it("the previous page's room ops never land in the open form, and its desync never marks the form stale", async () => {
    const { ps, puts } = rig();
    await ps.open('s1', 'pg_1');
    await ps.openForm('s1', 'f1');
    // A human edits page P in the room the session joined for it.
    ps.applyRemote([{ op: 'set', path: ['nodes', 'ta'], value: n('ta', 'text', 'A', [], { text: 'human' }) }]);
    ps.roomDesync('gap in seq: expected 3, received 5');
    await ps.applyAndSave([{ op: 'set', path: ['nodes', 'fm_2', 'specials', 'label'], value: 'E-mail' }]);
    const put = puts.find((p) => p.path.endsWith('/forms/f1/document'))!;
    expect(Object.keys(put.body.document.nodes as object).sort()).toEqual(['fm_1', 'fm_2']);
  });

  it("a form edit is never published as ops into the page's room", async () => {
    const { ps, published } = rig();
    await ps.open('s1', 'pg_1');
    await ps.openForm('s1', 'f1');
    const before = published.length;
    await ps.applyAndPublish([{ op: 'set', path: ['nodes', 'fm_2', 'specials', 'label'], value: 'E-mail' }]);
    await ps.applyAndSave([{ op: 'set', path: ['nodes', 'fm_2', 'specials', 'label'], value: 'Mail' }]);
    expect(published.slice(before).flat().some((x) => JSON.stringify(x).includes('fm_2'))).toBe(false);
  });
});

describe('page undo never erases a live peer edit', () => {
  it('refuses an undo whose save carried a peer op, naming the node', async () => {
    const { ps, ctx, page } = rig();
    await ps.open('s1', 'pg_1');
    ps.applyRemote(humanEdit); // merged into the copy…
    await ps.applyAndSave([{ op: 'set', path: ['nodes', 'tb', 'specials', 'text'], value: 'agent' }]); // …and into this save
    const entry = ctx.undo.at(1)!;
    const fence = ctx.undo.fenceFor(entry.path)!;
    await expect(
      ps.restorePage('s1', 'pg_1', entry.body.document as never, fence, entry.peer),
    ).rejects.toThrow(/ta/);
    expect((page().document as ReturnType<typeof PAGE>).nodes.ta.specials.text).toBe('human');
  });

  it('refuses when a peer op landed after the recorded save', async () => {
    const { ps, ctx, page } = rig();
    await ps.open('s1', 'pg_1');
    await ps.applyAndSave([{ op: 'set', path: ['nodes', 'tb', 'specials', 'text'], value: 'agent' }]);
    ps.applyRemote(humanEdit); // in the room, not yet saved by its author
    const entry = ctx.undo.at(1)!;
    await expect(
      ps.restorePage('s1', 'pg_1', entry.body.document as never, ctx.undo.fenceFor(entry.path)!, entry.peer),
    ).rejects.toThrow(/live|peer|room/i);
    expect((page().document as ReturnType<typeof PAGE>).nodes.tb.specials.text).toBe('agent');
  });

  it('refuses to restore an OLDER save when a later save carried a peer edit', async () => {
    const { ps, ctx, page } = rig();
    await ps.open('s1', 'pg_1');
    await ps.applyAndSave([{ op: 'set', path: ['nodes', 'tb', 'specials', 'text'], value: 'agent' }]); // save A
    ps.applyRemote(humanEdit);
    await ps.applyAndSave([{ op: 'set', path: ['nodes', 'tb', 'specials', 'text'], value: 'agent 2' }]); // save B carries it
    const older = ctx.undo.at(2)!;
    await expect(
      ps.restorePage('s1', 'pg_1', older.body.document as never, ctx.undo.fenceFor(older.path)!, ctx.undo.peersThrough(older)),
    ).rejects.toThrow(/ta/);
    expect((page().document as ReturnType<typeof PAGE>).nodes.ta.specials.text).toBe('human');
  });

  it('refuses while a DIFFERENT open document holds unsaved edits, since restoring re-opens', async () => {
    const { ps, ctx } = rig();
    await ps.open('s1', 'pg_1');
    await ps.applyAndSave([{ op: 'set', path: ['nodes', 'tb', 'specials', 'text'], value: 'agent' }]);
    const entry = ctx.undo.at(1)!;
    await ps.openForm('s1', 'f1');
    (ps as unknown as { hasUnsaved: () => boolean }).hasUnsaved = () => true;
    await expect(
      ps.restorePage('s1', 'pg_1', entry.body.document as never, ctx.undo.fenceFor(entry.path)!, []),
    ).rejects.toThrow(/unsaved/);
  });

  it('still undoes a save no peer touched', async () => {
    const { ps, ctx, page } = rig();
    await ps.open('s1', 'pg_1');
    await ps.applyAndSave([{ op: 'set', path: ['nodes', 'tb', 'specials', 'text'], value: 'agent' }]);
    const entry = ctx.undo.at(1)!;
    await ps.restorePage('s1', 'pg_1', entry.body.document as never, ctx.undo.fenceFor(entry.path)!, entry.peer);
    expect((page().document as ReturnType<typeof PAGE>).nodes.tb.specials.text).toBe('two');
  });
});

describe('sb_undo of a raw sb_api_call page PUT', () => {
  it('takes the raw path even when a PageSession fence exists for that page', async () => {
    const p = fakePlatform();
    const { call, close } = await p.connect();
    try {
      await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
      await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: { type: 'flex-section' } });
      const before = JSON.parse(JSON.stringify(p.pages.get('pg_1')!.document));
      const raw = await call('sb_api_call', {
        id: 'put:/api/sites/{siteId}/pages/{pageId}/source',
        path_params: { siteId: 's1', pageId: 'pg_1' },
        body: { document: { ...before, nodes: { ...before.nodes, ROOT: { ...before.nodes.ROOT, data: { ...before.nodes.ROOT.data, nodes: [] } } } }, schemaVersion: 2 },
        dry_run: false,
      });
      expect(raw.isError, raw.text).toBe(false);
      const undone = await call('sb_undo', { index: 1, dry_run: false });
      expect(undone.isError, undone.text).toBe(false);
      expect(p.pages.get('pg_1')!.document).toEqual(before);
    } finally {
      await close();
    }
  });
});
