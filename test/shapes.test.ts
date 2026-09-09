import { describe, it, expect } from 'vitest';
import { REQUEST_SHAPES } from '../src/catalog/shapes.generated.js';

/**
 * The three ways `scripts/shapes.ts` used to lose a handler's body, each pinned
 * by an operation that only comes back when that reading is right. Asserted on
 * the GENERATED catalog rather than on the parser, because the parser is only
 * interesting insofar as it reads THIS platform: a unit test over a fixture
 * would have passed on every one of these.
 */
describe('request shapes recovered from the handlers', () => {
  const shape = (id: string) => REQUEST_SHAPES[id];
  const names = (id: string) => (shape(id)?.fields ?? []).map((f) => f.name);

  // A case arm may list SEVERAL methods. `case http.MethodPatch, http.MethodPut:`
  // is how this platform spells "the same body either way", and matching only
  // the first name left the arm unrecognised — the trailing `:` never followed
  // it — so every decode inside belonged to no method.
  it('reads an arm that serves two methods at once', () => {
    expect(names('put:/api/sites/{siteId}/roles/{roleId}')).toEqual(['name', 'permissions']);
  });

  // A doc block is not always above its function. products/rest stacks
  // handleProductLinks's block and handleProductBundles's together and then
  // declares the two functions in the OPPOSITE order, so walking up from a
  // function reached the block documenting the other one — which is worse than
  // a miss, because the wrong handler's decode becomes that route's body.
  it('attributes a doc block by the name it opens with, not by position', () => {
    expect(names('put:/api/sites/{siteId}/products/{productId}/categories')).toEqual(['categoryIds']);
  });

  // …and the shape that mis-attribution would have produced must NOT appear on
  // the neighbour it used to be credited to.
  it('leaves the neighbouring route alone', () => {
    expect(shape('get:/api/sites/{siteId}/products/{productId}/bundles')).toBeUndefined();
  });

  it('still reads a named struct, which is the commonest shape by far', () => {
    const p = names('post:/api/v1/products');
    expect(p.length).toBeGreaterThan(5);
    expect(p).toContain('variants');
  });

  // The whole point of the table: a merchant operation an agent would otherwise
  // have to guess, and `sb_undo` cannot protect without.
  it('covers the great majority of write operations', () => {
    const total = Object.keys(REQUEST_SHAPES).length;
    expect(total).toBeGreaterThanOrEqual(158);
  });
});
