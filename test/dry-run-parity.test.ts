import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';

/**
 * A DRY RUN MUST SAY WHAT THE REAL CALL WILL SAY. It returned before
 * `applyAndSave`, so it never ran `validateForSave` — a section added above a
 * global header previewed as fine and the real call refused it. It also spent
 * `ctx.notices.once`, so the warning shown in the preview was gone by the time
 * the write that needed it ran.
 */
// Same in-memory opener as write-check.test.ts (a test file cannot import another's).
async function openClient(doc: unknown, pages: Record<string, unknown> = {}) {
  const writes: string[] = [];
  const f = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if ((init?.method ?? 'GET') !== 'GET') writes.push(path);
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/source')) {
      return json({ source: { pageId: 'pg_1', siteId: 's1', document: JSON.parse(JSON.stringify(Object.entries(pages).find(([id]) => path.includes(`/${id}/`))?.[1] ?? doc)), schemaVersion: 2, updatedAt: 'now', rev: 1 } });
    }
    return json({});
  }) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  const { client, close } = await connectedClient({ fetchImpl: f, session, siteId: 's1' });
  await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text?: string }>; isError?: boolean };
    const raw = res.content.map((c) => c.text ?? '').join('');
    return { raw, isError: !!res.isError, json: (() => { try { return JSON.parse(raw); } catch { return null; } })() };
  };
  return { call, close, writes };
}

const BANDED = {
  schema_version: 2,
  root_node_id: 'ROOT',
  nodes: {
    ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['hdr', 'btn'] }, specials: {} },
    hdr: {
      id: 'hdr',
      data: { type: 'flex-section', parent: 'ROOT', nodes: [] },
      specials: { globalId: 'g1', globalKind: 'header' },
    },
    btn: { id: 'btn', data: { type: 'button', parent: 'ROOT', nodes: [] }, specials: { text: 'Go' } },
  },
};

describe('dry run parity', () => {
  it('a band-order-breaking add previews as would_refuse, and the real call refuses', async () => {
    const { call, close, writes } = await openClient(BANDED);
    try {
      const dry = await call('sb_add', { parent_id: 'ROOT', spec: { type: 'flex-section' }, index: 0 });
      expect(dry.json.dry_run).toBe(true);
      expect(dry.json.would_refuse).toMatch(/global header/);
      const real = await call('sb_add', { parent_id: 'ROOT', spec: { type: 'flex-section' }, index: 0, dry_run: false });
      expect(real.raw).toMatch(/refusing to save/);
      expect(writes).toEqual([]);
    } finally {
      await close();
    }
  });

  it('a writable add previews without would_refuse', async () => {
    const { call, close } = await openClient(BANDED);
    try {
      const dry = await call('sb_add', { parent_id: 'ROOT', spec: { type: 'flex-section' } });
      expect(dry.json.would_refuse).toBeUndefined();
    } finally {
      await close();
    }
  });

  it('the warning a dry run shows is still shown by the real write', async () => {
    const { call, close } = await openClient(BANDED);
    try {
      const args = { id: 'btn', namespace: 'specials', keys: { lable: 'x' } };
      const dry = await call('sb_set', args);
      expect(dry.json.checks?.[0]?.key).toBe('specials.lable');
      const real = await call('sb_set', { ...args, dry_run: false });
      expect(real.json.checks?.[0]?.key).toBe('specials.lable');
    } finally {
      await close();
    }
  });

  it('sb_add: dry run then real write both carry the check', async () => {
    const { call, close } = await openClient(BANDED);
    try {
      const args = { parent_id: 'ROOT', spec: { type: 'heading', config: { colour: 'red' } } };
      expect((await call('sb_add', args)).json.checks?.[0]?.key).toBe('config.colour');
      expect((await call('sb_add', { ...args, dry_run: false })).json.checks?.[0]?.key).toBe('config.colour');
    } finally {
      await close();
    }
  });

  it('a dry-run sb_set changes nothing local', async () => {
    const { call, close } = await openClient(BANDED);
    try {
      await call('sb_set', { id: 'btn', namespace: 'specials', keys: { text: 'Changed' } });
      const read = await call('sb_node_read', { id: 'btn' });
      expect(read.raw).toContain('Go');
      expect(read.raw).not.toContain('Changed');
    } finally {
      await close();
    }
  });

  it('sb_template_use dry run leaves the open page unchanged', async () => {
    const other = {
      schema_version: 2,
      root_node_id: 'ROOT',
      nodes: { ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['elsewhere'] }, specials: {} },
        elsewhere: { id: 'elsewhere', data: { type: 'flex-section', parent: 'ROOT', nodes: [] } } },
    };
    const { call, close } = await openClient(BANDED, { pg_other: other });
    try {
      // Opened pg_1; preview a built-in onto ANOTHER page.
      const dry = await call('sb_template_use', { template_id: 'sb_hero_centered', page_id: 'pg_other' });
      expect(dry.json.dry_run).toBe(true);
      expect(dry.json.into).toBe('pg_other');
      const st = await call('sb_outline', {});
      expect(st.raw).toContain('btn');
      expect(st.raw).not.toContain('elsewhere');
      // The session is still on pg_1: a write lands there.
      const set = await call('sb_set', { id: 'btn', namespace: 'specials', keys: { text: 'Still here' } });
      expect(set.raw).not.toMatch(/^sbuilder:/);
    } finally {
      await close();
    }
  });
});

describe('dry run parity — move, remove, duplicate', () => {
  const FOOTED = {
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: {
      ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['mid', 'ftr'] }, specials: {} },
      mid: { id: 'mid', data: { type: 'flex-section', parent: 'ROOT', nodes: [] }, specials: {} },
      ftr: {
        id: 'ftr',
        data: { type: 'flex-section', parent: 'ROOT', nodes: [] },
        specials: { globalId: 'g2', globalKind: 'footer' },
      },
    },
  };

  it('moving the footer to index 0 previews as would_refuse, and the real call refuses', async () => {
    const { call, close, writes } = await openClient(FOOTED);
    try {
      const dry = await call('sb_move', { id: 'ftr', parent_id: 'ROOT', index: 0 });
      expect(dry.json.dry_run).toBe(true);
      expect(dry.json.would_refuse).toMatch(/footer/);
      const real = await call('sb_move', { id: 'ftr', parent_id: 'ROOT', index: 0, dry_run: false });
      expect(real.raw).toMatch(/refusing to save/);
      expect(writes).toEqual([]);
    } finally {
      await close();
    }
  });

  it('a clean remove and duplicate preview without would_refuse', async () => {
    const { call, close } = await openClient(FOOTED);
    try {
      expect((await call('sb_remove', { id: 'mid' })).json.would_refuse).toBeUndefined();
      expect((await call('sb_duplicate', { id: 'mid' })).json.would_refuse).toBeUndefined();
    } finally {
      await close();
    }
  });
});
