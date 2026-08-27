import { request } from './http.js';
import type { ToolContext } from '../tools/context.js';

export interface PageSource {
  pageId: string;
  siteId: string;
  document: unknown;
  schemaVersion: number;
  updatedAt: string;
  /** Omitted by the server when empty — never null. Treat absence as "none". */
  warnings?: unknown[];
  globals?: unknown[];
  overlays?: unknown[];
}

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
    token: ctx.session.token(),
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
export async function saveSource(
  ctx: ToolContext,
  siteId: string,
  pageId: string,
  document: { schema_version?: number; root_node_id: string; nodes: Record<string, unknown> },
): Promise<PageSource> {
  const out = (await request({
    base: ctx.base,
    method: 'PUT',
    path: sourcePath(siteId, pageId),
    token: ctx.session.token(),
    body: { document, schemaVersion: document.schema_version ?? 1 },
    fetchImpl: ctx.fetchImpl,
  })) as { source: PageSource };
  return out.source;
}
