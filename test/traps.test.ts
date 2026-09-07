import { describe, it, expect } from 'vitest';
import { bandOf, checkBandOrder, isGlobal, globalWarning, isIdentityKey } from '../src/domains/site/traps.js';
import { appBlockRoot, SPEC_APP_BLOCK_ID, type DocLike } from '../src/core/tree.js';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree, setKeys, removeNode, moveNode, duplicateNode } from '../src/domains/site/builder.js';
import { bindNode } from '../src/tools/live.js';
import { reviewDesign } from '../src/domains/site/review.js';

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

/**
 * Trap 5. A marketplace app contributes a subtree; the document stores ONE
 * reference node, and on save the platform reduces the composed block back to
 * it. An edit inside is stored nowhere and reported nowhere.
 */
function withAppBlock() {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const first = addSubtree(d, 'ROOT', {
    type: 'flex-section',
    children: [
      { type: 'flex-block', specials: { [SPEC_APP_BLOCK_ID]: 'inst_1/hero' }, children: [{ type: 'heading' }] },
    ],
  });
  d.apply(first.patches);
  d.apply(addSubtree(d, 'ROOT', { type: 'flex-section' }).patches);
  const [section, block, inner] = first.ids;
  return { d, section, block, inner };
}

describe('trap 5: app blocks', () => {
  it('appBlockRoot() finds the composed block from any node inside it', () => {
    const { d, block, inner, section } = withAppBlock();
    expect(appBlockRoot(d.doc, inner)).toBe(block);
    expect(appBlockRoot(d.doc, block)).toBe(block);
    expect(appBlockRoot(d.doc, section)).toBeNull();
  });

  it('the outline flags the block root app:true', () => {
    const { d, block } = withAppBlock();
    const kids = d.outline({ depth: 2 })[0].kids!;
    expect(kids.find((k) => k.id === block)?.app).toBe(true);
  });

  it('refuses every write INSIDE a block - the save reduces it to the reference', () => {
    const { d, inner, block } = withAppBlock();
    expect(() => setKeys(d, inner, { text: 'x' }, { namespace: 'specials', base: true })).toThrow(/app block/i);
    expect(() => addSubtree(d, block, { type: 'heading' })).toThrow(/app block/i);
    expect(() => addSubtree(d, inner, { type: 'heading' })).toThrow(/app block/i);
    expect(() => removeNode(d, inner)).toThrow(/app block/i);
    expect(() => duplicateNode(d, inner)).toThrow(/app block/i);
    expect(() => bindNode(d, inner, 'product.title', 'specials.text')).toThrow(/app block/i);
    const other = d.outline()[1].id;
    expect(() => moveNode(d, other, block, 0)).toThrow(/app block/i);
    expect(() => moveNode(d, inner, other, 0)).toThrow(/app block/i);
  });

  it('allows removing or moving the block root itself - that IS the reference', () => {
    const { d, block } = withAppBlock();
    const other = d.outline()[1].id;
    expect(() => removeNode(d, block)).not.toThrow();
    expect(() => moveNode(d, block, other, 0)).not.toThrow();
    expect(() => setKeys(d, block, { appBlockValues: { title: 'x' } }, { namespace: 'specials' })).not.toThrow();
  });

  it("review skips a block interior - its placeholders are the app's", () => {
    const { d, inner } = withAppBlock();
    expect(reviewDesign(d).some((f) => f.nodeId === inner)).toBe(false);
  });
});

describe('trap 5: duplicating over a block', () => {
  it('refuses to duplicate a section that contains an app block', () => {
    const { d, section } = withAppBlock();
    expect(() => duplicateNode(d, section)).toThrow(/app block/i);
  });
});
