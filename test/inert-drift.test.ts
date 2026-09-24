import { describe, it, expect } from 'vitest';
import {
  AUDIT_REJECTED,
  RENDER_LANGUAGE,
  reportInertDrift,
  unlistedInertCandidates,
} from '../scripts/inert-drift.js';
import { INERT_ON_ADD } from '../src/domains/site/inert.js';
import { ELEMENTS } from '../src/catalog/elements.generated.js';

/**
 * THE THIRD STALENESS QUESTION. `--check` asks whether the catalog is current
 * against swagger.json, and `reportUndocumentedRoutes` asks whether swagger.json
 * is current against the routes. Neither can ask whether INERT_ON_ADD is current
 * against the ELEMENTS, because that table is hand-kept and no generated file
 * carries it — which is how `quickview` shipped, landed in this catalog, and
 * went unnoticed until somebody read all 113 elements' prose by hand.
 *
 * These pin the PROPERTY rather than the wording: an element whose own prose
 * says it renders only through something else, and which no audit has listed or
 * rejected, is named. The synthetic cases pin the rule; the catalog case pins
 * the rule against THIS platform, which is the only place it has to be right.
 */
describe('the INERT_ON_ADD staleness detector', () => {
  const el = (avoidWhen: string[], description = 'An element.') => ({ avoidWhen, description });

  it('names an element whose prose matches while it is in neither ledger', () => {
    const found = unlistedInertCandidates(
      { newthing: el(['Placed loose on a page it only renders through the list that names it.']) },
      {},
      {},
    );
    expect(found).toEqual(['newthing']);
  });

  it('says nothing about an element the table already carries', () => {
    const elements = { newthing: el(['it only renders through the list that names it']) };
    expect(unlistedInertCandidates(elements, { newthing: {} }, {})).toEqual([]);
  });

  it('says nothing about an element an audit read and rejected', () => {
    const elements = { newthing: el(['it only renders through the list that names it']) };
    expect(unlistedInertCandidates(elements, {}, { newthing: 'read and declined' })).toEqual([]);
  });

  // VALIDITY language, not render language: "only valid inside" is a semantic
  // note about which element is idiomatic, and the audit rejected every entry
  // that spoke this way. The discriminator is the whole check.
  it('does not report an element that merely says where it is valid', () => {
    const elements = { slide: el(['Only valid inside a carousel — use a flex-block elsewhere.']) };
    expect(unlistedInertCandidates(elements, {}, {})).toEqual([]);
  });

  // The one place the rule has to hold. A new element arriving with this prose
  // and no audit is exactly the `quickview` case, and this goes red for it.
  it('reports nothing on the committed catalog, and reports a planted element', () => {
    expect(unlistedInertCandidates(ELEMENTS as never)).toEqual([]);

    const planted = {
      ...(ELEMENTS as unknown as Record<string, { description?: string; avoidWhen?: string[] }>),
      quicklook: el(['This panel only renders through the list that names it.']),
    };
    expect(unlistedInertCandidates(planted)).toEqual(['quicklook']);
  });

  // It WARNS and never fails: the drift is not fixable by regenerating anything
  // here, so exiting would send the caller to the one command that cannot help.
  // The message has to name the audit instead.
  it('warns through stderr and names the fix rather than the gap', () => {
    const lines: string[] = [];
    const real = console.error;
    console.error = (...a: unknown[]) => void lines.push(a.join(' '));
    try {
      reportInertDrift({ quicklook: el(['This panel only renders through the list above it.']) });
    } finally {
      console.error = real;
    }
    const out = lines.join('\n');
    expect(out).toMatch(/quicklook/);
    expect(out).toMatch(/INERT_ON_ADD/);
    expect(out).toMatch(/AUDIT_REJECTED/);
    expect(out).toMatch(/not fixable by regenerating/);
  });

  // The measurement recorded in the module header, asserted rather than trusted.
  // If it moves, the header is wrong — and a header that overstates a detector's
  // reach is worse than no detector, because it reads as a proof.
  it('catches 15 of the 21 entries it claims, no more and no fewer', () => {
    const caught = Object.keys(INERT_ON_ADD).filter((t) => {
      const e = (ELEMENTS as Record<string, { description?: string; avoidWhen?: string[] }>)[t];
      return e && RENDER_LANGUAGE.test(`${(e.avoidWhen ?? []).join(' ')} ${e.description ?? ''}`);
    });
    expect(Object.keys(INERT_ON_ADD)).toHaveLength(21);
    expect(caught).toHaveLength(15);
    // And the ledger's one member is a real element, so a typo cannot silence a
    // live candidate for ever.
    for (const t of Object.keys(AUDIT_REJECTED)) expect(ELEMENTS[t]).toBeDefined();
  });
});
