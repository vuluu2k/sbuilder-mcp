import { describe, it, expect } from 'vitest';
import { readinessGaps, type ReadinessInput } from '../src/domains/site/readiness.js';

const node = (type: string, extra: Record<string, unknown> = {}) =>
  ({ data: { type }, events: [], bindings: [], ...extra }) as never;

const base: ReadinessInput = {
  pages: [{ type: 'page', status: 'published' }],
  liveGateways: 1,
  shippingMethods: 1,
  pageNodes: [node('heading')],
  globalNodes: [],
};

describe('readinessGaps()', () => {
  it('says nothing about a brochure site', () => {
    expect(readinessGaps(base)).toEqual([]);
  });

  it('reports every gap a store can ship with, most-blocking first', () => {
    const gaps = readinessGaps({
      ...base,
      pages: [{ type: 'page', status: 'published' }],
      liveGateways: 0,
      shippingMethods: 0,
      pageNodes: [node('list-dataset')],
      globalNodes: [],
    });
    // ORDER IS THE CONTRACT: the five that stand between the store and a PAID
    // ORDER come first, then the fixed paths that stand between it and a
    // finished website. A shop with no account page still takes money.
    expect(gaps.map((g) => g.id)).toEqual([
      'checkoutPage',
      'payment',
      'productPage',
      'shipping',
      'accountPage',
      'searchPage',
      'cartTrigger',
    ]);
    for (const g of gaps) {
      expect(g.problem.length).toBeGreaterThan(20);
      expect(g.fix.length).toBeGreaterThan(10);
    }
  });

  it('says "publish it" when the page exists as a draft', () => {
    const gaps = readinessGaps({
      ...base,
      pages: [{ type: 'checkout', status: 'draft' }],
      pageNodes: [node('list-dataset')],
    });
    const checkout = gaps.find((g) => g.id === 'checkoutPage')!;
    expect(checkout.draft).toBe(true);
    expect(checkout.fix).toMatch(/Publish/i);
  });

  it('is SILENT on unread data rather than inventing a gap', () => {
    const gaps = readinessGaps({
      pages: null,
      liveGateways: null,
      shippingMethods: null,
      pageNodes: [node('list-dataset')],
      globalNodes: null,
    });
    expect(gaps).toEqual([]);
  });

  it('a purchase button does not count as a way back to the cart', () => {
    const buyNow = node('button', {
      bindings: [{ id: 'bind-product-action', target: { action: 'add_to_cart' } }],
      events: [{ action: 'open_cart' }],
    });
    const gaps = readinessGaps({ ...base, pageNodes: [node('list-dataset'), buyNow] });
    expect(gaps.map((g) => g.id)).toContain('cartTrigger');
  });

  it('a standalone cart button does', () => {
    const opener = node('button', { events: [{ action: 'open_cart' }] });
    const gaps = readinessGaps({ ...base, pageNodes: [node('list-dataset')], globalNodes: [opener] });
    expect(gaps.map((g) => g.id)).not.toContain('cartTrigger');
  });
});

/**
 * THE OTHER FIXED PATHS.
 *
 * `page.FixedPathTypes` is four — search, checkout, complete, account — each
 * resolving to the site's PUBLISHED page of that type. Only `complete` backstops
 * itself: with no completion page the storefront serves a built-in receipt,
 * measured 200 on a live store that had none. `/account` and `/search` measured
 * 404 on the same store, quietly, because nothing links to them by default.
 */
describe('readinessGaps() — a finished website, not just a paid order', () => {
  const storePages = [
    { type: 'product', status: 'published' },
    { type: 'checkout', status: 'published' },
  ];
  const base = {
    liveGateways: 1,
    shippingMethods: 1,
    pageNodes: [],
    globalNodes: [{ data: { type: 'button' }, events: [{ action: 'open_cart' }] }],
  };
  const ids = (pages: Array<{ type: string; status: string }>) =>
    readinessGaps({ ...base, pages } as never).map((g) => g.id);

  it('reports the account page when none is published', () => {
    expect(ids(storePages)).toContain('accountPage');
  });

  it('reports the search page when none is published', () => {
    expect(ids(storePages)).toContain('searchPage');
  });

  it('says PUBLISH, not create, when the page is only a draft', () => {
    const gaps = readinessGaps({
      ...base,
      pages: [...storePages, { type: 'account', status: 'draft' }],
    } as never);
    const account = gaps.find((g) => g.id === 'accountPage')!;
    expect(account.draft).toBe(true);
    expect(account.fix).toMatch(/Publish/);
  });

  it('is silent once both are published', () => {
    const done = [
      ...storePages,
      { type: 'account', status: 'published' },
      { type: 'search', status: 'published' },
    ];
    expect(ids(done)).not.toContain('accountPage');
    expect(ids(done)).not.toContain('searchPage');
  });

  it('never asks for a completion page — the storefront backstops that one', () => {
    expect(ids(storePages).join(',')).not.toMatch(/complete/i);
  });

  it('stays silent on a site that is not a store at all', () => {
    expect(readinessGaps({ ...base, pages: [{ type: 'page', status: 'published' }] } as never))
      .toEqual([]);
  });
});
