import { describe, it, expect } from 'vitest';
import { soft, FORCE_HINT, type GuardOpts } from '../src/domains/site/guard.js';

const refuse = () => {
  throw new Error('sbuilder: nope');
};

describe('soft()', () => {
  it('rethrows with the force hint when not forced', () => {
    expect(() => soft(undefined, refuse)).toThrow('sbuilder: nope' + FORCE_HINT);
    expect(() => soft({ force: false }, refuse)).toThrow(FORCE_HINT);
  });

  it('records instead of throwing when forced', () => {
    const g: GuardOpts = { force: true, forced: [] };
    expect(() => soft(g, refuse)).not.toThrow();
    expect(g.forced).toEqual(['sbuilder: nope']);
  });

  it('is silent when the check passes', () => {
    const g: GuardOpts = { force: true, forced: [] };
    soft(g, () => {});
    expect(g.forced).toEqual([]);
  });

  it('does not add the hint twice', () => {
    const inner = () => {
      throw new Error('x' + FORCE_HINT);
    };
    expect(() => soft(undefined, inner)).toThrow('x' + FORCE_HINT);
    expect((() => { try { soft(undefined, inner); } catch (e) { return (e as Error).message; } })()).not.toMatch(new RegExp(FORCE_HINT.trim() + '.*' + FORCE_HINT.trim()));
  });
});
