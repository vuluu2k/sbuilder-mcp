import { chromium, type Browser } from 'playwright-core';

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
  }>;
};
declare function getComputedStyle(el: unknown): { fontSize: string };
declare const window: { innerWidth: number };

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

export interface Shot {
  width: number;
  pngBase64: string;
  boxes: Box[];
}

/** The three widths the platform's own breakpoints care about. */
export const DEFAULT_WIDTHS = [1440, 768, 390];

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
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch (err) {
    throw new Error(
      'sbuilder: could not launch Google Chrome for the screenshot. sb_look needs Chrome ' +
        `installed — playwright-core bundles no browser. Underlying error: ${String(err)}`,
    );
  }
}

/**
 * Photograph a rendered page at several widths, and measure every node.
 *
 * The boxes are the load-bearing half. `cursor` frames on the live-edit socket
 * carry LAYOUT pixels — the canvas is zoomed per viewer, so a screen coordinate
 * lands somewhere else on a peer with a different window — and nothing else in
 * this server knows where a node ended up. Measured here, the agent's cursor
 * moves to the element it is about to change instead of to a made-up number.
 */
export async function shoot(
  url: string,
  opts: { widths?: number[]; node?: string; pad?: number } = {},
): Promise<Shot[]> {
  const widths = opts.widths ?? DEFAULT_WIDTHS;
  const browser = await launch();
  try {
    const shots: Shot[] = [];
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(url, { waitUntil: 'networkidle' });
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
          await page.close();
          throw new Error(
            `sbuilder: node "${opts.node}" is not on the rendered page at ${width}px. It may be ` +
              'hidden at this breakpoint, or not saved yet — sb_look renders the STORED draft.',
          );
        }
        if (box.w === 0 || box.h === 0) {
          await page.close();
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

      const png = await page.screenshot({
        type: 'png',
        ...(clip ? { clip } : { fullPage: true }),
      });
      shots.push({ width, pngBase64: png.toString('base64'), boxes });
      await page.close();
    }
    return shots;
  } finally {
    await browser.close();
  }
}
