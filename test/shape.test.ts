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
    // The second top-level node has exactly one child, so it is transparent:
    // its leaf takes its place rather than being counted as a one-child
    // wrapper. `fanout[1]` can therefore never hold anything — a node with
    // exactly one child never survives to be counted — and the collapsed
    // leaf lands in `fanout[0]` instead — alongside the first node's own two
    // leaves, for three total.
    expect(got.fanout[1]).toBeUndefined();
    expect(got.fanout[0]).toBe(3);
  });

  it('treats a single-child node as transparent — the child takes its place', () => {
    // `section -> block -> [a, b]` and `section -> [a, b]` must count as the
    // SAME shape: `block` decided nothing, so it is never counted and never
    // adds a depth level. This is the fix `structure` needed — `toSpecs`
    // always inserts exactly one such wrapper between a section and its
    // children, which used to cost every built page a depth level (and a
    // fanout[1] entry) the source never had.
    const wrapped = shapeOf([node(node(leaf(), leaf()))]);
    const bare = shapeOf([node(leaf(), leaf())]);
    expect(wrapped).toEqual(bare);
  });

  it('collapses a whole CHAIN of single-child wrappers, not just one', () => {
    const chain = shapeOf([node(node(node(leaf(), leaf(), leaf())))]);
    const bare = shapeOf([node(leaf(), leaf(), leaf())]);
    expect(chain).toEqual(bare);
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
    // PINNED, not bracketed: this number is the `structure` column of the
    // recorded fidelity baseline, so the formula must not be free to drift to
    // a different value inside a threshold and still read as unchanged.
    expect(shapeDistance(nested, flat)).toBeCloseTo(50, 1);
  });

  it('is small for a tree that differs by one wrapper', () => {
    const a = shapeOf([node(leaf(), leaf(), leaf())]);
    // `b`'s second top-level node has exactly one child, so it collapses to a
    // bare leaf at depth 0 rather than counting as a wrapper around one — `a`
    // has depth [1,3] total 4, `b` collapses to depth [2,3] total 5 (the
    // extra depth-0 entry is the collapsed leaf, not a wrapper).
    // depth:   |1/4-2/5| + |3/4-3/5| = 0.15+0.15 = 0.3 -> (0.3/2)*100 = 15
    // fanout:  |3/4-4/5| + |1/4-1/5| = 0.05+0.05 = 0.1 -> (0.1/2)*100 = 5
    // shapeDistance = round(((15+5)/2)*10)/10 = 10
    const b = shapeOf([node(leaf(), leaf(), leaf()), node(leaf())]);
    // PINNED, not bracketed — see the comment on the flattened-tree case
    // above. Was 12.5 before single-child nodes became transparent; recomputed
    // by hand above and confirmed against the actual implementation.
    expect(shapeDistance(a, b)).toBeCloseTo(10, 1);
  });

  it('collapses a single-child wrapper away entirely, not merely half of it', () => {
    // The motivating case: `toSpecs` always inserts one `flex-block` between
    // a section and its children, which used to cost a real page a distance
    // of 40 against its own correctly-built copy. Captured: section -> [h,t,t].
    // Built: section -> flex-block -> [h,t,t]. Once transparent, both reduce
    // to the identical histogram (depth [1,3], fanout {0:3, 3:1}), so this
    // must land at 0 — not "close to 0", exactly 0, because the collapse is
    // exact and nothing else differs between the two trees.
    const captured = shapeOf([node(leaf(), leaf(), leaf())]);
    const built = shapeOf([node(node(leaf(), leaf(), leaf()))]);
    expect(shapeDistance(captured, built)).toBe(0);
  });

  it('does not let the collapse hide a real arrangement loss', () => {
    // A row that genuinely disappeared — its children promoted to sit beside
    // an unrelated sibling instead of grouped under their own container.
    // `row` has THREE children, so it is never transparent; the loss is
    // real and must show up as a distance.
    //
    // (A version of this with no sibling — bare `section -> row -> [c1,c2,c3]`
    // against bare `section -> [c1,c2,c3]` — is NOT a valid regression check:
    // collapsing `section`'s single child in the source makes `row` (3
    // children) take `section`'s place, which is then structurally identical
    // to the built tree's `section` (also 3 children) at depth 0. The
    // wrapper-collapse and the row-loss cancel out. A sibling is what keeps
    // `section` itself from being single-child, so it is never collapsed and
    // the missing `row` level actually shows up.)
    const source = shapeOf([node(node(leaf(), leaf(), leaf()), leaf())]);
    const built = shapeOf([node(leaf(), leaf(), leaf(), leaf())]);
    expect(shapeDistance(source, built)).toBeGreaterThan(10);
  });

  it('answers 0 for two empty trees rather than dividing by nothing', () => {
    expect(shapeDistance(shapeOf([]), shapeOf([]))).toBe(0);
  });
});
