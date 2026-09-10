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
      products: { active: 0, purchasable: 0 },
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
      'catalogue',
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

/**
 * NOTHING TO SELL — the most basic question, and the one nothing asked.
 *
 * A store with a published product template, a checkout page, a live gateway and
 * a delivery option reported READY on an empty catalogue. Every repeater on it
 * renders its empty state to a shopper, and the product template has nothing to
 * bind to.
 */
describe('readinessGaps() — the catalogue', () => {
  const ready = {
    pages: [
      { type: 'product', status: 'published' },
      { type: 'checkout', status: 'published' },
      { type: 'account', status: 'published' },
      { type: 'search', status: 'published' },
    ],
    liveGateways: 1,
    shippingMethods: 1,
    pageNodes: [],
    // The badge too, so this fixture isolates the CATALOGUE question: a cart
    // opener with no `cart-count` beside it is its own gap, and a site that is
    // "otherwise ready" has one.
    globalNodes: [
      { data: { type: 'button' }, events: [{ action: 'open_cart' }] },
      { data: { type: 'cart-count' } },
    ],
  };
  const ids = (products: unknown) =>
    readinessGaps({ ...ready, products } as never).map((g) => g.id);
  const gap = (products: unknown) =>
    readinessGaps({ ...ready, products } as never).find((g) => g.id === 'catalogue');

  it('reports an empty catalogue on a site that is otherwise ready', () => {
    expect(ids({ active: 0, purchasable: 0 })).toEqual(['catalogue']);
    expect(gap({ active: 0, purchasable: 0 })!.problem).toMatch(/no active products/i);
  });

  it('reports a catalogue priced entirely at zero, and says how many', () => {
    const g = gap({ active: 7, purchasable: 0 })!;
    expect(g.problem).toMatch(/All 7 active products are priced at zero/);
    expect(g.fix).toMatch(/VND × 100/);
  });

  it('is silent once one product is purchasable', () => {
    expect(ids({ active: 7, purchasable: 1 })).toEqual([]);
  });

  it('is SILENT on unread data rather than inventing an empty shop', () => {
    expect(ids(null)).toEqual([]);
  });
});

/**
 * EVERY CATEGORY SHOWS EVERY PRODUCT — reported from a real storefront, and the
 * one readiness question that is answered by counts rather than by a document.
 *
 * `/collections/{slug}` falls back to the DEFAULT TEMPLATE for the `category`
 * type, and nothing on it narrows the product feed to the category in the URL:
 * `entityScope` threads the entity into the article feed for a blogCategory and
 * the review feed for a product, and into nothing at all for a productCategory.
 */
describe('categoryScope', () => {
  const store = (over: Record<string, unknown>) =>
    readinessGaps({
      pages: [
        { type: 'checkout', status: 'published' },
        { type: 'product', status: 'published' },
        { type: 'complete', status: 'published' },
        { type: 'account', status: 'published' },
        { type: 'search', status: 'published' },
      ],
      liveGateways: 1,
      shippingMethods: 1,
      products: { active: 3, purchasable: 3 },
      pageNodes: null,
      globalNodes: null,
      ...over,
    } as never).map((g) => g.id);

  it('reports a store whose categories all share one template', () => {
    expect(store({ categories: 4, categoryPageLinks: 0 })).toContain('categoryScope');
  });

  it('says nothing once the categories point at pages of their own', () => {
    expect(store({ categories: 4, categoryPageLinks: 4 })).not.toContain('categoryScope');
  });

  // One category CAN be served correctly by the shared template — its repeater
  // just names that one collection — so a single-category store is not a defect.
  it('says nothing about a store with one category', () => {
    expect(store({ categories: 1, categoryPageLinks: 0 })).not.toContain('categoryScope');
  });

  // Silent on what it could not read, like every other check here.
  it('says nothing when the counts are unknown', () => {
    expect(store({ categories: null, categoryPageLinks: null })).not.toContain('categoryScope');
    expect(store({})).not.toContain('categoryScope');
  });
});

/**
 * THE TWO QUESTIONS THAT ARE NOT ABOUT MONEY.
 *
 * Everything else here asks what stands between the site and a paid order.
 * These ask whether the pages are one SITE, and whether a shopper can see their
 * own basket — both true of every website, both invisible to `sb_review`, which
 * reads ONE page and finds it perfect.
 */
describe('readinessGaps() — is this a site at all', () => {
  const store = {
    pages: [
      { type: 'page', status: 'published' },
      { type: 'product', status: 'published' },
      { type: 'checkout', status: 'published' },
    ],
    liveGateways: 1,
    shippingMethods: 1,
    products: { active: 3, purchasable: 3 },
    pageNodes: [],
    globalNodes: [
      { data: { type: 'button' }, events: [{ action: 'open_cart' }] },
      { data: { type: 'cart-count' } },
    ],
  };
  const ids = (over: Record<string, unknown>) =>
    readinessGaps({ ...store, ...over } as never).map((g) => g.id);

  it('reports a multi-page site with no shared section at all', () => {
    expect(ids({ globalKinds: [] })).toContain('siteChrome');
  });

  it('says nothing once the site has one', () => {
    expect(ids({ globalKinds: ['header'] })).not.toContain('siteChrome');
  });

  it('is SILENT on a one-page site — there is nothing to share with', () => {
    expect(ids({ globalKinds: [], pages: [{ type: 'page', status: 'published' }] })).not.toContain(
      'siteChrome',
    );
  });

  it('is SILENT when the list could not be read, rather than inventing an empty one', () => {
    expect(ids({ globalKinds: null })).not.toContain('siteChrome');
    expect(ids({})).not.toContain('siteChrome');
  });

  it('asks it of a plain site too, not only a store', () => {
    // The gate below it returns early for anything that is not a store, and this
    // question is true of every website — so it is asked before the gate.
    const plain = readinessGaps({
      pages: [
        { type: 'page', status: 'published' },
        { type: 'page', status: 'published' },
      ],
      liveGateways: null,
      shippingMethods: null,
      pageNodes: [],
      globalNodes: null,
      globalKinds: [],
    } as never);
    expect(plain.map((g) => g.id)).toEqual(['siteChrome']);
  });

  it('reports a cart that opens with nothing showing what is in it', () => {
    const noBadge = ids({
      globalNodes: [{ data: { type: 'button' }, events: [{ action: 'open_cart' }] }],
    });
    expect(noBadge).toContain('cartCount');
  });

  it('does not say it twice — nothing opens the cart is a different finding', () => {
    const nothingOpens = ids({ globalNodes: [] });
    expect(nothingOpens).toContain('cartTrigger');
    expect(nothingOpens).not.toContain('cartCount');
  });
});
