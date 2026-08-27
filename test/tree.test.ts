import { describe, it, expect } from 'vitest';
import { childrenOf, isOverlay, pageChildren, subtreeIds, ancestors } from '../src/core/tree.js';
import type { DocLike } from '../src/core/tree.js';

function node(id: string, kids: string[] = [], specials: Record<string, unknown> = {}, parent: string | null = null) {
  return { id, data: { type: 'flex-section', parent, nodes: kids }, specials };
}

const doc: DocLike = {
  schema_version: 2,
  root_node_id: 'rt',
  nodes: {
    rt: node('rt', ['fs_1', 'fs_2', 'cart']),
    fs_1: node('fs_1', ['tx_1'], {}, 'rt'),
    fs_2: node('fs_2', [], {}, 'rt'),
    tx_1: node('tx_1', [], {}, 'fs_1'),
    cart: node('cart', ['tx_2'], { overlayId: 'ov_1', overlayKind: 'cart' }, 'rt'),
    tx_2: node('tx_2', [], {}, 'cart'),
  },
};

describe('tree', () => {
  it('childrenOf returns every child, overlays included', () => {
    expect(childrenOf(doc, 'rt')).toEqual(['fs_1', 'fs_2', 'cart']);
  });

  it('isOverlay is true only for a stamped DIRECT child of ROOT', () => {
    expect(isOverlay(doc, 'cart')).toBe(true);
    expect(isOverlay(doc, 'fs_1')).toBe(false);
    const nested: DocLike = {
      ...doc,
      nodes: { ...doc.nodes, tx_1: node('tx_1', [], { overlayId: 'ov_2' }, 'fs_1') },
    };
    expect(isOverlay(nested, 'tx_1')).toBe(false);
  });

  it('pageChildren excludes overlays - this is the walk every ROOT rule must use', () => {
    expect(pageChildren(doc)).toEqual(['fs_1', 'fs_2']);
  });

  it('subtreeIds collects a node and its descendants', () => {
    expect(subtreeIds(doc, 'fs_1').sort()).toEqual(['fs_1', 'tx_1']);
  });

  it('subtreeIds survives a malformed cycle rather than hanging', () => {
    const cyc: DocLike = {
      schema_version: 2,
      root_node_id: 'a',
      nodes: { a: node('a', ['b']), b: node('b', ['a']) },
    };
    expect(subtreeIds(cyc, 'a').sort()).toEqual(['a', 'b']);
  });

  it('ancestors walks up to ROOT', () => {
    expect(ancestors(doc, 'tx_1')).toEqual(['fs_1', 'rt']);
  });

  it('ancestors survives a parent cycle', () => {
    const cyc: DocLike = {
      schema_version: 2,
      root_node_id: 'a',
      nodes: { a: node('a', [], {}, 'b'), b: node('b', [], {}, 'a') },
    };
    expect(ancestors(cyc, 'a')).toEqual(['b']);
  });
});
