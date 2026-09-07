import { describe, it, expect, vi } from 'vitest';
import { PageSession, reviewField } from '../src/tools/page.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { PageDoc } from '../src/domains/site/document.js';

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
  return { base: 'http://x', session: s, fetchImpl: f, notices: new Notices() };
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
    await expect(ps.save()).rejects.toThrow(/unreachable/i);
    expect(saved.length).toBe(0);
  });
});

describe('reviewField()', () => {
  it('says the notice once and sends fixes as a legend', () => {
    const ctx = { ...ctxWith(scripted().f), notices: new Notices() };
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
