import { tokenFor } from './api.js';
import type { ToolContext } from './context.js';

/**
 * The credential for a private, site-scoped call.
 *
 * A one-line re-export so `transport/` does not reach into `tools/api.ts` for
 * the rule and quietly grow a second copy of it. There is exactly one answer to
 * "which token opens /api/sites", and it lives in `tokenFor`.
 */
export function siteToken(ctx: ToolContext, siteId?: string): string {
  return tokenFor(ctx, 'siteScoped', siteId) as string;
}
