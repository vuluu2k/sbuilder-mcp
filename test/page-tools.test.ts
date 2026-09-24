import { describe, it, expect, vi } from 'vitest';
import { PageSession, reviewField } from '../src/tools/page.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import { PageDoc } from '../src/domains/site/document.js';
import { connectedClient } from './harness.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { SPEC_APP_BLOCK_ID } from '../src/core/tree.js';

const emptyDocument = {
  schema_version: 2,
  root_node_id: 'rt',
  nodes: {
    rt: { id: 'rt', data: { type: 'root', parent: null, nodes: [], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
  },
};

function scripted() {
  const saved: Array<Record<string, unknown>> = [];
  const f = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT' && String(_url).includes('/source')) saved.push(JSON.parse(String(init.body)));
    return new Response(
      JSON.stringify({
        source: { pageId: 'pg_1', siteId: 's1', document: emptyDocument, schemaVersion: 2, updatedAt: 'now' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { f, saved };
}

function ctxWith(f: typeof fetch) {
  const s = new Session('http://x', f);
  (s as unknown as { access: string }).access = 'jwt';
  return { base: 'http://x', session: s, fetchImpl: f, notices: new Notices(), undo: new UndoLog() };
}

describe('PageSession', () => {
  it('opens a page and returns its outline', async () => {
    const { f } = scripted();
    const ps = new PageSession(ctxWith(f));
    expect(await ps.open('s1', 'pg_1')).toEqual([]);
    expect(ps.current().doc.root_node_id).toBe('rt');
  });

  it('refuses a write before a page is open, naming the tool to call', () => {
    const { f } = scripted();
    expect(() => new PageSession(ctxWith(f)).current()).toThrow(/sb_page_open/);
  });

  it('saves the edited document', async () => {
    const { f, saved } = scripted();
    const ps = new PageSession(ctxWith(f));
    await ps.open('s1', 'pg_1');
    // EDITED, as the name says. An unedited document is deliberately not written
    // any more — see test/save-skip.test.ts for why a no-op PUT is not free.
    ps.current().apply([{ op: 'set', path: ['nodes', 'rt', 'specials', 'touched'], value: 1 }]);
    await ps.save();
    expect(saved.length).toBe(1);
    expect((saved[0].document as Record<string, unknown>).root_node_id).toBe('rt');
  });

  it('refuses to save a document the platform would reject, before sending it', async () => {
    const { f, saved } = scripted();
    const ps = new PageSession(ctxWith(f));
    await ps.open('s1', 'pg_1');
    ps.current().apply([
      {
        op: 'set',
        path: ['nodes', 'ghost'],
        value: { id: 'ghost', data: { type: 'text', parent: null, nodes: [], isCanvas: false, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
      },
    ]);
    await expect(ps.save()).rejects.toThrow(/attached to nothing/i);
    expect(saved.length).toBe(0);
  });
});

describe('reviewField()', () => {
  it('says the notice once and sends fixes as a legend', () => {
    const ctx = { ...ctxWith(scripted().f), notices: new Notices(), undo: new UndoLog() };
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const first = reviewField(ctx, d) as {
      findings: Array<Record<string, unknown>>;
      fixes: Record<string, string>;
      findings_notice?: string;
    };
    expect(first.findings_notice).toMatch(/FIX THESE/);
    expect('fix' in first.findings[0]).toBe(false);
    expect(first.fixes.empty_page).toMatch(/sb_add/);
    expect((reviewField(ctx, d) as { findings_notice?: string }).findings_notice).toBeUndefined();
  });
});

describe('sb_publish', () => {
  it('posts the site-level publish route naming the one page, not a page route', async () => {
    const { client, close } = await connectedClient();
    const dry = (await client.callTool({
      name: 'sb_publish',
      arguments: { site_id: 's1', page_id: 'pg_1' },
    })) as { content: Array<{ text: string }> };
    const body = JSON.parse(dry.content[0].text) as {
      would_post: string;
      body: { pageIds: string[] };
    };
    // The platform mounts "publish" beside "pages" and 404s a page-level route.
    expect(body.would_post).toBe('/api/sites/s1/publish');
    expect(body.body.pageIds).toEqual(['pg_1']);
    await close();
  });
});

describe('sb_page_create', () => {
  it('sends the page TYPE, which is what routes /checkout and /products', async () => {
    const { client, close } = await connectedClient();
    const dry = (await client.callTool({
      name: 'sb_page_create',
      arguments: { site_id: 's1', name: 'Thanh toán', type: 'checkout', slug: 'thanh-toan' },
    })) as { content: Array<{ text: string }> };
    const body = JSON.parse(dry.content[0].text) as { body: Record<string, unknown> };
    expect(body.body).toMatchObject({ name: 'Thanh toán', type: 'checkout', slug: 'thanh-toan' });
    await close();
  });
});

/** A fetch that answers one scripted JSON body for every request. */
function answering(body: unknown, status = 200) {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

async function callTool(f: typeof fetch, name: string, args: Record<string, unknown>) {
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  const { client, close } = await connectedClient({ fetchImpl: f, session });
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text?: string }>;
  };
  await close();
  return res.content.map((c) => c.text ?? '').join('');
}

describe('the signals the platform sends that used to be dropped', () => {
  it('reports a publish that silently skipped the page', async () => {
    // service.go:650 — `continue // nothing to publish yet` for a page with no
    // saved draft, and the call still answers 200 with whatever DID publish.
    const f = answering({ published: [{ pageId: 'other', slug: 'x' }], total: 1 });
    const out = await callTool(f, 'sb_publish', { site_id: 's1', page_id: 'pg_1', dry_run: false });
    expect(out).toMatch(/not_published|no saved draft/i);
  });

  it('says nothing extra when the page did publish', async () => {
    const f = answering({ published: [{ pageId: 'pg_1', slug: 'home' }], total: 1 });
    const out = await callTool(f, 'sb_publish', { site_id: 's1', page_id: 'pg_1', dry_run: false });
    expect(out).not.toMatch(/not_published|no saved draft/i);
  });

  it('never returns the published HTML and CSS', async () => {
    // PublishedPage carries Document, HTML and CSS. Returned raw, one publish
    // pours an entire rendered page — and every cascaded page — into the reader.
    const f = answering({
      published: [{ pageId: 'pg_1', slug: 'home', html: '<h1>x</h1>'.repeat(500), css: 'a{}'.repeat(500), document: { nodes: {} } }],
      total: 1,
    });
    const out = await callTool(f, 'sb_publish', { site_id: 's1', page_id: 'pg_1', dry_run: false });
    expect(out).not.toContain('<h1>x</h1>');
    expect(out.length).toBeLessThan(2_000);
    expect(out).toContain('pg_1');
  });

  it('reports a slug the platform renamed out from under the caller', async () => {
    // uniqueSlug suffixes -1/-2 and "never errors" (service.go:877), so the
    // create returns 200 carrying a different slug than the one asked for and
    // every link authored to the requested one is dead.
    const f = answering({ page: { id: 'pg_9', name: 'Shop', slug: 'shop-1' } });
    const out = await callTool(f, 'sb_page_create', {
      site_id: 's1',
      name: 'Shop',
      slug: 'shop',
      dry_run: false,
    });
    // Not just "the response mentions shop-1" — the raw echo already did that,
    // and an agent reading it would not know its own slug had been taken.
    expect(out).toContain('slug_renamed');
    expect(out).toContain('shop');
  });

  it('surfaces a compose warning that came with the page', async () => {
    // compose.go:118 deletes the reference node outright, so the page opens with
    // the section already gone and the next save stores that loss for good.
    const f = answering({
      source: {
        pageId: 'pg_1',
        siteId: 's1',
        document: emptyDocument,
        schemaVersion: 2,
        updatedAt: 'now',
        warnings: [{ code: 'globalMissing', globalId: 'gs_7', name: 'Site header' }],
      },
    });
    const out = await callTool(f, 'sb_page_open', { site_id: 's1', page_id: 'pg_1' });
    expect(out).toContain('globalMissing');
    expect(out).toContain('gs_7');
  });
})

// A REFUSED SAVE MUST LEAVE NOTHING BEHIND.
//
// Found from the outside, driving the real server: three `sb_add` calls in a
// row, each answering with the SAME complaint about a node id the caller had
// never seen, while the page quietly collected three copies of the element.
// Reading it back showed why — the add had applied locally and only the SAVE
// was refused, so the offending node stayed in the draft and poisoned every
// later operation. From the caller's side it reads as "my command did nothing",
// which is the one message that is both false and untestable.
function docWithFooter() {
  const node = (id: string, specials: Record<string, unknown> = {}) => ({
    id,
    data: { type: 'flex-section', parent: 'rt', nodes: [], isCanvas: false, hidden: false, custom: {} },
    style: {},
    config: {},
    specials,
    responsive: {},
    events: [],
    bindings: [],
  });
  return {
    schema_version: 2,
    root_node_id: 'rt',
    nodes: {
      rt: {
        id: 'rt',
        data: { type: 'root', parent: null, nodes: ['mid', 'foot'], isCanvas: true, hidden: false, custom: {} },
        style: {},
        config: {},
        specials: {},
        responsive: {},
        events: [],
        bindings: [],
      },
      mid: node('mid'),
      foot: node('foot', { globalId: 'g_foot', globalKind: 'footer' }),
    },
  };
}

function servingFooterDoc() {
  const saved: Array<Record<string, unknown>> = [];
  const f = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT' && String(_url).includes('/source')) saved.push(JSON.parse(String(init.body)));
    return new Response(
      JSON.stringify({
        source: { pageId: 'pg_1', siteId: 's1', document: docWithFooter(), schemaVersion: 2, updatedAt: 'now' },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { f, saved };
}

/** The patch an `sb_add` at the end of ROOT produces — content after a footer. */
const addAfterFooter = (id: string) => [
  {
    op: 'set' as const,
    path: ['nodes', id],
    value: {
      id,
      data: { type: 'chat-widget', parent: 'rt', nodes: [], isCanvas: false, hidden: false, custom: {} },
      style: {},
      config: {},
      specials: {},
      responsive: {},
      events: [],
      bindings: [],
    },
  },
  { op: 'set' as const, path: ['nodes', 'rt', 'data', 'nodes'], value: ['mid', 'foot', id] },
];

describe('a refused write', () => {
  it('leaves the draft exactly as it found it', async () => {
    const { f, saved } = servingFooterDoc();
    const ps = new PageSession(ctxWith(f));
    await ps.open('s1', 'pg_1');

    await expect(ps.applyAndSave(addAfterFooter('ch_1'))).rejects.toThrow(/after a global footer/i);
    expect(saved.length).toBe(0);
    // THE POINT. Not "the save was refused" — that already worked — but that the
    // node is gone, so the next command is judged on its own merits.
    expect(ps.current().has('ch_1')).toBe(false);
    expect(ps.current().node('rt').data.nodes).toEqual(['mid', 'foot']);
  });

  it('does not blame the next command for the last one', async () => {
    const { f, saved } = servingFooterDoc();
    const ps = new PageSession(ctxWith(f));
    await ps.open('s1', 'pg_1');

    await expect(ps.applyAndSave(addAfterFooter('ch_1'))).rejects.toThrow();
    // The same element, placed correctly this time — before the footer.
    await ps.applyAndSave([
      {
        op: 'set',
        path: ['nodes', 'ch_2'],
        value: {
          id: 'ch_2',
          data: { type: 'chat-widget', parent: 'rt', nodes: [], isCanvas: false, hidden: false, custom: {} },
          style: {},
          config: {},
          specials: {},
          responsive: {},
          events: [],
          bindings: [],
        },
      },
      { op: 'set', path: ['nodes', 'rt', 'data', 'nodes'], value: ['mid', 'ch_2', 'foot'] },
    ]);
    expect(saved.length).toBe(1);
    expect(ps.current().has('ch_2')).toBe(true);
    expect(ps.current().has('ch_1')).toBe(false);
  });

  // A PAGE THAT ARRIVED BROKEN IS NOT THE CALLER'S FAULT, and must not become a
  // page nobody can edit. The pre-check refuses only what THIS write introduces
  // — but a write that leaves the page still unstorable is refused BEFORE it is
  // applied, so nothing waits in the draft for the next save to commit.
  //
  // THIS TEST USED TO ASSERT THE OPPOSITE OF ITS LAST LINE, and that assertion
  // was the defect: it pinned "its own edit survived" after a refused save, and
  // a surviving edit is exactly what the next successful save writes out. It
  // cost five nodes on a live page — four that a command asked for and one
  // whose removal had been refused an instant earlier.
  it('refuses an unrepairing write BEFORE applying it, and names what it inherited', async () => {
    const { f } = servingFooterDoc();
    const ps = new PageSession(ctxWith(f));
    await ps.open('s1', 'pg_1');
    // Pre-existing damage: content after the footer, already in the document.
    ps.current().apply(addAfterFooter('inherited'));

    await expect(
      ps.applyAndSave([{ op: 'set', path: ['nodes', 'mid', 'specials', 'touched'], value: 1 }]),
    ).rejects.toThrow(/after a global footer/i);
    // NOTHING WAS APPLIED. The message says so, and the document proves it.
    expect(ps.current().node('mid').specials.touched).toBeUndefined();
  });

  // The other half of the same rule: the page stays EDITABLE, so the one write
  // that repairs it goes through rather than being refused for the damage it is
  // about to clear.
  it('lets a write that REPAIRS the inherited damage through', async () => {
    const { f } = servingFooterDoc();
    const ps = new PageSession(ctxWith(f));
    await ps.open('s1', 'pg_1');
    const added = addAfterFooter('inherited');
    ps.current().apply(added);
    const root = ps.current().doc.root_node_id;
    const kids = [...ps.current().node(root).data.nodes];
    // Take the offending child back out — the repair, and the write that must
    // not be refused for the problem it removes.
    await expect(
      ps.applyAndSave([
        { op: 'remove', path: ['nodes', root, 'data', 'nodes'], index: kids.length - 1 },
      ]),
    ).resolves.toBeUndefined();
  });
});

/**
 * WHAT A NESTED `sb_add` ACTUALLY STORES.
 *
 * Driven end to end and asserted on the BODY THAT GOES TO THE PLATFORM, because
 * that is the only place the defect was visible: the tool answered success, the
 * local tree was well formed, every id resolved, and the document on the wire
 * listed each child twice. `applyAndSave` applies its batch twice by design —
 * once through `preview` to judge the write, once for real — so any patch that
 * aliases a live object compounds, and nothing else in this suite applies a
 * batch more than once.
 */
describe('a nested add stores each child exactly once', () => {
  function serving(saved: Array<Record<string, unknown>>) {
    return (async (input: string | URL, init?: RequestInit) => {
      const u = String(input);
      if (init?.method === 'PUT' && u.includes('/source')) {
        saved.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        stored = (saved.at(-1) as { document?: unknown }).document;
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (u.includes('/source')) {
        return new Response(
          JSON.stringify({ source: { document: { schema_version: 2, root_node_id: '', nodes: {} } } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
  }

  it('sends a document whose child lists hold no id twice', async () => {
    const saved: Array<Record<string, unknown>> = [];
    const f = serving(saved);
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({ fetchImpl: f, session });

    await client.callTool({
      name: 'sb_page_open',
      arguments: { site_id: 's1', page_id: 'pg_1' },
    });
    await client.callTool({
      name: 'sb_add',
      arguments: {
        parent_id: 'ROOT',
        dry_run: false,
        spec: {
          type: 'flex-section',
          children: [
            { type: 'flex-block', children: [{ type: 'heading' }, { type: 'text' }] },
            { type: 'flex-block', children: [{ type: 'button' }] },
          ],
        },
      },
    });

    expect(saved.length).toBe(1);
    const doc = (saved[0] as { document: { nodes: Record<string, { data?: { nodes?: string[] } }> } })
      .document;
    const offenders = Object.entries(doc.nodes)
      .map(([id, n]) => [id, n.data?.nodes ?? []] as const)
      .filter(([, kids]) => kids.length !== new Set(kids).size);
    expect(offenders).toEqual([]);
    // And the shape is the one that was asked for, not merely duplicate-free.
    const root = doc.nodes.ROOT.data!.nodes!;
    expect(root.length).toBe(1);
    expect(doc.nodes[root[0]].data!.nodes!.length).toBe(2);
    await close();
  });
});

/**
 * A PAGE AN AGENT CREATES IS PART OF THE SITE, or it is a stray.
 *
 * A page created through the editor carries the site's header and footer; one
 * created here carried NEITHER — so an agent building a site produced pages with
 * no navigation and no footer on a site that has both, and nothing reported it:
 * `sb_review` reads the page and the page is fine, while `siteChrome` asks
 * whether the SITE has globals and it does. Measured on a live store — three
 * pages built with these tools, every one bare, beside a store page carrying its
 * header as ROOT's first child.
 */
describe('a created page wears the site chrome', () => {
  const homeDoc = {
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: {
      ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['h', 'mid', 'f'] }, specials: {} },
      h: { id: 'h', data: { type: 'flex-section', parent: 'ROOT', nodes: [] }, specials: { globalId: 'gs_head', globalKind: 'header' } },
      mid: { id: 'mid', data: { type: 'flex-section', parent: 'ROOT', nodes: [] }, specials: {} },
      f: { id: 'f', data: { type: 'flex-section', parent: 'ROOT', nodes: [] }, specials: { globalId: 'gs_foot', globalKind: 'footer' } },
    },
  };

  function siteServing(saved: Array<Record<string, unknown>>, homepage = true) {
    let stored: unknown;
    return (async (input: string | URL, init?: RequestInit) => {
      const u = String(input);
      const json = (b: unknown, status = 200) =>
        new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
      if (init?.method === 'PUT' && u.includes('/source')) {
        saved.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        // The envelope the save reads back: it re-stamps each shared master's
        // new revision from it, and a bare {} is not a shape the platform ever
        // sends.
        return json({ source: { globals: [], overlays: [] } });
      }
      if (init?.method === 'POST' && u.endsWith('/pages')) return json({ page: { id: 'pg_new', slug: 'x' } });
      if (u.endsWith('/pages')) {
        return json({ pages: [{ id: 'pg_home', slug: '', isHomepage: homepage }] });
      }
      if (u.includes('/pages/pg_home/source')) return json({ source: { document: homeDoc } });
      if (u.includes('/source')) {
        // A REAL SERVER HANDS BACK WHAT IT WAS GIVEN. The page starts empty
        // and then holds whatever the last PUT stored — without which this
        // fake claims every page is empty forever, and a second read (which
        // the chrome attach now makes, to let the platform record the global
        // edge) would look like a page that had been erased.
        return json({
          source: { document: stored ?? { schema_version: 2, root_node_id: '', nodes: {} } },
        });
      }
      return json({});
    }) as unknown as typeof fetch;
  }

  async function create(f: typeof fetch, args: Record<string, unknown> = {}) {
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({ fetchImpl: f, session });
    const res = (await client.callTool({
      name: 'sb_page_create',
      arguments: { site_id: 's1', name: 'Liên hệ', dry_run: false, ...args },
    })) as { content: Array<{ text?: string }> };
    await close();
    return JSON.parse(res.content[0].text!);
  }

  it('carries the HOME PAGE\'s header and footer, first and last', async () => {
    // A site can hold several globals of each kind — the live one holds four
    // headers — so "the first header" is a guess and a name is a label nobody
    // promised to keep. The home page is the site's own answer.
    const saved: Array<Record<string, unknown>> = [];
    const out = await create(siteServing(saved));
    expect(out.chrome.carries).toEqual(['header', 'footer']);

    const doc = (saved.at(-1) as { document: { root_node_id: string; nodes: Record<string, { specials?: Record<string, unknown> }> } }).document;
    const kids = (doc.nodes[doc.root_node_id] as unknown as { data: { nodes: string[] } }).data.nodes;
    // Header FIRST and footer LAST, because compose turns them into real bands
    // and ROOT's children must read header, middle, footer or every save is
    // refused.
    expect(doc.nodes[kids[0]].specials).toMatchObject({ globalRef: 'gs_head', globalKind: 'header' });
    expect(doc.nodes[kids[kids.length - 1]].specials).toMatchObject({ globalRef: 'gs_foot', globalKind: 'footer' });
    // The REFERENCE key, never the composed stamp — authoring globalId makes the
    // next save decompose the node over the master and empty it for every page.
    for (const k of kids) expect(doc.nodes[k].specials?.globalId).toBeUndefined();
  });

  it('is silent when the site has no home page to read it off', async () => {
    const out = await create(siteServing([], false));
    expect(out.chrome).toBeUndefined();
  });

  it('takes no for an answer', async () => {
    const out = await create(siteServing([]), { chrome: false });
    expect(out.chrome).toBeUndefined();
  });
});

/**
 * `sb_remove`'s dry run counts NODES, and it used to count PATCHES.
 *
 * The field is called `removing` on a tool described as "Remove a node and its
 * whole subtree", so every caller reads it as a node count — and
 * `patches.length` is off by one in the ORDINARY case and exact in the rare
 * one, which is the worst arrangement available. `removeNode` emits one `unset`
 * per doomed node PLUS one `remove` that takes the id out of its parent's child
 * list, and that second patch exists only while the parent is still in the
 * document.
 *
 * Both numbers were believed in this repo's own work: a childless section under
 * ROOT reported 2, which was read as evidence of a hidden node attached by
 * `parent` alone, and a page-source dump then proved no such node existed.
 */
describe('removeNode: what the dry run is counting', () => {
  const nodeCount = (patches: Array<{ op: string; path: string[] }>) =>
    patches.filter((p) => p.op === 'unset' && p.path.length === 2).length;

  const doc = (nodes: Record<string, unknown>) =>
    PageDoc.from({ schema_version: 2, root_node_id: 'rt', nodes } as never);

  const node = (id: string, parent: string | null, kids: string[] = [], type = 'flex-section') => ({
    id,
    data: { type, parent, nodes: kids, isCanvas: true, hidden: false, custom: {} },
    style: {},
    config: {},
    specials: {},
    responsive: {},
    events: [],
    bindings: [],
  });

  it('a childless section whose parent lists it is ONE node and TWO patches', async () => {
    const { removeNode } = await import('../src/domains/site/builder.js');
    const d = doc({
      rt: node('rt', null, ['fs_1'], 'root'),
      fs_1: node('fs_1', 'rt'),
    });
    const patches = removeNode(d, 'fs_1') as Array<{ op: string; path: string[] }>;
    expect(patches.length).toBe(2);
    expect(nodeCount(patches)).toBe(1);
  });

  it('is exact when the parent is GONE — the case that made the old count look right', async () => {
    // The satellite shape: a node attached by `parent` alone to an owner that
    // has already been deleted. No child list to edit, so patches == nodes and
    // the old reading happened to agree.
    const { removeNode } = await import('../src/domains/site/builder.js');
    const d = doc({
      rt: node('rt', null, [], 'root'),
      li_1: node('li_1', 'da_gone', ['tx_1'], 'list-empty'),
      tx_1: node('tx_1', 'li_1', [], 'text'),
    });
    const patches = removeNode(d, 'li_1') as Array<{ op: string; path: string[] }>;
    expect(patches.length).toBe(2);
    expect(nodeCount(patches)).toBe(2);
  });

  it('counts the whole subtree, not just the node named', async () => {
    const { removeNode } = await import('../src/domains/site/builder.js');
    const d = doc({
      rt: node('rt', null, ['fs_1'], 'root'),
      fs_1: node('fs_1', 'rt', ['tx_1', 'tx_2']),
      tx_1: node('tx_1', 'fs_1', [], 'text'),
      tx_2: node('tx_2', 'fs_1', [], 'text'),
    });
    const patches = removeNode(d, 'fs_1') as Array<{ op: string; path: string[] }>;
    expect(nodeCount(patches)).toBe(3);
    expect(patches.length).toBe(4);
  });
});

/**
 * THE TOOL's own number, because the three tests above cannot see it.
 *
 * They pin `removeNode`'s patch composition, which is real and which the count
 * is derived from — and they stay GREEN if `sb_remove` is put back to reporting
 * `patches.length`. That is the "a test that survives its own fix being
 * deleted" shape this repo keeps closing, so the distinction is asserted where
 * a caller actually meets it: in the dry run's bytes.
 */
describe('sb_remove dry run reports nodes and patches as different numbers', () => {
  it('a childless section under ROOT is removing:1, patches:2', async () => {
    const document = {
      schema_version: 2,
      root_node_id: 'ROOT',
      nodes: {
        ROOT: {
          id: 'ROOT',
          data: { type: 'root', parent: null, nodes: ['fs_1'], isCanvas: true, hidden: false, custom: {} },
          style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [],
        },
        fs_1: {
          id: 'fs_1',
          data: { type: 'flex-section', parent: 'ROOT', nodes: [], isCanvas: true, hidden: false, custom: {} },
          style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [],
        },
      },
    };
    const f = (async () =>
      new Response(
        JSON.stringify({ source: { pageId: 'pg_1', siteId: 's1', document, schemaVersion: 2, updatedAt: 'now' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({ fetchImpl: f, session });
    try {
      await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
      const res = (await client.callTool({
        name: 'sb_remove',
        arguments: { id: 'fs_1' },
      })) as { content: Array<{ text?: string }> };
      const out = JSON.parse(res.content[0].text ?? '{}') as { removing?: number; patches?: number };
      // ONE node goes; TWO patches do it. Reporting the patch count here read as
      // a hidden second node and cost a real investigation on a live page.
      expect(out.removing).toBe(1);
      expect(out.patches).toBe(2);
    } finally {
      await close();
    }
  });
});

function appBlockDocument() {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const first = addSubtree(d, 'ROOT', {
    type: 'flex-section',
    children: [{ type: 'flex-block', children: [{ type: 'heading' }] }],
  });
  d.apply(first.patches);
  // The COMPOSED stamp, applied the way the server applies it — by patch.
  d.apply([{ op: 'set', path: ['nodes', first.ids[1], 'specials', SPEC_APP_BLOCK_ID], value: 'inst_1/hero' }]);
  d.apply(addSubtree(d, 'ROOT', { type: 'flex-section' }).patches);
  return { document: d.doc, ids: { section: first.ids[0], block: first.ids[1], inner: first.ids[2] } };
}

async function openPageWithAppBlock() {
  const { document, ids } = appBlockDocument();
  const f = vi.fn(async () =>
    new Response(
      JSON.stringify({ source: { pageId: 'pg_1', siteId: 's1', document, schemaVersion: 2, updatedAt: 'now' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  ) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  const { client, close } = await connectedClient({ fetchImpl: f, session });
  await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
  // The MCP SDK reports a thrown tool error as `isError` rather than rejecting,
  // so the wrapper rethrows: the tests below say `rejects.toThrow`.
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{ text?: string }>;
    };
    const textOut = res.content.map((c) => c.text ?? '').join('');
    if (res.isError) throw new Error(textOut);
    return JSON.parse(textOut) as Record<string, any>;
  };
  return { call, ids, close };
}

describe('force on the writing tools', () => {
  it('sb_set inside an app block: refused without force, reported with it, in the dry run and the real run', async () => {
    const { call, ids } = await openPageWithAppBlock();
    await expect(call('sb_set', { id: ids.inner, namespace: 'specials', keys: { text: 'x' } })).rejects.toThrow(/force:true/);
    const dry = await call('sb_set', { id: ids.inner, namespace: 'specials', keys: { text: 'x' }, force: true });
    expect(dry.dry_run).toBe(true);
    expect(dry.forced[0]).toMatch(/app block/i);
    const real = await call('sb_set', { id: ids.inner, namespace: 'specials', keys: { text: 'x' }, force: true, dry_run: false });
    expect(real.set).toEqual(['text']);
    expect(real.forced[0]).toMatch(/app block/i);
  });

  it('sb_remove dry run carries forced beside removing and patches', async () => {
    const { call, ids } = await openPageWithAppBlock();
    const dry = await call('sb_remove', { id: ids.inner, force: true });
    expect(dry).toMatchObject({ dry_run: true, removing: 1 });
    expect(dry.forced[0]).toMatch(/app block/i);
  });

  it('a hard guard is unchanged by force at the tool', async () => {
    const { call } = await openPageWithAppBlock();
    await expect(call('sb_remove', { id: 'ROOT', force: true, dry_run: false })).rejects.toThrow(/cannot remove ROOT/);
  });

  it('no forced field when nothing was overridden', async () => {
    const { call, ids } = await openPageWithAppBlock();
    const dry = await call('sb_set', { id: ids.section, namespace: 'style', keys: { color: 'red' }, force: true });
    expect(dry.forced).toBeUndefined();
  });
});
