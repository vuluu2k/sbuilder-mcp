import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { bindNode } from '../src/tools/live.js';

function docWithHeading() {
  return PageDoc.from({
    schema_version: 2,
    root_node_id: 'rt',
    nodes: {
      rt: { id: 'rt', data: { type: 'root', parent: null, nodes: ['he_1'], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
      he_1: { id: 'he_1', data: { type: 'heading', parent: 'rt', nodes: [], isCanvas: false, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
    },
  });
}

function bindingsOf(d: PageDoc, id: string) {
  return (d.node(id) as unknown as { bindings: Array<Record<string, string>> }).bindings;
}

describe('bindNode()', () => {
  it('appends a binding the renderer can resolve', () => {
    const d = docWithHeading();
    d.apply(bindNode(d, 'he_1', 'product.title', 'specials.text'));
    const b = bindingsOf(d, 'he_1');
    expect(b.length).toBe(1);
    expect(b[0].source).toBe('product.title');
    expect(b[0].field).toBe('specials.text');
    expect(typeof b[0].id).toBe('string');
  });

  it('appends rather than replacing, so a node can carry several', () => {
    const d = docWithHeading();
    d.apply(bindNode(d, 'he_1', 'product.title', 'specials.text'));
    d.apply(bindNode(d, 'he_1', 'product.image', 'specials.src'));
    expect(bindingsOf(d, 'he_1').length).toBe(2);
  });

  it('refuses a source the renderer never provides - it would silently do nothing', () => {
    const d = docWithHeading();
    expect(() => bindNode(d, 'he_1', 'product.nonsense', 'specials.text')).toThrow(/not a binding source/i);
  });

  it('refuses a field outside the specials namespace - applyBindings ignores those', () => {
    const d = docWithHeading();
    expect(() => bindNode(d, 'he_1', 'product.title', 'style.color')).toThrow(/specials/i);
  });

  it('refuses a field with no key after the dot', () => {
    const d = docWithHeading();
    expect(() => bindNode(d, 'he_1', 'product.title', 'specials.')).toThrow(/specials/i);
  });

  it('names the node when it does not exist', () => {
    const d = docWithHeading();
    expect(() => bindNode(d, 'ghost', 'product.title', 'specials.text')).toThrow(/ghost/);
  });
});
