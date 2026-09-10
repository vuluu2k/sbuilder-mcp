/**
 * REAL PHOTOGRAPHS, WITH REAL DESCRIPTIONS.
 *
 * Rule 7 of the design skill is the reason this exists and the reason it is
 * shaped the way it is: "keyword stock imagery is not a source — `loremflickr`
 * answered 'kids,clothing' with a cat statue and a photo of an adult." That
 * failure is not about stock photography, it is about GUESSING: a keyword glued
 * into a URL returns something nobody looked at.
 *
 * A search API is a different thing entirely, because every result carries what
 * it actually SHOWS. Pexels answers "coffee shop" with
 * "Three young adults engage at a cafe counter, using mobile devices" — so the
 * caller can read the descriptions and CHOOSE, which is what a person does and
 * what the cat statue proves nobody was doing.
 *
 * PEXELS, because it is already this family's answer: `webcake-landing-mcp`
 * ships the same client, down to the shared proxy below, and a second house
 * standard for the same job is a second place for it to drift. Its licence is
 * free for commercial use with attribution appreciated rather than required,
 * which is what makes an image usable on a merchant's storefront without
 * printing a credit line they did not ask for.
 *
 * THE KEY IS OPTIONAL, and that is deliberate: with `PEXELS_API_KEY` this calls
 * Pexels directly, and without one it calls the shared proxy the sibling repo
 * already runs (`https://mcp.toolvn.io.vn/api/images/search`), which holds a key
 * and answers the same shape. An `npx` install with no configuration at all
 * still finds images.
 */
const PEXELS_SEARCH = 'https://api.pexels.com/v1/search';
const PROXY_DEFAULT = 'https://mcp.toolvn.io.vn';
const PROXY_PATH = '/api/images/search';
const TIMEOUT_MS = 20_000;

/** One photograph, reduced to what a page builder needs. */
export interface StockPhoto {
  id: number;
  /** What the photo SHOWS, in the photographer's words — the half a keyword cannot give. */
  alt: string;
  width: number;
  height: number;
  /** Attribution: appreciated rather than required, and free to carry either way. */
  photographer: string;
  photographer_url: string;
  page_url: string;
  /** The URL to upload. Big enough for a hero, small enough to stay under the upload cap. */
  url: string;
}

/** The shape both doors answer, normalised here so the caller cannot tell them apart. */
function normalise(p: Record<string, unknown>): StockPhoto | null {
  const src = (p.src ?? {}) as Record<string, string>;
  // `large2x` is ~1880px wide, which is a hero at 1440 and still a few hundred
  // KB; `original` is the native file and on a 3800px photograph that is tens of
  // megabytes for a band nobody will view above 1440.
  const url = src.large2x || src.large || src.original || '';
  if (!url) return null;
  return {
    id: Number(p.id ?? 0),
    alt: typeof p.alt === 'string' ? p.alt : '',
    width: Number(p.width ?? 0),
    height: Number(p.height ?? 0),
    photographer: typeof p.photographer === 'string' ? p.photographer : '',
    photographer_url: typeof p.photographer_url === 'string' ? p.photographer_url : '',
    page_url: typeof p.url === 'string' ? p.url : '',
    url,
  };
}

export interface StockSearch {
  photos: StockPhoto[];
  /** Which door answered, so a caller can tell "no key" from "no results". */
  via: 'pexels' | 'proxy';
}

/**
 * Search for photographs.
 *
 * `orientation` is a SHAPE request, not a subject one — a hero panel filled with
 * a portrait crop is the aspect-ratio mistake rule 6 is about, and it is far
 * cheaper to ask the search than to crop afterwards.
 */
export async function searchStock(
  fetchImpl: typeof fetch,
  query: string,
  opts: { perPage?: number; orientation?: 'landscape' | 'portrait' | 'square' } = {},
): Promise<StockSearch> {
  const q = new URLSearchParams({
    query,
    per_page: String(Math.min(Math.max(opts.perPage ?? 8, 1), 30)),
  });
  if (opts.orientation) q.set('orientation', opts.orientation);

  const key = (process.env.PEXELS_API_KEY ?? '').trim();
  const proxy = (process.env.PEXELS_PROXY_BASE ?? PROXY_DEFAULT).replace(/\/+$/, '');
  const [url, headers, via] = key
    ? ([`${PEXELS_SEARCH}?${q}`, { Authorization: key }, 'pexels'] as const)
    : ([`${proxy}${PROXY_PATH}?${q}`, {}, 'proxy'] as const);

  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    } as RequestInit);
  } catch (e) {
    throw new Error(
      `sbuilder: could not reach the image search (${via}) — ${(e as Error).message}. ` +
        'Set PEXELS_API_KEY for a direct connection, or PEXELS_PROXY_BASE to another host.',
    );
  }
  if (!res.ok) {
    throw new Error(
      `sbuilder: the image search (${via}) answered ${res.status}. ` +
        (via === 'proxy'
          ? 'The shared proxy is a courtesy, not a guarantee — set PEXELS_API_KEY (free at ' +
            'https://www.pexels.com/api/) to call Pexels directly.'
          : 'Check PEXELS_API_KEY.'),
    );
  }
  const body = (await res.json()) as { photos?: Array<Record<string, unknown>> };
  const photos = (body.photos ?? [])
    .map(normalise)
    .filter((p): p is StockPhoto => p !== null);
  return { photos, via };
}
