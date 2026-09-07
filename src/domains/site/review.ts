import { childrenOf, isOverlay, pageChildren, type DocLike } from '../../core/tree.js';
import { ELEMENTS, BINDING_SOURCES } from '../../catalog/elements.generated.js';
import type { PageDoc } from './document.js';
import { fill } from './findings.js';

/**
 * A defect somebody looking at the page would see.
 *
 * Distinct from `validateForSave`, which asks "will the platform store this
 * tree" — dangling ids, orphans, band order. This asks the question a person
 * asks: does the page WORK. A document can be perfectly storable and render as a
 * blank band saying "Enter your text here".
 *
 * Every finding names the fix, because a warning that only states a problem is
 * one the reader has to re-derive.
 */
export interface Finding {
  code: string;
  nodeId: string;
  type: string;
  problem: string;
  /** The specials key the fix names, where one does. */
  key?: string;
  fix: string;
}

/**
 * Shipped with every non-empty finding list.
 *
 * The sibling `webcake-landing-mcp` learned this the hard way and says so in its
 * own source: without a directive, models read warnings as advisory noise and
 * save anyway. These are not suggestions — each one is something a customer
 * loads the page and sees.
 */
export const REVIEW_NOTICE =
  'FIX THESE. Each one is a defect a visitor will see on the published page, not a ' +
  'suggestion — a blank band, a placeholder sentence, a broken image. Apply the fix each ' +
  'finding names, then review again until the list is empty. Do not report the page as done ' +
  'while findings stand; if you believe one is a false positive, say which and why.';

/** The specials keys an element seeds that hold its visible content. */
function contentKeys(type: string): string[] {
  const seeded = ELEMENTS[type]?.defaults.specials ?? {};
  return Object.keys(seeded).filter((k) => k === 'text' || k === 'src' || k === 'url');
}

function seededValue(type: string, key: string): unknown {
  return (ELEMENTS[type]?.defaults.specials ?? {})[key];
}

/**
 * Everything wrong with this page that a person would notice.
 *
 * Overlays are skipped: the cart drawer is composed onto ROOT on read and is not
 * this page's to fix. Findings are ordered by document order so a caller working
 * top-down meets them in the order they appear on screen.
 */
export function reviewDesign(doc: PageDoc): Finding[] {
  const d: DocLike = doc.doc;
  const out: Finding[] = [];
  const overlayIds = new Set(
    childrenOf(d, d.root_node_id).filter((id) => isOverlay(d, id)),
  );

  if (pageChildren(d).length === 0) {
    out.push({
      code: 'empty_page',
      nodeId: d.root_node_id,
      type: 'root',
      problem: 'The page has no content — it publishes as a blank document.',
      fix: fill('empty_page', {}),
    });
    return out;
  }

  // Document order, depth-first from ROOT: the order a reader meets them.
  const seen = new Set<string>();
  const walkOrder: string[] = [];
  const go = (id: string): void => {
    if (seen.has(id) || overlayIds.has(id)) return;
    seen.add(id);
    walkOrder.push(id);
    for (const k of childrenOf(d, id)) go(k);
  };
  go(d.root_node_id);

  for (const id of walkOrder) {
    if (id === d.root_node_id) continue;
    const n = d.nodes[id];
    const type = n.data.type;
    const meta = ELEMENTS[type];

    if (!meta) {
      out.push({
        code: 'unknown_element',
        nodeId: id,
        type,
        problem: `"${type}" is not an element this catalog knows, so nothing can say how it renders.`,
        fix: fill('unknown_element', {}),
      });
      continue;
    }

    // A container with nothing in it is a band of empty space. The commonest way
    // to ship one is to add the section and then get distracted.
    if (meta.isContainer && childrenOf(d, id).length === 0) {
      out.push({
        code: 'empty_container',
        nodeId: id,
        type,
        problem: 'This container holds nothing — it renders as an empty band.',
        fix: fill('empty_container', { id }),
      });
    }

    for (const key of contentKeys(type)) {
      const value = (n.specials ?? {})[key];
      const seed = seededValue(type, key);
      const isBlank = value === undefined || value === null || String(value).trim() === '';

      if (isBlank) {
        // An element that seeds a blank (image.src is "") is not misconfigured —
        // it is unfinished, and it renders as a gap or a broken frame.
        out.push({
          code: key === 'text' ? 'empty_text' : 'missing_media',
          nodeId: id,
          type,
          problem:
            key === 'text'
              ? 'This element has no text — it renders as empty space.'
              : `This element has no ${key} — it renders as a broken or missing image.`,
          key,
          fix: fill(key === 'text' ? 'empty_text' : 'missing_media', { id, key }),
        });
        continue;
      }

      // Content still equal to the element's OWN seeded default is the author's
      // placeholder, published. "Enter your text here" on a live page is the
      // single most visible way this goes wrong, and it is invisible to every
      // structural check because the document is perfectly well-formed.
      if (seed !== undefined && String(seed).trim() !== '' && value === seed) {
        out.push({
          code: 'placeholder_content',
          nodeId: id,
          type,
          problem: `Still the placeholder the element ships with (${JSON.stringify(seed)}).`,
          key,
          fix: fill('placeholder_content', { id, key }),
        });
      }
    }

    // A binding whose source the renderer does not provide resolves to nothing,
    // and the element falls back to its own placeholder — indistinguishable, on
    // screen, from data that has not loaded.
    for (const b of (n as unknown as { bindings?: Array<{ source?: string; field?: string }> })
      .bindings ?? []) {
      if (b.source && !BINDING_SOURCES.includes(b.source)) {
        out.push({
          code: 'dead_binding_source',
          nodeId: id,
          type,
          problem: `Bound to "${b.source}", which the renderer does not provide — it will show the placeholder forever.`,
          fix: fill('dead_binding_source', {}),
        });
      }
      if (b.field && !b.field.startsWith('specials.')) {
        out.push({
          code: 'dead_binding_field',
          nodeId: id,
          type,
          problem: `Binds into "${b.field}"; the renderer only applies bindings under "specials".`,
          fix: fill('dead_binding_field', {}),
        });
      }
    }
  }

  return out;
}
