import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree, removeNode, setMany } from '../src/domains/site/builder.js';
import { validateForSave } from '../src/domains/site/validate.js';

/** A page with one section holding one icon. */
function page() {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const { patches, ids } = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'icon' }] });
  d.apply(patches);
  return { d, icon: ids[1] };
}

/**
 * The editor's IconCartBadgeRow: `addDetachedNode(sat, icon)` — parent = the
 * icon, NOT in its data.nodes — then `config.cartCountId` (base) = the badge.
 */
describe('a satellite is created and removed through sb_add / sb_remove', () => {
  it('sb_add of a cart-count into an icon attaches it as the icon\'s satellite', () => {
    const { d, icon } = page();
    const { patches, ids } = addSubtree(d, icon, { type: 'cart-count' });
    d.apply(patches);
    const badge = d.doc.nodes[ids[0]];
    expect(badge.data.type).toBe('cart-count');
    expect(badge.data.parent).toBe(icon);
    expect(d.doc.nodes[icon].data.nodes).toEqual([]);
    expect(d.doc.nodes[icon].config.cartCountId).toBe(ids[0]);
    expect(validateForSave(d)).toEqual([]);
  });

  it('a second one is refused rather than orphaning the first', () => {
    const { d, icon } = page();
    d.apply(addSubtree(d, icon, { type: 'cart-count' }).patches);
    expect(() => addSubtree(d, icon, { type: 'cart-count' })).toThrow(/already has/);
  });

  it('sb_remove of the satellite clears the host\'s key and the node is gone', () => {
    const { d, icon } = page();
    const { patches, ids } = addSubtree(d, icon, { type: 'cart-count' });
    d.apply(patches);
    d.apply(removeNode(d, ids[0]));
    expect(d.doc.nodes[ids[0]]).toBeUndefined();
    expect(d.doc.nodes[icon].config.cartCountId).toBe('');
    expect(validateForSave(d)).toEqual([]);
  });

  it('sb_set config {cartCountId} mints nothing — which is why the remedy names sb_add', () => {
    const { d, icon } = page();
    const before = Object.keys(d.doc.nodes).length;
    d.apply(setMany(d, [{ id: icon, namespace: 'config', keys: { cartCountId: 'x' }, base: true }]).patches);
    expect(Object.keys(d.doc.nodes).length).toBe(before);
  });
});
