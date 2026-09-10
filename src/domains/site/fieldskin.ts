import { FIELD_SKIN_BY_NODE } from '../../catalog/fieldskin.generated.js';

/**
 * A FORM'S FIELDS ARE STYLED BY CONFIG KEYS, AND THE WRONG LEVEL IS SILENT.
 *
 * `fieldSkin.ts` / `fieldskin.go` hold the vocabulary, and each form node's
 * `css.go` emits only the group it names. A knob written on a node that does not
 * read it is stored, saved, published, and rendered NOWHERE — the same shape as
 * a binding outside the `specials` namespace.
 *
 * CLAUDE.md carried the rule as PROSE ("form/css.go emits only FieldKnobs, so
 * payCard* written on the form is stored and rendered nowhere"), which is a
 * hand-kept summary of a 55-key table across 11 nodes. It is generated now: the
 * groups from `fieldSkin.ts` (pure data), the node mapping from each `css.go`'s
 * `fieldskin.<Group>` identifier, and the vocabulary cross-checked against the
 * Go's own key literals at codegen.
 *
 * THE ANSWER IS PER NODE, not per key: `payCardBg` is real and rendered on
 * `form-payment`, and dead on `form`. So a caller is told which node DOES read
 * it, which is the only thing that turns the warning into a fix.
 */

/** Every field-skin key, across every form node. */
const ALL_KEYS: ReadonlySet<string> = new Set(Object.values(FIELD_SKIN_BY_NODE).flat());

/** Does this node's renderer read this skin key? */
export function readsSkinKey(nodeType: string, key: string): boolean {
  return (FIELD_SKIN_BY_NODE[nodeType] ?? []).includes(key);
}

/** The node types whose renderer DOES read a key — the fix half of the warning. */
export function nodesReading(key: string): string[] {
  return Object.entries(FIELD_SKIN_BY_NODE)
    .filter(([, keys]) => keys.includes(key))
    .map(([type]) => type)
    .sort();
}

/**
 * The warning for field-skin keys written on a node that renders none of them.
 *
 * Only fires for a key that IS a skin knob somewhere — an unknown config key is
 * not this module's business, and claiming it would put a false positive on
 * every ordinary write. A node that reads no skin keys at all (an ordinary
 * heading) is equally not the target: the mistake this catches is a skin key on
 * the WRONG form node, which is the one the platform documents.
 */
export function skinLevelNote(nodeType: string, keys: readonly string[]): string | null {
  const misplaced = keys.filter((k) => ALL_KEYS.has(k) && !readsSkinKey(nodeType, k));
  if (!misplaced.length) return null;
  const detail = misplaced
    .map((k) => {
      const readers = nodesReading(k);
      return `${k} (read by ${readers.join(', ') || 'no node'})`;
    })
    .join('; ');
  return (
    `"${nodeType}" renders none of these field-skin keys, so they would be stored, saved, ` +
    `published and read by nothing: ${detail}. A skin knob is emitted only by the node whose ` +
    'css.go names its group — the FORM dresses every field it holds with the input vocabulary, ' +
    'and a payment card, choice group, timeslot or file field carries its own. Write them on ' +
    'the field node, which lives in the FORM DOCUMENT ' +
    '(PUT /api/sites/{siteId}/forms/{id}/document), not on the page.'
  );
}
