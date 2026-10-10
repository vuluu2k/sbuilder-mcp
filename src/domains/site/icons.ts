import { ICON_KEYS, ICON_NAMES } from '../../catalog/icons.generated.js';

/**
 * ICON NAMES — which keys hold one, whether a value is one, and the nearest real
 * ones when it is not.
 *
 * A name outside the manifest is stored, saved and published, then drawn as the
 * DEFAULT star (`RenderIconSVG` falls back to `DefaultIcon`) or as nothing
 * (`button`'s `generated.HasIcon` guard) — never the icon asked for, and with no
 * error at any step. A WARNING, like every vocabulary note here: the manifest can
 * be older than the deployment. `''` is never flagged: it is what the "None" cell
 * writes, what `form-text` seeds, and the `icon` element draws its default for it.
 */

/** `true` when `<ns>.<key>` holds an icon name on this element (ICON_KEYS). */
export function isIconKey(type: string, ns: string, key: string): boolean {
  return ICON_KEYS[type]?.some((k) => k.ns === ns && k.key === key) ?? false;
}

/** The `<ns>.<key>` list `sb_traits_for` reports; empty when the element has none. */
export function iconKeysOf(type: string): string[] {
  return (ICON_KEYS[type] ?? []).map((k) => `${k.ns}.${k.key}`);
}

const norm = (s: string) => s.replace(/^ri-/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const stemOf = (s: string) => norm(s).replace(/(fill|line)$/, '');
let index: Array<[name: string, stem: string]> | null = null;

/**
 * Names whose stem (lower-case, separators and the Fill/Line suffix dropped)
 * equals, starts with, or contains the query's — in that order, shorter first.
 * Nothing found → retried on the query's longest word, so "ShoppingBasketIcon"
 * still lands near the basket.
 *
 * ponytail: substring ranking, no edit distance — a misspelling ("hart") finds
 * nothing. Add a Levenshtein fallback if callers misspell rather than guess.
 */
export function searchIcons(query: string, cap = 30): string[] {
  index ??= [...ICON_NAMES].map((n) => [n, stemOf(n)]);
  const rank = (q: string) =>
    !q
      ? []
      : index!
          .map(([n, s]) => ({ n, s, r: s === q ? 3 : s.startsWith(q) ? 2 : s.includes(q) ? 1 : 0 }))
          .filter((x) => x.r > 0)
          .sort((a, b) => b.r - a.r || a.s.length - b.s.length || a.n.localeCompare(b.n))
          .map((x) => x.n);
  let hits = rank(stemOf(query));
  if (!hits.length) {
    const words = query.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/);
    const longest = words.filter((w) => w.length > 2).sort((a, b) => b.length - a.length)[0];
    if (longest) hits = rank(longest);
  }
  return hits.slice(0, cap);
}

export function nearestIcons(query: string): string[] {
  return searchIcons(query, 5);
}

/**
 * The problem sentence for `value` written to `<ns>.<key>` on `type`, or null
 * when the key holds no icon or the value is a real name (or `''`).
 */
export function iconNote(type: string, ns: string, key: string, value: unknown): { problem: string; near: string[] } | null {
  if (!isIconKey(type, ns, key) || value === '' || value === undefined || value === null) return null;
  if (typeof value === 'string' && ICON_NAMES.has(value)) return null;
  const near = typeof value === 'string' ? nearestIcons(value) : [];
  return {
    near,
    problem:
      `${ns}.${key} = ${JSON.stringify(value)} is not an icon name this platform has, so ${type} ` +
      'publishes the default star or no icon at all, with no error. ' +
      (near.length ? `Nearest: ${near.join(', ')}.` : 'Nothing close — search with sb_catalog_search query "icon:<word>".'),
  };
}
