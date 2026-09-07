import type { Patch } from '../../core/patch.js';
import { isOverlay, subtreeIds, ancestors, appBlockRoot } from '../../core/tree.js';
import { ELEMENTS } from '../../catalog/elements.generated.js';
import { createNode } from './node.js';
import { genId } from './ids.js';
import type { PageDoc } from './document.js';

export type Breakpoint = 'desktop' | 'laptop' | 'tablet' | 'mobile';

export interface NodeSpec {
  type: string;
  name?: string;
  style?: Record<string, unknown>;
  config?: Record<string, unknown>;
  specials?: Record<string, unknown>;
  children?: NodeSpec[];
}

/** Append sentinel: splice clamps a too-large index, and `isSyncablePatch`
 *  deliberately allows one — an append is a legitimate thing to describe. */
const APPEND = Number.MAX_SAFE_INTEGER;

function requireContainer(parentType: string, parentId: string): void {
  if (!ELEMENTS[parentType]?.isContainer) {
    throw new Error(
      `sbuilder: ${parentId} is a ${parentType}, which is not a container — it cannot hold children.`,
    );
  }
}

function requireAllowed(parentType: string, childType: string): void {
  const child = ELEMENTS[childType];
  if (!child) {
    throw new Error(
      `sbuilder: unknown element "${childType}". Use sb_catalog_search to find a real one.`,
    );
  }
  if (child.isRootOnly && parentType !== 'root') {
    throw new Error(
      `sbuilder: ${childType} is root-only — it may only be a direct child of ROOT, not of a ${parentType}.`,
    );
  }
  const allows = ELEMENTS[parentType]?.childAllows ?? [];
  if (allows.length > 0 && !allows.includes(childType)) {
    throw new Error(`sbuilder: a ${parentType} accepts only [${allows.join(', ')}], not ${childType}.`);
  }
}

function refuseOverlay(doc: PageDoc, id: string, verb: string): void {
  if (!isOverlay(doc.doc, id)) return;
  throw new Error(
    `sbuilder: ${id} is a SITE OVERLAY (the cart drawer or a pop-up). It is composed onto ROOT ` +
      `on read and stripped out on write, so it is not part of this page document — ${verb} it ` +
      'here would do nothing on save. Use the overlays API instead.',
  );
}

function appBlockMessage(id: string, root: string, verb: string): string {
  const where =
    id === root
      ? `${id} is the root of an app block, so anything placed under it lands inside the block`
      : `${id} is inside the app block ${root}`;
  return (
    `sbuilder: ${where}. On save the platform reduces the whole block back to its reference, ` +
    `so ${verb} here would be lost silently. Configure the block through its app, or remove ` +
    `the block (sb_remove ${root}).`
  );
}

/**
 * TRAP 5: refuse a write to a strict descendant of a composed app block.
 *
 * The block ROOT is allowed through — it is the reference node the document
 * actually stores, and `specials.appBlockValues` on it is exactly where the
 * merchant's settings live. Everything under it is the app's markup, composed
 * on read and reduced back to the reference on write: an edit there is stored
 * nowhere and reported nowhere.
 */
export function refuseAppBlockInterior(doc: PageDoc, id: string, verb: string): void {
  const root = appBlockRoot(doc.doc, id);
  if (!root || root === id) return;
  throw new Error(appBlockMessage(id, root, verb));
}

/**
 * The parent-side twin: a child placed under ANY node of a block — the root
 * included — lands inside the block, so the root is refused here where
 * `refuseAppBlockInterior` lets it through.
 */
function refuseAppBlockParent(doc: PageDoc, parentId: string, verb: string): void {
  const root = appBlockRoot(doc.doc, parentId);
  if (!root) return;
  throw new Error(appBlockMessage(parentId, root, verb));
}

/**
 * Add a whole subtree under `parentId`, as ONE batch of patches.
 *
 * Nested rather than one-node-per-call because a hero section is a section, a
 * heading, a paragraph and a button — four round trips to describe one idea, and
 * four separate op batches for anyone watching the room. The spec is a tree; the
 * patches come out flat in CREATION ORDER, so a peer applying them left to right
 * never sees a child referenced before the node exists.
 */
export function addSubtree(
  doc: PageDoc,
  parentId: string,
  spec: NodeSpec,
  index?: number,
): { patches: Patch[]; ids: string[] } {
  const parent = doc.node(parentId);
  refuseAppBlockParent(doc, parentId, 'adding');
  requireContainer(parent.data.type, parentId);
  requireAllowed(parent.data.type, spec.type);

  const patches: Patch[] = [];
  const ids: string[] = [];

  const build = (s: NodeSpec, parentNodeId: string): string => {
    const n = createNode(s.type, {
      name: s.name,
      parent: parentNodeId,
      style: s.style,
      config: s.config,
      specials: s.specials,
    });
    patches.push({ op: 'set', path: ['nodes', n.id], value: n });
    ids.push(n.id);
    for (const child of s.children ?? []) {
      requireContainer(s.type, n.id);
      requireAllowed(s.type, child.type);
      const childId = build(child, n.id);
      patches.push({ op: 'insert', path: ['nodes', n.id, 'data', 'nodes'], index: APPEND, value: childId });
    }
    return n.id;
  };

  const rootId = build(spec, parentId);
  const at = index ?? parent.data.nodes.length;
  patches.push({ op: 'insert', path: ['nodes', parentId, 'data', 'nodes'], index: at, value: rootId });
  return { patches, ids };
}

/**
 * Write keys into a namespace.
 *
 * PER BREAKPOINT BY DEFAULT, and that default is the whole point. The platform's
 * rule is that any key which CAN be responsive MUST be: a visual quantity
 * written at base renders correctly on the canvas and then VANISHES on publish,
 * because the published cascade has no base layer under it. An agent writing
 * styles would otherwise ship that bug on every element it touches.
 *
 * `specials` needs no flag and takes no breakpoint: it is content and identity,
 * base-only by definition.
 */
export function setKeys(
  doc: PageDoc,
  id: string,
  keys: Record<string, unknown>,
  opts: {
    namespace: 'style' | 'config' | 'specials';
    breakpoint?: Breakpoint;
    base?: boolean;
    /**
     * An interaction state — `hover` is the one the inspector offers.
     *
     * A state is a variation ON a breakpoint's style, so it nests under the
     * breakpoint rather than replacing it, and it never takes the base branch:
     * "how this looks when hovered" is a visual quantity like any other.
     */
    state?: string;
  },
): Patch[] {
  doc.node(id); // throws naming the id if it is not there
  refuseAppBlockInterior(doc, id, 'writing');
  const { namespace } = opts;

  if (namespace === 'specials') {
    return Object.entries(keys).map(([k, v]) => ({
      op: 'set' as const,
      path: ['nodes', id, 'specials', k],
      value: v,
    }));
  }

  if (opts.base) {
    // Base IS legitimate, and this used to throw for anything that was not an
    // identity key — a refusal built on a misread of the platform's responsive
    // mandate.
    //
    // That mandate is about ELEMENT IMPLEMENTATION: an element whose Go renderer
    // reads `n.Config[...]` directly (nodes.ConfigInt in html.go, an SVG width=
    // attribute) bypasses the cascade, so a per-breakpoint value the author sets
    // renders on the canvas and never reaches publish. It is not a rule about
    // documents.
    //
    // The cascade proves it: style/cascade.go's MergeNamespace resolves a key
    // "current slot, then wider slots, then BASE, then narrower slots" — base is
    // the fallback layer, and it is exactly where every element's own
    // meta.defaults.style is seeded. Refusing to write there refused a namespace
    // the platform itself fills on every node it creates.
    //
    // Per-breakpoint remains the DEFAULT, because a design should respond. Base
    // is for a value that genuinely should not vary.
    return Object.entries(keys).map(([k, v]) => ({
      op: 'set' as const,
      path: ['nodes', id, namespace, k],
      value: v,
    }));
  }

  const bp = opts.breakpoint ?? 'desktop';
  if (opts.state) {
    return Object.entries(keys).map(([k, v]) => ({
      op: 'set' as const,
      path: ['nodes', id, 'states', opts.state as string, bp, namespace, k],
      value: v,
    }));
  }
  return Object.entries(keys).map(([k, v]) => ({
    op: 'set' as const,
    path: ['nodes', id, 'responsive', bp, namespace, k],
    value: v,
  }));
}

/**
 * Copy a node and everything under it, under fresh ids, beside the original.
 *
 * The move a designer makes constantly — build one card, duplicate it twice —
 * and without it an agent rebuilds the subtree by hand and gets it subtly
 * different. Ids are re-minted rather than reused: two nodes sharing an id is a
 * document the renderer draws once and the editor cannot select.
 *
 * Refuses ROOT (there is nothing to put a second one beside) and an overlay
 * (not part of this document at all).
 */
export function duplicateNode(doc: PageDoc, id: string): { patches: Patch[]; ids: string[] } {
  const n = doc.node(id);
  if (id === doc.doc.root_node_id) throw new Error('sbuilder: cannot duplicate ROOT');
  refuseOverlay(doc, id, 'duplicating');
  refuseAppBlockInterior(doc, id, 'duplicating');
  // A copy of a composed block carries the original's appBlockId/appBlockHash
  // stamps; the save reduces it to a reference and the platform answers with a
  // WarnAppBlockEdited this client does not surface — so the local tree and the
  // stored one would silently differ. Refuse, and say how to get the block back.
  const blockInside = subtreeIds(doc.doc, id).find((n) => appBlockRoot(doc.doc, n) === n);
  if (blockInside) {
    throw new Error(
      `sbuilder:  contains the app block , whose copy the platform would ` +
        'reduce back to a reference on save. Remove the block, duplicate, then add the block ' +
        'again through its app.',
    );
  }
  const parentId = n.data.parent;
  if (!parentId || !doc.has(parentId)) {
    throw new Error(`sbuilder: ${id} has no parent to be duplicated beside`);
  }

  const patches: Patch[] = [];
  const ids: string[] = [];
  // One pass, parent-first, so a child's `parent` always names an id already
  // emitted — the same ordering rule addSubtree follows.
  const copy = (srcId: string, newParent: string): string => {
    const src = doc.node(srcId) as unknown as Record<string, unknown> & {
      data: { type: string; name?: string; parent: string | null; nodes: string[] };
    };
    const clone = JSON.parse(JSON.stringify(src)) as typeof src & { id: string };
    clone.id = genId(src.data.type);
    clone.data = { ...clone.data, parent: newParent, nodes: [] };
    patches.push({ op: 'set', path: ['nodes', clone.id], value: clone });
    ids.push(clone.id);
    for (const kid of src.data.nodes) {
      const kidId = copy(kid, clone.id);
      patches.push({ op: 'insert', path: ['nodes', clone.id, 'data', 'nodes'], index: APPEND, value: kidId });
    }
    return clone.id;
  };

  const rootId = copy(id, parentId);
  const at = doc.node(parentId).data.nodes.indexOf(id);
  patches.push({
    op: 'insert',
    path: ['nodes', parentId, 'data', 'nodes'],
    index: at < 0 ? APPEND : at + 1,
    value: rootId,
  });
  return { patches, ids };
}

export function moveNode(doc: PageDoc, id: string, newParentId: string, index: number): Patch[] {
  const n = doc.node(id);
  refuseOverlay(doc, id, 'moving');
  refuseAppBlockInterior(doc, id, 'moving');
  const newParent = doc.node(newParentId);
  refuseAppBlockParent(doc, newParentId, 'moving');

  // The STRUCTURAL check runs first, before the type rules, and the order is not
  // arbitrary: a node moved inside its own subtree detaches that subtree from the
  // document with nothing to report it — the nodes still sit in the map,
  // reachable from nobody, and the page silently loses a section. Running the
  // type rules first would report "flex-section is root-only" for a caller whose
  // actual mistake was moving a node into itself, which sends them to fix the
  // wrong thing.
  if (newParentId === id || subtreeIds(doc.doc, id).includes(newParentId) || ancestors(doc.doc, newParentId).includes(id)) {
    throw new Error(`sbuilder: cannot move ${id} into its own descendant ${newParentId}`);
  }

  requireContainer(newParent.data.type, newParentId);
  requireAllowed(newParent.data.type, n.data.type);

  const patches: Patch[] = [];
  const oldParentId = n.data.parent;
  if (oldParentId && doc.has(oldParentId)) {
    const at = doc.node(oldParentId).data.nodes.indexOf(id);
    if (at >= 0) patches.push({ op: 'remove', path: ['nodes', oldParentId, 'data', 'nodes'], index: at });
  }
  patches.push({ op: 'insert', path: ['nodes', newParentId, 'data', 'nodes'], index, value: id });
  patches.push({ op: 'set', path: ['nodes', id, 'data', 'parent'], value: newParentId });
  return patches;
}

export function removeNode(doc: PageDoc, id: string): Patch[] {
  const n = doc.node(id);
  if (id === doc.doc.root_node_id) throw new Error('sbuilder: cannot remove ROOT');
  refuseOverlay(doc, id, 'removing');
  refuseAppBlockInterior(doc, id, 'removing');

  const patches: Patch[] = [];
  const parentId = n.data.parent;
  if (parentId && doc.has(parentId)) {
    const at = doc.node(parentId).data.nodes.indexOf(id);
    if (at >= 0) patches.push({ op: 'remove', path: ['nodes', parentId, 'data', 'nodes'], index: at });
  }
  // Unset the whole subtree — a node left behind is an orphan the save check
  // would reject, and the agent would never guess why.
  for (const sub of subtreeIds(doc.doc, id)) {
    patches.push({ op: 'unset', path: ['nodes', sub] });
  }
  return patches;
}
