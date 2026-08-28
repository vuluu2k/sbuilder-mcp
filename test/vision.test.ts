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
    // Asserted field by field rather than by whole-object equality: a box grew
    // fontPx and hasText for the layout measurements, and an exact match would
    // fail every time the shape usefully gains something.
    expect(shots[0].boxes.length).toBe(1);
    expect(shots[0].boxes[0]).toMatchObject({
      id: 'fs_1a2b3c4d',
      type: 'flex-section',
      x: 8,
      y: 8,
      w: 300,
      h: 120,
    });
  }, 30_000);

  const page =
    '<section id="fs_1a2b3c4d" class="wb-flex-section" style="width:300px;height:120px;background:#eee"></section>' +
    '<div id="sp_00000000" class="wb-spacer" style="height:2000px"></div>';

  it('frames ONE node, and the result is smaller than the whole page', async () => {
    const url = `data:text/html,${encodeURIComponent(page)}`;
    const full = await shoot(url, { widths: [1440] });
    const one = await shoot(url, { widths: [1440], node: 'fs_1a2b3c4d' });
    // A 2000px filler below makes the full-page shot much taller; the framed one
    // is the card plus padding. If clipping silently did nothing these would be
    // the same bytes.
    expect(one[0].pngBase64.length).toBeLessThan(full[0].pngBase64.length);
    // The boxes still come back — framing changes the picture, not the measurements.
    expect(one[0].boxes.map((b) => b.id)).toContain('fs_1a2b3c4d');
  }, 30_000);

  it('says the node is not on the page rather than returning the wrong picture', async () => {
    await expect(
      shoot(`data:text/html,${encodeURIComponent(page)}`, { widths: [1440], node: 'he_deadbeef' }),
    ).rejects.toThrow(/not on the rendered page/i);
  }, 30_000);

  it('refuses a node that renders with no size', async () => {
    const collapsed = '<div id="fs_1a2b3c4d" class="wb-flex-section"></div>';
    await expect(
      shoot(`data:text/html,${encodeURIComponent(collapsed)}`, { widths: [1440], node: 'fs_1a2b3c4d' }),
    ).rejects.toThrow(/no size/i);
  }, 30_000);
});

// Opt-in: the measurements only mean anything against a real layout engine.
describe.runIf(process.env.SB_BROWSER_TEST === '1')('measured against a real render', () => {
  it('catches a block that spills past a narrow viewport', async () => {
    const html =
      '<section id="fs_1a2b3c4d" class="wb-flex-section" style="width:900px;height:80px"></section>';
    const { measure } = await import('../src/vision/measure.js');
    const shots = await shoot(`data:text/html,${encodeURIComponent(html)}`, { widths: [1440, 390] });
    const found = measure(shots);
    const spill = found.find((f) => f.code === 'off_canvas');
    expect(spill).toBeDefined();
    // Fine on desktop, broken on the phone — the widths ARE the diagnosis.
    expect(spill!.widths).toEqual([390]);
  }, 40_000);

  it('catches text the browser renders too small to read', async () => {
    const html =
      '<p id="tx_1a2b3c4d" class="wb-text" style="font-size:9px">Terms and conditions apply</p>';
    const { measure } = await import('../src/vision/measure.js');
    const shots = await shoot(`data:text/html,${encodeURIComponent(html)}`, { widths: [390] });
    expect(measure(shots).some((f) => f.code === 'text_too_small')).toBe(true);
  }, 40_000);
});
