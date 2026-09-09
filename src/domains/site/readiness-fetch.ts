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

  const [pageList, gateways, shipping, globals, productList, categoryList, pageLinks] =
    await Promise.all([
    get<{ pages?: ReadinessPage[] }>(`/api/sites/${site}/pages`),
    get<{ paymentGateways?: Array<{ enabled?: boolean; configured?: boolean }> }>(
      `/api/sites/${site}/payment-gateways`,
    ),
    get<{ shippingMethods?: unknown[]; methods?: unknown[] }>(`/api/sites/${site}/shipping-methods`),
    get<{ globalSections?: Array<{ document?: { nodes?: Record<string, unknown> } }> }>(
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
    categories,
    categoryPageLinks,
  };
}
