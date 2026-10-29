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
import { FIELD_SKIN_BY_CONTROL, FIELD_SKIN_BY_NODE } from '../../catalog/fieldskin.generated.js';
import { FORM_RULE_VOCAB } from '../../catalog/formrules.generated.js';
import type { DocLike } from '../../core/tree.js';
import type { NodeSpec } from './builder.js';
import { fill } from './findings.js';
import { collectsValue, formFieldFindings, formFields, nameFromLabel } from './formdoc.js';
import { ICON_CONTROLS, ICON_KEYS } from '../../catalog/icons.generated.js';
import { TRANSLATABLE_SPECIALS } from '../../catalog/translations.generated.js';
import { INLINE_RICH } from '../../catalog/richtext.generated.js';
import { iconNote } from './icons.js';
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
  code:
    | 'unknown_key'
    | 'unknown_value'
    | 'unknown_icon'
    | 'animation'
    | 'dead_key'
    | 'precondition'
    | 'unsupported_setting'
    | 'form_rule'
    | 'form_field'
    | 'text_markup'
    | 'rich_dropped'
    | 'link_colour'
    | 'cascade_tail'
    | 'seed_override'
    | 'hidden_band';
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
 * Every icon picker's key is generated (`ICON_KEYS`) and added in `keysOf`.
 *
 * ponytail: hand-read, and only the rows the platform's own seeds exercise
 * (test/seed-sweep.test.ts). Upgrade: have codegen read every widget's
 * `specialKey`/`configKey` into the catalog, as it now does for IconPicker.
 */
const WIDGET_WRITES: Record<string, ['config' | 'specials', string]> = {
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
  for (const k of ICON_KEYS[type] ?? []) add(k.ns, [k.key]);
  // What a translation may rewrite is what the renderer reads: `textHtml` is
  // the rich half of `nodes.RichText(n, "text")` (render/nodes/helpers.go:1693),
  // seeded by nothing and offered by no trait row, so it was `unknown_key`.
  add('specials', TRANSLATABLE_SPECIALS[type]);
  // A control the trait registry does not describe is often an inspector row
  // named after the key it writes (`{ key: 'quickviewId', visible: false }` on
  // list-dataset), so its NAME counts as a key in either namespace — unless the
  // control is a WIDGET whose writes are generated: the `icon` picker writes
  // `specials.name`, so counting `icon` made `config.icon` look known and the
  // star rendered (TTG gap #24).
  const named = el.controls.filter((c) => !ICON_CONTROLS.includes(c) && !FIELD_SKIN_BY_CONTROL[c]);
  add('config', named);
  add('specials', named);
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

/** A tag a writer means as formatting, not a stray `<` in copy ("Giá < 100k"). */
const MARKUP = /<\/?(?:b|strong|i|em|u|s|span|br|a|p|div|small|mark|sup|sub|h[1-6])(?:\s[^>]*)?\/?>/i;

/**
 * What in a gated rich special `sanitize.IsInlineRepresentable` refuses: a tag
 * outside the editor schema's inline vocabulary, or an attribute outside the
 * global/per-tag allowlists, an href whose scheme can run script, or a
 * comment/doctype. Any one and `GateInlineRichSpecials` deletes the WHOLE value.
 * Held to the platform's shared fixture by test/storefront-defects-1028.
 */
function richOffenders(v: string): string[] {
  const out = new Set<string>();
  const tags: readonly string[] = INLINE_RICH.tags;
  const globalAttrs: readonly string[] = INLINE_RICH.globalAttrs;
  const tagAttrs = INLINE_RICH.tagAttrs as Record<string, readonly string[]>;
  const TAG = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
  // Go reads `<!`, `<?` and `</` + a non-letter as a comment — but only in
  // TEXT, so tags (and the quoted values inside them) are blanked first.
  if (/<[!?]|<\/[^a-zA-Z]/.test(v.replace(TAG, ' '))) out.add('<!-- -->');
  for (const m of v.matchAll(TAG)) {
    const tag = m[2].toLowerCase();
    if (!tags.includes(tag)) {
      out.add(`<${tag}>`);
      continue;
    }
    // The tokenizer returns no attributes for an END tag (TagAttr).
    if (m[1]) continue;
    for (const a of m[3].matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      const name = a[1].toLowerCase();
      if (!globalAttrs.includes(name) && !tagAttrs[tag]?.includes(name)) {
        out.add(`<${tag} ${name}>`);
        continue;
      }
      const scheme = name === 'href' ? unsafeScheme(a[2] ?? a[3] ?? a[4] ?? '') : null;
      if (scheme !== null) out.add(`<${tag} href="${scheme}:…">`);
    }
  }
  return [...out];
}

/**
 * The named references whose decoding can move safeURL's verdict — every entry
 * of x/net/html's table (v0.56.0) that yields `:` `/` `?` `#` or a character
 * strings.TrimSpace strips. Any other reference changes no verdict: undecoded
 * or decoded, it is not a scheme letter, so leaving it verbatim is exact.
 */
const VERDICT_ENTITIES: Record<string, string> = {
  'colon;': ':', 'sol;': '/', 'quest;': '?', 'num;': '#', 'Tab;': '\t', 'NewLine;': '\n',
  'nbsp;': '\u00a0', nbsp: '\u00a0', 'NonBreakingSpace;': '\u00a0', 'ensp;': '\u2002', 'emsp;': '\u2003',
  'emsp13;': '\u2004', 'emsp14;': '\u2005', 'numsp;': '\u2007', 'puncsp;': '\u2008', 'thinsp;': '\u2009',
  'ThinSpace;': '\u2009', 'hairsp;': '\u200a', 'VeryThinSpace;': '\u200a', 'MediumSpace;': '\u205f',
  'ThickSpace;': '\u205f\u200a',
};

/**
 * html.unescape(val, attribute=true), one pass: a numeric reference with or
 * without `;`; a named one only as spelled in the table, and one with no `;`
 * left alone when `=` follows (unescapeEntity's attribute rule).
 */
function unescapeAttr(s: string): string {
  return s.replace(/&(?:#[xX]([0-9a-fA-F]+);?|#(\d+);?|([a-zA-Z0-9]+;?))/g, (all, hex?: string, dec?: string, name?: string, at?: number) => {
    if (name !== undefined) {
      const ch = VERDICT_ENTITIES[name];
      return ch === undefined || (!name.endsWith(';') && s[at! + all.length] === '=') ? all : ch;
    }
    const x = parseInt(hex ?? dec!, hex ? 16 : 10);
    // 0x80–0x9F is remapped through Windows-1252 in Go; no target is a verdict
    // character, so the replacement character stands in for all of them.
    const bad = x === 0 || (x >= 0x80 && x <= 0x9f) || (x >= 0xd800 && x <= 0xdfff) || x > 0x10ffff;
    return String.fromCodePoint(bad ? 0xfffd : x);
  });
}

/** strings.TrimSpace's set (unicode.IsSpace) — U+0085 in, U+FEFF out, unlike String#trim. */
const GO_TRIM = /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;

/**
 * server/pkg/sanitize safeURL on the value the tokenizer hands it: null when
 * relative, http(s), mailto, tel or data:image/; else the decoded scheme.
 */
function unsafeScheme(raw: string): string | null {
  const t = unescapeAttr(raw).replace(GO_TRIM, '');
  const colon = t.indexOf(':');
  if (colon < 0) return null;
  const i = t.search(/[/?#]/);
  if (i >= 0 && i < colon) return null;
  const scheme = t.slice(0, colon).toLowerCase();
  if (['http', 'https', 'mailto', 'tel'].includes(scheme)) return null;
  return scheme === 'data' && t.toLowerCase().startsWith('data:image/') ? null : t.slice(0, colon);
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
          : /icon/i.test(k) && ICON_KEYS[type]?.length
            ? `${type} keeps its glyph in ${ICON_KEYS[type].map((i) => `${i.ns}.${i.key}`).join(' / ')} — write the icon name there.`
            : `Check the spelling against sb_traits_for "${type}"; a CSS property belongs in namespace ` +
              '"style". Ignore this if the key is newer than this catalog.',
      );
      continue;
    }
    const icon = iconNote(type, namespace, k, v);
    if (icon) {
      push(
        `icon:${type}.${namespace}.${k}=${JSON.stringify(v)}`,
        'unknown_icon',
        k,
        icon.problem,
        icon.near.length ? `Write one of: ${icon.near.join(', ')}.` : 'Find a name with sb_catalog_search query "icon:<word>".',
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
    // MARKUP IN PLAIN TEXT RENDERS ESCAPED: `RichText` prefers `<key>Html` and
    // otherwise HTML-escapes `<key>`, so "<b>83 Thái Hà</b>" reaches the shopper
    // with its tags showing. Only where the element HAS a rich twin to point at.
    if (namespace === 'specials' && typeof v === 'string' && MARKUP.test(v) && TRANSLATABLE_SPECIALS[type]?.includes(`${k}Html`)) {
      push(
        `text-markup:${type}.${k}`,
        'text_markup',
        k,
        `specials.${k} holds HTML tags, and ${type} renders it ESCAPED — the tags show as literal text on the page.`,
        `Write the markup to specials.${k}Html (the renderer prefers it) and keep a plain specials.${k} without tags beside it.`,
      );
    }
    // A RICH SPECIAL THE RENDER GATE DROPS WHOLE (scope.GateInlineRichSpecials):
    // one block tag and the node shows its escaped plain text — measured live
    // with <p> in textHtml, every bit of formatting gone and no error anywhere.
    const rich: readonly string[] = INLINE_RICH.specials;
    const bad = namespace === 'specials' && typeof v === 'string' && rich.includes(k) ? richOffenders(v) : [];
    if (bad.length) {
      push(
        `rich-dropped:${type}.${k}:${bad.join(',')}`,
        'rich_dropped',
        k,
        `specials.${k} holds ${bad.join(', ')}, which the editor's inline rich-text schema cannot produce — so the ` +
          `platform DROPS the whole value at render and shows the escaped plain specials.${k.replace(/Html$/, '')} instead, with no error.`,
        `Keep to ${INLINE_RICH.tags.map((t) => `<${t}>`).join(' ')}; break a paragraph with <br> (or <br><br>), ` +
          'never <p>/<div>, and put a separate block in its own node. A link goes to http(s), mailto, tel or a ' +
          'relative path; no comments.',
      );
    }
    // A LINK IN RICH TEXT IS THE BROWSER'S BLUE. Nothing styles `a` inside a
    // text node — no element control, no theme token — so an <a> with no colour
    // of its own paints the user-agent default rgb(0,0,238) (measured live on a
    // #2e86ae site, TTG gap #50). The inline-rich gate keeps `style` color.
    if (namespace === 'specials' && typeof v === 'string' && rich.includes(k) && !bad.length && unstyledLinks(v)) {
      push(`link-colour:${type}.${k}`, 'link_colour', k, LINK_COLOUR.problem, LINK_COLOUR.fix);
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

/** `<a …>` tags in rich text that set no colour of their own. */
export function unstyledLinks(html: string): number {
  return (html.match(/<a\b[^>]*>/gi) ?? []).filter((tag) => !/style\s*=\s*["'](?:[^"']*[;\s])?color\s*:/i.test(tag)).length;
}

export const LINK_COLOUR = {
  problem:
    "A link in this rich text has no colour of its own, so it renders in the browser's default link blue " +
    '(rgb(0,0,238)) with an underline — no element control or theme token reaches an <a> inside text.',
  fix: 'Give each <a> its colour inline: <a href="…" style="color:inherit"> (or the brand colour); the rich-text gate keeps a style color.',
};

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

/**
 * A write into an open FORM document, judged on the document it LEAVES: a field
 * it makes unanswerable (no options, a dead time slot, a third date on a
 * booking form), and a field it ADDS with no `specials.name`.
 *
 * The unnamed one is a note, not a defect: the editor leaves a new field's name
 * empty too (FieldNameRow.vue — "the node id is the honest resting value"), and
 * the platform posts the answer under the node id. But that id is what the
 * submissions table, the notification mail and every form rule then show, so
 * an agent that can name the field should. Only what this write introduced is
 * said; a page answers nothing.
 */
export function formDocChecks(before: DocLike, after: DocLike, formType?: string): CheckedNote[] {
  const out: CheckedNote[] = [];
  const had = new Set(formFieldFindings(before, formType).map((f) => `${f.code}:${f.nodeId}`));
  for (const f of formFieldFindings(after, formType)) {
    if (had.has(`${f.code}:${f.nodeId}`)) continue;
    out.push({
      once: `form-field:${f.code}:${f.nodeId}`,
      note: { code: 'form_field', id: f.nodeId, key: `specials.${f.key}`, problem: f.problem, fix: fill(f.code, { id: f.nodeId }) },
    });
  }
  for (const n of formFields(after)) {
    if (before.nodes[n.id] || !collectsValue(n.data.type)) continue;
    const name = n.specials?.name;
    if (typeof name === 'string' && name.trim()) continue;
    const label = typeof n.specials?.label === 'string' ? nameFromLabel(n.specials.label) : '';
    const suggest = label && label !== 'label' ? label : 'a_short_key';
    out.push({
      once: `form-field:unnamed:${n.id}`,
      note: {
        code: 'form_field',
        id: n.id,
        key: 'specials.name',
        problem:
          `${n.data.type} ${n.id} has no specials.name, so its answer posts under the node id "${n.id}" — ` +
          'which is what the submissions table, the notification mail and every form rule then show.',
        fix: `sb_set id "${n.id}", namespace specials, keys { "name": "${suggest}" } — unique within the form.`,
      },
    });
  }
  return out;
}

type Slots = { style?: Record<string, unknown>; responsive?: Record<string, { style?: Record<string, unknown> } | undefined> };

/**
 * THE CASCADE'S TAIL (trap 4). A key resolves current → wider → BASE →
 * narrower, so a style key written only at a narrower slot reaches DESKTOP
 * whenever neither base nor desktop declares it — a tablet `flexWrap: wrap`
 * broke a desktop header into two rows. `node` is the node AS IT WILL BE, with
 * its element defaults, so flex-block's seeded base `flexDirection: row` keeps
 * its own mobile column silent; `written` is what this write put at each slot.
 */
export function cascadeTail(node: Slots, written: Record<string, Record<string, unknown> | undefined>, id?: string): CheckedNote[] {
  const out: CheckedNote[] = [];
  for (const bp of ['laptop', 'tablet', 'mobile']) {
    for (const k of Object.keys(written[bp] ?? {})) {
      if (node.style?.[k] !== undefined || node.responsive?.desktop?.style?.[k] !== undefined) continue;
      out.push({
        once: `cascade-tail:${id ?? ""}:${k}`,
        note: {
          code: 'cascade_tail',
          ...(id ? { id } : {}),
          key: `style.${k}`,
          problem:
            `style.${k} is set at ${bp} and neither base nor desktop declares it. The cascade reads current → ` +
            `wider → BASE → narrower, so desktop renders the ${bp} value too.`,
          fix: `Say the wide-screen answer at base: sb_set id "${id ?? '<id>'}", namespace style, base:true, keys { "${k}": <desktop value> }.`,
        },
      });
    }
  }
  return out;
}

export type HiddenSlots = { config?: Record<string, unknown>; responsive?: Record<string, { config?: Record<string, unknown> } | undefined> };

/**
 * `config.hidden` IS PER BAND AND NEVER CASCADES (render/css.go hiddenAt,
 * editor trait/display.ts isHiddenAt): base hides the node at ≥1440px ONLY, and
 * laptop / tablet / mobile each read their own slot alone. An agent hiding at
 * base expects it gone everywhere, so say which bands still show it — once per
 * process, since the fact is the same for every node. `node` is AS IT WILL BE.
 */
export function hiddenBand(node: HiddenSlots, id?: string, above: readonly HiddenSlots[] = []): CheckedNote[] {
  if (node.config?.hidden !== true) return [];
  // A band an ANCESTOR hides there is not showing this node either (`above`).
  const shown = ['laptop', 'tablet', 'mobile'].filter((bp) =>
    [node, ...above].every((n) => n.responsive?.[bp]?.config?.hidden !== true),
  );
  if (!shown.length) return [];
  return [
    {
      once: 'hidden-band',
      note: {
        code: 'hidden_band',
        ...(id ? { id } : {}),
        key: 'config.hidden',
        problem:
          'config.hidden does not cascade: at base it hides the node at ≥1440px only; laptop (1025–1439), ' +
          `tablet (768–1024) and mobile (≤767) each read their own slot, so ${shown.join(', ')} still show it.`,
        fix:
          `To hide it at every width, also write hidden:true at breakpoint ${shown.map((b) => `"${b}"`).join(', ')} — ` +
          'one sb_set with edits[] (sb_add: responsive.<bp>.config). To drop it from the page instead, sb_remove it.',
      },
    },
  ];
}

/** The same, for every node of a nested `sb_add` spec, as each will be born. */
export function specCheck(
  spec: NodeSpec,
  idOf?: ReadonlyMap<NodeSpec, string>,
  above: readonly HiddenSlots[] = [],
): CheckedNote[] {
  const out: CheckedNote[] = [];
  const walk = (s: NodeSpec, up: readonly HiddenSlots[]) => {
    // addSubtree's minted id, so a per-node note names (and dedupes on) its node.
    const id = idOf?.get(s);
    const d = ELEMENTS[s.type]?.defaults;
    const born = d?.specials ?? {};
    if (s.config) out.push(...writeCheck(s.type, 'config', s.config));
    // Born as addSubtree stores it: a desktop-slot `hidden` lands at base.
    const self: HiddenSlots = { config: { hidden: s.responsive?.desktop?.config?.hidden ?? s.config?.hidden }, responsive: s.responsive };
    out.push(...hiddenBand(self, id, up));
    for (const slot of Object.values(s.responsive ?? {})) if (slot.config) out.push(...writeCheck(s.type, 'config', slot.config));
    if (s.responsive) {
      const seeded = (d?.responsive ?? {}) as Slots['responsive'];
      const node: Slots = {
        style: { ...((d?.style ?? {}) as Record<string, unknown>), ...s.style },
        responsive: { desktop: { style: { ...seeded?.desktop?.style, ...s.responsive.desktop?.style } } },
      };
      out.push(...cascadeTail(node, Object.fromEntries(Object.entries(s.responsive).map(([bp, slot]) => [bp, slot.style])), id));
    }
    if (s.specials) out.push(...writeCheck(s.type, 'specials', s.specials, { specials: { ...born, ...s.specials } }));
    // The element's OWN seed flipping the axis the caller wrote at base, at a
    // width the caller left unsaid: flex-block seeds `mobile.flexDirection:
    // column` (the editor drops it the same way), so a row written at base
    // stacks at 390 (TTG gap #26). The axis only — a seeded mobile gap is spacing.
    for (const [bp, slot] of Object.entries((d?.responsive ?? {}) as Record<string, { style?: Record<string, unknown> }>)) {
      for (const [k, v] of Object.entries(slot?.style ?? {})) {
        if (k !== 'flexDirection' || !s.style || !(k in s.style) || s.style[k] === v) continue;
        if ((s.responsive?.[bp as 'mobile']?.style ?? {})[k] !== undefined) continue;
        out.push({
          once: `seed-override:${s.type}.${bp}.${k}`,
          note: {
            code: 'seed_override',
            ...(id ? { id } : {}),
            key: `style.${k}`,
            problem: `${s.type} seeds responsive.${bp}.style.${k} = ${JSON.stringify(v)} (as the editor does), so the ${JSON.stringify(s.style[k])} written at base does not hold at ${bp}.`,
            fix: `If it should, say it: responsive: { ${bp}: { style: { ${k}: ${JSON.stringify(s.style[k])} } } } in the spec, or sb_set breakpoint "${bp}".`,
          },
        });
      }
    }
    for (const c of s.children ?? []) walk(c, [self, ...up]);
  };
  walk(spec, above);
  return out;
}

/** The notes `say` has not said yet, deduped within the call too. */
export function sayChecks(checked: CheckedNote[], say: (key: string, body: string) => string | undefined): WriteNote[] {
  const seen = new Set<string>();
  return checked
    .filter((c) => !seen.has(c.once) && (seen.add(c.once), say(c.once, c.note.problem) !== undefined))
    .map((c) => c.note);
}
