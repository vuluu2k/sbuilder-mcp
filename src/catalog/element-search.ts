import { ELEMENTS, TRAIT_WRITES } from './elements.generated.js';
import { animationValues, animationVocabulary, vocabulariesForWrites } from '../domains/site/vocabulary.js';
import { neverTranslatedOn, translatableSpecials } from '../domains/site/translate.js';

/** Eight to choose from; the hints for the chosen one come with sb_traits_for. */
export const DEFAULT_CATALOG_LIMIT = 8;

export interface CatalogMatch {
  type: string;
  label: string;
  category: string;
  description: string;
  isContainer?: true;
  isRootOnly?: true;
  useWhen?: string[];
  avoidWhen?: string[];
  contentTips?: string[];
}

/**
 * Four fields to CHOOSE by.
 *
 * The old shape returned nine fields per element including three lists of
 * hints — ~720 chars each, 7 KB for a default page of ten. An agent chooses
 * from a description and reads the hints for the one it chose, which is what
 * `traitsFor` now carries. `detail: true` restores the hints per match.
 */
export function catalogMatches(
  query: string,
  opts: { limit?: number; detail?: boolean } = {},
): CatalogMatch[] {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return Object.values(ELEMENTS)
    .map((el) => {
      const hay = [el.type, el.label, el.category, el.description, ...el.semantics, ...el.useWhen]
        .join(' ')
        .toLowerCase();
      return { el, score: terms.filter((t) => hay.includes(t)).length };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.el.type.localeCompare(b.el.type))
    .slice(0, opts.limit ?? DEFAULT_CATALOG_LIMIT)
    .map(({ el }) => ({
      type: el.type,
      label: el.label,
      category: el.category,
      description: el.description,
      ...(el.isContainer ? { isContainer: true as const } : {}),
      ...(el.isRootOnly ? { isRootOnly: true as const } : {}),
      ...(opts.detail
        ? { useWhen: el.useWhen, avoidWhen: el.avoidWhen, contentTips: el.contentTips }
        : {}),
    }));
}

/**
 * What one inspector control writes.
 *
 * 118 of the 435 controls declare it in the platform's trait registry. The rest
 * live inside a Vue widget's prop closure, which is not machine-readable — so
 * they come back named but undescribed, with the honest reason. Saying nothing
 * would read as "this control writes nothing".
 */
export function describeControl(key: string): Record<string, unknown> {
  const d = TRAIT_WRITES[key];
  if (!d) {
    return {
      writes: null,
      note:
        'The platform does not declare what this control writes (its widget builds the ' +
        'binding in Vue). Read a node that already uses it with sb_node_read, or set the ' +
        'CSS property directly — style is open.',
    };
  }
  return { label: d.label, writes: d.writes, ...(d.defaults ? { defaults: d.defaults } : {}) };
}

export const STYLE_NOTE =
  'The `style` namespace is OPEN CSS: any camelCase key becomes a CSS property ' +
  '(schema/src/satelliteCss.ts camelToKebab), so you can set anything CSS can express, ' +
  'whether or not a control exists for it. `config` and `specials` are NOT open — they are ' +
  "per-element, and this element's `defaults` name the keys it actually uses.";

const UNDECLARED_NOTE =
  'Controls not listed under `declared` build their write in a Vue widget the platform does ' +
  'not describe. Read a node that already uses one with sb_node_read, or set the CSS property ' +
  'directly — style is open. Pass control:"<name>" to read one control.';

/**
 * The inspector as NAMES, plus the declared writes in full.
 *
 * The old shape repeated a 150-char "undeclared" note under every one of the
 * 317 controls with no declared write target — list-dataset alone was 74 KB.
 * Now the note is said once, and the AI hints ride here because this is the
 * call an agent makes once it has chosen the element.
 */
export function traitsFor(type: string, control?: string): Record<string, unknown> {
  const el = ELEMENTS[type];
  if (!el) throw new Error(`sbuilder: unknown element "${type}" — use sb_catalog_search`);

  if (control) {
    if (!el.controls.includes(control)) {
      throw new Error(
        `sbuilder: ${type} has no control "${control}". It has: ${el.controls.join(', ')}.`,
      );
    }
    return { type, control, ...describeControl(control) };
  }

  const declared: Record<string, unknown> = {};
  for (const c of el.controls) if (TRAIT_WRITES[c]) declared[c] = describeControl(c);

  return {
    type: el.type,
    hints: { useWhen: el.useWhen, avoidWhen: el.avoidWhen, contentTips: el.contentTips },
    inspector: el.inspector.map((t) => ({
      tab: t.tab,
      groups: t.groups.map((g) => ({ group: g.label, controls: g.controls })),
    })),
    declared,
    // The keys this element actually seeds. For `config` and `specials` —
    // which, unlike `style`, are NOT open — this is the machine-readable
    // answer to "what does this element store", and often the only one.
    defaults: el.defaults,
    // WHICH OF THIS ELEMENT'S STRINGS A TRANSLATION MAY REWRITE. Translating one
    // of the others does not degrade the page, it BREAKS the render — `name` is
    // a lucide icon id, `src` a URL, `filterSource` a registry id the renderer
    // switches on. An empty list is the complete answer for an element whose
    // only string is one of those, so it is reported rather than omitted.
    ...(() => {
      const may = translatableSpecials(el.type);
      const own = Object.keys(el.defaults?.specials ?? {});
      const never = neverTranslatedOn(el.type, own);
      if (!may.length && !never.length) return {};
      return {
        translatable: {
          specials: may,
          ...(never.length ? { never_translate: never } : {}),
        },
      };
    })(),
    // WHAT THOSE KEYS ARE ALLOWED TO HOLD, for the few where guessing wrong is
    // silent. Attached to the ELEMENT rather than to a control, because the keys
    // that most need it are exactly the UNDECLARED ones: `collectionType` is in
    // this element's defaults and in its control list, and no TRAIT_WRITES entry
    // names it — so a per-control attachment reaches none of them, which is how
    // the first version of this was wrong.
    ...(() => {
      const keys = new Set([...Object.keys(el.defaults?.config ?? {}), ...el.controls]);
      const vocab = vocabulariesForWrites([...keys]);
      return Object.keys(vocab).length ? { config_values: vocab } : {};
    })(),
    // THE ENTRANCE ANIMATION, for the 73 element types that offer it. It does
    // not ride in `config_values` because it is not a word — it is an OBJECT
    // with a required gate, and the three ways to get it wrong all render
    // NOTHING rather than something else. An element that does not offer the
    // control says nothing, so this is silent on the other 38.
    ...(el.controls.includes('animation')
      ? { animation: animationVocabulary(), animation_values: animationValues() }
      : {}),
    isContainer: el.isContainer,
    isRootOnly: el.isRootOnly,
    childAllows: el.childAllows,
    undeclared_note: UNDECLARED_NOTE,
    style_is_open_css: STYLE_NOTE,
  };
}
