import { describe, it, expect } from 'vitest';
import { catalogMatches, traitsFor } from '../src/catalog/element-search.js';

describe('catalogMatches()', () => {
  it('returns four fields per match by default, flags only when true', () => {
    const m = catalogMatches('heading');
    expect(m.length).toBeGreaterThan(0);
    for (const x of m) {
      const plain = Object.keys(x).filter((k) => !['isContainer', 'isRootOnly'].includes(k));
      expect(plain.sort()).toEqual(['category', 'description', 'label', 'type']);
      if ('isContainer' in x) expect(x.isContainer).toBe(true);
    }
    expect(m.length).toBeLessThanOrEqual(8);
  });

  it('detail:true adds the AI hints', () => {
    const [x] = catalogMatches('heading', { detail: true });
    expect(Array.isArray(x.useWhen)).toBe(true);
    expect(Array.isArray(x.contentTips)).toBe(true);
  });
});

describe('traitsFor()', () => {
  it('lists control NAMES and says the undeclared note once', () => {
    const t = traitsFor('list-dataset') as {
      inspector: Array<{ groups: Array<{ controls: string[] }> }>;
      declared: Record<string, unknown>;
      undeclared_note: string;
      hints: { useWhen: string[] };
    };
    expect(typeof t.inspector[0].groups[0].controls[0]).toBe('string');
    expect(typeof t.undeclared_note).toBe('string');
    expect(Array.isArray(t.hints.useWhen)).toBe(true);
    expect(JSON.stringify(t).length).toBeLessThan(12_000); // was 74,190; what remains is hints and names
  });

  it('still describes one control in full', () => {
    const t = traitsFor('heading', 'font_size') as { control: string };
    expect(t.control).toBe('font_size');
  });

  it('names the tool to use on an unknown type', () => {
    expect(() => traitsFor('nope')).toThrow(/sb_catalog_search/);
  });
});
