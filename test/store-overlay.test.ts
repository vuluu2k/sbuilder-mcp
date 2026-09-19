import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

interface NodeLike {
  id: string;
  data: { type: string; parent: string | null; nodes: string[] };
  specials?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

interface DocLike {
  root_node_id: string;
  nodes: Record<string, NodeLike>;
}

/** A page holding one flex-section with one list-dataset child, freshly seeded. */
function buildDoc(): { document: DocLike; listNodeId: string } {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const { patches, ids } = addSubtree(d, 'ROOT', {
    type: 'flex-section',
    children: [{ type: 'list-dataset' }],
  });
  d.apply(patches);
  return { document: d.doc as unknown as DocLike, listNodeId: ids[1] };
}

/**
 * Answers every route `attachOverlay` touches, by URL, and records every call.
 *
 * The SECOND `/source` GET (the re-read after an attach or a quickview save)
 * answers a document that additionally carries the node the platform's
 * composer would have merged in — a popup's node stamped
 * `specials.overlayId`, or a quickview panel stamped `specials.quickviewId` —
 * mirroring what `ComposeOverlays`/`ComposeQuickviews` actually do on read.
 */
function scripted(kind: 'popup' | 'quickview', initialDoc: DocLike, listNodeId?: string) {
  const calls: Call[] = [];
  let current: DocLike = initialDoc;
  let attachedOverlayId: string | null = null;
  let quickviewOverlayId: string | null = null;
  let composedIdSeq = 0;

  const withComposed = (doc: DocLike): DocLike => {
    if (kind === 'popup' && attachedOverlayId) {
      const id = `composed_pop_${++composedIdSeq}`;
      return {
        ...doc,
        nodes: {
          ...doc.nodes,
          [id]: {
            id,
            data: { type: 'popup', parent: doc.root_node_id, nodes: [] },
            specials: { overlayId: attachedOverlayId },
          },
        },
      };
    }
    if (kind === 'quickview' && quickviewOverlayId) {
      const id = `composed_qv_${++composedIdSeq}`;
      return {
        ...doc,
        nodes: {
          ...doc.nodes,
          [id]: {
            id,
            data: { type: 'quickview', parent: listNodeId ?? doc.root_node_id, nodes: [] },
            specials: { quickviewId: quickviewOverlayId },
          },
        },
      };
    }
    return doc;
  };

  const f = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path, body });
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

    if (path.endsWith('/source')) {
      if (method === 'PUT') {
        current = (body as { document: DocLike }).document;
        if (kind === 'quickview' && listNodeId) {
          const qv = current.nodes[listNodeId]?.config?.quickviewId;
          if (typeof qv === 'string' && qv) quickviewOverlayId = qv;
        }
        return json({
          source: { pageId: 'pg_1', siteId: 's1', document: current, schemaVersion: 2, updatedAt: 'now' },
        });
      }
      return json({
        source: {
          pageId: 'pg_1',
          siteId: 's1',
          document: withComposed(current),
          schemaVersion: 2,
          updatedAt: 'now',
        },
      });
    }
    if (path.endsWith('/overlays') && method === 'POST') {
      const b = body as { kind: string; name: string };
      return json({ overlay: { id: b.kind === 'popup' ? 'ov_1' : 'qv_created_1', kind: b.kind, name: b.name } }, 201);
    }
    const attachMatch = /\/overlays\/([^/]+)\/pages\/pg_1$/.exec(path);
    if (attachMatch && method === 'POST') {
      attachedOverlayId = attachMatch[1];
      return json({});
    }
    return json({});
  }) as unknown as typeof fetch;

  return { f, calls };
}

async function clientOver(f: typeof fetch) {
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  return connectedClient({
    base: 'http://x',
    session,
    fetchImpl: f,
    notices: new Notices(),
    undo: new UndoLog(),
    siteId: 's1',
  });
}

const parse = (r: unknown) =>
  JSON.parse((r as { content: Array<{ text: string }> }).content[0].text) as Record<string, unknown>;

describe('sb_store action:"overlay_attach"', () => {
  it('kind:"popup" saves, creates, attaches, re-reads and reports the composed node', async () => {
    const { document } = buildDoc();
    const { f, calls } = scripted('popup', document);
    const { client, close } = await clientOver(f);

    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
    calls.length = 0; // only the writes from this call matter to the ordering assertion

    const out = parse(
      await client.callTool({
        name: 'sb_store',
        arguments: { action: 'overlay_attach', kind: 'popup', name: 'Sale', dry_run: false },
      }),
    );

    const mutating = calls.filter((c) => c.method !== 'GET' || c.path.endsWith('/source'));
    expect(mutating.map((c) => `${c.method} ${c.path}`)).toEqual([
      'PUT /api/sites/s1/pages/pg_1/source',
      'POST /api/sites/s1/overlays',
      'POST /api/sites/s1/overlays/ov_1/pages/pg_1',
      'GET /api/sites/s1/pages/pg_1/source',
    ]);

    expect(out.overlay_id).toBe('ov_1');
    expect(out.created).toBe(true);
    expect(out.node_id).toBe('composed_pop_1');

    await close();
  });

  it('kind:"popup" dry run sends nothing and lists the plan in order', async () => {
    const { document } = buildDoc();
    const { f, calls } = scripted('popup', document);
    const { client, close } = await clientOver(f);

    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
    calls.length = 0;

    const out = parse(
      await client.callTool({
        name: 'sb_store',
        arguments: { action: 'overlay_attach', kind: 'popup', name: 'Sale' },
      }),
    );

    expect(out.dry_run).toBe(true);
    const plan = out.plan as Array<{ step: number; method: string; path: string }>;
    expect(plan.map((p) => p.method)).toEqual(['PUT', 'POST', 'POST', 'GET']);
    expect(calls).toEqual([]);

    await close();
  });

  it('kind:"quickview" points the list at the panel, saves, re-reads and reports the composed node', async () => {
    const { document, listNodeId } = buildDoc();
    const { f, calls } = scripted('quickview', document, listNodeId);
    const { client, close } = await clientOver(f);

    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
    calls.length = 0;

    const out = parse(
      await client.callTool({
        name: 'sb_store',
        arguments: {
          action: 'overlay_attach',
          kind: 'quickview',
          list_id: listNodeId,
          overlay_id: 'qv_1',
          dry_run: false,
        },
      }),
    );

    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts.length).toBe(1);
    const savedDoc = puts[0].body!.document as DocLike;
    expect(savedDoc.nodes[listNodeId].config?.quickviewId).toBe('qv_1');

    // No overlay create call — an id was given.
    expect(calls.filter((c) => c.method === 'POST' && c.path.endsWith('/overlays'))).toEqual([]);

    const gets = calls.filter((c) => c.method === 'GET' && c.path.endsWith('/source'));
    expect(gets.length).toBeGreaterThanOrEqual(1);

    expect(out.overlay_id).toBe('qv_1');
    expect(out.created).toBe(false);
    expect(out.node_id).toBe('composed_qv_1');

    await close();
  });

  it('kind:"quickview" with no overlay_id creates the panel from the seed first', async () => {
    const { document, listNodeId } = buildDoc();
    const { f, calls } = scripted('quickview', document, listNodeId);
    const { client, close } = await clientOver(f);

    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
    calls.length = 0;

    const out = parse(
      await client.callTool({
        name: 'sb_store',
        arguments: { action: 'overlay_attach', kind: 'quickview', list_id: listNodeId, dry_run: false },
      }),
    );

    const created = calls.find((c) => c.method === 'POST' && c.path.endsWith('/overlays'));
    expect(created).toBeTruthy();
    expect((created!.body as { kind: string; document: unknown }).kind).toBe('quickview');
    expect(out.overlay_id).toBe('qv_created_1');
    expect(out.created).toBe(true);
    expect(out.node_id).toBe('composed_qv_1');

    await close();
  });

  it('kind:"quickview" refuses a node that is not a list-dataset', async () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const { patches } = addSubtree(d, 'ROOT', { type: 'heading' });
    d.apply(patches);
    const headingId = d.outline()[0].id;
    const { f } = scripted('quickview', d.doc as unknown as DocLike);
    const { client, close } = await clientOver(f);

    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
    const failed = (await client.callTool({
      name: 'sb_store',
      arguments: { action: 'overlay_attach', kind: 'quickview', list_id: headingId, overlay_id: 'qv_1' },
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain('heading');

    await close();
  });

  it('refuses overlay_attach with no kind', async () => {
    const { document } = buildDoc();
    const { f } = scripted('popup', document);
    const { client, close } = await clientOver(f);

    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
    const failed = (await client.callTool({
      name: 'sb_store',
      arguments: { action: 'overlay_attach' },
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain('kind');

    await close();
  });
});
