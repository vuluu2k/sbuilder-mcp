import { request, ApiError } from './http.js';
import { siteToken } from '../tools/credentialpick.js';
import type { ToolContext } from '../tools/context.js';

/**
 * REAL PHOTOGRAPHS, SEARCHED ON THE PLATFORM.
 *
 * Rule 7 is the reason this exists and the reason it is shaped this way:
 * "keyword stock imagery is not a source — `loremflickr` answered
 * 'kids,clothing' with a cat statue and a photo of an adult." That rule is
 * usually read as "stock is bad". It is not — the fault was GUESSING. A keyword
 * glued into a URL returns something nobody looked at. A SEARCH returns results
 * that each say what they SHOW, so the caller reads and chooses, which is what a
 * person does.
 *
 * THE PROVIDER KEY IS THE PLATFORM'S, NOT THIS SERVER'S, and that is the whole
 * of the design. `GET /api/sites/{siteId}/images/search` runs a rotated pool of
 * Pexels keys behind the credential this server already holds. So: no second
 * secret in every install, no shared quota with another product, no third-party
 * proxy in the path, and one place for an operator to add a key.
 *
 * WHEN THE PLATFORM CANNOT SEARCH, THIS SERVER DOES NOT TRY TO. There is no
 * fallback provider here on purpose — a fallback would put the very key the
 * platform exists to hold back into every install. The caller is told plainly
 * that the search is unavailable and that it should find a photograph by its own
 * means and pass the URL: `sb_media_upload { url }` has the platform fetch it
 * server-side, so an agent with a web search of its own loses nothing.
 */
export interface StockPhoto {
  id: number;
  /** What the photo SHOWS, in the photographer's words. */
  alt: string;
  width: number;
  height: number;
  photographer: string;
  photographer_url: string;
  page_url: string;
  /** The file to upload — a hero at 1440 without the native file's tens of megabytes. */
  url: string;
}

/** The platform has no usable provider key, which is not the same as no results. */
export class SearchUnavailable extends Error {
  constructor(readonly why: string) {
    super(why);
    this.name = 'SearchUnavailable';
  }
}

export const NO_SEARCH_NEXT =
  'This platform has no image search available, so find a photograph by your own means and pass ' +
  'its URL to sb_media_upload — the platform fetches it server-side and it lands in this site\'s ' +
  'own library, never hotlinked. An operator turns the search on by adding a Pexels key in the ' +
  'admin Settings area (Pexels keys), or by setting PEXELS_API_KEYS on the server; several keys ' +
  'are walked round-robin, because that provider rate-limits per key. Either way the key lives ' +
  'there rather than here, so one place holds it and one quota is spent.';

export async function searchStock(
  ctx: ToolContext,
  siteId: string,
  query: string,
  opts: { perPage?: number; orientation?: 'landscape' | 'portrait' | 'square' } = {},
): Promise<StockPhoto[]> {
  const q = new URLSearchParams({ query, per_page: String(opts.perPage ?? 8) });
  if (opts.orientation) q.set('orientation', opts.orientation);
  try {
    const out = (await request({
      base: ctx.base,
      method: 'GET',
      path: `/api/sites/${encodeURIComponent(siteId)}/images/search?${q}`,
      token: siteToken(ctx),
      fetchImpl: ctx.fetchImpl,
    })) as { photos?: Array<Record<string, unknown>> };
    return (out.photos ?? []).map((p) => ({
      id: Number(p.id ?? 0),
      alt: typeof p.alt === 'string' ? p.alt : '',
      width: Number(p.width ?? 0),
      height: Number(p.height ?? 0),
      photographer: typeof p.photographer === 'string' ? p.photographer : '',
      photographer_url: typeof p.photographerUrl === 'string' ? p.photographerUrl : '',
      page_url: typeof p.pageUrl === 'string' ? p.pageUrl : '',
      url: typeof p.url === 'string' ? p.url : '',
    })).filter((p) => p.url);
  } catch (e) {
    // 503 is the platform saying it has no usable key; 404 is a deployment older
    // than the route. Both mean the same thing to the caller — no search here —
    // and both deserve the same answer, which is not an error but an instruction.
    const err = e as ApiError & { status?: number };
    if (err?.status === 503 || err?.status === 404 || err?.code === 'image_search_unavailable') {
      throw new SearchUnavailable(
        err?.status === 404
          ? 'this deployment has no image-search route yet'
          : 'no image provider key is configured or usable on this platform',
      );
    }
    throw e;
  }
}
