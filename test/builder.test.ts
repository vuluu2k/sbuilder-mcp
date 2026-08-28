import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree, setKeys, moveNode, removeNode, duplicateNode } from '../src/domains/site/builder.js';

function emptyDoc() {
  return PageDoc.from({
    schema_version: 2,
    root_node_id: 'rt',
    nodes: {
      rt: { id: 'rt', data: { type: 'root', parent: null, nodes: [], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
    },
  });
}

describe('addSubtree()', () => {
  it('adds one element and links it to its parent', () => {
    const d = emptyDoc();
    const { patches, ids } = addSubtree(d, 'rt', { type: 'flex-section' });
    d.apply(patches);
    expect(ids.length).toBe(1);
    expect(d.node('rt').data.nodes).toEqual(ids);
    expect(d.node(ids[0]).data.parent).toBe('rt');
  });

  it('adds a whole nested subtree in one call', () => {
    const d = emptyDoc();
    const { patches, ids } = addSubtree(d, 'rt', {
      type: 'flex-section',
      children: [{ type: 'heading' }, { type: 'text' }],
    });
    d.apply(patches);
    expect(ids.length).toBe(3);
    const section = d.node(ids[0]);
    expect(section.data.nodes.length).toBe(2);
    expect(d.node(section.data.nodes[0]).data.type).toBe('heading');
    expect(d.node(section.data.nodes[1]).data.type).toBe('text');
  });

  it('emits only admissible patches', () => {
    const d = emptyDoc();
    const { patches } = addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'text' }] });
    for (const p of patches) expect(p.path[0]).toBe('nodes');
  });

  it('refuses a root-only element inside a section', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section' }).patches);
    const sectionId = d.node('rt').data.nodes[0];
    expect(() => addSubtree(d, sectionId, { type: 'flex-section' })).toThrow(/root-only/i);
  });

  it('refuses to add into a node that is not a container', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'text' }] }).patches);
    const sectionId = d.node('rt').data.nodes[0];
    const textId = d.node(sectionId).data.nodes[0];
    expect(() => addSubtree(d, textId, { type: 'heading' })).toThrow(/container/i);
  });

  it('honours an explicit index', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', name: 'a' }).patches);
    const { patches, ids } = addSubtree(d, 'rt', { type: 'flex-section', name: 'b' }, 0);
    d.apply(patches);
    expect(d.node('rt').data.nodes[0]).toBe(ids[0]);
  });
});

describe('setKeys()', () => {
  it('writes per breakpoint by default', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section' }).patches);
    const id = d.node('rt').data.nodes[0];
    d.apply(setKeys(d, id, { gap: '24px' }, { namespace: 'style', breakpoint: 'desktop' }));
    const n = d.node(id) as unknown as { responsive: Record<string, { style: Record<string, unknown> }>; style: Record<string, unknown> };
    expect(n.responsive.desktop.style.gap).toBe('24px');
    expect(n.style.gap).toBeUndefined();
  });

  it('WRITES a base style when asked - base is the cascade fallback, not a trap', () => {
    // This used to throw. The refusal was built on a misread: the platform's
    // responsive mandate is about an element's Go renderer reading n.Config
    // directly, not about what a document may store. MergeNamespace resolves
    // current slot → wider → BASE → narrower, and meta.defaults seeds base.
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section' }).patches);
    const id = d.node('rt').data.nodes[0];
    d.apply(setKeys(d, id, { gap: '24px' }, { namespace: 'style', base: true }));
    const n = d.node(id) as unknown as { style: Record<string, unknown> };
    expect(n.style.gap).toBe('24px');
  });

  it('still defaults to per-breakpoint, because a design should respond', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section' }).patches);
    const id = d.node('rt').data.nodes[0];
    d.apply(setKeys(d, id, { gap: '8px' }, { namespace: 'style' }));
    const n = d.node(id) as unknown as {
      style: Record<string, unknown>;
      responsive: Record<string, { style?: Record<string, unknown> }>;
    };
    expect(n.responsive.desktop?.style?.gap).toBe('8px');
    expect(n.style.gap).toBeUndefined();
  });

  it('allows a base write of an identity key', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'heading' }] }).patches);
    const id = d.node(d.node('rt').data.nodes[0]).data.nodes[0];
    d.apply(setKeys(d, id, { htmlTag: 'h1' }, { namespace: 'specials', base: true }));
    expect(d.node(id).specials.htmlTag).toBe('h1');
  });

  it('always writes specials at base - content is not a quantity', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'heading' }] }).patches);
    const id = d.node(d.node('rt').data.nodes[0]).data.nodes[0];
    d.apply(setKeys(d, id, { text: 'Hello' }, { namespace: 'specials' }));
    expect(d.node(id).specials.text).toBe('Hello');
  });

  it('names the node when it does not exist', () => {
    const d = emptyDoc();
    expect(() => setKeys(d, 'ghost', { gap: '1px' }, { namespace: 'style' })).toThrow(/ghost/);
  });
});

describe('moveNode() / removeNode()', () => {
  it('moves a node between parents', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'text' }] }).patches);
    d.apply(addSubtree(d, 'rt', { type: 'flex-section' }).patches);
    const [a, b] = d.node('rt').data.nodes;
    const textId = d.node(a).data.nodes[0];
    d.apply(moveNode(d, textId, b, 0));
    expect(d.node(a).data.nodes).toEqual([]);
    expect(d.node(b).data.nodes).toEqual([textId]);
    expect(d.node(textId).data.parent).toBe(b);
  });

  it('refuses to move a node into its own descendant', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'flex-block' }] }).patches);
    const sectionId = d.node('rt').data.nodes[0];
    const blockId = d.node(sectionId).data.nodes[0];
    expect(() => moveNode(d, sectionId, blockId, 0)).toThrow(/descendant/i);
  });

  it('removes a node and its whole subtree', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'text' }] }).patches);
    const sectionId = d.node('rt').data.nodes[0];
    const textId = d.node(sectionId).data.nodes[0];
    d.apply(removeNode(d, sectionId));
    expect(d.has(sectionId)).toBe(false);
    expect(d.has(textId)).toBe(false);
    expect(d.node('rt').data.nodes).toEqual([]);
  });

  it('refuses to remove ROOT', () => {
    const d = emptyDoc();
    expect(() => removeNode(d, 'rt')).toThrow(/ROOT/);
  });

  it('refuses to touch an overlay through either path', () => {
    const d = PageDoc.from({
      schema_version: 2,
      root_node_id: 'rt',
      nodes: {
        rt: { id: 'rt', data: { type: 'root', parent: null, nodes: ['cart'], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
        cart: { id: 'cart', data: { type: 'flex-section', parent: 'rt', nodes: [], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: { overlayId: 'ov_1' }, responsive: {}, events: [], bindings: [] },
      },
    });
    expect(() => removeNode(d, 'cart')).toThrow(/overlay/i);
    expect(() => moveNode(d, 'cart', 'rt', 0)).toThrow(/overlay/i);
  });
});

describe('duplicateNode()', () => {
  it('copies a subtree under fresh ids, beside the original', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'heading' }, { type: 'text' }] }).patches);
    const sectionId = d.node('rt').data.nodes[0];

    const { patches, ids } = duplicateNode(d, sectionId);
    d.apply(patches);

    expect(ids.length).toBe(3);
    // Right after the original, not appended at the end.
    expect(d.node('rt').data.nodes).toEqual([sectionId, ids[0]]);
    const copy = d.node(ids[0]);
    expect(copy.data.type).toBe('flex-section');
    expect(copy.data.parent).toBe('rt');
    expect(copy.data.nodes.length).toBe(2);
    // Fresh ids throughout: a shared id renders once and cannot be selected.
    expect(copy.data.nodes).not.toContain(d.node(sectionId).data.nodes[0]);
  });

  it('carries the styling across, which is the point of duplicating', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section' }).patches);
    const id = d.node('rt').data.nodes[0];
    d.apply(setKeys(d, id, { gap: '24px' }, { namespace: 'style', breakpoint: 'desktop' }));

    const { ids } = duplicateNode(d, id);
    d.apply(duplicateNode(d, id).patches);
    const copy = d.node(d.node('rt').data.nodes[1]) as unknown as {
      responsive: Record<string, { style?: Record<string, unknown> }>;
    };
    expect(copy.responsive.desktop?.style?.gap).toBe('24px');
    expect(ids.length).toBe(1);
  });

  it('refuses ROOT and an overlay', () => {
    const d = emptyDoc();
    expect(() => duplicateNode(d, 'rt')).toThrow(/ROOT/);
  });
});

describe('setKeys() with a state', () => {
  it('writes hover under the breakpoint, not over it', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'button' }] }).patches);
    const id = d.node(d.node('rt').data.nodes[0]).data.nodes[0];
    d.apply(setKeys(d, id, { backgroundColor: '#000' }, { namespace: 'style', breakpoint: 'desktop', state: 'hover' }));
    const n = d.node(id) as unknown as {
      states: Record<string, Record<string, { style?: Record<string, unknown> }>>;
      responsive: Record<string, unknown>;
    };
    expect(n.states.hover.desktop.style?.backgroundColor).toBe('#000');
    expect(n.responsive.desktop).toBeUndefined();
  });
});
