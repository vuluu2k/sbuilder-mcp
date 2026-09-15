import { request } from '../../transport/http.js';
import { siteToken } from '../../tools/credentialpick.js';
import type { ToolContext } from '../../tools/context.js';
import type { ReadinessInput, ReadinessPage } from './readiness.js';

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

  const [pageList, gateways, shipping, globals, productList, categoryList, pageLinks, formList, articleList, blogCategoryList, courseList, siteRecord] =
    await Promise.all([
    get<{ pages?: ReadinessPage[] }>(`/api/sites/${site}/pages`),
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
    get<{ products?: Array<{ status?: string; priceCents?: number }>; total?: number }>(
      `/api/sites/${site}/products?limit=200`,
    ),
    // THE CATEGORIES, and the pages they point at. `/collections/{slug}` resolves
    // through PublishedForEntity: the category's OWN page when a page-link names
    // one, else the DEFAULT TEMPLATE for the `category` type — and nothing on
    // that shared template narrows the product feed to the category in the URL.
    // So two categories with no page-links means at most one of them can be
    // right, and the rest list the whole catalogue.
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
      }
    : null;

  return {
    pages: pageList?.pages ?? null,
    products,
    liveGateways,
    shippingMethods,
    pageNodes,
    globalNodes,
    globalKinds,
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
    maintenanceMode:
      typeof siteRecord?.site?.maintenanceMode === 'boolean'
        ? siteRecord.site.maintenanceMode
        : null,
  };
}
