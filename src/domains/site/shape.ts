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
 *
 * A node with exactly one child adds depth but carries no arrangement
 * decision — there is only one way to arrange one thing. `toSpecs` always
 * inserts one such wrapper (a `flex-block`) between a section and its
 * children, which is a constant of the MAPPER's construction, not a fact
 * about the page, and it used to dominate the score of small pages: a
 * four-node page (`example.com`) measured a distance of 40 against its own
 * correctly-built copy, purely from that one wrapper. `src/vision/capture.ts`
 * already applies this same rule on the way in, for the same reason — a
 * `<div>` that merely wraps is flattened rather than reproduced. `shapeOf`
 * treats a single-child node as TRANSPARENT: the child takes its place, so
 * `section → block → [a,b,c]` and `section → [a,b,c]` produce the same
 * histogram. A node with zero or two-or-more children is never transparent —
 * it is either a real leaf or a real arrangement decision.
 *
 * THE TRANSPARENCY RULE HAS A BLIND SPOT, AND IT IS WORTH NAMING RATHER THAN
 * REDISCOVERING. A lost container that was its parent's ONLY child is
 * invisible to this measure, because the collapse removes it from the
 * SOURCE side too. `section → row → [c1,c2,c3]` losing `row` entirely (its
 * three children promoted straight onto `section`) is exactly this case:
 * `section` has one child, so it collapses and `row` (3 children) takes its
 * place at depth 0 — which is then histogram-identical to a built tree that
 * never had a `row` at all, `section → [c1,c2,c3]`. The genuine loss and the
 * compensating collapse cancel each other out.
 *
 * The trade is still the right one. BEFORE this rule, every page paid for
 * the mapper's own construction rather than for anything about the page:
 * `example.com` — a heading and two sentences — scored 40 against its own
 * correctly-built copy, purely from the one constant wrapper `toSpecs`
 * always inserts. A metric that reports ~40-49 on every page, good imports
 * and bad ones alike, cannot answer the question it exists for at all. A
 * narrow blind spot — one specific shape of loss, only when the lost
 * container was an only child — costs less than a number that is mostly its
 * own construction.
 *
 * And the blind spot is not a NEW hole this rule cut. `shapeOf` has never
 * read DIRECTION — a `row` and a `column` with the same children count the
 * same — so a container's own arrangement AXIS was already outside what
 * this measures, only-child or not. The collapse does not introduce that
 * limitation; it makes one more case of it visible, in the one place where a
 * lost container's fanout happens to match what replaced it.
 *
 * A CAPTURED LIST HID ITS ENTRIES FROM THIS WALK, AND THIS IS THE SECOND TIME
 * A MEASURE HAS MADE THAT MISTAKE. `Captured` (`src/domains/site/importmap.ts`)
 * stores a `list`'s rows as `items: string[]`, never as `children` — they are
 * plain strings, not sub-trees — so a `shapeOf` that walked `children` alone
 * counted every captured list as a LEAF, while the `list-item` nodes the
 * mapper builds from those same rows are real children with a real fanout.
 * The two trees therefore disagreed in shape BY CONSTRUCTION, on every page
 * that has a list. `textOf` (`src/vision/capture.ts`, behind `coverage`) had
 * the identical defect on the content axis — summing `c.text` alone and
 * scoring a list's `items` as zero — fixed earlier in this line of work.
 * `shape.ts` was written after that fix and repeated it, on the other axis,
 * because nothing said "a captured tree has two places content can live, and
 * a walk that visits only one silently treats a list as empty." Measured on
 * `ttgshop.vn/quy-dinh-bao-hanh` (7 captured lists): `structure` read 21.7,
 * the largest non-zero value in the whole fixture set, entirely this
 * artifact — the built tree's `list-item` children counted as an arrangement
 * decision the source, read the old way, never appeared to make.
 *
 * The fix treats an `items` entry as a leaf child, exactly as many as the
 * array holds — counted, never walked into, because a list's rows are
 * strings with nothing under them to recurse through. It composes with the
 * transparency rule rather than bypassing it: a list with exactly one item
 * and no other children is a single-child node like any other, so it
 * collapses and the synthetic leaf takes its place.
 */
export interface TreeLike {
  children?: TreeLike[];
  /**
   * A captured list's rows — see the note above. Structural rather than
   * typed as `Captured['items']`, so this module still takes both `Captured`
   * and `NodeSpec` without importing either; only the LENGTH is read.
   */
  items?: unknown[];
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

/** A synthetic leaf standing in for one entry of a captured list's `items` —
 *  never walked into, since a list row is a string with nothing under it. */
const ITEM_LEAF: TreeLike = {};

export function shapeOf(nodes: TreeLike[]): ShapeHistogram {
  const depth: number[] = [];
  const fanout: number[] = [];
  let total = 0;
  const walk = (n: TreeLike, d: number): void => {
    const own = n.children ?? [];
    const itemCount = n.items?.length ?? 0;
    // A list's `items` count as leaf children alongside any real `children`
    // the node also carries — see the doc comment on `TreeLike.items`. In
    // practice a captured list never carries both (`capture.ts` sets one or
    // the other), but adding rather than choosing keeps the count honest if
    // that ever changes.
    const kids = itemCount > 0 ? own.concat(Array(itemCount).fill(ITEM_LEAF)) : own;
    // Transparent: `n` decided nothing, so it is never counted — its one
    // child is walked AT THE SAME DEPTH, taking `n`'s place rather than
    // adding a level under it. Recursing through `walk` rather than looping
    // here collapses a whole CHAIN of such wrappers, not just one.
    if (kids.length === 1) {
      walk(kids[0], d);
      return;
    }
    total += 1;
    depth[d] = (depth[d] ?? 0) + 1;
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
