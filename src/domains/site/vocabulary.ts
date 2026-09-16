import { DEAD_KEYS } from '../../catalog/deadkeys.generated.js';
import { ANIMATION, CONFIG_VALUES, ELEMENT_VALUES,
  WRITE_PRECONDITIONS,
} from '../../catalog/elements.generated.js';
import type { DeadKey, ValueVocabulary } from '../../catalog/element-types.js';

/**
 * WHAT A CONFIG KEY IS ALLOWED TO HOLD, AND WHAT A GUESS BECOMES.
 *
 * `sb_traits_for` names 138 controls with a declared write target, and not one
 * of them said what values that target accepts: every trait in the platform's
 * registry declares `schema: { type: 'string' }`, because the vocabulary lives
 * in the Vue component that draws the picker — a place no agent can read.
 *
 * So an agent was told "this control writes `config.collectionType`" and had to
 * guess the word. THE GUESS FAILS SILENTLY, and the platform's own test says so:
 * `EffectiveCollectionType("bestseller")` returns `all_products`
 * (`render/tests/collection_test.go:227`). A repeater set to a plausible word —
 * `bestseller`, `featured_products`, `newest` — stores, saves, publishes, and
 * renders THE WHOLE CATALOGUE under whatever heading the author wrote above it.
 * There is no error at any step and nothing on the page looks broken; it looks
 * like a shelf that is working.
 *
 * This is the same family as a binding outside the `specials` namespace and a
 * `stuck` override with no host: a value the document stores, the platform
 * accepts, and no renderer reads the way the author meant.
 *
 * NO NEW TOOL. The table rides inside `sb_traits_for`'s RESULT and `sb_set`'s
 * warning — the tool list does not grow, which is the whole point: this server
 * answers 486 operations through one call sheet rather than a tool per surface,
 * and a vocabulary is knowledge, not a verb.
 */

export interface Vocabulary {
  values: string[];
  fallback: string;
  aliases: Record<string, string>;
  readBy: string;
}

/** The vocabulary for a config key, or null when the key has no fixed one. */
export function vocabularyFor(key: string): Vocabulary | null {
  return CONFIG_VALUES[key] ?? null;
}

/** Every config key this catalog knows the legal values of. */
export function vocabularyKeys(): string[] {
  return Object.keys(CONFIG_VALUES);
}

/**
 * The vocabularies relevant to one element, keyed by config key.
 *
 * Matched against the element's DECLARED write targets rather than offered
 * wholesale: `collectionListType` on a heading is noise, and noise in a result
 * an agent reads before every styling decision is its own kind of dilution.
 */
export function vocabulariesForWrites(writeKeys: readonly string[]): Record<string, Vocabulary> {
  const out: Record<string, Vocabulary> = {};
  for (const k of writeKeys) {
    const v = vocabularyFor(k);
    if (v) out[k] = v;
  }
  return out;
}

/**
 * The warning for a config write whose value is outside the vocabulary.
 *
 * A WARNING, not a refusal, and the distinction is deliberate. The platform
 * ACCEPTS the value — `EffectiveX` is a normaliser, not a validator — so a
 * refusal here would invent a rule the platform does not have, and would block a
 * caller writing a value a newer deployment understands and this catalog does
 * not. What the caller cannot get anywhere else is what the value will DO.
 *
 * An ALIAS is not a mistake and must not be reported as one: `category` is a
 * working spelling of `collection` that the picker never writes, so a document
 * holding it is correct and an agent told otherwise would "fix" a working page.
 */
export function unknownValueNote(key: string, value: unknown): string | null {
  const vocab = vocabularyFor(key);
  if (!vocab || typeof value !== 'string') return null;
  if (vocab.values.includes(value)) return null;
  if (value in vocab.aliases) return null;
  return (
    `config.${key} = ${JSON.stringify(value)} is not a value the renderer knows. ` +
    `${vocab.readBy} normalises anything unrecognised to "${vocab.fallback}", so this stores, ` +
    `saves and publishes with no error and renders as "${vocab.fallback}". The values that do ` +
    `something: ${vocab.values.join(', ')}` +
    (Object.keys(vocab.aliases).length
      ? ` (plus ${Object.entries(vocab.aliases)
          .map(([a, c]) => `"${a}" which means "${c}"`)
          .join(', ')})`
      : '') +
    '.'
  );
}

/* ------------------------------------------------------------------------ *
 * THE SAME QUESTION FOR THE REST OF THE CATALOG, SCOPED TO AN ELEMENT.
 *
 * `CONFIG_VALUES` above answers three keys and is keyed by the config key. That
 * works only because those three names happen to be globally unique, and the
 * rest are not: `config.layout` means one set of words on `media-dataset` and
 * another on `list-dataset`, `specials.source` is written by `breadcrumb_source`
 * (auto|manual) and by `qr_source` (text|page), and three renderers read
 * `config.placement` with three different case sets. A key-keyed table hands one
 * element another element's answer — which is not a smaller version of the
 * failure this file exists to prevent, it IS that failure, arriving through the
 * thing that was supposed to fix it.
 *
 * So the scope is the ELEMENT, which is what both callers already hold:
 * `sb_traits_for` answers for one element, and `sb_set` knows the node's type.
 * ------------------------------------------------------------------------ */

/** Every key on one element whose legal values this catalog knows. */
export function elementVocabularies(type: string): Record<string, ValueVocabulary> {
  return ELEMENT_VALUES[type] ?? {};
}

/**
 * The `*` scope, narrowed to the element that actually carries the key.
 *
 * A shared renderer helper reads a key on behalf of MANY elements, so its
 * vocabulary has no element to belong to. `backgroundSceneSource` is the live
 * case: the platform's 3D section background is seeded by `flex-section`,
 * `flex-block` and `dataset-block` and read by `nodes/helpers.go`, so it is real
 * on three elements and noise on the other 110. The element's own SEEDED
 * defaults decide — a key it does not store is a key it does not have.
 */
export function sharedVocabularies(defaults: {
  config?: Record<string, unknown>;
  specials?: Record<string, unknown>;
}): Record<string, ValueVocabulary> {
  const out: Record<string, ValueVocabulary> = {};
  for (const [k, v] of Object.entries(ELEMENT_VALUES['*'] ?? {})) {
    if (v.writeKey in (defaults[v.target] ?? {})) out[k] = v;
  }
  return out;
}

/**
 * The vocabulary for one WRITE — a namespace and a key, which is what `sb_set`
 * has and a control name is not.
 *
 * The `*` scope is a key read by a SHARED renderer helper rather than by one
 * element's own (`backgroundSceneSource` is section background, offered by
 * many), so it answers only where the element has nothing of its own to say.
 */
export function vocabularyForWrite(
  type: string,
  namespace: string,
  key: string,
): ValueVocabulary | null {
  if (namespace !== 'config' && namespace !== 'specials') return null;
  for (const table of [ELEMENT_VALUES[type], ELEMENT_VALUES['*']]) {
    for (const v of Object.values(table ?? {})) {
      if (v.target === namespace && v.writeKey === key) return v;
    }
  }
  return null;
}

/**
 * The warning for a write whose value is outside the element's vocabulary.
 *
 * A WARNING and never a refusal, for the reason `unknownValueNote` records: the
 * platform stores what it is given, so a refusal would invent a rule it does
 * not have and would block a caller writing a word a newer deployment knows.
 *
 * TWO THINGS THIS SAYS DIFFERENTLY FROM ITS SIBLING, both because the source is
 * different rather than because the wording drifted:
 *
 *   - AN OPEN VOCABULARY IS NOT A LIST OF THE ONLY LEGAL VALUES. A renderer that
 *     ends `default: return mode` hands anything unlisted straight to CSS, so
 *     `mediaImageRatio: "4 / 5"` is CORRECT and reporting it would send a caller
 *     to "fix" a working page — the same cost this repo already records for the
 *     `category` alias. Nothing is said at all.
 *   - A FALLBACK IS ONLY CLAIMED WHERE A SOURCE SAYS ONE, AND IT IS CREDITED TO
 *     THAT SOURCE. The editor's picker proves what an author may choose and is
 *     silent on what the renderer does with anything else. Naming a fallback
 *     there would be the invention this table exists to remove, so the note says
 *     what it knows and stops. Where a schema declaration has SUPERSEDED a Go
 *     reading the two halves come from different places — the list says which
 *     words mean something, the renderer's `default:` arm says what an unknown
 *     one renders as — so the sentence names `fallbackReadBy`, not the
 *     declaration, which normalises nothing.
 */
export function unknownWriteNote(
  type: string,
  namespace: string,
  key: string,
  value: unknown,
): string | null {
  const vocab = vocabularyForWrite(type, namespace, key);
  if (!vocab || typeof value !== 'string') return null;
  if (vocab.open) return null;
  if (vocab.values.includes(value)) return null;
  const list = vocab.values.map((v) => (v === '' ? '"" (unset)' : v)).join(', ');
  return (
    `${namespace}.${key} = ${JSON.stringify(value)} is not a value ${type}'s renderer knows. ` +
    (vocab.fallback !== undefined
      ? `${vocab.fallbackReadBy ?? vocab.readBy} normalises anything unrecognised to ${
          vocab.fallback === '' ? '"" (unset)' : `"${vocab.fallback}"`
        }, so this stores, saves and publishes with no error and renders as that. `
      : `${vocab.readBy} is the source, and it is silent on what the renderer does with a word ` +
        'outside the list — every comparable key in this catalog normalises silently rather ' +
        'than erroring. ') +
    `The values that do something: ${list}.`
  );
}

/**
 * THE ENTRANCE ANIMATION, WHICH 73 OF 111 ELEMENTS OFFER AND NOTHING DESCRIBED.
 *
 * Same family as the vocabularies above and worse in one way: there are THREE
 * ways to miss and all of them are silent, because `AnimationTypeOf` answers ""
 * and `render/css.go` then emits no keyframes, no rule and no error — through
 * save, publish and render.
 *
 *   - IT IS AN OBJECT, not the string the control's name invites.
 *     `readAnimConfig` asserts `map[string]interface{}`, so a bare
 *     `"fade_in"` is the zero value and the node never animates.
 *   - `active: true` IS REQUIRED, and a stored `type` is deliberately NOT
 *     consent. The platform's own comment gives the reason: the panel keeps
 *     `type` when the switch goes off, so switching back restores the choice —
 *     "treating a stored type as consent would animate a node the author had
 *     explicitly turned off".
 *   - THE TYPE IS UNDERSCORED. `AnimKeyframes`'s comment flags it outright:
 *     "keyed by the STORED value (`fade_in`, not `fade-in`)". `fade-in` is the
 *     spelling every other web tool uses and the one an agent reaches for.
 *
 * `easing` is the mild case and is reported differently: an unrecognised value
 * falls back to `ease`, so the animation still runs — it is a wrong answer, not
 * a missing one.
 *
 * IT WAS BASE-ONLY AND IS NOT ANY MORE, and the correction is kept in that
 * shape because this file stated it as a settled fact. The compiler used to
 * index `node.Config["animation"]` with no responsive merge, so a per-breakpoint
 * write landed where nothing looked and `baseonly.ts` ROUTED it. Adding an
 * intensity ended that: a distance is a QUANTITY, and this repo's own mandate is
 * that a quantity reaches the page per breakpoint. `CompileEntranceAnimationCSS`
 * now takes a `bp` and emits per lane, the key left the platform's ledger, and
 * the routing stopped on its own — the table is generated, which is exactly why
 * it could. What the caller gains is the thing merchants ask for most: an
 * animation that is off on mobile.
 *
 * THE OBJECT ALSO GREW TO TEN KEYS, and two of them change what is possible
 * rather than merely how it looks:
 *
 *   - `trigger: "view"` IS REVEAL-ON-SCROLL, which this repo recorded as having
 *     no answer at all ("the platform has nowhere to put it"). It does now:
 *     `animation-timeline: view()` inside an `@supports` override, no island and
 *     no JavaScript, with the engines that lack it still animating at first
 *     paint. A note that says "you cannot" outlives the thing that made it true,
 *     and this is the third time that has cost something here.
 *   - `repeat` + `alternate` is the one combination that publishes an INVISIBLE
 *     node. `alternate` with an EVEN finite count finishes on the `from`
 *     keyframe and every entrance keyframe starts at `opacity: 0`, so the author
 *     sees it on the canvas and a visitor never sees it at all. The compiler
 *     honours `alternate` only alongside `"infinite"`.
 */
export const ANIMATION_VOCAB = ANIMATION;

/**
 * Everything a caller needs to write config.animation correctly, in ONE LINE.
 *
 * It rides on 73 of the 111 elements, and `sb_traits_for` is the result an agent
 * reads before every styling decision — so the first version of this, a
 * six-field object, was 400 bytes of dilution on two thirds of the catalog and
 * pushed the search-result budget over its ceiling. The budget test was right:
 * the four facts fit in a sentence, and a sentence is what a reader takes in
 * anyway. The long form lives in `animationNote`, which fires at the moment the
 * mistake is actually made.
 */
export function animationVocabulary(): string {
  return (
    'config.animation is an OBJECT, never a string: { active: true, type, easing?, intensity?, ' +
    'trigger?, delay?, duration?, repeat?, alternate?, range? }. active:true is REQUIRED (a type ' +
    'alone is not consent) and the type is UNDERSCORED (fade_in, never fade-in); either miss ' +
    'renders no animation at all, with no error. Written per breakpoint like any config, so it ' +
    'can be off on mobile. See animation_values below for what each key accepts.'
  );
}

/**
 * THE SAME FACTS AS DATA, because forty-six type names are not a sentence.
 *
 * The line above used to enumerate every type, which worked while there were
 * four and became 848 bytes of prose the moment the platform shipped 46 — and
 * the budget test caught it, correctly, for the second time on this same field.
 * The first catch (a six-field object, 12,396 bytes) moved the long form OUT of
 * the trait sheet; this one moves the ENUMERATION out of the prose. What is left
 * in the sentence is what decides whether a write does anything at all.
 *
 * It rides on `sb_traits_for`, which answers for ONE element per call, and not
 * on `sb_catalog_search`, which answers for many — so the cost is paid once by
 * the caller who has already chosen the element it is about to animate.
 *
 * Every value here is GENERATED from the Go that renders, so a platform that
 * adds a trigger or an intensity brings it to this sheet on the next codegen,
 * and one that drops a field stops claiming it.
 */
export function animationValues(): Record<string, unknown> {
  const a = ANIMATION;
  const mid = a.intensities[Math.floor(a.intensities.length / 2)];
  return {
    type: a.types,
    easing: { values: a.easings, unknown_falls_back_to: a.easingFallback },
    // `absence is not the middle setting` is the platform's own point and the
    // one reading a caller gets wrong without being told; the rest of the
    // intensity story is a duration table, which speaks for itself.
    ...(a.intensities.length
      ? {
          intensity: {
            values: a.intensities,
            implies_duration_s: a.intensityDurations,
            note: `omitting it is NOT "${mid}" — it keeps the ${a.durationDefault}s default instead`,
          },
        }
      : {}),
    // THE ONE ENTRY THAT MUST BE PROACTIVE. Every other trap here is caught by
    // animationNote at the moment of the mistake — but there is no mistake to
    // catch in never knowing a capability exists, so reveal-on-scroll has to be
    // discoverable from the sheet itself.
    ...(a.triggers.length
      ? {
          trigger: {
            values: a.triggers,
            default: 'omitted = runs at first paint',
            view: `reveal-on-scroll (animation-timeline), range = % of entry, default ${a.rangeDefault}`,
          },
        }
      : {}),
    ...(a.repeatMax ? { repeat: `1-${a.repeatMax} or "infinite"; above that is clamped` } : {}),
    ...(a.alternateNeedsInfinite
      ? { alternate: 'requires repeat:"infinite" — DROPPED on a finite count, which would end invisible' }
      : {}),
    duration_default_s: a.durationDefault,
    read_by: a.readBy,
  };
}

/**
 * The warning for a `config.animation` write that will not animate.
 *
 * A WARNING rather than a refusal, for the reason `unknownValueNote` records:
 * the platform STORES whatever it is given. But unlike a normalised string,
 * every miss here renders NOTHING rather than something else — so the note says
 * what will happen, not merely what the value is not.
 */
export function animationNote(value: unknown): string | null {
  const has = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  const types = ANIMATION.types.join(', ');
  if (!has(value)) {
    return (
      `config.animation is an OBJECT, not a ${typeof value === 'string' ? 'string' : typeof value}: ` +
      `{ active: true, type: "<one of ${types}>", easing, delay, duration }. The renderer reads it ` +
      'as map[string]interface{}, so this value is the zero value and the node will not animate — ' +
      'stored, saved and published with no error at any step.'
    );
  }
  const notes: string[] = [];
  if (value.active !== true) {
    notes.push(
      'active:true is missing, and a type alone is deliberately not consent — the panel keeps the ' +
        'type when the switch goes off, so the renderer emits nothing without it',
    );
  }
  const t = value.type;
  if (typeof t !== 'string' || !ANIMATION.types.includes(t)) {
    const near = typeof t === 'string' ? t.replace(/-/g, '_') : '';
    notes.push(
      `type ${JSON.stringify(t)} is not one of ${types}` +
        (near && ANIMATION.types.includes(near)
          ? ` — the stored spelling uses UNDERSCORES, so you want "${near}"`
          : '') +
        '; an unrecognised type emits no keyframes and no rule',
    );
  }
  const e = value.easing;
  if (e !== undefined && (typeof e !== 'string' || !ANIMATION.easings.includes(e))) {
    // The mild one: the animation still RUNS, wearing the wrong curve.
    notes.push(
      `easing ${JSON.stringify(e)} is outside ${ANIMATION.easings.join(', ')}, so the renderer ` +
        `uses "${ANIMATION.easingFallback}" — the animation runs, with a curve you did not choose`,
    );
  }
  const i = value.intensity;
  if (i !== undefined && (typeof i !== 'string' || !ANIMATION.intensities.includes(i))) {
    // Same family as easing — it runs — but the miss is quieter still: no
    // variables are emitted and the keyframes fall back to their own literals,
    // so the node animates at a distance nobody chose and nothing looks broken.
    notes.push(
      `intensity ${JSON.stringify(i)} is outside ${ANIMATION.intensities.join(', ')}, so no ` +
        'intensity variables are emitted and the keyframes use their built-in distances',
    );
  }
  const tr = value.trigger;
  if (tr !== undefined && (typeof tr !== 'string' || !ANIMATION.triggers.includes(tr))) {
    notes.push(
      `trigger ${JSON.stringify(tr)} is not ${ANIMATION.triggers.map((v) => JSON.stringify(v)).join(' or ')}, ` +
        'so the animation runs at first paint rather than on scroll — stored, published, and ignored',
    );
  }
  // THE ONE THAT PUBLISHES AN INVISIBLE NODE. `alternate` is honoured only
  // alongside an infinite repeat: with an even finite count the animation
  // finishes on the `from` keyframe, and every entrance keyframe starts at
  // opacity:0. The author sees it play on the canvas and the visitor sees
  // nothing at all, with no error anywhere to explain it.
  if (ANIMATION.alternateNeedsInfinite && value.alternate === true && value.repeat !== 'infinite') {
    notes.push(
      'alternate:true is DROPPED unless repeat is "infinite" — with an even finite count the ' +
        'animation would finish on the from keyframe, which is opacity:0, and publish a node no ' +
        'visitor can see; the renderer refuses that rather than shipping it',
    );
  }
  if (typeof value.repeat === 'number' && ANIMATION.repeatMax && value.repeat > ANIMATION.repeatMax) {
    notes.push(
      `repeat ${value.repeat} is clamped to ${ANIMATION.repeatMax} — the count reaches CSS as a ` +
        'number, and a document is not a trusted source',
    );
  }
  if (!notes.length) return null;
  return `config.animation will not do what this says. ${notes.join('. ')}.`;
}

/* ------------------------------------------------------------------------ *
 * AND THE KEY THAT IS NOT A WRONG WORD BUT A DEAD ONE.
 *
 * Everything above answers "this value means something other than you think".
 * This answers the quieter one: the key itself is read by nothing, so NO value
 * means anything. An element seeds it, `sb_node_read` returns it, an agent
 * following design rule 0 reads it off the node and writes a different one —
 * and the write stores, saves, publishes and renders exactly as before.
 *
 * IT PROTECTS THE HUMAN AND NOT THE AGENT, which is the asymmetry CLAUDE.md
 * already records for `BASE_ONLY_CONFIG`: the inspector draws no row for a key
 * nothing renders, so a merchant cannot reach it, and an agent can reach it on
 * every call.
 * ------------------------------------------------------------------------ */

/** The dead key this write names, or null. `style` is out of scope — it is CSS. */
export function deadKeyFor(namespace: string, key: string): DeadKey | null {
  if (namespace !== 'config' && namespace !== 'specials') return null;
  return DEAD_KEYS[key] ?? null;
}

/**
 * The warning for a write to a key no renderer reads.
 *
 * A WARNING and never a refusal, for the reason `unknownValueNote` records: the
 * platform stores what it is given, and refusing would invent a rule it does not
 * have — here it would also refuse the write that a deployment newer than this
 * catalog has finally wired up.
 *
 * It says what HAPPENS rather than that the key is unknown, because "unknown"
 * invites a retry with a different spelling and there is no spelling that works.
 */
export function deadKeyNote(namespace: string, key: string): string | null {
  const dead = deadKeyFor(namespace, key);
  if (!dead) return null;
  // The namespaces come from the SEED, not from this write: the index is flat,
  // so `specials.splitDirection` is just as dead as the `config` one the element
  // actually seeds, and claiming it was seeded where it was not would be a
  // confident wrong fact inside a note about a silent one.
  const seeds = `${dead.seededBy.join(', ')} (in ${dead.namespaces.join(' and ')})`;
  return (
    `${namespace}.${key} is seeded by ${seeds} and read by NOTHING in the platform — not the Go ` +
    'renderer, not the editor, not the runtime. This write stores, saves and publishes with no ' +
    'error and renders exactly as it did before; no value for it does anything. The inspector ' +
    'draws no row for it either, so only an agent can reach it. Nothing here can fix that — the ' +
    `fix is upstream, in schema/src/elements/${dead.seededBy[0]}/meta.ts.`
  );
}

/**
 * THE WARNING A PER-KEY VOCABULARY CANNOT GIVE.
 *
 * Every table above publishes ONE key's legal values, so a write whose values
 * are each legal passes in silence — and several combinations in this platform
 * are legal apart and meaningless together. `filterValueMode: "auto"` with
 * `filterSource: "blog_category"` is the one that prompted this: both values
 * are real, the pair stores, saves, publishes, and renders an empty filter,
 * with no error at any layer. A caller had no way to see it coming.
 *
 * Takes the node AS IT WILL BE — the caller merges its write in first — because
 * these are questions about the finished node. Asking about one key alone is
 * exactly the blindness being fixed.
 *
 * A WARNING AND NEVER A REFUSAL, the rule its siblings above already follow:
 * the platform stores what it is given, so refusing would invent a rule it does
 * not have, and a newer deployment may honour a combination this catalog was
 * generated before. The sentence says what the PAGE does, never "invalid".
 */
/**
 * One clause against one stored value — a MIRROR of `holds` in
 * schema/src/filters/preconditions.ts, and the two must agree.
 *
 * `null` in a clause means NOT SET, which is a real state rather than a hole:
 * a node written before a key existed does not carry it, and both renderers
 * then read their own fallback. Without this mapping the two copies disagreed
 * within an hour of being written — this one called a perfectly good tag filter
 * broken, which is a FALSE POSITIVE and worse than the silence the whole
 * mechanism replaced, because a caller warned about correct work stops reading
 * the warnings.
 *
 * It is a copy because this package has no runtime dependency on the schema —
 * the table arrives as generated data. The cases that separate the two are
 * asserted on both sides (`test/write-preconditions.test.ts` here,
 * `schema/test/filter-preconditions.test.ts` there) rather than left to the
 * reading.
 */
function holdsClause(c: { anyOf: (string | boolean | null)[] }, stored: unknown): boolean {
  return c.anyOf.includes(stored === undefined ? null : (stored as string | boolean));
}

export function preconditionNotes(
  type: string,
  specials: Readonly<Record<string, unknown>>,
): string[] {
  const out: string[] = [];
  for (const p of WRITE_PRECONDITIONS) {
    if (!p.types.includes(type)) continue;
    if (specials[p.key] !== p.value) continue;
    const missing = p.requires.filter((c) => !holdsClause(c, specials[c.key]));
    if (missing.length === 0) continue;
    const held = missing
      .map((c) => {
        const now = specials[c.key];
        const want = c.anyOf
          .map((v) => (v === null ? 'to be left unset' : JSON.stringify(v)))
          .join(' or ');
        // An ABSENT key is not `null`, and saying so would send a caller looking
        // for a null they never wrote. The platform's own default applies here,
        // which is a different thing to fix than a wrong value.
        const has = now === undefined ? 'is not set' : `is ${JSON.stringify(now)}`;
        return `${c.key} ${has}, and this needs ${want}`;
      })
      .join('; ');
    out.push(
      `specials.${p.key} = ${JSON.stringify(p.value)} does nothing on this node: ${held}. ` +
        `Left as it is, ${p.otherwise}`,
    );
  }
  return out;
}

/**
 * The same question for a shape that does not honour the setting AT ALL.
 *
 * Split from the clause check because the answer is different in kind: a
 * missing neighbour is something the caller can fix with another write, while a
 * `select` will never read the auto value mode however the rest of the node is
 * arranged.
 */
export function unsupportedSettingNote(type: string, key: string, value: unknown): string | null {
  const p = WRITE_PRECONDITIONS.find((x) => x.key === key && x.value === value);
  if (!p || p.types.includes(type)) return null;
  // NOT `p.otherwise`. That sentence explains what a node MISSING A NEIGHBOUR
  // renders as, and borrowing it here would hand a caller the wrong diagnosis —
  // it would send them to fix a sibling key on a shape that will never read
  // this one however the rest of the node is arranged.
  return (
    `specials.${key} = ${JSON.stringify(value)} is not a setting ${type} reads — ` +
    `only ${p.types.join(', ')} honour it. It stores, saves and publishes with no error, ` +
    `and this element's renderer never looks at it.`
  );
}
