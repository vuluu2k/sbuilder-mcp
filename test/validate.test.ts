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

  it('ACCEPTS a parent pointer that disagrees with the child list — that is how a satellite attaches', () => {
    // This used to be reported. A live page proved the rule wrong: list-empty,
    // list-loading and the quantity satellites all attach by pointer alone, and
    // refusing them refused every save of every real page.
    const d = doc(['a'], {
      a: sec('a', {}, ['b']),
      b: { id: 'b', data: { type: 'text', parent: 'rt', nodes: [], isCanvas: false, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
    });
    expect(validateForSave(d)).toEqual([]);
  });

  it('does not call an overlay an orphan - it is composed, not referenced', () => {
    const d = doc(['a', 'cart'], { a: sec('a'), cart: sec('cart', { overlayId: 'ov_1' }) });
    expect(validateForSave(d)).toEqual([]);
  });
});

describe('validateForSave() and satellite nodes', () => {
  /**
   * The shape a real page has after one save: a store listing whose empty
   * state hangs off it by PARENT POINTER only, with its own children.
   * Measured on a live page — 16 of 55 nodes were satellites like this.
   */
  function withSatellite() {
    return PageDoc.from({
      schema_version: 2,
      root_node_id: 'ROOT',
      nodes: {
        ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['fs_1'] }, specials: {} },
        fs_1: { id: 'fs_1', data: { type: 'flex-section', parent: 'ROOT', nodes: ['li_1'] }, specials: {} },
        li_1: { id: 'li_1', data: { type: 'list-dataset', parent: 'fs_1', nodes: [] }, specials: {} },
        // The satellite: parented to li_1, absent from its child list.
        em_1: { id: 'em_1', data: { type: 'list-empty', parent: 'li_1', nodes: ['he_1'] }, specials: {} },
        he_1: { id: 'he_1', data: { type: 'heading', parent: 'em_1', nodes: [] }, specials: {} },
      },
    });
  }

  it('accepts satellites — the platform serves them, so refusing one refuses a real page', () => {
    expect(validateForSave(withSatellite())).toEqual([]);
  });

  it('still refuses a node attached to nothing at all', () => {
    const d = withSatellite();
    d.apply([
      {
        op: 'set',
        path: ['nodes', 'gh_1'],
        value: { id: 'gh_1', data: { type: 'heading', parent: null, nodes: [] }, specials: {} },
      },
    ]);
    expect(validateForSave(d).join(' ')).toMatch(/gh_1 is attached to nothing/);
  });

  it('still refuses a node whose parent chain leaves the document', () => {
    const d = withSatellite();
    d.apply([
      {
        op: 'set',
        path: ['nodes', 'gh_2'],
        value: { id: 'gh_2', data: { type: 'heading', parent: 'nowhere', nodes: [] }, specials: {} },
      },
    ]);
    expect(validateForSave(d).join(' ')).toMatch(/gh_2 is attached to nothing/);
  });

  it('still refuses a dangling child id', () => {
    const d = withSatellite();
    d.apply([{ op: 'set', path: ['nodes', 'li_1', 'data', 'nodes'], value: ['ghost'] }]);
    expect(validateForSave(d).join(' ')).toMatch(/lists child "ghost"/);
  });
});
