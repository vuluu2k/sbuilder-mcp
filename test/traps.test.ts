import { describe, it, expect } from 'vitest';
import { bandOf, checkBandOrder, isGlobal, globalWarning, isIdentityKey } from '../src/domains/site/traps.js';
import type { DocLike } from '../src/core/tree.js';

function n(id: string, kids: string[] = [], specials: Record<string, unknown> = {}) {
  return { id, data: { type: 'flex-section', parent: 'rt', nodes: kids }, specials };
}

function docWith(rootKids: string[], nodes: Record<string, ReturnType<typeof n>>): DocLike {
  return {
    schema_version: 2,
    root_node_id: 'rt',
    nodes: { rt: { id: 'rt', data: { type: 'root', parent: null, nodes: rootKids }, specials: {} }, ...nodes },
  };
}

describe('bandOf()', () => {
  it('puts an unstamped section in the middle', () => {
    expect(bandOf(docWith(['a'], { a: n('a') }), 'a')).toBe('middle');
  });

  it('reads the band off a global stamp', () => {
    const d = docWith(['h', 'f'], {
      h: n('h', [], { globalId: 'g1', globalKind: 'header' }),
      f: n('f', [], { globalId: 'g2', globalKind: 'footer' }),
    });
    expect(bandOf(d, 'h')).toBe('header');
    expect(bandOf(d, 'f')).toBe('footer');
  });

  it('treats an unknown global kind as middle rather than throwing', () => {
    const d = docWith(['x'], { x: n('x', [], { globalId: 'g', globalKind: 'nonsense' }) });
    expect(bandOf(d, 'x')).toBe('middle');
  });
});

describe('checkBandOrder()', () => {
  it('accepts header, middle, footer', () => {
    const d = docWith(['h', 'm', 'f'], {
      h: n('h', [], { globalId: 'g1', globalKind: 'header' }),
      m: n('m'),
      f: n('f', [], { globalId: 'g2', globalKind: 'footer' }),
    });
    expect(checkBandOrder(d)).toBeNull();
  });

  it('rejects a section above the header - that header is no longer a header', () => {
    const d = docWith(['m', 'h'], { m: n('m'), h: n('h', [], { globalId: 'g1', globalKind: 'header' }) });
    expect(checkBandOrder(d)).toMatch(/header/i);
  });

  it('rejects a section below the footer', () => {
    const d = docWith(['f', 'm'], { f: n('f', [], { globalId: 'g2', globalKind: 'footer' }), m: n('m') });
    expect(checkBandOrder(d)).toMatch(/footer/i);
  });

  it('ignores overlays - the platform strips them before it checks', () => {
    const d = docWith(['h', 'm', 'f', 'cart'], {
      h: n('h', [], { globalId: 'g1', globalKind: 'header' }),
      m: n('m'),
      f: n('f', [], { globalId: 'g2', globalKind: 'footer' }),
      cart: n('cart', [], { overlayId: 'ov_1' }),
    });
    expect(checkBandOrder(d)).toBeNull();
  });

  it('accepts an empty page', () => {
    expect(checkBandOrder(docWith([], {}))).toBeNull();
  });
});

describe('isGlobal() / globalWarning()', () => {
  it('detects a stamped master and warns that edits cascade', () => {
    const d = docWith(['h'], { h: n('h', [], { globalId: 'g1', globalKind: 'header' }) });
    expect(isGlobal(d, 'h')).toBe(true);
    expect(globalWarning(d, 'h')).toMatch(/every page/i);
  });

  it('says nothing about an ordinary section', () => {
    const d = docWith(['a'], { a: n('a') });
    expect(isGlobal(d, 'a')).toBe(false);
    expect(globalWarning(d, 'a')).toBeNull();
  });
});

describe('isIdentityKey()', () => {
  it('names the keys that legitimately live at base', () => {
    expect(isIdentityKey('htmlTag')).toBe(true);
    expect(isIdentityKey('kind')).toBe(true);
  });

  it('refuses a visual quantity', () => {
    expect(isIdentityKey('gap')).toBe(false);
    expect(isIdentityKey('width')).toBe(false);
    expect(isIdentityKey('backgroundColor')).toBe(false);
  });
});
