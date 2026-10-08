import { describe, it, expect } from 'vitest';
import { fakePlatform } from './helpers/platform.js';

/**
 * A PAGE EDIT IS UNDOABLE. Every save PageSession makes records the document it
 * replaced, so `sb_undo` steps back through the agent's own sb_add / sb_set /
 * sb_duplicate … — and the undo, being a save, records what IT replaced, which
 * is the redo.
 */
type Doc = { root_node_id: string; nodes: Record<string, { data: { type: string; parent: string | null; nodes: string[] } }> };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const PATH = '/api/sites/s1/pages/pg_1/source';

async function built() {
  const p = fakePlatform();
  const { call, close } = await p.connect();
  const stored = () => p.pages.get('pg_1')!.document as Doc;
  await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
  await call('sb_add', {
    parent_id: 'ROOT',
    dry_run: false,
    spec: { type: 'flex-section', children: [{ type: 'flex-block' }] },
  });
  const section = stored().nodes.ROOT.data.nodes[0];
  const child = stored().nodes[section].data.nodes[0];
  return { p, call, close, stored, section, child };
}

const undoable = async (call: (n: string, a: Record<string, unknown>) => Promise<{ json: Record<string, unknown> }>) =>
  ((await call('sb_undo', {})).json.undoable ?? []) as Array<{ index: number; path: string }>;

describe('sb_undo on a page', () => {
  it('restores the pre-duplicate document exactly, and redo puts the duplicate back', async () => {
    const { p, call, close, stored, section, child } = await built();
    const beforeDup = clone(stored());
    await call('sb_duplicate', { id: child, dry_run: false });
    const afterDup = clone(stored());
    expect(afterDup.nodes[section].data.nodes).toHaveLength(2);

    const list = await undoable(call);
    expect(list[0].path).toBe(PATH);

    // A dry run sends nothing and changes nothing.
    const writes = p.writes.length;
    const dry = await call('sb_undo', { index: 1 });
    expect(dry.json.dry_run).toBe(true);
    expect(p.writes.length).toBe(writes);
    expect(stored()).toEqual(afterDup);

    const undo = await call('sb_undo', { index: 1, dry_run: false });
    expect(undo.isError).toBe(false);
    expect(stored()).toEqual(beforeDup);

    // The undo recorded what it replaced: index 1 is now the redo.
    const redo = await call('sb_undo', { index: 1, dry_run: false });
    expect(redo.isError).toBe(false);
    expect(stored()).toEqual(afterDup);
    await close();
  });

  it('refuses when the stored draft moved underneath (another writer)', async () => {
    const { p, call, close, stored, child } = await built();
    await call('sb_duplicate', { id: child, dry_run: false });
    // A human saves in the editor: new content, new rev.
    const theirs = clone(stored());
    theirs.nodes.ROOT.data.nodes = [];
    const rev = p.pages.get('pg_1')!.rev;
    p.pages.set('pg_1', { document: theirs, rev: rev + 1 });

    const r = await call('sb_undo', { index: 1, dry_run: false });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/moved|saved elsewhere/i);
    expect(stored()).toEqual(theirs);
    await close();
  });

  it('records nothing for a dry run or a save that changed nothing', async () => {
    const { call, close, child } = await built();
    const n = (await undoable(call)).length;
    expect(n).toBeGreaterThan(0); // the sb_add itself
    await call('sb_duplicate', { id: child }); // dry run
    expect((await undoable(call)).length).toBe(n);
    // Set a key to the value it already holds: a save, and nothing changed.
    await call('sb_set', { id: child, namespace: 'style', keys: { opacity: '1' }, base: true, dry_run: false });
    const m = (await undoable(call)).length;
    await call('sb_set', { id: child, namespace: 'style', keys: { opacity: '1' }, base: true, dry_run: false });
    expect((await undoable(call)).length).toBe(m);
    await close();
  });
});
