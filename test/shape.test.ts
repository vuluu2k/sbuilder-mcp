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
