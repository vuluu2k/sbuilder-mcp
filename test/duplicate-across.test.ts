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
  const call = raw;
  await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
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
    expect(Object.keys(d.nodes)).not.toContain('__held');
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

describe('the cross-site reconcile credential', () => {
  // The platform refuses a delegated (API-key) caller on /clipboard/reconcile: the
  // reconcile reads the SOURCE site, which only a person's membership vouches for.
  // A key on the TARGET site used to ride along, because siteToken prefers the key
  // on its own site.
  it('sends the account session, not the API key, even when the key is the target site', async () => {
    const { Session } = await import('../src/transport/auth.js');
    const { connectedClient } = await import('./harness.js');
    const auths: Record<string, string> = {};
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
      if (url.pathname.endsWith('/clipboard/reconcile')) {
        auths.reconcile = auth;
        const body = JSON.parse(String(init?.body));
        return json({ reconcile: { tree: body.tree, copiedAssets: 0, droppedRefs: [] } });
      }
      const m = /^\/api\/sites\/([^/]+)\/pages\/([^/]+)\/source$/.exec(url.pathname);
      if (m) {
        const document = m[2] === 'pg_1' ? { schema_version: 2, ...source() } : { schema_version: 2, root_node_id: 'ROOT', nodes: { ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: [] } } } };
        return json({ source: { pageId: m[2], siteId: m[1], document, schemaVersion: 2, updatedAt: 'now', rev: 1 } });
      }
      return json({});
    }) as unknown as typeof fetch;
    const session = new Session('http://x', fetchImpl);
    (session as unknown as { access: string }).access = 'session-jwt';
    const { client, close } = await connectedClient({ fetchImpl, session, apiKey: 'wbk_target_key', keySite: 's2' } as never);
    const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
    await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
    const out = (await call('sb_duplicate', { id: 's1', to_page_id: 'pg_9', to_site_id: 's2', dry_run: false })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(out.isError, out.content[0]?.text).toBeFalsy();
    expect(auths.reconcile, 'liveness: the reconcile was reached').toBeDefined();
    expect(auths.reconcile).toBe('Bearer session-jwt');
    await close();
  });
});
