import { describe, it, expect } from 'vitest';
import { ELEMENTS, ELEMENT_SOURCE, TRAIT_WRITES } from '../src/catalog/elements.generated.js';

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

  it('reads the inspector down to its CONTROLS, not its section headers', () => {
    // The bug this replaces was silent: `heading` reported nine plausible words
    // (size, typography, seo, …) that were group labels, and an agent styling
    // from them had nothing real to set.
    const h = ELEMENTS.heading;
    expect(h.controls).toContain('font_size');
    expect(h.controls).toContain('text_color');
    expect(h.controls).toContain('html_tag');
    expect(h.controls.length).toBeGreaterThan(15);
    // The group keys must NOT be controls — that was the bug's signature.
    expect(h.controls).not.toContain('typography');
    expect(h.controls).not.toContain('seo');
  });

  it('keeps the tab and group structure a person navigates', () => {
    const h = ELEMENTS.heading;
    expect(h.inspector.map((t) => t.tab)).toContain('general');
    const typography = h.inspector
      .flatMap((t) => t.groups)
      .find((g) => g.key === 'typography');
    expect(typography).toBeDefined();
    expect(typography!.controls).toContain('font_size');
  });

  it('every control in a group also appears in the flat list', () => {
    for (const el of Object.values(ELEMENTS)) {
      const fromTree = new Set(el.inspector.flatMap((t) => t.groups.flatMap((g) => g.controls)));
      for (const c of fromTree) expect(el.controls).toContain(c);
      expect(el.controls.length).toBe(fromTree.size);
    }
  });

  it('carries the write target for the controls the platform declares', () => {
    expect(TRAIT_WRITES.font_size.writes).toEqual([
      { target: 'style', writeKey: 'fontSize', type: 'number', unit: 'px' },
    ]);
    expect(TRAIT_WRITES.text_color.writes[0].writeKey).toBe('color');
    expect(Object.keys(TRAIT_WRITES).length).toBeGreaterThan(50);
  });

  it('has at least one element declaring a containment whitelist', () => {
    expect(Object.values(ELEMENTS).some((e) => e.childAllows.length > 0)).toBe(true);
  });
});
