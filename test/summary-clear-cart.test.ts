import { describe, it, expect } from 'vitest';
import { addSubtree, setKeys } from '../src/domains/site/builder.js';
import { setEvent } from '../src/tools/live.js';
import { bindings, emptyDoc } from './helpers/doc.js';

/**
 * web_builder 69a6becbb: the `summary` text kind binds `product.summary` (it
 * used to fall through to the title), and button/icon offer `clear_cart`. Both
 * reach this server only through the generated catalog — pinned so a stale
 * regen reads as red, not as a summary line that shows the product name.
 */
describe('product.summary and clear_cart (catalog @ 69a6becbb)', () => {
  it('sb_add of a summary text-dataset seeds product.summary', () => {
    const d = emptyDoc();
    const { patches, ids } = addSubtree(d, 'ROOT', { type: 'text-dataset', config: { datasetSource: 'product', kind: 'summary' } });
    d.apply(patches);
    expect(bindings(d.node(ids[0]) as never)[0]).toMatchObject({ id: 'bind-text', source: 'product.summary', field: 'specials.boundText' });
  });

  it('sb_set kind:"summary" re-derives the binding to product.summary', () => {
    const d = emptyDoc();
    const { patches, ids } = addSubtree(d, 'ROOT', { type: 'text-dataset' });
    d.apply(patches);
    d.apply(setKeys(d, ids[0], { kind: 'summary' }, { namespace: 'config' }));
    expect(bindings(d.node(ids[0]) as never)[0].source).toBe('product.summary');
  });

  it('sb_event accepts clear_cart on a button', () => {
    const d = emptyDoc();
    const { patches, ids } = addSubtree(d, 'ROOT', { type: 'button' });
    d.apply(patches);
    d.apply(setEvent(d, ids[0], 'click', 'clear_cart', {}));
    expect((d.node(ids[0]).events as Array<{ action: string }>)[0].action).toBe('clear_cart');
  });
});
