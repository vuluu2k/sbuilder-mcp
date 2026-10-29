import { describe, it, expect } from 'vitest';
import { emptyDoc } from './helpers/doc.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';

/** TTG, 2026-10-30: the category page's sort select published an empty panel. */
describe('filter_no_rows', () => {
  const codes = (type: string, specials: Record<string, unknown>) => {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', { type: 'flex-section', children: [{ type }] });
    doc.apply(patches);
    const id = ids.find((i) => doc.node(i).data.type === type)!;
    Object.assign((doc.node(id) as unknown as { specials: Record<string, unknown> }).specials, specials);
    return reviewDesign(doc, {}).filter((f) => f.nodeId === id).map((f) => f.code);
  };

  it('flags a sort or catalogue control with no enabled rows', () => {
    expect(codes('select', { filterSource: 'sort', filterValues: [] })).toContain('filter_no_rows');
    expect(codes('filter-checkbox', { filterSource: 'brand', filterValues: [{ value: 'a', label: 'A', enabled: false }] })).toContain('filter_no_rows');
  });

  it('passes rows, a price filter (derived from ranges) and a value mode that follows the page', () => {
    expect(codes('select', { filterSource: 'sort', filterValues: [{ value: 'newest', label: 'Mới nhất', enabled: true }] })).not.toContain('filter_no_rows');
    expect(codes('filter-checkbox', { filterSource: 'price', filterValues: [], filterRanges: [{ fromCents: 0, toCents: 100 }] })).not.toContain('filter_no_rows');
    expect(codes('filter-checkbox', { filterSource: 'category', filterValueMode: 'auto', filterValues: [] })).not.toContain('filter_no_rows');
  });
});

describe('filter_no_rows — the verifier\'s edges', () => {
  const codes = (type: string, specials: Record<string, unknown>) => {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', { type: 'flex-section', children: [{ type }] });
    doc.apply(patches);
    const id = ids.find((i) => doc.node(i).data.type === type)!;
    const sp = (doc.node(id) as unknown as { specials: Record<string, unknown> }).specials;
    for (const k of Object.keys(sp)) if (k.startsWith('filter')) delete sp[k];
    Object.assign(sp, specials);
    return reviewDesign(doc, {}).filter((f) => f.nodeId === id).map((f) => f.code);
  };

  it('a select with no filterSource publishes as a sort and is judged as one', () => {
    expect(codes('select', { filterValues: [] })).toContain('filter_no_rows');
  });

  it('a price filter with neither ranges nor rows renders nothing and is flagged', () => {
    expect(codes('filter-checkbox', { filterSource: 'price' })).toContain('filter_no_rows');
    expect(codes('filter-checkbox', { filterSource: 'price', filterRanges: [{ fromCents: 0, toCents: 100 }] })).not.toContain('filter_no_rows');
  });
});
