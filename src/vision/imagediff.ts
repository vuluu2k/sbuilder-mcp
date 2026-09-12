import { chromium, type Browser } from 'playwright-core';

/** What `shoot()` returns for one width, narrowed to what a diff needs. */
export interface ShotLike {
  imageBase64: string;
  mimeType: string;
}

export interface DiffOpts {
  /** Both images are scaled to this width before comparing. Default 480. */
  width?: number;
  /** Per-pixel channel-sum difference that counts as different, 0-765. Default 40. */
  tolerance?: number;
  /** Blur applied to both before comparing, in px of the scaled image. Default 2. */
  blurPx?: number;
}

export interface DiffResult {
  /** Per cent of compared pixels that differ beyond `tolerance`, 0-100. */
  differing: number;
  width: number;
  height: number;
}

/**
 * THE DOM, declared as narrowly as this file uses it.
 *
 * `shoot.ts` and `capture.ts` do the same and for the same reason: pulling
 * `lib.dom` into the compiler makes every browser global visible in SERVER
 * code, where touching one is a crash rather than a type error. These are the
 * only shapes `page.evaluate`'s body below relies on.
 */
declare class Image {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
}
type HTMLImageElement = Image;
interface CanvasContext2D {
  fillStyle: string;
  filter: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(img: HTMLImageElement, x: number, y: number, w: number, h: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}
declare const document: {
  createElement(tag: 'canvas'): {
    width: number;
    height: number;
    getContext(kind: '2d'): CanvasContext2D | null;
  };
};

/**
 * ITS OWN BROWSER, not `shoot.ts`'s pooled one.
 *
 * The pool exists because a vision loop shoots constantly and must not pay a
 * launch each time. A fidelity run is rare, slow, and comparing images is not
 * the fast path — coupling it to the tool an agent calls every few hundred
 * milliseconds is how the fast path gets slow. Same reasoning `capture.ts`
 * already records for itself.
 */
let shared: Browser | null = null;

async function browser(): Promise<Browser> {
  if (!shared) shared = await chromium.launch({ channel: 'chrome' });
  return shared;
}

/** MUST be called by any script that diffs, or the process never exits. */
export async function closeDiffBrowser(): Promise<void> {
  const b = shared;
  shared = null;
  await b?.close().catch(() => {});
}

export async function diffImages(a: ShotLike, b: ShotLike, opts: DiffOpts = {}): Promise<DiffResult> {
  const width = opts.width ?? 480;
  const tolerance = opts.tolerance ?? 40;
  const blurPx = opts.blurPx ?? 2;
  const urlA = `data:${a.mimeType};base64,${a.imageBase64}`;
  const urlB = `data:${b.mimeType};base64,${b.imageBase64}`;

  const page = await (await browser()).newPage();
  try {
    // EVERY value this function uses is passed in. It is serialized and run in
    // the page, so a module-level constant it closed over would simply not be
    // there — the failure this repo has already paid for once.
    return await page.evaluate(
      async ({ urlA, urlB, width, tolerance, blurPx }) => {
        const load = (src: string): Promise<HTMLImageElement> =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('image did not load'));
            img.src = src;
          });

        const [imgA, imgB] = await Promise.all([load(urlA), load(urlB)]);
        const scaledH = (img: HTMLImageElement): number =>
          Math.max(1, Math.round((img.naturalHeight * width) / Math.max(1, img.naturalWidth)));
        const hA = scaledH(imgA);
        const hB = scaledH(imgB);
        // THE TALLER OF THE TWO, not the shorter. A page that stops half way
        // is not "identical down to where it stops" — the area only one image
        // has is counted as differing, which is what makes a truncated import
        // score badly instead of perfectly.
        const height = Math.max(hA, hB);

        const paint = (img: HTMLImageElement, h: number): Uint8ClampedArray => {
          const c = document.createElement('canvas');
          c.width = width;
          c.height = height;
          const ctx = c.getContext('2d');
          if (!ctx) throw new Error('no 2d context');
          // White, because a page's own ground is white and an unpainted
          // region should read as blank page rather than as transparent black.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.filter = `blur(${blurPx}px)`;
          ctx.drawImage(img, 0, 0, width, h);
          return ctx.getImageData(0, 0, width, height).data;
        };

        const pa = paint(imgA, hA);
        const pb = paint(imgB, hB);
        let differing = 0;
        const total = width * height;
        for (let i = 0; i < total; i += 1) {
          const o = i * 4;
          const d =
            Math.abs(pa[o] - pb[o]) + Math.abs(pa[o + 1] - pb[o + 1]) + Math.abs(pa[o + 2] - pb[o + 2]);
          if (d > tolerance) differing += 1;
        }
        return { differing: Math.round((differing / total) * 1000) / 10, width, height };
      },
      { urlA, urlB, width, tolerance, blurPx },
    );
  } finally {
    await page.close().catch(() => {});
  }
}
