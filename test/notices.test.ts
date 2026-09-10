import { describe, it, expect } from 'vitest';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

describe('Notices.once()', () => {
  it('returns the text the first time and undefined after', () => {
    const n = new Notices();
    expect(n.once('review', 'FIX THESE')).toBe('FIX THESE');
    expect(n.once('review', 'FIX THESE')).toBeUndefined();
  });

  it('keys are independent', () => {
    const n = new Notices();
    n.once('a', 'x');
    expect(n.once('b', 'y')).toBe('y');
  });

  it('reset() lets a directive be said again', () => {
    const n = new Notices();
    n.once('a', 'x');
    n.reset();
    expect(n.once('a', 'x')).toBe('x');
  });
});

/**
 * MEASURED on this repo's own storefront: repairing every button on a page in
 * one batch returned ten copies of the same 300-character paragraph. The type is
 * the whole content of the note, so a second copy tells the caller nothing.
 */
describe('the hover-home note', () => {
  it('is said once per element type, not once per node', async () => {
    const { Notices } = await import('../src/mcp/notices.js');
    const { hoverRoutingNote } = await import('../src/domains/site/hover.js');
    const notices = new Notices();
    const say = (type: string) =>
      notices.once(`hover-home:${type}`, hoverRoutingNote(type) as string);

    expect(say('button')).toMatch(/stateHover/);
    // Nine more buttons in the same batch, and the same button next time.
    for (let i = 0; i < 9; i += 1) expect(say('button')).toBeUndefined();
    // A DIFFERENT type still gets its own, because it says something else.
    expect(say('product-image-list')).toMatch(/CONFIG rather than its STYLE/);
    expect(say('product-image-list')).toBeUndefined();
  });
});
