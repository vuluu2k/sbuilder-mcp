import { childrenOf, childrenWithSatellites, isOverlay, pageChildren, appBlockRoot, SPEC_GLOBAL_REF, SPEC_APP_BLOCK_REF, type DocLike } from '../../core/tree.js';
import { ELEMENTS, BINDING_SOURCES, BOUND_SPECIALS , FIRST_CHILD_ONLY, SATELLITE_RULES, ELEMENT_SEEDS } from '../../catalog/elements.generated.js';
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
  /**
   * Set when the node lives in a SITE OVERLAY (the cart drawer, a pop-up).
   *
   * The defect is real and this page can fix it — `sb_set` on a drawer node
   * lands, because the page save carries the composed overlay and the page
   * context writes it through to the master. But the master is SHARED, so the
   * same finding would otherwise appear on all ten pages of a site and read as
   * ten problems. The flag lets a caller say "site-wide" once.
   */
  overlay?: boolean;
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
  'while findings stand; if you believe one is a false positive, say which and why. ' +
  'A finding marked overlay:true is in the cart drawer or a pop-up — fix it the same way ' +
  '(sb_set lands there), but it is SITE-WIDE, so fix it once rather than once per page.';

/** The specials keys an element seeds that hold its visible content. */
function contentKeys(type: string): string[] {
  const seeded = ELEMENTS[type]?.defaults.specials ?? {};
  return Object.keys(seeded).filter((k) => k === 'text' || k === 'src' || k === 'url');
}

function seededValue(type: string, key: string): unknown {
  return (ELEMENTS[type]?.defaults.specials ?? {})[key];
}

/**
 * Every line of copy the PLATFORM writes into a seeded subtree.
 *
 * `placeholder_content` above compares against `ELEMENTS[type].defaults.specials`
 * — the element's OWN default — and that is exactly why it could never see an
 * empty state. A heading's own default is `"Heading"`; the heading inside a
 * repeater's empty state is minted from `SATELLITE_RULES`' seed tree and says
 * `"No products yet"`. Different source, so the check walked straight past it.
 *
 * The consequence was general, not incidental: EVERY store built with these
 * tools ships the platform's English empty states and reviews clean. Measured on
 * a Vietnamese storefront — home, category, product and search all reported
 * "nothing a visitor would notice" while four repeaters said "No products yet"
 * and "New arrivals will show up here. Check back soon." in `#171717` on a page
 * that is `#2E2A3B` throughout. It is the most-visited copy on a store: an empty
 * cart is the empty state a shopper meets first.
 *
 * Collected from BOTH generated seed tables, so a new empty state the platform
 * ships is covered by the next `npm run codegen` rather than by an edit here.
 */
const SEEDED_SUBTREE_TEXT: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (v === null || typeof v !== 'object') return;
    const o = v as { specials?: Record<string, unknown> };
    const t = o.specials?.text;
    if (typeof t === 'string' && t.trim() !== '') out.add(t);
    for (const x of Object.values(v as Record<string, unknown>)) visit(x);
  };
  visit(SATELLITE_RULES);
  visit(ELEMENT_SEEDS);
  return out;
})();

/**
 * The containers whose children are form FIELDS.
 *
 * Named rather than derived: "offers a Gap control" is true of 33 elements and
 * four of them legitimately seed none (`flex-section` and `flex-block` are the
 * layout primitives, where the author composes the spacing). What makes these
 * three different is that their children are LABELLED CONTROLS, and a label with
 * no space above it attaches itself to the wrong one.
 */
const FIELD_STACKS = new Set(['form', 'form-segment', 'form-step-nav']);

/**
 * A container that renders its subtree ONCE PER RECORD.
 *
 * `list-dataset` is the repeater and `dataset-block` its per-record template;
 * both are read off the catalog rather than named here, so a new repeater the
 * platform ships is covered the day the catalog is regenerated.
 */
function repeats(type: string): boolean {
  const meta = ELEMENTS[type];
  return Boolean(meta?.isContainer && meta.category === 'dataset');
}

/** The element types that can actually show a record: their renderer reads a bound special. */
const BOUND_TYPES = Object.keys(BOUND_SPECIALS).sort();

/** Whether this element type's renderer reads anything a binding can write. */
function canShowARecord(type: string): boolean {
  return (BOUND_SPECIALS[type] ?? []).length > 0;
}

/**
 * Bound specials that carry NAVIGATION rather than what a visitor reads.
 *
 * The distinction decides whether an empty container is a defect. A
 * `dataset-block` binds only these — it is a card that still needs the fields
 * put inside it, so an empty one really is an empty card. A `media-dataset`
 * binds `boundImage` / `boundImages` and DRAWS the record itself, children or
 * not: a bound one with no children publishes a product photo, and calling that
 * "an empty band" is the false positive that teaches a reader to skip the list.
 */
const LINK_SPECIALS = new Set(['boundHref', 'boundHrefLabel', 'boundProductURL']);

/** Whether this element's own renderer paints the record, so it needs no children. */
function drawsItsOwnContent(type: string): boolean {
  return (BOUND_SPECIALS[type] ?? []).some((k) => !LINK_SPECIALS.has(k));
}

/**
 * Everything wrong with this page that a person would notice.
 *
 * OVERLAYS ARE WALKED, and used not to be — on the stated reasoning that the
 * cart drawer "is not this page's to fix", which is false. An overlay's content
 * reaches storage THROUGH THE PAGE SAVE (`overlays/rest/rest.go`: content is
 * "deliberately NOT written here"), so `sb_set` on a drawer node lands, and the
 * skip meant nothing ever reported what shipped inside one. Measured: a
 * rose-and-ink storefront whose drawer carried a static mock row reading
 * "Product name / 0₫", a duplicate cart list, and English copy — none of it
 * mentioned by any check, on a site that reviewed clean ten pages running.
 *
 * Their findings carry `overlay: true`, because the master is SHARED: without
 * the flag the same drawer defect reads as ten problems on a ten-page site.
 *
 * The INSIDE of an app block is still skipped (trap 5): its
 * placeholders are the app's, and no fix this page could apply would survive a
 * save. The block root itself is still walked — it is a node the page owns and
 * can be an empty container. Findings are ordered by document order so a caller working
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
  // Which repeater each node sits inside, filled on the way down. A repeater
  // itself belongs to the scope OUTSIDE it, which is why this is set before the
  // scope for the children is computed.
  const inRepeater = new Map<string, string>();
  // Which nodes sit inside an overlay, so their findings can say so.
  const inOverlay = new Set<string>();
  const go = (id: string, repeater?: string, overlay = false): void => {
    if (seen.has(id)) return;
    seen.add(id);
    if (overlay) inOverlay.add(id);
    walkOrder.push(id);
    if (repeater) inRepeater.set(id, repeater);
    if (appBlockRoot(d, id) === id) return;
    const inner = repeats(d.nodes[id]?.data.type ?? '') ? (repeater ?? id) : repeater;
    // SATELLITES INCLUDED. `childrenOf` here meant the review never entered one,
    // so an element's whole chrome — every repeater's empty state, the variant
    // option skin, the quantity stepper, the menu and tab item skins — sat
    // outside the check that exists to say what a visitor meets. `walk`'s own
    // comment names this as the mistake a caller makes by reaching for the
    // child-only list; this had made it.
    for (const k of childrenWithSatellites(d, id)) go(k, inner, overlay || overlayIds.has(k));
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

    const bindings =
      (n as unknown as { bindings?: Array<{ source?: string; field?: string }> }).bindings ?? [];

    // A container with nothing in it is a band of empty space. The commonest way
    // to ship one is to add the section and then get distracted.
    //
    // Unless the element paints the record ITSELF: a bound `media-dataset` with
    // no children publishes the product's photo and its thumbnail strip, which
    // this rule reported as an empty band on a page that rendered correctly.
    //
    // OR THE NODE IS A REFERENCE, which is empty by construction. A page carries
    // a shared header as an EMPTY flex-section stamped `globalRef` — that is
    // literally what the platform stores (`page/decompose.go`'s makeRefNode) —
    // and the server composes the master into it on read. An app block is the
    // same shape one construct over. Reported, the finding is worse than noise:
    // the notice tells the reader to fix every finding, and the fix named here
    // is "add something inside it", which on the next save is decomposed away
    // again. Measured on a page built with `sb_add`: the header and footer refs
    // both flagged, and both correct.
    const isReference =
      (n.specials ?? {})[SPEC_GLOBAL_REF] !== undefined ||
      (n.specials ?? {})[SPEC_APP_BLOCK_REF] !== undefined;
    if (
      meta.isContainer &&
      childrenOf(d, id).length === 0 &&
      !isReference &&
      !(bindings.length > 0 && drawsItsOwnContent(type))
    ) {
      out.push({
        code: 'empty_container',
        nodeId: id,
        type,
        problem: 'This container holds nothing — it renders as an empty band.',
        fix: fill('empty_container', { id }),
      });
    }

    const repeater = inRepeater.get(id);
    const boundFields = new Set(bindings.map((b) => b.field));
    /**
     * Whether a binding, not the author, supplies this key at render time.
     *
     * Either the binding names the key outright, or the element is one whose
     * renderer PREFERS its bound special over the authored one — a bound
     * `collection-media` with an empty `src` is finished, not unfinished, and
     * reporting it would be the false positive that teaches a reader to ignore
     * the list.
     */
    const supplied = (key: string): boolean =>
      boundFields.has(`specials.${key}`) || (bindings.length > 0 && canShowARecord(type));

    for (const key of contentKeys(type)) {
      const value = (n.specials ?? {})[key];
      const seed = seededValue(type, key);
      const isBlank = value === undefined || value === null || String(value).trim() === '';
      if (supplied(key)) continue;

      // INSIDE A REPEATER the generic advice is actively wrong: setting a static
      // src on an image in a product card puts the SAME picture on every card and
      // the product's own photo can never appear. The defect is the element
      // choice, not the missing value, so it gets its own finding and its own fix.
      if (repeater && (isBlank || (seed !== undefined && value === seed))) {
        out.push({
          code: 'static_in_dataset',
          nodeId: id,
          type,
          problem:
            `Inside the repeater "${repeater}", but "${type}" renders only what the document ` +
            `authors — so every record shows the same ${key}, and the record's own never appears.`,
          key,
          fix: fill('static_in_dataset', { id, key }),
        });
        continue;
      }

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

      // The same defect, one seed table over — see SEEDED_SUBTREE_TEXT. Reported
      // separately because the FIX reads differently: this copy is not a
      // "<Heading>" nobody noticed, it is a real English sentence that renders
      // as if somebody meant it.
      else if (key === 'text' && typeof value === 'string' && SEEDED_SUBTREE_TEXT.has(value)) {
        out.push({
          code: 'default_seed_copy',
          nodeId: id,
          type,
          problem:
            `Still the platform's own seed copy (${JSON.stringify(value)}), in English. This ` +
            'surface was never authored — it is minted with the element and reads as if ' +
            'somebody wrote it.',
          key,
          fix: fill('default_seed_copy', { id, key }),
        });
      }
    }

    // A FORM NOBODY LINKED publishes as an empty box, and the platform stays
    // deliberately quiet about it: form.go:221 skips an empty formId with the
    // comment that reporting it "would cry wolf on every page mid-edit". True
    // for a human mid-drag, wrong for an agent that has finished — and since the
    // element seeds `formId: ""` and forms compose on the RENDER path only, the
    // canvas looks identical either way. An unlinked form is the DEFAULT.
    if (type === 'form') {
      const formId = (n.specials ?? {}).formId;
      if (typeof formId !== 'string' || formId.trim() === '') {
        out.push({
          code: 'unlinked_form',
          nodeId: id,
          type,
          problem:
            'This form names no form, so it composes nothing and publishes as an empty box — ' +
            'and the platform reports no warning for it.',
          key: 'formId',
          fix: fill('unlinked_form', { id, key: 'formId' }),
        });
      }
    }

    // A FORM WHOSE FIELDS TOUCH. The three field stacks lay out `display:flex`
    // + `flexDirection:column`, so with no `gap` every field sits flush against
    // the one above it and each label ends up nearer the previous control than
    // its own — the one thing a form's spacing has to get right.
    //
    // Measured on a published checkout at 1440px: six consecutive fields, every
    // gap between them EXACTLY 0. The platform now seeds `gap: 12px` on these
    // elements, but `defaults` seeds at CREATION, so every form authored before
    // that keeps the spacing it was given and nothing says so.
    //
    // NOT a child check: a form's fields live in the FORM DOCUMENT and are
    // composed on the render path, so the page's own node has `nodes: []` and
    // counting children would report every form as empty.
    if (FIELD_STACKS.has(type)) {
      const slots = [
        (n as { style?: Record<string, unknown> }).style,
        ...Object.values((n as { responsive?: Record<string, { style?: Record<string, unknown> }> }).responsive ?? {}).map(
          (s) => s?.style,
        ),
      ];
      const anyGap = slots.some((s) => {
        const g = s?.gap;
        return g !== undefined && g !== null && `${g}`.trim() !== '' && parseFloat(`${g}`) > 0;
      });
      if (!anyGap) {
        out.push({
          code: 'form_fields_flush',
          nodeId: id,
          type,
          problem:
            'This form stacks its fields with no gap, so each one touches the one above it and ' +
            "every label reads as belonging to the control above rather than its own. The " +
            'field\'s own label-to-control spacing (config.fieldStackGap) is a different, ' +
            'smaller quantity and does not close this.',
          key: 'gap',
          fix: fill('form_fields_flush', { id, key: 'gap' }),
        });
      }
    }

    // A MENU ENTRY WITH NO HREF is a link that goes nowhere. The Go renderer
    // reads specials.menuItems and never menuId, so picking a menu by id
    // publishes an empty nav, and the element's own seed ships one entry
    // ("Home") whose href is "". Resolution from a menu id to real addresses is
    // client-side (editor/src/features/menus/snapshot.ts), so nothing fills it
    // in on the way to publish.
    if (type === 'menu') {
      const items = (n.specials ?? {}).menuItems;
      const rows = Array.isArray(items) ? items : [];
      const dead = rows.filter((r) => {
        const row = (r ?? {}) as Record<string, unknown>;
        const href = row.href;
        const panel = row.panelId;
        return (
          (typeof href !== 'string' || href.trim() === '') &&
          (typeof panel !== 'string' || panel.trim() === '')
        );
      });
      if (rows.length === 0 || dead.length > 0) {
        out.push({
          code: 'dead_menu_link',
          nodeId: id,
          type,
          problem:
            rows.length === 0
              ? 'This menu has no entries, so it publishes as an empty nav. The renderer reads ' +
                'specials.menuItems and never menuId.'
              : `${dead.length} of ${rows.length} entries have no href, so those links go ` +
                'nowhere. The renderer reads specials.menuItems and never menuId.',
          key: 'menuItems',
          fix: fill('dead_menu_link', { id, key: 'menuItems' }),
        });
      }
    }

    // A REPEATER RENDERS ITS FIRST CHILD AND DROPS THE REST. `templateID`
    // returns Data.Nodes[0], and list-dataset is the only renderer that does —
    // which is why the list is generated rather than derived from the obvious
    // "is a dataset container" predicate, since dataset-block renders all of
    // its children.
    if (FIRST_CHILD_ONLY.includes(type) && n.data.nodes.length > 1) {
      out.push({
        code: 'extra_repeater_child',
        nodeId: id,
        type,
        problem:
          `"${type}" clones only its FIRST child per record, so the other ` +
          `${n.data.nodes.length - 1} never appear on the published page.`,
        fix: fill('extra_repeater_child', { id }),
      });
    }

    // A dataset element with NO binding at all is the same silence from the other
    // direction: its renderer is waiting for a bound special that nothing writes,
    // so it falls back to whatever the document authored — once, for every record.
    if (repeater && canShowARecord(type) && bindings.length === 0) {
      const key = BOUND_SPECIALS[type][0];
      out.push({
        code: 'unbound_dataset_element',
        nodeId: id,
        type,
        problem:
          `"${type}" reads specials.${key} from a binding and has none, so every row in ` +
          `"${repeater}" renders the same authored content.`,
        key,
        fix: fill('unbound_dataset_element', { id, key }),
      });
    }

    // A binding whose source the renderer does not provide resolves to nothing,
    // and the element falls back to its own placeholder — indistinguishable, on
    // screen, from data that has not loaded.
    for (const b of bindings) {
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

  // Tagged in ONE place rather than at eight push sites: whether a node sits
  // inside an overlay is a fact about where it is, not about what is wrong with
  // it, and threading it through every rule would put the same argument in eight
  // signatures.
  for (const f of out) if (inOverlay.has(f.nodeId)) f.overlay = true;
  return out;
}
