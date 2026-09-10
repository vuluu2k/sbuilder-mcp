import { describe, it, expect } from 'vitest';
import { searchStock, SearchUnavailable } from '../src/transport/stock.js';
import { Session } from '../src/transport/auth.js';
import { connectedClient } from './harness.js';

/**
 * A SEARCH IS NOT A GUESS, and the key is not this server's to hold.
 *
 * Rule 7 records what a keyword glued into a URL returns: `loremflickr`
 * answered "kids,clothing" with a cat statue. The fault was never stock
 * photography — it was that nobody looked. Every result here carries what it
 * SHOWS, and the tool refuses to upload anything nobody picked.
 *
 * The provider key lives on the PLATFORM, behind a rotated pool, so there is no
 * second secret in every install and no quota shared with another product. When
 * the platform cannot search, this server does not try to: a fallback provider
 * would put that key straight back into every install.
 */
const photo = (over: Record<string, unknown> = {}) => ({
  id: 7,
  alt: 'Cute child near a doorway',
  width: 4000,
  height: 2664,
  photographer: 'Mochi Mochi',
  photographerUrl: 'https://www.pexels.com/@mochi',
  pageUrl: 'https://www.pexels.com/photo/7/',
  url: 'https://images.pexels.com/photos/7/x.jpeg',
  ...over,
});

function ctxOver(f: typeof fetch) {
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  return { base: 'http://x', session, fetchImpl: f } as unknown as Parameters<typeof searchStock>[0];
}

const serving = (body: unknown, status = 200) => {
  const calls: string[] = [];
  const f = (async (input: string | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { f, calls };
};

describe('searchStock()', () => {
  it('asks the PLATFORM, with the credential this server already holds', async () => {
    const { f, calls } = serving({ photos: [photo()] });
    const out = await searchStock(ctxOver(f), 's1', 'trẻ em', { orientation: 'landscape' });
    expect(calls[0]).toContain('/api/sites/s1/images/search');
    expect(calls[0]).toContain('orientation=landscape');
    expect(out[0].alt).toBe('Cute child near a doorway');
    expect(out[0].photographer).toBe('Mochi Mochi');
  });

  it('drops a result with no file rather than returning a broken one', async () => {
    const { f } = serving({ photos: [photo({ url: '' }), photo()] });
    expect(await searchStock(ctxOver(f), 's1', 'x')).toHaveLength(1);
  });

  it('reads "no usable key" and "no such route" as the SAME answer', async () => {
    // 503 is the platform saying it has no key; 404 is a deployment older than
    // the route. To the caller both mean "no search here", and both deserve an
    // instruction rather than an error.
    for (const status of [503, 404]) {
      const { f } = serving({ error: 'nope', code: 'image_search_unavailable' }, status);
      await expect(searchStock(ctxOver(f), 's1', 'x')).rejects.toBeInstanceOf(SearchUnavailable);
    }
  });

  it('does NOT swallow a real failure', async () => {
    const { f } = serving({ error: 'boom', code: 'image_search_failed' }, 502);
    await expect(searchStock(ctxOver(f), 's1', 'x')).rejects.not.toBeInstanceOf(SearchUnavailable);
  });
});

describe('sb_media_upload — searching', () => {
  async function call(body: unknown, args: Record<string, unknown>, status = 200) {
    const f = (async (input: string | URL) =>
      String(input).includes('/images/search')
        ? new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
        : new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({ fetchImpl: f, session });
    const res = (await client.callTool({
      name: 'sb_media_upload',
      arguments: { site_id: 's1', ...args },
    })) as { content: Array<{ text?: string }> };
    await close();
    return JSON.parse(res.content[0].text!);
  }

  it('answers a query with what each photo shows, and uploads NOTHING', async () => {
    const out = await call({ photos: [photo(), photo({ id: 9, alt: 'Another one' })] }, { query: 'trẻ em' });
    expect(out.found.map((f: { pick: number }) => f.pick)).toEqual([7, 9]);
    expect(out.found[0].shows).toBe('Cute child near a doorway');
    expect(out.asset).toBeUndefined();
  });

  it('refuses a pick it does not have, and shows the list again', async () => {
    const out = await call({ photos: [photo()] }, { query: 'x', pick: 999, dry_run: false });
    expect(out.no_such_pick).toBe(999);
    expect(out.asset).toBeUndefined();
  });

  it('a chosen photo still dry-runs first, like every other write here', async () => {
    const out = await call({ photos: [photo()] }, { query: 'x', pick: 7 });
    expect(out.dry_run).toBe(true);
    expect(out.would_upload).toContain('pexels.com');
  });

  it('hands the work BACK to the caller when the platform cannot search', async () => {
    // Not an error: an agent with a web search of its own loses nothing — it
    // finds a photograph and passes the URL, and the platform fetches it
    // server-side exactly as it would have. A fallback provider here would put
    // the key the platform exists to hold back into every install.
    const out = await call({ code: 'image_search_unavailable' }, { query: 'x' }, 503);
    expect(out.search_unavailable).toBeTruthy();
    expect(out.next).toMatch(/pass its URL to sb_media_upload/);
    expect(out.next).toMatch(/admin Settings area/);
    expect(out.next).toMatch(/PEXELS_API_KEYS/);
  });
});

/**
 * STOCKING A SITE THIS SERVER JUST BUILT.
 *
 * A new site's library is EMPTY, so every picture slot in every layout pattern
 * is a sentence until somebody fills it — and one search answers with eight
 * photographs while a gallery band wants six. At one pick per call that is
 * twelve round trips for one band, which is how a correct rule becomes a rule
 * nobody follows.
 *
 * Taking several does not weaken rule 7. What that rule protects is that
 * somebody LOOKED: reading eight descriptions and choosing six is the same act
 * of choosing as reading eight and choosing one. What it forbids is uploading a
 * hit nobody read — and no `pick` still uploads nothing.
 */
describe('sb_media_upload — stocking a library in one call', () => {
  const eight = { photos: Array.from({ length: 8 }, (_, i) => photo({ id: i + 1, alt: `Shot ${i + 1}` })) };

  async function call(args: Record<string, unknown>) {
    const sent: string[] = [];
    const f = (async (input: string | URL) => {
      const at = String(input);
      sent.push(at);
      if (at.includes('/images/search')) {
        return new Response(JSON.stringify(eight), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (at.includes('/from-url')) {
        const n = sent.filter((u) => u.includes('/from-url')).length;
        return new Response(JSON.stringify({ asset: { id: `mda_${n}`, url: `https://cdn/site/${n}.jpg` } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({ fetchImpl: f, session });
    const res = (await client.callTool({
      name: 'sb_media_upload',
      arguments: { site_id: 's1', ...args },
    })) as { content: Array<{ text?: string }> };
    await close();
    return { out: JSON.parse(res.content[0].text!), sent };
  }

  it('uploads every photo the caller chose, and only those', async () => {
    const { out, sent } = await call({ query: 'x', pick: [2, 4, 6], dry_run: false });
    expect(out.uploaded).toHaveLength(3);
    expect(sent.filter((u) => u.includes('/from-url'))).toHaveLength(3);
    expect(out.uploaded.map((u: { shows: string }) => u.shows)).toEqual(['Shot 2', 'Shot 4', 'Shot 6']);
  });

  it('names the library as what a pattern reads, because that is the next step', async () => {
    const { out } = await call({ query: 'x', pick: [1, 2], dry_run: false });
    expect(out.next).toMatch(/sb_template_use/);
  });

  it('still dry-runs first, and shows every photo it would take', async () => {
    const { out, sent } = await call({ query: 'x', pick: [1, 3] });
    expect(out.dry_run).toBe(true);
    expect(out.would_upload).toHaveLength(2);
    expect(sent.some((u) => u.includes('/from-url'))).toBe(false);
  });

  it('REFUSES A PARTIAL PICK WHOLE rather than uploading the half it recognised', async () => {
    // The caller named a set. Delivering some of it and reporting the rest as a
    // note leaves them to work out which slots they can still fill — and the
    // photos that did land are already in the library by then.
    const { out, sent } = await call({ query: 'x', pick: [1, 999], dry_run: false });
    expect(out.no_such_pick).toBe(999);
    expect(out.uploaded).toBeUndefined();
    expect(sent.some((u) => u.includes('/from-url'))).toBe(false);
  });

  it('keeps the ONE-photo answer exactly as it was', async () => {
    // A caller that asked about one photograph gets one answer about one
    // photograph; only a caller that asked for several is handed a list.
    const { out } = await call({ query: 'x', pick: 5, dry_run: false });
    expect(out.asset.id).toBe('mda_1');
    expect(out.uploaded).toBeUndefined();
    expect(out.next).toMatch(/sb_set/);
  });
});
