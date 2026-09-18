import { describe, it, expect } from 'vitest';
import { soft, FORCE_HINT, type GuardOpts } from '../src/domains/site/guard.js';

const refuse = () => {
  throw new Error('sbuilder: nope');
};

describe('soft()', () => {
  it('rethrows with the force hint when not forced', () => {
    expect(() => soft({}, refuse)).toThrow('sbuilder: nope' + FORCE_HINT);
    expect(() => soft({ force: false }, refuse)).toThrow(FORCE_HINT);
  });

  // THE HINT IS ONLY TRUE FOR A CALLER THAT CAN PASS `force`. A builder called
  // with no guard at all sits behind a tool whose schema has no such argument,
  // so the hint would name an argument that is refused.
  it('carries no hint when no guard was supplied', () => {
    const msg = (() => { try { soft(undefined, refuse); } catch (e) { return (e as Error).message; } })();
    expect(msg).toBe('sbuilder: nope');
  });

  it('records even when force came with no array', () => {
    const g: GuardOpts = { force: true };
    expect(() => soft(g, refuse)).not.toThrow();
    expect(g.forced).toEqual(['sbuilder: nope']);
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
    expect(() => soft({}, inner)).toThrow('x' + FORCE_HINT);
    expect((() => { try { soft({}, inner); } catch (e) { return (e as Error).message; } })()).not.toMatch(new RegExp(FORCE_HINT.trim() + '.*' + FORCE_HINT.trim()));
  });
});
