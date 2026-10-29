import { describe, it, expect } from 'vitest';
import {
  nodesReading,
  readsSkinKey,
  skinLevelNote,
} from '../src/domains/site/fieldskin.js';
import { FIELD_SKIN_BY_NODE } from '../src/catalog/fieldskin.generated.js';

/**
 * A knob written on a node whose css.go does not name its group is stored,
 * saved, published and rendered NOWHERE. CLAUDE.md carried this as prose — "so
 * payCard* written on the form is stored and rendered nowhere" — over a 55-key
 * table across 11 nodes.
 */
describe('a field-skin knob on the wrong node', () => {
  it('makes the documented case data instead of prose', () => {
    expect(readsSkinKey('form', 'fieldBg')).toBe(true);
    expect(readsSkinKey('form', 'payCardBg')).toBe(false);
    expect(readsSkinKey('form-payment', 'payCardBg')).toBe(true);
  });

  // The fix half: naming the node that DOES read it is what turns a warning
  // into something the caller can act on.
  it('names the node that would render it', () => {
    expect(nodesReading('payCardBg')).toEqual(['form-payment']);
    const n = skinLevelNote('form', ['payCardBg'])!;
    expect(n).toMatch(/read by form-payment/);
    expect(n).toMatch(/read by nothing/);
    expect(n).toMatch(/FORM DOCUMENT/);
  });

  it('says nothing when the key belongs on the node', () => {
    expect(skinLevelNote('form', ['fieldBg', 'fieldRadius'])).toBeNull();
    expect(skinLevelNote('form-payment', ['payCardBg'])).toBeNull();
  });

  // An unknown config key is not this module's business — claiming it would put
  // a false positive on every ordinary write.
  it('ignores a key that is not a skin knob anywhere', () => {
    expect(skinLevelNote('form', ['gap', 'iconSize'])).toBeNull();
    expect(skinLevelNote('heading', ['anything'])).toBeNull();
  });

  it('covers every form node the renderer skins', () => {
    expect(Object.keys(FIELD_SKIN_BY_NODE)).toContain('form');
    expect(Object.keys(FIELD_SKIN_BY_NODE)).toContain('form-radio');
    expect(Object.keys(FIELD_SKIN_BY_NODE).length).toBeGreaterThanOrEqual(10);
    // The chrome trio is shared by every field, which is what makes one edit on
    // the form reach them all.
    // search-input is skinned too (its suggestion panel) but is not a field.
    for (const [node, keys] of Object.entries(FIELD_SKIN_BY_NODE)) {
      if (!node.startsWith('form')) continue;
      expect(keys, node).toContain('fieldReqColor');
    }
  });
});

/**
 * GAP #25 (TTG, 2026-10-29): `sb_traits_for form-payment control:"pay_card_skin"`
 * answered `writes: null` + "the platform does not declare", while the payCard*
 * keys it writes were already generated. Each skin panel is one FieldSkinRows
 * widget over one knob table, read at codegen into FIELD_SKIN_BY_CONTROL.
 */
describe('sb_traits_for describes the skin controls', () => {
  it('pay_card_skin writes the payCard* card table on config', async () => {
    const { traitsFor } = await import('../src/catalog/element-search.js');
    const t = traitsFor('form-payment', 'pay_card_skin') as { writes: Array<{ target: string; writeKey: string }> };
    expect(t.writes).toContainEqual({ target: 'config', writeKey: 'payCardBg' });
    expect(t.writes.map((w) => w.writeKey)).not.toContain('payCardAccent'); // pay_state_skin's
    const s = traitsFor('form-payment', 'pay_state_skin') as { writes: Array<{ writeKey: string }> };
    expect(s.writes.map((w) => w.writeKey)).toContain('payCardSelectedBg');
  });

  it('lists them under declared', async () => {
    const { traitsFor } = await import('../src/catalog/element-search.js');
    const t = traitsFor('form-payment') as { declared: Record<string, unknown> };
    expect(Object.keys(t.declared)).toEqual(expect.arrayContaining(['pay_card_skin', 'pay_marker_skin']));
  });
});
