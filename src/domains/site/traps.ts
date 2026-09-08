import type { Patch } from '../../core/patch.js';
import { FIRST_CHILD_ONLY } from '../../catalog/elements.generated.js';
import {
  pageChildren,
  isOverlay,
  SPEC_GLOBAL_ID,
  SPEC_GLOBAL_KIND,
  SPEC_GLOBAL_REV,
  SPEC_OVERLAY_ID,
  SPEC_OVERLAY_REV,
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

/**
 * Refuse a child a repeater would never render.
 *
 * `list-dataset` clones `Data.Nodes[0]` per record and ignores every sibling
 * after it (`server/render/nodes/list-dataset/html.go:60`). A second child is a
 * perfectly valid document: it stores, it publishes, and it simply never appears
 * — so the agent designs a card nobody will ever see and nothing says why.
 *
 * The list is GENERATED from the renderers. `dataset-block` is a dataset
 * container too and renders all of its children, so the obvious
 * `isContainer && category === 'dataset'` predicate would have restricted the
 * wrong element.
 */
export function refuseSecondTemplate(doc: DocLike, parentId: string, verb: string): void {
  const parent = doc.nodes[parentId];
  if (!parent || !FIRST_CHILD_ONLY.includes(parent.data.type)) return;
  if (parent.data.nodes.length === 0) return;
  throw new Error(
    `sbuilder: "${parent.data.type}" (${parentId}) renders only its FIRST child, once per ` +
      `record — Data.Nodes[0] is the template. ${verb} a second one stores fine and never ` +
      'appears on the published page. Design the existing template, or sb_remove it first.',
  );
}

export { isOverlay };

/**
 * Re-stamp the composed masters with the revisions the save just reported.
 *
 * THE FENCE MOVES ON EVERY SAVE. Compose stamps `specials.globalRev` /
 * `specials.overlayRev` onto the node it materialises; the save sends that back
 * as `expectRev`; the platform refuses a stale one — and refuses it with a
 * WARNING and a 200, not an error. So the first edit to a shared header or to
 * the cart drawer lands, the fence advances on the server, and every edit after
 * it in the same session is dropped while the tool reports success.
 *
 * Measured: two `sb_remove` calls in one session against the cart drawer. The
 * first removed its subtree; the second answered `{"removed": …}` and changed
 * nothing, and the drawer kept rendering the node in the browser.
 *
 * A master the report does not mention is left alone — it was not part of this
 * save, and inventing a revision for it is how a fence stops being one.
 */
export function restampPatches(
  doc: DocLike,
  report: { globals?: Array<{ id: string; rev: number }>; overlays?: Array<{ id: string; rev: number }> },
): Patch[] {
  const wanted = new Map<string, { key: string; rev: number }>();
  for (const g of report.globals ?? []) wanted.set(g.id, { key: SPEC_GLOBAL_REV, rev: g.rev });
  for (const o of report.overlays ?? []) wanted.set(o.id, { key: SPEC_OVERLAY_REV, rev: o.rev });
  if (wanted.size === 0) return [];

  const out: Patch[] = [];
  for (const [id, n] of Object.entries(doc.nodes)) {
    const masterId = n.specials?.[SPEC_GLOBAL_ID] ?? n.specials?.[SPEC_OVERLAY_ID];
    if (typeof masterId !== 'string') continue;
    const next = wanted.get(masterId);
    if (!next || n.specials?.[next.key] === next.rev) continue;
    out.push({ op: 'set', path: ['nodes', id, 'specials', next.key], value: next.rev });
  }
  return out;
}
