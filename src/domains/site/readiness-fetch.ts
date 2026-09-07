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

  const [pageList, gateways, shipping, globals] = await Promise.all([
    get<{ pages?: ReadinessPage[] }>(`/api/sites/${site}/pages`),
    get<{ paymentGateways?: Array<{ enabled?: boolean; configured?: boolean }> }>(
      `/api/sites/${site}/payment-gateways`,
    ),
    get<{ shippingMethods?: unknown[]; methods?: unknown[] }>(`/api/sites/${site}/shipping-methods`),
    get<{ globalSections?: Array<{ document?: { nodes?: Record<string, unknown> } }> }>(
      `/api/sites/${site}/global-sections`,
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

  const globalNodes = globals?.globalSections
    ? globals.globalSections.flatMap((g) =>
        Object.values(g.document?.nodes ?? {}),
      ) as ReadinessInput['globalNodes']
    : null;

  return {
    pages: pageList?.pages ?? null,
    liveGateways,
    shippingMethods,
    pageNodes,
    globalNodes,
  };
}
