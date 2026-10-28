import { SEED_COPY_VI, langOf } from './seedcopy.js';
import {
  COMPLETION_HEADLINE,
  COMPLETION_HEADLINE_SENTINEL,
  PAGE_LAYOUT_SEEDS,
  PAGE_TYPES,
  STORE_PAGE_SEEDS } from '../../catalog/storepages.generated.js';
import { BINDING_SOURCES } from '../../catalog/elements.generated.js';
import { withFreshIds } from './ids.js';
import { PAGE_ENTITIES } from './review.js';

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
/** Rewrite every exact seed string the table carries, in place. */
function localizeSeed(doc: { nodes: Record<string, unknown> }, table: Readonly<Record<string, string>>): void {
  for (const n of Object.values(doc.nodes)) {
    const sp = (n as { specials?: Record<string, unknown> }).specials;
    if (!sp) continue;
    for (const k of ['text', 'label']) {
      const v = sp[k];
      if (typeof v === 'string' && table[v]) sp[k] = table[v];
    }
  }
}

export { SEED_COPY_VI } from './seedcopy.js';
export function seedDocument(
  type: string,
  opts: { locale?: string; headline?: string } = {},
): { schema_version: number; root_node_id: string; nodes: Record<string, unknown> } | null {
  const seed = STORE_PAGE_SEEDS[type];
  if (!seed) return null;

  const raw = JSON.stringify(seed);
  const vi = langOf(opts.locale ?? 'vi') === 'vi';
  const out = (doc: ReturnType<typeof seedDocument> & object) => {
    if (vi) localizeSeed(doc, SEED_COPY_VI);
    return withFreshIds(doc);
  };
  // Fresh ids per create, so two pages from one seed share nothing but ROOT.
  if (!raw.includes(COMPLETION_HEADLINE_SENTINEL)) {
    return out(JSON.parse(raw) as ReturnType<typeof seedDocument> & object);
  }
  // Normalized: a site whose locale is "en-US" reads its own language here too.
  const tag = langOf(opts.locale);
  const lang = tag && tag in COMPLETION_HEADLINE ? tag : 'vi';
  const headline = opts.headline || COMPLETION_HEADLINE[lang];
  // JSON.stringify already escaped the seed; the substitute has to be escaped
  // the same way or an apostrophe in a merchant's own headline breaks the
  // document. Slicing the quotes off a stringified string is that escaping.
  const escaped = JSON.stringify(headline).slice(1, -1);
  return out(JSON.parse(raw.split(COMPLETION_HEADLINE_SENTINEL).join(escaped)) as ReturnType<typeof seedDocument> & object);
}

/**
 * What to put on an ENTITY TEMPLATE that opens empty, or null.
 *
 * An entity template (a type whose route carries `{slug}`) with an empty
 * document answers 500 "entity render failed" at EVERY one of its URLs once
 * published — `storefront/entityroute.go` refuses an empty body rather than
 * serve a blank 200. Measured on a brand page: empty → 500 at /brands/acme,
 * one heading → 200. The editor seeds some of these types and not others
 * (brand and course today), and `seed:false` or a refused seed write leaves any
 * of them empty, so the rule is "entity template + nothing seeded", not a name.
 *
 * A NOTE, NOT AN INVENTED SEED: the platform ships none for brand, and a seed
 * authored here would be a document nothing upstream keeps current.
 */
export function emptyEntityTemplateNote(type: string | undefined): string | null {
  const route = PAGE_TYPES.find((t) => t.type === type)?.routePattern;
  const entity = type ? PAGE_ENTITIES[type]?.[0] : undefined;
  if (!route?.includes('{slug}') || !entity) return null;
  const has = (k: string) => BINDING_SOURCES.includes(`${entity}.${k}`);
  const parts = [
    ...(has('title') ? [`a heading bound to ${entity}.title`] : []),
    ...(has('description') ? [`a text bound to ${entity}.description`] : []),
    ...(type === 'brand'
      ? ['a product grid narrowed to the brand the URL names: sb_template_use template_id "sb_product_shelf", then sb_set its list-dataset config.collectionType "page_brand" (a bare list-dataset has no card and renders empty)']
      : []),
  ];
  return (
    `This "${type}" page is EMPTY. Published like that, every ${route} answers 500 ` +
    '"entity render failed". ' +
    `Before publishing, sb_add ${parts.join(', ')} — bind the heading and text with sb_bind, field "specials.text".`
  );
}

/**
 * Never-published pages `publish_drafts` must NOT go live on its own: an entity
 * template (a `{slug}` route) answers 500 at every URL of its type while empty,
 * and `error` / `maintain` replace what the whole site serves. Each is published
 * by naming it, once it has been built and looked at.
 */
export function heldFromFirstPublish(type: string | undefined): boolean {
  if (type === 'error' || type === 'maintain') return true;
  return !!PAGE_TYPES.find((t) => t.type === type)?.routePattern?.includes('{slug}');
}

/** A one-line summary of what a seed puts on the page, for the tool result. */
export function seedSummary(type: string): { nodes: number } | null {
  const seed = STORE_PAGE_SEEDS[type];
  return seed ? { nodes: Object.keys(seed.nodes).length } : null;
}

/**
 * The document an ordinary page opens with for a chosen LAYOUT, or null.
 *
 * Separate from `seedDocument` because the keys are different things: that one
 * is keyed by the page TYPE the storefront routes by, this one by the PURPOSE an
 * author picked. Every content page is type `page`, so the first table cannot
 * tell an About page from a policy and this one can.
 *
 * Same palette cards, same editor module, read through the same codegen — so a
 * merchant who picks the layout in the create dialog and an agent that lands on
 * it here open the same page.
 */
export function layoutDocument(
  layout: string,
): { schema_version: number; root_node_id: string; nodes: Record<string, unknown> } | null {
  const seed = PAGE_LAYOUT_SEEDS[layout];
  return seed ? withFreshIds(seed) : null;
}

/** The layouts this build carries. */
export function layoutNames(): string[] {
  return Object.keys(PAGE_LAYOUT_SEEDS);
}
