import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

/**
 * THE NOTE HAS TO CROSS THE WIRE, not merely exist.
 *
 * `preconditionNotes` is covered by its own unit test, and that proves the
 * sentence is right — it proves nothing about whether `sb_set` ever calls it.
 * Every other note in this repo was in the same position: the vocabulary tests
 * call the pure function, and the wiring inside `registerPageTools` had no test
 * at all, so a call deleted from the handler would have left every one of them
 * green.
 *
 * This drives the REAL tool over the REAL transport and reads the bytes a
 * client receives, which is the only place the wiring exists.
 */
function stub(doc: Record<string, unknown>) {
  const calls: { method: string; path: string; body?: Record<string, unknown> }[] = [];
  const f = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path, body });
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/source')) {
      return json({
        source: { pageId: 'pg_1', siteId: 's1', document: doc, schemaVersion: 2, updatedAt: 'now' },
      });
    }
    if (path.includes('/pages')) return json({ page: { id: 'pg_1', name: 'Danh mục' } });
    return json({});
  }) as unknown as typeof fetch;
  return { f, calls };
}

/** A collection page carrying one category filter, as an agent would find it. */
const docWith = (specials: Record<string, unknown>) => ({
  schema_version: 2,
  root_node_id: 'ROOT',
  nodes: {
    ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['flt'], isCanvas: true } },
    flt: { id: 'flt', data: { type: 'filter-checkbox', parent: 'ROOT', nodes: [] }, specials },
  },
});

async function set(doc: Record<string, unknown>, keys: Record<string, unknown>) {
  const { f } = stub(doc);
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  const { client, close } = await connectedClient({
    base: 'http://x',
    session,
    fetchImpl: f,
    notices: new Notices(),
    undo: new UndoLog(),
    siteId: 's1',
  });
  try {
    const opened = (await client.callTool({
      name: 'sb_page_open',
      arguments: { site_id: 's1', page_id: 'pg_1' },
    })) as { content: Array<{ text: string }> };
    // THE PRECONDITION OF EVERY ASSERTION BELOW. Two "does not warn" cases in
    // the first draft of this file passed while the server was answering "no
    // page is open" — true, and true for a reason that had nothing to do with
    // the note. A negative assertion needs its fixture proven live.
    expect(opened.content.map((c) => c.text).join(''), 'the page must actually open').not.toMatch(
      /no page is open/i,
    );
    const res = (await client.callTool({
      name: 'sb_set',
      arguments: { id: 'flt', namespace: 'specials', keys },
    })) as { content: Array<{ text: string }> };
    const text = res.content.map((c) => c.text).join('\n');
    // ANY `sbuilder:` prefix is the server refusing, and a refusal makes every
    // "does not warn" assertion below true for a reason that has nothing to do
    // with the note. Two of them passed that way in this file's first draft.
    expect(text, text).not.toMatch(/^sbuilder:/);
    return text;
  } finally {
    await close();
  }
}

describe('sb_set tells a caller when a combination does nothing', () => {
  it('warns on the pair that publishes an empty filter', async () => {
    // Each value is legal, so nothing else in this catalog says a word — which
    // is what the note exists for. Measured before it existed: silence.
    const out = await set(docWith({ filterSource: 'blog_category' }), { filterValueMode: 'auto' });
    expect(out).toContain('filterValueMode');
    expect(out).toContain('filterSource');
    expect(out).toContain('renders nothing');
  });

  it('reads the node AS IT WILL BE, so a write that FIXES the pair is quiet', async () => {
    // The stored node is broken; the write repairs it. Asking about the write
    // alone would warn about a node that is about to be correct, and asking
    // about the stored node alone would warn forever.
    const out = await set(docWith({ filterSource: 'blog_category', filterValueMode: 'auto' }), {
      filterSource: 'category',
    });
    expect(out).not.toContain('does nothing on this node');
  });

  it('warns when the write BREAKS a node that was holding together', async () => {
    // The mirror of the case above, and the one a per-key check cannot see at
    // all: the value being written is legal, and it invalidates a NEIGHBOUR
    // that was already stored.
    const out = await set(docWith({ filterSource: 'category', filterValueMode: 'auto' }), {
      filterSource: 'brand',
    });
    expect(out).toContain('filterValueMode');
    expect(out).toContain('brand');
  });

  it('says nothing about a node that holds together', async () => {
    // THE LIVENESS ANCHOR. A handler that appended the note unconditionally
    // would satisfy every assertion above, and a caller warned about correct
    // work stops reading the warnings.
    const out = await set(docWith({ filterSource: 'category' }), { filterValueMode: 'auto' });
    expect(out).not.toContain('does nothing on this node');
  });
});
