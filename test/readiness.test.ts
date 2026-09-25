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
      // …and a 404 page, for the same reason the cart badge is below: a site
      // that is "otherwise ready" has one, and without it this fixture would
      // report `errorPage` and stop isolating the CATALOGUE question.
      { type: 'error', status: 'published' },
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

  // Reads `toContain` rather than an exact list: this case is about siteChrome,
  // and a two-page site with no 404 page reports `errorPage` beside it — see the
  // errorPage block below, which owns that assertion.
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
    expect(plain.map((g) => g.id)).toContain('siteChrome');
  });

  it('reports a cart that opens with nothing showing what is in it', () => {
    const noBadge = ids({
      globalNodes: [{ data: { type: 'button' }, events: [{ action: 'open_cart' }] }],
    });
    expect(noBadge).toContain('cartCount');
  });

  it('names the call that actually adds the badge — sb_set on cartCountId mints nothing', () => {
    const gap = readinessGaps({
      ...base,
      pages: [{ type: 'checkout', status: 'published' }],
      globalNodes: [{ data: { type: 'icon' }, events: [{ action: 'open_cart' }] }] as never,
    }).find((g) => g.id === 'cartCount');
    expect(gap?.fix).toContain('sb_add');
    expect(gap?.fix).not.toContain('sb_set');
  });

  it('does not say it twice — nothing opens the cart is a different finding', () => {
    const nothingOpens = ids({ globalNodes: [] });
    expect(nothingOpens).toContain('cartTrigger');
    expect(nothingOpens).not.toContain('cartCount');
  });
});

/**
 * A MISTYPED URL ANSWERS IN GO, NOT IN THE SHOP'S VOICE.
 *
 * storefront/errorpage.go falls through to http.NotFound when the site has no
 * PUBLISHED page of type `error` — the bare "404 page not found" in plain text,
 * no header, no footer, no way back. Unlike the completion page, which backstops
 * itself with a built-in receipt, this fallback carries none of the site. And
 * nothing reports it: the only person who meets it already took a wrong turn.
 */
describe('readinessGaps() — the 404 page', () => {
  const twoPages = [
    { type: 'page', status: 'published' },
    { type: 'page', status: 'published' },
  ];
  const site = (pages: unknown) =>
    readinessGaps({
      pages,
      liveGateways: null,
      shippingMethods: null,
      pageNodes: [],
      globalNodes: null,
      globalKinds: ['header'],
    } as never).map((g) => g.id);

  it('reports a multi-page site with no error page', () => {
    expect(site(twoPages)).toContain('errorPage');
  });

  it('is silent once one is published', () => {
    expect(site([...twoPages, { type: 'error', status: 'published' }])).not.toContain('errorPage');
  });

  it('says PUBLISH, not create, when one exists as a draft', () => {
    const g = readinessGaps({
      pages: [...twoPages, { type: 'error', status: 'draft' }],
      liveGateways: null,
      shippingMethods: null,
      pageNodes: [],
      globalNodes: null,
      globalKinds: ['header'],
    } as never).find((x) => x.id === 'errorPage')!;
    expect(g.draft).toBe(true);
    expect(g.fix).toMatch(/Publish/);
  });

  // THE THRESHOLD, and the contract it protects: a one-page brochure has no
  // second address to mistype and nothing to put in a header, so nagging it
  // about a 404 page is the "says nothing about a brochure site" case failing.
  it('says nothing to a one-page site', () => {
    expect(site([{ type: 'page', status: 'published' }])).not.toContain('errorPage');
  });

  // THE LIVENESS ANCHOR. Every assertion above is about something NOT being
  // reported; this is what proves the fixture can still report at all.
  it('still answers the other site-level question on the same fixture', () => {
    const noChrome = readinessGaps({
      pages: twoPages,
      liveGateways: null,
      shippingMethods: null,
      pageNodes: [],
      globalNodes: null,
      globalKinds: [],
    } as never).map((g) => g.id);
    expect(noChrome).toContain('siteChrome');
    expect(noChrome).toContain('errorPage');
  });
});

/**
 * WHAT /account TELLS AN AGENT TO BUILD.
 *
 * This text is a RULE, not a description: agents follow it literally. It used
 * to say "put login and register forms behind a member-gate with audience
 * guests", and they did — one page carrying the profile, the login form and the
 * register form, with no /login for a header to link to. Reported from a built
 * store. The rule was the cause, so the rule is what these tests pin.
 */
describe('readinessGaps() — the account page tells an agent the right shape', () => {
  const fix = () =>
    readinessGaps({
      pages: [
        { type: 'product', status: 'published' },
        { type: 'checkout', status: 'published' },
        { type: 'error', status: 'published' },
      ],
      liveGateways: 1,
      shippingMethods: 1,
      products: { active: 1, purchasable: 1 },
      pageNodes: [],
      globalNodes: [
        { data: { type: 'button' }, events: [{ action: 'open_cart' }] },
        { data: { type: 'cart-count' } },
      ],
      globalKinds: ['header'],
    } as never).find((g) => g.id === 'accountPage')!.fix;

  it('names login, register and forgot as their own pages', () => {
    for (const template of ['"login"', '"register"', '"forgot"']) {
      expect(fix()).toContain(template);
    }
    expect(fix()).toMatch(/types "login", "register", "page"/);
  });

  it('keeps the members gate, which is what makes /account answer a gated visitor', () => {
    expect(fix()).toMatch(/member-gate/);
    expect(fix()).toMatch(/"members"/);
    expect(fix()).toMatch(/"guests"/);
  });

  // THE REGRESSION ITSELF. A future edit that puts the forms back on /account
  // reads perfectly well and would pass every assertion above.
  it('does not tell the agent to put the forms on /account', () => {
    expect(fix()).toMatch(/not the forms themselves/i);
    expect(fix()).not.toMatch(/put login and register forms behind/i);
  });

  // THE LIVENESS ANCHOR: the fixture really does produce this gap, so the
  // assertions above are read off a real string rather than an empty one.
  it('is a real gap on this fixture', () => {
    expect(fix().length).toBeGreaterThan(80);
  });
});

/**
 * ONE PAGE QUIETLY BECAME THE WHOLE ACCOUNT AREA.
 *
 * This server told agents to put login and register behind a member-gate on
 * /account, and they did. The rule is fixed; the pages it already built are
 * not, and nothing could SEE them — a page document carries `specials.formId`
 * and never the KIND of form, so only the site's own form list tells them apart.
 */
describe('readinessGaps() — account forms stacked on one page', () => {
  const formNode = (formId: string) => ({ data: { type: 'form' }, specials: { formId } });
  const base = {
    pages: [{ type: 'page', status: 'published' }],
    liveGateways: 1,
    shippingMethods: 1,
    globalNodes: [],
    globalKinds: ['header'],
  };
  const ids = (pageNodes: unknown[], forms: unknown) =>
    readinessGaps({ ...base, pageNodes, forms } as never).map((g) => g.id);

  const FORMS = [
    { id: 'f_login', type: 'login' },
    { id: 'f_register', type: 'register' },
    { id: 'f_contact', type: 'contact' },
  ];

  it('reports a page carrying both a login and a register form', () => {
    const got = readinessGaps({
      ...base,
      pageNodes: [formNode('f_login'), formNode('f_register')],
      forms: FORMS,
    } as never).find((g) => g.id === 'mergedAuthPage')!;
    expect(got).toBeTruthy();
    expect(got.problem).toMatch(/login, register/);
    expect(got.fix).toMatch(/page_name/);
  });

  // COUNTED BY DISTINCT TYPE. A form split across segments is several nodes of
  // ONE type, and calling that a merged page would fire on every multi-step form.
  it('is silent on several nodes showing the SAME form', () => {
    expect(ids([formNode('f_login'), formNode('f_login')], FORMS)).not.toContain('mergedAuthPage');
  });

  it('is silent on one account form beside an ordinary one', () => {
    expect(ids([formNode('f_login'), formNode('f_contact')], FORMS)).not.toContain('mergedAuthPage');
  });

  // SILENT ON UNREAD DATA, the rule this whole file keeps: without the form list
  // a formId says nothing, and guessing would fire on a site that is fine.
  it('is silent when the form list could not be read', () => {
    expect(ids([formNode('f_login'), formNode('f_register')], null)).not.toContain('mergedAuthPage');
  });

  it('is silent on a form whose id is not in the list at all', () => {
    expect(ids([formNode('f_gone'), formNode('f_missing')], FORMS)).not.toContain('mergedAuthPage');
  });

  // THE LIVENESS ANCHOR. Five of the six assertions here are that NOTHING is
  // reported; this proves the fixture can still report when it should.
  it('still reports once the second account form is a different kind', () => {
    expect(ids([formNode('f_login'), formNode('f_register')], FORMS)).toContain('mergedAuthPage');
  });
});

/**
 * THE OTHER SIDE OF THE CATALOGUE.
 *
 * /collections/{slug} resolves exactly as /products/{slug} does — to the
 * category's own page, or to the DEFAULT TEMPLATE for the `category` type. A
 * store with categories and no published one 404s every collection link,
 * including the ones its own menu carries. `productPage` had a gap for this
 * shape since the beginning; the category half never did.
 */
describe('readinessGaps() — the category template', () => {
  const store = [
    { type: 'product', status: 'published' },
    { type: 'checkout', status: 'published' },
    { type: 'error', status: 'published' },
    { type: 'account', status: 'published' },
    { type: 'search', status: 'published' },
  ];
  const ids = (pages: unknown[], categories: number | null) =>
    readinessGaps({
      pages,
      categories,
      categoryPageLinks: 0,
      liveGateways: 1,
      shippingMethods: 1,
      products: { active: 1, purchasable: 1 },
      pageNodes: [],
      globalNodes: [
        { data: { type: 'button' }, events: [{ action: 'open_cart' }] },
        { data: { type: 'cart-count' } },
      ],
      globalKinds: ['header'],
    } as never).map((g) => g.id);

  it('reports a store with categories and no category page', () => {
    expect(ids(store, 3)).toContain('categoryPage');
  });

  it('is silent once one is published', () => {
    expect(ids([...store, { type: 'category', status: 'published' }], 3)).not.toContain(
      'categoryPage',
    );
  });

  it('says PUBLISH, not create, when one exists as a draft', () => {
    const g = readinessGaps({
      pages: [...store, { type: 'category', status: 'draft' }],
      categories: 3, categoryPageLinks: 0, liveGateways: 1, shippingMethods: 1,
      products: { active: 1, purchasable: 1 }, pageNodes: [],
      globalNodes: [
        { data: { type: 'button' }, events: [{ action: 'open_cart' }] },
        { data: { type: 'cart-count' } },
      ],
      globalKinds: ['header'],
    } as never).find((x) => x.id === 'categoryPage')!;
    expect(g.draft).toBe(true);
    expect(g.fix).toMatch(/Publish/);
  });

  // GATED ON HAVING CATEGORIES. A shop can genuinely sell from one flat
  // catalogue, and telling it to build a template for a thing it does not use is
  // the nag this file keeps warning about.
  it('says nothing to a store with no categories', () => {
    expect(ids(store, 0)).not.toContain('categoryPage');
  });

  it('says nothing when the count could not be read', () => {
    expect(ids(store, null)).not.toContain('categoryPage');
  });

  // THE LIVENESS ANCHOR: this fixture really does produce gaps, so the four
  // silences above are read off a list that could have contained the finding.
  it('still answers the scope question on the same fixture', () => {
    expect(ids([...store, { type: 'category', status: 'published' }], 3)).toContain(
      'categoryScope',
    );
  });
});

/**
 * ARTICLES WRITTEN AND NOTHING TO RENDER THEM IN.
 *
 * `post` is the ARTICLE template: /blog/{slug} resolves to the site's published
 * page of that type. A site that has written articles and has none 404s every
 * one — including the links its own listing page carries, which is the page
 * that makes them findable at all.
 */
describe('readinessGaps() — the article template', () => {
  const plain = (extra: Record<string, unknown>) =>
    readinessGaps({
      pages: [{ type: 'page', status: 'published' }],
      liveGateways: null,
      shippingMethods: null,
      pageNodes: [],
      globalNodes: null,
      globalKinds: ['header'],
      ...extra,
    } as never).map((g) => g.id);

  it('reports a site that has written articles and has no post page', () => {
    expect(plain({ articles: 4 })).toContain('articleTemplate');
  });

  it('is silent once one is published', () => {
    expect(
      plain({
        articles: 4,
        pages: [
          { type: 'page', status: 'published' },
          { type: 'post', status: 'published' },
        ],
      }),
    ).not.toContain('articleTemplate');
  });

  // GATED ON HAVING WRITTEN SOMETHING. A site with no blog hears nothing about
  // a template for a section it does not have.
  it('says nothing to a site with no articles', () => {
    expect(plain({ articles: 0 })).not.toContain('articleTemplate');
  });

  it('says nothing when the count could not be read', () => {
    expect(plain({ articles: null })).not.toContain('articleTemplate');
    expect(plain({})).not.toContain('articleTemplate');
  });

  // ASKED OF EVERY SITE, above the store gate: a blog is not a commerce feature
  // and a brochure site with a news section has exactly this problem. This
  // fixture is not a store — if the check sat below the gate it would never run.
  it('asks it of a site that is not a store', () => {
    expect(plain({ articles: 4 })).toContain('articleTemplate');
  });
});

/**
 * THE FIVE ENTITY PREFIXES, AS ONE SET.
 *
 * storefront/entityroute.go registers /products, /collections, /blog,
 * /blog-categories and /courses. Each resolves to the site's published page of
 * its own TYPE, so each 404s everything under it when that page is missing.
 * This block is the proof that all five are now asked about, rather than four
 * and whichever one nobody noticed.
 */
describe('readinessGaps() — every entity prefix has a template check', () => {
  const site = (extra: Record<string, unknown>) =>
    readinessGaps({
      pages: [{ type: 'page', status: 'published' }],
      liveGateways: null,
      shippingMethods: null,
      pageNodes: [],
      globalNodes: null,
      globalKinds: ['header'],
      ...extra,
    } as never).map((g) => g.id);

  const CASES = [
    { count: { articles: 3 }, id: 'articleTemplate', type: 'post' },
    { count: { blogCategories: 3 }, id: 'blogCategoryPage', type: 'blog' },
    { count: { courses: 3 }, id: 'coursePage', type: 'course' },
  ];

  it('reports each one when its entities exist and its template does not', () => {
    for (const c of CASES) expect(site(c.count), c.id).toContain(c.id);
  });

  it('is silent for each once its template is published', () => {
    for (const c of CASES) {
      const pages = [
        { type: 'page', status: 'published' },
        { type: c.type, status: 'published' },
      ];
      expect(site({ ...c.count, pages }), c.id).not.toContain(c.id);
    }
  });

  // THE COUNT IS THE GATE. A site with no courses has not installed the app; a
  // site with no blog categories has nothing under that prefix to break.
  it('is silent for each when the site has none of that entity', () => {
    for (const c of CASES) {
      const zero = Object.fromEntries(Object.keys(c.count).map((k) => [k, 0]));
      expect(site(zero), c.id).not.toContain(c.id);
    }
  });

  it('is silent for each when the count could not be read', () => {
    for (const c of CASES) {
      const unread = Object.fromEntries(Object.keys(c.count).map((k) => [k, null]));
      expect(site(unread), c.id).not.toContain(c.id);
    }
  });

  // THE PRODUCT AND CATEGORY HALVES ARE THE OTHER TWO, checked in their own
  // blocks — named here so the set of five is stated in one place.
  it('covers the store halves too', () => {
    const store = site({
      categories: 2,
      products: { active: 1, purchasable: 1 },
      pageNodes: [{ data: { type: 'list-dataset' } }],
    });
    expect(store).toContain('productPage');
    expect(store).toContain('categoryPage');
  });
});

/**
 * THE SITE IS DARK RIGHT NOW.
 *
 * The only finding here that is not about what a visitor MIGHT meet: with the
 * switch on, every public address is answering 503 this second. maintenance.go
 * serves the published `maintain` page as that body when there is one and a
 * plain sentence when there is not — and it fails closed, so the shop stays
 * shut either way. What the owner loses is every word of it.
 */
describe('readinessGaps() — the maintenance page', () => {
  const site = (extra: Record<string, unknown>) =>
    readinessGaps({
      pages: [{ type: 'page', status: 'published' }],
      liveGateways: null,
      shippingMethods: null,
      pageNodes: [],
      globalNodes: null,
      globalKinds: ['header'],
      ...extra,
    } as never).map((g) => g.id);

  it('reports a switched-off site with no maintenance page', () => {
    expect(site({ maintenanceMode: true })).toContain('maintenancePage');
  });

  it('is reported FIRST, because it is the only one already happening', () => {
    expect(site({ maintenanceMode: true })[0]).toBe('maintenancePage');
  });

  it('is silent once one is published', () => {
    expect(
      site({
        maintenanceMode: true,
        pages: [
          { type: 'page', status: 'published' },
          { type: 'maintain', status: 'published' },
        ],
      }),
    ).not.toContain('maintenancePage');
  });

  // ONLY WHILE THE SWITCH IS ON. Otherwise this is advice about a page nobody
  // will see, arriving on every review of every site — the nag at its widest.
  it('says nothing to a site that is open', () => {
    expect(site({ maintenanceMode: false })).not.toContain('maintenancePage');
  });

  it('says nothing when the site could not be read', () => {
    expect(site({ maintenanceMode: null })).not.toContain('maintenancePage');
    expect(site({})).not.toContain('maintenancePage');
  });

  it('says PUBLISH, not create, when one exists as a draft', () => {
    const g = readinessGaps({
      pages: [
        { type: 'page', status: 'published' },
        { type: 'maintain', status: 'draft' },
      ],
      maintenanceMode: true,
      liveGateways: null, shippingMethods: null, pageNodes: [],
      globalNodes: null, globalKinds: ['header'],
    } as never).find((x) => x.id === 'maintenancePage')!;
    expect(g.draft).toBe(true);
    expect(g.fix).toMatch(/Publish/);
  });
});

describe('cartDrawer — a control opens the cart and the site has no drawer', () => {
  const store = {
    ...base,
    pages: [{ type: 'checkout', status: 'published' }],
    globalNodes: [node('icon', { events: [{ name: 'click', action: 'open_cart' }] })],
  };
  const idsOf = (extra: Partial<ReadinessInput>) => readinessGaps({ ...store, ...extra }).map((g) => g.id);

  it('reports it, naming the call that creates one', () => {
    const gap = readinessGaps({ ...store, overlayKinds: ['popup'] }).find((g) => g.id === 'cartDrawer');
    expect(gap?.fix).toContain('sb_store action:"cart"');
  });

  it('is silent when the site has one, when nothing opens the cart, or when the list was unread', () => {
    expect(idsOf({ overlayKinds: ['cart'] })).not.toContain('cartDrawer');
    expect(idsOf({ overlayKinds: [], globalNodes: [] })).not.toContain('cartDrawer');
    expect(idsOf({ overlayKinds: null })).not.toContain('cartDrawer');
  });
});
