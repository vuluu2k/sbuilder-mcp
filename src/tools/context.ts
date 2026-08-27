import type { Session } from '../transport/auth.js';

/** Everything a tool needs to reach the platform. Built once, in server.ts. */
export interface ToolContext {
  base: string;
  session: Session;
  apiKey?: string;
  /** Injected in tests; undefined means global fetch. */
  fetchImpl?: typeof fetch;
}
