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
  // Named apart from placeholder_content because the reader needs telling that
  // this surface EXISTS. An empty state is authored out of sight — it only shows
  // when the list is empty — so an agent that never saw it does not know there is
  // anything to write.
  default_seed_copy:
    'Write it in the shop\'s own language and ink: sb_set id "<id>", namespace specials, ' +
    'keys { "<key>": … }. It is a seeded satellite (an empty state, an element\'s chrome), ' +
    'so it only appears when the list is empty or the control is idle — sb_outline lists it ' +
    'under its owner as satellite:"<config key>". Style it too: the seed ships #171717 ink ' +
    'and #d4d4d4 icons, which are the platform\'s, not the site\'s.',
  // The fix is a DIFFERENT ELEMENT, not a value: setting "<key>" here would put
  // one authored value on every row of the repeater.
  static_in_dataset:
    `Swap the element: sb_add one of ${RECORD_ELEMENTS} in the same parent, sb_bind it ` +
    '(field "specials.bound…", source matching the record), sb_move it into place, then ' +
    'sb_remove id "<id>". Setting "<key>" on this one would show the same value in every row.',
  unbound_dataset_element:
    'Bind it: sb_bind id "<id>", field "specials.<key>", and the source that names the record ' +
    'field you want (sb_bind refuses an unknown source and lists every valid one).',
  // The value the platform now seeds on these elements, so a repair matches what
  // a freshly created form would have.
  form_fields_flush:
    'Give the stack room: sb_set id "<id>", namespace style, base true, keys { "gap": "12px" } ' +
    '— the value the platform seeds on form / form-segment / form-step-nav. Raise it if the ' +
    'design wants more air; it must stay clear of config.fieldStackGap, which is the smaller ' +
    'label-to-control gap INSIDE one field.',
  unlinked_form:
    'Point it at a real form: sb_set id "<id>", namespace specials, keys ' +
    '{ "formId": "<a form id from sb_api_find \'list forms\'>" }.',
  dead_menu_link:
    'Write the entries the renderer actually reads: sb_set id "<id>", namespace specials, keys ' +
    '{ "menuItems": [{ "id": "mi-1", "label": "Shop", "href": "/shop" }] }. Setting menuId alone ' +
    'publishes an empty nav — the Go renderer never reads it.',
  extra_repeater_child:
    'Keep one template: sb_remove the extra children of "<id>", or sb_move them out. Design the ' +
    'single remaining child — it is what every record is drawn with.',
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
  // Both sticky findings name a node OTHER than the one at fault, because in
  // both cases the node carrying the defect is not the node to edit.
  sticky_blocked:
    'Clear the clip on the ancestor: sb_set id "<key>", namespace style, keys ' +
    '{ "overflowX": "visible", "overflowY": "visible" } — or move the pinned node outside it. ' +
    'Sticky resolves against its nearest SCROLLING ancestor, so a clipping one becomes that ' +
    'ancestor and the node pins inside a box that never scrolls.',
  stuck_no_host:
    'Pin something: sb_set id "<id>" (or the section it lives in), namespace style, keys ' +
    '{ "position": "sticky" } — sb_set seeds the offset and the layer order with it. Until ' +
    'then the platform compiles no rule for this state at all, so the override is stored, ' +
    'published and never painted. To drop it instead, remove the stuck slot.',
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

/**
 * What a COMPOSE WARNING means for the document now in hand.
 *
 * These ride on `GET .../source` beside the page. The client typed the field and
 * read it nowhere, which mattered most for the one that is destructive:
 * `globalMissing` means the server could not find the master and DELETED the
 * reference node from the tree it handed back (`compose.go:118,127`), so the
 * page opens with the section already gone and the next save stores that loss
 * permanently — with no error at any step.
 */
export const COMPOSE_WARNINGS: Record<string, string> = {
  globalMissing:
    'The shared section is GONE from the tree you just opened — the server could not find its ' +
    'master and removed the reference. Saving from here makes that permanent. Re-add the section, ' +
    'or restore the master, before you save.',
  globalStale:
    'A shared section was edited elsewhere while this copy was held; the master write was refused.',
  overlayStale:
    'The overlay master was edited elsewhere while this copy was held; that write was refused. ' +
    'The page edits in the same request were kept.',
  appBlockMissing: 'An app block on this page no longer resolves; its subtree composed as nothing.',
  appBlockEdited:
    'An edit inside an app block was reduced back to its reference on save, and is stored nowhere.',
  formMissing:
    'A form placement names a form that no longer exists, so it publishes as an EMPTY BOX rather ' +
    'than an error.',
};

export interface ComposeWarning {
  code: string;
  id?: string;
  name?: string;
  effect: string;
}

/**
 * Turn the server's warnings into something a reader can act on.
 *
 * The two id fields are separate on the wire on purpose — they name rows in
 * different tables, and one field holding "an id of whichever kind the code
 * implies" is the shape that makes a client resolve it against the wrong store.
 * An unknown code is passed through rather than dropped: a warning this build
 * has never heard of is still the platform telling the caller something.
 */
export function composeWarnings(raw: unknown[] | undefined): ComposeWarning[] {
  if (!raw?.length) return [];
  const out: ComposeWarning[] = [];
  for (const w of raw) {
    if (!w || typeof w !== 'object') continue;
    const { code, globalId, overlayId, name } = w as Record<string, unknown>;
    if (typeof code !== 'string' || !code) continue;
    const id = typeof overlayId === 'string' && overlayId ? overlayId : globalId;
    out.push({
      code,
      ...(typeof id === 'string' && id ? { id } : {}),
      ...(typeof name === 'string' && name ? { name } : {}),
      effect: COMPOSE_WARNINGS[code] ?? 'The platform reported this about the page it composed.',
    });
  }
  return out;
}
