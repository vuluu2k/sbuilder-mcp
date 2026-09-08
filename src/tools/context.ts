import type { Session } from '../transport/auth.js';
import type { Notices } from '../mcp/notices.js';
import type { UndoLog } from './undo.js';

/** Everything a tool needs to reach the platform. Built once, in server.ts. */
export interface ToolContext {
  base: string;
  session: Session;
  apiKey?: string;
  /** SB_SITE: the one site this install works on, when the install named one. */
  siteId?: string;
  /**
   * SB_SITE_NAME: what the merchant calls that site.
   *
   * A LABEL, never an address. Nothing resolves by it and no request carries
   * it — `siteFor()` still answers with the id — but a session that can say
   * "Áo Thun" is one the merchant can follow, and the id is 32 characters they
   * did not choose.
   */
  siteName?: string;
  /** Injected in tests; undefined means global fetch. */
  fetchImpl?: typeof fetch;
  /** Directives said once per process — see mcp/notices.ts. */
  notices: Notices;
  /**
   * What a PUT replaced, so `sb_undo` can put it back.
   *
   * The platform has no page history and no restore, so every whole-document
   * replace is one-way. See tools/undo.ts.
   */
  undo: UndoLog;
}

/**
 * The site a call is about: the one it names, or the one the install did.
 *
 * An API key belongs to exactly ONE site, so on a key-only install the id is a
 * constant the environment already holds — and requiring it on every call made
 * the model carry a 32-character string through a whole session, which it can
 * only get by listing pages and reading one back. `SB_SITE` makes it optional
 * without making it implicit: an explicit argument always wins, so a
 * two-site session still works by naming each one.
 */
export function siteFor(ctx: ToolContext, given?: string): string {
  const id = given ?? ctx.siteId;
  if (!id) {
    throw new Error(
      'sbuilder: no site. Pass site_id, or set SB_SITE to the site this install works on ' +
        '(sbuilder-mcp install --site site_…).',
    );
  }
  return id;
}
