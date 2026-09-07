import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { chromium } from 'playwright-core';
import { previewUrl } from '../src/vision/preview.js';
import { shoot, closeBrowser, setLauncherForTest } from '../src/vision/shoot.js';
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

// Runs WITHOUT Chrome: the launcher is swapped for one that throws, which is
// what a machine with no Chrome looks like from here. The message must name
// Chrome — a blank image would have the agent judge a page it never saw.
describe('shoot() without Chrome', () => {
  afterEach(async () => {
    setLauncherForTest();
    await closeBrowser();
  });

  it('names Chrome when the launch fails, and tries again on the next call', async () => {
    await closeBrowser();
    let launches = 0;
    setLauncherForTest(async () => {
      launches++;
      throw new Error('ENOENT: no such browser');
    });
    await expect(shoot('data:text/html,hi', { widths: [1440] })).rejects.toThrow(
      /could not launch Google Chrome.*ENOENT/s,
    );
    // A failed launch is not cached as "the browser": the second call launches
    // again (and fails again) rather than replaying the first failure.
    await expect(shoot('data:text/html,hi', { widths: [1440] })).rejects.toThrow(/Google Chrome/);
    expect(launches).toBe(2);
  });
});

// Opt-in: launches the system Chrome. Kept out of the default run because a
// machine without Chrome must FAIL LOUDLY when sb_look is used, rather than have
// a test skip quietly and read as green.
describe.runIf(process.env.SB_BROWSER_TEST === '1')('shoot()', () => {
  afterAll(async () => {
    setLauncherForTest();
    await closeBrowser();
  });

  it('launches Chrome ONCE and reuses it across calls', async () => {
    // Proved by counting, not assumed: the real launcher is wrapped so every
    // launch is seen, then two looks are taken and only one launch happened.
    await closeBrowser();
    let launches = 0;
    setLauncherForTest(async () => {
      launches++;
      return chromium.launch({ channel: 'chrome', headless: true });
    });
    try {
      const url = 'data:text/html,<p id="tx_00000001" class="wb-text">a</p>';
      await shoot(url, { widths: [390] });
      await shoot(url, { widths: [390] });
      expect(launches).toBe(1);
      // ...and once the browser is gone, the next call launches again rather
      // than failing on a dead handle.
      await closeBrowser();
      await shoot(url, { widths: [390] });
      expect(launches).toBe(2);
    } finally {
      setLauncherForTest();
      await closeBrowser();
    }
  }, 60_000);

  it('shoots the widths in parallel and returns them in the order asked', async () => {
    const html = '<section id="fs_1a2b3c4d" class="wb-flex-section" style="width:200px;height:50px"></section>';
    // Deliberately NOT sorted, so an implementation that returned shots in
    // completion order (the narrow page tends to finish first) would fail.
    const widths = [1440, 390, 768, 1024];
    const shots = await shoot(`data:text/html,${encodeURIComponent(html)}`, { widths });
    expect(shots.map((s) => s.width)).toEqual(widths);
    for (const s of shots) expect(s.boxes[0]).toMatchObject({ id: 'fs_1a2b3c4d', w: 200, h: 50 });
  }, 40_000);

  it('encodes JPEG by default and PNG when asked', async () => {
    const url = 'data:text/html,<p id="tx_00000001" class="wb-text">hello</p>';
    const [jpeg] = await shoot(url, { widths: [390] });
    expect(jpeg.mimeType).toBe('image/jpeg');
    // The bytes must match the label: a JPEG starts FF D8, a PNG with the
    // "\x89PNG" signature. A mimeType that lied would have the client decode
    // the wrong codec.
    expect(Buffer.from(jpeg.imageBase64, 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    const [png] = await shoot(url, { widths: [390], format: 'png' });
    expect(png.mimeType).toBe('image/png');
    expect(Buffer.from(png.imageBase64, 'base64').subarray(1, 4).toString('latin1')).toBe('PNG');
  }, 40_000);

  it('returns an image and the real bounding box of every node id', async () => {
    // Shaped like the RENDERER's own output: node id as the HTML id, type as a
    // leading wb- class. The `nope` div proves an arbitrary id is not a node.
    const html =
      '<section id="fs_1a2b3c4d" class="wb-flex-section" style="width:300px;height:120px"></section>' +
      '<div id="nope" style="width:10px;height:10px"></div>';
    const shots = await shoot(`data:text/html,${encodeURIComponent(html)}`, { widths: [1440] });
    expect(shots.length).toBe(1);
    expect(shots[0].width).toBe(1440);
    expect(shots[0].imageBase64.length).toBeGreaterThan(100);
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
    expect(one[0].imageBase64.length).toBeLessThan(full[0].imageBase64.length);
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
  afterAll(async () => {
    await closeBrowser();
  });

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

describe('shoot() page hygiene', () => {
  it('closes every tab it opened even when the first width fails before the second opens', async () => {
    await closeBrowser();
    let closed = 0;
    const page = (delay: number) =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              goto: async () => {
                throw new Error('boom');
              },
              close: async () => {
                closed++;
              },
            }),
          delay,
        ),
      );
    let n = 0;
    setLauncherForTest(async () =>
      ({
        isConnected: () => true,
        newPage: () => page(n++ === 0 ? 0 : 30),
        close: async () => {},
      }) as unknown as import('playwright-core').Browser,
    );
    try {
      await expect(shoot('data:text/html,x', { widths: [1440, 390] })).rejects.toThrow(/boom/);
      await new Promise((r) => setTimeout(r, 80));
      expect(closed).toBe(2);
    } finally {
      setLauncherForTest();
      await closeBrowser();
    }
  });
});

describe('browser reuse, without needing Chrome', () => {
  it('launches once and reuses the browser across calls', async () => {
    // Proved in the DEFAULT suite with a stub: the gated tests prove it with a
    // real Chrome, but a claim only checked behind SB_BROWSER_TEST=1 is a claim
    // most runs never check. newPage throws, so no page work is stubbed — the
    // point is only how many times the launcher ran.
    await closeBrowser();
    let launches = 0;
    setLauncherForTest(async () => {
      launches++;
      return {
        isConnected: () => true,
        newPage: async () => {
          throw new Error('stub: no pages');
        },
        close: async () => {},
      } as unknown as import('playwright-core').Browser;
    });
    try {
      await expect(shoot('data:text/html,x', { widths: [390] })).rejects.toThrow(/stub/);
      await expect(shoot('data:text/html,x', { widths: [390] })).rejects.toThrow(/stub/);
      expect(launches).toBe(1);
      await closeBrowser();
      await expect(shoot('data:text/html,x', { widths: [390] })).rejects.toThrow(/stub/);
      expect(launches).toBe(2);
    } finally {
      setLauncherForTest();
      await closeBrowser();
    }
  });
});

describe('sb_look targets', () => {
  it('shoots the address it was given instead of minting a preview', async () => {
    // The escape hatch that closes the vision loop: a draft preview threads no
    // store data, so a product grid is empty there however correct it is. It is
    // also the way out when the minted preview origin is unreachable.
    await closeBrowser();
    const seen: string[] = [];
    setLauncherForTest(async () =>
      ({
        isConnected: () => true,
        newPage: async () => ({
          goto: async (u: string) => {
            seen.push(u);
            throw new Error('stub: no rendering');
          },
          close: async () => {},
        }),
        close: async () => {},
      }) as unknown as import('playwright-core').Browser,
    );
    try {
      await expect(
        shoot('https://shop.example/ca-phe', { widths: [1440] }),
      ).rejects.toThrow(/stub/);
      expect(seen).toEqual(['https://shop.example/ca-phe']);
    } finally {
      setLauncherForTest();
      await closeBrowser();
    }
  });
});
