import { describe, it, expect, vi } from 'vitest';
import { previewUrl } from '../src/vision/preview.js';
import { shoot } from '../src/vision/shoot.js';
import { Session } from '../src/transport/auth.js';

function ctxWith(f: typeof fetch) {
  const s = new Session('http://x', f);
  (s as unknown as { access: string }).access = 'jwt';
  return { base: 'http://x', session: s, fetchImpl: f };
}

describe('previewUrl()', () => {
  it('unwraps the preview envelope', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ preview: { url: 'http://store/_wb/preview?t=abc' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    expect(await previewUrl(ctxWith(f), 's1', 'pg_1')).toBe('http://store/_wb/preview?t=abc');
  });

  it('resolves a RELATIVE link against the API base - dev returns a path, not a url', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ preview: { url: '/_wb/preview?t=abc' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    expect(await previewUrl(ctxWith(f), 's1', 'pg_1')).toBe('http://x/_wb/preview?t=abc');
  });

  it('says what is missing when the server sends no url', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ preview: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    await expect(previewUrl(ctxWith(f), 's1', 'pg_1')).rejects.toThrow(/no preview url/i);
  });
});

// Opt-in: launches the system Chrome. Kept out of the default run because a
// machine without Chrome must FAIL LOUDLY when sb_look is used, rather than have
// a test skip quietly and read as green.
describe.runIf(process.env.SB_BROWSER_TEST === '1')('shoot()', () => {
  it('returns a png and the real bounding box of every data-node-id', async () => {
    // Shaped like the RENDERER's own output: node id as the HTML id, type as a
    // leading wb- class. The `nope` div proves an arbitrary id is not a node.
    const html =
      '<section id="fs_1a2b3c4d" class="wb-flex-section" style="width:300px;height:120px"></section>' +
      '<div id="nope" style="width:10px;height:10px"></div>';
    const shots = await shoot(`data:text/html,${encodeURIComponent(html)}`, { widths: [1440] });
    expect(shots.length).toBe(1);
    expect(shots[0].width).toBe(1440);
    expect(shots[0].pngBase64.length).toBeGreaterThan(100);
    expect(shots[0].boxes).toEqual([
      { id: 'fs_1a2b3c4d', type: 'flex-section', x: 8, y: 8, w: 300, h: 120 },
    ]);
  }, 30_000);
});
