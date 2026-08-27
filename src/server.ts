import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Session } from './transport/auth.js';
import { registerApiTools } from './tools/api.js';
import { registerSessionTools } from './tools/session.js';
import { registerPageTools } from './tools/page.js';
import type { ToolContext } from './tools/context.js';

const INSTRUCTIONS = `Design and operate a Store Builder site.

Call sb_connect first. Then:
- sb_api_find describes what the platform can do; sb_api_call executes it. Between them
  they reach all 310 API operations, so most merchant work needs no other tool.
- Mutating calls default to dry_run:true and send NOTHING. Pass dry_run:false to act.
- /api/v1 paths need SB_TOKEN; every other path uses the session from sb_connect. The
  platform refuses each credential on the other's surface, so this is not interchangeable.
- When sb_api_find returns body_warning or body_note, do not invent a request body. Read
  the matching GET first and send back a modified copy.

To DESIGN a page: sb_page_open, then sb_catalog_search to pick element types, then sb_add
with a NESTED spec (one call per section, not per node), then sb_set for styling.
- Writes default to dry_run:true and change nothing. Pass dry_run:false to act.
- sb_set writes PER BREAKPOINT. A visual quantity written at base renders on the canvas and
  vanishes on publish; pass base:true only for identity or content.
- sb_outline, never a raw document dump. Read one node with sb_node_read.
- A node flagged global is a SHARED master: editing it changes every page that carries it.
  A node flagged overlay is not part of the page at all.`;

/**
 * The published version, read from package.json at runtime so serverInfo never
 * drifts from what npm shipped. package.json sits one level above both dist/ and
 * src/, so the same relative URL resolves in a build and in a source checkout.
 * Never blocks startup over a version string.
 */
export function pkgVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function buildContext(): ToolContext {
  const base = process.env.SB_API ?? 'http://localhost:8080';
  return { base, session: new Session(base), apiKey: process.env.SB_TOKEN };
}

export function createServer(ctx: ToolContext = buildContext()): McpServer {
  const server = new McpServer(
    { name: 'sbuilder', version: pkgVersion(), title: 'Store Builder' },
    { instructions: INSTRUCTIONS },
  );
  registerSessionTools(server, ctx);
  registerApiTools(server, ctx);
  registerPageTools(server, ctx);
  return server;
}
