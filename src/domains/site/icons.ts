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
 * Substring ranking only — a SEARCH is a word someone chose. A misspelled NAME is
 * `nearestIcons`' job, which tries edit distance first.
 */
export function searchIcons(query: string, cap = 30, retryOnWord = true): string[] {
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
  if (!hits.length && retryOnWord) {
    const words = query.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/);
    const longest = words.filter((w) => w.length > 2).sort((a, b) => b.length - a.length)[0];
    if (longest) hits = rank(longest);
  }
  return hits.slice(0, cap);
}

/** Edit distance, capped: stops early past `max` (a name's stem is short). */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The names a WRONG value most likely meant. A typo first ("ShoppingCartt" is
 * one edit from ShoppingCart, while a word search on "shopping" ranks the shorter
 * ShoppingBag ahead of it — measured on a live platform), then the search.
 * Fill before Line on a tie: the platform's own default (StarFill) is a Fill.
 */
export function nearestIcons(query: string): string[] {
  index ??= [...ICON_NAMES].map((n) => [n, stemOf(n)]);
  const q = stemOf(query);
  const max = Math.max(1, Math.floor(q.length / 4));
  // The suffix the caller wrote wins a tie; otherwise Fill, the default's own.
  const want = /line$/i.test(norm(query)) ? 'Line' : 'Fill';
  const typos = q
    ? index
        .map(([n, s]) => ({ n, s, d: distance(q, s, max) }))
        .filter((x) => x.d <= max)
        .sort(
          (a, b) =>
            a.d - b.d ||
            // ShoppingCart over ShoppingCart2 for "ShoppingCartt": a stem the query
            // extends is a closer guess than a sibling the same distance away.
            Number(q.startsWith(b.s) || b.s.startsWith(q)) - Number(q.startsWith(a.s) || a.s.startsWith(q)) ||
            Number(b.n.endsWith(want)) - Number(a.n.endsWith(want)) ||
            a.s.length - b.s.length ||
            a.n.localeCompare(b.n),
        )
        .map((x) => x.n)
    : [];
  // A value that is a WHOLE WORD of real names ("cart" in Shopping·Cart, "user")
  // means those names, not Car/Cast one edit away; a fragment inside another word
  // ("hart" in c·hart) is more likely a typo (Heart). So: word hits, then typos,
  // then whatever else the search finds.
  const wordsOf = (n: string) => n.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(' ');
  const words = q
    ? index
        .filter(([n, st]) => st.startsWith(q) || wordsOf(n).includes(q))
        .sort(([an, as], [bn, bs]) => as.length - bs.length || Number(bn.endsWith(want)) - Number(an.endsWith(want)) || an.localeCompare(bn))
        .map(([n]) => n)
    : [];
  const order = [...words, ...typos, ...searchIcons(query, 5)];
  return [...new Set(order)].slice(0, 5);
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
