import type { Patch } from '../../core/patch.js';
import { isOverlay, subtreeIds, ancestors } from '../../core/tree.js';
import { ELEMENTS } from '../../catalog/elements.generated.js';
import { createNode } from './node.js';
import { isIdentityKey } from './traps.js';
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
  opts: { namespace: 'style' | 'config' | 'specials'; breakpoint?: Breakpoint; base?: boolean },
): Patch[] {
  doc.node(id); // throws naming the id if it is not there
  const { namespace } = opts;

  if (namespace === 'specials') {
    return Object.entries(keys).map(([k, v]) => ({
      op: 'set' as const,
      path: ['nodes', id, 'specials', k],
      value: v,
    }));
  }

  if (opts.base) {
    const offenders = Object.keys(keys).filter((k) => !isIdentityKey(k));
    if (offenders.length > 0) {
      throw new Error(
        `sbuilder: refusing a base-only write of [${offenders.join(', ')}]. A visual quantity ` +
          'written at base renders on the canvas and then VANISHES on publish. Write it per ' +
          'breakpoint instead, or pass identity keys only.',
      );
    }
    return Object.entries(keys).map(([k, v]) => ({
      op: 'set' as const,
      path: ['nodes', id, namespace, k],
      value: v,
    }));
  }

  const bp = opts.breakpoint ?? 'desktop';
  return Object.entries(keys).map(([k, v]) => ({
    op: 'set' as const,
    path: ['nodes', id, 'responsive', bp, namespace, k],
    value: v,
  }));
}

export function moveNode(doc: PageDoc, id: string, newParentId: string, index: number): Patch[] {
  const n = doc.node(id);
  refuseOverlay(doc, id, 'moving');
  const newParent = doc.node(newParentId);

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
