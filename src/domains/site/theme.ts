import { ELEMENT_PRESETS, STARTER_THEME } from '../../catalog/theme.generated.js';
import type { StarterTheme, StylePreset } from '../../catalog/theme-types.js';
import type { SourceTokens } from './sourcetokens.js';

/**
 * THE STYLE LAYER A NODE'S OWN `style` DOES NOT CONTAIN.
 *
 * Design rule 0 — "read the page's pattern off what is there" — assumes a node's
 * style HOLDS what it paints. Since THEME_VERSION 6 that is false for nine
 * element types: their defaults are moving OUT of `meta.defaults.style` and into
 * theme PRESETS the element wears. `icon/meta.ts` says so outright — "The COLOUR
 * lives in the `icon-default` style preset, not here: a node's own slot outranks
 * its preset, so seeding it made every other icon preset unable to repaint it."
 *
 * A preset compiles to a CLASS rule BENEATH the node's own values
 * (`compilePresetCSS`), so the order is: preset base → preset breakpoint →
 * node's own. That layer is real and was invisible to every tool here, which
 * means an agent reading an icon back saw no colour on a page visibly painting
 * one, invented a literal — and that literal then OUTRANKS the preset for good,
 * detaching the node from the theme for every future palette change.
 *
 * THE SITE'S THEME IS THE AUTHORITY, NOT THE STARTER. A site stores its own, and
 * `GET /api/sites/{siteId}/theme` answers with it. `STARTER_THEME` is what a
 * site that has never customised resolves against, and it is the FALLBACK here
 * rather than the answer: handing an agent the starter's `#111827` for a site
 * whose heading token is rose would be a confident wrong colour, which is worse
 * than none. Every function here therefore takes the theme it should resolve
 * against, and callers say where it came from.
 */

/** Where a resolved value came from, so a caller can say how much to trust it. */
export type ThemeOrigin = 'site' | 'starter';

/** The preset this element type wears by default, or null. */
export function presetForType(type: string): string | null {
  return ELEMENT_PRESETS[type] ?? null;
}

/** The preset a NODE actually references — its own specials win over the default. */
export function presetIdOf(
  node: { data: { type: string }; specials?: Record<string, unknown> },
): string | null {
  const own = node.specials?.stylePreset;
  if (typeof own === 'string' && own) return own;
  return presetForType(node.data.type);
}

export function findPreset(theme: StarterTheme, id: string): StylePreset | null {
  return theme.presets.find((p) => p.id === id) ?? null;
}

/**
 * Flatten a `var(--wb-…)` chain down to something a person could read.
 *
 * The chain is real and three deep in the ordinary case: `icon-default` paints
 * `color: var(--wb-sc-heading, var(--wb-color-heading))` — a SCHEME role, whose
 * own value is a palette token, whose value is a hex. Reporting the raw string
 * answers "what does this icon paint" with a variable name, which is what the
 * node's style already failed to answer.
 *
 * The scheme consulted is the LIGHT one, because that is what `:root` declares;
 * dark mode re-points the same roles under `:root[data-wb-mode="dark"]` and is
 * a second answer rather than a correction to this one.
 *
 * A reference that resolves to nothing keeps its fallback, and a chain with no
 * fallback is returned verbatim: an unresolvable var is information (the token
 * was deleted, or the theme is older than the preset) and inventing a colour for
 * it would be the exact failure this module exists to prevent.
 */
export function resolveVars(theme: StarterTheme, value: string, depth = 0): string {
  if (depth > 6 || !value.includes('var(')) return value;
  const m = /^var\(\s*(--wb-[a-zA-Z0-9-]+)\s*(?:,\s*([\s\S]+?)\s*)?\)$/.exec(value.trim());
  if (!m) return value;
  const [, name, fallback] = m;
  const scheme =
    theme.schemes.find((s) => s.id === theme.lightSchemeId) ?? theme.schemes[0] ?? null;

  let next: string | undefined;
  if (name.startsWith('--wb-sc-')) next = scheme?.roles?.[name.slice('--wb-sc-'.length)];
  else if (name.startsWith('--wb-color-')) {
    next = theme.colors.find((c) => c.id === name.slice('--wb-color-'.length))?.value;
  }

  if (next !== undefined) return resolveVars(theme, next, depth + 1);
  if (fallback !== undefined) return resolveVars(theme, fallback, depth + 1);
  return value;
}

export interface PresetLayer {
  id: string;
  name: string;
  kind: string;
  /** The declarations this preset paints, with every var chain flattened. */
  paints: Record<string, string>;
  /** Keys the node overrides itself, so the preset's value never reaches the page. */
  overridden: string[];
  /** Where the theme came from — a starter answer is a guess about a live site. */
  from: ThemeOrigin;
  draft?: boolean;
}

/**
 * What a node's preset contributes, and which of it the node has already
 * overridden.
 *
 * `overridden` is the half that turns this from trivia into an answer: a caller
 * asking "what colour is this button" needs to know whether the preset's colour
 * is the one on the page or a value the node already replaced.
 */
export function presetLayer(
  theme: StarterTheme,
  from: ThemeOrigin,
  node: { data: { type: string }; style?: Record<string, unknown>; specials?: Record<string, unknown> },
): PresetLayer | null {
  const id = presetIdOf(node);
  if (!id) return null;
  const preset = findPreset(theme, id);
  // A node naming a preset the theme does not hold resolves to NOTHING and
  // renders unstyled — the failure THEME_VERSION 6 was bumped for. Say the id.
  if (!preset) {
    return {
      id,
      name: '(not in this theme)',
      kind: '',
      paints: {},
      overridden: [],
      from,
    };
  }
  const own = node.style ?? {};
  const paints: Record<string, string> = {};
  for (const [k, v] of Object.entries(preset.base)) paints[k] = resolveVars(theme, v);
  return {
    id: preset.id,
    name: preset.name,
    kind: preset.kind,
    paints,
    overridden: Object.keys(preset.base).filter((k) => own[k] !== undefined),
    from,
    ...(preset.draft ? { draft: true } : {}),
  };
}

/**
 * The note a caller gets when they are about to write a literal over a value the
 * preset already supplies.
 *
 * Said, never refused: overriding a preset is an ordinary, correct thing to do —
 * it is how one button on a page differs from the rest. What is NOT ordinary is
 * doing it without knowing, which detaches the node from the theme silently and
 * for good.
 */
export function detachNote(layer: PresetLayer, keys: string[]): string | null {
  const clashes = keys.filter((k) => k in layer.paints && !layer.overridden.includes(k));
  if (!clashes.length) return null;
  const shown = clashes.map((k) => `${k} (preset paints ${layer.paints[k]})`).join(', ');
  return (
    `This node wears the "${layer.id}" style preset, which already paints ${shown}. A value ` +
    'written on the node OUTRANKS the preset permanently, so this node stops following the ' +
    'theme for those keys — a later palette change will move every other node and not this ' +
    'one. That is the right call for a deliberate one-off and the wrong one for "make it match ' +
    'the page": to match, read the preset and reuse its value, or edit the preset through ' +
    'PUT /api/sites/{siteId}/theme.' +
    (layer.from === 'starter'
      ? ' NOTE: this site\'s own theme could not be read, so these are the STARTER values and ' +
        'may not be what the site actually paints.'
      : '')
  );
}

/**
 * THE SOURCE'S PALETTE, RESHAPED INTO WHAT THE THEME ENDPOINT PATCHES BY.
 *
 * `sb_import_site` reads a source page's own design once, as `SourceTokens`
 * (see `sourcetokens.ts`), and this is the bridge from that observation to
 * `sb_theme`'s own patch shape — `{colors, text_styles}` — the two fields
 * `PUT /api/sites/{siteId}/theme` is safe to send as a partial change.
 *
 * There is no vocabulary to translate: `SourceTokens.colors`'s keys (heading,
 * text, primary, muted, background) and `textStyles`'s keys (heading-1..6,
 * text-1..3) ARE this theme's own colour ids and text-style slugs — that is
 * the whole point of `sourcetokens.ts` clustering role assignment the way it
 * does. `radii` and `spacings` are dropped: the theme has no standalone token
 * for either, so P2 has nothing to patch them onto.
 */
export interface ThemePatch {
  colors: Record<string, string>;
  text_styles: Record<string, Record<string, string>>;
}

/**
 * Build the patch, or `null` when the source expressed neither a colour nor
 * a text style.
 *
 * `null` rather than `{colors: {}, text_styles: {}}` matters on THIS
 * endpoint specifically — it is a whole-document REPLACE with no history,
 * and an empty-looking patch is the shape that once let a live site lose its
 * entire palette with a 200 and nothing to restore from. Returning `null` is
 * what lets the caller send no request at all rather than an empty one.
 */
export function themePatchFor(tokens: SourceTokens): ThemePatch | null {
  const colors = { ...tokens.colors };
  const text_styles: Record<string, Record<string, string>> = {};
  for (const [slug, decls] of Object.entries(tokens.textStyles)) {
    const style: Record<string, string> = {};
    if (decls.fontSize) style.fontSize = decls.fontSize;
    if (decls.fontWeight) style.fontWeight = decls.fontWeight;
    if (decls.lineHeight) style.lineHeight = decls.lineHeight;
    if (decls.fontFamily) style.fontFamily = decls.fontFamily;
    if (Object.keys(style).length) text_styles[slug] = style;
  }
  if (Object.keys(colors).length === 0 && Object.keys(text_styles).length === 0) return null;
  return { colors, text_styles };
}

/** One field the patch moved, in `sb_theme`'s own reporting shape. */
export interface ThemeChange {
  what: string;
  from: string;
  to: string;
}

/**
 * Apply a `ThemePatch` onto a `StarterTheme` IN PLACE and report what moved.
 *
 * The caller supplies the theme to mutate — never the live document read by
 * `siteTheme`'s cache — so this is deliberately a pure, testable step ahead
 * of the actual PUT, the same read-modify-write shape `sb_theme` itself
 * follows against this replace-only endpoint.
 *
 * Unlike `sb_theme`, an id or slug the theme does not carry is SKIPPED
 * rather than refused: every id and slug `themePatchFor` writes is one of
 * the theme's own five colour roles or nine text-style slugs, so a miss here
 * means this particular site's theme has fewer than the starter's — not a
 * typo worth stopping a whole-site import for.
 */
export function applyThemePatch(theme: StarterTheme, patch: ThemePatch): ThemeChange[] {
  const changes: ThemeChange[] = [];
  for (const [id, value] of Object.entries(patch.colors)) {
    const token = theme.colors?.find((c) => c.id === id);
    if (!token || token.value === value) continue;
    changes.push({ what: `colors.${id}`, from: token.value, to: value });
    token.value = value;
  }
  for (const [slug, decls] of Object.entries(patch.text_styles)) {
    const style = theme.textStyles?.find((t) => t.slug === slug);
    if (!style) continue;
    style.base = style.base ?? {};
    for (const [prop, value] of Object.entries(decls)) {
      const before = style.base[prop];
      if (before === value) continue;
      changes.push({ what: `textStyles.${slug}.${prop}`, from: before ?? '(unset)', to: value });
      style.base[prop] = value;
    }
  }
  return changes;
}

export { STARTER_THEME };
