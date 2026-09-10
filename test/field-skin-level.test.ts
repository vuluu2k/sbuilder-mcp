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
    for (const [node, keys] of Object.entries(FIELD_SKIN_BY_NODE)) {
      expect(keys, node).toContain('fieldReqColor');
    }
  });
});
