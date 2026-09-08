import { describe, it, expect, vi } from 'vitest';
import { PageSession, reviewField } from '../src/tools/page.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import { PageDoc } from '../src/domains/site/document.js';
import { connectedClient } from './harness.js';

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
    if (init?.method === 'PUT') saved.push(JSON.parse(String(init.body)));
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
