import { describe, it, expect } from 'vitest';
import {
  canonFor,
  choosePages,
  nameFor,
  normalizeUrl,
  robotsSitemaps,
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
    const keep = ['/feedback', '/cartier-watches', '/comments-policy', '/registered-office', '/en/feedback'];
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
