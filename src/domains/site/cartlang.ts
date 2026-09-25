import { walk, type DocLike } from '../../core/tree.js';
import { CART_SEEDS, type OverlayDocument } from '../../catalog/overlays.generated.js';

/**
 * A CART DRAWER IN ANOTHER LANGUAGE THAN ITS SITE. A store made before the
 * per-locale seed keeps "Your cart" / "Checkout" / "Your cart is empty" on a
 * Vietnamese site, and nothing on the page says so. Only strings EXACTLY equal
 * to another locale's seed word count — anything else is the merchant's text.
 */
const KEYS = ['text', 'label', 'emptyText'] as const;

/** The seed a site's `settings.locale` picks: primary subtag, `en` when there is none. */
export function cartSeedLocale(locale: string | null | undefined): string {
  const l = String(locale ?? '').toLowerCase().split('-')[0];
  return Object.hasOwn(CART_SEEDS, l) ? l : 'en';
}

const order = (d: OverlayDocument) => {
  const out: DocLike['nodes'][string][] = [];
  walk(d as unknown as DocLike, d.root_node_id, (n) => out.push(n));
  return out;
};

/**
 * `key \0 other-locale word` → the site-locale word, by pairing each other
 * seed's nodes with the target seed's in walk order (same seed shape, so the
 * same position is the same word). A pair whose types differ is skipped.
 */
function seedWords(to: string): Map<string, string> {
  const target = order(CART_SEEDS[to]);
  const out = new Map<string, string>();
  for (const [l, seed] of Object.entries(CART_SEEDS)) {
    if (l === to) continue;
    order(seed).forEach((n, i) => {
      const t = target[i];
      if (!t || t.data.type !== n.data.type) return;
      for (const k of KEYS) {
        const a = n.specials?.[k];
        const b = t.specials?.[k];
        if (typeof a === 'string' && typeof b === 'string' && a !== b) out.set(`${k}\0${a}`, b);
      }
    });
  }
  return out;
}

export interface CartTextChange {
  node_id: string;
  key: (typeof KEYS)[number];
  from: string;
  to: string;
}

/** Every seed word under `rootId` that belongs to a locale other than `locale`'s seed. */
export function cartRelocalize(doc: { nodes: Record<string, unknown> }, rootId: string, locale: string): CartTextChange[] {
  const words = seedWords(locale);
  const out: CartTextChange[] = [];
  walk(doc as unknown as DocLike, rootId, (n) => {
    for (const key of KEYS) {
      const from = n.specials?.[key];
      const to = typeof from === 'string' ? words.get(`${key}\0${from}`) : undefined;
      if (to !== undefined) out.push({ node_id: n.id, key, from: from as string, to });
    }
  });
  return out;
}
