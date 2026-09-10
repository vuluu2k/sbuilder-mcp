import { describe, it, expect } from 'vitest';
import { isSyncablePath, isSyncablePatch, applyPatches, syncable, type Patch } from '../src/core/patch.js';

describe('isSyncablePath()', () => {
  it('accepts a real node path', () => {
    expect(isSyncablePath(['nodes', 'fs_1', 'style', 'gap'])).toBe(true);
  });

  it('rejects the bare nodes path - one frame would replace the whole document', () => {
    expect(isSyncablePath(['nodes'])).toBe(false);
  });

  it('rejects anything not rooted at nodes', () => {
    expect(isSyncablePath(['selectedId'])).toBe(false);
    expect(isSyncablePath(['root_node_id'])).toBe(false);
  });

  it('rejects prototype-polluting segments', () => {
    expect(isSyncablePath(['nodes', '__proto__'])).toBe(false);
    expect(isSyncablePath(['nodes', 'fs_1', 'constructor'])).toBe(false);
    expect(isSyncablePath(['nodes', 'fs_1', 'prototype'])).toBe(false);
  });

  it('rejects a segment that only STRINGIFIES to __proto__', () => {
    expect(isSyncablePath(['nodes', ['__proto__'] as unknown as string])).toBe(false);
  });
});

describe('isSyncablePatch()', () => {
  it('accepts a set on a good path', () => {
    expect(isSyncablePatch({ op: 'set', path: ['nodes', 'a', 'style'], value: 1 })).toBe(true);
  });

  it('rejects a negative splice index - it addresses from the END', () => {
    expect(isSyncablePatch({ op: 'remove', path: ['nodes', 'a', 'data', 'nodes'], index: -1 })).toBe(false);
  });

  it('rejects a fractional splice index - splice would truncate it', () => {
    expect(isSyncablePatch({ op: 'insert', path: ['nodes', 'a', 'data', 'nodes'], index: 1.5, value: 'x' })).toBe(false);
  });

  it('allows an index past the end - splice clamps, and an append is legitimate', () => {
    expect(isSyncablePatch({ op: 'insert', path: ['nodes', 'a', 'data', 'nodes'], index: 99, value: 'x' })).toBe(true);
  });

  it('syncable() filters rather than throwing - the wire must not be haltable', () => {
    const kept = syncable([
      { op: 'set', path: ['nodes', 'a', 'style'], value: 1 },
      { op: 'set', path: ['nodes'], value: {} },
    ]);
    expect(kept.length).toBe(1);
  });
});

describe('applyPatches()', () => {
  it('sets a nested value, creating intermediate objects', () => {
    const s: Record<string, unknown> = { nodes: { a: {} } };
    applyPatches(s, [{ op: 'set', path: ['nodes', 'a', 'style', 'gap'], value: '8px' }]);
    expect(s).toEqual({ nodes: { a: { style: { gap: '8px' } } } });
  });

  it('unsets', () => {
    const s = { nodes: { a: { style: { gap: '8px' } } } };
    applyPatches(s, [{ op: 'unset', path: ['nodes', 'a', 'style', 'gap'] }]);
    expect(s.nodes.a.style).toEqual({});
  });

  it('inserts and removes in an array', () => {
    const s = { nodes: { a: { data: { nodes: ['x', 'z'] } } } };
    applyPatches(s, [{ op: 'insert', path: ['nodes', 'a', 'data', 'nodes'], index: 1, value: 'y' }]);
    expect(s.nodes.a.data.nodes).toEqual(['x', 'y', 'z']);
    applyPatches(s, [{ op: 'remove', path: ['nodes', 'a', 'data', 'nodes'], index: 0 }]);
    expect(s.nodes.a.data.nodes).toEqual(['y', 'z']);
  });

  it('refuses to apply an inadmissible patch rather than applying it quietly', () => {
    const s = { nodes: {} };
    expect(() => applyPatches(s, [{ op: 'set', path: ['nodes'], value: {} }])).toThrow(/inadmissible/i);
  });

  it('never reaches Object.prototype', () => {
    const s = { nodes: {} };
    expect(() =>
      applyPatches(s, [{ op: 'set', path: ['nodes', '__proto__', 'polluted'], value: true }]),
    ).toThrow(/inadmissible/i);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

/**
 * A PATCH MUST NOT ALIAS THE CALLER'S OBJECT INTO THE DOCUMENT.
 *
 * `addSubtree` emits `set nodes/<id>` carrying the node it just built, then
 * `insert` patches that push child ids into that node's own `data.nodes`. With
 * the reference assigned straight in, the first apply mutates the PATCH — and
 * `applyAndSave` applies every batch twice by design, once through `preview` to
 * judge the write and once for real. The second pass then re-established a node
 * that already held its children and inserted them again.
 *
 * Silent in every direction: the tree is well formed, every id resolves, the
 * platform accepts the save, and the page just renders its content twice.
 */
describe('applying a batch twice', () => {
  const batch = (): Patch[] => {
    const node = { id: 'n1', data: { type: 'flex-block', nodes: [] as string[] } };
    return [
      { op: 'set', path: ['nodes', 'n1'], value: node },
      { op: 'insert', path: ['nodes', 'n1', 'data', 'nodes'], index: 0, value: 'kid_a' },
      { op: 'insert', path: ['nodes', 'n1', 'data', 'nodes'], index: 1, value: 'kid_b' },
    ] as Patch[];
  };

  it('lands the same tree the first apply did', () => {
    const state = { nodes: {} as Record<string, { data: { nodes: string[] } }> };
    const patches = batch();
    applyPatches(state, patches);
    const once = [...state.nodes.n1.data.nodes];
    applyPatches(state, patches);
    expect(state.nodes.n1.data.nodes).toEqual(once);
    expect(once).toEqual(['kid_a', 'kid_b']);
  });

  it('leaves the patch itself untouched, which is why', () => {
    const state = { nodes: {} as Record<string, unknown> };
    const patches = batch();
    const value = (patches[0] as { value: { data: { nodes: string[] } } }).value;
    applyPatches(state, patches);
    expect(value.data.nodes).toEqual([]);
  });

  it('does not share the stored object with the caller either', () => {
    const state = { nodes: {} as Record<string, { data: { nodes: string[] } }> };
    const patches = batch();
    applyPatches(state, patches);
    state.nodes.n1.data.nodes.push('written-into-the-document');
    expect((patches[0] as { value: { data: { nodes: string[] } } }).value.data.nodes).toEqual([]);
  });
});
