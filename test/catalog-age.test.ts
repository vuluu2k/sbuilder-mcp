import { describe, it, expect } from 'vitest';
import { catalogAge } from '../src/tools/session.js';
import { PLATFORM_SOURCE } from '../src/catalog/source.generated.js';

/**
 * HOW OLD THIS CATALOG'S KNOWLEDGE IS, said on the way in.
 *
 * Every table this server answers from was generated against ONE web_builder
 * commit, and nothing in the running platform reports its own: `/healthz`
 * answers "ok" and the API's `info.version` is a static "1.0". So an install
 * three months behind the deployment it is talking to behaves exactly like one
 * generated this morning — it simply lacks the elements, keys and preconditions
 * the platform has grown since, and every symptom of that reads as "the agent
 * did not know about X" rather than as staleness.
 *
 * The design already degrades safely (every note is a warning, never a
 * refusal, precisely so a newer deployment may honour what this was generated
 * before). What it could not do is SAY so.
 */
describe('the catalog says how old it is', () => {
  it('names the commit and reads the age in words', () => {
    // WORDS, because nobody can tell whether `d6a68b7` is recent and everybody
    // can tell whether four months is. The id rides along for the person who
    // then has to go and find it.
    const line = catalogAge(new Date(Date.parse(PLATFORM_SOURCE.committedAt ?? '') + 120 * 86_400_000));
    expect(line).toContain(PLATFORM_SOURCE.commit!.slice(0, 9));
    expect(line).toContain('4 months old');
    expect(line).toContain('regenerate');
  });

  it('reads a fresh catalog as today', () => {
    // THE LIVENESS ANCHOR for the case above: a function that always said
    // "months old" would satisfy it, and would be wrong on every fresh install.
    const line = catalogAge(new Date(PLATFORM_SOURCE.committedAt ?? ''));
    expect(line).toContain('today');
    expect(line).not.toContain('months old');
  });

  it('says nothing at all where there is no provenance to report', () => {
    // A checkout with no git — a tarball, a fixture — must not have a
    // provenance invented for it. Absent is silent, the rule every generated
    // reader here follows.
    const saved = { ...PLATFORM_SOURCE };
    try {
      (PLATFORM_SOURCE as { commit: string | null }).commit = null;
      expect(catalogAge()).toBe('');
    } finally {
      Object.assign(PLATFORM_SOURCE, saved);
    }
  });

  it('marks a catalog built from an uncommitted tree', () => {
    // `codegen:check` refuses a dirty read precisely because such a catalog can
    // describe work no deployment has. `--dirty` overrides it on purpose;
    // shipping one unknowingly is what this field makes visible.
    const saved = { ...PLATFORM_SOURCE };
    try {
      (PLATFORM_SOURCE as { dirty: boolean }).dirty = true;
      expect(catalogAge()).toContain('UNCOMMITTED');
      (PLATFORM_SOURCE as { dirty: boolean }).dirty = false;
      expect(catalogAge()).not.toContain('UNCOMMITTED');
    } finally {
      Object.assign(PLATFORM_SOURCE, saved);
    }
  });

  it('is what the generator actually wrote, not a placeholder', () => {
    // The whole line is worthless if the stamp is empty, and an empty stamp is
    // exactly what a broken git read produces — silently.
    expect(PLATFORM_SOURCE.commit, 'no commit stamped').toMatch(/^[0-9a-f]{40}$/);
    expect(PLATFORM_SOURCE.committedAt, 'no commit date stamped').toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(PLATFORM_SOURCE.dirty, 'a dirty catalog was committed').toBe(false);
  });
});
