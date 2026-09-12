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
