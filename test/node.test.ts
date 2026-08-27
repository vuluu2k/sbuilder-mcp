import { describe, it, expect } from 'vitest';
import { genId } from '../src/domains/site/ids.js';
import { createNode } from '../src/domains/site/node.js';

describe('genId()', () => {
  it('uses the platform prefix for a known type', () => {
    expect(genId('flex-section')).toMatch(/^fs_[0-9a-f]{8}$/);
    expect(genId('heading')).toMatch(/^he_[0-9a-f]{8}$/);
    expect(genId('tab-item')).toMatch(/^ti_[0-9a-f]{8}$/);
  });

  it('falls back to the first two letters for an unlisted type', () => {
    expect(genId('carousel')).toMatch(/^ca_[0-9a-f]{8}$/);
  });

  it('is unique across many calls', () => {
    const ids = new Set(Array.from({ length: 500 }, () => genId('text')));
    expect(ids.size).toBe(500);
  });
});

describe('createNode()', () => {
  it('seeds an element from its catalog defaults', () => {
    const n = createNode('flex-section');
    expect(n.data.type).toBe('flex-section');
    expect(n.data.nodes).toEqual([]);
    expect(n.data.isCanvas).toBe(true);
    expect(n.events).toEqual([]);
    expect(n.bindings).toEqual([]);
  });

  it('marks a non-container as not a canvas', () => {
    expect(createNode('text').data.isCanvas).toBe(false);
  });

  it('omits the states key entirely when the element declares none', () => {
    expect('states' in createNode('text')).toBe(false);
  });

  it('refuses an unknown type rather than minting a node nothing can render', () => {
    expect(() => createNode('not-an-element')).toThrow(/unknown element/i);
  });

  it('carries the caller overrides on top of the defaults', () => {
    const n = createNode('heading', { name: 'Title', parent: 'rt' });
    expect(n.data.name).toBe('Title');
    expect(n.data.parent).toBe('rt');
  });

  it('deep-copies the defaults so two nodes never share a nested object', () => {
    const a = createNode('flex-section');
    const b = createNode('flex-section');
    (a.responsive as Record<string, unknown>).mobile = { style: { gap: '1px' } };
    expect(b.responsive.mobile).toBeUndefined();
    expect(a.style).not.toBe(b.style);
  });
});
