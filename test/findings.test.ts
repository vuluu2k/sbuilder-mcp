import { describe, it, expect } from 'vitest';
import { FIX, fill, compactFindings } from '../src/domains/site/findings.js';

describe('findings', () => {
  it('fill() substitutes every placeholder', () => {
    const s = fill('empty_text', { id: 'tx_1', key: 'text' });
    expect(s).toBe(FIX.empty_text.replace('<id>', 'tx_1').replace('<key>', 'text'));
    expect(s).not.toContain('<');
  });

  it('compactFindings() drops fix from each item and emits one template per code present', () => {
    const items = [
      { code: 'empty_text', nodeId: 'a', fix: 'x' },
      { code: 'empty_text', nodeId: 'b', fix: 'y' },
      { code: 'overlap', nodeId: 'c', fix: 'z' },
    ];
    const out = compactFindings(items);
    expect(out.findings.map((f) => 'fix' in f)).toEqual([false, false, false]);
    expect(Object.keys(out.fixes).sort()).toEqual(['empty_text', 'overlap']);
    expect(out.fixes.empty_text).toBe(FIX.empty_text);
  });

  it('every template used by review and measure exists', () => {
    for (const code of [
      'empty_page', 'unknown_element', 'empty_container', 'empty_text', 'missing_media',
      'placeholder_content', 'default_seed_copy', 'form_fields_flush', 'dead_binding_source', 'dead_binding_field',
      'off_canvas', 'text_too_small', 'overlap',
    ]) expect(FIX[code], code).toBeTypeOf('string');
  });
});

describe('fill() on an unknown code', () => {
  it('throws rather than returning an empty fix', () => {
    expect(() => fill('no_such_code', {})).toThrow(/no fix template/);
  });
});
