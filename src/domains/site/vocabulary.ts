import { CONFIG_VALUES } from '../../catalog/elements.generated.js';

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
