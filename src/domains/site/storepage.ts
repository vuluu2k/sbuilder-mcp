import {
  COMPLETION_HEADLINE,
  COMPLETION_HEADLINE_SENTINEL,
  STORE_PAGE_SEEDS,
} from '../../catalog/storepages.generated.js';

/**
 * WHAT A NEW STORE PAGE OPENS WITH — for an agent, as for a merchant.
 *
 * `storePageSeeds.ts` opens with the argument for this, and it is about the
 * author rather than the canvas: "the blank was not the problem — what the
 * author had to already know was". A product page needs a dataset block, a
 * gallery inside it, a title bound to the product, a price, a variant picker, a
 * quantity stepper and a button whose BINDING — not its click action — is
 * `add_to_cart`. Nothing on the screen says any of it.
 *
 * A merchant stopped being in that position when the editor started seeding.
 * An agent stayed in it, and worse: it cannot see the palette card it is failing
 * to reproduce, and `sb_page_create` told it "It arrives empty" as though that
 * were the platform's behaviour rather than this client's.
 *
 * The seeds are the palette's OWN cards, captured through
 * `buildStorePageDocument` at codegen — never a copy of them — so the day a card
 * gains a piece it arrives here too, and an agent that creates a product page
 * and a merchant who drags the Product card end up looking at the same thing.
 */

/** Page types that open with something. Anything else starts blank, correctly. */
export function hasSeed(type: string | undefined): boolean {
  return !!type && type in STORE_PAGE_SEEDS;
}

export function seededTypes(): string[] {
  return Object.keys(STORE_PAGE_SEEDS);
}

/**
 * The document a new page of `type` opens with, or null.
 *
 * `locale` picks the thank-you sentence on a completion page. It is read from
 * the platform's own i18n rather than defaulted to English here, because a
 * seeded page carrying the wrong language is precisely what `default_seed_copy`
 * reports on everybody else's seeds.
 *
 * An explicit `headline` wins over both — a merchant's own wording is not the
 * client's to overrule.
 */
export function seedDocument(
  type: string,
  opts: { locale?: string; headline?: string } = {},
): { schema_version: number; root_node_id: string; nodes: Record<string, unknown> } | null {
  const seed = STORE_PAGE_SEEDS[type];
  if (!seed) return null;

  const raw = JSON.stringify(seed);
  if (!raw.includes(COMPLETION_HEADLINE_SENTINEL)) {
    return JSON.parse(raw) as ReturnType<typeof seedDocument> & object;
  }
  const lang = opts.locale && opts.locale in COMPLETION_HEADLINE ? opts.locale : 'vi';
  const headline = opts.headline || COMPLETION_HEADLINE[lang];
  // JSON.stringify already escaped the seed; the substitute has to be escaped
  // the same way or an apostrophe in a merchant's own headline breaks the
  // document. Slicing the quotes off a stringified string is that escaping.
  const escaped = JSON.stringify(headline).slice(1, -1);
  return JSON.parse(raw.split(COMPLETION_HEADLINE_SENTINEL).join(escaped)) as ReturnType<
    typeof seedDocument
  > & object;
}

/** A one-line summary of what a seed puts on the page, for the tool result. */
export function seedSummary(type: string): { nodes: number } | null {
  const seed = STORE_PAGE_SEEDS[type];
  return seed ? { nodes: Object.keys(seed.nodes).length } : null;
}
