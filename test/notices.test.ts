import { describe, it, expect } from 'vitest';
import { Notices } from '../src/mcp/notices.js';

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
