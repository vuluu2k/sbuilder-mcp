import { describe, it, expect } from 'vitest';
import { addSubtree } from '../src/domains/site/builder.js';
import { bindNode } from '../src/tools/live.js';
import { bindings, emptyDoc } from './helpers/doc.js';

/**
 * THE PURCHASE BINDING — the one control a shop cannot take an order without.
 *
 * `sb_review` reported the gap ("nothing opens the cart", "no purchase action")
 * and no tool could close it: the renderer reads `target.action`, `sb_set`
 * writes only style/config/specials, and `sb_bind` wrote a target-less binding.
 */
describe('bindNode() writes a purchase binding', () => {
  function pageWithButton() {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', { type: 'button' });
    doc.apply(patches);
    return { doc, id: ids[0] };
  }

  it('stamps the reserved id and the renderer-read action', () => {
    const { doc, id } = pageWithButton();
    doc.apply(bindNode(doc, id, 'product.id', 'specials.boundProductId', 'add_to_cart'));
    const b = bindings(doc.node(id) as never)[0] as unknown as {
      id: string;
      target: { type: string; action: string };
    };
    expect(b.id).toBe('bind-product-action');
    expect(b.target).toMatchObject({ type: 'product', action: 'add_to_cart' });
  });

  it('stores buy_now in the document vocabulary, not the picker one', () => {
    const { doc, id } = pageWithButton();
    doc.apply(bindNode(doc, id, 'product.id', 'specials.boundProductId', 'buy_now'));
    const b = bindings(doc.node(id) as never)[0] as unknown as { target: { action: string } };
    expect(b.target.action).toBe('dynamic_checkout');
  });

  it('re-points the same control instead of adding a second one', () => {
    const { doc, id } = pageWithButton();
    doc.apply(bindNode(doc, id, 'product.id', 'specials.boundProductId', 'add_to_cart'));
    doc.apply(bindNode(doc, id, 'product.id', 'specials.boundProductId', 'buy_now'));
    const all = bindings(doc.node(id) as never) as unknown as Array<{ id: string }>;
    expect(all.filter((b) => b.id === 'bind-product-action')).toHaveLength(1);
  });

  it('refuses an action the renderer draws nothing for', () => {
    const { doc, id } = pageWithButton();
    expect(() => bindNode(doc, id, 'product.id', 'specials.boundProductId', 'subscribe')).toThrow(
      /not a purchase action/,
    );
  });

  it('leaves the plain field path alone', () => {
    const { doc, id } = pageWithButton();
    doc.apply(bindNode(doc, id, 'product.title', 'specials.boundText'));
    const b = bindings(doc.node(id) as never)[0] as unknown as { id: string; target?: unknown };
    expect(b.id).not.toBe('bind-product-action');
    expect(b.target).toBeUndefined();
  });

  it('satisfies the readiness predicate the editor mirrors', () => {
    const { doc, id } = pageWithButton();
    doc.apply(bindNode(doc, id, 'product.id', 'specials.boundProductId', 'add_to_cart'));
    const node = doc.node(id) as unknown as {
      bindings: Array<{ id?: string; target?: { action?: string } }>;
    };
    const bound = node.bindings.some((b) => b.id === 'bind-product-action' && !!b.target?.action);
    expect(bound).toBe(true);
  });
});
