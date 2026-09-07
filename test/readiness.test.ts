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

  it('reports the five gaps a store can ship with', () => {
    const gaps = readinessGaps({
      ...base,
      pages: [{ type: 'page', status: 'published' }],
      liveGateways: 0,
      shippingMethods: 0,
      pageNodes: [node('list-dataset')],
      globalNodes: [],
    });
    expect(gaps.map((g) => g.id)).toEqual([
      'checkoutPage',
      'payment',
      'productPage',
      'shipping',
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
