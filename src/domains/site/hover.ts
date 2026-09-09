import { ancestors, type DocLike, type NodeLike } from '../../core/tree.js';
import { HOVER_HOMES } from '../../catalog/elements.generated.js';

/**
 * HOVER, AND THE FACT THAT IT HAS THREE HOMES.
 *
 * The platform grew a UNIVERSAL hover state in September 2026
 * (`schema/src/hoverState.ts`, Go mirror `render/style/hover.go`) alongside the
 * pinned one, and the obvious reading — "hover is `states.hover` now" — is
 * wrong for twelve element types, silently.
 *
 *   states.hover        →  <scope>:hover{…}            the pointer is on THIS
 *   states.parentHover  →  <host>:hover <scope>{…}     …on the box around this
 *
 * But the universal compiler STANDS ASIDE for every element whose meta declares
 * a Hover variant of its own (`generated.HoverStateOwners`), because those have
 * their own storage and their own compiler and a second generic rule would fight
 * the narrower one. For a BUTTON that storage is `config.stateHover` — a flat,
 * base-only style map — and the editor routes a hover edit there deliberately:
 * "a hover edit on a button must go on being the button's :hover rule"
 * (editor/src/trait/values.ts). Nothing reads `states.hover` on a button.
 *
 * MEASURED, on one publish of one page: `state:"hover"` on a product card's
 * dataset-block emitted `@media (hover:hover){#card:hover{…}}`; the identical
 * write on the BUTTON inside it emitted nothing at all. Both reported success.
 * Every hover this server had ever written onto a button was dead.
 *
 * So the home is a per-type question, and `HOVER_HOMES` is generated from the
 * metas plus the Go renderers that actually read the legacy map — never
 * hand-kept, because the platform is still moving here.
 */

/** The node's own pointer state. */
export const HOVER_STATE = 'hover';
/** "While the box around me is hovered." Universal on every element. */
export const PARENT_HOVER_STATE = 'parentHover';
/** The flat, base-only style map a Hover-variant element's own renderer reads. */
export const LEGACY_HOVER_KEY = 'stateHover';
/**
 * The config key behind "only show while the card is hovered". Base-level,
 * because a state can only override what the base already paints — and, like
 * the parent state, it needs a host to hover.
 */
export const REVEAL_ON_HOVER = 'revealOnHover';

type Styled = NodeLike & { config?: Record<string, unknown> };

/**
 * Where this element type's `hover` state has to be written.
 *
 * 'state' is the default and the majority: the universal compiler serves it.
 */
/**
 * Where this element type's `hover` state has to be written.
 *
 * 'state' is the default and the overwhelming majority — `node.states.hover`,
 * compiled either by the universal state or, for the twelve types that declare a
 * Hover variant, by the element's own CSS. 'legacy' is the flat, base-only
 * `config.stateHover` map, which is what the element's meta means when it
 * declares a Hover variant with no `storage: 'node'`.
 */
export function hoverHome(type: string): 'state' | 'legacy' {
  return HOVER_HOMES[type]?.home ?? 'state';
}

/**
 * Element types that PROMISE `states.hover` and whose hover nothing compiles.
 *
 * Measured 2026-09-09 by rendering one node per Hover-variant type with a
 * `states.hover` override and looking for the value in `BundleCSS`: every other
 * type painted, `product-image-list` did not. Its meta declares
 * `storage: 'node'`, so the value goes where the meta says — and the universal
 * compiler stands aside for it, while nothing element-specific picks it up.
 *
 * A LIST, not a derivation, because there is nothing in the metas to derive it
 * from: the fact lives in which Go renderer happens to read the slot. It is
 * therefore a measurement with a date on it, and the note says so rather than
 * pretending the platform still behaves this way.
 */
const HOVER_UNCOMPILED = new Set(['product-image-list']);

/**
 * The specials key naming WHICH ancestor a parent-hover rule hangs off, 1-based
 * and nearest-first. Base-only: it is identity, not a quantity, and a host that
 * differed per breakpoint would compile one state slot against different
 * selectors at different widths.
 *
 * Absent means 1 — the node's own parent — which is what the seeded product card
 * wants, because that template is flat and a child's parent IS the card. The key
 * exists for the moment an author groups a few things inside it: the nearest box
 * becomes the group, and "hover the whole card" stops being reachable without it.
 */
export const HOVER_HOST_DEPTH = 'hoverHostDepth';

/**
 * Every ancestor a parent-hover state could hang off, NEAREST FIRST.
 *
 * Mirrors `hoverHostChain`. Empty for the three cases that can host nothing, and
 * each is a rule that would compile to nothing:
 *
 *   - a SATELLITE, which hangs off `config[key]` rather than `data.nodes` and
 *     renders no element the selector could name;
 *   - a node whose parent is ROOT, because the pointer is inside the page
 *     whenever it is inside the window;
 *   - an orphan whose parent id points at nothing.
 */
export function hoverHostChain(doc: DocLike, id: string): string[] {
  if (!hasHoverableBox(doc, id)) return [];
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = doc.nodes[id];
  for (;;) {
    const parentId = cur?.data.parent;
    if (!parentId || seen.has(parentId)) break;
    seen.add(parentId);
    const parent = doc.nodes[parentId];
    if (!parent || parent.data.type === 'root' || parentId === doc.root_node_id) break;
    out.push(parentId);
    cur = parent;
  }
  return out;
}

/** Does this node have a box of its own — a real child of a real parent? */
function hasHoverableBox(doc: DocLike, id: string): boolean {
  const parentId = doc.nodes[id]?.data.parent;
  if (!parentId) return false;
  const parent = doc.nodes[parentId];
  return !!parent && (parent.data.nodes ?? []).includes(id);
}

/** The stored depth, coerced the way the platform coerces it: anything that is
 * not a whole number ≥ 1 reads as 1, so a corrupt value costs the author the
 * ancestor they picked rather than the whole state. */
export function hoverHostDepthOf(doc: DocLike, id: string): number {
  const raw = (doc.nodes[id]?.specials as Record<string, unknown> | undefined)?.[HOVER_HOST_DEPTH];
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/**
 * The box whose `:hover` a parent-hover rule keys off, or null.
 *
 * The node's PARENT by default, or the ancestor `hoverHostDepth` levels up when
 * the document names one. A depth past the end of the chain CLAMPS to the
 * outermost real ancestor rather than answering null — the chain shortens
 * whenever a wrapper is deleted, and a state pointing one level out is better
 * than one that silently goes dead.
 */
export function hoverHostOf(doc: DocLike, id: string): string | null {
  const chain = hoverHostChain(doc, id);
  if (!chain.length) return null;
  return chain[Math.min(hoverHostDepthOf(doc, id), chain.length) - 1];
}

/** Is this node a satellite — referenced from its parent's config, not its children? */
export function isSatelliteNode(doc: DocLike, id: string): boolean {
  const parentId = doc.nodes[id]?.data.parent;
  if (!parentId) return false;
  const parent = doc.nodes[parentId];
  return !!parent && !(parent.data.nodes ?? []).includes(id);
}

/**
 * Refuse a parent-hover override that no selector would ever match, naming which
 * of the three reasons applies — the caller is one structural fact away from the
 * design they wanted, and "it does nothing" would not tell them which.
 */
export function requireHoverHost(doc: DocLike, id: string): void {
  if (hoverHostOf(doc, id)) return;
  if (isSatelliteNode(doc, id)) {
    throw new Error(
      `sbuilder: "${PARENT_HOVER_STATE}" needs a box to hover, and ${id} is a SATELLITE — it ` +
        'hangs off its owner\'s config rather than its children and renders no element of its ' +
        'own, so there is nothing for the rule to name. Style its own hover instead ' +
        `(state: "${HOVER_STATE}"), which its owner compiles.`,
    );
  }
  const parentId = doc.nodes[id]?.data.parent;
  if (!parentId) {
    throw new Error(`sbuilder: ${id} has no parent, so "${PARENT_HOVER_STATE}" has nothing to key off.`);
  }
  throw new Error(
    `sbuilder: "${PARENT_HOVER_STATE}" hangs off an ANCESTOR BOX, and ${id}'s only one is ROOT — ` +
      'the pointer is inside the page whenever it is inside the window, so the platform emits ' +
      'no rule. Put this node inside a real box (a section\'s inner block, a card) and set it ' +
      `there, or use state: "${HOVER_STATE}" for the node's own pointer state.`,
  );
}

/**
 * WHICH BOX A PARENT-HOVER RULE ACTUALLY HUNG OFF, said out loud.
 *
 * The inspector has a picker and a label that name it; an agent has neither, and
 * the default — the NEAREST box — is the wrong one the moment somebody groups a
 * few things inside a card. Writing the state and being told nothing is how a
 * "hover the card" effect ends up triggered by an inner wrapper instead.
 *
 * Also reports a depth that CLAMPED, which the platform does silently: past the
 * end of the chain it falls back to the outermost ancestor rather than going
 * dead, so the caller's number and the box they got can differ with nothing on
 * screen to say so.
 */
export function hoverHostNote(doc: DocLike, id: string): string | null {
  const chain = hoverHostChain(doc, id);
  if (!chain.length) return null;
  const want = hoverHostDepthOf(doc, id);
  const got = Math.min(want, chain.length);
  const host = chain[got - 1];
  const named = (n: string) => `${doc.nodes[n]?.data.name ?? doc.nodes[n]?.data.type ?? '?'} ${n}`;
  if (want > chain.length) {
    return (
      `Hangs off ${named(host)} — specials.${HOVER_HOST_DEPTH} asks for level ${want} and the ` +
      `chain is ${chain.length} long, so the platform CLAMPED to the outermost box. Set the ` +
      'depth to a level that exists, or accept this one.'
    );
  }
  if (chain.length === 1) return null; // no choice to get wrong
  return (
    `Hangs off ${named(host)} (level ${got} of ${chain.length}). To hang it off a wider box — ` +
    `the whole card rather than the group inside it — set specials.${HOVER_HOST_DEPTH}, ` +
    `1-based and nearest-first: ${chain.map((n, i) => `${i + 1}=${named(n)}`).join(', ')}.`
  );
}

/**
 * The one config key a hover state translates into a declaration, and only
 * `true` — the same contract `stuckDecls` has, for the same reason: `false`
 * would need `display: revert`, which rolls past the element's own static CSS to
 * the UA default.
 */
export function refuseHoverConfig(keys: Record<string, unknown>, state: string): void {
  const stray = Object.keys(keys).filter((k) => k !== 'hidden');
  if (stray.length) {
    throw new Error(
      `sbuilder: the "${state}" state translates exactly one config key — "hidden" — into a ` +
        `declaration (display:none). ${stray.map((k) => `"${k}"`).join(', ')} would be stored ` +
        'and read by no compiler. Style is what a state paints.',
    );
  }
  if ('hidden' in keys && keys.hidden !== true) {
    throw new Error(
      `sbuilder: "${state}" config.hidden takes only true. false would have to mean "show it ` +
        'again while hovered", which needs display:revert — wrong here, because revert rolls ' +
        "past the element's own static CSS to the UA default. To stop hiding it, remove the " +
        'override.',
    );
  }
}

/**
 * Refuse a reveal that compiles to nothing.
 *
 * `compileHoverCss` emits the reveal pair only `if (hostScope && …)`, so the
 * switch on a satellite or a top-level section is stored and the element simply
 * stays visible — the caller asked for a quick-add button that appears on hover
 * and got one that is always there, with nothing to say so.
 */
export function refuseReveal(doc: DocLike, id: string, keys: Record<string, unknown>): void {
  if (keys[REVEAL_ON_HOVER] !== true) return;
  if (hoverHostOf(doc, id)) return;
  throw new Error(
    `sbuilder: config.${REVEAL_ON_HOVER} hides this until the box AROUND it is hovered, and ` +
      `${id} has no such box (a satellite, or a direct child of ROOT). The platform emits ` +
      'neither half of the reveal, so the element would simply stay visible. Put it inside a ' +
      'card or a block and set it there.',
  );
}

/**
 * The note a caller gets when a hover write is routed somewhere other than
 * `states.hover`, and the warning when nothing will read it either way.
 *
 * Said rather than silently done: the routing is right, but a caller who later
 * reads the node back would otherwise find their keys somewhere they did not put
 * them.
 */
export function hoverRoutingNote(type: string): string | null {
  if (HOVER_UNCOMPILED.has(type)) {
    return (
      `"${type}" declares a Hover variant, so the platform's universal hover compiler stands ` +
      'aside for it — and measured on 2026-09-09, no element-specific compiler picks the slot ' +
      'up either, so this override paints nothing. Written where its meta says it belongs ' +
      '(states.hover), which is where it will start painting when the platform closes the gap. ' +
      'Style a wrapper around it if the hover has to be visible now.'
    );
  }
  if (hoverHome(type) !== 'legacy') return null;
  return (
    `"${type}" stores its hover in config.${LEGACY_HOVER_KEY} — a flat map its own renderer ` +
    'compiles into the node\'s :hover rule — and the universal hover state stands aside for it, ' +
    'so states.hover here would be read by nobody. Written to that map instead. It is BASE-ONLY, ' +
    'so this value applies at every width.'
  );
}

/** The path a legacy hover write lands on — flat, base-only, one key per patch. */
export function legacyHoverPath(id: string, key: string): string[] {
  return ['nodes', id, 'config', LEGACY_HOVER_KEY, key];
}
