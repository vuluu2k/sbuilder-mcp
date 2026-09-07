export interface NodeLike {
  id: string;
  data: { type: string; name?: string; parent: string | null; nodes: string[] };
  specials: Record<string, unknown>;
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

/** Depth-first walk. Cycle-safe: a malformed document must not hang a save. */
export function walk(doc: DocLike, id: string, visit: (n: NodeLike) => void): void {
  const seen = new Set<string>();
  const go = (cur: string): void => {
    if (seen.has(cur)) return;
    seen.add(cur);
    const n = doc.nodes[cur];
    if (!n) return;
    visit(n);
    for (const k of n.data.nodes) go(k);
  };
  go(id);
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
export function appBlockRoot(doc: DocLike, id: string): string | null {
  const stamped = (n?: NodeLike): boolean =>
    n !== undefined &&
    (n.specials?.[SPEC_APP_BLOCK_ID] !== undefined || n.specials?.[SPEC_APP_BLOCK_REF] !== undefined);
  if (stamped(doc.nodes[id])) return id;
  for (const a of ancestors(doc, id)) if (stamped(doc.nodes[a])) return a;
  return null;
}
