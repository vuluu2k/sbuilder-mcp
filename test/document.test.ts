import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';

function nd(id: string, type: string, parent: string | null, kids: string[], specials: Record<string, unknown> = {}, name?: string) {
  return {
    id,
    data: { type, ...(name ? { name } : {}), parent, nodes: kids, isCanvas: true, hidden: false, custom: {} },
    style: {}, config: {}, specials, responsive: {}, events: [], bindings: [],
  };
}

const raw = {
  schema_version: 2,
  root_node_id: 'rt',
  nodes: {
    rt: nd('rt', 'root', null, ['h', 'fs_1', 'cart']),
    h: nd('h', 'flex-section', 'rt', [], { globalId: 'g1', globalKind: 'header' }, 'Header'),
    fs_1: nd('fs_1', 'flex-section', 'rt', ['tx_1']),
    tx_1: nd('tx_1', 'text', 'fs_1', []),
    cart: nd('cart', 'flex-section', 'rt', [], { overlayId: 'ov_1' }),
  },
};

describe('PageDoc', () => {
  it('loads a document and reports its root', () => {
    const d = PageDoc.from(raw);
    expect(d.doc.root_node_id).toBe('rt');
    expect(d.has('tx_1')).toBe(true);
  });

  it('seeds ROOT for a brand-new page, which is how the server hands one over', () => {
    // The server's own emptyDocument. An agent that just created a page must be
    // able to open it; there is nothing here to race with.
    const d = PageDoc.from({ schema_version: 1, root_node_id: '', nodes: {} });
    expect(d.doc.root_node_id).toBe('ROOT');
    expect(d.node('ROOT').data.type).toBe('root');
    expect(d.node('ROOT').data.nodes).toEqual([]);
    expect(d.outline()).toEqual([]);
  });

  it('refuses a DAMAGED document - nodes present, root naming none of them', () => {
    expect(() =>
      PageDoc.from({
        schema_version: 2,
        root_node_id: 'nope',
        nodes: { a: { id: 'a', data: { type: 'text', parent: null, nodes: [] }, specials: {} } },
      }),
    ).toThrow(/damaged/i);
  });

  it('refuses an empty-nodes document that still claims a root', () => {
    expect(() => PageDoc.from({ schema_version: 2, root_node_id: 'nope', nodes: {} })).toThrow(/damaged/i);
  });

  it('refuses something that is not a document at all', () => {
    expect(() => PageDoc.from({ hello: 1 })).toThrow(/page document/i);
  });

  it('applies a patch and bumps the revision', () => {
    const d = PageDoc.from(raw);
    const before = d.rev;
    d.apply([{ op: 'set', path: ['nodes', 'tx_1', 'specials', 'text'], value: 'Hi' }]);
    expect(d.node('tx_1').specials.text).toBe('Hi');
    expect(d.rev).toBe(before + 1);
  });

  it('does not mutate the object it was given', () => {
    const copy = JSON.parse(JSON.stringify(raw));
    const d = PageDoc.from(copy);
    d.apply([{ op: 'set', path: ['nodes', 'tx_1', 'specials', 'text'], value: 'Hi' }]);
    expect(copy.nodes.tx_1.specials).toEqual({});
  });

  it('outlines one short line per node, marking band, global and overlay', () => {
    expect(PageDoc.from(raw).outline()).toEqual([
      { id: 'h', type: 'flex-section', children: 0, band: 'header', name: 'Header', global: true },
      { id: 'fs_1', type: 'flex-section', children: 1, band: 'middle' },
      { id: 'cart', type: 'flex-section', children: 0, overlay: true },
    ]);
  });

  it('nests to the requested depth', () => {
    const out = PageDoc.from(raw).outline({ depth: 2 });
    expect(out.find((o) => o.id === 'fs_1')!.kids).toEqual([
      { id: 'tx_1', type: 'text', children: 0 },
    ]);
  });

  it('names the missing node when asked for one that is not there', () => {
    expect(() => PageDoc.from(raw).node('nope')).toThrow(/nope/);
  });
});
