import { chromium, type Browser, type Page } from 'playwright-core';

/**
 * The browser globals the `page.evaluate` body below uses.
 *
 * Declared here, module-scoped, rather than adding "DOM" to tsconfig's `lib`.
 * That would tell the WHOLE server it runs in a browser — it does not — and
 * would put DOM's `fetch`/`Response` types in conflict with @types/node's,
 * which every other file in this repo relies on. Narrow and local is the honest
 * shape: exactly the two calls that really do run in Chrome, type-checked, and
 * no claim beyond them.
 */
declare const document: {
  querySelectorAll(selector: string): Array<{
    id: string;
    className: string;
    parentElement: { id: string } | null;
    getBoundingClientRect(): { x: number; y: number; width: number; height: number };
    textContent: string | null;
    complete?: boolean;
    naturalWidth?: number;
  }>;
  body: { scrollHeight: number };
  /** The MutationObserver root — the whole tree, so nothing that renders is missed. */
  documentElement: unknown;
};
declare function getComputedStyle(el: unknown): { fontSize: string };
declare const window: {
  innerWidth: number;
  innerHeight: number;
  scrollTo(x: number, y: number): void;
};
declare function setTimeout(fn: () => void, ms: number): unknown;
declare function setInterval(fn: () => void, ms: number): unknown;
declare function clearInterval(handle: unknown): void;
declare class MutationObserver {
  constructor(cb: () => void);
  observe(target: unknown, opts: Record<string, boolean>): void;
  disconnect(): void;
}

export interface Box {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Computed font size in px — a rendered fact, not a stored style. */
  fontPx?: number;
  /** Whether this element carries visible text of its own. */
  hasText?: boolean;
}

export type ShotFormat = 'jpeg' | 'png';

export interface Shot {
  width: number;
  /** Base64 of the encoded image; `mimeType` says which encoding. */
  imageBase64: string;
  mimeType: 'image/jpeg' | 'image/png';
  boxes: Box[];
}

/** The three widths the platform's own breakpoints care about. */
export const DEFAULT_WIDTHS = [1440, 768, 390];

/**
 * JPEG at 80 by default. A full-page storefront screenshot is a third the
 * bytes as JPEG and encodes faster than PNG, and neither changes what the
 * agent pays for: the client prices an image by its PIXEL dimensions, not by
 * its byte size, so the format moves bytes on the wire and latency, not
 * tokens. PNG stays available for the one case JPEG is wrong — judging an
 * exact colour, where 8×8 block artefacts would put a tint on a flat fill.
 */
const DEFAULT_FORMAT: ShotFormat = 'jpeg';
const JPEG_QUALITY = 80;

/**
 * Launch the SYSTEM Chrome — `channel: 'chrome'`, not a bundled browser.
 *
 * `playwright-core` ships no browsers, so installing this package downloads
 * nothing. When Chrome is absent the launch throws, and this re-throws NAMING
 * it: a vision loop that quietly returns a blank image is worse than one that
 * refuses, because the agent would go on to judge a page it never saw.
 */
async function launch(): Promise<Browser> {
  try {
    return await launcher();
  } catch (err) {
    throw new Error(
      'sbuilder: could not launch Google Chrome for the screenshot. sb_look needs Chrome ' +
        `installed — playwright-core bundles no browser. Underlying error: ${String(err)}`,
    );
  }
}

type Launcher = () => Promise<Browser>;
// Playwright installs its OWN SIGINT/SIGTERM/SIGHUP handlers by default, and
// its SIGTERM handler closes browsers without exiting. Its handlers live until
// the browser process closes, so a signal re-raised by this module could land
// while Playwright is still listening and the server would survive a signal it
// should die on. This module owns the handlers; Playwright gets none.
const realLauncher: Launcher = () =>
  chromium.launch({
    channel: 'chrome',
    headless: true,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
let launcher: Launcher = realLauncher;

/**
 * Tests only: swap the thing that launches Chrome. A throwing launcher
 * exercises the missing-Chrome message without uninstalling Chrome, and a
 * counting one proves the browser is reused rather than assumed to be.
 * Pass nothing to restore the real one.
 */
export function setLauncherForTest(fn?: Launcher): void {
  launcher = fn ?? realLauncher;
}

/**
 * ONE Chrome per process, launched on first use and kept.
 *
 * Launching Chrome was the largest fixed cost of every `sb_look` — roughly a
 * second before a single pixel is drawn — and a vision loop calls it after
 * every edit. The browser is process state, not call state: it is launched
 * lazily, reused while it is still connected, and relaunched if Chrome went
 * away underneath (crashed, was killed, closed by a test). `browserPromise`
 * rather than `browser` so two concurrent first calls share one launch instead
 * of racing to start two.
 */
let browserPromise: Promise<Browser> | undefined;

async function browser(): Promise<Browser> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => undefined);
    if (b?.isConnected()) return b;
    browserPromise = undefined;
  }
  const p = launch();
  browserPromise = p;
  // A failed launch must not be cached as "the browser": the next call has to
  // try again, and report again, rather than replay the first failure forever.
  p.catch(() => {
    if (browserPromise === p) browserPromise = undefined;
  });
  return p;
}

/** Close the shared Chrome, if one is open. Idempotent; never throws. */
export async function closeBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = undefined;
  if (!p) return;
  const b = await p.catch(() => undefined);
  if (b) await b.close().catch(() => {});
}

/**
 * A kept browser is a child process, and a child process outlives a parent
 * that forgets it. `beforeExit` fires when the event loop drains and CAN await
 * the close (`exit` cannot). A signal kills the loop without draining it, so
 * SIGINT/SIGTERM close Chrome too and then re-raise so the exit code is the
 * one the signal would have produced. Registered once, at module load.
 */
process.once('beforeExit', () => {
  void closeBrowser();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void closeBrowser().finally(() => process.kill(process.pid, signal));
  });
}

/**
 * Photograph a rendered page at several widths, and measure every node.
 *
 * The boxes are the load-bearing half. `cursor` frames on the live-edit socket
 * carry LAYOUT pixels — the canvas is zoomed per viewer, so a screen coordinate
 * lands somewhere else on a peer with a different window — and nothing else in
 * this server knows where a node ended up. Measured here, the agent's cursor
 * moves to the element it is about to change instead of to a made-up number.
 *
 * The widths are shot IN PARALLEL, each in its own page of the one shared
 * browser, and the array comes back in the order `widths` was given — the
 * caller reads `shots[0]` as `widths[0]`. If a width fails, the error thrown is
 * whichever failed FIRST IN TIME, not first in `widths`: with parallel pages
 * those differ, so an error naming a width names the one that actually failed,
 * and a second failing width may go unmentioned.
 */
export async function shoot(
  url: string,
  opts: { widths?: number[]; node?: string; pad?: number; format?: ShotFormat; open?: string } = {},
): Promise<Shot[]> {
  const widths = opts.widths ?? DEFAULT_WIDTHS;
  const format = opts.format ?? DEFAULT_FORMAT;
  const b = await browser();
  // Each page closes in ITS OWN finally. A list of pages closed after
  // Promise.all would miss a page whose `newPage` resolved after the first
  // rejection — and now that the browser lives for the whole process, a leaked
  // tab is leaked forever rather than until the next call.
  return Promise.all(
    widths.map(async (width) => {
      const page = await b.newPage({ viewport: { width, height: 900 } });
      try {
        return await shootOne(page, url, width, format, opts);
      } finally {
        await page.close().catch(() => {});
      }
    }),
  );
}

/**
 * WAIT FOR THE PAGE TO STOP CHANGING, not for the network to go quiet.
 *
 * This used to be `waitForLoadState('networkidle', { timeout: 2_500 })`, with a
 * comment explaining that a storefront never goes idle — the cart island polls,
 * a session endpoint answers 401 forever. That was correct, and it meant the
 * wait ALWAYS ran to its cap: measured at 2502 ms on every single look, three
 * runs out of three, against a 2847 ms total. Eighty-eight per cent of a
 * screenshot was a timeout the code already knew would never resolve, paid after
 * every edit of a vision loop.
 *
 * A MutationObserver answers the question actually being asked — has the page
 * finished rendering — and answers it the moment it is true. Measured on the
 * same three pages: 400-460 ms, with identical content on screen (images,
 * prices, no empty states). The storefront renders its lists SERVER-side, so
 * everything is present a few hundred ms after `load`; the old wait bought
 * nothing but latency.
 *
 * Bounded twice over, and both bounds matter: `quiet` is how long nothing may
 * change before the page counts as settled, and `cap` stops an animation or a
 * polling widget from holding the shot forever. A page that never settles is
 * photographed anyway — a late picture beats none.
 */
async function settleDom(page: Page): Promise<void> {
  await page
    .evaluate(
      ({ quiet, cap }) =>
        new Promise<void>((resolve) => {
          const start = Date.now();
          let last = Date.now();
          const mo = new MutationObserver(() => {
            last = Date.now();
          });
          mo.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          const tick = setInterval(() => {
            const now = Date.now();
            if (now - last >= quiet || now - start >= cap) {
              clearInterval(tick);
              mo.disconnect();
              resolve();
            }
          }, 50);
        }),
      { quiet: 250, cap: 2_000 },
    )
    .catch(() => {});
}

/**
 * WALK THE PAGE so its lazy images load, then come back to the top.
 *
 * `fullPage: true` does NOT scroll: Playwright resizes the capture, and an
 * `<img loading="lazy">` below the fold never enters the viewport, never
 * fetches, and photographs as an empty box. The renderer marks every image
 * below the first screen lazy, so this hit the one thing the vision loop exists
 * to judge — measured on a real storefront: 4 of the page's images unloaded
 * before the walk, 0 after. The agent saw four blank product cards on a page a
 * shopper sees four photos on, and the honest reading of that picture is "the
 * images are broken", which would send it to fix something that works.
 *
 * BOUNDED at every step, because a shot that never happens is worse than one
 * taken a beat early: the walk is capped, and the wait for decoding gives up
 * rather than hanging on an image the server will never send.
 */
async function settleLazyImages(page: Page): Promise<void> {
  // A page with nothing lazy has nothing to walk for, and the walk is 60 ms a
  // screen. Checked rather than assumed: the renderer marks images below the
  // first screen lazy, so a short page legitimately has none.
  const lazy = await page
    .evaluate(() => document.querySelectorAll('img[loading="lazy"]').length)
    .catch(() => 1);
  if (!lazy) return;
  await page
    .evaluate(async () => {
      const step = window.innerHeight || 900;
      const end = document.body.scrollHeight;
      // A very long page is walked in bigger strides rather than not at all.
      const stride = Math.max(step, Math.ceil(end / 40));
      for (let y = 0; y < end; y += stride) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(() => r(undefined), 60));
      }
      window.scrollTo(0, 0);
    })
    .catch(() => {});
  // Give what the walk started a chance to arrive. `complete` is false while a
  // fetch is in flight; a decoded-but-broken image reports complete with a zero
  // natural width, and that is a REAL defect the shot should show, so it is not
  // waited on.
  await page
    .waitForFunction(
      () => [...document.querySelectorAll('img')].every((i) => i.complete === true),
      undefined,
      { timeout: 3_000 },
    )
    .catch(() => {});
}

async function shootOne(
  page: Page,
  url: string,
  width: number,
  format: ShotFormat,
  opts: { node?: string; pad?: number; open?: string },
): Promise<Shot> {
  // LOAD, then a BOUNDED settle — never `networkidle` alone.
  //
  // A storefront keeps connections open: the cart island polls, a customer
  // session endpoint answers 401 forever for a visitor. `networkidle` waits for
  // a quiet moment that never comes and the whole look times out, so a
  // published page — the only place store data renders — could not be
  // photographed at all. Found the first time sb_look was aimed at a real
  // storefront. The settle is best-effort: if the page does go quiet, the shot
  // waits for it; if it never does, the shot happens anyway.
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 });

  // OPEN THE OVERLAY BEFORE MEASURING, or it cannot be photographed at all.
  //
  // A closed drawer is `visibility:hidden` and translated 105% off-screen
  // (`render/nodes/cart-drawer/css.go`), so it measures at x=1461 on a 1440
  // viewport and `page.screenshot({clip})` fails outright: "Clipped area is
  // either empty or outside the resulting image". That made the ONE surface this
  // repo's own guidance insists you look at — "open the cart drawer and look,
  // before calling a site done" — the one surface `sb_look` could not show.
  //
  // `is-open` is the platform's OWN mechanism, not a hack around it: the same
  // class the storefront's cart button toggles, whose rule is `transform:none`
  // plus `visibility:visible`. The scrim takes it too, so the shot matches what
  // a shopper sees rather than a panel floating over bare page.
  if (opts.open) {
    await page.evaluate((id) => {
      // The narrow `document` shim this file declares is for the MEASUREMENT
      // pass; here the real DOM is what runs, so reach it through the cast
      // rather than widening a shim that exists to keep that pass honest.
      const d = document as unknown as {
        getElementById(id: string): { classList: { add(c: string): void } } | null;
        querySelectorAll(sel: string): Array<{ classList: { add(c: string): void } }>;
      };
      d.getElementById(id)?.classList.add('is-open');
      for (const s of d.querySelectorAll('.wb-cart-scrim')) s.classList.add('is-open');
    }, opts.open);
  }

  await settleDom(page);
  await settleLazyImages(page);
  // A RENDERED page carries its node ids as the HTML `id` attribute — not as
  // `data-node-id`, which is the editor CANVAS's hook and never reaches the
  // renderer. Selecting the canvas attribute here returned an empty box list
  // on every real page, silently: the screenshots looked fine, and the half
  // of this function that exists to place the presence cursor did nothing.
  // Found by running it against the Go renderer.
  //
  // Ids are filtered by SHAPE (`xx_8hex`, plus ROOT) rather than taken from
  // every `[id]`, so a wrapper or an anchor target cannot be mistaken for a
  // node. `type` is read off the leading `wb-` class, which is the only type
  // signal the render emits; the caller already knows the real types from
  // sb_outline, so this is a convenience, not a contract.
  const boxes = (await page.evaluate(() =>
    [...document.querySelectorAll('[id]')]
      .filter((el) => el.id === 'ROOT' || /^[a-z]{2}_[0-9a-f]{8}$/.test(el.id))
      .map((el) => {
        const r = el.getBoundingClientRect();
        const wb = String(el.className || '')
          .split(/\s+/)
          .find((c) => c.startsWith('wb-'));
        const cs = getComputedStyle(el);
        const own = (el.textContent ?? '').trim();
        return {
          id: el.id,
          type: wb ? wb.slice(3) : '',
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          fontPx: Math.round(parseFloat(cs.fontSize) || 0),
          hasText: own.length > 0,
        };
      }),
  )) as Box[];

  // ZOOM. A designer does not judge a card by looking at the whole page, and
  // a full-page shot of a long storefront makes one card a few pixels tall.
  // The clip comes from the SAME measurement pass the boxes do, so what is
  // framed is exactly what `sb_set` addresses.
  let clip: { x: number; y: number; width: number; height: number } | undefined;
  if (opts.node) {
    const box = boxes.find((b) => b.id === opts.node);
    if (!box) {
      throw new Error(
        `sbuilder: node "${opts.node}" is not on the rendered page at ${width}px. It may be ` +
          'hidden at this breakpoint, or not saved yet — sb_look renders the STORED draft.',
      );
    }
    if (box.w === 0 || box.h === 0) {
      throw new Error(
        `sbuilder: node "${opts.node}" renders with no size at ${width}px (${box.w}×${box.h}) — ` +
          'nothing to photograph. It is collapsed or empty; sb_review will say which.',
      );
    }
    const pad = opts.pad ?? 16;
    clip = {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: Math.min(width, box.w + pad * 2),
      height: box.h + pad * 2,
    };
  }

  const bytes = await page.screenshot({
    ...(format === 'jpeg' ? { type: 'jpeg', quality: JPEG_QUALITY } : { type: 'png' }),
    ...(clip ? { clip } : { fullPage: true }),
  });
  return {
    width,
    imageBase64: bytes.toString('base64'),
    mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    boxes,
  };
}
