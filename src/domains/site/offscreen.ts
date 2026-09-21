import { childrenOf, isOverlay, subtreeIds, type DocLike } from '../../core/tree.js';

/**
 * PARKED OFF-SCREEN UNTIL A SHOPPER OPENS IT — a fact about the ELEMENT'S
 * RENDERER, not about how the node reached the page.
 *
 * `measure` already skipped overlays, and the skip was built from `isOverlay`,
 * which asks a COMPOSITION question: does this node carry `specials.overlayId`
 * and sit directly under ROOT. That is the right question for trap 1 — an
 * overlay is composed onto ROOT on read and stripped on write, so a write must
 * refuse its root — and it is the WRONG question here, because being off-screen
 * is something the element's own CSS does:
 *
 *     .wb-cart-drawer        { visibility: hidden; transform: translateX(105%) }
 *     .wb-cart-drawer.is-open{ visibility: visible; transform: none }
 *
 * A `cart-drawer` authored straight into a page document — no `overlayId`, just
 * a node somebody added — parks itself exactly the same way. MEASURED on a live
 * storefront: every page carried an unstamped `cart-drawer` as a ROOT child, so
 * the skip set came out EMPTY and `sb_look` reported THIRTEEN off-canvas
 * findings per page, at every width, on pages that were completely correct.
 * "A list that is two dozen false positives long is a list nobody reads" is the
 * comment on the skip this repairs.
 *
 * The same blind spot has a second symptom, which is why this is one module and
 * not a patch in `measure`: `sb_look` opens an overlay before framing a node
 * inside it, and it decides what to open with `overlayRoot` — the same
 * stamp-based test. Framing the quantity stepper inside an unstamped drawer
 * therefore did not open it, the clip landed outside the image, and Playwright
 * answered "Clipped area is either empty or outside the resulting image",
 * naming neither the overlay nor the reason.
 *
 * THIS IS THE `Box.position` LESSON AGAIN, one field along: a comment described
 * behaviour the code did not have, because the code asked a question adjacent
 * to the one the comment was about.
 *
 * HAND-KEPT, and the replacement is nameable. The honest source is the Go CSS —
 * an element whose `render/nodes/<type>/css.go` hides itself until `.is-open` —
 * which is mechanically readable and is what a codegen reader should take. It
 * is four types today, and the element metas carry nothing that separates them:
 * all of `cart-drawer`, `popup`, `menu-drawer`, `menu-panel` and `hamburger-menu`
 * report `category: "basic"`, so there is nothing in the catalog to derive this
 * from. Until that reader exists, a new overlay element the platform ships is a
 * silent gap here — the same standing debt `INERT_ON_ADD` carries, recorded
 * rather than hidden.
 */
export const OFFSCREEN_UNTIL_OPEN: ReadonlySet<string> = new Set([
  // Both measured directly in the Go: these two translate themselves out of the
  // viewport and back on `.is-open`.
  'cart-drawer',
  'hamburger-menu',
  // These two are hidden rather than translated, so they do not usually measure
  // as off-canvas — but they are the same KIND of thing, they are what
  // `sb_look` must open before framing a node inside one, and leaving them out
  // would make this set mean two different things depending on which caller
  // read it.
  'popup',
  'menu-panel',
  'menu-drawer',
]);

/** Is this node an overlay for RENDER purposes — composed, or one by type? */
export function isOffscreenOverlay(doc: DocLike, id: string): boolean {
  if (isOverlay(doc, id)) return true;
  return OFFSCREEN_UNTIL_OPEN.has(doc.nodes[id]?.data.type ?? '');
}

/**
 * Every node inside an overlay on this page, for a caller that must not judge
 * their geometry.
 *
 * ROOT's children only, matching where an overlay may legally sit — and a
 * by-type overlay nested deeper is deliberately not swept up, because a
 * `popup` inside a section is a document the platform refuses on save and
 * hiding it here would hide that.
 */
export function offscreenNodes(doc: DocLike): Set<string> {
  const out = new Set<string>();
  for (const id of childrenOf(doc, doc.root_node_id)) {
    if (!isOffscreenOverlay(doc, id)) continue;
    for (const n of subtreeIds(doc, id)) out.add(n);
  }
  return out;
}

/**
 * The overlay this node sits in, for the RENDER question "what must be opened
 * before I can photograph this".
 *
 * Deliberately NOT `overlayRoot` from core/tree, and deliberately not a change
 * to it: that one answers the COMPOSITION question every write guard asks —
 * "is this node inside a subtree the save will strip" — and widening it to
 * element types would make `refuseOverlay` start refusing writes to a plain
 * authored drawer, which is a node this page genuinely owns and may edit.
 * Two questions, two functions.
 */
export function offscreenRootOf(doc: DocLike, id: string): string | null {
  const roots = childrenOf(doc, doc.root_node_id).filter((k) => isOffscreenOverlay(doc, k));
  for (const root of roots) {
    if (root === id || subtreeIds(doc, root).includes(id)) return root;
  }
  return null;
}
