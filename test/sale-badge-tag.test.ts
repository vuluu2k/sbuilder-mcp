/**
 * sale-badge TAG MODE (web_builder c96ca32d8): `specials.mode: "tag"` shows
 * `specials.text` only when the bound product carries `specials.tag`, read
 * from `specials.boundTags` ← product.tags. The editor adds that binding on
 * drop (datasetBindings); a badge minted here without it renders nothing.
 */
import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { splitBaseOnly } from '../src/domains/site/baseonly.js';
import { writeCheck } from '../src/domains/site/writecheck.js';
import { bindNode } from '../src/tools/live.js';

function badge(): { d: PageDoc; id: string } {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const { patches, ids } = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'sale-badge' }] });
  d.apply(patches);
  return { d, id: ids[1] };
}

describe('sale-badge tag mode', () => {
  it('sb_add seeds bind-tags beside the price bindings, as the editor does on drop', () => {
    const { d, id } = badge();
    const b = d.node(id).bindings as Array<{ id: string; source: string; field: string }>;
    // Liveness: the seeding path ran at all (the price pair predates tag mode).
    expect(b.map((x) => x.field), 'price bindings seeded').toContain('specials.boundPriceCents');
    expect(b, 'bind-tags seeded').toContainEqual({ id: 'bind-tags', source: 'product.tags', field: 'specials.boundTags' });
  });

  it('sb_set specials.mode:"tag" is a known value; an invented one still warns', () => {
    expect(writeCheck('sale-badge', 'specials', { mode: 'tag', tag: 'new', text: 'NEW' })).toEqual([]);
    const [bad] = writeCheck('sale-badge', 'specials', { mode: 'tagged' });
    expect(bad?.note.code, 'the vocabulary is still checked').toBe('unknown_value');
  });

  it('sb_bind product.tags → specials.boundTags is allowed without force; an unbindable field is not', () => {
    const { d, id } = badge();
    expect(() => bindNode(d, id, 'product.tags', 'specials.boundTags')).not.toThrow();
    expect(() => bindNode(d, id, 'product.tags', 'specials.boundNothing'), 'liveness: the field check runs').toThrow(/a sale-badge renders a binding only into .*specials.boundTags/);
  });
});

describe('product-variants showAttributes', () => {
  it('config.showAttributes is a key the element reads, and routed to base', () => {
    expect(writeCheck('product-variants', 'config', { showAttributes: ['Color'] })).toEqual([]);
    expect(writeCheck('product-variants', 'config', { showAttributez: ['Color'] })[0]?.note.code, 'liveness').toBe('unknown_key');
    expect(splitBaseOnly('product-variants', { showAttributes: ['Color'] }, 'mobile').base).toEqual({ showAttributes: ['Color'] });
  });
});
