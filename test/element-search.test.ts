import { describe, it, expect } from 'vitest';
import { catalogMatches, formTemplateMatches, searchWords, traitsFor } from '../src/catalog/element-search.js';

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
    // 16,000 since the platform took the entrance animation from 4 effects to
    // 46 and the object from five keys to ten. Was 74,190 before the diet; what
    // remains is hints, control names, the ways config.animation fails
    // silently, and the 46 type names themselves — which are the one part an
    // agent cannot author an animation without. See token-budget.test.ts for
    // why this moved and what was trimmed instead.
    expect(JSON.stringify(t).length).toBeLessThan(16_000);
  });

  it('still describes one control in full', () => {
    const t = traitsFor('heading', 'font_size') as { control: string };
    expect(t.control).toBe('font_size');
  });

  it('names the tool to use on an unknown type', () => {
    expect(() => traitsFor('nope')).toThrow(/sb_catalog_search/);
  });
});

/**
 * VIETNAMESE QUERIES FOUND NOTHING. The hints are English, and `words()` left
 * `đ` whole (it is a letter, not a combining mark), so "đặt phòng" became
 * ['', 'at', 'phong']. The element's own Vietnamese DEFAULT COPY is now a
 * low-weight signal, and the platform's form TEMPLATES answer as templates.
 */
describe('Vietnamese search', () => {
  const types = (q: string) => catalogMatches(q).map((m) => m.type);
  const templates = (q: string) => formTemplateMatches(q).map((t) => t.template);

  it('folds đ to d', () => {
    expect(searchWords('Đặt phòng')).toEqual(['dat', 'phong']);
  });

  it('finds elements by their default copy', () => {
    expect(types('chọn giờ')).toContain('form-timeslot');
    expect(types('chọn ngày')).toContain('form-date');
    expect(types('số lượng vé')).toContain('form-number');
  });

  it('finds form templates by their title and field labels, pointing at sb_store', () => {
    expect(templates('đặt lịch')[0]).toBe('booking');
    expect(templates('ngày nhận phòng')[0]).toBe('stay');
    expect(templates('booking')).toContain('booking');
    expect(formTemplateMatches('đặt lịch')[0].use).toBe('sb_store action:"form" template:"booking"');
    // A query naming no template asks for no template.
    expect(templates('heading')).toEqual([]);
    expect(templates('email')).toEqual([]);
  });

  it('English search is unchanged', () => {
    expect(types('heading')[0]).toBe('heading');
  });
});

describe('sb_catalog_search answers with form templates too', () => {
  it('"đặt lịch" names the booking template and the call that seeds it', async () => {
    const { fakePlatform } = await import('./helpers/platform.js');
    const { call, close } = await fakePlatform().connect();
    const out = await call('sb_catalog_search', { query: 'đặt lịch' });
    expect(out.text).toContain('sb_store action:\\"form\\" template:\\"booking\\"');
    const plain = await call('sb_catalog_search', { query: 'heading' });
    expect(plain.text).not.toContain('template');
    await close();
  });
});

describe('templates and elements in one ranking', () => {
  it('a template whose title holds the query leads; an exact element type always wins', async () => {
    const { catalogMatches, searchWithTemplates } = await import('../src/catalog/element-search.js');
    const lead = (q: string) => {
      const first = searchWithTemplates(q, catalogMatches(q, { limit: 5 }))[0] as { type?: string; template?: string };
      return first.type ?? `[${first.template}]`;
    };
    expect(lead('đặt lịch')).toBe('[booking]');
    expect(lead('booking')).toBe('[booking]');
    expect(lead('list')).toBe('list');
    expect(lead('form-select')).toBe('form-select');
  });
});
