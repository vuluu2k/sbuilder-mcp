import { setAgentClient } from './transport/identity.js';
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Session } from './transport/auth.js';
import { readPairSync } from './transport/stored.js';
import { Notices } from './mcp/notices.js';
import { UndoLog } from './tools/undo.js';
import { SWAGGER_SOURCE } from './catalog/api.generated.js';
import { ELEMENT_SOURCE } from './catalog/elements.generated.js';
import { registerApiTools } from './tools/api.js';
import { registerSessionTools } from './tools/session.js';
import { registerLoginTools } from './tools/login.js';
import { registerPageTools } from './tools/page.js';
import { registerPageUpdateTools } from './tools/pageupdate.js';
import { registerPageVersionTools } from './tools/pageversion.js';
import { registerCodeTools } from './tools/code.js';
import { registerComponentTools } from './tools/components.js';
import { registerFunctionTools } from './tools/function.js';
import { registerCollectionTools } from './tools/collection.js';
import { registerFormTools } from './tools/form.js';
import { registerLiveTools } from './tools/live.js';
import { registerStoreTools } from './tools/store.js';
import { registerImportTools } from './tools/importpage.js';
import { registerUndoTools } from './tools/undo.js';
import { registerThemeTools } from './tools/theme.js';
import { registerTranslateTools } from './tools/translate.js';
import type { ToolContext } from './tools/context.js';
import { serializeToolCalls } from './mcp/serial.js';
import { compactToolList, refuseUnknownArgs } from './mcp/strict.js';

/**
 * Sent on every handshake, so it is short, and says nothing a tool description
 * already says. Counts come from the generated source records, never literals.
 * It used to claim a base style value "vanishes on publish" — the misreading
 * CLAUDE.md records as corrected — and every session read it first.
 */
const INSTRUCTIONS = `Store Builder. Call sb_connect first; sb_login = whole account, sb_site_use = switch.

API: sb_api_find query → one line per operation (${SWAGGER_SOURCE.operations} reachable); sb_api_find id → its call sheet; sb_api_call runs it. /api/v1 paths take the API key only; every other path takes the key or the session. Undescribed body: send back a modified copy of the matching GET.

Design, native first: sb_page_open → sb_catalog_search (${ELEMENT_SOURCE.count} elements) → sb_traits_for → sb_add one NESTED native spec per section → sb_bind/sb_event → sb_look + sb_review. custom-code or a code component (sb_components) only for a gap you can name no element covers.
- Writes and API calls default to dry_run:true; pass dry_run:false to act.
- sb_set writes per breakpoint by default; base is the cascade's fallback layer, for values that should not vary.
- Outline flags: global = shared master, an edit lands on every page; overlay = not this page; app = app block, not editable inside.
- sb_live_join shows edits live in an open editor.`;

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

/**
 * Tools that never touch the open document, so they need not wait their turn.
 * Anything not named here is serialized — the safe default for a new tool.
 */
const SESSION_FREE: ReadonlySet<string> = new Set([
  'sb_connect',
  'sb_login',
  'sb_site_list',
  'sb_api_find',
  'sb_api_call',
  'sb_page_update',
  'sb_code',
  'sb_components',
  'sb_function',
  'sb_collection',
  'sb_form',
  'sb_theme',
  'sb_catalog_search',
  'sb_traits_for',
  'sb_templates',
  'sb_page_list',
  'sb_media_list',
  'sb_media_upload',
]);

export function buildContext(): ToolContext {
  const base = process.env.SB_API ?? 'http://localhost:8080';
  const session = new Session(base);
  // THE MACHINE'S ACCOUNT LOGIN, when there is one (`sbuilder-mcp install
  // --login`, sb_login, or `sb login` — one shared file). A password in the
  // environment still wins: it is the more explicit instruction.
  if (!(process.env.SB_EMAIL && process.env.SB_PASSWORD)) {
    const pair = readPairSync(base);
    if (pair) void session.adoptStored(pair);
  }
  return {
    base,
    session,
    apiKey: process.env.SB_TOKEN,
    siteId: process.env.SB_SITE,
    siteName: process.env.SB_SITE_NAME,
    // '' = a key whose site the install did not name: unknown, so any switch is "elsewhere".
    keySite: process.env.SB_TOKEN ? (process.env.SB_SITE ?? '') : undefined,
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
  // Every tool that can reach the open document runs in arrival order — see
  // mcp/serial.ts. Before the first registerTool, which installs tools/call.
  serializeToolCalls(server, (name) => SESSION_FREE.has(name));
  refuseUnknownArgs(server);
  compactToolList(server);
  registerSessionTools(server, ctx);
  registerLoginTools(server, ctx, pkgVersion());
  registerApiTools(server, ctx);
  const pageSession = registerPageTools(server, ctx);
  registerPageUpdateTools(server, ctx);
  registerPageVersionTools(server, ctx, pageSession);
  registerCodeTools(server, ctx);
  registerComponentTools(server, ctx);
  registerFunctionTools(server, ctx);
  registerCollectionTools(server, ctx);
  registerFormTools(server, ctx);
  registerLiveTools(server, ctx, pageSession);
  registerStoreTools(server, ctx, pageSession);
  registerThemeTools(server, ctx);
  registerTranslateTools(server, ctx, pageSession);
  registerImportTools(server, ctx, pageSession);
  registerUndoTools(server, ctx, pageSession);
  return server;
}
