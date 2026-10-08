import { describe, it, expect } from 'vitest';
import { catalogMatches } from '../src/catalog/element-search.js';

const types = (q: string) => catalogMatches(q).map((m) => m.type);

describe('catalogMatches() ranking', () => {
  it.each(['list', 'text', 'image', 'icon', 'list-dataset', 'popup'])(
    'an exact type match comes first: %s',
    (q) => expect(types(q)[0]).toBe(q),
  );

  it('"list" keeps the product list near the top', () => {
    expect(types('list').slice(0, 3)).toContain('list-dataset');
  });

  it('an exact label match ranks first, ignoring case and diacritics', () => {
    expect(types('Product list')[0]).toBe('list-dataset');
    expect(types('PRÓDUCT LÍST')[0]).toBe('list-dataset');
  });

  it('"pagination" finds the list that paginates before the carousel', () => {
    expect(types('pagination')[0]).toBe('list-dataset');
  });

  it('a generated vocabulary value is searchable: load_more reaches list-dataset', () => {
    expect(types('load_more')[0]).toBe('list-dataset');
  });

  it('"sort" reaches the filter controls through their filterSource vocabulary', () => {
    const t = types('sort');
    expect(t).toContain('select');
    expect(t.some((x) => x.startsWith('filter-'))).toBe(true);
  });

  it('a word in the type outranks a mention in prose: "cart"', () => {
    // No element is typed "cart"; the cart-* family is what the word names.
    // A flat substring count tied them with every description mentioning a cart.
    expect(types('cart').slice(0, 5).every((t) => t.startsWith('cart-'))).toBe(true);
  });
});
