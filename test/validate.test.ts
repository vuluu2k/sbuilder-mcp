import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { validateForSave } from '../src/domains/site/validate.js';

function sec(id: string, specials: Record<string, unknown> = {}, kids: string[] = [], parent = 'rt') {
  return { id, data: { type: 'flex-section', parent, nodes: kids, isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials, responsive: {}, events: [], bindings: [] };
}

function doc(rootKids: string[], extra: Record<string, unknown> = {}) {
  return PageDoc.from({
    schema_version: 2,
    root_node_id: 'rt',
    nodes: {
      rt: { id: 'rt', data: { type: 'root', parent: null, nodes: rootKids, isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
      ...extra,
    },
  });
}

describe('validateForSave()', () => {
  it('passes a well-formed document', () => {
    expect(validateForSave(doc(['a'], { a: sec('a') }))).toEqual([]);
  });

  it('reports a band-order violation, which the platform refuses on every save', () => {
    const d = doc(['m', 'h'], { m: sec('m'), h: sec('h', { globalId: 'g', globalKind: 'header' }) });
    expect(validateForSave(d).join(' ')).toMatch(/header/i);
  });

  it('reports a child id that names no node', () => {
    expect(validateForSave(doc(['ghost'], {})).join(' ')).toMatch(/ghost/);
  });

  it('reports an orphan - a node no one references', () => {
    expect(validateForSave(doc(['a'], { a: sec('a'), lost: sec('lost', {}, [], null as unknown as string) })).join(' ')).toMatch(/lost/);
  });

  it('reports a parent pointer that disagrees with the child list', () => {
    const d = doc(['a'], {
      a: sec('a', {}, ['b']),
      b: { id: 'b', data: { type: 'text', parent: 'rt', nodes: [], isCanvas: false, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
    });
    expect(validateForSave(d).join(' ')).toMatch(/parent/i);
  });

  it('does not call an overlay an orphan - it is composed, not referenced', () => {
    const d = doc(['a', 'cart'], { a: sec('a'), cart: sec('cart', { overlayId: 'ov_1' }) });
    expect(validateForSave(d)).toEqual([]);
  });
});
