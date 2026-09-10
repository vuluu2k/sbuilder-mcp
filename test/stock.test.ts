import { describe, it, expect, afterEach } from 'vitest';
import { searchStock } from '../src/transport/stock.js';
import { connectedClient } from './harness.js';

/**
 * A SEARCH IS NOT A GUESS, and that is the whole point of this file.
 *
 * Rule 7 records what a keyword glued into a URL returns: `loremflickr` answered
 * "kids,clothing" with a cat statue and a photo of an adult. The fault was never
 * stock photography — it was that nobody looked. Every result here carries what
 * it SHOWS, so the caller reads and chooses, and the tool refuses to upload
 * anything nobody picked.
 *
 * Pexels because it is already this family's answer: `webcake-landing-mcp` ships
 * the same client down to the shared proxy, and a second house standard for one
 * job is a second place for it to drift.
 */
const photo = (over: Record<string, unknown> = {}) => ({
  id: 7,
  alt: 'Cute child near a doorway',
  width: 4000,
  height: 2664,
  photographer: 'Mochi Mochi',
  photographer_url: 'https://www.pexels.com/@mochi',
  url: 'https://www.pexels.com/photo/7/',
  src: { original: 'https://x/o.jpg', large: 'https://x/l.jpg', large2x: 'https://x/l2.jpg' },
  ...over,
});

const answering = (body: unknown, status = 200) => {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    calls.push([String(input), init]);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { f, calls };
};

afterEach(() => {
  delete process.env.PEXELS_API_KEY;
  delete process.env.PEXELS_PROXY_BASE;
});

describe('searchStock()', () => {
  it('carries what each photo SHOWS, which is the half a keyword cannot give', async () => {
    const { f } = answering({ photos: [photo()] });
    const out = await searchStock(f, 'trẻ em');
    expect(out.photos[0].alt).toBe('Cute child near a doorway');
    expect(out.photos[0].photographer).toBe('Mochi Mochi');
  });

  it("uploads large2x — a hero at 1440 without the native file's tens of megabytes", async () => {
    const { f } = answering({ photos: [photo()] });
    expect((await searchStock(f, 'x')).photos[0].url).toBe('https://x/l2.jpg');
    const { f: f2 } = answering({ photos: [photo({ src: { original: 'https://x/o.jpg' } })] });
    expect((await searchStock(f2, 'x')).photos[0].url).toBe('https://x/o.jpg');
  });

  it('drops a result with no usable file rather than returning a broken one', async () => {
    const { f } = answering({ photos: [photo({ src: {} }), photo()] });
    expect((await searchStock(f, 'x')).photos).toHaveLength(1);
  });

  it('calls PEXELS with a key and the SHARED PROXY without one', async () => {
    // The key is optional on purpose: an `npx` install with no configuration at
    // all still finds images, through the proxy the sibling repo already runs.
    process.env.PEXELS_API_KEY = 'k-secret';
    const { f, calls } = answering({ photos: [] });
    expect((await searchStock(f, 'x')).via).toBe('pexels');
    expect(calls[0][0]).toContain('api.pexels.com');
    expect((calls[0][1]?.headers as Record<string, string>).Authorization).toBe('k-secret');

    delete process.env.PEXELS_API_KEY;
    const { f: f2, calls: c2 } = answering({ photos: [] });
    expect((await searchStock(f2, 'x')).via).toBe('proxy');
    expect(c2[0][0]).toContain('/api/images/search');
    expect((c2[0][1]?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('asks the search for the SHAPE, because cropping afterwards is the rule-6 mistake', async () => {
    const { f, calls } = answering({ photos: [] });
    await searchStock(f, 'x', { orientation: 'landscape' });
    expect(calls[0][0]).toContain('orientation=landscape');
  });

  it('names the door and the key when the search refuses', async () => {
    const { f } = answering({ error: 'nope' }, 429);
    await expect(searchStock(f, 'x')).rejects.toThrow(/proxy.*429|429.*proxy/s);
    await expect(searchStock(f, 'x')).rejects.toThrow(/PEXELS_API_KEY/);
  });
});

describe('sb_media_upload — searching', () => {
  const serving = (body: unknown) =>
    (async (input: string | URL) => {
      if (String(input).includes('images/search')) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

  async function call(args: Record<string, unknown>) {
    const f = serving({ photos: [photo(), photo({ id: 9, alt: 'Another one' })] });
    const { client, close } = await connectedClient({ fetchImpl: f });
    const res = (await client.callTool({
      name: 'sb_media_upload',
      arguments: { site_id: 's1', ...args },
    })) as { content: Array<{ text?: string }> };
    await close();
    return JSON.parse(res.content[0].text!);
  }

  it('answers a query with what each photo shows, and uploads NOTHING', async () => {
    const out = await call({ query: 'trẻ em' });
    expect(out.found.map((f: { pick: number }) => f.pick)).toEqual([7, 9]);
    expect(out.found[0].shows).toBe('Cute child near a doorway');
    expect(out.asset).toBeUndefined();
  });

  it('refuses a pick it does not have, and shows the list again', async () => {
    const out = await call({ query: 'x', pick: 999, dry_run: false });
    expect(out.no_such_pick).toBe(999);
    expect(out.found).toHaveLength(2);
    expect(out.asset).toBeUndefined();
  });

  it('a chosen photo still dry-runs first, like every other write here', async () => {
    const out = await call({ query: 'x', pick: 7 });
    expect(out.dry_run).toBe(true);
    expect(out.would_upload).toBe('https://x/l2.jpg');
    expect(out.shows).toBe('Cute child near a doorway');
  });
});
