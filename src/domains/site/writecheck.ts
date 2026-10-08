import {
  BASE_ONLY_CONFIG,
  BOUND_SPECIALS,
  CONFIG_VALUES,
  ELEMENT_VALUES,
  ELEMENTS,
  HOVER_HOMES,
  SATELLITE_RULES,
  TRAIT_WRITES,
  WRITE_PRECONDITIONS,
} from '../../catalog/elements.generated.js';
import { FIELD_SKIN_BY_NODE } from '../../catalog/fieldskin.generated.js';
import { FORM_RULE_VOCAB } from '../../catalog/formrules.generated.js';
import type { DocLike } from '../../core/tree.js';
import type { NodeSpec } from './builder.js';
import {
  animationNote,
  deadKeyNote,
  preconditionNotes,
  unknownValueNote,
  unknownWriteNote,
  unsupportedSettingNote,
} from './vocabulary.js';

/**
 * ONE QUESTION ASKED OF EVERY WRITE: does this key, with this value, mean
 * anything on this element?
 *
 * `setKeys` and `createNode` store whatever they are given, so a key the
 * element never reads (`config.colour`, `specials.lable`) saved, published and
 * changed nothing, with no word at any step. `sb_set` already warned about some
 * VALUES and `sb_add` warned about nothing; both now ask here.
 *
 * A WARNING, never a refusal — the repo's rule (vocabulary.ts): the catalog can
 * be older than the deployment, and refusing would block a key a newer
 * platform reads. So `unknown_key` is CONSERVATIVE: a key counts as known if
 * ANY generated source places it on this element, plus the handful every node
 * carries. A false positive costs more than a miss — a caller warned about
 * correct work stops reading warnings — and `test/write-check.test.ts` pins
 * that every element's own defaults are silent.
 */
export interface WriteNote {
  code: 'unknown_key' | 'unknown_value' | 'animation' | 'dead_key' | 'precondition' | 'unsupported_setting' | 'form_rule';
  id?: string;
  /** `<namespace>.<key>` */
  key: string;
  problem: string;
  fix: string;
}

/** A note plus the key `ctx.notices` dedupes it on. */
export interface CheckedNote {
  once: string;
  note: WriteNote;
}

/**
 * Keys any node may carry, read by shared helpers rather than one element:
 * visibility and reveal (`display` trait), the entrance animation, the pinned
 * state's trigger, the style preset, the parent-hover host, custom class/CSS,
 * the projected link, and the two STORED references (the composed stamps are
 * refused by their own guards, so they are not listed).
 */
const UNIVERSAL: Record<'config' | 'specials', string[]> = {
  config: ['hidden', 'revealOnHover', 'animation', 'stuckAfter'],
  specials: ['stylePreset', 'hoverHostDepth', 'className', 'customCss', 'href', 'target', 'globalRef', 'appBlockRef', 'appBlockValues'],
};

/**
 * Inspector rows that are a WIDGET rather than a trait, so `TRAIT_WRITES` does
 * not describe what they write — the key sits in the widget's props
 * (`editor/src/trait/widgets.ts`: `specialKey: 'icon'` on `button_icon`) or in
 * the component it mounts (`text_global_style` → `StylePresetRow`, which
 * stores the picked site text style as `config.textGlobalStyle`, the key
 * `schema/src/theme.ts` names for every text-bearing element). Keyed by the
 * GENERATED control name, so a key is known only where the element offers the row.
 *
 * ponytail: hand-read, and only the rows the platform's own seeds exercise
 * (test/seed-sweep.test.ts). Upgrade: have codegen read every widget's
 * `specialKey`/`configKey` into the catalog — blocked on a catalog regenerate.
 */
const WIDGET_WRITES: Record<string, ['config' | 'specials', string]> = {
  button_icon: ['specials', 'icon'],
  breadcrumb_icon: ['specials', 'icon'],
  divider_icon: ['specials', 'iconName'],
  text_global_style: ['config', 'textGlobalStyle'],
};

const known = new Map<string, Record<'config' | 'specials', Set<string>>>();

function keysOf(type: string): Record<'config' | 'specials', Set<string>> | null {
  const el = ELEMENTS[type];
  if (!el) return null;
  const hit = known.get(type);
  if (hit) return hit;
  const out = { config: new Set(UNIVERSAL.config), specials: new Set(UNIVERSAL.specials) };
  const add = (ns: string, keys: Iterable<string> | undefined) => {
    if (ns !== 'config' && ns !== 'specials') return;
    for (const k of keys ?? []) out[ns].add(k);
  };
  const d = el.defaults;
  add('config', Object.keys(d.config ?? {}));
  add('specials', Object.keys(d.specials ?? {}));
  for (const layer of [d.responsive, d.states] as Array<Record<string, Record<string, unknown>> | undefined>) {
    for (const slot of Object.values(layer ?? {})) {
      for (const ns of ['config', 'specials']) add(ns, Object.keys((slot?.[ns] ?? {}) as object));
    }
  }
  for (const c of el.controls) for (const w of TRAIT_WRITES[c]?.writes ?? []) add(w.target, [w.writeKey]);
  for (const c of el.controls) if (WIDGET_WRITES[c]) add(WIDGET_WRITES[c][0], [WIDGET_WRITES[c][1]]);
  // A control the trait registry does not describe is often an inspector row
  // named after the key it writes (`{ key: 'quickviewId', visible: false }` on
  // list-dataset), so its NAME counts as a key in either namespace.
  add('config', el.controls);
  add('specials', el.controls);
  for (const v of [...Object.values(ELEMENT_VALUES[type] ?? {}), ...Object.values(ELEMENT_VALUES['*'] ?? {})]) {
    add(v.target, [v.writeKey]);
  }
  add('config', Object.keys(CONFIG_VALUES));
  add('config', BASE_ONLY_CONFIG);
  add('config', (SATELLITE_RULES[type] ?? []).map((r) => r.configKey));
  add('config', FIELD_SKIN_BY_NODE[type]);
  if (HOVER_HOMES[type]?.home === 'legacy') add('config', ['stateHover']);
  add('specials', BOUND_SPECIALS[type]);
  // The binding fields the element is BORN with name specials keys too
  // (`boundProductId` is one no html.go reads, and it is still correct).
  for (const b of bindingFields(type)) add('specials', [b]);
  for (const p of WRITE_PRECONDITIONS) {
    if (p.types.includes(type)) add('specials', [p.key, ...p.requires.map((r) => r.key)]);
  }
  known.set(type, out);
  return out;
}

/** Every `specials.<key>` this element's generated bindings write, key only. */
export function bindingFields(type: string): string[] {
  const el = ELEMENTS[type];
  const rows = [...(el?.defaults.bindings ?? []), ...Object.values(el?.bindingsFor ?? {}).flat()] as Array<{ field?: string }>;
  return [...new Set(rows.map((b) => b.field ?? '').filter((f) => f.startsWith('specials.')).map((f) => f.slice(9)))];
}

/**
 * The `specials.<key>` fields `sb_bind` accepts on this element, and the list
 * `sb_traits_for` reports as `bindable` — one function so the two cannot drift.
 * What the renderer paints (`BOUND_SPECIALS`) plus the element's own generated
 * binding fields (`boundProductId` is read by the runtime, not html.go). Empty
 * when the catalog knows no bound special for the type: `sb_bind` then does not
 * restrict the field.
 */
export function bindableFields(type: string): string[] {
  const painted = BOUND_SPECIALS[type] ?? [];
  return painted.length ? [...new Set([...painted, ...bindingFields(type)])] : [];
}

/**
 * Check one write. `specials` is the node's specials AS THEY WILL BE after the
 * write, for the precondition question (a pair is legal or not together).
 */
export function writeCheck(
  type: string,
  namespace: string,
  keys: Readonly<Record<string, unknown>>,
  opts: { id?: string; specials?: Readonly<Record<string, unknown>>; doc?: DocLike } = {},
): CheckedNote[] {
  const out: CheckedNote[] = [];
  const push = (once: string, code: WriteNote['code'], key: string, problem: string, fix: string) =>
    out.push({ once, note: { code, ...(opts.id ? { id: opts.id } : {}), key: `${namespace}.${key}`, problem, fix } });
  if (namespace !== 'config' && namespace !== 'specials') return out;
  const ks = keysOf(type);
  for (const [k, v] of Object.entries(keys)) {
    const dead = deadKeyNote(namespace, k);
    if (dead) {
      push(`dead-key:${namespace}.${k}`, 'dead_key', k, dead, 'Drop the key — no value for it does anything.');
      continue;
    }
    if (ks && !ks[namespace].has(k)) {
      const other = namespace === 'config' ? 'specials' : 'config';
      push(
        `unknown-key:${type}.${namespace}.${k}`,
        'unknown_key',
        k,
        `${namespace}.${k} is not a key ${type} is known to read — not in its seeded defaults, its ` +
          'declared controls or any generated vocabulary. It is stored as written; if nothing reads ' +
          'it, the write changes nothing on the page.',
        ks[other].has(k)
          ? `${type} reads ${other}.${k} — write it in namespace "${other}".`
          : `Check the spelling against sb_traits_for "${type}"; a CSS property belongs in namespace ` +
              '"style". Ignore this if the key is newer than this catalog.',
      );
      continue;
    }
    const vn = type ? unknownWriteNote(type, namespace, k, v) : null;
    if (vn) {
      push(`value:${type}.${namespace}.${k}=${JSON.stringify(v)}`, 'unknown_value', k, vn, 'Write one of the listed values.');
    }
    if (namespace === 'config') {
      const cn = k === 'animation' ? animationNote(v) : unknownValueNote(k, v);
      if (cn) {
        push(
          `config-value:${k}=${JSON.stringify(v)}`,
          k === 'animation' ? 'animation' : 'unknown_value',
          k,
          cn,
          k === 'animation'
            ? 'Write an object: { active: true, type: "fade_in", … } — sb_traits_for lists the vocabulary.'
            : 'Write one of the listed values.',
        );
      }
    }
    if (namespace === 'specials') {
      const un = unsupportedSettingNote(type, k, v);
      if (un) push(`unsupported:${type}.${k}=${JSON.stringify(v)}`, 'unsupported_setting', k, un, `Unset specials.${k}; ${type} never reads it.`);
    }
  }
  if (namespace === 'specials' && type === 'form' && 'formRules' in keys && opts.doc) {
    for (const r of formRuleChecks(opts.doc, keys.formRules)) {
      push(`form-rule:${r.problem}`, 'form_rule', 'formRules', r.problem, r.fix);
    }
  }
  if (namespace === 'specials') {
    for (const n of preconditionNotes(type, opts.specials ?? keys)) {
      const key = n.slice('specials.'.length, n.indexOf(' ='));
      push(`precondition:${type}:${n.slice(0, 60)}`, 'precondition', key, n, 'Set the neighbouring keys named above, or unset this one.');
    }
  }
  return out;
}

/**
 * `specials.formRules` on a form root, judged against the open form document.
 *
 * EVERY READER DROPS A BAD RULE IN SILENCE — `readFormRules` (schema) and
 * `ReadFormRules` (server/internal/forms/rules.go) skip an entry with no id or
 * an unknown join/op/action, one at a time — so the save succeeds and the field
 * it governs never changes. A rule is keyed by each field's POSTED NAME,
 * `specials.name` trimmed, falling back to the node id only when there is none
 * (the editor's `ruleNameOf`, DeriveSchema's rule) — so a named field's node id
 * is NOT a key. Warnings only: the platform stores the document either way.
 */
export function formRuleChecks(doc: DocLike, raw: unknown): Array<{ problem: string; fix: string }> {
  const out: Array<{ problem: string; fix: string }> = [];
  const add = (problem: string, fix: string) => out.push({ problem, fix });
  let list: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return out;
    try {
      list = JSON.parse(raw);
    } catch {
      add('specials.formRules is not valid JSON, so the platform reads NO rules at all.', 'Write JSON.stringify(rules) of an array of rules.');
      return out;
    }
  }
  if (!Array.isArray(list)) {
    add('specials.formRules must be a JSON array of rules; anything else is read as no rules.', 'Wrap the rule in [ … ].');
    return out;
  }
  // ponytail: names from every node, not only answering fields — a rule naming
  // a title is missed rather than a real field being flagged.
  const names = new Set(
    Object.values(doc.nodes)
      .filter((n) => n.id !== doc.root_node_id)
      .map((n) => (typeof n.specials?.name === 'string' && n.specials.name.trim()) || n.id),
  );
  const v = FORM_RULE_VOCAB as { joins: readonly string[]; ops: readonly string[]; actions: readonly string[] };
  const dropped = 'and every reader drops the whole rule';
  list.forEach((r: Record<string, unknown> | null, i) => {
    const at = `rule ${i + 1}${r && typeof r.id === 'string' && r.id ? ` (${r.id})` : ''}`;
    if (!r || typeof r !== 'object') return add(`${at} is not an object, ${dropped}.`, 'Remove it.');
    if (typeof r.id !== 'string' || !r.id.trim()) add(`${at} has no id, ${dropped}.`, 'Give it a unique string id, e.g. "rule_1".');
    if (!v.joins.includes(r.join as string)) add(`${at} has join ${JSON.stringify(r.join)}, ${dropped}.`, `Use one of: ${v.joins.join(', ')}.`);
    const conds = Array.isArray(r.conditions) ? (r.conditions as Array<Record<string, unknown>>) : null;
    const targets = Array.isArray(r.targets) ? (r.targets as Array<Record<string, unknown>>) : null;
    if (!conds || !targets) return add(`${at} needs conditions[] and targets[] arrays, ${dropped}.`, 'Add both arrays.');
    if (conds.length === 0) add(`${at} has no conditions, so it never fires.`, 'Add at least one { field, op, value }.');
    const fieldNote = (f: unknown, role: string) => {
      if (typeof f !== 'string' || !names.has(f)) {
        add(
          `${at} ${role} ${JSON.stringify(f)}, which names no field in this form — a rule is keyed by a field's specials.name (its node id only when it has none).`,
          `Use one of: ${[...names].join(', ')}.`,
        );
      }
    };
    for (const c of conds) {
      if (!v.ops.includes(c?.op as string)) add(`${at} has op ${JSON.stringify(c?.op)}, ${dropped}.`, `Use one of: ${v.ops.join(', ')}.`);
      if (typeof c?.value !== 'string') add(`${at} has a non-string condition value, ${dropped}.`, 'Write value as a string ("" for filled/empty).');
      fieldNote(c?.field, 'conditions on');
    }
    const sources = new Set(conds.map((c) => c?.field));
    for (const t of targets) {
      if (!v.actions.includes(t?.action as string)) add(`${at} has action ${JSON.stringify(t?.action)}, ${dropped}.`, `Use one of: ${v.actions.join(', ')}.`);
      fieldNote(t?.field, 'targets');
      if (sources.has(t?.field)) {
        add(`${at} targets ${JSON.stringify(t?.field)}, which it also conditions on — hiding a field blanks its answer, so the rule flips itself.`, 'Target a different field.');
      }
    }
  });
  return out;
}

/** The same, for every node of a nested `sb_add` spec, as each will be born. */
export function specCheck(spec: NodeSpec): CheckedNote[] {
  const out: CheckedNote[] = [];
  const walk = (s: NodeSpec) => {
    const born = ELEMENTS[s.type]?.defaults.specials ?? {};
    if (s.config) out.push(...writeCheck(s.type, 'config', s.config));
    if (s.specials) out.push(...writeCheck(s.type, 'specials', s.specials, { specials: { ...born, ...s.specials } }));
    for (const c of s.children ?? []) walk(c);
  };
  walk(spec);
  return out;
}

/** The notes `say` has not said yet, deduped within the call too. */
export function sayChecks(checked: CheckedNote[], say: (key: string, body: string) => string | undefined): WriteNote[] {
  const seen = new Set<string>();
  return checked
    .filter((c) => !seen.has(c.once) && (seen.add(c.once), say(c.once, c.note.problem) !== undefined))
    .map((c) => c.note);
}
