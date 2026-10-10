/**
 * MOST OF THE PLATFORM HAS NO HISTORY, AND A HUMAN HAS CTRL+Z.
 *
 * Settings, form documents and the rest have no history on the platform. A PAGE
 * does — named versions and autosave history, reached through `sb_page_version` —
 * but those were recorded here as absent while they carried no `@Router` line.
 * Every other whole-document replace this server can make is one-way: `PUT
 * /settings` is not a patch, and a partial body erases the store's configuration;
 * `PUT .../forms/{id}/document` replaces a checkout's fields; `PUT
 * .../pages/{id}/source` replaces a page.
 *
 * A merchant clicking through the editor has undo. An agent had nothing, and the
 * damage it can do in one call is larger.
 *
 * SO A PUT READS BEFORE IT WRITES. A PUT is a replace by definition, so the state
 * it is about to destroy is exactly what the matching GET returns, and one extra
 * round trip on a write — not on a read, and not on a dry run — is a small price
 * for the write being reversible.
 *
 * IN PROCESS, NOT ON DISK, deliberately. This server "only ever holds the
 * document and the screenshots"; a snapshot directory is a new kind of thing to
 * own, with a retention question and a privacy question attached. And the window
 * that matters is the one where undo is reached for: the agent discovers the
 * damage in the session that caused it. A durable store waits for a measured
 * need, with the seam left here.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { REQUEST_SHAPES } from '../catalog/shapes.generated.js';
import { findOperation } from '../catalog/search.js';
import { request, redact } from '../transport/http.js';
import { text } from '../mcp/response.js';
import { tokenFor } from './api.js';
import type { ToolContext } from './context.js';
import type { PageSession } from './page.js';

export interface UndoEntry {
  /** 1 is the most recent. Stable only until the next write. */
  index: number;
  operationId: string;
  path: string;
  /** ISO time of the write this entry would reverse. */
  at: string;
  /** The field names captured, so a caller can see what would go back. */
  fields: string[];
}

interface Stored extends UndoEntry {
  body: Record<string, unknown>;
  /**
   * Recorded by a PageSession save, so it restores through `restorePage`. A
   * raw `sb_api_call` PUT to the same path records under the same operation id
   * and must keep the raw path: its write never moved the fence.
   */
  session?: boolean;
  /** Nodes a live PEER's ops changed that this save carried — an undo would erase them. */
  peer?: string[];
}

/** Twenty is more than a session reaches back, and bounds what one process holds. */
const CAP = 20;

/**
 * The body that would restore what a GET response held.
 *
 * ENVELOPES ARE NOT UNIFORM, and unwrapping blindly is how a restore sends the
 * wrong thing. `httpx.WriteItem` wraps under a key it chooses per route:
 * `{ source: {...} }` holds `document` and `schemaVersion` one level down, while
 * `{ document: {...} }` IS the document that `PUT .../document` wants back under
 * that very name. So the shape's own field names are looked for at the top level
 * FIRST and inside a single-key envelope only if none are there — which is right
 * for all three, and which finds nothing rather than guessing when a fourth
 * envelope appears.
 */
export function restoreBodyFrom(operationId: string, response: unknown): Record<string, unknown> | null {
  const shape = REQUEST_SHAPES[operationId];
  if (!shape || !response || typeof response !== 'object') return null;
  const names = shape.fields.map((f) => f.name);

  const pick = (source: Record<string, unknown>): Record<string, unknown> | null => {
    const out: Record<string, unknown> = {};
    for (const n of names) if (n in source) out[n] = source[n];
    return Object.keys(out).length > 0 ? out : null;
  };

  const top = pick(response as Record<string, unknown>);
  if (top) return top;

  const keys = Object.keys(response as Record<string, unknown>);
  if (keys.length !== 1) return null;
  const inner = (response as Record<string, unknown>)[keys[0]];
  if (!inner || typeof inner !== 'object') return null;
  return pick(inner as Record<string, unknown>);
}

/** The operation a page draft save is, and the key every page undo entry carries. */
export const PAGE_SOURCE_OP = 'put:/api/sites/{siteId}/pages/{pageId}/source';

/**
 * What this process last stored for a page: the draft rev the save answered
 * (0 on a platform that reports none) and the document as stored. A page undo
 * restores only over exactly that — anything else is somebody else's edit.
 */
export interface PageFence {
  siteId: string;
  pageId: string;
  rev: number;
  json: string;
}

export class UndoLog {
  private readonly entries: Stored[] = [];
  private readonly fences = new Map<string, PageFence>();

  /** A PageSession save stored this page; `sb_undo` restores only over it. */
  fence(path: string, f: PageFence): void {
    this.fences.set(path, f);
  }

  fenceFor(path: string): PageFence | undefined {
    return this.fences.get(path);
  }

  /** Record the state a PUT is about to replace. Silent when nothing usable came back. */
  record(operationId: string, path: string, before: unknown, meta: { session?: boolean; peer?: string[] } = {}): void {
    const body = restoreBodyFrom(operationId, before);
    if (!body) return;
    this.entries.unshift({
      index: 0,
      operationId,
      path,
      at: new Date().toISOString(),
      fields: Object.keys(body),
      body,
      ...(meta.session ? { session: true } : {}),
      ...(meta.peer?.length ? { peer: meta.peer } : {}),
    });
    // Oldest out. A cap that grows without bound is a memory leak wearing a
    // safety feature's clothes.
    if (this.entries.length > CAP) this.entries.length = CAP;
  }

  list(): UndoEntry[] {
    return this.entries.map(({ body: _body, session: _s, peer: _p, ...rest }, i) => ({ ...rest, index: i + 1 }));
  }

  at(index: number): Stored | undefined {
    return this.entries[index - 1];
  }

  /** Peer-touched nodes carried by this entry's save and every later save of the same path. */
  peersThrough(entry: Stored): string[] {
    const upTo = this.entries.indexOf(entry);
    const out = new Set<string>();
    for (const e of this.entries.slice(0, upTo + 1)) if (e.path === entry.path) for (const p of e.peer ?? []) out.add(p);
    return [...out];
  }

  /**
   * Drop an entry once it has been put back, so undo is not a loop. By
   * reference: a page restore is itself a save, which records its own entry
   * (the redo) ahead of this one and shifts every index.
   */
  drop(entry: Stored): void {
    const i = this.entries.indexOf(entry);
    if (i >= 0) this.entries.splice(i, 1);
  }

  clear(): void {
    this.entries.length = 0;
    this.fences.clear();
  }
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

/**
 * `sb_undo` puts one replaced state back.
 *
 * It restores through the SAME operation that destroyed it, with the fields that
 * operation's handler actually decodes — not the whole GET response, which
 * carries identity and derived columns the platform owns and would refuse or
 * ignore. And the entry is dropped once it is put back, so undo is a step
 * backwards rather than a loop between two states.
 */
export function registerUndoTools(server: McpServer, ctx: ToolContext, pages: PageSession): void {
  server.registerTool(
    'sb_undo',
    {
      description:
        'Put back what a write replaced — a page or form edit made here (sb_add, sb_set, ' +
        'sb_duplicate …), or a PUT through sb_api_call. An undo records what IT replaced, so ' +
        'the newest entry right after one is its redo. A page is refused if anyone else saved ' +
        'it since. IN THIS PROCESS ONLY, capped; the platform\'s own page history (GET ' +
        '.../pages/{pageId}/history) survives a restart. No argument lists what is undoable.',
      inputSchema: {
        index: z.number().int().min(1).optional().describe('1 is the most recent write'),
        dry_run: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ index, dry_run }) => {
      const undoable = ctx.undo.list();
      if (index === undefined) {
        return text({
          undoable,
          ...(undoable.length === 0
            ? {
                note:
                  'Nothing to undo. Page and form saves made here and PUTs through sb_api_call ' +
                  'are recorded, only in this process.',
              }
            : { next: 'Pass an index with dry_run:false to put that state back.' }),
        });
      }
      const entry = ctx.undo.at(index);
      if (!entry) {
        throw new Error(`sbuilder: no undo entry ${index} — call sb_undo with no argument to list`);
      }
      // A page save PageSession made restores through PageSession, never a raw PUT;
      // a raw sb_api_call PUT to the same path keeps the raw path below.
      const fence = entry.session && entry.operationId === PAGE_SOURCE_OP ? ctx.undo.fenceFor(entry.path) : undefined;
      if (fence) {
        const target = entry.body.document as { root_node_id: string; nodes: Record<string, unknown> };
        if (dry_run !== false) {
          return text({
            dry_run: true,
            would_restore: redact({ page: fence.pageId, nodes: Object.keys(target.nodes ?? {}).length }),
            recorded_at: entry.at,
            note: 'Nothing was sent. Re-call with dry_run:false; refused if the page was saved elsewhere since.',
          });
        }
        // Every save between this entry and now counts, not just this one: a
        // person's edit carried by a LATER save is erased by restoring an
        // earlier state just the same.
        const peer = ctx.undo.peersThrough(entry);
        const changed = await pages.restorePage(fence.siteId, fence.pageId, target, fence, peer);
        ctx.undo.drop(entry);
        return text({
          restored: entry.path,
          from: entry.at,
          changed_nodes: changed,
          open: fence.pageId,
          ...(changed ? { redo: 'sb_undo index:1 puts back what this replaced' } : {}),
        });
      }
      const op = findOperation(entry.operationId);
      if (!op) throw new Error(`sbuilder: operation ${entry.operationId} is no longer in the catalog`);

      if (dry_run !== false) {
        return text({
          dry_run: true,
          would_restore: redact({ method: op.method, path: entry.path, body: entry.body }),
          recorded_at: entry.at,
          note: 'Nothing was sent. Re-call with dry_run:false to put this state back.',
        });
      }
      await request({
        base: ctx.base,
        method: op.method,
        path: entry.path,
        token: tokenFor(ctx, op.credential),
        body: entry.body,
        fetchImpl: ctx.fetchImpl,
      });
      ctx.undo.drop(entry);
      return text({ restored: entry.path, operation: entry.operationId, from: entry.at });
    },
  );
}
