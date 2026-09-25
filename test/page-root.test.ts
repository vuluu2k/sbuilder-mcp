import { describe, it, expect, vi } from 'vitest';
import { STORE_PAGE_SEEDS, PAGE_LAYOUT_SEEDS } from '../src/catalog/storepages.generated.js';
import { CHECKOUT_PAGE_DOCUMENT } from '../src/catalog/checkout.generated.js';
import { APP_SCAFFOLDS } from '../src/catalog/appscaffolds.generated.js';
import { canonicalRoot, remapIds, withFreshIds } from '../src/domains/site/ids.js';
import { withPageRoot } from '../src/transport/http.js';
import { tokensFromPage } from '../src/domains/site/importmap.js';
import { PageSession } from '../src/tools/page.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import { connectedClient } from './harness.js';

type Doc = { root_node_id: string; nodes: Record<string, any> };

/** Every id-valued reference in a document points at a node that exists. */
function danglingRefs(doc: Doc): string[] {
  const out: string[] = [];
  for (const [id, n] of Object.entries(doc.nodes)) {
    if (n.id !== id) out.push(`${id}.id=${n.id}`);
    if (n.data?.parent != null && !doc.nodes[n.data.parent]) out.push(`${id}.parent=${n.data.parent}`);
    for (const c of n.data?.nodes ?? []) if (!doc.nodes[c]) out.push(`${id}.child=${c}`);
    for (const [k, v] of Object.entries(n.config ?? {})) {
      if (/(State|Item|Label|Option|Button|Input)Id$/.test(k) && typeof v === 'string' && v && !doc.nodes[v]) {
        out.push(`${id}.config.${k}=${v}`);
      }
    }
  }
  return out;
}

const PAGE_SEEDS: Array<[string, Doc]> = [
  ...Object.entries(STORE_PAGE_SEEDS).map(([k, d]) => [`store ${k}`, d as Doc] as [string, Doc]),
  ...Object.entries(PAGE_LAYOUT_SEEDS).map(([k, d]) => [`layout ${k}`, d as Doc] as [string, Doc]),
  ['checkout page', CHECKOUT_PAGE_DOCUMENT as unknown as Doc],
  ...APP_SCAFFOLDS.courses.map((p) => [`courses ${p.slug || p.type}`, p.document as Doc] as [string, Doc]),
];

describe('a page seed roots at ROOT', () => {
  it.each(PAGE_SEEDS)('%s', (_name, doc) => {
    expect(doc.root_node_id).toBe('ROOT');
    expect(doc.nodes.ROOT?.data?.type).toBe('root');
    expect(danglingRefs(doc)).toEqual([]);
  });
});

describe('remapIds is structural', () => {
  it('leaves text that quotes an id alone', () => {
    const doc = {
      root_node_id: 'ROOT',
      nodes: {
        ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['he_1'] } },
        he_1: { id: 'he_1', data: { type: 'heading', parent: 'ROOT', nodes: [] }, specials: { text: 'see he_1 and #he_1', href: '/he_1' } },
      },
    };
    const out = remapIds(doc, (id) => (id === 'ROOT' ? id : 'x_9'));
    expect(out.nodes.x_9.specials).toEqual({ text: 'see he_1 and #he_1', href: '/he_1' });
    expect(out.nodes.ROOT.data.nodes).toEqual(['x_9']);
    expect(out.nodes.x_9.data.parent).toBe('ROOT');
  });
});

describe("sb_store's fresh ids", () => {
  it('keep ROOT and every satellite reference pointing at a real node', () => {
    const src = STORE_PAGE_SEEDS.product as unknown as Doc;
    const out = withFreshIds(src as never) as unknown as Doc;
    expect(out.root_node_id).toBe('ROOT');
    expect(Object.keys(out.nodes).length).toBe(Object.keys(src.nodes).length);
    expect(Object.keys(out.nodes).filter((id) => src.nodes[id])).toEqual(['ROOT']);
    expect(danglingRefs(out)).toEqual([]);
    expect(JSON.stringify(out)).toContain('"emptyStateId"');
  });
});

/** A seed as the old codegen shipped it: root renamed `sppro_1`. */
function mintedProductPage(): Doc {
  return remapIds(STORE_PAGE_SEEDS.product as unknown as Doc, (id) => (id === 'ROOT' ? 'sppro_1' : id));
}

describe('canonicalRoot — the repair', () => {
  it('renames sppro_1 to ROOT with the same nodes in the same order', () => {
    const minted = mintedProductPage();
    const fixed = canonicalRoot(minted)!;
    expect(fixed.root_node_id).toBe('ROOT');
    expect(Object.keys(fixed.nodes).length).toBe(Object.keys(minted.nodes).length);
    expect(fixed.nodes.ROOT.data.nodes).toEqual(minted.nodes.sppro_1.data.nodes);
    expect(danglingRefs(fixed)).toEqual([]);
  });

  it('leaves a ROOT page, and a page where ROOT is taken, alone', () => {
    expect(canonicalRoot(STORE_PAGE_SEEDS.product as unknown as Doc)).toBeNull();
    const clash = { root_node_id: 'rt_1', nodes: { rt_1: { id: 'rt_1', data: { nodes: [] } }, ROOT: { id: 'ROOT' } } };
    expect(canonicalRoot(clash)).toBeNull();
  });

  it('is applied to every page write that leaves the process', () => {
    const body = { document: mintedProductPage(), schemaVersion: 2 };
    for (const [method, path] of [
      ['PUT', '/api/sites/s/pages/p/source'],
      ['POST', '/api/sites/s/pages'],
    ]) {
      const out = withPageRoot({ method, path, body }) as { document: Doc };
      expect(out.document.root_node_id, path).toBe('ROOT');
    }
    // A section template or an overlay roots at its own element — untouched.
    expect(withPageRoot({ method: 'POST', path: '/api/sites/s/overlays', body })).toBe(body);
  });
});

function ctxOver(f: typeof fetch) {
  const s = new Session('http://x', f);
  (s as unknown as { access: string }).access = 'jwt';
  return { base: 'http://x', session: s, fetchImpl: f, notices: new Notices(), undo: new UndoLog() };
}

/** A two-page site: one minted, one ROOT. Records every PUT. */
function site() {
  const puts: Array<{ path: string; body: any }> = [];
  const docs: Record<string, Doc> = { pg_a: mintedProductPage(), pg_b: STORE_PAGE_SEEDS.category as unknown as Doc };
  const f = vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (init?.method === 'PUT') puts.push({ path, body: JSON.parse(String(init.body)) });
    const body = path.endsWith('/pages')
      ? { pages: [{ id: 'pg_a', name: 'Product', type: 'product', publishedAt: 'x' }, { id: 'pg_b', name: 'Cat', type: 'category' }] }
      : { source: { document: docs[path.split('/')[5]] } };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, puts };
}

describe('sb_page_repair', () => {
  it('lists only the minted page on a dry run, then fixes its draft and asks for a re-publish', async () => {
    const { f, puts } = site();
    const { client, close } = await connectedClient(ctxOver(f));
    const dry = JSON.parse(((await client.callTool({ name: 'sb_page_repair', arguments: { site_id: 's1' } })).content as any)[0].text);
    expect(dry.would_repair.map((p: any) => [p.id, p.root])).toEqual([['pg_a', 'sppro_1']]);
    expect(puts).toEqual([]);

    const run = JSON.parse(((await client.callTool({ name: 'sb_page_repair', arguments: { site_id: 's1', dry_run: false } })).content as any)[0].text);
    expect(run.repaired).toEqual(['pg_a']);
    expect(run.republish.pages).toEqual(['pg_a']);
    expect(puts.map((p) => p.path)).toEqual(['/api/sites/s1/pages/pg_a/source']);
    expect(puts[0].body.document.root_node_id).toBe('ROOT');
    await close();
  });

  it('sb_page_state reports a minted root instead of calling the canvas fine', async () => {
    const { f } = site();
    const { client, close } = await connectedClient(ctxOver(f));
    const out = JSON.parse(((await client.callTool({ name: 'sb_page_state', arguments: { site_id: 's1', page_id: 'pg_a' } })).content as any)[0].text);
    expect(out.canvas.minted_root).toBe('sppro_1');
    expect(out.canvas.warning).toMatch(/sb_page_repair/);
    await close();
  });

  it('sb_page_open flags a minted root', async () => {
    const { f } = site();
    const { client, close } = await connectedClient(ctxOver(f));
    const out = JSON.parse(((await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_a' } })).content as any)[0].text);
    expect(out.minted_root).toMatch(/7322af49a/);
    await close();
  });
});

describe('a stale session rebases once', () => {
  const base = () => STORE_PAGE_SEEDS.category as unknown as Doc;
  function serverWith(doc: () => Doc) {
    const f = vi.fn(async (_u: unknown, _init?: RequestInit) =>
      new Response(JSON.stringify({ source: { document: doc() } }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ) as unknown as typeof fetch;
    return f;
  }
  const edit = (id: string) => [{ op: 'set' as const, path: ['nodes', id, 'style', 'gap'], value: '9px' }];

  it('reapplies when the other side changed a different node', async () => {
    let doc = base();
    const ps = new PageSession(ctxOver(serverWith(() => doc)));
    await ps.open('s1', 'pg');
    const [a, b] = Object.keys(doc.nodes).filter((id) => id !== 'ROOT');
    doc = structuredClone(doc);
    doc.nodes[b].style = { ...doc.nodes[b].style, color: 'red' };
    ps.markStale('gap in seq');
    await ps.applyAndSave(edit(a));
    expect((ps.current().doc.nodes[a] as any).style.gap).toBe('9px');
    expect((ps.current().doc.nodes[b] as any).style.color).toBe('red');
  });

  it('refuses when the other side changed the node this edit touches', async () => {
    let doc = base();
    const ps = new PageSession(ctxOver(serverWith(() => doc)));
    await ps.open('s1', 'pg');
    const a = Object.keys(doc.nodes).find((id) => id !== 'ROOT')!;
    doc = structuredClone(doc);
    doc.nodes[a].style = { ...doc.nodes[a].style, color: 'red' };
    ps.markStale('gap in seq');
    await expect(ps.applyAndSave(edit(a))).rejects.toThrow(new RegExp(`edited ${a}`));
  });
});

describe('tokensFromPage', () => {
  it('reads the page, not its shared header', () => {
    const doc = {
      root_node_id: 'ROOT',
      nodes: {
        ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['hd', 'sec'] } },
        hd: { id: 'hd', data: { type: 'flex-section', parent: 'ROOT', nodes: ['h1'] }, specials: { globalId: 'g1', globalKind: 'header' }, style: { padding: '0' } },
        h1: { id: 'h1', data: { type: 'heading', parent: 'hd', nodes: [] }, style: { color: '#fff' } },
        sec: { id: 'sec', data: { type: 'flex-section', parent: 'ROOT', nodes: ['h2'] }, style: { padding: '64px 24px' } },
        h2: { id: 'h2', data: { type: 'heading', parent: 'sec', nodes: [] }, style: { color: '#222' } },
      },
    };
    const t = tokensFromPage(doc as never);
    expect(t.headingColor).toBe('#222');
    expect(t.sectionPadding).toBe('64px 24px');
  });
});
