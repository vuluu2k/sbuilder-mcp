/**
 * THE PLATFORM HAS NO HISTORY, AND A HUMAN HAS CTRL+Z.
 *
 * Page versions, history and restore have no route on either surface — the only
 * `restore` in `/api/v1` is `media/{id}/restore`. So every whole-document replace
 * this server can make is one-way: `PUT /settings` is not a patch, and a partial
 * body erases the store's configuration; `PUT .../forms/{id}/document` replaces a
 * checkout's fields; `PUT .../pages/{id}/source` replaces a page.
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

export class UndoLog {
  private readonly entries: Stored[] = [];

  /** Record the state a PUT is about to replace. Silent when nothing usable came back. */
  record(operationId: string, path: string, before: unknown): void {
    const body = restoreBodyFrom(operationId, before);
    if (!body) return;
    this.entries.unshift({
      index: 0,
      operationId,
      path,
      at: new Date().toISOString(),
      fields: Object.keys(body),
      body,
    });
    // Oldest out. A cap that grows without bound is a memory leak wearing a
    // safety feature's clothes.
    if (this.entries.length > CAP) this.entries.length = CAP;
  }

  list(): UndoEntry[] {
    return this.entries.map(({ body: _body, ...rest }, i) => ({ ...rest, index: i + 1 }));
  }

  at(index: number): Stored | undefined {
    return this.entries[index - 1];
  }

  /** Drop an entry once it has been put back, so undo is not a loop. */
  drop(index: number): void {
    this.entries.splice(index - 1, 1);
  }

  clear(): void {
    this.entries.length = 0;
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
export function registerUndoTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'sb_undo',
    {
      description:
        'Put back what a PUT through sb_api_call replaced — settings, a product, a form, ' +
        'anything with a shape. IN THIS PROCESS ONLY, capped, and gone when it exits. For a ' +
        'PAGE the platform keeps its own: GET .../pages/{pageId}/history lists the autosave ' +
        'checkpoint it writes on every draft save, versions lists the labelled snapshots, and ' +
        'either restores. That one survives everything and is the better answer whenever the ' +
        'thing to recover is a page. No argument lists what is undoable here.',
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
                  'Nothing to undo. Only a PUT through sb_api_call is recorded, only in this ' +
                  'process, and only when the platform could be read first.',
              }
            : { next: 'Pass an index with dry_run:false to put that state back.' }),
        });
      }
      const entry = ctx.undo.at(index);
      if (!entry) {
        throw new Error(`sbuilder: no undo entry ${index} — call sb_undo with no argument to list`);
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
      ctx.undo.drop(index);
      return text({ restored: entry.path, operation: entry.operationId, from: entry.at });
    },
  );
}
