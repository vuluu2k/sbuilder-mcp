import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ELEMENTS, BINDING_SOURCES } from '../src/catalog/elements.generated.js';
import { API_OPERATIONS } from '../src/catalog/api.generated.js';

/**
 * THE NUMBERS IN THE READMEs ARE MEASUREMENTS, AND A MEASUREMENT NOBODY CHECKS
 * DRIFTS.
 *
 * Both READMEs advertise what this server reaches — operations, elements,
 * binding sources — and every one of those moves with the platform on the next
 * `npm run codegen`. Hand-kept, they were all stale at once: 495 operations
 * against a catalog holding 508, and 111 elements against 112. Nothing was
 * wrong with the code; the front page of a public package was simply describing
 * a platform that no longer existed.
 *
 * That is the same shape as every other hand-kept fact this repo has replaced
 * with a generated one, so it gets the same treatment: the catalog is the
 * authority, and the prose has to agree with it. A regen that moves a number
 * now fails here, naming the file and both values, instead of being noticed by
 * a reader months later — or not at all.
 *
 * DELIBERATELY NOT A GENERATOR. The sentences around these numbers are written
 * for a person and should stay written by one; only the arithmetic is checked.
 */
const read = (name: string): string =>
  readFileSync(resolve(import.meta.dirname, '..', name), 'utf8');

const READMES = ['README.md', 'README.vi.md'] as const;

describe('the READMEs describe the catalog that actually shipped', () => {
  it('names the right number of API operations', () => {
    const real = API_OPERATIONS.length;
    for (const name of READMES) {
      // "**508 API operations**" / "**508 operation API**"
      const m = /\*\*(\d+) (?:API operations|operation API)\*\*/.exec(read(name));
      expect(m, `${name} no longer states an operation count in the expected shape`).not.toBeNull();
      expect(Number(m![1]), `${name} says ${m![1]} API operations; the catalog holds ${real}`).toBe(
        real,
      );
    }
  });

  it('names the right number of elements and binding sources', () => {
    const elements = Object.keys(ELEMENTS).length;
    const sources = BINDING_SOURCES.length;
    for (const name of READMES) {
      const text = read(name);
      const el = /(\d+) (?:elements|element),/.exec(text);
      expect(el, `${name} no longer states an element count`).not.toBeNull();
      expect(Number(el![1]), `${name} says ${el![1]} elements; the catalog holds ${elements}`).toBe(
        elements,
      );

      const bs = /(\d+) (?:binding sources|nguồn binding)/.exec(text);
      expect(bs, `${name} no longer states a binding-source count`).not.toBeNull();
      expect(
        Number(bs![1]),
        `${name} says ${bs![1]} binding sources; the catalog holds ${sources}`,
      ).toBe(sources);
    }
  });

  /**
   * THE CLAIM THAT WAS NOT A NUMBER, and cost more than any of them.
   *
   * The `sb_undo` row read "the platform has no page history or restore, so this
   * is the only way back" — a sentence CLAUDE.md records as FALSE and as having
   * been corrected in the tool's own description, while both READMEs kept it.
   * Page versions, history and restore are real, are on the call sheet, and
   * outlive this process; `sb_undo` lives in memory and dies with it. A reader
   * who believed the row would reach for the weaker answer, or conclude a
   * wrecked draft was unrecoverable.
   *
   * It is the fourth "you cannot" in this repo to outlive the thing that made it
   * true, after agent keys, storefront accounts and reveal-on-scroll. This
   * assertion is cheap insurance against the fifth landing in the same row.
   */
  it('does not tell a reader the platform has no page history', () => {
    for (const name of READMES) {
      const text = read(name);
      expect(text).not.toMatch(/no page history or restore/i);
      expect(text).not.toMatch(/không có lịch sử trang hay restore/i);
    }
  });
});
