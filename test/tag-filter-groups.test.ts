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
    // Each its own values unless the case says otherwise: identical values are a mirror.
    fids.forEach((id, i) =>
      Object.assign((doc.node(id) as unknown as { specials: Record<string, unknown> }).specials, {
        filterSource: 'tag',
        filterValues: [{ value: `v${i}`, label: `V${i}`, enabled: true }],
        ...filters[i],
      }),
    );
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

  it('a mirror — the same values on a mobile copy — shares the key on purpose', () => {
    const cpu = [{ value: 'ryzen 7 9700x', label: 'Ryzen 7 9700X', enabled: true }];
    const vga = [{ value: 'rtx 5070 12gb', label: 'RTX 5070 12GB', enabled: true }];
    expect(page({ filterGroupKey: 'cpu', filterValues: cpu }, { filterGroupKey: 'cpu', filterValues: cpu })).toHaveLength(0);
    expect(page({ filterValues: cpu }, { filterValues: vga })).toHaveLength(1);
  });
});
