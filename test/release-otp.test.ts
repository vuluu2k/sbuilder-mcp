import { describe, it, expect } from 'vitest';
// @ts-expect-error — a plain .mjs script, imported for its two pure helpers.
import { needsOtp, publishWithOtp } from '../scripts/release.mjs';

/**
 * The publish is the one step of a release that cannot be undone, and a
 * forgotten one-time password should cost a prompt — not a failed release with
 * the version bump already committed and tagged.
 */

const EOTP =
  'npm error code EOTP\nnpm error This operation requires a one-time password from your authenticator.\n';

describe('needsOtp()', () => {
  it('matches the CODE npm prints, which is what stays stable', () => {
    expect(needsOtp(EOTP)).toBe(true);
    expect(needsOtp('npm error code E403 Forbidden')).toBe(false);
    expect(needsOtp('')).toBe(false);
  });
});

describe('publishWithOtp()', () => {
  const silent = () => {};

  it('publishes straight away when npm is happy', async () => {
    const seen: string[][] = [];
    const ok = await publishWithOtp(undefined, {
      run: (a: string[]) => (seen.push(a), { status: 0, stderr: '' }),
      ask: async () => '',
      log: silent,
    });
    expect(ok).toBe(true);
    expect(seen.length).toBe(1);
    expect(seen[0]).not.toContain(expect.stringContaining('--otp'));
  });

  it('ASKS for the password and retries, instead of dying on it', async () => {
    const seen: string[][] = [];
    let asked = 0;
    const ok = await publishWithOtp(undefined, {
      run: (a: string[]) => {
        seen.push(a);
        return a.includes('--otp=246810') ? { status: 0, stderr: '' } : { status: 1, stderr: EOTP };
      },
      ask: async () => (asked++, '246810'),
      log: silent,
    });
    expect(ok).toBe(true);
    expect(asked).toBe(1);
    expect(seen[1]).toContain('--otp=246810');
  });

  it('survives a mistyped code and asks again', async () => {
    const codes = ['000000', '111111', '246810'];
    let i = 0;
    const ok = await publishWithOtp(undefined, {
      run: (a: string[]) =>
        a.includes('--otp=246810') ? { status: 0, stderr: '' } : { status: 1, stderr: EOTP },
      ask: async () => codes[i++],
      log: silent,
    });
    expect(ok).toBe(true);
    expect(i).toBe(3);
  });

  it('stops after three asks rather than looping forever', async () => {
    let tries = 0;
    let asked = 0;
    const ok = await publishWithOtp(undefined, {
      run: () => (tries++, { status: 1, stderr: EOTP }),
      ask: async () => (asked++, '000000'),
      log: silent,
    });
    expect(ok).toBe(false);
    // Three asks, and every one of them was actually tried — the first attempt
    // needs no code, then one publish per code entered.
    expect(asked).toBe(3);
    expect(tries).toBe(4);
  });

  it('does not prompt for a failure that has nothing to do with a password', async () => {
    let asked = 0;
    const ok = await publishWithOtp(undefined, {
      run: () => ({ status: 1, stderr: 'npm error 403 You do not have permission to publish' }),
      ask: async () => (asked++, '000000'),
      log: silent,
    });
    expect(ok).toBe(false);
    expect(asked).toBe(0);
  });

  it('uses a code passed on the command line without asking', async () => {
    let asked = 0;
    const ok = await publishWithOtp('246810', {
      run: (a: string[]) => (a.includes('--otp=246810') ? { status: 0, stderr: '' } : { status: 1, stderr: EOTP }),
      ask: async () => (asked++, ''),
      log: silent,
    });
    expect(ok).toBe(true);
    expect(asked).toBe(0);
  });
});
