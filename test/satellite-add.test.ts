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

  it('a seeded satellite arrives with its seed subtree, not bare', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const { patches, ids } = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'list-dataset' }] });
    d.apply(patches);
    const list = ids.find((id) => d.doc.nodes[id].data.type === 'list-dataset')!;
    const minted = d.doc.nodes[list].config.emptyStateId as string;
    const seededKids = d.doc.nodes[minted].data.nodes.length;
    expect(seededKids).toBeGreaterThan(0);
    d.apply(removeNode(d, minted));
    const added = addSubtree(d, list, { type: 'list-empty' });
    d.apply(added.patches);
    const empty = d.doc.nodes[added.ids[0]];
    expect(d.doc.nodes[list].config.emptyStateId).toBe(empty.id);
    expect(empty.data.nodes.length).toBe(seededKids);
    expect(validateForSave(d)).toEqual([]);
  });

  it('a NESTED satellite spec takes the minted one\'s place and still gets its seed', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const { patches } = addSubtree(d, 'ROOT', {
      type: 'flex-section',
      children: [{ type: 'list-dataset', children: [{ type: 'list-empty', style: { padding: '9px' } }] }],
    });
    d.apply(patches);
    const all = Object.values(d.doc.nodes);
    const list = all.find((n) => n.data.type === 'list-dataset')!;
    const empties = all.filter((n) => n.data.type === 'list-empty');
    expect(empties.length).toBe(1);
    expect(list.config.emptyStateId).toBe(empties[0].id);
    expect(list.data.nodes).not.toContain(empties[0].id);
    expect(empties[0].style.padding).toBe('9px');
    expect(empties[0].data.nodes.length).toBeGreaterThan(0);
    expect(validateForSave(d)).toEqual([]);
  });

  it('a nested satellite the owner mints anyway is used, not refused as an ordinary child', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const { patches } = addSubtree(d, 'ROOT', {
      type: 'flex-section',
      children: [{ type: 'menu', children: [{ type: 'menu-item', style: { color: 'red' } }] }],
    });
    d.apply(patches);
    const all = Object.values(d.doc.nodes);
    const menu = all.find((n) => n.data.type === 'menu')!;
    const items = all.filter((n) => n.data.type === 'menu-item');
    expect(items.length).toBe(1);
    expect(menu.config.menuItemId).toBe(items[0].id);
    expect(items[0].style.color).toBe('red');
    expect(validateForSave(d)).toEqual([]);
  });
});
