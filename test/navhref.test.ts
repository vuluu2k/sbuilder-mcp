import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { setEvent, bindNode } from '../src/tools/live.js';
import { hrefPatches, deadNavigation } from '../src/domains/site/navhref.js';

/**
 * `node.events` IS NEVER READ BY A RENDERER.
 *
 * A sole navigation click renders as `specials.href` and from nothing else —
 * `nodes.EventAttrs` skips it deliberately, on the stated assumption that the
 * href is already there. So an event written WITHOUT its href is a control that
 * renders, saves, publishes and does nothing when a shopper clicks it.
 *
 * Measured on a live storefront before this fix: three home-page images with
 * `click: go_to_url {"url":"/bo-suu-tap"}` and no href published as bare
 * `<img>` tags — no anchor, no `on:click` — beside a button that carried the
 * href and published as `<a href="/bo-suu-tap">`.
 */

function pageWith(type: string): { d: PageDoc; id: string } {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const { patches, ids } = addSubtree(d, 'ROOT', {
    type: 'flex-section',
    children: [{ type }],
  });
  d.apply(patches);
  return { d, id: ids[1] };
}

const specials = (d: PageDoc, id: string): Record<string, unknown> =>
  (d.node(id) as unknown as { specials: Record<string, unknown> }).specials;

describe('a navigation click projects the href the renderer actually reads', () => {
  it('writes specials.href alongside the event', () => {
    const { d, id } = pageWith('button');
    d.apply(setEvent(d, id, 'click', 'go_to_url', { url: '/bo-suu-tap' }));
    expect(specials(d, id).href).toBe('/bo-suu-tap');
  });

  it('writes specials.target only when the payload asks for a new tab', () => {
    const { d, id } = pageWith('button');
    d.apply(setEvent(d, id, 'click', 'go_to_url', { url: '/a' }));
    expect(specials(d, id).target).toBeUndefined();
    d.apply(setEvent(d, id, 'click', 'go_to_url', { url: '/a', openInNewTab: true }));
    expect(specials(d, id).target).toBe('_blank');
  });

  it('takes the href back off when the action is cleared', () => {
    const { d, id } = pageWith('button');
    d.apply(setEvent(d, id, 'click', 'go_to_url', { url: '/a' }));
    expect(specials(d, id).href).toBe('/a');
    d.apply(setEvent(d, id, 'click', 'none'));
    expect(specials(d, id).href).toBeUndefined();
  });

  /**
   * A checkout hop is never a plain link — the platform's own words. It keeps
   * its runtime call, so projecting an href for it would be a second navigation
   * beside the one the cart runtime performs.
   */
  it('projects nothing for go_to_checkout', () => {
    const { d, id } = pageWith('button');
    d.apply(setEvent(d, id, 'click', 'go_to_checkout', {}));
    expect(specials(d, id).href).toBeUndefined();
  });

  /** `open_cart` is not navigation at all; an href beside it would leave the page. */
  it('projects nothing for a non-navigation action', () => {
    const { d, id } = pageWith('button');
    d.apply(setEvent(d, id, 'click', 'open_cart', {}));
    expect(specials(d, id).href).toBeUndefined();
  });

  /**
   * `open_page` reads a url its picker RESOLVED at pick time. Neither renderer
   * can resolve a page id, so a payload carrying only an id projects nothing —
   * and must not invent one.
   */
  it('projects nothing for an open_page with no resolved url', () => {
    const { d, id } = pageWith('button');
    d.apply(setEvent(d, id, 'click', 'open_page', { pageId: 'pg_x' }));
    expect(specials(d, id).href).toBeUndefined();
  });

  /**
   * A bound purchase control's navigation rides chained after `AddToCart#add`,
   * never as a link — `purchaseItem != ""` in EventAttrs stops the skip, so the
   * renderer DOES emit the call and an href beside it would navigate twice.
   *
   * THROUGH `sb_event` THE COMBINATION IS ALREADY UNREACHABLE, and that is worth
   * pinning rather than assuming: binding a purchase swaps the element's live
   * allow-list to `meta.bindingEvents`, which offers no `go_to_url` at all. So
   * the purchase clause in `soleNavigationClick` is for a document that got here
   * by another road — an import, a hand-built `sb_api_call` — which is exactly
   * the population `sb_review` exists for.
   */
  it('refuses a navigation click on a purchase-bound button, and projects nothing for one that arrived anyway', () => {
    const { d, id } = pageWith('button');
    d.apply(bindNode(d, id, 'product.id', 'specials.boundProductId', 'add_to_cart'));
    expect(() => setEvent(d, id, 'click', 'go_to_url', { url: '/a' })).toThrow(/not an action a button offers/);
    expect(
      hrefPatches(id, [{ name: 'click', action: 'go_to_url', payload: { url: '/a' } }], true, {}),
    ).toEqual([]);
  });

  /**
   * Mirrors `PatchRecorder.set`: a key that is already absent produces NO patch.
   * These go on the wire to peers running the editor's own code, and an empty
   * write churns a revision — which bumps the fence on every shared master the
   * page carries — for nothing.
   */
  it('emits no patch when there is nothing to change', () => {
    expect(hrefPatches('n1', [], false, {})).toEqual([]);
    expect(hrefPatches('n1', [{ name: 'click', action: 'go_to_url', payload: { url: '/a' } }], false, {
      href: '/a',
    })).toEqual([]);
  });
});

describe('sb_review reports a navigation control with nowhere to go', () => {
  it('names the destination the click was supposed to reach', () => {
    const { d, id } = pageWith('button');
    // The shape the tools produced before the fix: the event alone.
    d.apply([
      {
        op: 'insert',
        path: ['nodes', id, 'events'],
        index: 0,
        value: { id: 'ev_go_to_url', name: 'click', action: 'go_to_url', payload: { url: '/bo-suu-tap' } },
      },
    ]);
    const f = reviewDesign(d).find((x) => x.code === 'dead_nav');
    expect(f).toBeDefined();
    expect(f!.nodeId).toBe(id);
    expect(f!.problem).toContain('/bo-suu-tap');
    expect(f!.fix).toContain('/bo-suu-tap');
  });

  it('says nothing once the href is there', () => {
    const { d, id } = pageWith('button');
    d.apply(setEvent(d, id, 'click', 'go_to_url', { url: '/bo-suu-tap' }));
    expect(reviewDesign(d).map((f) => f.code)).not.toContain('dead_nav');
  });

  it('is a pure predicate, so a hand-built node answers the same', () => {
    expect(deadNavigation({ events: [{ name: 'click', action: 'go_to_url', payload: { url: '/x' } }] }))
      .toEqual({ url: '/x' });
    expect(
      deadNavigation({
        events: [{ name: 'click', action: 'go_to_url', payload: { url: '/x' } }],
        specials: { href: '/x' },
      }),
    ).toBeNull();
  });
});
