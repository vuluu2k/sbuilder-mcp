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
    getAttribute(name: string): string | null;
    getBoundingClientRect(): { x: number; y: number; width: number; height: number };
  }>;
};

export interface Box {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
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
export async function shoot(url: string, opts: { widths?: number[] } = {}): Promise<Shot[]> {
  const widths = opts.widths ?? DEFAULT_WIDTHS;
  const browser = await launch();
  try {
    const shots: Shot[] = [];
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(url, { waitUntil: 'networkidle' });
      const png = await page.screenshot({ type: 'png', fullPage: true });
      const boxes = (await page.evaluate(() =>
        [...document.querySelectorAll('[data-node-id]')].map((el) => {
          const r = el.getBoundingClientRect();
          return {
            id: el.getAttribute('data-node-id') ?? '',
            type: el.getAttribute('data-node-type') ?? '',
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        }),
      )) as Box[];
      shots.push({ width, pngBase64: png.toString('base64'), boxes });
      await page.close();
    }
    return shots;
  } finally {
    await browser.close();
  }
}
