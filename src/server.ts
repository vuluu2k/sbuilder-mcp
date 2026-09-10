import { setAgentClient } from './transport/identity.js';
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Session } from './transport/auth.js';
import { Notices } from './mcp/notices.js';
import { UndoLog } from './tools/undo.js';
import { SWAGGER_SOURCE } from './catalog/api.generated.js';
import { ELEMENT_SOURCE } from './catalog/elements.generated.js';
import { registerApiTools } from './tools/api.js';
import { registerSessionTools } from './tools/session.js';
import { registerPageTools } from './tools/page.js';
import { registerLiveTools } from './tools/live.js';
import { registerStoreTools } from './tools/store.js';
import { registerImportTools } from './tools/importpage.js';
import { registerUndoTools } from './tools/undo.js';
import { registerThemeTools } from './tools/theme.js';
import type { ToolContext } from './tools/context.js';

/**
 * Sent on every handshake, so it is short, and says nothing a tool description
 * already says. Counts come from the generated source records, never literals.
 * It used to claim a base style value "vanishes on publish" — the misreading
 * CLAUDE.md records as corrected — and every session read it first.
 */
const INSTRUCTIONS = `Store Builder. Call sb_connect first.

API: sb_api_find query → one line per operation (${SWAGGER_SOURCE.operations} reachable); sb_api_find id → its call sheet; sb_api_call runs it. /api/v1 paths take the API key, every other path the session; the platform refuses each on the other's surface. If the sheet says the body is undescribed, read the matching GET and send back a modified copy.

Design: sb_page_open → sb_catalog_search (${ELEMENT_SOURCE.count} elements) → sb_traits_for the one you chose → sb_add with a NESTED spec (one call per section) → sb_set → sb_look → sb_review.
- Writes and API calls default to dry_run:true; pass dry_run:false to act.
- sb_set writes per breakpoint by default; base is the cascade's fallback layer, fine for values that should not vary.
- Outline flags: global = shared master, an edit lands on every page; overlay = not this page; app = an app block, not editable inside.
- sb_live_join shows edits live in an open editor (needs SB_EMAIL/SB_PASSWORD). sb_bind puts real store data in the page.`;

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
  return {
    base,
    session: new Session(base),
    apiKey: process.env.SB_TOKEN,
    siteId: process.env.SB_SITE,
    siteName: process.env.SB_SITE_NAME,
    notices: new Notices(), undo: new UndoLog(),
  };
}

export function createServer(ctx: ToolContext = buildContext()): McpServer {
  const server = new McpServer(
    { name: 'sbuilder', version: pkgVersion(), title: 'Store Builder' },
    { instructions: INSTRUCTIONS },
  );
  // LEARN WHO LAUNCHED US, at the handshake, before any tool runs.
  //
  // Set here rather than after connect() because the handshake happens DURING
  // connect: a hook attached afterwards is attached to an event that has already
  // fired, and every call would then report an anonymous machine — the exact
  // blindness this exists to remove.
  server.server.oninitialized = () => {
    setAgentClient(server.server.getClientVersion(), pkgVersion());
  };
  registerSessionTools(server, ctx);
  registerApiTools(server, ctx);
  const pageSession = registerPageTools(server, ctx);
  registerLiveTools(server, ctx, pageSession);
  registerStoreTools(server, ctx);
  registerThemeTools(server, ctx);
  registerImportTools(server, ctx, pageSession);
  registerUndoTools(server, ctx);
  return server;
}
