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
