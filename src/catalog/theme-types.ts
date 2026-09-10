/** Hand-written types for the generated theme catalog. */

export interface ColorToken {
  id: string;
  name: string;
  value: string;
}

/**
 * A site text style. Keyed by SLUG, not id — the slug is what a preset's
 * `textStyle` names and what the compiled `--wb-ts-<slug>-<prop>` variables are
 * built from.
 */
export interface ThemeTextStyle {
  slug: string;
  name: string;
  base?: Record<string, string>;
  responsive?: Record<string, Record<string, string>>;
}

export interface ColorScheme {
  id: string;
  name: string;
  roles?: Record<string, string>;
}

/**
 * A named bundle of style declarations an element applies wholesale.
 *
 * It compiles to a CLASS rule that sits BENEATH the node's own values, so the
 * node keeps overriding it the ordinary way — which is exactly why a node's own
 * `style` can be silent about a colour the page is visibly painting.
 */
export interface StylePreset {
  id: string;
  name: string;
  kind: string;
  /** Hidden from the element picker, but it still RESOLVES for nodes using it. */
  draft?: boolean;
  base: Record<string, string>;
  responsive?: Record<string, Record<string, string>>;
  states?: { hover?: Record<string, string> };
}

export interface StarterTheme {
  version: number;
  colors: ColorToken[];
  textStyles: ThemeTextStyle[];
  schemes: ColorScheme[];
  lightSchemeId?: string;
  darkSchemeId?: string;
  presets: StylePreset[];
}
