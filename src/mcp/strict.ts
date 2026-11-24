import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * AN ARGUMENT A TOOL DOES NOT TAKE IS REFUSED, NOT DROPPED.
 *
 * The SDK wraps a raw shape in a plain `z.object`, which strips unknown keys in
 * silence. Measured on TTG (gap #82): `sb_look` called with `page_id` of the
 * home page dropped it and shot the session's open page instead, a page deleted
 * hours earlier, so the call 404'd and named neither page. A refusal names the
 * key, and the agent fixes the call instead of trusting a result about
 * something else. Call before the first `registerTool`.
 */
export function refuseUnknownArgs(server: McpServer): void {
  const register = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: { inputSchema?: unknown }, cb: unknown) => {
    const shape = config.inputSchema;
    const strict = shape && !(shape instanceof z.ZodType) ? z.object(shape as z.ZodRawShape).strict() : shape;
    return register(name, { ...config, inputSchema: strict } as never, cb as never);
  }) as typeof server.registerTool;
}

/**
 * TOOLS/LIST CARRIES NOTHING THE SPEC ALREADY SAYS BY DEFAULT.
 *
 * The SDK stamps every inputSchema with `"$schema":"…draft-07…"` and every tool
 * with `execution:{taskSupport:"forbidden"}` — the spec's own default when the
 * key is absent. 42 tools × both was ~3,900 characters of every session's
 * context buying nothing. Call before the first `registerTool`, which is when
 * McpServer installs its `tools/list` handler.
 */
export function compactToolList(server: McpServer): void {
  const inner = server.server;
  const set = inner.setRequestHandler.bind(inner);
  inner.setRequestHandler = ((schema: unknown, handler: (...a: unknown[]) => unknown) => {
    if (schema !== ListToolsRequestSchema) return set(schema as never, handler as never);
    return set(schema as never, (async (...a: unknown[]) => {
      const res = (await handler(...a)) as { tools: Array<Record<string, unknown>> };
      for (const t of res.tools) {
        delete (t.inputSchema as Record<string, unknown> | undefined)?.$schema;
        const ex = t.execution as { taskSupport?: string } | undefined;
        if (ex && (ex.taskSupport ?? 'forbidden') === 'forbidden' && Object.keys(ex).length <= 1) delete t.execution;
      }
      return res;
    }) as never);
  }) as typeof inner.setRequestHandler;
}
