import { describe, it, expect } from 'vitest';
import {
  canonFor,
  choosePages,
  nameFor,
  normalizeUrl,
  robotsRules,
  robotsSitemaps,
  sitemapKind,
  sitemapUrls,
  slugFor,
  type Found,
} from '../src/domains/site/discover.js';
import { fromSitemap } from '../src/tools/importpage.js';
import { Session } from '../src/transport/auth.js';
import { connectedClient } from './harness.js';

/**
 * DISCOVERY IS THE HALF `sb_import` NEVER HAD, and it is pure for the same
 * reason `importmap.ts` is: what counts as a page of a stranger's site is a
 * pile of judgement calls, and they are worth arguing over without a browser
 * and without a network.
 */

const links = (...urls: string[]): Found[] => urls.map((url) => ({ url, from: 'links' }));

describe('normalizeUrl — one page must have one name', () => {
  it('folds the four spellings of the same page', () => {
    const canonical = 'https://shop.example/about';
    expect(normalizeUrl('https://shop.example/about')).toBe(canonical);
    expect(normalizeUrl('https://shop.example/about/')).toBe(canonical);
    expect(normalizeUrl('https://shop.example/about#team')).toBe(canonical);
    expect(normalizeUrl('/about/', 'https://shop.example/x/y')).toBe(canonical);
  });

  it('folds index.html onto the directory, and keeps the root a root', () => {
    expect(normalizeUrl('https://shop.example/index.html')).toBe('https://shop.example/');
    expect(normalizeUrl('https://shop.example')).toBe('https://shop.example/');
  });

  it('refuses what is not a page address, including a base that cannot resolve', () => {
    expect(normalizeUrl('mailto:a@b.c')).toBeNull();
    expect(normalizeUrl('javascript:void(0)')).toBeNull();
    expect(normalizeUrl('tel:+84')).toBeNull();
    // `new URL(rel, base)` THROWS on a non-hierarchical base. One bad href on
    // one page must not end a crawl, so this is null rather than a throw.
    expect(normalizeUrl('/a', 'data:text/html,x')).toBeNull();
  });
});

describe('sitemapUrls — the publisher\'s own list', () => {
  it('reads locs, and decodes the entities a generator escapes', () => {
    const xml =
      '<?xml version="1.0"?><urlset><url><loc>https://s.example/a</loc></url>' +
      '<url><loc>https://s.example/b?x=1&amp;y=2</loc></url></urlset>';
    expect(sitemapUrls(xml).pages).toEqual(['https://s.example/a', 'https://s.example/b?x=1&y=2']);
    expect(sitemapUrls(xml).sitemaps).toEqual([]);
  });

  it('an INDEX yields sitemaps, not pages — taking its locs as pages imports XML files', () => {
    const xml =
      '<sitemapindex><sitemap><loc>https://s.example/sitemap-1.xml</loc></sitemap></sitemapindex>';
    expect(sitemapUrls(xml)).toEqual({ pages: [], sitemaps: ['https://s.example/sitemap-1.xml'] });
  });

  it('reads the Sitemap: lines out of a robots.txt, whatever the case', () => {
    expect(robotsSitemaps('User-agent: *\nDisallow:\nSITEMAP: https://s.example/sm.xml\n')).toEqual([
      'https://s.example/sm.xml',
    ]);
  });
});

describe('sitemapKind — what a child sitemap says its own <loc>s are', () => {
  it('reads the ttgshop.vn shape: one word after the underscore', () => {
    expect(sitemapKind('https://ttgshop.vn/sitemap_product.xml')).toBe('product');
    expect(sitemapKind('https://ttgshop.vn/sitemap_category.xml')).toBe('category');
    expect(sitemapKind('https://ttgshop.vn/sitemap_brand.xml')).toBe('brand');
    expect(sitemapKind('https://ttgshop.vn/sitemap_article.xml')).toBe('article');
    expect(sitemapKind('https://ttgshop.vn/sitemap_page.xml')).toBe('page');
  });

  it('reads the other generators\' spellings — Yoast\'s prefix and Shopify\'s numbered suffix', () => {
    expect(sitemapKind('https://s.example/product-sitemap.xml')).toBe('product'); // Yoast
    expect(sitemapKind('https://s.example/sitemap-products.xml')).toBe('product');
    expect(sitemapKind('https://s.example/sitemap_products_1.xml')).toBe('product'); // Shopify
    expect(sitemapKind('https://s.example/SITEMAP_Collections.xml')).toBe('collection');
  });

  it('says nothing about a generic index child — the case this must never change', () => {
    // sitemap1.xml / sitemap2.xml is what a caller gets when the generator does
    // not bother naming its own kinds. `undefined` here is what keeps every
    // site shaped like that importing exactly as it did before this existed.
    expect(sitemapKind('https://s.example/sitemap1.xml')).toBeUndefined();
    expect(sitemapKind('https://s.example/sitemap2.xml')).toBeUndefined();
    expect(sitemapKind('https://s.example/sitemap.xml')).toBeUndefined();
    expect(sitemapKind('https://s.example/sitemap_index.xml')).toBeUndefined();
  });

  it('does not fire on a coincidental substring — only a whole word counts', () => {
    // A raw substring test on "category" or "collection" risks a hit inside an
    // unrelated word; matching whole tokens (split on anything that is not a
    // letter or digit) means the filename has to actually SPELL the word.
    expect(sitemapKind('https://s.example/recollections-sitemap.xml')).toBeUndefined();
    expect(sitemapKind('https://s.example/vacation-guide-sitemap.xml')).toBeUndefined();
  });

  it('resolves a name carrying several kind words to the ENTITY, not the page', () => {
    // A WordPress "blog categories" taxonomy archive sitemap names both a page
    // word and an entity word. Entity words are checked first: excluding a
    // pile of catalogue records is the safe direction to be wrong in, and
    // importing them as static pages is the defect this function exists to
    // prevent.
    expect(sitemapKind('https://s.example/sitemap-blog-categories.xml')).toBe('category');
    expect(sitemapKind('https://s.example/sitemap-post-tags.xml')).toBe('tag');
  });
});

describe('choosePages — which URLs become pages', () => {
  const entry = 'https://shop.example/';

  it('keeps the site, drops everything that is not a page of it, and counts each reason', () => {
    const got = choosePages(
      entry,
      links(
        'https://shop.example/about',
        'https://other.example/about',
        'https://shop.example/brochure.pdf',
        'https://shop.example/wp-login.php',
        'https://shop.example/collections?sort=price',
        'https://shop.example/about/',
      ),
      {},
    );
    expect(got.pages.map((p) => p.url)).toEqual([entry, 'https://shop.example/about']);
    expect(got.skipped).toMatchObject({
      'off-site': 1,
      asset: 1,
      'not-content': 1,
      query: 1,
      duplicate: 1,
    });
  });

  it('takes the SHALLOWEST pages when the cap bites, with the entry first', () => {
    // A sitemap lists what its generator emitted first, which on a shop is a
    // hundred products. Taking the file's order gives a site with no home page.
    const got = choosePages(
      entry,
      links(
        'https://shop.example/blog/2024/a-long-post',
        'https://shop.example/about',
        'https://shop.example/blog',
        'https://shop.example/contact',
      ),
      { maxPages: 3 },
    );
    expect(got.pages.map((p) => p.url)).toEqual([
      entry,
      'https://shop.example/about',
      'https://shop.example/blog',
    ]);
    expect(got.skipped['over-page-limit']).toBe(2);
  });

  it('reports a repeated prefix, because those are ONE template here and not N pages', () => {
    const got = choosePages(
      entry,
      links(
        'https://shop.example/products/a',
        'https://shop.example/products/b',
        'https://shop.example/products/c',
        'https://shop.example/about',
      ),
      { maxPages: 2 },
    );
    // Counted BEFORE the cap: the point of the report is to say what the cap is
    // about to hide.
    expect(got.groups).toEqual({ products: 3 });
  });

  it('drops the plumbing wherever it sits in the path, and keeps the pages that merely start like it', () => {
    // A SUBSTRING TEST DROPS REAL PAGES and a LEADING ANCHOR misses real
    // plumbing — a locale prefix is the ordinary shape of the sites this tool is
    // pointed at. The needle begins with `/`, so only the right boundary has to
    // be checked, anywhere in the path.
    const keep = ['/feedback', '/cartier-watches', '/comments-policy', '/registered-office'];
    const drop = ['/cart', '/en/cart', '/vi/account', '/shop/checkout', '/en/wp-login.php', '/blog/tag/x'];
    const got = choosePages(
      entry,
      links(...[...keep, ...drop].map((p) => `https://shop.example${p}`)),
      { maxPages: 60 },
    );
    const paths = got.pages.map((p) => new URL(p.url).pathname);
    for (const k of keep) expect(paths, k).toContain(k);
    for (const d of drop) expect(paths, d).not.toContain(d);
    expect(got.skipped['not-content']).toBe(drop.length);
  });

  it('drops page 2 of a list — this platform renders its own pagination', () => {
    const got = choosePages(
      entry,
      links('https://shop.example/blog', 'https://shop.example/blog/page/2', 'https://shop.example/blog/2024'),
      {},
    );
    const paths = got.pages.map((p) => new URL(p.url).pathname);
    expect(paths).toContain('/blog');
    // A year archive is a real page; only an explicit `page` segment is not.
    expect(paths).toContain('/blog/2024');
    expect(paths).not.toContain('/blog/page/2');
    expect(got.skipped.pagination).toBe(1);
  });

  it('keeps ONE page per page, not one per language — and only when they collide', () => {
    // A multilingual sitemap lists every translation, so the same page arrives
    // three times under three slugs, spending the budget on content this
    // platform has a translations surface for.
    const many = choosePages(
      entry,
      links(
        'https://shop.example/about',
        'https://shop.example/en/about',
        'https://shop.example/vi/about',
        'https://shop.example/en/pricing',
      ),
      {},
    );
    const paths = many.pages.map((p) => new URL(p.url).pathname);
    expect(paths).toContain('/about');
    expect(paths).not.toContain('/en/about');
    expect(paths).not.toContain('/vi/about');
    // `/en/pricing` has no counterpart, so nothing folds it away.
    expect(paths).toContain('/en/pricing');
    expect(many.skipped['other-locale']).toBe(2);
  });

  it('a site that serves EVERY page under one locale keeps all of them', () => {
    // The rule that simply dropped a `/xx/` prefix would empty this plan.
    // nodejs.org is the real case: every page lives under /en.
    const all = choosePages(
      'https://nodejs.org/en',
      links('https://nodejs.org/en/about', 'https://nodejs.org/en/download'),
      {},
    );
    expect(all.pages.map((p) => new URL(p.url).pathname).sort()).toEqual([
      '/en',
      '/en/about',
      '/en/download',
    ]);
    expect(all.skipped['other-locale']).toBeUndefined();
  });

  it('honours the site\'s robots.txt, but never for the URL the caller named', () => {
    const rules = robotsRules('User-agent: *\nDisallow: /internal\nAllow: /internal/press\n');
    const got = choosePages(
      'https://shop.example/internal',
      links(
        'https://shop.example/internal/secret',
        'https://shop.example/internal/press',
        'https://shop.example/about',
      ),
      { robots: rules },
    );
    const paths = got.pages.map((p) => new URL(p.url).pathname);
    // The entry is exempt: the caller typed it.
    expect(paths).toContain('/internal');
    // Longest match wins, so an Allow under a Disallow is honoured.
    expect(paths).toContain('/internal/press');
    expect(paths).toContain('/about');
    expect(paths).not.toContain('/internal/secret');
    expect(got.skipped['robots-disallow']).toBe(1);
  });

  it('an explicit include outranks the plumbing list; exclude drops what it names', () => {
    const kept = choosePages(entry, links('https://shop.example/account'), {
      include: ['/account'],
    });
    // The entry is page one when nothing narrows the site — but `include`
    // narrows the WHOLE site, entry included: a caller who asked for /account
    // pages did not ask for the home page.
    expect(kept.pages.map((p) => p.url)).toEqual(['https://shop.example/account']);

    const dropped = choosePages(entry, links('https://shop.example/blog/a'), { exclude: ['/blog'] });
    expect(dropped.pages.map((p) => p.url)).toEqual([entry]);
    expect(dropped.skipped.excluded).toBe(1);
  });

  /**
   * A `Found` tagged with the KIND its own sitemap named — never a guess made
   * here, always carried in from `fromSitemap` reading a child sitemap's
   * filename.
   */
  const tagged = (kind: Found['kind'], ...urls: string[]): Found[] =>
    urls.map((url) => ({ url, from: 'sitemap' as const, kind }));

  it('excludes record-shaped kinds by default and reports their counts, keeping page-shaped ones', () => {
    const found: Found[] = [
      ...tagged('product', ...Array.from({ length: 2000 }, (_, i) => `https://shop.example/p-${i}`)),
      ...tagged('category', ...Array.from({ length: 177 }, (_, i) => `https://shop.example/c-${i}`)),
      ...tagged('brand', ...Array.from({ length: 116 }, (_, i) => `https://shop.example/b-${i}`)),
      ...tagged('page', 'https://shop.example/dieu-khoan', 'https://shop.example/chinh-sach'),
      ...tagged('article', 'https://shop.example/tin-tuc/a', 'https://shop.example/tin-tuc/b'),
    ];
    const got = choosePages(entry, found, { maxPages: 60 });
    const paths = got.pages.map((p) => new URL(p.url).pathname);
    expect(paths).toContain('/dieu-khoan');
    expect(paths).toContain('/chinh-sach');
    expect(paths).toContain('/tin-tuc/a');
    expect(paths).toContain('/tin-tuc/b');
    // None of the 2,293 record-shaped URLs became a page.
    expect(got.pages.length).toBe(5); // entry + 2 pages + 2 articles
    expect(got.kinds).toEqual({ product: 2000, category: 177, brand: 116 });
    expect(got.skipped['entity-kind']).toBe(2293);
    // NOT counted toward the cap this run never came close to hitting — an
    // entity exclusion is not the same event as the page budget running out.
    expect(got.skipped['over-page-limit']).toBeUndefined();
  });

  it('plans a kindless index EXACTLY as it always has — the regression this must never cause', () => {
    // A sitemap whose children are named "sitemap1.xml" / "sitemap2.xml" — or
    // one flat sitemap with no kind hint at all — carries no `kind` on any
    // `Found`, and that is the entire test: nothing above may treat an
    // undefined kind as anything other than an ordinary, unclassified URL.
    const untagged = links(
      'https://shop.example/products/a',
      'https://shop.example/products/b',
      'https://shop.example/products/c',
      'https://shop.example/about',
    );
    const withKindField: Found[] = untagged.map((f) => ({ ...f, kind: undefined }));
    const got = choosePages(entry, withKindField, { maxPages: 2 });
    // Byte-for-byte the same plan `choosePages` already gives this fixture
    // without any `kind` field at all (see "reports a repeated prefix" above):
    // the products still show up as a path-prefix GROUP, not an entity
    // exclusion, and the cap — not a kind rule — is what hides them.
    expect(got.pages.map((p) => p.url)).toEqual([entry, 'https://shop.example/about']);
    expect(got.groups).toEqual({ products: 3 });
    expect(got.kinds).toEqual({});
    expect(got.skipped['entity-kind']).toBeUndefined();
    // entry + about + 3 products = 5 candidates, cap 2 → 3 hidden by the cap,
    // not by any kind rule.
    expect(got.skipped['over-page-limit']).toBe(3);
  });

  it('an explicit include still selects a product URL', () => {
    const found = tagged(
      'product',
      'https://shop.example/hot-item',
      'https://shop.example/other-item',
    );
    const got = choosePages(entry, found, { include: ['/hot-item'] });
    expect(got.pages.map((p) => p.url)).toEqual(['https://shop.example/hot-item']);
    expect(got.kinds).toEqual({});
    expect(got.skipped['entity-kind']).toBeUndefined();
  });
});

describe('slugFor — the identity a page takes on this site', () => {
  it('the root is the home page, and a path becomes one flat slug', () => {
    const taken = new Set<string>();
    expect(slugFor('https://s.example/', taken)).toBe('home');
    expect(slugFor('https://s.example/blog/first-post', taken)).toBe('blog-first-post');
  });

  it('settles a collision HERE, because the platform would rename it and report success', () => {
    const taken = new Set<string>();
    expect(slugFor('https://s.example/a/b', taken)).toBe('a-b');
    expect(slugFor('https://s.example/a-b', taken)).toBe('a-b-2');
  });

  it('transliterates Vietnamese rather than losing it', () => {
    // NFD does not decompose đ, so a naive strip turns "Đẹp" into "ep".
    expect(slugFor('https://s.example/trang-chủ-đẹp', new Set())).toBe('trang-chu-dep');
  });

  it('names a page after its slug when nothing better is known yet', () => {
    expect(nameFor('lien-he')).toBe('Lien He');
    expect(nameFor('home')).toBe('Home');
  });
});

describe('canonFor — what a crawl may spend a navigation on', () => {
  const canon = canonFor('https://shop.example/');
  it('keeps a same-origin page in one spelling and drops the rest', () => {
    expect(canon('/about/')).toBe('https://shop.example/about');
    expect(canon('https://other.example/a')).toBeNull();
    expect(canon('/logo.svg')).toBeNull();
    expect(canon('/cart')).toBeNull();
    // The crawl shares the table, so it must agree — a page the plan would drop
    // must never cost a navigation.
    expect(canon('/en/cart')).toBeNull();
    expect(canon('/cartier-watches')).toBe('https://shop.example/cartier-watches');
    expect(canon('#top')).toBe('https://shop.example/');
  });
});

/**
 * THE TOOL, over the real transport, with no browser.
 *
 * A site that offers a sitemap never launches Chrome for discovery, which is
 * exactly why the sitemap path is tried first — and it makes the whole dry run
 * testable offline.
 */
describe('sb_import_site — the plan, before anything is created', () => {
  const sitemap =
    '<urlset>' +
    ['/', '/about', '/lien-he', '/products/a', '/products/b', '/products/c', '/cart']
      .map((p) => `<url><loc>https://shop.example${p}</loc></url>`)
      .join('') +
    '</urlset>';

  const foreign = (async (input: string | URL) => {
    const u = String(input);
    if (u.endsWith('/robots.txt')) {
      return new Response('User-agent: *\nSitemap: https://shop.example/sm.xml\n', { status: 200 });
    }
    if (u.endsWith('/sm.xml')) return new Response(sitemap, { status: 200 });
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;

  it('finds the pages, names the identity each will take, and creates nothing', async () => {
    const { client, close } = await connectedClient({ fetchImpl: foreign });
    const res = (await client.callTool({
      name: 'sb_import_site',
      arguments: { url: 'https://shop.example', site_id: 'S1' },
    })) as { content: Array<{ text?: string }> };
    const out = JSON.parse(res.content[0].text!);

    expect(out.dry_run).toBe(true);
    expect(out.discovered_by).toBe('sitemap');
    expect(out.pages.map((p: { slug: string }) => p.slug)).toEqual([
      'home',
      'about',
      'lien-he',
      'products-a',
      'products-b',
      'products-c',
    ]);
    // The cart is a page of somebody else's shop machinery, and this platform
    // serves its own at a fixed path.
    expect(out.skipped['not-content']).toBe(1);
    // AND NOT A PHANTOM LOSS: the entry is injected by `choosePages` and handed
    // back by the discovery too, and counting that collision reported a page
    // dropped when none was.
    expect(out.skipped.duplicate).toBeUndefined();
    // AND THE ONE THING A PAGE COUNT CANNOT SAY: three URLs under /products are
    // one bound template here, not three static pages.
    expect(out.entity_pages).toMatch(/products \(3\)/);
    expect(out.entity_pages).toMatch(/sb_page_create/);
    // NO CREDENTIAL HERE, and asking what is on a website needs none — so the
    // discovery still answers in full, and the half it could not check says so
    // rather than being guessed.
    expect(out.landing_unknown).toMatch(/could not be read/);
    await close();
  });

  it('sends NO credential to the stranger\'s server it reads the sitemap from', async () => {
    // Every path through `request()` attaches one, so the sitemap fetch
    // deliberately does not go through it. A refactor that "tidied" it back onto
    // the shared transport would hand this install's key to whoever the caller
    // pasted a link to, and the mock fetch in the other tests ignores its second
    // argument — so nothing else here would notice.
    const seen: Array<[string, RequestInit | undefined]> = [];
    const spy = (async (input: string | URL, init?: RequestInit) => {
      const u = String(input);
      seen.push([u, init]);
      if (u.endsWith('/robots.txt')) {
        return new Response('Sitemap: https://shop.example/sm.xml', { status: 200 });
      }
      if (u.endsWith('/sm.xml')) return new Response(sitemap, { status: 200 });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const session = new Session('http://x', spy);
    (session as unknown as { access: string }).access = 'secret-jwt';
    const { client, close } = await connectedClient({ fetchImpl: spy, session });
    await client.callTool({
      name: 'sb_import_site',
      arguments: { url: 'https://shop.example', site_id: 'S1' },
    });

    const foreignCalls = seen.filter(([u]) => u.startsWith('https://shop.example'));
    expect(foreignCalls.length).toBeGreaterThan(0);
    for (const [u, init] of foreignCalls) {
      expect(init?.headers, u).toBeUndefined();
      expect(JSON.stringify(init ?? {}), u).not.toMatch(/secret-jwt|Authorization/i);
    }
    await close();
  });

  it('says where each page will LAND — the home page it merges into, the slug it collides with', async () => {
    // A preview whose count does not survive contact with the run is not a
    // preview: the platform RENAMES a colliding slug and answers 200, so the run
    // skips those, and the entry is merged into the home page rather than given
    // one of its own.
    const withSite = (async (input: string | URL) => {
      const u = String(input);
      if (u.endsWith('/robots.txt')) {
        return new Response('Sitemap: https://shop.example/sm.xml', { status: 200 });
      }
      if (u.endsWith('/sm.xml')) return new Response(sitemap, { status: 200 });
      if (u.includes('/api/sites/')) {
        return new Response(
          JSON.stringify({
            pages: [
              { id: 'p-home', slug: 'trang-chu', isHomepage: true },
              { id: 'p-about', slug: 'about' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;

    const session = new Session('http://x', withSite);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({ fetchImpl: withSite, session });
    const res = (await client.callTool({
      name: 'sb_import_site',
      arguments: { url: 'https://shop.example', site_id: 'S1' },
    })) as { content: Array<{ text?: string }> };
    const out = JSON.parse(res.content[0].text!);
    const byslug = Object.fromEntries(out.pages.map((p: Record<string, unknown>) => [p.slug, p]));
    expect(byslug.home.into).toMatch(/home page/);
    expect(byslug.about.conflict).toMatch(/already exists/);
    expect(byslug['lien-he'].conflict).toBeUndefined();
    await close();
  });

  it('a sitemap listing one page is not a sitemap — it falls through rather than importing a one-page site', async () => {
    // Asserted on the discovery itself rather than through the tool: falling
    // through means launching Chrome to crawl, and a unit test that depends on a
    // browser and on DNS is a test that fails for reasons it is not about. It
    // did, in the full suite, while passing alone.
    const serve = (body: string) =>
      (async (input: string | URL) => {
        const u = String(input);
        if (u.endsWith('.xml')) return new Response(body, { status: 200 });
        return new Response('', { status: 404 });
      }) as unknown as typeof fetch;
    const ctxWith = (fetchImpl: typeof fetch) =>
      ({ base: 'http://x', fetchImpl } as unknown as Parameters<typeof fromSitemap>[0]);

    const one = '<urlset><url><loc>https://shop.example/</loc></url></urlset>';
    expect(await fromSitemap(ctxWith(serve(one)), 'https://shop.example/')).toBeNull();

    const two =
      '<urlset><url><loc>https://shop.example/</loc></url>' +
      '<url><loc>https://shop.example/about</loc></url></urlset>';
    const got = await fromSitemap(ctxWith(serve(two)), 'https://shop.example/');
    expect(got?.map((f) => f.url)).toContain('https://shop.example/about');
  });
});

/**
 * THE GAP THIS FILE EXISTS TO CLOSE, measured against the real shape of
 * ttgshop.vn: a sitemap INDEX whose children are named by kind
 * (`sitemap_product.xml`, `sitemap_category.xml`, …), pointing at ~2,000
 * products and 177 categories that sit at the site's ROOT with no shared path
 * prefix at all — so the old prefix-only `groups` heuristic could never have
 * caught them, and every one used to be an ordinary candidate page fighting
 * eleven static pages for a 12-page budget.
 */
describe('sb_import_site over a KIND-NAMED sitemap index — the ttgshop.vn shape', () => {
  const ctxWith = (fetchImpl: typeof fetch) =>
    ({ base: 'http://x', fetchImpl } as unknown as Parameters<typeof fromSitemap>[0]);

  const index =
    '<sitemapindex>' +
    [
      'https://ttgshop.vn/sitemap_product.xml',
      'https://ttgshop.vn/sitemap_category.xml',
      'https://ttgshop.vn/sitemap_brand.xml',
      'https://ttgshop.vn/sitemap_article.xml',
      'https://ttgshop.vn/sitemap_page.xml',
    ]
      .map((u) => `<sitemap><loc>${u}</loc></sitemap>`)
      .join('') +
    '</sitemapindex>';

  const urlset = (paths: string[]) =>
    '<urlset>' + paths.map((p) => `<url><loc>https://ttgshop.vn${p}</loc></url>`).join('') + '</urlset>';

  const products = Array.from({ length: 5 }, (_, i) => `/san-pham-${i}`);
  const categories = Array.from({ length: 4 }, (_, i) => `/danh-muc-${i}`);
  const brands = Array.from({ length: 3 }, (_, i) => `/brand/hang-${i}`);
  const articles = ['/tin-tuc/bai-1', '/tin-tuc/bai-2'];
  const pages = [
    '/chinh-sach-bao-mat',
    '/chinh-sach-doi-tra',
    '/chinh-sach-van-chuyen',
    '/dieu-khoan-su-dung',
    '/quy-dinh-bao-hanh',
    '/phuong-thuc-thanh-toan',
    '/tai-khoan-ngan-hang',
    '/giai-phap-pc-doanh-nghiep-tron-goi',
  ];

  const serve = (async (input: string | URL) => {
    const u = String(input);
    if (u.endsWith('/sitemap.xml')) return new Response(index, { status: 200 });
    if (u.endsWith('sitemap_product.xml')) return new Response(urlset(products), { status: 200 });
    if (u.endsWith('sitemap_category.xml')) return new Response(urlset(categories), { status: 200 });
    if (u.endsWith('sitemap_brand.xml')) return new Response(urlset(brands), { status: 200 });
    if (u.endsWith('sitemap_article.xml')) return new Response(urlset(articles), { status: 200 });
    if (u.endsWith('sitemap_page.xml')) return new Response(urlset(pages), { status: 200 });
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;

  it('fromSitemap carries the CHILD sitemap\'s own kind onto every URL it lists', async () => {
    const found = await fromSitemap(ctxWith(serve), 'https://ttgshop.vn/');
    expect(found).not.toBeNull();
    const kindOf = (path: string) => found!.find((f) => f.url === `https://ttgshop.vn${path}`)?.kind;
    expect(kindOf('/san-pham-0')).toBe('product');
    expect(kindOf('/danh-muc-0')).toBe('category');
    expect(kindOf('/brand/hang-0')).toBe('brand');
    expect(kindOf('/tin-tuc/bai-1')).toBe('article');
    expect(kindOf('/chinh-sach-bao-mat')).toBe('page');
  });

  it('choosePages keeps the eleven real pages and reports the rest as records, not products lost to a cap', async () => {
    const found = await fromSitemap(ctxWith(serve), 'https://ttgshop.vn/');
    const got = choosePages('https://ttgshop.vn/', found!, { maxPages: 12 });
    const paths = got.pages.map((p) => new URL(p.url).pathname).sort();
    expect(paths).toEqual(
      [
        '/',
        ...articles,
        ...pages,
      ].sort(),
    );
    expect(got.kinds).toEqual({ product: 5, category: 4, brand: 3 });
    // Not one of the twelve kept slots was spent on a product or a category —
    // the whole reason ttgshop planned eleven keyboards before this existed.
    expect(got.skipped['over-page-limit']).toBeUndefined();
  });
});
