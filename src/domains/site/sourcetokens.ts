import type { Captured, StyleSample } from './importmap.js';

/**
 * The SOURCE page's own design system, recovered from what `capture` measured
 * it actually painting — never averaged, and never invented.
 *
 * The role assignment mirrors `tokensFromPage` in `importmap.ts` on purpose:
 * first heading, first body line, first painted button, in document order —
 * "the same thing a person does when they open a page and look at what a
 * heading is". Averaging two accents would manufacture a third colour that
 * appears nowhere on the source, which is worse than picking either one.
 *
 * `background` is the one deliberate departure, taking the MOST COMMON
 * section background rather than the first: a page often opens with a hero
 * band that is not its ground, and the first section is exactly the one most
 * likely to be that band.
 *
 * Every role the source did not express is OMITTED, never written as
 * `undefined` on a present key — `sb_theme` (Task 3) patches only the fields
 * it is given, so a present-but-empty key would clear a token the target site
 * already has, and an omitted one correctly leaves it alone.
 */
export interface SourceTokens {
  colors: Partial<Record<'heading' | 'text' | 'primary' | 'muted' | 'background', string>>;
  textStyles: Record<
    string,
    { fontSize?: string; fontWeight?: string; lineHeight?: string; fontFamily?: string }
  >;
  radii: string[];
  spacings: string[];
}

const MAX_HEADING_SLOTS = 6;
const MAX_TEXT_SLOTS = 3;
const MAX_METRIC_SLOTS = 6;

/**
 * `rgb(r, g, b)` / `rgba(r, g, b, a)` (as `getComputedStyle` hands back) to
 * `#rrggbb`. `rgba` with an alpha below 1 is not a token — flattening it onto
 * an unknown backdrop would store a colour the source never actually shows —
 * so it is skipped rather than resolved.
 */
function hex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v.toLowerCase();
  const m = v.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i,
  );
  if (!m) return undefined;
  const [, r, g, b, a] = m;
  if (a !== undefined && parseFloat(a) < 1) return undefined;
  const byte = (n: string) =>
    Math.round(Math.min(255, Math.max(0, parseFloat(n))))
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** The pixel magnitude of a CSS length, for sorting — 0 for anything unparseable. */
function pxNum(value: string): number {
  return parseFloat(value) || 0;
}

/** Every node in document order — pre-order, satellite-free, since a `Captured` tree has only `children`. */
function flatten(sections: Captured[]): Captured[] {
  const out: Captured[] = [];
  const visit = (nodes: Captured[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children?.length) visit(n.children);
    }
  };
  visit(sections);
  return out;
}

/** The first node of `kind` whose sample carries a usable colour at `field`. */
function firstColor(
  flat: Captured[],
  kind: Captured['kind'],
  field: 'color' | 'backgroundColor',
): string | undefined {
  for (const n of flat) {
    if (n.kind !== kind) continue;
    const h = hex((n.sample as StyleSample | undefined)?.[field]);
    if (h) return h;
  }
  return undefined;
}

/** The first `button` that is painted (a usable `backgroundColor`) and is not a nav link. */
function firstPrimary(flat: Captured[]): string | undefined {
  for (const n of flat) {
    if (n.kind !== 'button' || n.variant === 'link') continue;
    const h = hex(n.sample?.backgroundColor);
    if (h) return h;
  }
  return undefined;
}

/** Distinct colours of `kind`/`field`, each with how many times it was seen, in first-seen order. */
function colorCounts(
  flat: Captured[],
  kind: Captured['kind'],
  field: 'color' | 'backgroundColor',
): { order: string[]; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const n of flat) {
    if (n.kind !== kind) continue;
    const h = hex((n.sample as StyleSample | undefined)?.[field]);
    if (!h) continue;
    if (!counts.has(h)) {
      counts.set(h, 0);
      order.push(h);
    }
    counts.set(h, counts.get(h)! + 1);
  }
  return { order, counts };
}

/** The most common value, ties broken by first-seen order — `undefined` when nothing was seen. */
function mostCommon(order: string[], counts: Map<string, number>): string | undefined {
  if (!order.length) return undefined;
  let best = order[0];
  for (const c of order) {
    if (counts.get(c)! > counts.get(best)!) best = c;
  }
  return best;
}

type Slot = { fontSize: string; fontWeight?: string; lineHeight?: string; fontFamily?: string };

/** Distinct font sizes of `kind`, largest first, capped at `max` — the source's own type scale. */
function typeScale(flat: Captured[], kind: 'heading' | 'text', max: number): Slot[] {
  const seen = new Set<string>();
  const slots: Slot[] = [];
  for (const n of flat) {
    if (n.kind !== kind) continue;
    const fontSize = n.sample?.fontSize;
    if (!fontSize || seen.has(fontSize)) continue;
    seen.add(fontSize);
    slots.push({
      fontSize,
      ...(n.sample?.fontWeight ? { fontWeight: n.sample.fontWeight } : {}),
      ...(n.sample?.lineHeight ? { lineHeight: n.sample.lineHeight } : {}),
      ...(n.sample?.fontFamily ? { fontFamily: n.sample.fontFamily } : {}),
    });
  }
  slots.sort((a, b) => pxNum(b.fontSize) - pxNum(a.fontSize));
  return slots.slice(0, max);
}

/** Every distinct value of `field` across all samples, ascending by pixel value, capped at `max`. */
function metric(flat: Captured[], field: 'borderRadius' | 'padding' | 'gap', max: number): string[] {
  const set = new Set<string>();
  for (const n of flat) {
    const v = n.sample?.[field];
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => pxNum(a) - pxNum(b)).slice(0, max);
}

/**
 * Cluster what `capture` measured a source page painting into the theme's own
 * vocabulary — five colour roles and a heading/text type scale, plus the
 * radii and spacings a later phase (P3) may draw a preset from. See the
 * module doc comment for why role assignment is first-of-kind and why
 * `background` alone departs from it.
 */
export function sourceTokens(sections: Captured[]): SourceTokens {
  const flat = flatten(sections);

  const colors: SourceTokens['colors'] = {};
  const heading = firstColor(flat, 'heading', 'color');
  if (heading) colors.heading = heading;
  const text = firstColor(flat, 'text', 'color');
  if (text) colors.text = text;
  const primary = firstPrimary(flat);
  if (primary) colors.primary = primary;
  const { order: bgOrder, counts: bgCounts } = colorCounts(flat, 'section', 'backgroundColor');
  const background = mostCommon(bgOrder, bgCounts);
  if (background) colors.background = background;

  // `muted` has no first-of-kind to read, so it comes from frequency instead:
  // the second-most-common TEXT colour, when the source actually has one and
  // it differs from the `text` role already chosen above.
  const { order: textOrder, counts: textCounts } = colorCounts(flat, 'text', 'color');
  const byFrequency = [...textOrder].sort((a, b) => textCounts.get(b)! - textCounts.get(a)!);
  const muted = byFrequency[1];
  if (muted && muted !== text) colors.muted = muted;

  const textStyles: SourceTokens['textStyles'] = {};
  typeScale(flat, 'heading', MAX_HEADING_SLOTS).forEach((slot, i) => {
    textStyles[`heading-${i + 1}`] = slot;
  });
  typeScale(flat, 'text', MAX_TEXT_SLOTS).forEach((slot, i) => {
    textStyles[`text-${i + 1}`] = slot;
  });

  const radii = metric(flat, 'borderRadius', MAX_METRIC_SLOTS);
  const spacings = [
    ...new Set([...metric(flat, 'padding', MAX_METRIC_SLOTS), ...metric(flat, 'gap', MAX_METRIC_SLOTS)]),
  ]
    .sort((a, b) => pxNum(a) - pxNum(b))
    .slice(0, MAX_METRIC_SLOTS);

  return { colors, textStyles, radii, spacings };
}
