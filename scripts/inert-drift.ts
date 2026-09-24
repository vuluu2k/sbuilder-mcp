/**
 * IS `INERT_ON_ADD` STILL CURRENT? — the third staleness question.
 *
 * `src/domains/site/inert.ts` names the elements that render convincingly while
 * wired to nothing: the one silent shape neither `sb_review` (which reads the
 * tree, and the tree is correct) nor `sb_look` (which photographs the page, and
 * the page looks right) can catch. It is HAND-KEPT, and its own header says it
 * will go stale on the next platform release.
 *
 * That prediction had already come true before it was written. `quickview` —
 * a site-level panel that renders nothing until a list's `quickviewId` names it
 * — shipped, landed in this catalog, and the table did not know; it was found by
 * an audit that read all 113 elements' prose by hand, not by anything that runs.
 * The durable fix is UPSTREAM (a flag on the element meta saying an element
 * renders only through a named host, or only once a named condition is met), and
 * codegen reads DEPLOYED platforms, so a flag added upstream today could not be
 * consumed here until it ships. What is available now is a DETECTOR, so the next
 * `quickview` is caught by a codegen run rather than by whoever happens to look.
 *
 * THE DISCRIMINATOR, and it came out of that audit rather than out of a hunch:
 * every element the audit KEPT describes itself in RENDER language — "only
 * renders inside/through/as", a claim about what happens on screen — while the
 * ones it rejected use VALIDITY language ("only VALID inside", a semantic note
 * about which element is more idiomatic). `quickview`'s own avoid reads "this
 * panel only renders through the list that names it", so this check would have
 * caught the one element that actually slipped through.
 *
 * MEASURED against the 113-element catalog of 2026-09-14, and written down so
 * the next reader knows what this does and does not claim:
 *
 *   15 of the table's 21 entries match (countdown, added later, is a sixth miss).
 *    5 do not — spline-scene, form-step-button, form-step-count, theme-switcher,
 *      breadcrumb. Their traps are real and are described in other words.
 *    1 element outside the table matches: text-dataset (see AUDIT_REJECTED).
 *
 * 75% recall is nowhere near enough to GENERATE the table — it would drop five
 * real traps — and is plenty to WARN. DO NOT WIDEN THE PATTERN UNTIL IT CATCHES
 * ALL TWENTY: a pattern tuned to fit today's twenty describes the twenty rather
 * than the property, and this repo has already paid for that once, when a grep
 * for `node.States` "found only four files" and produced a conclusion a probe
 * then disproved. The five misses are this check's stated limit, not a bug.
 *
 * It WARNS and does not fail `--check`, for the same reason
 * `reportUndocumentedRoutes` does: the drift is not fixable by regenerating
 * anything here. The fix is a human reading the new element's prose against the
 * table's own criterion and deciding — so the message names THAT instead.
 */
import { INERT_ON_ADD } from '../src/domains/site/inert.js';

/** The prose an inert element uses about itself. See the header for its limits. */
export const RENDER_LANGUAGE =
  /only renders|renders nothing|renders only|hides itself|would be inert|does nothing until|never renders/i;

/**
 * CONSIDERED AND DECLINED — the other half of the fix this check prescribes.
 *
 * This is NOT a skip list, and it must not become one. An element belongs here
 * only once somebody has read its prose against `INERT_ON_ADD`'s criterion (the
 * first write succeeds completely, the element still does nothing useful, and a
 * competent author would be surprised because neither the tree nor the
 * screenshot says so) and concluded it does not belong in the table. The reason
 * is the entry: an unexplained line here is indistinguishable from a bug being
 * hidden, and the next reader has no way to re-open the decision without it.
 */
export const AUDIT_REJECTED: Record<string, string> = {
  // "the description kind renders only the product's own sanitized rich text" —
  // render language about the CONTENT this element draws, not about the element
  // being inert. A text-dataset bound to a product shows that product's text;
  // there is no second write missing and nothing would surprise an author.
  'text-dataset': "renders only the record's own text — render language about content, not inertness",
  // "Renders nothing at all when the product has no real saving" — that is the
  // badge being RIGHT, not wired to nothing: a full-price product has no
  // discount to flag, the description says so up front, and no second write
  // would change it.
  'sale-badge': 'hides itself when there is no real discount — correct behaviour, stated in the description',
};

/** Structurally typed so this module needs no import from the catalog. */
export interface InertCandidate {
  description?: string;
  avoidWhen?: readonly string[];
}

/**
 * Elements whose own prose says they render only through something else, and
 * which no audit has either listed or rejected. Pure, so the property is
 * testable without a platform checkout.
 */
export function unlistedInertCandidates(
  elements: Record<string, InertCandidate>,
  listed: Readonly<Record<string, unknown>> = INERT_ON_ADD,
  rejected: Readonly<Record<string, unknown>> = AUDIT_REJECTED,
): string[] {
  return Object.entries(elements)
    .filter(([type, e]) => {
      if (type in listed || type in rejected) return false;
      return RENDER_LANGUAGE.test(`${(e.avoidWhen ?? []).join(' ')} ${e.description ?? ''}`);
    })
    .map(([type]) => type)
    .sort();
}

/** Warn — never fail — naming the elements and the audit that closes them. */
export function reportInertDrift(elements: Record<string, InertCandidate>): void {
  const missing = unlistedInertCandidates(elements);
  if (missing.length === 0) return;

  console.error(
    `warning: ${missing.length} element(s) describe themselves in the language of an element ` +
      'that renders only through something else, and are in neither INERT_ON_ADD nor its ' +
      'rejected set. If one of them IS inert on add, nothing anywhere says so — not the tree, ' +
      'not the screenshot, not an error:',
  );
  for (const line of missing.slice(0, 12)) console.error(`  ${line}`);
  if (missing.length > 12) console.error(`  …and ${missing.length - 12} more`);
  console.error(
    'This is not fixable by regenerating — read each one against the criterion in ' +
      'src/domains/site/inert.ts (the first write succeeds completely, the element still does ' +
      'nothing useful, and a competent author would be SURPRISED), then either add an entry ' +
      'naming the second write it needs, or record the rejection in AUDIT_REJECTED ' +
      '(scripts/inert-drift.ts) with the reason. This check catches 15 of the table\'s 21 ' +
      'entries by design; a silent element is still possible, so it is a floor, not a proof.',
  );
}
