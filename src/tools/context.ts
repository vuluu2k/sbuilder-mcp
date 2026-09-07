import type { Session } from '../transport/auth.js';
import type { Notices } from '../mcp/notices.js';

/** Everything a tool needs to reach the platform. Built once, in server.ts. */
export interface ToolContext {
  base: string;
  session: Session;
  apiKey?: string;
  /** Injected in tests; undefined means global fetch. */
  fetchImpl?: typeof fetch;
  /** Directives said once per process — see mcp/notices.ts. */
  notices: Notices;
}
