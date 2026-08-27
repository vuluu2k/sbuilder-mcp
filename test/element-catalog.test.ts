import { describe, it, expect } from 'vitest';
import { ELEMENTS, ELEMENT_SOURCE } from '../src/catalog/elements.generated.js';

describe('generated element catalog', () => {
  it('carries every registered element', () => {
    expect(Object.keys(ELEMENTS).length).toBe(ELEMENT_SOURCE.count);
    expect(Object.keys(ELEMENTS).length).toBeGreaterThan(80);
  });

  it('records the document schema version the platform writes', () => {
    expect(ELEMENT_SOURCE.docSchemaVersion).toBe(2);
  });

  it('gives every element its AI hints - the reason this catalog exists', () => {
    for (const el of Object.values(ELEMENTS)) {
      expect(el.description.length).toBeGreaterThan(0);
    }
  });

  it('knows flex-section is a root-only container', () => {
    const fs = ELEMENTS['flex-section'];
    expect(fs.isContainer).toBe(true);
    expect(fs.isRootOnly).toBe(true);
    expect(fs.category).toBe('layout');
  });

  it('flattens traits to a string list whichever shape the platform used', () => {
    for (const el of Object.values(ELEMENTS)) {
      expect(Array.isArray(el.traits)).toBe(true);
      expect(el.traits.every((t) => typeof t === 'string')).toBe(true);
    }
  });

  it('has at least one element declaring a containment whitelist', () => {
    expect(Object.values(ELEMENTS).some((e) => e.childAllows.length > 0)).toBe(true);
  });
});
