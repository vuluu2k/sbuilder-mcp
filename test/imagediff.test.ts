import { describe, it, expect, afterAll } from 'vitest';
import { diffImages, closeDiffBrowser } from '../src/vision/imagediff.js';

const BROWSER_TIMEOUT = 60_000;

/** A solid rectangle as a base64 SVG, which the canvas draws like any image. */
const solid = (color: string, w = 200, h = 300) => ({
  imageBase64: Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<rect width="100%" height="100%" fill="${color}"/></svg>`,
  ).toString('base64'),
  mimeType: 'image/svg+xml',
});

/** The same rectangle with a band of a second colour `at` px from the top. */
const banded = (color: string, band: string, at: number, w = 200, h = 300) => ({
  imageBase64: Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<rect width="100%" height="100%" fill="${color}"/>` +
      `<rect y="${at}" width="100%" height="60" fill="${band}"/></svg>`,
  ).toString('base64'),
  mimeType: 'image/svg+xml',
});

describe.runIf(process.env.SB_BROWSER_TEST === '1')('diffImages', () => {
  afterAll(async () => {
    await closeDiffBrowser();
  });

  it('answers 0 for the same image twice', async () => {
    const got = await diffImages(solid('#ff0000'), solid('#ff0000'));
    expect(got.differing).toBe(0);
  }, BROWSER_TIMEOUT);

  it('answers close to 100 for black against white', async () => {
    const got = await diffImages(solid('#000000'), solid('#ffffff'));
    expect(got.differing).toBeGreaterThan(95);
  }, BROWSER_TIMEOUT);

  it('DOES NOT read a small offset as a large difference', async () => {
    // An import that is right in every way except a few pixels of line-height
    // must not score as catastrophically wrong, or the number stops being
    // usable for deciding whether a change helped.
    const got = await diffImages(banded('#ffffff', '#000000', 100), banded('#ffffff', '#000000', 104));
    expect(got.differing).toBeLessThan(12);
  }, BROWSER_TIMEOUT);

  it('counts the area one image has and the other does not', async () => {
    // A page that stops half way is not "the same down to where it stops": the
    // missing half is the whole point of the measurement.
    //
    // NOT white. `paint()` fills the canvas ground white by design, so a white
    // fixture makes the region only the taller image has indistinguishable
    // from the shorter image's own white fill — the test would measure 0 by
    // construction, not by a real absence of difference. Any non-white colour
    // makes the missing region visible against that ground.
    const got = await diffImages(solid('#ff0000', 200, 300), solid('#ff0000', 200, 900));
    expect(got.differing).toBeGreaterThan(60);
  }, BROWSER_TIMEOUT);
});
