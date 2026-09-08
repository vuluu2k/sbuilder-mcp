import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree, setKeys, setMany, moveNode, removeNode, duplicateNode } from '../src/domains/site/builder.js';
import { validateForSave } from '../src/domains/site/validate.js';

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

/**
 * A STATE HAS TWO HOMES, and the platform names both — `schema/src/node.ts`,
 * mirrored by `render/style/cascade.go`'s MergeStateNs:
 *
 *   base            node.states[state][ns]
 *   per breakpoint  node.responsive[bp].states[state][ns]
 *
 * The old shape here was `states[state][bp][ns]`, which is neither: a breakpoint
 * buried inside the base-state cluster, where nothing reads it. The test pinned
 * it, so the defect had a green suite over it.
 */
describe('setKeys() with a state', () => {
  function button() {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'button' }] }).patches);
    return { d, id: d.node(d.node('rt').data.nodes[0]).data.nodes[0] };
  }
  type Stated = {
    style: Record<string, unknown>;
    states?: Record<string, { style?: Record<string, unknown> }>;
    responsive: Record<string, { states?: Record<string, { style?: Record<string, unknown> }> }>;
  };

  it('writes a per-breakpoint state where the cascade reads it', () => {
    const { d, id } = button();
    d.apply(setKeys(d, id, { backgroundColor: '#000' }, { namespace: 'style', breakpoint: 'desktop', state: 'hover' }));
    const n = d.node(id) as unknown as Stated;
    expect(n.responsive.desktop.states?.hover.style?.backgroundColor).toBe('#000');
  });

  it('writes a BASE state into the cluster the element seeds its own defaults in', () => {
    const { d, id } = button();
    d.apply(setKeys(d, id, { backgroundColor: '#000' }, { namespace: 'style', base: true, state: 'hover' }));
    const n = d.node(id) as unknown as Stated;
    expect(n.states?.hover.style?.backgroundColor).toBe('#000');
  });

  // THE DEFECT THIS FILE EXISTS FOR. `base` was tested first and swallowed the
  // state, so the hover value went straight into the plain style: the node wore
  // its hover colour permanently and had no hover at all, while the tool
  // reported success. The design skill documents this exact call.
  it('never lets base swallow the state and corrupt the plain style', () => {
    const { d, id } = button();
    const before = { ...(d.node(id) as unknown as Stated).style };
    d.apply(setKeys(d, id, { borderColor: '#E8557A' }, { namespace: 'style', base: true, state: 'active' }));
    const n = d.node(id) as unknown as Stated;
    expect(n.states?.active.style?.borderColor).toBe('#E8557A');
    expect(n.style.borderColor).toBe(before.borderColor);
  });

  it('refuses a state on specials rather than dropping it', () => {
    const { d, id } = button();
    expect(() =>
      setKeys(d, id, { text: 'x' }, { namespace: 'specials', base: true, state: 'hover' }),
    ).toThrow(/no interaction state/i);
  });
});

describe('setMany()', () => {
  it('writes several nodes in one batch, in edit order', () => {
    const d = emptyDoc();
    d.apply(
      addSubtree(d, 'rt', {
        type: 'flex-section',
        children: [{ type: 'heading' }, { type: 'heading' }],
      }).patches,
    );
    const [a, b] = d.node(d.node('rt').data.nodes[0]).data.nodes;
    const { patches, touched } = setMany(d, [
      { id: a, namespace: 'specials', keys: { text: 'One' } },
      { id: b, namespace: 'specials', keys: { text: 'Two' } },
    ]);
    d.apply(patches);
    expect(touched).toEqual([{ id: a, keys: ['text'] }, { id: b, keys: ['text'] }]);
    expect((d.node(a).specials as { text: string }).text).toBe('One');
    expect((d.node(b).specials as { text: string }).text).toBe('Two');
  });

  it('refuses the whole batch when one edit is bad — the caller gets no patches at all', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'heading' }] }).patches);
    const a = d.node(d.node('rt').data.nodes[0]).data.nodes[0];
    // An implementation that returned the good edit's patches alongside the
    // error would leave the caller applying half a batch; this is what says it
    // does not, because `patches` never gets assigned.
    let patches: unknown;
    expect(() => {
      patches = setMany(d, [
        { id: a, namespace: 'specials', keys: { text: 'One' } },
        { id: 'ghost', namespace: 'specials', keys: { text: 'Two' } },
      ]).patches;
    }).toThrow(/ghost/);
    expect(patches).toBeUndefined();
  });

  it('refuses an empty batch', () => {
    expect(() => setMany(emptyDoc(), [])).toThrow(/empty/);
  });
});

describe('removeNode() and satellites', () => {
  it('takes the satellites down with the subtree, so the next save is not refused', () => {
    const d = PageDoc.from({
      schema_version: 2,
      root_node_id: 'rt',
      nodes: {
        rt: { id: 'rt', data: { type: 'root', parent: null, nodes: ['fs_1'] }, specials: {} },
        fs_1: { id: 'fs_1', data: { type: 'flex-section', parent: 'rt', nodes: ['li_1'] }, specials: {} },
        li_1: { id: 'li_1', data: { type: 'list-dataset', parent: 'fs_1', nodes: [] }, specials: {} },
        // Attached to li_1 by pointer only — invisible to a child-list walk.
        em_1: { id: 'em_1', data: { type: 'list-empty', parent: 'li_1', nodes: ['he_1'] }, specials: {} },
        he_1: { id: 'he_1', data: { type: 'heading', parent: 'em_1', nodes: [] }, specials: {} },
      },
    });
    d.apply(removeNode(d, 'fs_1'));
    expect(Object.keys(d.doc.nodes).sort()).toEqual(['rt']);
    expect(validateForSave(d)).toEqual([]);
  });
});

describe('setKeys() and the data axis', () => {
  function withTextDataset() {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'text-dataset' }] }).patches);
    return { d, id: d.node(d.node('rt').data.nodes[0]).data.nodes[0] };
  }
  const bindings = (d: PageDoc, id: string) =>
    (d.node(id) as unknown as { bindings: Array<{ source?: string }> }).bindings;

  it('re-points a dataset element when the kind changes', () => {
    const { d, id } = withTextDataset();
    expect(bindings(d, id)[0].source).toBe('product.title');
    d.apply(setKeys(d, id, { kind: 'vendor' }, { namespace: 'config', base: true }));
    expect(bindings(d, id)[0].source).toBe('product.vendor');
  });

  it('follows a change of entity, not just of field', () => {
    const { d, id } = withTextDataset();
    d.apply(setKeys(d, id, { datasetSource: 'category', kind: 'title' }, { namespace: 'config', base: true }));
    expect(bindings(d, id)[0].source).toBe('category.title');
  });

  it('leaves the bindings alone for a write that is not about the data axis', () => {
    const { d, id } = withTextDataset();
    const before = JSON.stringify(bindings(d, id));
    d.apply(setKeys(d, id, { descriptionLines: 4 }, { namespace: 'config', base: true }));
    expect(JSON.stringify(bindings(d, id))).toBe(before);
  });

  it('does not touch an element with no data axis', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'heading' }] }).patches);
    const id = d.node(d.node('rt').data.nodes[0]).data.nodes[0];
    d.apply(setKeys(d, id, { kind: 'title' }, { namespace: 'config', base: true }));
    expect((d.node(id) as unknown as { bindings: unknown[] }).bindings).toEqual([]);
  });
});

describe('addSubtree() mints the satellites an element owns', () => {
  // A satellite is a real node referenced from `config[configKey]` instead of
  // `data.nodes`. The editor's node store mints them on add
  // (editor/src/element/seeds.ts:5-7); this server did not, so an accordion it
  // created had no item skin at all and the renderer took its degrade path.
  function withSection() {
    const d = emptyDoc();
    const { patches, ids } = addSubtree(d, 'rt', { type: 'flex-section' });
    d.apply(patches);
    return { d, section: ids[0] };
  }

  it('points config.emptyStateId at a real list-empty node', () => {
    const { d, section } = withSection();
    const { patches, ids } = addSubtree(d, section, { type: 'list-dataset' });
    d.apply(patches);
    const list = d.node(ids[0]);
    const emptyId = list.config.emptyStateId as string;
    expect(typeof emptyId).toBe('string');
    expect(d.has(emptyId)).toBe(true);
    expect(d.node(emptyId).data.type).toBe('list-empty');
  });

  it('attaches the satellite by parent alone, never in the owner child list', () => {
    const { d, section } = withSection();
    const { patches, ids } = addSubtree(d, section, { type: 'list-dataset' });
    d.apply(patches);
    const list = d.node(ids[0]);
    const emptyId = list.config.emptyStateId as string;
    expect(d.node(emptyId).data.parent).toBe(list.id);
    expect(list.data.nodes).not.toContain(emptyId);
  });

  it('does NOT mint an optional satellite', () => {
    // list-loading is the only `optional: true` satellite in the platform. A list
    // with no loading design shows a silhouette of its own cards, which is the
    // better default; seeding one would replace it with a design nobody asked for.
    const { d, section } = withSection();
    const { patches, ids } = addSubtree(d, section, { type: 'list-dataset' });
    d.apply(patches);
    expect(d.node(ids[0]).config.loadingStateId).toBeUndefined();
  });

  it('mints the accordion item skin, which meta.defaults never carried', () => {
    const { d, section } = withSection();
    const { patches, ids } = addSubtree(d, section, { type: 'accordion' });
    d.apply(patches);
    const itemId = d.node(ids[0]).config.accordionItemId as string;
    expect(d.has(itemId)).toBe(true);
    expect(d.node(itemId).data.type).toBe('accordion-item');
  });

});

describe('a minted empty state carries the design the editor gives it', () => {
  // The three list-empty owners get a SUBTREE, not a bare node
  // (editor/src/nodes/*/index.vue call addDetachedTree, not addDetachedNode).
  // A bare list-empty renders as blank space where the editor shows a glyph, a
  // headline and a line of body.
  function withSection() {
    const d = emptyDoc();
    const { patches, ids } = addSubtree(d, 'rt', { type: 'flex-section' });
    d.apply(patches);
    return { d, section: ids[0] };
  }

  it('fills the list empty state with a glyph, a headline and a line of body', () => {
    const { d, section } = withSection();
    const { patches, ids } = addSubtree(d, section, { type: 'list-dataset' });
    d.apply(patches);
    const empty = d.node(d.node(ids[0]).config.emptyStateId as string);
    expect(empty.data.nodes.map((i) => d.node(i).data.type)).toEqual(['icon', 'heading', 'text']);
  });

  it('writes the copy for the list dataset source, not the product default', () => {
    const { d, section } = withSection();
    const { patches, ids } = addSubtree(d, section, {
      type: 'list-dataset',
      config: { datasetSource: 'article' },
    });
    d.apply(patches);
    const empty = d.node(d.node(ids[0]).config.emptyStateId as string);
    const heading = d.node(empty.data.nodes[1]);
    expect(heading.specials.text).toBe('No posts yet');
  });

  it('gives the cart its own second-person copy', () => {
    const { d, section } = withSection();
    const { patches, ids } = addSubtree(d, section, { type: 'cart-order' });
    d.apply(patches);
    const empty = d.node(d.node(ids[0]).config.emptyStateId as string);
    expect(empty.data.nodes.length).toBeGreaterThan(0);
    expect(String(d.node(empty.data.nodes[1]).specials.text)).not.toBe('No products yet');
  });

  it('keeps every seeded node attached, so the document still saves', () => {
    const { d, section } = withSection();
    const { patches } = addSubtree(d, section, { type: 'list-dataset' });
    d.apply(patches);
    expect(validateForSave(d)).toEqual([]);
  });
});

describe('duplicateNode() and the things a verbatim clone carries over', () => {
  it('gives the copy its OWN satellite, not a pointer to the original one', () => {
    // JSON.parse(JSON.stringify(src)) rewrote only `id` and `data`, so
    // config.accordionItemId came over verbatim: two accordions sharing one item
    // skin, and removing the original orphaned the copy's reference.
    const d = emptyDoc();
    const sec = addSubtree(d, 'rt', { type: 'flex-section' });
    d.apply(sec.patches);
    const acc = addSubtree(d, sec.ids[0], { type: 'accordion' });
    d.apply(acc.patches);
    const originalSkin = d.node(acc.ids[0]).config.accordionItemId as string;

    const dup = duplicateNode(d, acc.ids[0]);
    d.apply(dup.patches);
    const copySkin = d.node(dup.ids[0]).config.accordionItemId as string;

    expect(copySkin).not.toBe(originalSkin);
    expect(d.has(copySkin)).toBe(true);
    expect(d.node(copySkin).data.type).toBe('accordion-item');
    expect(d.node(copySkin).data.parent).toBe(dup.ids[0]);
  });

  it('copies the whole empty-state subtree a repeater owns', () => {
    const d = emptyDoc();
    const sec = addSubtree(d, 'rt', { type: 'flex-section' });
    d.apply(sec.patches);
    const list = addSubtree(d, sec.ids[0], { type: 'list-dataset' });
    d.apply(list.patches);

    const dup = duplicateNode(d, list.ids[0]);
    d.apply(dup.patches);
    const copyEmpty = d.node(dup.ids[0]).config.emptyStateId as string;
    expect(copyEmpty).not.toBe(d.node(list.ids[0]).config.emptyStateId);
    expect(d.node(copyEmpty).data.nodes.length).toBe(3);
  });

  it('strips the global stamp, so the copy is a plain local section', () => {
    // Two ROOT children carrying one globalId is ErrDuplicateGlobal
    // (decompose.go:293) — refused on a LATER save, reading like a transport
    // error by the time it arrives.
    const d = emptyDoc();
    const sec = addSubtree(d, 'rt', { type: 'flex-section' });
    d.apply(sec.patches);
    d.apply([
      { op: 'set', path: ['nodes', sec.ids[0], 'specials', 'globalId'], value: 'gs_1' },
      { op: 'set', path: ['nodes', sec.ids[0], 'specials', 'globalKind'], value: 'header' },
    ]);

    const dup = duplicateNode(d, sec.ids[0]);
    d.apply(dup.patches);
    const copy = d.node(dup.ids[0]);
    expect(copy.specials.globalId).toBeUndefined();
    expect(copy.specials.globalRef).toBeUndefined();
    expect(copy.specials.globalKind).toBeUndefined();
    // the original is untouched
    expect(d.node(sec.ids[0]).specials.globalId).toBe('gs_1');
  });
});

describe('a repeater takes one template, and the write says so', () => {
  function listIn() {
    const d = emptyDoc();
    const sec = addSubtree(d, 'rt', { type: 'flex-section' });
    d.apply(sec.patches);
    const list = addSubtree(d, sec.ids[0], { type: 'list-dataset', children: [{ type: 'dataset-block' }] });
    d.apply(list.patches);
    return { d, section: sec.ids[0], list: list.ids[0] };
  }

  it('refuses a second child into a repeater, naming the rule', () => {
    const { d, list } = listIn();
    expect(() => addSubtree(d, list, { type: 'dataset-block' })).toThrow(/first|one template|Nodes\[0\]/i);
  });

  it('refuses a move into a repeater that already has its template', () => {
    const { d, section, list } = listIn();
    const stray = addSubtree(d, section, { type: 'dataset-block' });
    d.apply(stray.patches);
    expect(() => moveNode(d, stray.ids[0], list, 0)).toThrow(/first|one template|Nodes\[0\]/i);
  });

  it('still allows the FIRST child', () => {
    const d = emptyDoc();
    const sec = addSubtree(d, 'rt', { type: 'flex-section' });
    d.apply(sec.patches);
    const list = addSubtree(d, sec.ids[0], { type: 'list-dataset' });
    d.apply(list.patches);
    expect(() => addSubtree(d, list.ids[0], { type: 'dataset-block' })).not.toThrow();
  });

  it('leaves a container that renders every child alone', () => {
    // dataset-block is a dataset container too and renders ALL of its children,
    // which is why the rule is generated from the renderers rather than derived
    // from "is a dataset container".
    const { d, list } = listIn();
    const block = d.node(list).data.nodes[0];
    expect(() => addSubtree(d, block, { type: 'text' })).not.toThrow();
    expect(() => addSubtree(d, block, { type: 'heading' })).not.toThrow();
  });
});

describe('the repeater rule holds on every write path, not just two', () => {
  function listWithTemplate() {
    const d = emptyDoc();
    const sec = addSubtree(d, 'rt', { type: 'flex-section' });
    d.apply(sec.patches);
    const list = addSubtree(d, sec.ids[0], { type: 'list-dataset', children: [{ type: 'dataset-block' }] });
    d.apply(list.patches);
    return { d, list: list.ids[0], template: d.node(list.ids[0]).data.nodes[0] };
  }

  it('refuses duplicating a repeater template, which is the designer move', () => {
    // sb_add and sb_move refuse a second template; duplicate produced exactly
    // the document they exist to prevent, and "duplicate the card" is the most
    // likely way to reach for a second one.
    const { d, template } = listWithTemplate();
    expect(() => duplicateNode(d, template)).toThrow(/first|template|Nodes\[0\]/i);
  });

  it('still duplicates a child of a container that renders all of them', () => {
    const { d, list } = listWithTemplate();
    const block = d.node(list).data.nodes[0];
    const inner = addSubtree(d, block, { type: 'text' });
    d.apply(inner.patches);
    expect(() => duplicateNode(d, inner.ids[0])).not.toThrow();
  });

  it('allows a REORDER inside a repeater, which is never a second template', () => {
    // The subtlest line in moveNode: `n.data.parent !== newParentId`. Without a
    // test, deleting it leaves the suite green and breaks every reorder.
    const { d, list, template } = listWithTemplate();
    expect(() => moveNode(d, template, list, 0)).not.toThrow();
  });
});
