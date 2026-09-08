import { ancestors, type DocLike, type NodeLike } from '../../core/tree.js';

/**
 * PINNING, AND THE STATE A PINNED ELEMENT WEARS ONCE IT IS STUCK.
 *
 * The platform gained this in September 2026 (`schema/src/stickyState.ts`, Go
 * mirror `server/render/style/sticky.go`), and every part of it fails SILENTLY
 * when authored wrong — which is why it needs a module here rather than a note.
 *
 * `position: sticky` changes nothing observable when it engages: CSS has no
 * `:stuck` pseudo-class. So the platform toggles ONE class (`wb-stuck`) on the
 * pinned element from a runtime island, and compiles every rule an author wrote
 * for the pinned look against it — the node itself as `#self.wb-stuck`, a
 * DESCENDANT as `#host.wb-stuck #self`, which is what lets a pinned header
 * shrink its logo without the logo knowing what pinned it.
 *
 * Three things about it are load-bearing here, and each is a write that
 * disappears without one:
 *
 *   1. THE STATE NEEDS A HOST. `render/css.go` emits the stuck rules inside
 *      `if stuckHost := stuckHostFor(...); stuckHost != ""`. A `stuck` override
 *      on a node with no pinned self-or-ancestor compiles to NOTHING — stored,
 *      saved, published and ignored forever, the same shape as a binding in a
 *      namespace `applyBindings` does not honour.
 *   2. THE SEEDS ARE NOT COSMETIC. The editor writes `top: 0px` and
 *      `zIndex: 10` the moment an author picks "Stick on scroll", and the
 *      platform's own commit records why the second one exists: measured in
 *      Chromium, a pinned header with no z-index is painted OVER by any
 *      `position: relative` element in a later section the moment it scrolls
 *      past. An agent writing `position: sticky` through `sb_set` reaches none
 *      of that, so its first sticky header half-works in the way that reads as
 *      the feature being broken.
 *   3. A CLIPPING ANCESTOR DEFEATS IT ENTIRELY. Sticky resolves against its
 *      nearest SCROLLING ancestor, so an ancestor with `overflow: hidden|auto|
 *      scroll|clip|overlay` becomes that ancestor and the node pins inside a box
 *      that never scrolls. Nothing on screen and nothing in the log explains it.
 */

/** The state key, in `node.states` and `responsive[bp].states`. */
export const STUCK_STATE = 'stuck';

/**
 * The positions that HAVE a pinned moment.
 *
 * `fixed` earns its place for a different reason than `sticky`: it is pinned
 * from the first frame, so "the moment it pins" never happens to it — but "the
 * moment the page has scrolled past where it would have been" does, and that is
 * the same design an author reaches for (the fixed header that goes opaque once
 * the hero is behind it). `absolute` is deliberately absent: it scrolls away
 * with the page, so it has no relationship to the scroll position at all.
 */
const PINNED_POSITIONS = new Set(['sticky', 'fixed']);

/**
 * Overflow values that make an ancestor a scroll container — an ALLOWLIST of
 * the clipping ones, not `!== 'visible'`, so an unknown or misspelled value
 * never produces a warning nobody can act on. Mirrors the editor's
 * `dnd/stickyBlockers.ts`.
 */
const CLIPPING = new Set(['hidden', 'auto', 'scroll', 'clip', 'overlay']);

const BREAKPOINTS = ['desktop', 'laptop', 'tablet', 'mobile'] as const;

/** A node as the document actually stores it — `NodeLike` types only the tree. */
type Styled = NodeLike & {
  style?: Record<string, unknown>;
  responsive?: Record<string, { style?: Record<string, unknown> }>;
};

function styleAt(node: Styled | undefined, bp?: string): Record<string, unknown> {
  if (!node) return {};
  return (bp ? node.responsive?.[bp]?.style : node.style) ?? {};
}

/**
 * Does any slot on this node ask for a position that can pin?
 *
 * Breakpoint-agnostic on purpose, exactly as the platform's `isPinnedNode` is: a
 * header pinned only on desktop still compiles its stuck rules at every width —
 * they simply never match, because the class only appears while the element is
 * genuinely stuck, which the island re-decides per viewport.
 */
export function isPinnedNode(node: Styled | undefined): boolean {
  if (!node) return false;
  if (PINNED_POSITIONS.has(String(styleAt(node).position))) return true;
  return BREAKPOINTS.some((bp) => PINNED_POSITIONS.has(String(styleAt(node, bp).position)));
}

/**
 * The pinned self-or-ancestor whose `wb-stuck` class this node's stuck rules
 * would key off, or null. Nearest wins; a pinned node answers with itself.
 */
export function stuckHostOf(doc: DocLike, id: string): string | null {
  if (isPinnedNode(doc.nodes[id] as Styled)) return id;
  for (const up of ancestors(doc, id)) {
    if (isPinnedNode(doc.nodes[up] as Styled)) return up;
  }
  return null;
}

/**
 * The nearest ancestor whose overflow stops a sticky node from working, or null.
 *
 * Starts at the PARENT: a sticky element's own overflow clips its children, not
 * itself, and blaming it would send the caller to fix a property that is not the
 * problem. Reads base overlaid with `bp` — the cascade's own order for a single
 * key — so a clip declared only at mobile is named only when writing mobile.
 */
export function stickyBlockedBy(doc: DocLike, id: string, bp?: string): string | null {
  for (const up of ancestors(doc, id)) {
    const node = doc.nodes[up] as Styled | undefined;
    if (!node) return null;
    const s = { ...styleAt(node), ...(bp ? styleAt(node, bp) : {}) };
    if (CLIPPING.has(String(s.overflowX)) || CLIPPING.has(String(s.overflowY))) return up;
  }
  return null;
}

/**
 * The keys the editor writes alongside `position: sticky`, for the same reasons
 * — offered here only when the caller has not answered them and the node does
 * not already, so an explicit choice is never overwritten.
 *
 * `top` is skipped when the same call pins to another edge: the inspector writes
 * one key at a time and cannot have that case, an agent writing
 * `{ position: 'sticky', bottom: '0px' }` in one object plainly can, and seeding
 * `top: 0` over it would pin a bottom bar to the ceiling.
 *
 * `10` for the layer order is a specific number, not a large one: it sits above
 * ordinary page content and BELOW the overlay ladder the static CSS owns (cart
 * scrim 40, drawer 41, pop-up scrim 50, pop-up 51). A header that outranked
 * those would cover the drawer it opens.
 */
export function stickySeeds(
  node: Styled | undefined,
  keys: Record<string, unknown>,
  bp?: string,
): Record<string, unknown> {
  if (String(keys.position) !== 'sticky') return {};
  const merged = { ...styleAt(node), ...(bp ? styleAt(node, bp) : {}), ...keys };
  const seeds: Record<string, unknown> = {};
  if (merged.top === undefined && merged.bottom === undefined) seeds.top = '0px';
  if (merged.zIndex === undefined) seeds.zIndex = '10';
  return seeds;
}

/**
 * What a stuck state may carry in `config`.
 *
 * `stuckDecls` reads the style slot whole and translates exactly ONE config key
 * — `hidden` — into `display: none`, because a state has no bands and no cascade
 * of its own, so a declaration is the only shape available. Every other config
 * key in a stuck slot is stored by the document and read by no compiler.
 *
 * And only `true` is honoured: `false` would have to mean "show it again while
 * pinned", which needs `display: revert`, and the platform's `render/css.go`
 * documents at length why revert is wrong here — it rolls the property back past
 * the element's own static CSS and lands on the UA default. So OFF means "no
 * override", i.e. remove the key.
 */
export function refuseStuckConfig(keys: Record<string, unknown>): void {
  const stray = Object.keys(keys).filter((k) => k !== 'hidden');
  if (stray.length) {
    throw new Error(
      `sbuilder: the stuck state translates exactly one config key — "hidden" — into a ` +
        `declaration (display:none). ${stray.map((k) => `"${k}"`).join(', ')} would be stored ` +
        'and read by no compiler. A state has no bands and no cascade, so style is what it ' +
        'paints: write these in the style namespace, or at base if they are not stuck-specific.',
    );
  }
  if ('hidden' in keys && keys.hidden !== true) {
    throw new Error(
      'sbuilder: stuck config.hidden takes only true. false would have to mean "show it again ' +
        'while pinned", which needs display:revert — wrong here, because revert rolls past the ' +
        "element's own static CSS to the UA default. To stop hiding it, remove the override.",
    );
  }
}

/**
 * Refuse a stuck override that no selector would ever match.
 *
 * The message names the fix rather than the rule, because the caller who lands
 * here is one step from the design they wanted: pin this node, or pin the
 * section it lives in, and the same override starts painting.
 */
export function requireStuckHost(doc: DocLike, id: string): void {
  if (stuckHostOf(doc, id)) return;
  const up = ancestors(doc, id)[0];
  throw new Error(
    `sbuilder: "${STUCK_STATE}" is the state a PINNED element wears once it is stuck, and ` +
      `neither ${id} nor any ancestor can pin — so the platform compiles no rule for it ` +
      '(render/css.go emits stuck CSS only under a stuck host). The override would be stored, ' +
      'saved, published and never painted. Pin the element that scrolls first: ' +
      `sb_set ${up ?? id} style { position: "sticky" } — a descendant then styles itself ` +
      'through the host, so this node needs no position of its own.',
  );
}

/**
 * The warning a sticky node earns when an ancestor's overflow will defeat it.
 *
 * Only for `sticky`. A `fixed` element is positioned against the viewport and
 * an overflow ancestor cannot take that away from it — the ancestors that CAN
 * (a `transform`, a `filter`, a `contain`) are a different question this does
 * not pretend to answer.
 *
 * A warning rather than a refusal, because the clip may be the deliberate half:
 * the author may be about to remove it, or may mean the node to pin inside a
 * scrolling panel. Silence is the only wrong answer — the failure shows up as
 * nothing on screen and nothing in the log.
 */
export function stickyWarning(doc: DocLike, id: string, bp?: string): string | null {
  const node = doc.nodes[id] as Styled | undefined;
  const sticky =
    String(styleAt(node).position) === 'sticky' ||
    BREAKPOINTS.some((b) => String(styleAt(node, b).position) === 'sticky');
  if (!sticky) return null;
  const blocker = stickyBlockedBy(doc, id, bp);
  if (!blocker) return null;
  return (
    `${id} is sticky, but ancestor ${blocker} clips its overflow (hidden/auto/scroll/clip/` +
    'overlay), so it becomes the scroll container this node pins inside — a box that never ' +
    `scrolls. The node will not move. Clear overflowX/overflowY on ${blocker}, or pin a node ` +
    'outside it.'
  );
}
