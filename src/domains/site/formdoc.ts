import type { DocLike, NodeLike } from '../../core/tree.js';

/**
 * A FORM'S FIELD DOCUMENT, read the way the platform reads it on save
 * (`server/internal/forms/schema.go` DeriveSchema).
 *
 * Element type → whether the field COLLECTS a value. Mirrors `nodeTypeToField`
 * (forms/field.go): title and paragraph are furniture, everything else answers.
 * ponytail: hand-copied, 14 rows. Upgrade: a codegen reader over field.go's
 * table, the same way formrules.generated.ts reads the rule vocabulary.
 */
const FIELD_TYPES: Record<string, boolean> = {
  'form-title': false,
  'form-paragraph': false,
  'form-text': true,
  'form-number': true,
  'form-radio': true,
  'form-payment': true,
  'form-timeslot': true,
  'form-checkbox': true,
  'form-select': true,
  'form-date': true,
  'form-calendar': true,
  'form-file': true,
  'form-address': true,
  'form-discount-code': true,
};

/** Choice fields whose AUTHORED `options` are what a visitor picks from. */
const CHOICE_TYPES = new Set(['form-select', 'form-radio', 'form-checkbox']);
/** FieldCalendar + FieldDate — what `CheckBookingRules` counts as a date. */
const DATE_TYPES = new Set(['form-calendar', 'form-date']);

export function isFormDocument(d: DocLike): boolean {
  return d.nodes[d.root_node_id]?.data.type === 'form';
}

/** Does this element type post an answer (title / paragraph do not)? */
export function collectsValue(type: string): boolean {
  return FIELD_TYPES[type] === true;
}

/** The name an answer posts under: `specials.name` TRIMMED, else the node id. Case kept. */
export function postedName(n: NodeLike): string {
  const raw = n.specials?.name;
  return (typeof raw === 'string' && raw.trim()) || n.id;
}

/**
 * Every field node, in DOCUMENT ORDER, walked exactly as DeriveSchema walks:
 * ROOT's `form-segment` children are the segments (or ROOT itself when there
 * are none), and a nested segment is another segment's territory.
 */
export function formFields(d: DocLike): NodeLike[] {
  if (!isFormDocument(d)) return [];
  const root = d.nodes[d.root_node_id];
  const segs = root.data.nodes.filter((id) => d.nodes[id]?.data.type === 'form-segment');
  const out: NodeLike[] = [];
  const walk = (id: string, segRoot: string, depth: number): void => {
    const n = d.nodes[id];
    if (!n || depth > 32) return;
    if (id !== segRoot && n.data.type === 'form-segment') return;
    if (id !== segRoot && n.data.type in FIELD_TYPES) out.push(n);
    for (const kid of n.data.nodes) walk(kid, segRoot, depth + 1);
  };
  if (segs.length) for (const s of segs) walk(s, s, 0);
  else for (const kid of root.data.nodes) walk(kid, d.root_node_id, 1);
  return out;
}

/**
 * What makes the platform REFUSE this form document — two answering fields
 * posting under one name (409 duplicate_field_name) or mapping one column
 * (409 duplicate_field_mapping). Uniqueness is across the whole form, not per
 * segment. Empty for a page.
 */
export function formClashes(d: DocLike): string[] {
  const out: string[] = [];
  const names = new Map<string, string>();
  const maps = new Map<string, string>();
  for (const n of formFields(d)) {
    if (!collectsValue(n.data.type)) continue;
    const name = postedName(n);
    const first = names.get(name);
    if (first) {
      out.push(
        `Form fields ${first} and ${n.id} both post under the name "${name}" — the platform refuses ` +
          'the save (duplicate_field_name). Give one a different specials.name.',
      );
    } else names.set(name, n.id);
    const raw = n.specials?.mapTo;
    const mapTo = typeof raw === 'string' ? raw.trim() : '';
    if (!mapTo) continue;
    const firstMap = maps.get(mapTo);
    if (firstMap) {
      out.push(
        `Form fields ${firstMap} and ${n.id} both map to "${mapTo}" — the platform refuses the save ` +
          '(duplicate_field_mapping). Clear specials.mapTo on one.',
      );
    } else maps.set(mapTo, n.id);
  }
  return out;
}

/** "HH:MM" → minutes since midnight, or -1 (render/nodes/timeslot ParseClock). */
function clock(v: unknown): number {
  const m = typeof v === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(v.trim()) : null;
  if (!m) return -1;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h > 24 || mi > 59 || (h === 24 && mi > 0) ? -1 : h * 60 + mi;
}

export interface FormFieldFinding {
  code: 'form_options_empty' | 'form_timeslot_dead' | 'form_booking_dates';
  nodeId: string;
  type: string;
  key: string;
  problem: string;
}

/**
 * Fields the platform STORES and no visitor can ever answer. Warnings: the save
 * succeeds, which is exactly why nothing else would say so.
 *
 * `formType` is the form RECORD's type; the third-date rule needs it and stays
 * silent without it rather than guess.
 */
export function formFieldFindings(d: DocLike, formType?: string): FormFieldFinding[] {
  const out: FormFieldFinding[] = [];
  let dates = 0;
  for (const n of formFields(d)) {
    const s = n.specials ?? {};
    const type = n.data.type;
    if (CHOICE_TYPES.has(type)) {
      // A non-manual source feeds the options at render; the authored list is its fallback.
      const source = n.config?.optionSource;
      const manual = source === undefined || source === '' || source === 'manual';
      const opts = Array.isArray(s.options) ? s.options.filter((o) => typeof o === 'string' && o.trim()) : [];
      if (manual && opts.length === 0) {
        out.push({
          code: 'form_options_empty',
          nodeId: n.id,
          type,
          key: 'options',
          problem: `${type} "${postedName(n)}" has no options, so a visitor has nothing to choose — and a required one blocks every submission.`,
        });
      }
    }
    if (type === 'form-timeslot') {
      // render/nodes/timeslot Slots(): no grid when a clock is malformed, step ≤ 0, end ≤ start,
      // or the first slot already runs past the end.
      const start = clock(s.start);
      const end = clock(s.end);
      const step = typeof s.step === 'number' ? Math.trunc(s.step) : 0;
      if (start < 0 || end < 0 || step <= 0 || end <= start || start + step > end) {
        out.push({
          code: 'form_timeslot_dead',
          nodeId: n.id,
          type,
          key: 'start',
          problem:
            `form-timeslot "${postedName(n)}" offers no slot (start ${JSON.stringify(s.start)}, end ` +
            `${JSON.stringify(s.end)}, step ${JSON.stringify(s.step)}) — it renders no chip and can never be answered.`,
        });
      }
    }
    if (DATE_TYPES.has(type) && ++dates === 3 && formType === 'booking') {
      out.push({
        code: 'form_booking_dates',
        nodeId: n.id,
        type,
        key: 'name',
        problem:
          'A booking form reads its FIRST TWO date fields, in document order, as check-in and ' +
          'check-out; this is a third, so it is ignored by every booking rule — and moving it ' +
          'above the others silently changes which dates the stay is.',
      });
    }
  }
  return out;
}

/** A posted-name suggestion from a label: "Dịch vụ" → "dich_vu". */
export function nameFromLabel(label: string): string {
  return label
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
