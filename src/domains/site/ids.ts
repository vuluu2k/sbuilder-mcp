import { randomBytes } from 'node:crypto';

/**
 * Id prefixes, mirrored from schema/src/node.ts.
 *
 * Purely cosmetic — an id only has to be unique — but a document this server
 * builds should be indistinguishable from one a human built, and the prefix is
 * the first thing anyone reading a document sees. The tab family is listed
 * explicitly because the generic two-letter fallback collapses all three to 'ta'.
 */
const PREFIXES: Record<string, string> = {
  root: 'rt',
  'flex-section': 'fs',
  'flex-block': 'fb',
  heading: 'he',
  text: 'tx',
  button: 'bt',
  image: 'im',
  icon: 'ic',
  spacer: 'sp',
  tab: 'tb',
  'tab-content': 'tc',
  'tab-item': 'ti',
};

/**
 * Every id this process has issued, so it can never issue one twice.
 *
 * FOUR RANDOM BYTES IS 32 BITS, AND THAT IS THIN FOR THE JOB. The birthday
 * bound puts a collision at roughly 1 in 34,000 across 500 draws — which
 * sounds like never until you notice that one `sb_import_site` run mints
 * thousands, and that the suite's own uniqueness test HIT IT: 499 unique out of
 * 500, once, in an ordinary run.
 *
 * The consequence is not a warning. Two nodes sharing an id means one
 * overwrites the other in `doc.nodes` — content silently gone, a parent's child
 * list pointing at the survivor, and a document that validates, saves and
 * publishes. It is the same family as every other entry in this repo's file:
 * the failure has no error attached to it.
 *
 * The width stays FOUR BYTES because the platform's own ids are eight hex
 * characters and a document this server builds should be indistinguishable
 * from one a human built. Uniqueness comes from remembering instead — which is
 * the scope that actually matters, since one process builds one document.
 */
const issued = new Set<string>();

export function genId(type: string): string {
  const prefix = PREFIXES[type] ?? (type.replace(/[^a-z]/g, '').slice(0, 2) || 'nd');
  for (;;) {
    const id = `${prefix}_${randomBytes(4).toString('hex')}`;
    if (issued.has(id)) continue;
    issued.add(id);
    return id;
  }
}
