import { describe, it, expect } from 'vitest';
import { emptyDoc } from './helpers/doc.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';

/** TTG, 2026-10-30: CPU/VGA/RAM tag filters shared `f.tag=` and one match mode. */
describe('tag_filters_share_key', () => {
  const page = (...filters: Array<Record<string, unknown>>) => {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', {
      type: 'flex-section',
      children: filters.map(() => ({ type: 'filter-checkbox' })),
    });
    doc.apply(patches);
    const fids = ids.filter((i) => doc.node(i).data.type === 'filter-checkbox');
    fids.forEach((id, i) => Object.assign((doc.node(id) as unknown as { specials: Record<string, unknown> }).specials, { filterSource: 'tag', ...filters[i] }));
    return reviewDesign(doc, {}).filter((f) => f.code === 'tag_filters_share_key');
  };

  it('flags a second tag filter on the same key, and passes distinct groups', () => {
    expect(page({}, {})).toHaveLength(1);
    expect(page({ filterGroupKey: 'cpu' }, { filterGroupKey: 'cpu' })).toHaveLength(1);
    expect(page({ filterGroupKey: 'cpu' }, { filterGroupKey: 'vga' }, {})).toHaveLength(0);
  });

  it('an invalid group is the bare key; event filters and disjoint targets do not collide', () => {
    expect(page({ filterGroupKey: 'CPU' }, {})).toHaveLength(1);
    expect(page({ filterBehavior: 'event' }, {})).toHaveLength(0);
    expect(page({ filterTargets: ['li_a'] }, { filterTargets: ['li_b'] })).toHaveLength(0);
    expect(page({ filterTargets: ['li_a'] }, {})).toHaveLength(1);
  });
});
