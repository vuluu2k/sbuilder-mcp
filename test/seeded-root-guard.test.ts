import { describe, it, expect, vi } from 'vitest';
import { PageSession } from '../src/tools/page.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import type { Patch } from '../src/core/patch.js';

/**
 * A READ THAT FAILED OPEN MUST NOT BECOME A WRITE THAT EMPTIES THE PAGE.
 *
 * `PageDoc.from` seeds a ROOT when a page's source comes back
 * `{ root_node_id: "", nodes: {} }`. That is right for a page the caller has
 * just created and catastrophic for a page that has content: the session holds
 * a blank tree it believes is the page, and the first save stores it over
 * whatever the server holds.
 *
 * MEASURED on a live store. `/san-pham`, the product template carrying 24 nodes
 * plus a shared header and footer, came back bare to one session and was stored
 * bare. The PUBLISHED copy was untouched, so all 19 product pages kept rendering
 * while the draft the editor opens was blank — the damage was invisible until a
 * person opened the page, and one publish from that draft would have taken every
 * one of those 19 down at once.
 */

/** The server's own `emptyDocument` for a page that has never been written. */
const EMPTY = { schema_version: 1, root_node_id: '', nodes: {} };

/** A page that HAS content — the state the guard exists to protect. */
const BUILT = {
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

/**
 * A transport whose GET answers change between calls, which is the whole shape
 * of this bug: the open read says empty, the server says otherwise.
 */
function scripted(reads: Array<Record<string, unknown>>) {
  const puts: Array<Record<string, unknown>> = [];
  let get = 0;
  const f = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT' && String(_url).includes('/source')) {
      puts.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({ source: { pageId: 'pg_1', siteId: 's1', document: puts[puts.length - 1]!.document, schemaVersion: 2 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    const doc = reads[Math.min(get++, reads.length - 1)];
    return new Response(
      JSON.stringify({ source: { pageId: 'pg_1', siteId: 's1', document: doc, schemaVersion: 2, updatedAt: 'now' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { f, puts };
}

function ctxWith(f: typeof fetch) {
  const s = new Session('http://x', f);
  (s as unknown as { access: string }).access = 'jwt';
  return { base: 'http://x', session: s, fetchImpl: f, notices: new Notices(), undo: new UndoLog() };
}

/**
 * The one edit every case needs: put a section under ROOT so a save happens.
 * Built through the same `addSubtree` the tools use, so the patches are the
 * shape the real write path produces rather than a hand-rolled approximation.
 */
function addSection(ps: PageSession): Patch[] {
  const doc = ps.current();
  return addSubtree(doc, doc.doc.root_node_id, { type: 'flex-section' }).patches;
}

describe('a seeded ROOT is never written over a page the server still holds', () => {
  it('marks the document as seeded when the source came back empty', () => {
    expect(PageDoc.from(EMPTY).seededRoot).toBe(true);
  });

  it('does not mark a document that was genuinely read', () => {
    expect(PageDoc.from(BUILT).seededRoot).toBe(false);
  });

  it('REFUSES the save, re-loads, and says nothing was written', async () => {
    // Open reads empty; the server in fact holds the built page.
    const { f, puts } = scripted([EMPTY, BUILT]);
    const ps = new PageSession(ctxWith(f));
    await ps.open('s1', 'pg_1');

    await expect(ps.applyAndSave(addSection(ps))).rejects.toThrow(
      /read as EMPTY .* server holds 2 node\(s\)/s,
    );

    // THE POINT OF THE WHOLE GUARD: nothing reached the wire.
    expect(puts).toHaveLength(0);
    // And the session now holds the real page, so the caller can reapply.
    expect(ps.current().doc.nodes.fs_1).toBeDefined();
  });

  it('lets a genuinely new page through, because the server agrees it is empty', async () => {
    const { f, puts } = scripted([EMPTY, EMPTY]);
    const ps = new PageSession(ctxWith(f));
    await ps.open('s1', 'pg_2');

    await ps.applyAndSave(addSection(ps));

    expect(puts).toHaveLength(1);
    const stored = puts[0]!.document as { nodes: Record<string, unknown>; root_node_id: string };
    // ROOT plus the section this write added — the page the caller just built.
    expect(Object.keys(stored.nodes)).toHaveLength(2);
    expect(stored.root_node_id).toBe('ROOT');
  });

  it('pays the extra read ONCE — later saves on the same page are ordinary', async () => {
    const { f, puts } = scripted([EMPTY, EMPTY]);
    const ps = new PageSession(ctxWith(f));
    await ps.open('s1', 'pg_2');
    const doc = ps.current();
    const made = addSubtree(doc, doc.doc.root_node_id, { type: 'flex-section' });
    await ps.applyAndSave(made.patches);
    const getsAfterFirst = (f as unknown as { mock: { calls: Array<[unknown, RequestInit?]> } }).mock.calls.filter(
      (c) => c[1]?.method !== 'PUT',
    ).length;

    await ps.applyAndSave([
      { op: 'set', path: ['nodes', made.ids[0]!, 'style', 'gap'], value: '8px' },
    ]);

    const getsAfterSecond = (f as unknown as { mock: { calls: Array<[unknown, RequestInit?]> } }).mock.calls.filter(
      (c) => c[1]?.method !== 'PUT',
    ).length;
    expect(getsAfterSecond).toBe(getsAfterFirst);
    expect(puts).toHaveLength(2);
  });

  it('leaves a page that was read normally alone — no extra read, no refusal', async () => {
    const { f, puts } = scripted([BUILT, BUILT]);
    const ps = new PageSession(ctxWith(f));
    await ps.open('s1', 'pg_1');
    const getsAfterOpen = (f as unknown as { mock: { calls: Array<[unknown, RequestInit?]> } }).mock.calls.length;

    await ps.applyAndSave(addSection(ps));

    // One PUT, and no GET between the open and it.
    expect(puts).toHaveLength(1);
    const gets = (f as unknown as { mock: { calls: Array<[unknown, RequestInit?]> } }).mock.calls.filter(
      (c) => c[1]?.method !== 'PUT',
    ).length;
    expect(gets).toBe(getsAfterOpen);
  });
});
