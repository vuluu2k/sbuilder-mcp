import { SATELLITE_RULES } from '../catalog/elements.generated.js';
export interface NodeLike {
  id: string;
  data: { type: string; name?: string; parent: string | null; nodes: string[] };
  specials: Record<string, unknown>;
  /** Where a SATELLITE id lives — see `walk`. Optional so a fixture may omit it. */
  config?: Record<string, unknown>;
}

export interface DocLike {
  schema_version: number;
  root_node_id: string;
  nodes: Record<string, NodeLike>;
}

/** The specials stamp a composed site overlay carries. */
export const SPEC_OVERLAY_ID = 'overlayId';
/** The specials stamps a composed global section carries. */
export const SPEC_GLOBAL_ID = 'globalId';
export const SPEC_GLOBAL_KIND = 'globalKind';
/**
 * The OPTIMISTIC FENCE on a shared master, one per kind.
 *
 * Compose writes it, the save sends it back as `expectRev`, and the platform
 * refuses a stale one with a warning and a 200 — so a client that does not
 * re-stamp from the save's own report silently drops every edit after the first.
 */
export const SPEC_GLOBAL_REV = 'globalRev';
export const SPEC_OVERLAY_REV = 'overlayRev';
export const SPEC_GLOBAL_REF = 'globalRef';
/** The specials stamps a composed APP BLOCK carries (appblocks.go:97-100). */
export const SPEC_APP_BLOCK_ID = 'appBlockId';
export const SPEC_APP_BLOCK_REF = 'appBlockRef';

export function childrenOf(doc: DocLike, id: string): string[] {
  return doc.nodes[id]?.data.nodes ?? [];
}

/**
 * Is this node a composed SITE OVERLAY — the cart drawer, a pop-up?
 *
 * Two conditions, and the second is load-bearing: the node must carry the
 * `overlayId` stamp AND be a DIRECT child of ROOT. The platform enforces exactly
 * that on write, and it is what keeps overlays out of repeater rows, out of
 * global sections, and out of each other — a stamp found deeper in the tree
 * would otherwise be stored inside whatever contains it.
 */
export function isOverlay(doc: DocLike, id: string): boolean {
  const n = doc.nodes[id];
  if (!n || n.specials?.[SPEC_OVERLAY_ID] === undefined) return false;
  return childrenOf(doc, doc.root_node_id).includes(id);
}

/**
 * ROOT's children WITHOUT the overlays — the walk every ROOT-level rule must use.
 *
 * A separate function from `childrenOf` on purpose. An overlay is composed onto
 * ROOT on read and stripped on write, so it is not part of the page document at
 * all: the band rule, drag clamping and the save check all have to skip it. A
 * caller who writes the obvious `childrenOf(doc, doc.root_node_id)` gets that
 * wrong SILENTLY, so the correct walk is the one with the shorter name.
 */
export function pageChildren(doc: DocLike): string[] {
  return childrenOf(doc, doc.root_node_id).filter((id) => !isOverlay(doc, id));
}

/**
 * Depth-first walk, children AND satellites. Cycle-safe: a malformed document
 * must not hang a save.
 *
 * A satellite is a real node referenced from `config[configKey]` rather than
 * from `data.nodes`, so a walk that follows child lists alone cannot see it. The
 * platform states the requirement in as many words
 * (`server/render/generated/schema_gen.go:245`): "Anything that asks 'what is
 * inside this node?' (subtree collection, copy, delete) must consult this table
 * as well, exactly as the editor's `subtreeIds` does."
 *
 * Satellite-aware is the DEFAULT, and the name stays short, for the same reason
 * `pageChildren` has the short name and `childrenOf` the explicit one: a caller
 * who writes the obvious thing must not be silently wrong. Copying an accordion
 * with the child-only walk gave the copy a pointer to the ORIGINAL's skin.
 *
 * A `configKey` naming a node that is not in the document is skipped rather than
 * reported here — a walk is not a validator, and a trimmed subtree is a real
 * shape the editor handles the same way (`stores/node.ts:408-411`).
 */
export function walk(doc: DocLike, id: string, visit: (n: NodeLike) => void): void {
  const seen = new Set<string>();
  const go = (cur: string): void => {
    if (seen.has(cur)) return;
    seen.add(cur);
    const n = doc.nodes[cur];
    if (!n) return;
    visit(n);
    for (const k of n.data.nodes) go(k);
    for (const rule of SATELLITE_RULES[n.data.type] ?? []) {
      const sat = n.config?.[rule.configKey];
      if (typeof sat === 'string' && sat && doc.nodes[sat]) go(sat);
    }
  };
  go(id);
}

/**
 * One level of `walk`: `data.nodes` followed by the satellites on `config[key]`.
 *
 * For a caller that needs its OWN recursion — carrying scope down as it goes,
 * the way `reviewDesign` carries "am I inside a repeater / an overlay" — and so
 * cannot hand the traversal to `walk`. Such a caller reaching for `childrenOf`
 * is the mistake `walk`'s comment warns about, and `sb_review` made it: it never
 * saw a satellite, so every empty state, every variant-option skin and every
 * quantity stepper was outside the review entirely.
 *
 * Satellites come AFTER the real children and are not deduplicated against
 * them — a `configKey` pointing at a node that is also a child would be a
 * malformed document, and a walk is not a validator.
 */
export function childrenWithSatellites(doc: DocLike, id: string): string[] {
  const n = doc.nodes[id];
  if (!n) return [];
  const out = [...n.data.nodes];
  for (const rule of SATELLITE_RULES[n.data.type] ?? []) {
    const sat = n.config?.[rule.configKey];
    if (typeof sat === 'string' && sat && doc.nodes[sat]) out.push(sat);
  }
  return out;
}

export function subtreeIds(doc: DocLike, id: string): string[] {
  const out: string[] = [];
  walk(doc, id, (n) => out.push(n.id));
  return out;
}

/** Ids from this node's parent up to ROOT. Cycle-safe for the same reason. */
export function ancestors(doc: DocLike, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = doc.nodes[id]?.data.parent ?? null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = doc.nodes[cur]?.data.parent ?? null;
  }
  return out;
}

/**
 * The composed app block this node sits in, or null.
 *
 * A marketplace app contributes a subtree. The document stores ONE reference
 * node (`appBlockRef`); on read the platform materializes the app's markup under
 * it and stamps the root `appBlockId`; on write `DecomposeAppBlocks` reduces the
 * whole subtree back to the reference (globalservice.go:56). An edit inside is
 * therefore stored nowhere and reported nowhere — trap 5. Nearest stamp wins:
 * the block root answers with itself.
 */
/**
 * The site overlay this node sits in, or null. Nearest stamp wins, so the
 * overlay root answers with itself.
 *
 * `isOverlay` answers only for the ROOT of one, which is right for the rules
 * that decide whether a node may BE an overlay. It is the wrong question for a
 * WRITE: an edit to a node inside the cart drawer is an edit to the drawer, and
 * the drawer is one master shared by every page on the site. Without this, a
 * `sb_set` on a drawer node reported a plain page-local success while changing
 * ten pages — the same asymmetry `sb_review` closed when it started walking
 * overlays and flagging their findings `overlay: true`.
 */
export function overlayRoot(doc: DocLike, id: string): string | null {
  if (isOverlay(doc, id)) return id;
  for (const a of ancestors(doc, id)) if (isOverlay(doc, a)) return a;
  return null;
}

export function appBlockRoot(doc: DocLike, id: string): string | null {
  const stamped = (n?: NodeLike): boolean =>
    n !== undefined &&
    (n.specials?.[SPEC_APP_BLOCK_ID] !== undefined || n.specials?.[SPEC_APP_BLOCK_REF] !== undefined);
  if (stamped(doc.nodes[id])) return id;
  for (const a of ancestors(doc, id)) if (stamped(doc.nodes[a])) return a;
  return null;
}
