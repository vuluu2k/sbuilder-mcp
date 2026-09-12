# Crawl Fidelity Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ruler — a repeatable, committed scoreboard that says how closely an
imported page resembles the page it was read from — WITHOUT changing anything about how an
import works.

**Architecture:** Three independent scores (`visual`, `content`, `structure`) computed by
three modules that can be tested apart: a browser-side pixel diff, a pure tree-shape
distance, and the existing `coverage`. A runner wires them to real sites, builds each page
into a scratch page on the live site, shoots both, and writes `test/fidelity/baseline.json`.
Every later run diffs against that file, which is where the word "continuous" lives.

**Tech Stack:** TypeScript (ESM / Node16), `playwright-core` with `channel: 'chrome'`,
vitest. No new runtime dependency — the pixel comparison runs in the browser this repo
already drives.

**Spec:** `docs/superpowers/specs/2026-09-12-crawl-fidelity-design.md`

## Scope of THIS plan

**P1 only.** The spec's P2 (source tokens → theme), P3 (per-node style, three captures) and
P4 (platform gaps) get their own plan AFTER this one produces a baseline. That is the spec's
own ordering argument and it is not ceremony: P3 is explicitly "guided by what P1 says is
still costing points", and a plan written before the numbers exist would be guessing at
which keys matter.

## Global Constraints

Copied from `CLAUDE.md`; every task inherits them.

- **Node ≥22.** The repo uses the global `WebSocket`.
- **ESM / Node16: every relative import ends in `.js`**, including from a `.ts` source.
- **stdout is the MCP channel.** Every log line is `console.error`. One stray `console.log`
  corrupts the protocol for every client.
- **`playwright-core` + `channel: 'chrome'`** — the system browser. `npm install` downloads
  nothing, so NO new dependency may be added by this plan.
- **Secrets come from env only** (`SB_API`, `SB_TOKEN`, `SB_EMAIL`, `SB_PASSWORD`, `SB_SITE`).
  This repo is public: no secret reaches a file, a log, or a committed artifact. The
  baseline file holds scores and source URLs, never a site id, page id or token.
- **Never hand-edit `src/catalog/*.generated.ts`.**
- **The gate for every change is `npm run build && npm test && npm run smoke`**, and smoke
  MUST print `ALL GOOD`.
- **A function passed to `page.evaluate` is SERIALIZED**: anything it closes over does not
  exist on the other side. Every constant such a function uses is declared INSIDE it or
  passed as an argument. This has already broken this repo once with
  `ReferenceError: HEADINGS is not defined`, and the only thing that catches it is a test
  that launches a browser.
- **Browser tests are opt-in** behind `SB_BROWSER_TEST=1` and the default suite skips them.
  A skip that reads as green is a failure mode this repo keeps closing: run
  `SB_BROWSER_TEST=1 npx vitest run` after touching anything under `src/vision/`.

---

### Task 1: Pixel diff of two shots

**Files:**
- Create: `src/vision/imagediff.ts`
- Test: `test/imagediff.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. Takes the `Shot`-shaped
  `{ imageBase64: string; mimeType: string }` that `shoot()` already returns
  (`src/vision/shoot.ts:57`).
- Produces:
  - `export interface DiffResult { differing: number; width: number; height: number }`
  - `export async function diffImages(a: ShotLike, b: ShotLike, opts?: DiffOpts): Promise<DiffResult>`
  - `export interface ShotLike { imageBase64: string; mimeType: string }`
  - `export interface DiffOpts { width?: number; tolerance?: number; blurPx?: number }`
  - `export async function closeDiffBrowser(): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `test/imagediff.test.ts`. The fixtures are SVG data URLs rather than PNG files
because a solid-colour SVG is hand-writable and a PNG is not; the canvas draws both the
same way.

```ts
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
    // THE FIXTURE MUST NOT BE WHITE. `paint()` fills the canvas white so an
    // unpainted region reads as blank page — so a white fixture makes the
    // missing region indistinguishable from the fill, both canvases come out
    // byte-identical, and the test measures 0 by construction. Tidying this
    // colour back to white does not fail the test, it empties it.
    const got = await diffImages(solid('#ff0000', 200, 300), solid('#ff0000', 200, 900));
    expect(got.differing).toBeGreaterThan(60);
  }, BROWSER_TIMEOUT);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `SB_BROWSER_TEST=1 npx vitest run test/imagediff.test.ts`
Expected: FAIL — `Cannot find module '../src/vision/imagediff.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/vision/imagediff.ts`.

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `SB_BROWSER_TEST=1 npx vitest run test/imagediff.test.ts`
Expected: PASS, 4 tests.

If the offset test exceeds 12, raise `blurPx` to 3 and re-run rather than loosening the
assertion: the blur is what makes the score about layout instead of about anti-aliasing.

- [ ] **Step 5: Run the gate**

Run: `npm run build && npm test && npm run smoke`
Expected: build clean, all tests pass, smoke prints `ALL GOOD`.

- [ ] **Step 6: Commit**

```bash
git add src/vision/imagediff.ts test/imagediff.test.ts
git commit -m "feat(fidelity): compare two shots without a new dependency

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Tree-shape distance

**Files:**
- Create: `src/domains/site/shape.ts`
- Test: `test/shape.test.ts`

**Interfaces:**
- Consumes: nothing. Operates on anything with an optional `children` array, which both
  `Captured` (`src/domains/site/importmap.ts:21`) and `NodeSpec`
  (`src/domains/site/builder.ts:36`) satisfy.
- Produces:
  - `export interface TreeLike { children?: TreeLike[] }`
  - `export interface ShapeHistogram { depth: number[]; fanout: number[]; total: number }`
  - `export function shapeOf(nodes: TreeLike[]): ShapeHistogram`
  - `export function shapeDistance(a: ShapeHistogram, b: ShapeHistogram): number`

Why a histogram rather than a node-by-node walk: the two trees are NOT expected to be
isomorphic — `toSpecs` legitimately wraps, merges consecutive `<details>` into one accordion,
and drops a node the platform has no element for. What must survive is the ARRANGEMENT: a
source three levels deep arriving two levels deep is the flatness failure this repo has
fixed once and has no guard against.

- [ ] **Step 1: Write the failing test**

Create `test/shape.test.ts`.

```ts
import { describe, it, expect } from 'vitest';
import { shapeOf, shapeDistance, type TreeLike } from '../src/domains/site/shape.js';

const leaf = (): TreeLike => ({});
const node = (...children: TreeLike[]): TreeLike => ({ children });

describe('shapeOf', () => {
  it('counts nodes per depth', () => {
    const got = shapeOf([node(leaf(), leaf())]);
    expect(got.depth[0]).toBe(1);
    expect(got.depth[1]).toBe(2);
    expect(got.total).toBe(3);
  });

  it('counts how many containers have each child count', () => {
    const got = shapeOf([node(leaf(), leaf()), node(leaf())]);
    expect(got.fanout[2]).toBe(1);
    expect(got.fanout[1]).toBe(1);
  });
});

describe('shapeDistance', () => {
  it('is 0 for the same shape', () => {
    const a = shapeOf([node(leaf(), leaf())]);
    expect(shapeDistance(a, a)).toBe(0);
  });

  it('REPORTS A FLATTENED TREE, which is the failure it exists for', () => {
    // Three feature columns inside a row, against the same six leaves arriving
    // as one flat column — every leaf present, the arrangement gone.
    const nested = shapeOf([node(node(leaf(), leaf()), node(leaf(), leaf()), node(leaf(), leaf()))]);
    const flat = shapeOf([node(leaf(), leaf(), leaf(), leaf(), leaf(), leaf())]);
    expect(shapeDistance(nested, flat)).toBeGreaterThan(20);
  });

  it('is small for a tree that differs by one wrapper', () => {
    const a = shapeOf([node(leaf(), leaf(), leaf())]);
    const b = shapeOf([node(leaf(), leaf(), leaf()), node(leaf())]);
    expect(shapeDistance(a, b)).toBeLessThan(20);
  });

  it('answers 0 for two empty trees rather than dividing by nothing', () => {
    expect(shapeDistance(shapeOf([]), shapeOf([]))).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/shape.test.ts`
Expected: FAIL — `Cannot find module '../src/domains/site/shape.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/domains/site/shape.ts`.

```ts
/**
 * HOW A TREE IS ARRANGED, as two histograms.
 *
 * A page can keep every word and lose everything a reader understands from the
 * ARRANGEMENT: a source's three-column feature row arriving as three stacked
 * blocks, a card's image/heading/copy/button arriving as four siblings with
 * nothing saying they belong together. `coverage` cannot see that — every
 * character survived — and a screenshot diff reports it as a large number with
 * no name. This is the name.
 *
 * Deliberately NOT a node-by-node walk. The two trees are not expected to be
 * isomorphic: the mapper wraps, merges consecutive `<details>` into one
 * accordion, and drops what the platform has no element for. Comparing
 * distributions asks the question that actually matters — is this still the
 * same SHAPE of page — without failing on a difference that was correct.
 */
export interface TreeLike {
  children?: TreeLike[];
}

export interface ShapeHistogram {
  /** `depth[d]` is how many nodes sit at depth `d`, root children at 0. */
  depth: number[];
  /** `fanout[n]` is how many nodes have exactly `n` children. Capped at 12. */
  fanout: number[];
  total: number;
}

/** Past this, a container is the page's own content column and the browser is
 *  wrapping it — the same bound `toSpecs` already puts on an imported row. */
const FANOUT_CAP = 12;

export function shapeOf(nodes: TreeLike[]): ShapeHistogram {
  const depth: number[] = [];
  const fanout: number[] = [];
  let total = 0;
  const walk = (n: TreeLike, d: number): void => {
    total += 1;
    depth[d] = (depth[d] ?? 0) + 1;
    const kids = n.children ?? [];
    const f = Math.min(kids.length, FANOUT_CAP);
    fanout[f] = (fanout[f] ?? 0) + 1;
    for (const k of kids) walk(k, d + 1);
  };
  for (const n of nodes) walk(n, 0);
  return { depth, fanout, total };
}

/** Total-variation distance between two histograms, as a percentage. */
function bucketDistance(a: number[], b: number[], totalA: number, totalB: number): number {
  if (totalA === 0 && totalB === 0) return 0;
  if (totalA === 0 || totalB === 0) return 100;
  let sum = 0;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    sum += Math.abs((a[i] ?? 0) / totalA - (b[i] ?? 0) / totalB);
  }
  return (sum / 2) * 100;
}

/**
 * 0 when the two trees are arranged the same way, 100 when they share nothing.
 *
 * Depth and fanout are averaged rather than summed, so the number stays a
 * percentage and reads next to `visual` and `content` without conversion.
 */
export function shapeDistance(a: ShapeHistogram, b: ShapeHistogram): number {
  const d = bucketDistance(a.depth, b.depth, a.total, b.total);
  const f = bucketDistance(a.fanout, b.fanout, a.total, b.total);
  return Math.round(((d + f) / 2) * 10) / 10;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/shape.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domains/site/shape.ts test/shape.test.ts
git commit -m "feat(fidelity): name the flatness a screenshot cannot

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The scoreboard and its baseline comparison

**Files:**
- Create: `src/domains/site/scoreboard.ts`
- Test: `test/scoreboard.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — this task is pure bookkeeping over numbers Task 4
  will supply.
- Produces:
  - `export interface PageScore { url: string; width: number; visual: number; content: number; structure: number }`
  - `export interface Baseline { generated: string; scores: PageScore[] }`
  - `export interface Move { url: string; width: number; metric: 'visual' | 'content' | 'structure'; was: number; now: number; delta: number }`
  - `export interface Comparison { regressions: Move[]; improvements: Move[]; added: string[]; removed: string[] }`
  - `export function compareBaseline(prev: Baseline, next: Baseline, tolerance?: number): Comparison`

**The direction of each metric is not uniform and that is the whole trap here.** `content`
is a coverage percentage where HIGHER is better; `visual` and `structure` are distances
where LOWER is better. A comparison that treated them alike would report every genuine
improvement as a regression on two metrics out of three.

- [ ] **Step 1: Write the failing test**

Create `test/scoreboard.test.ts`.

```ts
import { describe, it, expect } from 'vitest';
import { compareBaseline, type Baseline } from '../src/domains/site/scoreboard.js';

const at = (visual: number, content: number, structure: number): Baseline => ({
  generated: '2026-09-12T00:00:00.000Z',
  scores: [{ url: 'https://example.com/', width: 1440, visual, content, structure }],
});

describe('compareBaseline', () => {
  it('says nothing when nothing moved', () => {
    const got = compareBaseline(at(40, 80, 10), at(40, 80, 10));
    expect(got.regressions).toEqual([]);
    expect(got.improvements).toEqual([]);
  });

  it('READS EACH METRIC IN ITS OWN DIRECTION', () => {
    // visual and structure are distances (lower is better); content is
    // coverage (higher is better). Treating them alike would call this run —
    // which improved on all three — a regression on two of them.
    const got = compareBaseline(at(40, 70, 20), at(25, 85, 12));
    expect(got.regressions).toEqual([]);
    expect(got.improvements.map((m) => m.metric).sort()).toEqual(['content', 'structure', 'visual']);
  });

  it('reports a real regression', () => {
    const got = compareBaseline(at(25, 85, 12), at(41, 85, 12));
    expect(got.regressions).toHaveLength(1);
    expect(got.regressions[0].metric).toBe('visual');
    expect(got.regressions[0].was).toBe(25);
    expect(got.regressions[0].now).toBe(41);
  });

  it('ignores movement inside the tolerance', () => {
    // A shot of a live site is not deterministic to the pixel — a carousel is
    // on a different slide. Without a tolerance every run reports noise and the
    // scoreboard stops being read.
    const got = compareBaseline(at(25, 85, 12), at(26, 84.5, 12.4));
    expect(got.regressions).toEqual([]);
    expect(got.improvements).toEqual([]);
  });

  it('names a page that appeared and one that went away', () => {
    const prev = at(25, 85, 12);
    const next: Baseline = {
      generated: '2026-09-13T00:00:00.000Z',
      scores: [{ url: 'https://other.test/', width: 1440, visual: 30, content: 70, structure: 15 }],
    };
    const got = compareBaseline(prev, next);
    expect(got.added).toEqual(['https://other.test/ @1440']);
    expect(got.removed).toEqual(['https://example.com/ @1440']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/scoreboard.test.ts`
Expected: FAIL — `Cannot find module '../src/domains/site/scoreboard.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/domains/site/scoreboard.ts`.

```ts
/** One page at one width. */
export interface PageScore {
  url: string;
  width: number;
  /** Per cent of pixels that differ from the source. LOWER is better. */
  visual: number;
  /** `coverage` — per cent of the source's non-chrome text kept. HIGHER is better. */
  content: number;
  /** Tree-shape distance from the source's captured tree. LOWER is better. */
  structure: number;
}

export interface Baseline {
  generated: string;
  scores: PageScore[];
}

export type Metric = 'visual' | 'content' | 'structure';

export interface Move {
  url: string;
  width: number;
  metric: Metric;
  was: number;
  now: number;
  /** Signed, in the metric's own units. */
  delta: number;
}

export interface Comparison {
  regressions: Move[];
  improvements: Move[];
  /** `url @width` for rows the new run has and the baseline does not. */
  added: string[];
  removed: string[];
}

/**
 * DIRECTION IS PER METRIC, and getting it uniform would be the whole bug.
 *
 * `content` is a coverage percentage where higher is better; `visual` and
 * `structure` are distances where lower is better. A comparison that treated
 * them alike would report a run that improved all three as a regression on two.
 */
const LOWER_IS_BETTER: Record<Metric, boolean> = { visual: true, content: false, structure: true };

/**
 * A shot of a LIVE site is not deterministic to the pixel — a carousel is on a
 * different slide, a lazy image resolved a moment later. Without a tolerance
 * every run reports noise, and a scoreboard that cries wolf stops being read,
 * which costs more than having no scoreboard at all.
 */
const DEFAULT_TOLERANCE = 1.5;

const key = (s: PageScore): string => `${s.url} @${s.width}`;

export function compareBaseline(prev: Baseline, next: Baseline, tolerance = DEFAULT_TOLERANCE): Comparison {
  const before = new Map(prev.scores.map((s) => [key(s), s]));
  const after = new Map(next.scores.map((s) => [key(s), s]));

  const regressions: Move[] = [];
  const improvements: Move[] = [];
  for (const [k, now] of after) {
    const was = before.get(k);
    if (!was) continue;
    for (const metric of ['visual', 'content', 'structure'] as Metric[]) {
      const delta = now[metric] - was[metric];
      if (Math.abs(delta) < tolerance) continue;
      const worse = LOWER_IS_BETTER[metric] ? delta > 0 : delta < 0;
      const move: Move = { url: now.url, width: now.width, metric, was: was[metric], now: now[metric], delta };
      (worse ? regressions : improvements).push(move);
    }
  }

  return {
    regressions,
    improvements,
    added: [...after.keys()].filter((k) => !before.has(k)),
    removed: [...before.keys()].filter((k) => !after.has(k)),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/scoreboard.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domains/site/scoreboard.ts test/scoreboard.test.ts
git commit -m "feat(fidelity): a baseline that reads each metric in its own direction

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The runner

**Files:**
- Create: `test/fidelity/fixtures.json`
- Create: `test/fidelity/run.ts`
- Modify: `package.json` — add the `fidelity` script

**Interfaces:**
- Consumes: `diffImages`, `closeDiffBrowser` (Task 1); `shapeOf`, `shapeDistance` (Task 2);
  `PageScore`, `Baseline`, `compareBaseline` (Task 3). From the existing codebase:
  `buildContext()` (`src/server.ts:50`), `callOperation` (`src/tools/api.ts:229`), `capture`
  and `closeCaptureBrowser` (`src/vision/capture.ts`), `toSpecs` and `tokensFromPage`
  (`src/domains/site/importmap.ts`), `PageSession` (`src/tools/page.ts:73`), `addSubtree` and
  `middleEnd` (`src/domains/site/builder.ts`), `shoot` and `closeBrowser`
  (`src/vision/shoot.ts`), `previewUrl` (`src/vision/preview.ts:12`).
- Produces: `test/fidelity/baseline.json`, written by Task 5.

**This task writes to a LIVE site.** Three rules, each of which is a failure this repo has
already recorded:

1. Scratch pages are named `zz-fidelity-<slug>` and deleted by the ID THE CREATE RETURNED,
   never by a slug scan. Deleting by "not in my list" is what took 54 Roboto font files out
   of a media library.
2. A page DELETE is one-way, so the cleanup runs in a `finally` and deletes only ids this
   run created.
3. The platform RENAMES a colliding slug and answers 200, so a create that comes back with a
   different slug is still this run's page and still gets deleted.

- [ ] **Step 1: Write the fixtures**

Create `test/fidelity/fixtures.json`. FOUR SITES of deliberately different shape — this
repo's own precedent is that a sweep across four real sites found the defect a single page
could not.

```json
{
  "widths": [1440, 390],
  "pages": [
    { "url": "https://ttgshop.vn/quy-dinh-bao-hanh", "note": "Vietnamese shop, a real table, long lists" },
    { "url": "https://ttgshop.vn/", "note": "dense shop home, carousels, hits the node ceiling" },
    { "url": "https://modelcontextprotocol.io/", "note": "documentation, grid-heavy, code blocks" },
    { "url": "https://www.rust-lang.org/", "note": "marketing, hero and feature rows, nav-heavy chrome" },
    { "url": "https://example.com/", "note": "the floor: a page with almost nothing on it" }
  ]
}
```

Two widths rather than three, deliberately: 1440 and 390 are the two that disagree, and 768
costs a third of the run time to say what they already said. Raise it to three once the run
is cheap enough to want more.

- [ ] **Step 2: Write the runner**

Create `test/fidelity/run.ts`.

```ts
/**
 * THE RULER. Reads real pages, builds each one, photographs both, scores.
 *
 * Not part of the gate: it needs the network, a browser and a live site. Run it
 * on demand — `SB_FIDELITY=1 npx tsx test/fidelity/run.ts` — and commit the
 * baseline it writes.
 *
 * Every line of output is `console.error`. This file is not the MCP server, but
 * the rule is the repo's and a script that breaks it teaches the next reader
 * that the rule is soft.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildContext } from '../../src/server.js';
import { callOperation } from '../../src/tools/api.js';
import { capture, closeCaptureBrowser } from '../../src/vision/capture.js';
import { toSpecs, tokensFromPage } from '../../src/domains/site/importmap.js';
import { addSubtree, middleEnd } from '../../src/domains/site/builder.js';
import { PageSession } from '../../src/tools/page.js';
import { shoot, closeBrowser } from '../../src/vision/shoot.js';
import { previewUrl } from '../../src/vision/preview.js';
import { diffImages, closeDiffBrowser } from '../../src/vision/imagediff.js';
import { shapeOf, shapeDistance } from '../../src/domains/site/shape.js';
import { compareBaseline, type Baseline, type PageScore } from '../../src/domains/site/scoreboard.js';
import type { Patch } from '../../src/core/patch.js';

const HERE = resolve(import.meta.dirname);
const BASELINE = resolve(HERE, 'baseline.json');

interface Fixture {
  url: string;
  note: string;
}

const slugFor = (url: string): string =>
  `zz-fidelity-${url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '').slice(0, 40).toLowerCase()}`;

async function main(): Promise<void> {
  if (process.env.SB_FIDELITY !== '1') {
    console.error('refusing to run: this writes pages to a live site. Set SB_FIDELITY=1 to mean it.');
    process.exit(2);
  }
  const { widths, pages } = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8')) as {
    widths: number[];
    pages: Fixture[];
  };
  const ctx = buildContext();
  const siteId = ctx.siteId;
  if (!siteId) {
    console.error('refusing to run: SB_SITE names no site.');
    process.exit(2);
  }

  const scores: PageScore[] = [];
  // EVERY id this run created, so cleanup deletes what it made and nothing
  // else. Never a slug scan.
  const created: string[] = [];
  try {
    for (const fx of pages) {
      try {
        const shotSource = await capture(fx.url, {});
        const made = (await callOperation(ctx, {
          id: 'post:/api/sites/{siteId}/pages',
          body: { name: slugFor(fx.url), slug: slugFor(fx.url), type: 'page', seed: false },
          dry_run: false,
        })) as { page?: { id?: string }; id?: string };
        const pageId = made.page?.id ?? made.id;
        if (!pageId) throw new Error('the create returned no page id');
        created.push(pageId);

        const session = new PageSession(ctx);
        await session.open(siteId, pageId);
        const doc = session.current();
        const specs = toSpecs(shotSource.sections, tokensFromPage(doc.doc));
        const all: Patch[] = [];
        const staged = doc.preview([]);
        for (const spec of specs) {
          const { patches } = addSubtree(staged, staged.doc.root_node_id, spec, middleEnd(staged.doc));
          staged.apply(patches);
          all.push(...patches);
        }
        await session.applyAndSave(all);

        const preview = await previewUrl(ctx, siteId, pageId);
        const [srcShots, builtShots] = await Promise.all([
          shoot(fx.url, { widths, format: 'png' }),
          shoot(preview, { widths, format: 'png' }),
        ]);

        const built = shapeOf(specs);
        const source = shapeOf(shotSource.sections);
        for (let i = 0; i < widths.length; i += 1) {
          const diff = await diffImages(srcShots[i], builtShots[i]);
          scores.push({
            url: fx.url,
            width: widths[i],
            visual: diff.differing,
            content: shotSource.coverage,
            structure: shapeDistance(source, built),
          });
          console.error(
            `${fx.url} @${widths[i]}  visual ${diff.differing}%  content ${shotSource.coverage}%  ` +
              `structure ${shapeDistance(source, built)}`,
          );
        }
      } catch (e) {
        console.error(`${fx.url} FAILED: ${(e as Error).message}`);
      }
    }
  } finally {
    // ONLY what this run made, and in a finally so a thrown page does not leave
    // scratch pages on a live site.
    for (const id of created) {
      await callOperation(ctx, {
        id: 'delete:/api/sites/{siteId}/pages/{pageId}',
        path_params: { pageId: id },
        dry_run: false,
      }).catch((e: Error) => console.error(`could not delete ${id}: ${e.message}`));
    }
    await Promise.all([closeDiffBrowser(), closeCaptureBrowser(), closeBrowser()]);
  }

  const next: Baseline = { generated: new Date().toISOString(), scores };
  if (existsSync(BASELINE)) {
    const prev = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
    const cmp = compareBaseline(prev, next);
    console.error(`\nagainst the baseline: ${cmp.improvements.length} better, ${cmp.regressions.length} worse`);
    for (const m of cmp.regressions) {
      console.error(`  WORSE  ${m.url} @${m.width} ${m.metric}: ${m.was} -> ${m.now}`);
    }
    for (const m of cmp.improvements) {
      console.error(`  better ${m.url} @${m.width} ${m.metric}: ${m.was} -> ${m.now}`);
    }
    for (const k of cmp.added) console.error(`  new    ${k}`);
    for (const k of cmp.removed) console.error(`  gone   ${k}`);
  }
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
  console.error(`\nwrote ${BASELINE}`);
}

await main();
```

- [ ] **Step 3: Verify the two API operations exist under those ids**

The runner names two operations. If either id is wrong the run fails only after it has
already created pages, so check them BEFORE running it.

Run:
```bash
node -e "const {OPERATIONS}=require('./dist/catalog/api.generated.js');
for (const id of ['post:/api/sites/{siteId}/pages','delete:/api/sites/{siteId}/pages/{pageId}'])
  console.log(id, OPERATIONS.some(o=>o.id===id) ? 'OK' : 'MISSING');"
```
Expected: both `OK`. If one is `MISSING`, print the real ids and correct the runner rather
than guessing a path:

```bash
node -e "const {OPERATIONS}=require('./dist/catalog/api.generated.js');
console.log(OPERATIONS.filter(o=>/\/pages/.test(o.path)).map(o=>o.id).join('\n'));"
```

- [ ] **Step 4: Add the script**

In `package.json`, add to `"scripts"`:

```json
"fidelity": "tsx test/fidelity/run.ts"
```

- [ ] **Step 5: Confirm the guard refuses without the flag**

Run: `npm run fidelity`
Expected: exits 2 with `refusing to run: this writes pages to a live site.` and creates
nothing.

- [ ] **Step 6: Run the gate**

Run: `npm run build && npm test && npm run smoke`
Expected: build clean, all tests pass, smoke prints `ALL GOOD`. The runner is not in the
suite, so nothing here reaches the network.

- [ ] **Step 7: Commit**

```bash
git add test/fidelity/run.ts test/fidelity/fixtures.json package.json
git commit -m "feat(fidelity): the runner, refusing to touch a live site unasked

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The first baseline, and what it is allowed to say

**Files:**
- Create: `test/fidelity/baseline.json` (written by the runner, committed by hand)
- Modify: `CLAUDE.md` — a section under "Designing a site with these tools"
- Modify: `docs/tools.md` and `docs/tools.vi.md` — how to run the harness

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: the committed baseline every later change is measured against.

- [ ] **Step 1: Run it for real**

Run: `SB_FIDELITY=1 npm run fidelity`
Expected: a line per page per width, then `wrote …/baseline.json`. There is no baseline yet,
so no comparison is printed.

- [ ] **Step 2: Check the site is clean**

Run: `SB_SITE` is already in the environment; list the pages and confirm no `zz-fidelity-*`
survived.

`require('./dist/server.js')` fails on this package: `"type": "module"` makes that file ESM,
and `require(esm)` is unflagged only from Node 22.12 while `engines` here allows `>=22`. Use
native `import` instead — this is the command a Node 22.0–22.11 install would otherwise fail
on with no clue why:

```bash
node --input-type=module -e "
import { buildContext } from './dist/server.js';
import { callOperation } from './dist/tools/api.js';
const ctx = buildContext();
const out = await callOperation(ctx, { id: 'get:/api/sites/{siteId}/pages', dry_run: false, pick: ['slug'] });
const left = JSON.stringify(out).match(/zz-fidelity-[a-z0-9-]*/g) ?? [];
console.log(left.length ? 'LEFT BEHIND: ' + left.join(', ') : 'clean');
"
```
Expected: `clean`. If anything survived, delete it by id and fix the `finally` before
continuing — a harness that litters a live site will not be run twice.

- [ ] **Step 3: Read the numbers before committing them**

A baseline is a claim about the current state, so look at it once rather than committing
whatever came out. Two things to check, both of which mean the harness is wrong rather than
the importer:

- `content` for `https://example.com/` should be high. That page is a heading and two
  sentences; a low number there means the capture, not the import, is broken.
- `visual` should not be identical across every page. Identical numbers mean both shots are
  of the same thing — usually the preview URL failing and the browser photographing an error
  page.

- [ ] **Step 4: Commit the baseline**

```bash
git add test/fidelity/baseline.json
git commit -m "chore(fidelity): the first baseline, before anything is improved

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Document it in three places**

In `docs/tools.md`, after the `sb_import` section, add:

```markdown
### Measuring an import

`SB_FIDELITY=1 npm run fidelity` reads the fixtures in `test/fidelity/fixtures.json`, builds
each page into a scratch page on the site `SB_SITE` names, photographs the source and the
build at each width, and writes `test/fidelity/baseline.json`.

Three numbers, because they fail independently: `visual` is the per cent of pixels that
differ (lower is better), `content` is `coverage` (higher is better), `structure` is the
distance between the source's tree and the built one (lower is better). A blank page scores
perfectly on two of the three, which is why there are three.

It writes to a LIVE site and refuses to run without the flag. Scratch pages are named
`zz-fidelity-*` and deleted by the id the create returned, in a `finally`.
```

Add the Vietnamese counterpart to `docs/tools.vi.md` in the same position.

In `CLAUDE.md`, under "Designing a site with these tools", add a short entry recording WHY
the harness exists, in the file's own voice: that a page built entirely by these tools
reviewed clean and carried four defects visible only in a screenshot, and that until this
existed no change to the importer could be shown to have helped.

- [ ] **Step 6: Run the gate and commit**

```bash
npm run build && npm test && npm run smoke
git add docs/tools.md docs/tools.vi.md CLAUDE.md
git commit -m "docs: how to measure an import, and why the harness exists

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## What this plan deliberately does NOT do

- **It does not improve fidelity.** Not one behaviour of `capture` or `toSpecs` changes. That
  is the point: the current score has to be on record before anything moves, or every later
  claim is unfalsifiable.
- **It does not add the harness to the gate.** `npm run build && npm test && npm run smoke`
  stays what it is. A gate that needs the network and a live site is a gate that gets
  disabled.
- **It does not touch `web_builder`.** The spec's P4 is a decision the baseline makes.
