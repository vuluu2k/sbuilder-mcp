import {
  pageChildren,
  isOverlay,
  SPEC_GLOBAL_ID,
  SPEC_GLOBAL_KIND,
  type DocLike,
} from '../../core/tree.js';

export type Band = 'header' | 'middle' | 'footer';

/**
 * Which band a direct child of ROOT belongs to.
 *
 * An unstamped section lives in the middle; a global's band comes from its
 * `globalKind`. An UNRECOGNISED kind is middle rather than an error, matching
 * the platform's own `bandOf` — a document storing a kind we do not know is
 * still a document that must open.
 */
export function bandOf(doc: DocLike, id: string): Band {
  const n = doc.nodes[id];
  if (!n || n.specials?.[SPEC_GLOBAL_ID] === undefined) return 'middle';
  const kind = `${n.specials[SPEC_GLOBAL_KIND] ?? ''}`;
  if (kind === 'header' || kind === 'footer') return kind;
  return 'middle';
}

/**
 * THE BAND RULE: ROOT's children must read [header*][middle*][footer*].
 *
 * The platform enforces this on EVERY save (`checkBands` in
 * server/internal/page/decompose.go), so a document that breaks it cannot be
 * stored at all — the author gets `ErrBandOrder` and loses the write. Checking
 * it here means the builder refuses to construct the violation, rather than
 * discovering it one autosave later with a tree nobody will ever store.
 *
 * Ordinary sections are constrained too, not just globals: once a page has a
 * global header, nothing may sit above it, or the "header" stops being one.
 *
 * Overlays are excluded, because the platform strips them BEFORE it checks —
 * that ordering is why the band rule needs no overlay exception, and copying
 * the ordering is why ours needs none either.
 *
 * Returns null when the order is legal, or a sentence naming the offender.
 */
export function checkBandOrder(doc: DocLike): string | null {
  let phase: Band = 'header';
  for (const id of pageChildren(doc)) {
    const band = bandOf(doc, id);
    if (band === 'header') {
      if (phase !== 'header') {
        return `Node ${id} is a global header but sits after ${phase} content. ROOT's children must read header, then middle, then footer — the platform refuses every save otherwise.`;
      }
    } else if (band === 'footer') {
      phase = 'footer';
    } else {
      if (phase === 'footer') {
        return `Node ${id} is ordinary content but sits after a global footer. ROOT's children must read header, then middle, then footer — the platform refuses every save otherwise.`;
      }
      phase = 'middle';
    }
  }
  return null;
}

/** Is this node a composed GLOBAL SECTION master — a shared header or footer? */
export function isGlobal(doc: DocLike, id: string): boolean {
  return doc.nodes[id]?.specials?.[SPEC_GLOBAL_ID] !== undefined;
}

/**
 * The sentence to attach to any result that touched a global.
 *
 * Editing a master is not a page-local act: it changes every page carrying that
 * section, and publishing one cascades to those pages — a header edited once
 * must not go live on one page and stay stale on the rest. An agent that does
 * not know this reports "updated the header" having changed the whole site.
 */
export function globalWarning(doc: DocLike, id: string): string | null {
  if (!isGlobal(doc, id)) return null;
  const gid = doc.nodes[id].specials[SPEC_GLOBAL_ID];
  return `Node ${id} is the shared global section ${JSON.stringify(gid)}. Editing it changes EVERY page that carries it, and publishing cascades to all of them. Say so when reporting this change.`;
}

/**
 * Keys that are identity or content rather than a visual quantity.
 *
 * Kept as a hint for callers deciding where a value belongs — NOT as a gate. An
 * earlier version of this file claimed base-only values "vanish on publish" and
 * `setKeys` refused them; both were wrong. The published cascade has a base
 * layer (style/cascade.go MergeNamespace: current slot → wider → BASE →
 * narrower), and every element's meta.defaults seeds into it.
 *
 * The platform's responsive mandate is about ELEMENT IMPLEMENTATION — a renderer
 * reading `n.Config[...]` directly bypasses that cascade, which is what makes a
 * per-breakpoint value unreachable at publish. Nothing a document stores can
 * cause it.
 */
const IDENTITY_KEYS = new Set(['htmlTag', 'kind', 'name', 'id', 'type', 'href', 'src', 'alt']);

export function isIdentityKey(key: string): boolean {
  return IDENTITY_KEYS.has(key);
}

export const RESPONSIVE_NOTICE =
  'Written per breakpoint, which is the default because a design should respond. Base is ' +
  'legitimate too — it is the cascade\'s fallback layer, below every breakpoint slot, and ' +
  'where an element\'s own defaults live. Use base for a value that genuinely should not ' +
  'vary; use a breakpoint for anything a narrower screen should change.';

export { isOverlay };
