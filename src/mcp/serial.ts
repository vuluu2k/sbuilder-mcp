import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * ONE OPEN DOCUMENT, ONE CALL AT A TIME, IN ARRIVAL ORDER.
 *
 * `PageSession` holds a single open document, and `sb_page_open` replaces it
 * only once its source read answers. A client batching `sb_page_open X` with
 * `sb_outline` / `sb_node_read` ran the read in that gap and answered from the
 * PREVIOUS page — measured on TTG (gap #30): the checkout form's outline after
 * opening /tao-tai-khoan. Two parallel writes race the same way on one save.
 *
 * The slot is taken where the REQUEST arrives, not in the tool callback: the
 * SDK validates arguments asynchronously first, and a schema that takes more
 * ticks (sb_page_open's) let a later sb_outline enter its callback earlier.
 * Tools in `free` touch no open document (the catalog, the API sheet, the media
 * library) and stay parallel. Call before the first `registerTool`, which is
 * when McpServer installs its `tools/call` handler.
 *
 * ponytail: one FIFO for every session tool, so a slow sb_look delays the next
 * sb_set; a per-document lock only matters if two documents are ever open.
 */
export function serializeToolCalls(server: McpServer, free: (name: string) => boolean): void {
  let tail: Promise<unknown> = Promise.resolve();
  const inner = server.server;
  const set = inner.setRequestHandler.bind(inner);
  inner.setRequestHandler = ((schema: unknown, handler: (req: { params: { name: string } }, extra: unknown) => unknown) => {
    if (schema !== CallToolRequestSchema) return set(schema as never, handler as never);
    return set(schema as never, ((req: { params: { name: string } }, extra: unknown) => {
      if (free(req.params.name)) return handler(req, extra);
      const run = tail.then(() => handler(req, extra));
      tail = run.catch(() => undefined);
      return run;
    }) as never);
  }) as typeof inner.setRequestHandler;
}
