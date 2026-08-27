import { describe, it, expect } from 'vitest';
import { BINDING_SOURCES } from '../src/catalog/elements.generated.js';

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
