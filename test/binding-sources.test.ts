import { describe, it, expect } from 'vitest';
import { BINDING_SOURCES, ELEMENTS } from '../src/catalog/elements.generated.js';

describe('BINDING_SOURCES', () => {
  it('carries the keys the renderer actually provides', () => {
    expect(BINDING_SOURCES).toContain('product.title');
    expect(BINDING_SOURCES).toContain('product.price');
    expect(BINDING_SOURCES).toContain('category.title');
    expect(BINDING_SOURCES).toContain('article.title');
    expect(BINDING_SOURCES.length).toBeGreaterThan(15);
  });

  it('is sorted and unique, so a diff of the generated file is readable', () => {
    expect([...BINDING_SOURCES].sort()).toEqual(BINDING_SOURCES);
    expect(new Set(BINDING_SOURCES).size).toBe(BINDING_SOURCES.length);
  });
});

describe('the source list is complete enough not to cry wolf', () => {
  it('carries the keys the platform ITSELF seeds', () => {
    // pricing-dataset ships a binding to product.moneyOverride. Reading only
    // the Go renderer's context missed it, so sb_review reported the platform's
    // own element as a dead binding on every page that priced anything.
    for (const seeded of ['product.moneyOverride', 'product.price', 'product.compareAtPrice']) {
      expect(BINDING_SOURCES, seeded).toContain(seeded);
    }
  });

  it('every source an element seeds by default is a source the review accepts', () => {
    for (const el of Object.values(ELEMENTS)) {
      for (const b of (el.defaults.bindings ?? []) as Array<{ source?: string }>) {
        if (!b.source) continue;
        expect(BINDING_SOURCES, `${el.type} seeds ${b.source}`).toContain(b.source);
      }
    }
  });
});
