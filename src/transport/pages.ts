import { ApiError, request } from './http.js';
import { siteToken } from '../tools/credentialpick.js';
import type { ToolContext } from '../tools/context.js';

export interface PageSource {
  pageId: string;
  siteId: string;
  document: unknown;
  schemaVersion: number;
  updatedAt: string;
  /**
   * The draft's server revision (web_builder 1dbc88a2c, `page.SourceRev`).
   * Sent back as `baseRev` so a save over a newer draft is refused 409
   * `source_stale`. Absent from an older platform.
   */
  rev?: number;
  /** Omitted by the server when empty — never null. Treat absence as "none". */
  warnings?: unknown[];
  /**
   * The CURRENT revision of every shared master this save touched, reported so
   * the client can re-stamp its own copy before the next one.
   *
   * NOT optional information. Both are an optimistic fence: the composed node
   * carries `specials.globalRev` / `specials.overlayRev`, the save sends it as
   * `expectRev`, and a stale one is REFUSED — with a warning, and a 200. So a
   * client that does not re-stamp lands its first edit to a shared header or to
   * the cart drawer and silently drops every edit after it, which is what the
   * platform's own comment on this field says in as many words.
   */
  globals?: RevStamp[];
  overlays?: RevStamp[];
}

/** One shared master's current revision, as the save reports it. */
export interface RevStamp {
  id: string;
  rev: number;
}

const LIVE_PEER = /^[A-Za-z0-9_-]{1,64}$/;

function sourcePath(siteId: string, pageId: string): string {
  return `/api/sites/${encodeURIComponent(siteId)}/pages/${encodeURIComponent(pageId)}/source`;
}

/**
 * Read a page's DRAFT document.
 *
 * The response is enveloped under `source` (httpx.WriteItem), and `warnings`,
 * `globals` and `overlays` are omitted rather than nulled when empty — so a
 * caller must treat absence as "none" and never dereference them.
 *
 * What comes back is COMPOSED: global sections and site overlays have been
 * merged onto ROOT. That is the tree to edit; the server strips the overlays
 * back out on write.
 */
export async function loadSource(
  ctx: ToolContext,
  siteId: string,
  pageId: string,
): Promise<PageSource> {
  const out = (await request({
    base: ctx.base,
    method: 'GET',
    path: sourcePath(siteId, pageId),
    token: siteToken(ctx),
    fetchImpl: ctx.fetchImpl,
  })) as { source: PageSource };
  return out.source;
}

/**
 * Save a page's draft document.
 *
 * The body is `{ document, schemaVersion }`, copied from the editor's own
 * `saveSource` (editor/src/features/pages/api.ts:114) rather than inferred: the
 * OpenAPI document declares NO body for this route at all, so there is nothing
 * to derive it from and a guess would have sent `{ document }` alone.
 * `schema_version ?? 1` mirrors the editor's fallback exactly.
 *
 * A rejection here is the platform refusing the TREE, not the transport failing
 * — `band_order` is the common one — and `ApiError.code` carries which. That is
 * why nothing is swallowed: the code is the only thing that tells an agent what
 * to fix.
 */
/** The platform refused a save over a draft that moved since it was read. */
export const isSourceStale = (e: unknown): boolean =>
  e instanceof ApiError && e.status === 409 && e.code === 'source_stale';

export async function saveSource(
  ctx: ToolContext,
  siteId: string,
  pageId: string,
  document: { schema_version?: number; root_node_id: string; nodes: Record<string, unknown> },
  baseRev?: number,
  /**
   * `X-WB-Live-Peer` (web_builder e79cdb7f3): the realtime peer that ALREADY
   * broadcast this save's whole change as ops. An editor tab with unsaved edits
   * adopts such a save without its conflict banner, so only PageSession passes
   * it, and only then — a raw write adopted silently is overwritten by the
   * human's next autosave.
   */
  livePeer?: string,
): Promise<PageSource> {
  const out = (await request({
    base: ctx.base,
    method: 'PUT',
    path: sourcePath(siteId, pageId),
    token: siteToken(ctx),
    // Only when the read reported one: an older platform has no fence to name.
    body: { document, schemaVersion: document.schema_version ?? 1, ...(baseRev ? { baseRev } : {}) },
    ...(livePeer && LIVE_PEER.test(livePeer) ? { headers: { 'X-WB-Live-Peer': livePeer } } : {}),
    fetchImpl: ctx.fetchImpl,
  })) as { source: PageSource };
  return out.source;
}
