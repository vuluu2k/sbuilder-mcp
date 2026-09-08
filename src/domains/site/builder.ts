import type { Patch } from '../../core/patch.js';
import {
  isOverlay,
  subtreeIds,
  ancestors,
  appBlockRoot,
  SPEC_GLOBAL_ID,
  SPEC_GLOBAL_KIND,
  SPEC_GLOBAL_REF,
} from '../../core/tree.js';
import { ELEMENTS, ELEMENT_SEEDS, SATELLITE_RULES } from '../../catalog/elements.generated.js';
import { bindingsForConfig, createNode, mintSatellites } from './node.js';
import { refuseSecondTemplate } from './traps.js';
import { STUCK_STATE, refuseStuckConfig, requireStuckHost, stickySeeds } from './sticky.js';
import { genId } from './ids.js';
import type { PageDoc } from './document.js';

export type Breakpoint = 'desktop' | 'laptop' | 'tablet' | 'mobile';

export interface NodeSpec {
  type: string;
  name?: string;
  style?: Record<string, unknown>;
  config?: Record<string, unknown>;
  specials?: Record<string, unknown>;
  /** Per-breakpoint overrides, merged over the element's own — see CreateOpts. */
  responsive?: Record<string, { style?: Record<string, unknown>; config?: Record<string, unknown> }>;
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
  refuseSecondTemplate(doc.doc, parentId, 'Adding');

  const patches: Patch[] = [];
  const ids: string[] = [];

  const build = (s: NodeSpec, parentNodeId: string): string => {
    refuseComposedStamp(s.specials);
    const n = createNode(s.type, {
      name: s.name,
      parent: parentNodeId,
      style: s.style,
      config: s.config,
      specials: s.specials,
      responsive: s.responsive,
    });
    // Before the owner is handed to a patch: minting rewrites its `config`.
    const sats = mintSatellites(n);
    patches.push({ op: 'set', path: ['nodes', n.id], value: n });
    ids.push(n.id);
    for (const sat of sats) {
      patches.push({ op: 'set', path: ['nodes', sat.id], value: sat });
      ids.push(sat.id);
    }
    // SEEDED CONTENT, when the caller brought none of its own.
    //
    // `ELEMENT_SEEDS` is the content an element "is not USABLE without": a
    // dropdown with no trigger and no panel is a bare relative box, and a select
    // renders INTO those two nodes and draws an empty box without them. A caller
    // who passed children has expressed an intent and is never overridden.
    const children = s.children?.length ? s.children : (ELEMENT_SEEDS[s.type] ?? []);
    for (const child of children) {
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
 * Refuse the stamps the SERVER writes, which a caller must never author.
 *
 * `globalId` and `appBlockId` are what compose puts on a node it just
 * materialised; the REFERENCE a document stores is `globalRef` / `appBlockRef`.
 * Author the composed stamp instead and the save decomposes your node over the
 * master: a section with no children silently overwrites a shared header's
 * whole subtree, and every page carrying it goes blank. That is not a
 * hypothetical — it took four pages down before this check existed.
 */
/**
 * The composition stamps a DUPLICATE must not inherit.
 *
 * `globalRev` is the fence the editor writes against a shared master
 * (`features/globalsections/api.ts:65`); a local copy has no master and so no
 * revision to be stale against.
 */
const COPY_STRIPPED_SPECIALS = [SPEC_GLOBAL_ID, SPEC_GLOBAL_REF, SPEC_GLOBAL_KIND, 'globalRev'];

const COMPOSED_STAMPS: Record<string, string> = {
  globalId: 'globalRef',
  appBlockId: 'appBlockRef',
  appBlockHash: 'appBlockRef',
};

function refuseComposedStamp(specials?: Record<string, unknown>): void {
  if (!specials) return;
  for (const [stamp, ref] of Object.entries(COMPOSED_STAMPS)) {
    if (specials[stamp] === undefined) continue;
    throw new Error(
      `sbuilder: "${stamp}" is the stamp the SERVER writes when it composes a shared subtree ` +
        `onto the page. A document REFERENCES one with "${ref}" instead. Writing ${stamp} makes ` +
        `the next save decompose this node over the master, which empties it for every page ` +
        `that carries it. Use specials.${ref}.`,
    );
  }
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
     * A state has TWO homes, and the platform names both
     * (`schema/src/node.ts`, mirrored by `render/style/cascade.go`'s
     * MergeStateNs):
     *
     *   base            node.states[state][ns]
     *   per breakpoint  node.responsive[bp].states[state][ns]
     *
     * The base one is not a degenerate case to be routed away from: it is where
     * every element's own `meta.defaults.states` is seeded — `tab-item`'s hover,
     * `quantity-button`'s hover — so it is the layer an author is usually
     * editing. `MergeStateNs` reads it first and lets breakpoint slots overlay
     * it, exactly as it does for the plain namespace.
     */
    state?: string;
  },
): Patch[] {
  doc.node(id); // throws naming the id if it is not there
  refuseAppBlockInterior(doc, id, 'writing');
  const { namespace } = opts;

  // RE-DERIVE THE BINDINGS when the data axis moves.
  //
  // A dataset element's bindings are a function of `config.datasetSource` and
  // `config.kind`. Rewrite either and leave the bindings alone, and the node
  // still reads the OLD entity's field: switch a text-dataset from a product
  // title to a collection title and it stays bound to `product.title`, which
  // off a product page resolves to nothing. It renders empty and says nothing —
  // the same silent shape as an unbound element, which cost a whole page of
  // "$0.00" cards to find once.
  const rebind = namespace === 'config' ? rebindPatch(doc, id, keys) : null;

  if (namespace === 'specials') {
    refuseComposedStamp(keys);
    // `specials` is content and identity, base-only by definition, and states
    // carry style. Saying so is the point: this used to drop the state and write
    // the value as if it had been asked for plainly.
    if (opts.state) {
      throw new Error(
        `sbuilder: specials takes no interaction state — "${opts.state}" would be dropped. ` +
          'specials is content and identity (text, htmlTag, bound…), which do not vary by ' +
          'state. Style is what has states.',
      );
    }
    return Object.entries(keys).map(([k, v]) => ({
      op: 'set' as const,
      path: ['nodes', id, 'specials', k],
      value: v,
    }));
  }

  // A STATE IS ANSWERED BEFORE `base`, because `base` used to be tested first
  // and swallowed it: `base:true state:"hover"` wrote the hover value straight
  // into the plain style, so the node wore its hover colour permanently and had
  // no hover at all. The tool reported success, and this repo's own design skill
  // documents that exact call — `sb_set pr_option style base:true state:"active"`
  // — as the way to style a selected option.
  if (opts.state) {
    // THE STUCK STATE IS THE ONE STATE WITH A PRECONDITION. Every other state
    // is a pseudo-class the browser resolves on the node itself; `stuck` is a
    // class a runtime island toggles on the PINNED element, and the renderer
    // emits no rule at all when there is nothing pinned to hang it off. See
    // sticky.ts — this is the whole reason that module exists.
    if (opts.state === STUCK_STATE) {
      requireStuckHost(doc.doc, id);
      if (namespace === 'config') refuseStuckConfig(keys);
    }
    // Base state and per-breakpoint state are DIFFERENT PLACES in the document,
    // and the old path (`states[state][bp][ns]`) was neither of them: it buried
    // a breakpoint inside the base-state cluster, where nothing reads it.
    const prefix = opts.base
      ? ['nodes', id, 'states', opts.state]
      : ['nodes', id, 'responsive', opts.breakpoint ?? 'desktop', 'states', opts.state];
    return [
      ...Object.entries(keys).map(([k, v]) => ({
        op: 'set' as const,
        path: [...prefix, namespace, k],
        value: v,
      })),
      ...(rebind ? [rebind] : []),
    ];
  }

  // WRITING `position: sticky` IS THREE WRITES, and the editor makes all three.
  // An agent that made only the first shipped a header the page paints over —
  // measured in Chromium by the platform, not inferred. Seeded only where the
  // caller and the node are both silent, so an explicit answer always wins.
  if (namespace === 'style') {
    const seeds = stickySeeds(
      doc.node(id) as never,
      keys,
      opts.base ? undefined : (opts.breakpoint ?? 'desktop'),
    );
    if (Object.keys(seeds).length) keys = { ...seeds, ...keys };
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
    return [
      ...Object.entries(keys).map(([k, v]) => ({
        op: 'set' as const,
        path: ['nodes', id, namespace, k],
        value: v,
      })),
      ...(rebind ? [rebind] : []),
    ];
  }

  const bp = opts.breakpoint ?? 'desktop';
  return [
    ...Object.entries(keys).map(([k, v]) => ({
      op: 'set' as const,
      path: ['nodes', id, 'responsive', bp, namespace, k],
      value: v,
    })),
    ...(rebind ? [rebind] : []),
  ];
}

/**
 * The patch that re-points a dataset element at the entity and field it is now
 * configured for, or null when nothing about the data axis moved.
 *
 * Reads the generated `bindingsFor` table — the platform's own
 * `datasetBindings(type, config)` answers, enumerated at codegen — so the
 * result is what the editor would have produced for the same config. A pair the
 * table does not know (an exotic kind, an element with no data axis) leaves the
 * bindings alone rather than clearing them: a wrong binding is bad, and no
 * binding is worse.
 */
function rebindPatch(doc: PageDoc, id: string, keys: Record<string, unknown>): Patch | null {
  const touchesAxis = 'kind' in keys || 'datasetSource' in keys;
  if (!touchesAxis) return null;
  const node = doc.node(id);
  const cfg = (node as unknown as { config?: Record<string, unknown> }).config ?? {};
  // The config the node will HAVE once these keys land — the axis is read off
  // the result of the write, not off either half of it.
  const next = bindingsForConfig(node.data.type, { ...cfg, ...keys, datasetSource: keys.datasetSource ?? cfg.datasetSource ?? 'product' });
  if (!next) return null;
  return { op: 'set', path: ['nodes', id, 'bindings'], value: next };
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
      `sbuilder: ${id} contains the app block ${blockInside}, whose copy the platform would ` +
        'reduce back to a reference on save. Remove the block, duplicate, then add the block ' +
        'again through its app.',
    );
  }
  const parentId = n.data.parent;
  if (!parentId || !doc.has(parentId)) {
    throw new Error(`sbuilder: ${id} has no parent to be duplicated beside`);
  }
  // A copy lands BESIDE the original, so duplicating a repeater's template makes
  // the second child the renderer will never draw. sb_add and sb_move already
  // refuse that; duplicate is the likeliest way to reach for it, since
  // "duplicate the card" is the move a designer makes constantly.
  refuseSecondTemplate(doc.doc, parentId, 'Duplicating into');

  const patches: Patch[] = [];
  const ids: string[] = [];
  // One pass, parent-first, so a child's `parent` always names an id already
  // emitted — the same ordering rule addSubtree follows.
  const copy = (srcId: string, newParent: string): string => {
    const src = doc.node(srcId) as unknown as Record<string, unknown> & {
      data: { type: string; name?: string; parent: string | null; nodes: string[] };
    };
    const clone = JSON.parse(JSON.stringify(src)) as typeof src & {
      id: string;
      specials?: Record<string, unknown>;
      config?: Record<string, unknown>;
    };
    clone.id = genId(src.data.type);
    clone.data = { ...clone.data, parent: newParent, nodes: [] };
    // A COPY IS NOT THE SHARED MASTER.
    //
    // The stamps came over verbatim, so duplicating a global header produced two
    // ROOT children carrying one globalId — ErrDuplicateGlobal
    // (server/internal/page/decompose.go:293), refused on a LATER save, by which
    // time the agent has kept editing and reads it as a transport error. Strip
    // rather than refuse: unlike an overlay or an app block, whose copies the
    // SERVER would destroy, a stripped global copy is a perfectly valid
    // document, and it is what a designer means by duplicating a header to make
    // a variant.
    for (const stamp of COPY_STRIPPED_SPECIALS) delete clone.specials?.[stamp];
    patches.push({ op: 'set', path: ['nodes', clone.id], value: clone });
    ids.push(clone.id);
    for (const kid of src.data.nodes) {
      const kidId = copy(kid, clone.id);
      patches.push({ op: 'insert', path: ['nodes', clone.id, 'data', 'nodes'], index: APPEND, value: kidId });
    }
    // SATELLITES, deep-copied with the owner's pointer rewritten — the editor's
    // copyNode does exactly this (`editor/src/stores/node.ts:373,403`). Without
    // it the copy pointed at the ORIGINAL's skin: editing one changed both, and
    // removing the original deleted the skin out from under the copy.
    //
    // Written as an explicit patch rather than by mutating `clone` after it has
    // been handed to one, so the emitted patch list says what it does.
    for (const rule of SATELLITE_RULES[src.data.type] ?? []) {
      const satId = (src as { config?: Record<string, unknown> }).config?.[rule.configKey];
      const path = ['nodes', clone.id, 'config', rule.configKey];
      if (typeof satId === 'string' && satId && doc.has(satId)) {
        patches.push({ op: 'set', path, value: copy(satId, clone.id) });
      } else if (satId !== undefined) {
        // A satellite id that resolves to nothing is a trimmed subtree, which the
        // editor handles the same way (`stores/node.ts:408-411`). Carrying the
        // pointer would aim the copy at a node it does not own.
        patches.push({ op: 'unset', path });
      }
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
  // Not for a REORDER: a node already in this parent is not a second template,
  // and refusing it would block the one move that is always safe.
  if (n.data.parent !== newParentId) refuseSecondTemplate(doc.doc, newParentId, 'Moving');

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
  // Unset the whole subtree AND everything hanging off it — a node left behind
  // is an orphan the save check rejects, and the agent would never guess why.
  //
  // The satellites are the half that is easy to miss: `list-empty`,
  // `list-loading` and the quantity nodes attach by PARENT POINTER and are
  // absent from their owner's child list, so `subtreeIds` — which walks child
  // lists — does not see them. Removing a section that contained a store
  // listing therefore left its empty-state nodes pointing at a parent that no
  // longer existed, and the very next save was refused with a list of ids the
  // caller had never heard of. Found while rebuilding a real page.
  const doomed = new Set(subtreeIds(doc.doc, id));
  for (;;) {
    let grew = false;
    for (const [nodeId, node] of Object.entries(doc.doc.nodes)) {
      const parent = node.data.parent;
      if (parent && doomed.has(parent) && !doomed.has(nodeId)) {
        doomed.add(nodeId);
        grew = true;
      }
    }
    if (!grew) break;
  }
  for (const sub of doomed) {
    patches.push({ op: 'unset', path: ['nodes', sub] });
  }
  return patches;
}

export interface SetEdit {
  id: string;
  namespace: 'style' | 'config' | 'specials';
  keys: Record<string, unknown>;
  breakpoint?: Breakpoint;
  base?: boolean;
  state?: string;
}

/**
 * Several nodes' keys in ONE batch of patches.
 *
 * The move after a look is "raise this heading, widen that card, recolour the
 * button" — six edits, six round trips, six saves, six op frames for anyone
 * watching. One batch is one save and one frame, and the patches come out in
 * edit order so a peer applying them left to right sees the same tree.
 * Every edit is checked before any patch is emitted, so a bad id in the fourth
 * edit refuses the whole batch rather than leaving three applied.
 */
export function setMany(doc: PageDoc, edits: SetEdit[]): { patches: Patch[]; touched: Array<{ id: string; keys: string[] }> } {
  if (edits.length === 0) throw new Error('sbuilder: sb_set edits is empty — nothing to write');
  const patches: Patch[] = [];
  const touched: Array<{ id: string; keys: string[] }> = [];
  for (const e of edits) {
    patches.push(...setKeys(doc, e.id, e.keys, { namespace: e.namespace, breakpoint: e.breakpoint, base: e.base, state: e.state }));
    touched.push({ id: e.id, keys: Object.keys(e.keys) });
  }
  return { patches, touched };
}
