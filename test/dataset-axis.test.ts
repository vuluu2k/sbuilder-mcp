import { describe, it, expect } from 'vitest';
import { bindingsForConfig, createNode } from '../src/domains/site/node.js';
import { addSubtree, setKeys } from '../src/domains/site/builder.js';
import { ELEMENTS } from '../src/catalog/elements.generated.js';
import { bindings, emptyDoc, type Bound } from './helpers/doc.js';

/**
 * THE DATA AXIS OF A REPEATER, through both paths that can move it.
 *
 * Two silent failures, found by building a real storefront: a category shelf
 * authored with `datasetSource: "category"` repeated PRODUCTS, and no tool could
 * correct it afterwards. `sb_add` seeded the element's default bindings and
 * ignored the config in the same call; `sb_set` re-derived on a key that named a
 * `kind` the element has no default for, matched nothing, and returned null.
 * Both answered 200. Neither said a word.
 */

describe('bindingsForConfig()', () => {
  it('answers the exact source|kind pair when the element has a kind axis', () => {
    const b = bindingsForConfig('text-dataset', { datasetSource: 'category', kind: 'title' });
    expect(b).not.toBeNull();
    expect((b as unknown as Bound[])[0].source).toBe('category.title');
  });

  it('falls back to the source when the element declares no default kind', () => {
    // `list-dataset` has a table but no `config.kind`, so the exact key would be
    // "category|" and match nothing. Every category row is the same answer.
    expect(ELEMENTS['list-dataset'].defaults.config?.kind).toBeUndefined();
    const b = bindingsForConfig('list-dataset', { datasetSource: 'category' });
    expect(b).not.toBeNull();
    expect((b as unknown as Bound[])[0].target).toMatchObject({
      type: 'category',
      kind: 'collection_list',
    });
  });

  it('is null for an element with no data axis, so defaults stand', () => {
    expect(bindingsForConfig('heading', { datasetSource: 'category' })).toBeNull();
  });

  it('is null when no source is configured, so defaults stand', () => {
    expect(bindingsForConfig('list-dataset', {})).toBeNull();
  });
});

describe('createNode() honours the config it is given', () => {
  it('binds a list-dataset to collections when the spec says so', () => {
    const n = createNode('list-dataset', { config: { datasetSource: 'category' } });
    expect(bindings(n)[0].target).toMatchObject({ type: 'category', kind: 'collection_list' });
  });

  it('binds a text-dataset to the collection title, not the product title', () => {
    const n = createNode('text-dataset', { config: { datasetSource: 'category', kind: 'title' } });
    expect(bindings(n)[0].source).toBe('category.title');
  });

  it('keeps the element defaults when the caller overrides nothing', () => {
    const n = createNode('list-dataset');
    expect(bindings(n)[0].target).toMatchObject({ type: 'product', kind: 'product_list' });
  });
});

describe('addSubtree() carries the axis into a nested spec', () => {
  it('builds a collection shelf whose card reads collection fields', () => {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', {
      type: 'list-dataset',
      config: { datasetSource: 'category' },
      children: [
        {
          type: 'dataset-block',
          children: [{ type: 'text-dataset', config: { datasetSource: 'category', kind: 'title' } }],
        },
      ],
    });
    doc.apply(patches);
    const list = doc.node(ids[0]) as unknown as { bindings: unknown[] };
    expect(bindings(list)[0].target).toMatchObject({ type: 'category', kind: 'collection_list' });
    const text = ids
      .map((id) => doc.node(id) as unknown as { data: { type: string }; bindings: unknown[] })
      .find((n) => n.data.type === 'text-dataset');
    expect(text).toBeDefined();
    expect(bindings(text!)[0].source).toBe('category.title');
  });
});

describe('setKeys() re-derives for an element with no kind axis', () => {
  it('re-points a product repeater at collections', () => {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', { type: 'list-dataset' });
    doc.apply(patches);
    const id = ids[0];
    expect(bindings(doc.node(id) as never)[0].target).toMatchObject({ kind: 'product_list' });

    doc.apply(setKeys(doc, id, { datasetSource: 'category' }, { namespace: 'config', base: true }));
    expect(bindings(doc.node(id) as never)[0].target).toMatchObject({
      type: 'category',
      kind: 'collection_list',
    });
  });

  it('leaves bindings alone when the write does not touch the axis', () => {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', { type: 'list-dataset' });
    doc.apply(patches);
    const before = JSON.stringify(bindings(doc.node(ids[0]) as never));
    doc.apply(setKeys(doc, ids[0], { quantity: 8 }, { namespace: 'config', base: true }));
    expect(JSON.stringify(bindings(doc.node(ids[0]) as never))).toBe(before);
  });
});
