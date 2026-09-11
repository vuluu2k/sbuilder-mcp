import { describe, it, expect } from 'vitest';

/**
 * THE GUARD ON THE GUARD — a test that always runs, about the tests that do not.
 *
 * 47 tests across 8 describe blocks are gated behind `SB_BROWSER_TEST=1`,
 * deliberately: they launch the system Chrome, and a machine without one must
 * FAIL LOUDLY when `sb_look` is used rather than have a suite skip quietly and
 * read as green. That gate is right. What it costs is that forgetting the flag
 * looks exactly like passing.
 *
 * THE COST WAS PAID. `capture()` dropped every `<video>` carrying a poster — it
 * measures its poster before any media loads, so an unresolved one reads as a
 * zero box and the walk called it hidden — and the defect sat on `main` with the
 * test that names that exact case green by absence. It was found only by finally
 * running the suite by hand. Those 47 tests are the whole of `src/vision/**`,
 * which is the half of this server that cannot be checked by reading.
 *
 * So CI now runs them, and this refuses the one way that can go quiet again:
 * the job declares `SB_BROWSER_REQUIRED`, and a run carrying that intent MUST
 * actually have the browser suite enabled. Without this the failure simply
 * moves — `test:browser` loses its env var in some later edit, every gated
 * describe skips, vitest reports all green, and the job passes having checked
 * nothing.
 *
 * It is deliberately NOT "CI implies browser tests": the ordinary `gate` job
 * runs `npm test` without Chrome on purpose, and that must stay green.
 */
describe('the browser suite cannot be skipped where it was demanded', () => {
  it('runs the gated tests whenever a caller says it requires them', () => {
    if (!process.env.SB_BROWSER_REQUIRED) return; // not that kind of run
    expect(
      process.env.SB_BROWSER_TEST,
      'SB_BROWSER_REQUIRED is set, so this run exists to exercise Chrome — but ' +
        'SB_BROWSER_TEST is not "1", so every browser describe just skipped and ' +
        'this run checked none of src/vision/**. Run `npm run test:browser`.',
    ).toBe('1');
  });
});
