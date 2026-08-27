import { request } from '../transport/http.js';
import type { ToolContext } from '../tools/context.js';

/**
 * Mint a signed link to this page's DRAFT preview.
 *
 * The link is short-lived and is the only gate on the public `/_wb/preview`
 * route, which renders the STORED draft through the Go renderer. So a screenshot
 * always shows the last SAVED state — save first, or you photograph the past.
 */
export async function previewUrl(
  ctx: ToolContext,
  siteId: string,
  pageId: string,
): Promise<string> {
  const out = (await request({
    base: ctx.base,
    method: 'GET',
    path: `/api/sites/${encodeURIComponent(siteId)}/pages/${encodeURIComponent(pageId)}/preview`,
    token: ctx.session.token(),
    fetchImpl: ctx.fetchImpl,
  })) as { preview?: { url?: string } };
  const url = out?.preview?.url;
  if (!url) {
    throw new Error(
      'sbuilder: the server returned no preview url for this page. A page with no saved draft ' +
        'has no preview — save it first.',
    );
  }
  return url;
}
