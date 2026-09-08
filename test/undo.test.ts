import { describe, it, expect, vi } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog, restoreBodyFrom } from '../src/tools/undo.js';

const parse = (r: unknown) =>
  JSON.parse((r as { content: Array<{ text: string }> }).content[0].text) as Record<string, unknown>;

describe('restoreBodyFrom — envelopes are not uniform', () => {
  it('reads the shape fields at the top level when they are there', () => {
    // `httpx.WriteItem(w, 200, "document", doc)` answers `{ document: … }`, and
    // `PUT .../forms/{id}/document` wants the document back under that very name.
    // Unwrapping the single key would send the document's own first field.
    const body = restoreBodyFrom('put:/api/sites/{siteId}/forms/{id}/document', {
      document: { nodes: { a: 1 } },
    });
    expect(body).toEqual({ document: { nodes: { a: 1 } } });
  });

  it('looks inside a single-key envelope only when the top level has nothing', () => {
    // GET .../source answers `{ source: { pageId, document, schemaVersion, … } }`,
    // and the PUT takes `{ document, schemaVersion }` — one level down.
    const body = restoreBodyFrom('put:/api/sites/{siteId}/pages/{pageId}/source', {
      source: { pageId: 'p1', document: { nodes: {} }, schemaVersion: 2, updatedAt: 'now' },
    });
    expect(body).toEqual({ document: { nodes: {} }, schemaVersion: 2 });
  });

  it('finds nothing rather than guessing at an envelope it does not know', () => {
    expect(restoreBodyFrom('put:/api/sites/{siteId}/pages/{pageId}/source', { a: 1, b: 2 })).toBeNull();
    expect(restoreBodyFrom('put:/nope', { source: {} })).toBeNull();
  });
});

describe('UndoLog', () => {
  it('records newest first and drops the oldest past the cap', () => {
    const log = new UndoLog();
    for (let i = 0; i < 25; i++) {
      log.record('put:/api/sites/{siteId}/forms/{id}/document', `/p/${i}`, { document: i });
    }
    const list = log.list();
    expect(list.length).toBe(20);
    expect(list[0].path).toBe('/p/24');
    expect(list[0].index).toBe(1);
  });

  it('keeps nothing it could not read a restorable body out of', () => {
    const log = new UndoLog();
    log.record('put:/api/sites/{siteId}/forms/{id}/document', '/p', { unrelated: true });
    expect(log.list()).toEqual([]);
  });
});

describe('sb_undo end to end', () => {
  it('snapshots before a PUT, then puts the old state back and forgets it', async () => {
    const writes: Array<{ method: string; body?: unknown }> = [];
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') writes.push({ method, body: JSON.parse(String(init!.body)) });
      const value =
        method === 'GET'
          ? { document: { nodes: { before: true } } }
          : { ok: true };
      return new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({
      base: 'http://x',
      session,
      fetchImpl: f,
      notices: new Notices(),
    });

    await client.callTool({
      name: 'sb_api_call',
      arguments: {
        id: 'put:/api/sites/{siteId}/forms/{id}/document',
        path_params: { siteId: 's1', id: 'frm_1' },
        body: { document: { nodes: { after: true } } },
        dry_run: false,
      },
    });

    const listed = parse(await client.callTool({ name: 'sb_undo', arguments: {} }));
    const undoable = listed.undoable as Array<{ index: number; path: string; fields: string[] }>;
    expect(undoable.length).toBe(1);
    expect(undoable[0].fields).toEqual(['document']);

    const done = parse(
      await client.callTool({ name: 'sb_undo', arguments: { index: 1, dry_run: false } }),
    );
    expect(done.restored).toBe('/api/sites/s1/forms/frm_1/document');
    // The state that went back is the one read BEFORE the write, not the one the
    // write sent.
    expect(writes[writes.length - 1].body).toEqual({ document: { nodes: { before: true } } });

    // Dropped once put back, so undo is a step backwards rather than a loop
    // between two states.
    const after = parse(await client.callTool({ name: 'sb_undo', arguments: {} }));
    expect((after.undoable as unknown[]).length).toBe(0);
    await close();
  });

  it('does not snapshot a dry run, and does not snapshot a read', async () => {
    const seen: string[] = [];
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${new URL(String(url)).pathname}`);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({
      base: 'http://x',
      session,
      fetchImpl: f,
      notices: new Notices(),
    });
    await client.callTool({
      name: 'sb_api_call',
      arguments: {
        id: 'put:/api/sites/{siteId}/forms/{id}/document',
        path_params: { siteId: 's1', id: 'frm_1' },
        body: { document: {} },
      },
    });
    expect(seen).toEqual([]);
    await close();
  });
});

describe('sb_undo defaults to a dry run', () => {
  it('sends nothing when dry_run is absent — the one destructiveHint tool here', async () => {
    const sent: string[] = [];
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      sent.push(`${method} ${new URL(String(url)).pathname}`);
      return new Response(JSON.stringify({ document: { nodes: { before: true } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({
      base: 'http://x',
      session,
      fetchImpl: f,
      notices: new Notices(),
    });

    await client.callTool({
      name: 'sb_api_call',
      arguments: {
        id: 'put:/api/sites/{siteId}/forms/{id}/document',
        path_params: { siteId: 's1', id: 'frm_1' },
        body: { document: {} },
        dry_run: false,
      },
    });
    sent.length = 0;

    const out = parse(await client.callTool({ name: 'sb_undo', arguments: { index: 1 } }));
    expect(out.dry_run).toBe(true);
    // An unproven guard is indistinguishable from an absent one, and this is the
    // tool that writes a whole document back over a live one.
    expect(sent).toEqual([]);
    await close();
  });
});
