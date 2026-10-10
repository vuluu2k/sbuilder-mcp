import { describe, it, expect } from 'vitest';
import { fakePlatform } from './helpers/platform.js';

/** sb_duplicate to_page_id / to_site_id — the editor's copy/paste onto another page. */
type Doc = { root_node_id: string; nodes: Record<string, any> };

const source = (): Doc => ({
  root_node_id: 'ROOT',
  nodes: {
    ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['s1'] } },
    s1: { id: 's1', data: { type: 'flex-section', parent: 'ROOT', nodes: ['t1'] }, style: {}, specials: {} },
    t1: { id: 't1', data: { type: 'text', parent: 's1', nodes: [] }, specials: { text: 'Hi' } },
  },
});

async function setup() {
  const reconciles: any[] = [];
  const p = fakePlatform((method, path, body) => {
    if (path === '/api/sites/s2/clipboard/reconcile') {
      reconciles.push(body);
      const tree = structuredClone((body as any).tree);
      tree.nodes.t1.specials.text = 'Hi (reconciled)';
      return { reconcile: { tree, copiedAssets: 1, droppedRefs: [{ namespace: 'product', oldId: 'p9' }] } };
    }
    return undefined;
  });
  p.pages.set('pg_1', { document: { schema_version: 2, ...source() }, rev: 1 });
  const { call: raw, close } = await p.connect();
  const call = (name: string, args: Record<string, unknown>) => raw(name, { site_id: 's1', ...args });
  await call('sb_page_open', { page_id: 'pg_1' });
  const doc = (k: string) => p.pages.get(k)?.document as Doc | undefined;
  return { call, close, doc, reconciles };
}

describe('sb_duplicate onto another page', () => {
  it('copies the subtree under fresh ids onto the target and leaves the source alone', async () => {
    const { call, close, doc } = await setup();
    const dry = await call('sb_duplicate', { id: 's1', to_page_id: 'pg_2' });
    expect(dry.json.dry_run).toBe(true);
    expect(doc('pg_2')?.nodes.ROOT.data.nodes ?? []).toEqual([]);
    const out = await call('sb_duplicate', { id: 's1', to_page_id: 'pg_2', dry_run: false });
    expect(out.isError, out.text).toBe(false);
    const d = doc('pg_2')!;
    const copy = d.nodes[d.nodes.ROOT.data.nodes[0]];
    expect(copy.data.type).toBe('flex-section');
    expect(copy.id).not.toBe('s1');
    expect(d.nodes[copy.data.nodes[0]].specials.text).toBe('Hi');
    expect(doc('pg_1')!.nodes.ROOT.data.nodes).toEqual(['s1']);
    await close();
  });

  it('goes through the reconcile across sites and reports what it lost', async () => {
    const { call, close, doc, reconciles } = await setup();
    const dry = await call('sb_duplicate', { id: 's1', to_page_id: 'pg_9', to_site_id: 's2' });
    expect(dry.json.cross_site).toBeDefined();
    expect(reconciles).toEqual([]);
    const out = await call('sb_duplicate', { id: 's1', to_page_id: 'pg_9', to_site_id: 's2', dry_run: false });
    expect(out.isError, out.text).toBe(false);
    expect(reconciles[0]).toMatchObject({ sourceSiteId: 's1', tree: { rootId: 's1' } });
    expect(out.json).toMatchObject({ copiedAssets: 1, droppedRefs: [{ namespace: 'product', oldId: 'p9' }] });
    const d = doc('pg_9')!;
    const copy = d.nodes[d.nodes.ROOT.data.nodes[0]];
    expect(d.nodes[copy.data.nodes[0]].specials.text).toBe('Hi (reconciled)');
    expect(Object.keys(d.nodes)).not.toContain('__clipboard');
    await close();
  });

  it('refuses before the reconcile and before switching pages', async () => {
    const { call, close, reconciles } = await setup();
    const bad = await call('sb_duplicate', { id: 's1', to_page_id: 'pg_8', to_site_id: 's2', parent_id: 'nope', dry_run: false });
    expect(bad.isError).toBe(true);
    expect(reconciles).toEqual([]);
    // Still on the source page: its section is still addressable.
    const again = await call('sb_duplicate', { id: 's1' });
    expect(again.isError, again.text).toBe(false);
    await close();
  });

  it('refuses the open page as a target', async () => {
    const { call, close } = await setup();
    expect((await call('sb_duplicate', { id: 's1', to_page_id: 'pg_1' })).text).toMatch(/open page/);
    await close();
  });
});
