import { describe, it, expect } from 'vitest';
import { sourceTokens } from '../src/domains/site/sourcetokens.js';
import type { Captured } from '../src/domains/site/importmap.js';

const section = (...children: Captured[]): Captured => ({ kind: 'section', children });

describe('sourceTokens — colours', () => {
  it('takes the FIRST heading and the FIRST body line, not an average', () => {
    const got = sourceTokens([
      section(
        { kind: 'heading', level: 1, text: 'A', sample: { color: 'rgb(179, 18, 58)' } },
        { kind: 'text', text: 'body', sample: { color: 'rgb(75, 85, 99)' } },
        { kind: 'heading', level: 2, text: 'B', sample: { color: 'rgb(0, 0, 0)' } },
      ),
    ]);
    expect(got.colors.heading).toBe('#b3123a');
    expect(got.colors.text).toBe('#4b5563');
  });

  it('takes the accent from the first PAINTED button, never an unpainted one', () => {
    // An unpainted link is navigation. Taking its fill would leave the accent
    // unset on every site whose first button is a nav link — the same reason
    // the importer already refuses to paint one.
    const got = sourceTokens([
      section(
        { kind: 'button', text: 'Trang chủ', variant: 'link', sample: {} },
        { kind: 'button', text: 'Mua ngay', sample: { backgroundColor: 'rgb(179, 18, 58)' } },
      ),
    ]);
    expect(got.colors.primary).toBe('#b3123a');
  });

  it('takes the MOST COMMON section background as the page ground', () => {
    // Not the first: a page often opens with a hero band that is not its ground.
    const got = sourceTokens([
      { kind: 'section', sample: { backgroundColor: 'rgb(17, 17, 17)' }, children: [] },
      { kind: 'section', sample: { backgroundColor: 'rgb(255, 250, 245)' }, children: [] },
      { kind: 'section', sample: { backgroundColor: 'rgb(255, 250, 245)' }, children: [] },
    ]);
    expect(got.colors.background).toBe('#fffaf5');
  });

  it('OMITS a role the source did not express rather than guessing one', () => {
    const got = sourceTokens([section({ kind: 'text', text: 'x', sample: { color: 'rgb(0,0,0)' } })]);
    expect(got.colors.heading).toBeUndefined();
    expect(got.colors.primary).toBeUndefined();
    expect('heading' in got.colors).toBe(false);
  });

  it('skips a translucent colour rather than flattening it', () => {
    const got = sourceTokens([
      section({ kind: 'heading', level: 1, text: 'A', sample: { color: 'rgba(179, 18, 58, 0.6)' } }),
    ]);
    expect(got.colors.heading).toBeUndefined();
  });

  // `muted` is the one role with no first-of-kind rule — it comes from
  // FREQUENCY instead, gated on differing from the `text` role already
  // chosen above. Every other role here is covered by a first-of-kind test;
  // this is muted's own.
  it('picks the SECOND-MOST-FREQUENT text colour as muted, when it differs from `text`', () => {
    const got = sourceTokens([
      section(
        { kind: 'text', text: 'a', sample: { color: 'rgb(75, 85, 99)' } },
        { kind: 'text', text: 'b', sample: { color: 'rgb(75, 85, 99)' } },
        { kind: 'text', text: 'c', sample: { color: 'rgb(156, 163, 175)' } },
      ),
    ]);
    expect(got.colors.text).toBe('#4b5563');
    expect(got.colors.muted).toBe('#9ca3af');
  });

  it('leaves muted absent when the source paints only one text colour', () => {
    const got = sourceTokens([
      section(
        { kind: 'text', text: 'a', sample: { color: 'rgb(75, 85, 99)' } },
        { kind: 'text', text: 'b', sample: { color: 'rgb(75, 85, 99)' } },
      ),
    ]);
    expect(got.colors.text).toBe('#4b5563');
    expect('muted' in got.colors).toBe(false);
  });
});

describe('sourceTokens — the type scale', () => {
  it('maps the largest heading to heading-1 and descends', () => {
    const got = sourceTokens([
      section(
        { kind: 'heading', level: 1, text: 'A', sample: { fontSize: '44px', fontWeight: '800' } },
        { kind: 'heading', level: 2, text: 'B', sample: { fontSize: '28px', fontWeight: '700' } },
        { kind: 'text', text: 'c', sample: { fontSize: '17px' } },
      ),
    ]);
    expect(got.textStyles['heading-1'].fontSize).toBe('44px');
    expect(got.textStyles['heading-1'].fontWeight).toBe('800');
    expect(got.textStyles['heading-2'].fontSize).toBe('28px');
    expect(got.textStyles['text-1'].fontSize).toBe('17px');
  });

  it('collapses two headings of the same size into ONE slot', () => {
    // A source with six heading levels that render at three sizes has three
    // type sizes, not six. Emitting six slots with duplicate values would
    // manufacture a scale the source does not have.
    const got = sourceTokens([
      section(
        { kind: 'heading', level: 1, text: 'A', sample: { fontSize: '32px' } },
        { kind: 'heading', level: 2, text: 'B', sample: { fontSize: '32px' } },
        { kind: 'heading', level: 3, text: 'C', sample: { fontSize: '20px' } },
      ),
    ]);
    expect(got.textStyles['heading-1'].fontSize).toBe('32px');
    expect(got.textStyles['heading-2'].fontSize).toBe('20px');
    expect(got.textStyles['heading-3']).toBeUndefined();
  });

  it('never emits more than the theme has slots for', () => {
    const headings: Captured[] = [];
    for (let i = 0; i < 12; i += 1) {
      headings.push({ kind: 'heading', level: 1, text: `h${i}`, sample: { fontSize: `${60 - i * 3}px` } });
    }
    const got = sourceTokens([section(...headings)]);
    expect(Object.keys(got.textStyles).filter((s) => s.startsWith('heading-')).length).toBeLessThanOrEqual(6);
  });
});

describe('sourceTokens — radii and spacings', () => {
  it('returns them sorted and deduplicated, for P3 rather than for the theme', () => {
    const got = sourceTokens([
      section(
        { kind: 'button', text: 'a', sample: { backgroundColor: 'rgb(1,1,1)', borderRadius: '8px' } },
        { kind: 'button', text: 'b', sample: { backgroundColor: 'rgb(1,1,1)', borderRadius: '8px' } },
        { kind: 'button', text: 'c', sample: { backgroundColor: 'rgb(1,1,1)', borderRadius: '999px' } },
      ),
    ]);
    expect(got.radii).toEqual(['8px', '999px']);
  });

  it('answers empty structures for an empty page rather than throwing', () => {
    const got = sourceTokens([]);
    expect(got.colors).toEqual({});
    expect(got.textStyles).toEqual({});
    expect(got.radii).toEqual([]);
  });
});
