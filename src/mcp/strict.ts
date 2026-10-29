import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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
