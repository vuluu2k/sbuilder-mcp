import { describe, it, expect } from 'vitest';
import { isSyncablePath, isSyncablePatch, applyPatches, syncable } from '../src/core/patch.js';

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
