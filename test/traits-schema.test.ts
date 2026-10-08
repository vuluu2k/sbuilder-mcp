import { describe, it, expect } from 'vitest';
import { traitsFor } from '../src/catalog/element-search.js';
import { ELEMENTS, TRAIT_WRITES, BOUND_SPECIALS } from '../src/catalog/elements.generated.js';
import { isBaseOnlyConfig } from '../src/domains/site/baseonly.js';

type T = Record<string, any>;

describe('traitsFor() write facts', () => {
  it('names the config keys read from base only', () => {
    const t = traitsFor('list-dataset') as T;
    expect(t.base_only).toContain('datasetSource');
    for (const k of t.base_only) expect(isBaseOnlyConfig('list-dataset', k)).toBe(true);
  });

  it('honours BASE_ONLY_EXCEPTIONS: quantity-button keeps iconSize responsive', () => {
    const t = traitsFor('quantity-button') as T;
    expect(t.base_only ?? []).not.toContain('iconSize');
  });

  it('marks a declared control responsive:false exactly when it writes a base-only config key', () => {
    let marked = 0;
    for (const el of Object.values(ELEMENTS)) {
      const t = traitsFor(el.type) as T;
      for (const [c, d] of Object.entries<T>(t.declared)) {
        const base = TRAIT_WRITES[c].writes.some(
          (w) => w.target === 'config' && isBaseOnlyConfig(el.type, w.writeKey),
        );
        expect(d.responsive === false).toBe(base);
        if (base) marked++;
      }
    }
    expect(marked).toBeGreaterThan(0);
  });

  it('carries the write preconditions that apply to this element, without the types list', () => {
    const t = traitsFor('filter-checkbox') as T;
    expect(t.preconditions.length).toBeGreaterThan(0);
    expect(t.preconditions[0]).toHaveProperty('requires');
    expect(t.preconditions[0]).not.toHaveProperty('types');
  });

  it('carries the allowed events, and the binding events when the element has them', () => {
    const t = traitsFor('button') as T;
    expect(t.events.click).toContain('popup');
    expect(t.binding_events.click).toContain('open_cart');
  });

  it('names the specials a binding may target', () => {
    const type = Object.keys(BOUND_SPECIALS)[0];
    expect((traitsFor(type) as T).bindable).toEqual(expect.arrayContaining(BOUND_SPECIALS[type]));
  });

  it('bindable is EXACTLY what sb_bind accepts — the generated binding fields too', async () => {
    const { bindNode } = await import('../src/tools/live.js');
    const { PageDoc } = await import('../src/domains/site/document.js');
    const { addSubtree } = await import('../src/domains/site/builder.js');
    const doc = PageDoc.from({
      schema_version: 2,
      root_node_id: 'ROOT',
      nodes: { ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: [] }, style: {}, config: {}, specials: {} } },
    });
    const { patches, ids } = addSubtree(doc, 'ROOT', { type: 'sale-badge' });
    doc.apply(patches);
    const listed = (traitsFor('sale-badge') as T).bindable as string[];
    expect(listed).toContain('boundProductId');
    for (const k of listed) expect(() => bindNode(doc, ids[0], 'product.id', `specials.${k}`)).not.toThrow();
  });

  it('omits every new field when it would be empty', () => {
    const t = traitsFor('heading') as T;
    for (const k of ['preconditions', 'events', 'binding_events', 'bindable']) {
      expect(t).not.toHaveProperty(k);
    }
  });
});
