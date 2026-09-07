import { describe, it, expect } from 'vitest';
import { projectList, PAGE_FIELDS, TEMPLATE_FIELDS } from '../src/tools/project.js';

describe('projectList()', () => {
  it('keeps only the whitelisted fields and the total', () => {
    const raw = {
      pages: [{ id: 'p1', name: 'Home', slug: '', settings: { seo: 'x'.repeat(500) }, status: 'published' }],
      total: 1,
    };
    expect(projectList(raw, 'pages', PAGE_FIELDS)).toEqual({
      pages: [{ id: 'p1', name: 'Home', slug: '', status: 'published' }],
      total: 1,
    });
  });

  it('drops a template document — that is the heavy part', () => {
    const raw = { sectionTemplates: [{ id: 't1', name: 'Hero', document: { nodes: {} } }], total: 1 };
    const out = projectList(raw, 'sectionTemplates', TEMPLATE_FIELDS) as {
      sectionTemplates: Array<Record<string, unknown>>;
    };
    expect('document' in out.sectionTemplates[0]).toBe(false);
    expect(out.sectionTemplates[0].name).toBe('Hero');
  });

  it('returns the response untouched when the shape is not the expected list', () => {
    expect(projectList({ pages: 'nope' }, 'pages', PAGE_FIELDS)).toEqual({ pages: 'nope' });
    expect(projectList({ pages: [1, 2] }, 'pages', PAGE_FIELDS)).toEqual({ pages: [1, 2] });
    expect(projectList(null, 'pages', PAGE_FIELDS)).toBeNull();
  });
});
