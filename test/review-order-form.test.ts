import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { reviewDesign } from '../src/domains/site/review.js';

const n = (id: string, type: string, parent: string | null, nodes: string[] = [], specials: Record<string, unknown> = {}) => ({
  id, data: { type, parent, nodes }, style: {}, config: {}, specials, responsive: {}, events: [], bindings: [],
});

/** A page with one form; `drawer` composes the site's cart drawer (carrying a cart-total) onto ROOT. */
function page(opts: { drawer?: boolean; pageTotal?: boolean }) {
  const nodes: Record<string, unknown> = {
    ROOT: n('ROOT', 'root', null, ['sec', ...(opts.drawer ? ['cd'] : [])]),
    sec: n('sec', 'flex-section', 'ROOT', ['fm', ...(opts.pageTotal ? ['tot'] : [])]),
    fm: n('fm', 'form', 'sec', [], { formId: 'frm_1' }),
  };
  if (opts.pageTotal) nodes.tot = n('tot', 'cart-total', 'sec');
  if (opts.drawer) {
    nodes.cd = n('cd', 'cart-drawer', 'ROOT', ['ct'], { overlayId: 'ov_cart' });
    nodes.ct = n('ct', 'cart-total', 'cd');
  }
  return PageDoc.from({ schema_version: 2, root_node_id: 'ROOT', nodes } as never);
}
const codes = (d: PageDoc, formTypes?: Record<string, string>) =>
  reviewDesign(d, { formTypes }).map((f) => f.code);

describe('order_goes_nowhere is about the checkout form, not every form', () => {
  it('a login page carrying the composed cart drawer does not report it', () => {
    expect(codes(page({ drawer: true }))).not.toContain('order_goes_nowhere');
    expect(codes(page({ drawer: true }), { frm_1: 'login' })).not.toContain('order_goes_nowhere');
  });

  it('a form known not to be an order form does not report it, even beside a page cart-total', () => {
    expect(codes(page({ pageTotal: true }), { frm_1: 'contact' })).not.toContain('order_goes_nowhere');
  });

  it('a real checkout form missing its target still reports', () => {
    expect(codes(page({ pageTotal: true, drawer: true }))).toContain('order_goes_nowhere');
    expect(codes(page({ pageTotal: true }), { frm_1: 'order' })).toContain('order_goes_nowhere');
  });
});
