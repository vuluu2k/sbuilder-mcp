import { request } from '../transport/http.js';
import { siteToken } from '../tools/credentialpick.js';
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
    token: siteToken(ctx),
    fetchImpl: ctx.fetchImpl,
  })) as { preview?: { url?: string } };
  const link = out?.preview?.url;
  if (!link) {
    throw new Error(
      'sbuilder: the server returned no preview url for this page. A page with no saved draft ' +
        'has no preview — save it first.',
    );
  }
  // The server returns a RELATIVE link in dev (`/_wb/preview?t=…`) and an
  // absolute one in production, where the preview is served from the storefront
  // origin rather than the API's. Resolving against the API base handles both:
  // `new URL` leaves an absolute input untouched. Passing the raw value to
  // Playwright throws "Cannot navigate to invalid URL", which is where this was
  // found — running it, not reading it.
  return new URL(link, ctx.base).toString();
}
