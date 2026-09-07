import { BINDING_SOURCES, BOUND_SPECIALS } from '../../catalog/elements.generated.js';

/** The elements whose renderer reads a bound special — the ones that can show a record. */
const RECORD_ELEMENTS = Object.keys(BOUND_SPECIALS).sort().join(', ');

/**
 * One fix per KIND of finding, as a template.
 *
 * A page with twenty placeholders used to carry twenty copies of the same
 * sentence with a different id in each — ~270 chars a finding, measured. The
 * tool layer now sends each template once, under `fixes`, and every finding
 * keeps only what the template needs: its `nodeId`, and `key` where a key
 * matters. The domain layer still fills the template into `fix` so a caller
 * reading one finding in isolation (a test, a log) sees the whole sentence.
 */
export const FIX: Record<string, string> = {
  empty_page:
    'Add a section with sb_add (parent_id ROOT, type flex-section), or drop a designed one in with sb_template_use.',
  unknown_element:
    'Regenerate the catalog (npm run codegen against a current web_builder checkout). If the element was removed from the platform, delete the node with sb_remove.',
  empty_container: 'Add something inside it (sb_add with parent_id "<id>"), or remove it with sb_remove.',
  empty_text: 'Set it: sb_set id "<id>", namespace specials, keys { "<key>": … }.',
  missing_media: 'Set it: sb_set id "<id>", namespace specials, keys { "<key>": … }.',
  placeholder_content: 'Write the real copy: sb_set id "<id>", namespace specials, keys { "<key>": … }.',
  // The fix is a DIFFERENT ELEMENT, not a value: setting "<key>" here would put
  // one authored value on every row of the repeater.
  static_in_dataset:
    `Swap the element: sb_add one of ${RECORD_ELEMENTS} in the same parent, sb_bind it ` +
    '(field "specials.bound…", source matching the record), sb_move it into place, then ' +
    'sb_remove id "<id>". Setting "<key>" on this one would show the same value in every row.',
  unbound_dataset_element:
    'Bind it: sb_bind id "<id>", field "specials.<key>", and the source that names the record ' +
    'field you want (sb_bind refuses an unknown source and lists every valid one).',
  dead_binding_source: `Rebind with sb_bind using one of: ${BINDING_SOURCES.join(', ')}.`,
  // "<key>" here is documentation, not a placeholder: this template is never
  // filled with a key, so the reader sees the form a field must take.
  dead_binding_field: 'Rebind with sb_bind and a field of the form "specials.<key>".',
  off_canvas:
    'Give it a width that can shrink — sb_set id "<id>", namespace style, keys { "maxWidth": "100%" } at this breakpoint.',
  text_too_small:
    'Raise it for this breakpoint: sb_set id "<id>", namespace style, keys { "fontSize": "16px" }.',
  overlap:
    'Check the two for a fixed height or a negative margin at this breakpoint; sb_look with node_id on each shows which one is out of place.',
};

/** The template for `code`, with every `<name>` in `vars` substituted. */
export function fill(code: string, vars: Record<string, string>): string {
  // Loud, not empty: a finding with no fix is the shape review exists to prevent.
  if (!FIX[code]) throw new Error(`sbuilder: no fix template for finding code "${code}"`);
  let s = FIX[code];
  for (const [k, v] of Object.entries(vars)) s = s.split(`<${k}>`).join(v);
  return s;
}

/**
 * The shape a TOOL returns: findings without their `fix`, plus one template
 * per code present. Twenty placeholder findings cost one sentence, not twenty.
 */
export function compactFindings<T extends { code: string; fix: string }>(
  items: T[],
): { findings: Array<Omit<T, 'fix'>>; fixes: Record<string, string> } {
  const fixes: Record<string, string> = {};
  const findings = items.map((it) => {
    const { fix, ...rest } = it;
    void fix;
    if (FIX[it.code] && !fixes[it.code]) fixes[it.code] = FIX[it.code];
    return rest;
  });
  return { findings, fixes };
}
