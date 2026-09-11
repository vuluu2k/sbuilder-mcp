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

  /**
   * FRAMING A NODE BELOW THE FOLD, which used to be impossible.
   *
   * A clip turned `fullPage` OFF, so the screenshot was of the VIEWPORT and a
   * clip was only satisfiable inside the first 900px. Anything further down
   * failed with Playwright's "Clipped area is either empty or outside the
   * resulting image", naming neither the node nor the reason — on a 4,051px
   * page that is most of the page.
   */
  it('frames a node that sits below the first viewport', async () => {
    const html =
      '<div style="height:1600px"></div>' +
      '<div id="fs_11111111" class="wb-flex-section" style="height:200px;background:#E8557A"></div>';
    const shots = await shoot(`data:text/html,${encodeURIComponent(html)}`, {
      widths: [800],
      node: 'fs_11111111',
    });
    expect(shots[0].imageBase64.length).toBeGreaterThan(0);
  }, 60_000);

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

  /**
   * A REVEAL-ON-SCROLL SECTION PHOTOGRAPHED AS AN EMPTY BAND.
   *
   * `trigger: "view"` compiles to `animation-timeline: view()`, whose progress
   * is a function of where the element sits in the scrollport — and the lazy-
   * image walk scrolls and then RETURNS TO THE TOP, so a revealed section is
   * back at its `from` keyframe (`opacity: 0`) when the shutter opens. The walk
   * cannot fix it; the walk's own return is what causes it.
   *
   * MEASURED before the fix: a four-band page came back with the revealed band
   * entirely blank and the other three correct. The honest reading of that
   * picture is "this band is broken", which sends the caller to fix a page that
   * works — the same cost the lazy-image walk exists to prevent.
   *
   * ASSERTED BY DIFFING TWO SHOTS, which is what makes this able to fail. The
   * two pages are byte-for-byte identical apart from the `@supports` block that
   * turns the entrance into a reveal — so once animations are settled they must
   * PHOTOGRAPH identically. They do not when the band is invisible, and the
   * first version of this test missed that: it applied the override inside the
   * test and asserted on the result, which stays green with the fix removed
   * from `shoot.ts` entirely. An assertion that cannot go red is the "green
   * suite over a defect" this repo keeps closing.
   */
  it('settles a reveal-on-scroll band instead of photographing it blank', async () => {
    const body =
      '<div style="height:1200px"></div>' +
      '<section id="fs_5e5e5e5e" class="wb-flex-section" ' +
      'style="height:300px;background:#E8557A">revealed</section>';
    const keyframes = '<style>@keyframes fade_in{from{opacity:0}to{opacity:1}}' +
      '#fs_5e5e5e5e{animation:fade_in .5s ease both}';
    const plain = `${keyframes}</style>${body}`;
    const reveal =
      `${keyframes}@supports (animation-timeline: view()){#fs_5e5e5e5e{` +
      `animation-timeline:view();animation-range:entry 0% entry 60%}}</style>${body}`;

    const shotOf = async (html: string) =>
      (await shoot(`data:text/html,${encodeURIComponent(html)}`, { widths: [1440] }))[0]
        .imageBase64;

    // A plain entrance has finished by the time the shutter opens, so it is the
    // control: whatever it looks like is what the revealed one must look like.
    expect(await shotOf(reveal)).toBe(await shotOf(plain));
  }, 40_000);
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

  /**
   * THE SHOT MUST NOT PAY FOR A TIMEOUT IT KNOWS WILL NOT RESOLVE.
   *
   * `waitForLoadState('networkidle', { timeout: 2_500 })` ran to its cap on
   * every look of a real storefront — measured 2502 ms of a 2847 ms total, three
   * runs out of three — because a storefront never goes idle, which the code
   * that added it already said in its own comment. A DOM-quiet wait answers the
   * question actually being asked and answers it when it becomes true.
   *
   * A page that CANNOT settle is the case worth pinning: an animation that never
   * stops must not hold the shot forever.
   */
  it('photographs a page whose DOM never stops changing, without hanging', async () => {
    const html =
      '<div id="fs_1a2b3c4d" class="wb-flex-section" style="width:200px;height:40px">x</div>' +
      '<script>setInterval(() => { document.title = String(Date.now()); }, 10);</script>';
    const started = Date.now();
    const shots = await shoot(`data:text/html,${encodeURIComponent(html)}`, { widths: [390] });
    const elapsed = Date.now() - started;
    expect(shots[0].imageBase64.length).toBeGreaterThan(0);
    // The settle caps at 2s; the whole shot must land well inside the old
    // networkidle budget rather than waiting on a page that never quiets.
    expect(elapsed).toBeLessThan(20_000);
  }, 40_000);

  it('waits long enough that a late-rendered element is in the picture', async () => {
    const html =
      '<div id="fs_00000001" class="wb-flex-section"></div>' +
      '<script>setTimeout(() => {' +
      'const d = document.createElement("div");' +
      'd.id = "fs_1a2b3c4d"; d.className = "wb-flex-section";' +
      'd.setAttribute("style", "width:900px;height:80px");' +
      'document.body.appendChild(d); }, 120);</script>';
    const { measure } = await import('../src/vision/measure.js');
    const shots = await shoot(`data:text/html,${encodeURIComponent(html)}`, { widths: [390] });
    // The late block is 900px wide in a 390px viewport. Seeing it at all proves
    // the shot did not fire before the page finished rendering.
    expect(measure(shots).some((f) => f.nodeId === 'fs_1a2b3c4d')).toBe(true);
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
