import { describe, it, expect } from 'vitest';
import { compareBaseline, type Baseline } from '../src/domains/site/scoreboard.js';

const at = (visual: number, content: number, structure: number): Baseline => ({
  generated: '2026-09-12T00:00:00.000Z',
  scores: [{ url: 'https://example.com/', width: 1440, visual, content, structure, mode: 'full' }],
});

describe('compareBaseline', () => {
  it('says nothing when nothing moved', () => {
    const got = compareBaseline(at(40, 80, 10), at(40, 80, 10));
    expect(got.regressions).toEqual([]);
    expect(got.improvements).toEqual([]);
  });

  it('READS EACH METRIC IN ITS OWN DIRECTION', () => {
    // visual and structure are distances (lower is better); content is
    // coverage (higher is better). Treating them alike would call this run —
    // which improved on all three — a regression on two of them.
    const got = compareBaseline(at(40, 70, 20), at(25, 85, 12));
    expect(got.regressions).toEqual([]);
    expect(got.improvements.map((m) => m.metric).sort()).toEqual(['content', 'structure', 'visual']);
  });

  it('reports a real regression', () => {
    const got = compareBaseline(at(25, 85, 12), at(41, 85, 12));
    expect(got.regressions).toHaveLength(1);
    expect(got.regressions[0].metric).toBe('visual');
    expect(got.regressions[0].was).toBe(25);
    expect(got.regressions[0].now).toBe(41);
  });

  it('ignores movement inside the tolerance', () => {
    // A shot of a live site is not deterministic to the pixel — a carousel is
    // on a different slide. Without a tolerance every run reports noise and the
    // scoreboard stops being read.
    const got = compareBaseline(at(25, 85, 12), at(26, 84.5, 12.4));
    expect(got.regressions).toEqual([]);
    expect(got.improvements).toEqual([]);
  });

  it('names a page that appeared and one that went away', () => {
    const prev = at(25, 85, 12);
    const next: Baseline = {
      generated: '2026-09-13T00:00:00.000Z',
      scores: [{ url: 'https://other.test/', width: 1440, visual: 30, content: 70, structure: 15, mode: 'full' }],
    };
    const got = compareBaseline(prev, next);
    expect(got.added).toEqual(['https://other.test/ @1440']);
    expect(got.removed).toEqual(['https://example.com/ @1440']);
  });

  it('compares content and structure cleanly on a row with no visual, rather than throwing or reporting a phantom move', () => {
    // An offline row never rendered anything, so it carries no `visual` at
    // all — not a zero, which would read as a perfect pixel match against
    // whatever the other side happened to measure.
    const prev: Baseline = {
      generated: '2026-09-12T00:00:00.000Z',
      scores: [{ url: 'https://example.com/', width: 1440, content: 85, structure: 12, mode: 'offline' }],
    };
    const next: Baseline = {
      generated: '2026-09-13T00:00:00.000Z',
      scores: [{ url: 'https://example.com/', width: 1440, content: 70, structure: 12, mode: 'offline' }],
    };
    const got = compareBaseline(prev, next);
    // content moved (85 -> 70, worse — coverage dropped) and structure did
    // not; visual is absent on both sides and must not appear as either.
    expect(got.regressions).toHaveLength(1);
    expect(got.regressions[0].metric).toBe('content');
    expect(got.improvements).toEqual([]);
  });
});
