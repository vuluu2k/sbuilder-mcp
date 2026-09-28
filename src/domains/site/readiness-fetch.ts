import { request } from '../../transport/http.js';
import { siteToken } from '../../tools/credentialpick.js';
import type { ToolContext } from '../../tools/context.js';
import { hrefsIn, unreachablePages, type ReadinessInput, type ReadinessPage } from './readiness.js';

/**
 * Gather what the readiness rules need, tolerating every failure.
 *
 * FOUR REQUESTS, and any of them may fail without failing the review: a gap is
 * never reported off unread data, so a refused or missing endpoint leaves that
 * one rule silent instead of inventing a warning. That is the same contract the
 * editor's stores follow, for the same reason.
 */
export async function gatherReadiness(
  ctx: ToolContext,
  siteId: string,
  pageNodes: ReadinessInput['pageNodes'],
  openPageId?: string,
): Promise<ReadinessInput> {
  const get = async <T>(path: string): Promise<T | null> => {
    try {
      return (await request({
        base: ctx.base,
        method: 'GET',
        path,
        token: siteToken(ctx),
        fetchImpl: ctx.fetchImpl,
      })) as T;
    } catch {
      return null;
    }
  };
  const site = encodeURIComponent(siteId);

  const [pageList, gateways, shipping, globals, productList, categoryList, pageLinks, formList, articleList, blogCategoryList, courseList, siteRecord, overlayList, settings, menuList] =
    await Promise.all([
    get<{ pages?: Array<ReadinessPage & { id?: string; isDefaultTemplate?: boolean }> }>(`/api/sites/${site}/pages`),
    get<{ paymentGateways?: Array<{ enabled?: boolean; configured?: boolean }> }>(
      `/api/sites/${site}/payment-gateways`,
    ),
    get<{ shippingMethods?: unknown[]; methods?: unknown[] }>(`/api/sites/${site}/shipping-methods`),
    get<{ globalSections?: Array<{ kind?: string; document?: { nodes?: Record<string, unknown> } }> }>(
      `/api/sites/${site}/global-sections`,
    ),
    // The SITE-SCOPED list, not /api/v1/products: this one takes either
    // credential, so the check answers for a session install as well as a
    // key-only one. A page is enough to tell empty from not; `total` carries the
    // real count when the platform sends it.
    get<{ products?: Array<{ status?: string; priceCents?: number; images?: unknown }>; total?: number }>(
      `/api/sites/${site}/products?limit=200`,
    ),
    // THE CATEGORIES, and the pages they point at: the ones with no page-link
    // are served by the shared `category` template (see categoryScope).
    get<{ categories?: unknown[]; productCategories?: unknown[]; total?: number }>(
      `/api/sites/${site}/product-categories`,
    ),
    get<{ links?: Array<{ linkType?: string }>; pageLinks?: Array<{ linkType?: string }> }>(
      `/api/sites/${site}/page-links`,
    ),
    // THE FORMS, BY TYPE. A page document carries only `specials.formId` — which
    // form a node shows, never what KIND of form it is — so nothing reading a
    // page can tell a login form from a register form without this list. That
    // blindness is what let one page quietly become the site's whole account
    // area, which is the shape `mergedAuthPage` reports.
    get<{ forms?: Array<{ id?: string; type?: string }> }>(`/api/sites/${site}/forms`),
    // THE ARTICLES, for the same reason the products are read: /blog/{slug}
    // resolves to the site's `post` template, so a site that has written
    // articles and has no template 404s every one of them.
    get<{ articles?: unknown[]; total?: number }>(`/api/sites/${site}/articles?limit=1`),
    // THE LAST TWO ENTITY PREFIXES the storefront registers
    // (storefront/entityroute.go): /blog-categories/{slug} and /courses/{slug}.
    // Each resolves to the site's published page of its own TYPE, so each has
    // the hole /products/{slug} has, and counting is how we know the site uses
    // the prefix at all.
    get<{ blogCategories?: unknown[]; categories?: unknown[]; total?: number }>(
      `/api/sites/${site}/blog-categories?limit=1`,
    ),
    get<{ courses?: unknown[]; total?: number }>(`/api/sites/${site}/courses?limit=1`),
    // THE SWITCH ITSELF. `maintain` is the one page type whose absence matters
    // only while a flag is on — see maintenanceGap. Read here rather than
    // guessed, because the alternative is telling every site on earth to build
    // a page for an outage it is not having.
    get<{ site?: { maintenanceMode?: boolean } }>(`/api/sites/${site}`),
    // THE OVERLAYS, for the one a cart control opens: no `cart` overlay means
    // every `open_cart` on the site opens nothing.
    // The list ships each overlay's FULL document (overlays/rest/rest.go), so the
    // cart drawer's words are read here too — see cartDrawerLanguage.
    get<{ overlays?: Array<{ kind?: string; document?: ReadinessInput['cartOverlay'] }> }>(`/api/sites/${site}/overlays`),
    // `<html lang>` is served from this; see siteLanguage in readiness.ts.
    get<{ settings?: { locale?: unknown } | null }>(`/api/sites/${site}/settings`),
    // THE MENUS, for what a visitor can reach: a page nothing links to is
    // published, listed in the sitemap, and never arrived at.
    get<{ menus?: Array<{ items?: unknown[] }> }>(`/api/sites/${site}/menus`),
  ]);

  // A gateway counts only when it is BOTH enabled and configured — the editor's
  // `live` getter also filters by the store's currency, which is a narrowing:
  // reporting "no gateway" for a store that has one in another currency would
  // be a false alarm, so this stops at the two flags.
  const liveGateways = gateways?.paymentGateways
    ? gateways.paymentGateways.filter((g) => g.enabled && g.configured).length
    : null;

  const methods = shipping?.shippingMethods ?? shipping?.methods;
  const shippingMethods = Array.isArray(methods) ? methods.length : null;

  // Either key, like the product categories below: this reader has met both
  // spellings from the platform and guessing one would read a real list as none.
  const rawBlogCats = blogCategoryList?.blogCategories ?? blogCategoryList?.categories;
  const blogCats = Array.isArray(rawBlogCats) ? rawBlogCats : null;
  const cats = categoryList?.categories ?? categoryList?.productCategories;
  const categories = Array.isArray(cats) ? (categoryList?.total ?? cats.length) : null;
  const links = pageLinks?.links ?? pageLinks?.pageLinks;
  const categoryPageLinks = Array.isArray(links)
    ? links.filter((l) => l?.linkType === 'productCategory').length
    : null;

  const globalNodes = globals?.globalSections
    ? globals.globalSections.flatMap((g) =>
        Object.values(g.document?.nodes ?? {}),
      ) as ReadinessInput['globalNodes']
    : null;
  // HOW MANY SHARED SECTIONS THE SITE HAS, not just what is in them. An empty
  // list is the answer to a question nothing asked: a site whose pages each
  // carry their own header is not one site.
  const globalKinds = globals?.globalSections
    ? globals.globalSections.map((g) => g.kind ?? '')
    : null;

  // ACTIVE means a shopper can see it; PURCHASABLE adds a price above zero. A
  // product priced at zero renders, adds to the cart, and totals nothing — which
  // reads as a working store right up to the money.
  const rows = productList?.products;
  const products = Array.isArray(rows)
    ? {
        active: rows.filter((p) => (p.status ?? 'active') === 'active').length,
        purchasable: rows.filter(
          (p) => (p.status ?? 'active') === 'active' && (p.priceCents ?? 0) > 0,
        ).length,
        // Drafts and archived: what a catalogue built without status:"active" is.
        inactive: rows.filter((p) => (p.status ?? 'active') !== 'active').length,
        // Active and pictureless: the grey placeholder on every card.
        unpictured: rows.filter(
          (p) =>
            (p.status ?? 'active') === 'active' &&
            !(Array.isArray(p.images) && p.images.some((u) => typeof u === 'string' && u !== '')),
        ).length,
      }
    : null;

  // A page an entity links to is that entity's own; only the shared template
  // counts as the category template, and a row without the flag is read as one.
  const open = openPageId ? pageList?.pages?.find((p) => p.id === openPageId) : undefined;

  // Every level of every menu: page references by id, url links by address.
  const menuLinks = Array.isArray(menuList?.menus)
    ? (() => {
        const pageIds: string[] = [];
        const hrefs: string[] = [];
        const walk = (items: unknown): void => {
          if (!Array.isArray(items)) return;
          for (const it of items) {
            if (!it || typeof it !== 'object') continue;
            const r = it as { link?: { type?: unknown; pageId?: unknown; url?: unknown }; items?: unknown };
            if (r.link?.type === 'page' && typeof r.link.pageId === 'string') pageIds.push(r.link.pageId);
            if (r.link?.type === 'url' && typeof r.link.url === 'string') hrefs.push(r.link.url);
            walk(r.items);
          }
        };
        for (const m of menuList!.menus!) walk(m?.items);
        return { pageIds, hrefs };
      })()
    : null;

  const input: ReadinessInput = {
    pages: pageList?.pages ?? null,
    menuLinks,
    openPageType: open && open.isDefaultTemplate !== false ? open.type : undefined,
    products,
    liveGateways,
    shippingMethods,
    pageNodes,
    globalNodes,
    globalKinds,
    cartOverlay: Array.isArray(overlayList?.overlays)
      ? (overlayList.overlays.find((o) => o.kind === 'cart')?.document ?? null)
      : null,
    overlayKinds: Array.isArray(overlayList?.overlays) ? overlayList.overlays.map((o) => o.kind ?? '') : null,
    categories,
    categoryPageLinks,
    forms: formList?.forms ?? null,
    articles: Array.isArray(articleList?.articles)
      ? (articleList?.total ?? articleList.articles.length)
      : null,
    blogCategories: blogCats ? (blogCategoryList?.total ?? blogCats.length) : null,
    courses: Array.isArray(courseList?.courses)
      ? (courseList?.total ?? courseList.courses.length)
      : null,
    siteLocale: typeof settings?.settings?.locale === 'string' ? settings.settings.locale : null,
    maintenanceMode:
      typeof siteRecord?.site?.maintenanceMode === 'boolean'
        ? siteRecord.site.maintenanceMode
        : null,
  };

  // THE SECOND PASS, PAID ONLY WHEN THE FIRST FOUND A CANDIDATE. A page linked
  // from the BODY of another page — a "read our story" button on the home
  // page — is reachable, and neither the menus nor the chrome show it. Reading
  // every page's document on every review would be one GET per page for a
  // question that is usually already answered, so the sources are read only
  // when a page looks unreachable, and only the other published pages' — the
  // open page's nodes are already in hand. Capped; a source that fails to read
  // counts as carrying no link.
  if (input.menuLinks && unreachablePages(input).length > 0) {
    const others = (input.pages ?? [])
      .filter((p) => p.status === 'published' && typeof p.id === 'string' && p.id !== openPageId)
      .slice(0, 40);
    const sources = await Promise.all(
      others.map((p) =>
        // `{ source: { document } }` — the envelope transport/pages.ts loadSource
        // unwraps; read bare, this pass saw no link in any page (measured on a
        // local store, every page's document present and every href missed).
        get<{ source?: { document?: { nodes?: Record<string, unknown> } } }>(
          `/api/sites/${site}/pages/${encodeURIComponent(p.id!)}/source`,
        ),
      ),
    );
    const nodes = sources.flatMap((src) => Object.values(src?.source?.document?.nodes ?? {}));
    input.menuLinks.hrefs.push(...hrefsIn(nodes as ReadinessInput['pageNodes']));
  }

  return input;
}
