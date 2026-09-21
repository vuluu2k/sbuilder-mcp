/**
 * DID THE LIVE PAGE ACTUALLY START SERVING WHAT WAS JUST PUBLISHED?
 *
 * A publish that answers 200 proves the platform STORED a new published row.
 * It does not prove a visitor is being served it, and the two come apart for a
 * measured, ordinary reason: the storefront answers
 *
 *     cache-control: public, max-age=60
 *
 * so a browser — and anything in front of it — may go on showing the previous
 * page for up to a minute. A caller who publishes, reloads, sees the old page
 * and concludes the publish failed then "fixes" something that was never
 * broken; a caller who publishes, does not reload, and reports the page live is
 * making a claim nothing checked.
 *
 * So this fetches the page and asks a question the HTML can answer: does the
 * markup a visitor is being served contain the node ids this publish put in it?
 * Every element the renderer draws carries `id="<node id>"`, so the top-level
 * band ids are a fingerprint of the document without needing to diff bytes —
 * and the diff would be the wrong tool anyway, since the served page is
 * assembled with a head, a runtime bundle and stylesheet links the published
 * `html` field does not carry.
 *
 * CACHE-BUSTED, because the question is about the ORIGIN and not about what
 * some intermediary happens to be holding: an unmatched query parameter makes
 * a distinct cache key, and `Cache-Control: no-cache` asks the chain to
 * revalidate. What comes back is therefore what the origin serves NOW, and the
 * `max_age` reported beside it is how long somebody else's copy may differ.
 */

/** What the live page is serving, measured rather than assumed. */
export interface LiveProof {
  url: string;
  status: number;
  /** True when every band id this publish carries is in the served markup. */
  serving: boolean;
  /** Ids looked for, and the ones the page did not have. */
  checked: number;
  missing?: string[];
  /** How long another viewer's copy may still be the previous page. */
  max_age?: number;
  etag?: string;
  note?: string;
}

/** The node ids that are a page's top-level bands — its cheapest fingerprint. */
export function bandIds(document: unknown): string[] {
  const d = document as
    | { root_node_id?: string; nodes?: Record<string, { data?: { nodes?: string[] } }> }
    | undefined;
  const root = d?.root_node_id;
  if (!root || !d?.nodes) return [];
  return (d.nodes[root]?.data?.nodes ?? []).filter((id) => typeof id === 'string');
}

/** `max-age=<n>` out of a Cache-Control header, when it says one. */
export function maxAgeOf(header: string | null): number | undefined {
  const m = /max-age=(\d+)/i.exec(header ?? '');
  return m ? Number(m[1]) : undefined;
}

export async function proveLive(
  url: string,
  ids: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<LiveProof> {
  // A DISTINCT CACHE KEY. `_sb` rather than a bare `t`: the storefront's own
  // preview route reads `t`, and colliding with a parameter the platform
  // already means something by is how a cache-buster becomes a bug report.
  const bust = new URL(url);
  bust.searchParams.set('_sb', String(Date.now()));
  let res: Response;
  try {
    res = await fetchImpl(bust.toString(), { headers: { 'Cache-Control': 'no-cache' } });
  } catch (e) {
    return {
      url,
      status: 0,
      serving: false,
      checked: ids.length,
      note:
        `The live page could not be reached (${(e as Error).message}). The publish itself ` +
        'succeeded — this check did not run, which is not the same as the page being wrong.',
    };
  }
  const html = await res.text();
  const missing = ids.filter((id) => !html.includes(`id="${id}"`));
  const maxAge = maxAgeOf(res.headers.get('cache-control'));
  const etag = res.headers.get('etag') ?? undefined;
  return {
    url,
    status: res.status,
    serving: res.ok && missing.length === 0,
    checked: ids.length,
    ...(missing.length ? { missing } : {}),
    ...(maxAge !== undefined ? { max_age: maxAge } : {}),
    ...(etag ? { etag } : {}),
    ...(res.ok && missing.length === 0 && maxAge
      ? {
          note:
            `The origin is serving this revision. Another viewer's browser may hold the ` +
            `previous page for up to ${maxAge}s (cache-control: max-age=${maxAge}) — that is ` +
            'the platform\'s own caching, not a failed publish, and a hard reload ends it.',
        }
      : {}),
    ...(res.ok && missing.length > 0
      ? {
          note:
            'The page answered, and the markup does not carry every band this publish put in ' +
            'it. Either something in front of the origin is still serving the previous copy, ' +
            'or the page being served is built from a different document — re-run this check ' +
            'once before treating it as the second.',
        }
      : {}),
  };
}
