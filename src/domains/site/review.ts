import { isDeepStrictEqual } from 'node:util';
import { childrenOf, childrenWithSatellites, isOverlay, isSharedSection, pageChildren, appBlockRoot, SPEC_GLOBAL_REF, SPEC_APP_BLOCK_REF, type DocLike } from '../../core/tree.js';
import { STUCK_STATE, stickyBlockedBy, stuckHostOf, isPinnedNode } from './sticky.js';
import { bandOf, isGlobal, type Band } from './traps.js';
import { exampleCopy } from './examplecopy.js';
import { SEED_COPY_VI, langOf } from './seedcopy.js';
import { HOVER_STATE, hoverHome } from './hover.js';
import { ELEMENTS, BINDING_SOURCES, BOUND_SPECIALS , FIRST_CHILD_ONLY, SATELLITE_RULES, ELEMENT_SEEDS } from '../../catalog/elements.generated.js';
import type { PageDoc } from './document.js';
import { fill } from './findings.js';
import {
  hrefParamProblems,
  isRecordSource,
  isSameSitePath,
  parseRecordRefAxis,
  readRecordAggregates,
  recordAggKeyOf,
  recordAggregateParams,
  RECORD_FIELD_ID,
  RECORD_HTML_SOURCE,
  RECORD_SOURCE,
  RECORD_TILES,
  recordScope,
} from './record.js';
import { formFieldFindings, isFormDocument } from './formdoc.js';
import { deadNavigation, hasPurchaseBinding, liveEventTable, PAYLOAD_NEEDS, soleNavigationClick, type NodeEventLike } from './navhref.js';
import { unknownValueNote, unknownWriteNote, vocabularyFor, vocabularyForWrite } from './vocabulary.js';
import { iconNote } from './icons.js';

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
/**
 * How many buttons in a row read as a navigation rather than as a pair of calls
 * to action. Three: two side by side is the ordinary hero shape.
 */
const HANDBUILT_MENU_MIN = 3;

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
  /**
   * ABSENT means `error` — it will not work for a visitor — which is every code
   * this file had before the field existed, so no old finding grew a byte.
   * `maintenance`: it works, but is hard to edit or drifts from the theme; advice,
   * never a blocker. `permission`: blocked by a credential or scope, not by the page.
   */
  severity?: 'maintenance' | 'permission';
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
  '(sb_set lands there), but it is SITE-WIDE, so fix it once rather than once per page. ' +
  '`advice` lists what works but is hard to edit — never a blocker.';

/** The specials keys an element seeds that hold its visible content. */
function contentKeys(type: string): string[] {
  const seeded = ELEMENTS[type]?.defaults.specials ?? {};
  return Object.keys(seeded).filter((k) => k === 'text' || k === 'src' || k === 'url');
}

function seededValue(type: string, key: string): unknown {
  return (ELEMENTS[type]?.defaults.specials ?? {})[key];
}

/**
 * Where else an element's visible copy for `key` can live. `nodes.RichText`
 * (render/nodes/helpers.go:1693) prints `<key>Html` before `<key>`, so a text
 * whose copy is all in `textHtml` is finished; a `form-link` prints `text` as
 * an optional prefix and `linkText` as the link itself (a login form's
 * "Quên mật khẩu?" seeds text "").
 */
function alsoCarries(type: string, key: string): string[] {
  return [`${key}Html`, ...(type === 'form-link' && key === 'text' ? ['linkText'] : [])];
}

/**
 * Elements whose seeded copy is a real sentence in the shopper's language, not
 * a placeholder — `form-link`'s "Chưa có tài khoản?", which its own AI hint
 * tells an author to keep.
 *
 * ponytail: hand-kept, one entry. Upgrade when a second seed reads as copy:
 * have codegen mark it on the meta.
 */
const SEED_IS_COPY: ReadonlySet<string> = new Set(['form-link']);

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


/** A literal #rgb / #rrggbb / rgb() colour as 0–255 channels, or null. */
function rgbOf(v: unknown): number[] | null {
  const c = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (c === 'white') return [255, 255, 255];
  if (c === 'black') return [0, 0, 0];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(c);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (x) => x + x) : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const m = /^rgb\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*\)$/.exec(c);
  return m ? [m[1], m[2], m[3]].map(Number) : null;
}

/** WCAG contrast ratio of two sRGB colours. */
function contrast(a: number[], b: number[]): number {
  const lum = (rgb: number[]) => {
    const [r, g, bl] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Binding-source prefixes that name a RECORD (not `site.*`, which every page has). */
// cartLine: only a cart-order's line row supplies it (render/nodes/cart-order,
// scope.PlaceholderCartLine) — see ROW_SUPPLIER. searchRow is left out: no
// element supplies it yet, so there is no right place to point at.
const RECORD_ENTITIES = new Set(['product', 'category', 'course', 'article', 'blogCategory', 'brand', 'cartLine']);
/** A record only one element type's rows supply, which is not a dataset repeater. */
const ROW_SUPPLIER: Record<string, string> = { cartLine: 'cart-order' };

/** Does this node sit inside an element of `type`? */
function insideType(d: DocLike, id: string, type: string): boolean {
  for (let x = d.nodes[id]?.data.parent; x && d.nodes[x]; x = d.nodes[x].data.parent) {
    if (d.nodes[x].data.type === type) return true;
  }
  return false;
}

/**
 * Which records a page TYPE supplies outside any repeater — read off the
 * platform's own seeds (STORE_PAGE_SEEDS bind exactly these at top level).
 */
export const PAGE_ENTITIES: Record<string, string[]> = {
  product: ['product'],
  category: ['category'],
  course: ['course'],
  post: ['article'],
  blog: ['blogCategory', 'category'],
  // /brands/{slug} — the page supplies brandContext (web_builder f70fe86d1).
  brand: ['brand'],
};

/** Does this node or an ancestor PIN a record (`bindings[0].target.id`)? */
function pinnedAbove(d: DocLike, id: string): boolean {
  for (let x: string | null | undefined = id; x && d.nodes[x]; x = d.nodes[x].data.parent) {
    const b0 = (d.nodes[x] as { bindings?: Array<{ target?: { id?: string } }> }).bindings?.[0];
    if (b0?.target?.id) return true;
  }
  return false;
}

/**
 * The native element a custom-code snippet re-implements, or null.
 *
 * Judged on the MARKUP left once every <script>, <style> and comment is
 * stripped — so an analytics tag, a chat widget's mount div, or HTML built
 * inside a script is never flagged — and only when that markup outweighs the
 * script (mostly markup). An iframe counts only for the three hosts a native
 * embed exists for; any other iframe is a third-party embed and stays.
 * ponytail: tag-presence heuristic, not a parser — tighten if it cries wolf.
 */
function nativeFor(code: string): string | null {
  const scripts = code.match(/<script\b[\s\S]*?(<\/script>|$)/gi) ?? [];
  const markup = code
    .replace(/<script\b[\s\S]*?(<\/script>|$)/gi, '')
    .replace(/<style\b[\s\S]*?(<\/style>|$)/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  if (markup.trim().length < scripts.join('').length) return null;
  // A form POSTING TO ANOTHER HOST (a Mailchimp / Klaviyo embed) is a
  // third-party integration, not hand-built markup: a native form submits to
  // this platform only, so there is nothing native to swap it for.
  if (/<form\b[^>]*\baction\s*=\s*["']?(https?:)?\/\//i.test(markup)) return null;
  const iframe = /<iframe\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(markup)?.[1] ?? '';
  if (/youtube(-nocookie)?\.com|youtu\.be/i.test(iframe)) return 'youtube';
  if (/vimeo\.com/i.test(iframe)) return 'vimeo';
  if (/google\.[a-z.]+\/maps|maps\.google\./i.test(iframe)) return 'google-map';
  if (/<form\b/i.test(markup)) return 'form';
  if (/<(nav|ul|ol)\b/i.test(markup) && (markup.match(/<a\b/gi) ?? []).length >= 2) return 'menu';
  if (/<h[1-6]\b/i.test(markup)) return 'heading';
  if (/<video\b/i.test(markup)) return 'video';
  if (/<img\b/i.test(markup)) return 'image';
  if (/<button\b/i.test(markup)) return 'button';
  return null;
}

/**
 * A data table hand-kept inside a script: the largest set of FLAT object
 * literals sharing one key set (≥3 keys, ≥4 objects). That is the shape of
 * `const DATA = { hotels: [{…}, …] }` — records a Collection + record list
 * serve natively, so editing a price stops meaning editing code.
 * ponytail: brace-regex over flat objects, not a JS parser — nested records
 * count only at their innermost level.
 */
export function hardcodedRecords(code: string): { count: number; keys: string[] } | null {
  // Executable scripts only: JSON-LD and templates are data the page declares, not a table.
  const scripts = [...code.matchAll(/<script\b([^>]*)>([\s\S]*?)(?:<\/script>|$)/gi)]
    .filter((m) => !/(?<![\w-])type\s*=\s*["']?(?!(?:text|application)\/javascript|module)[^"'\s>]/i.test(m[1]))
    .map((m) => m[2])
    .join('\n');
  // DISTINCT bodies: a minified bundle repeats `{enumerable:!0,configurable:!0,writable:!0}`;
  // records differ row by row.
  const groups = new Map<string, Set<string>>();
  for (const m of scripts.matchAll(/\{([^{}]{1,4000})\}/g)) {
    const keys = [...m[1].matchAll(/(?:^|,)\s*["']?([\p{L}_$][\p{L}\p{N}_$]*)["']?\s*:/gu)].map((k) => k[1]);
    if (keys.length < 3) continue;
    const sig = [...new Set(keys)].sort().join(',');
    const bodies = groups.get(sig) ?? new Set<string>();
    bodies.add(m[1].replace(/\s+/g, ''));
    groups.set(sig, bodies);
  }
  let best: { count: number; keys: string[] } | null = null;
  for (const [sig, bodies] of groups) {
    if (bodies.size >= 4 && (!best || bodies.size > best.count)) best = { count: bodies.size, keys: sig.split(',') };
  }
  return best;
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
export function reviewDesign(
  doc: PageDoc,
  /** The site's forms by id → type, when read; lets `order_goes_nowhere` ask the form itself. */
  opts: {
    formTypes?: Record<string, string>;
    /** Forms whose record redirects after a send (`settings.afterSubmit`), by id. */
    formRedirects?: ReadonlySet<string>;
    /** The page record's `type`. Without it `no_data_context` stays silent rather than guess. */
    pageType?: string;
    /** The open FORM document's record type, when known — the third-date rule needs "booking". */
    formDocType?: string;
    /** The site's `settings.locale`, when read. Only the store seeds' English copy asks it. */
    siteLocale?: string | null;
  } = {},
): Finding[] {
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
  // ONLY THE SHARED HEADER AND FOOTER is a blank page too. Measured: an "account"
  // page created by sb_page_create (no seed for that type) wore the site chrome
  // and nothing else, reviewed clean, and so did the readiness gap it was made
  // to close — a shopper landing on /account met a header, a footer and nothing.
  // Composed (globalId, what a read carries) or stored (globalRef) alike.
  // HEADER AND FOOTER only: a `custom` shared section is body content.
  const isChrome = (id: string): boolean => {
    const sp = d.nodes[id]?.specials ?? {};
    if (isGlobal(d, id)) return bandOf(d, id) !== 'middle';
    return sp[SPEC_GLOBAL_REF] !== undefined && (sp.globalKind === 'header' || sp.globalKind === 'footer');
  };
  if (pageChildren(d).every(isChrome)) {
    out.push({
      code: 'empty_page',
      nodeId: d.root_node_id,
      type: 'root',
      problem: 'Only the shared header and footer — the page between them is blank.',
      fix: fill('empty_page', {}),
    });
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
  // A CHILD ID NAMING NO NODE. `validateForSave` already refuses this on the
  // way OUT — "Node X lists child Y, which is not in the document" — but a
  // review runs on a document that is already damaged, which is exactly when a
  // caller most needs one.
  //
  // It used to THROW: `go` pushed the dangling id like any other and the loop
  // below read `d.nodes[id].data.type` off `undefined`, so `sb_review` answered
  // "Cannot read properties of undefined (reading 'data')" — an error naming no
  // page, no node, and nothing to do about it, from the one tool whose whole job
  // is to say what is wrong with the page. `walk()` in core/tree.ts has carried
  // the `if (!n) return` guard all along; this recursion carries its own scope
  // down and so cannot hand the traversal to `walk`, which is precisely the
  // caller `walk`'s own comment warns will get this wrong.
  const dangling: Array<{ parent: string; child: string }> = [];
  const go = (id: string, repeater?: string, overlay = false): void => {
    if (seen.has(id)) return;
    seen.add(id);
    if (!d.nodes[id]) return;
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
    for (const k of childrenWithSatellites(d, id)) {
      if (!d.nodes[k]) dangling.push({ parent: id, child: k });
      go(k, inner, overlay || overlayIds.has(k));
    }
  };
  go(d.root_node_id);

  // Reported rather than thrown, and reported FIRST: every other finding below
  // is about a node that exists, so a reader meeting twenty of those and no
  // mention of the hole in the tree would fix the wrong things.
  for (const { parent, child } of dangling) {
    out.push({
      code: 'missing_node',
      nodeId: parent,
      type: d.nodes[parent]?.data.type ?? '',
      problem:
        `It lists a child "${child}" that is not in the document, so the renderer walks to a ` +
        'hole: whatever was meant to be there renders as nothing, and the platform refuses ' +
        'every save of this page until it is gone.',
      fix: fill('missing_node', { child }),
    });
  }

  // WHICH BAND EACH NODE LIVES IN, taken from the top-level section it descends
  // from. `bandOf` answers for a ROOT child; everything below one inherits it.
  const band = new Map<string, Band>();
  for (const sectionId of pageChildren(d)) {
    const b = bandOf(d, sectionId);
    const stack = [sectionId];
    while (stack.length) {
      const id = stack.pop()!;
      if (band.has(id)) continue;
      band.set(id, b);
      for (const k of childrenWithSatellites(d, id)) stack.push(k);
    }
  }

  // BUILT BY HAND OUT OF PRIMITIVES, WHERE THE PLATFORM HAS THE ELEMENT.
  //
  // Every other check here asks whether something is BROKEN. This one asks
  // whether it was built with the wrong thing, which is the defect no amount of
  // looking at the page reveals: it renders correctly on the screen the author
  // is looking at, and fails on the one they are not.
  //
  // Measured on a store built with these tools: the header's navigation was six
  // `button` nodes in a flex-block. It looks right on a desktop canvas. On a
  // phone there is no drawer, because a drawer is something `menu` brings and a
  // row of buttons does not — so the site shipped with no mobile navigation and
  // nothing anywhere said so.
  //
  // A TABLE, because this will not be the only one. The next pattern is a row
  // here, not a second branch somewhere else.
  //
  // DELIBERATELY NARROW. Three or more buttons, ALL the container's children,
  // all leaves, and only in the HEADER band. A footer's link column is the same
  // shape and is legitimately a list of links; a two-button pair is a call to
  // action, not a menu. The check that fires on those is one an author learns to
  // ignore, which costs more than the one it catches.
  for (const [containerId, childIds] of [...Object.keys(d.nodes)].map(
    (id) => [id, childrenOf(d, id)] as const,
  )) {
    if (band.get(containerId) !== 'header') continue;
    if (childIds.length < HANDBUILT_MENU_MIN) continue;
    const allLeafButtons = childIds.every(
      (k) => d.nodes[k]?.data.type === 'button' && childrenOf(d, k).length === 0,
    );
    if (!allLeafButtons) continue;
    out.push({
      code: 'handbuilt_menu',
      nodeId: containerId,
      type: d.nodes[containerId]?.data.type ?? '',
      problem:
        `${childIds.length} buttons in a row in the header is a navigation built by hand. It ` +
        'renders correctly on a wide canvas and has no drawer on a phone, no dropdown for a ' +
        'sub-level, and no active state on the page the visitor is already reading — all three ' +
        'are things the menu element brings and a row of buttons cannot.',
      fix: fill('handbuilt_menu', {}),
    });
  }

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

    // TYPE THE SAME COLOUR AS WHAT IT SITS ON. Measured: a pattern dressed in
    // tokens read off an inverted band published a white "Mua ngay" on its own
    // white fill — present in the HTML, invisible on the page, clean in review.
    // LITERAL COLOURS ONLY, on both sides, and the ground is the element's own
    // fill or the nearest ancestor that sets one: a theme var or an unset page
    // ground is not known here, and a dark theme would make a guessed "white"
    // ground cry wolf on every light heading.
    if ((type === 'text' || type === 'heading' || type === 'button') && !inOverlay.has(id)) {
      const fg = rgbOf((n as { style?: Record<string, unknown> }).style?.color);
      let ground: number[] | null = null;
      for (let x: string | null | undefined = id; x && d.nodes[x] && !ground; x = d.nodes[x].data.parent) {
        const bg = (d.nodes[x] as { style?: Record<string, unknown> }).style?.backgroundColor;
        if (bg === undefined || bg === 'transparent' || bg === '') continue;
        ground = rgbOf(bg);
        if (!ground) break; // a var() or a gradient: unknown, say nothing
      }
      if (fg && ground && contrast(fg, ground) < 1.5) {
        out.push({
          code: 'invisible_text',
          nodeId: id,
          type,
          problem: `Its colour is the colour it sits on (contrast ${contrast(fg, ground).toFixed(2)}:1) — the words are there and nobody can read them.`,
          fix: fill('invisible_text', { id }),
        });
      }
    }

    // THE DEMO OPTIONS. product-variants seeds config.attributes Color
    // Red/Green/Blue, Size S/M/L, and that authored config is the documented
    // FALLBACK for a product with no option axes of its own (schema binding.ts:
    // "the picker keeps its authored config"). So every simple product on a
    // published page offered three colours and three sizes that do not exist —
    // measured on a store built here, and reviewed clean.
    if (type === 'product-variants') {
      const authored = (n as { config?: Record<string, unknown> }).config?.attributes;
      const seeded = (ELEMENTS[type]?.defaults as { config?: Record<string, unknown> } | undefined)?.config?.attributes;
      if (Array.isArray(seeded) && seeded.length && isDeepStrictEqual(authored, seeded)) {
        out.push({
          code: 'demo_variant_options',
          nodeId: id,
          type,
          problem:
            'Still the picker\'s demo options (Color Red/Green/Blue, Size S/M/L). They render for ' +
            'every product that has no options of its own — a shopper is offered choices that do not exist.',
          fix: fill('demo_variant_options', { id }),
        });
      }
    }

    // A NAVIGATION CONTROL WITH NOWHERE TO GO, and it is the sharpest silent
    // failure on this list because the page is CORRECT in every way a check can
    // otherwise see. The tree holds the event the author asked for; the pixels
    // are the pixels they designed; and the click does nothing, because a sole
    // navigation click renders as `specials.href` and the renderer deliberately
    // emits no `on:click` beside it.
    //
    // Measured on a live storefront: three home-page images published as bare
    // `<img>` tags with no anchor, next to a button that carried the href and
    // published as `<a href>`. `sb_event` now writes both; this is for every
    // document that got here before it did, or by another road.
    const dead = deadNavigation(n as never);
    if (dead) {
      out.push({
        code: 'dead_nav',
        nodeId: id,
        type,
        problem:
          `Its only click action goes to "${dead.url}" and it carries no specials.href, so the ` +
          'published markup has neither an anchor nor an on:click — a shopper clicking it ' +
          'stays exactly where they are, on a page that looks right and reviews clean.',
        fix: fill('dead_nav', { url: dead.url }),
        ...(inOverlay.has(id) ? { overlay: true } : {}),
      });
    }

    // AN EVENT THE ELEMENT CANNOT FIRE, OR ONE WITH NOWHERE TO GO. `sb_event`
    // refuses both at write time; a document gets here by other roads (an
    // import, a template, a hand-built sb_api_call). Same table setEvent reads
    // (`liveEventTable` in tools/live.ts): bindingEvents once a purchase binds.
    const events = (n as unknown as { events?: NodeEventLike[] }).events ?? [];
    if (events.length) {
      const table = liveEventTable(d.nodes as never, id);
      for (const ev of events) {
        const trigger = String(ev?.name ?? '');
        const action = String(ev?.action ?? '');
        if (!table?.[trigger]?.includes(action)) {
          out.push({
            code: 'invalid_action',
            nodeId: id,
            type,
            problem:
              `"${action}" on ${trigger || '(no trigger)'} is not an action a ${type} offers` +
              (table?.[trigger] ? ` there (${table[trigger].join(', ')})` : '') +
              ' — it is stored and never fires.',
            key: trigger,
            fix: fill('invalid_action', { id, key: trigger }),
          });
          continue;
        }
        // The same table `sb_event` refuses by — one list, so the two cannot drift.
        const need = PAYLOAD_NEEDS[action]?.key;
        const v = (ev.payload ?? {})[need ?? ''];
        if (need && (typeof v !== 'string' || v.trim() === '')) {
          out.push({
            code: 'action_missing_target',
            nodeId: id,
            type,
            problem: `Its ${trigger} "${action}" carries no payload.${need}, so the click does nothing.`,
            key: action,
            fix: fill('action_missing_target', { id, key: action }),
          });
        }
      }
    }

    // A RECORD-BOUND ELEMENT WITH NO RECORD. Inside a repeater the row supplies
    // one; on an entity page (product, category, post…) the page does; a pin
    // (`bindings[0].target.id`, render/html.go pinnedEntityID) does for its
    // subtree. Anywhere else the binding resolves to nothing and the element
    // renders its seeded placeholder for ever — saved, published, no warning.
    // Overlays are skipped: one drawer serves every page type.
    if (opts.pageType !== undefined && !inRepeater.get(id) && !inOverlay.has(id)) {
      const entities = PAGE_ENTITIES[opts.pageType] ?? [];
      const missing = ((n as { bindings?: Array<{ source?: string }> }).bindings ?? [])
        .map((b) => String(b?.source ?? '').split('.')[0])
        .find((e) => RECORD_ENTITIES.has(e) && !entities.includes(e));
      const supplied = missing && ROW_SUPPLIER[missing] ? insideType(d, id, ROW_SUPPLIER[missing]) : false;
      if (missing && !supplied && !pinnedAbove(d, id)) {
        out.push({
          code: 'no_data_context',
          nodeId: id,
          type,
          problem:
            (ROW_SUPPLIER[missing]
              ? `Bound to a ${missing} field, but it sits outside any ${ROW_SUPPLIER[missing]} — only its line rows supply one, so it renders its placeholder on the published page.`
              : `Bound to a ${missing} record, but it sits in no repeater and a "${opts.pageType}" ` +
                'page supplies none — it renders its placeholder on the published page.'),
          key: missing,
          fix: fill('no_data_context', { id, key: missing }),
        });
      }
    }

    // COLLECTIONS RECORD LISTS (web_builder PR #117). Three silent shapes:
    //   - a record list naming no collection: recordfeed.go:80-82 `continue`s, so
    //     no row is fetched and the list renders only its empty state;
    //   - a record tile naming no field ID: datasetBindings.ts:152-155 binds ''
    //     and the tile shows its placeholder on every row;
    //   - a `record.*` binding outside a record list: only that list's rows carry
    //     a record context (recordContext.ts), and the NEAREST list is the one
    //     whose row the tile reads (editor/src/element/recordList.ts owningList).
    {
      const cfg = (n as { config?: Record<string, unknown> }).config ?? {};
      if (type === 'list-dataset' && cfg.datasetSource === 'record' && !String(cfg.recordCollectionId ?? '').trim()) {
        out.push({
          code: 'record_list_unsourced',
          nodeId: id,
          type,
          problem:
            'A record list (datasetSource "record") naming no collection — the renderer fetches no ' +
            'rows for it, so a visitor sees only its empty state.',
          fix: fill('record_list_unsourced', { id }),
        });
      }
      // A REPEATER'S CARD reads its OWN datasetSource, unset = product
      // (editor migrateDatasetSource.ts). Under a record/category/… list it binds
      // product.url, so the published card carries no link — the editor heals it on
      // open, the Go renderer never does. AURA's hotel, destination and room cards
      // all shipped this way from an sb_add predating the stamp in addSubtree.
      if (type === 'dataset-block') {
        const list = d.nodes[n.data.parent ?? ''];
        const listSrc = list?.data.type === 'list-dataset' ? (list as { config?: Record<string, unknown> }).config?.datasetSource : undefined;
        if (typeof listSrc === 'string' && listSrc !== '' && listSrc !== 'product' && !cfg.datasetSource) {
          out.push({
            code: 'card_source_unset',
            nodeId: id,
            type,
            problem:
              `This card names no datasetSource inside a "${listSrc}" list, so it binds a PRODUCT link ` +
              'that never resolves — the published card is not clickable.',
            fix: fill('card_source_unset', { id, key: listSrc }),
          });
        }
      }
      // RELATION LISTS (web_builder 1b6c07a91): a record list inside another record
      // list's row. Without recordRelationField it repeats the WHOLE collection under
      // every parent; with one but no record row above it has no parent id and shows
      // only its empty state; with no empty state a parent with no children shows
      // ghost placeholder cards (list-dataset/html.go recordRows → placeholders).
      if (type === 'list-dataset' && cfg.datasetSource === 'record') {
        let up: string | null | undefined = n.data.parent;
        while (up && d.nodes[up] && d.nodes[up].data.type !== 'list-dataset') up = d.nodes[up].data.parent;
        const parentCfg = up && d.nodes[up] ? (d.nodes[up] as { config?: Record<string, unknown> }).config : undefined;
        const nested = parentCfg?.datasetSource === 'record';
        const rel = String(cfg.recordRelationField ?? '');
        // A record detail page (web_builder #160) is the parent of a relation list
        // placed on it outside any list.
        const pageParent = opts.pageType === 'record' && !up;
        if (nested && !rel) {
          out.push({
            code: 'record_relation_unset',
            nodeId: id,
            type,
            problem:
              `A record list inside another record list's row with no config.recordRelationField — ` +
              'every parent row shows the SAME records (the whole collection), not its own children. ' +
              'Intended only if that list is meant to repeat unchanged under every parent.',
            fix: fill('record_relation_unset', { id }),
          });
        } else if (rel && ((!nested && !pageParent) || !RECORD_FIELD_ID.test(rel))) {
          out.push({
            code: 'record_relation_orphan',
            nodeId: id,
            type,
            problem: !RECORD_FIELD_ID.test(rel)
              ? `config.recordRelationField "${rel}" is not a field ID — the list matches no child and shows its empty state (or placeholder cards, without one).`
              : 'A relation list (recordRelationField set) outside any record-list row has no parent id, ' +
                'so it shows its empty state (or placeholder cards, without one) on every page.',
            fix: fill('record_relation_orphan', { id }),
          });
        } else if (rel && d.nodes[String(cfg.emptyStateId ?? '')]?.data.type !== 'list-empty') {
          out.push({
            code: 'record_relation_no_empty',
            nodeId: id,
            type,
            problem:
              'A relation list with no empty state: a parent row with no children yet renders ' +
              'placeholder cards on the live page.',
            fix: fill('record_relation_no_empty', { id }),
          });
        }
      }
      // FORM OPTIONS FROM A COLLECTION (web_builder #159, contract §7.2). Every miss renders
      // a choice field with only its placeholder (no authored fallback), or a room list that
      // never narrows — and the server refuses any other answer as not_an_option.
      if (['form-select', 'form-radio', 'form-checkbox'].includes(type) && String(cfg.optionSource ?? '').trim() === 'record') {
        const why: string[] = [];
        if (!String(cfg.recordCollectionId ?? '').trim()) why.push('config.recordCollectionId names no collection');
        if (!RECORD_FIELD_ID.test(String(cfg.recordLabelField ?? ''))) why.push('config.recordLabelField is not a field ID');
        const pNode = String(cfg.recordParentNode ?? '');
        const pField = String(cfg.recordParentField ?? '');
        if (pNode || pField) {
          const pc = (d.nodes[pNode] as { config?: Record<string, unknown> } | undefined)?.config;
          if (type !== 'form-select') why.push('only a form-select narrows by a parent field');
          else if (!pNode || !pField) why.push('recordParentNode and recordParentField go together');
          else if (d.nodes[pNode]?.data.type !== 'form-select' || String(pc?.optionSource ?? '').trim() !== 'record')
            why.push(`recordParentNode "${pNode}" is not a record-sourced form-select`);
          else if (!RECORD_FIELD_ID.test(pField)) why.push(`recordParentField "${pField}" is not a field ID`);
        }
        if (why.length) {
          out.push({
            code: 'record_option_invalid',
            nodeId: id,
            type,
            problem: `A choice field listing records that shows no options or never narrows: ${why.join('; ')}.`,
            fix: fill('record_option_invalid', { id }),
          });
        }
      }

      // AGGREGATES OVER A RELATION (web_builder #162, contract §7.5). A malformed
      // definition makes the server refuse the WHOLE list — it publishes empty; a
      // "hide" aggregate drops every row nothing fits, so the list needs its empty state.
      if (type === 'list-dataset' && cfg.datasetSource === 'record' && cfg.recordAggregates !== undefined) {
        const aggs = readRecordAggregates(cfg.recordAggregates);
        const empty = d.nodes[String(cfg.emptyStateId ?? '')]?.data.type === 'list-empty';
        if (aggs === null || (aggs.some((a) => a.whenNone === 'hide') && !empty)) {
          out.push({
            code: 'record_aggregate_invalid',
            nodeId: id,
            type,
            problem:
              aggs === null
                ? 'config.recordAggregates is malformed (a bad key, op, id, condition or more than 4) — the server refuses the list and it publishes EMPTY.'
                : 'An aggregate with whenNone "hide" drops every row nothing fits, and this list has no empty state — a visitor whose search fits nothing sees a blank band.',
            fix: fill('record_aggregate_invalid', { id }),
          });
        }
      }

      // BOOKING ESTIMATE (web_builder #161, contract §7.4): its operands are NODE IDS of
      // this form document. A wrong one leaves the line on its placeholder and the
      // server stores no total — or skips a stay rule — with no error anywhere.
      if (type === 'form-estimate') {
        const sp = (n.specials ?? {}) as Record<string, unknown>;
        const terms = Array.isArray(sp.estimateTerms) ? (sp.estimateTerms as Array<Record<string, unknown>>) : [];
        const rules = Array.isArray(sp.estimateRules) ? (sp.estimateRules as Array<Record<string, unknown>>) : [];
        const why: string[] = [];
        const t = (x: unknown) => d.nodes[String(x ?? '')]?.data.type;
        const cfgSrc = (x: unknown) =>
          String(((d.nodes[String(x ?? '')] as { config?: Record<string, unknown> } | undefined)?.config?.optionSource ?? '')).trim();
        const isRecordSelect = (x: unknown) => t(x) === 'form-select' && cfgSrc(x) === 'record';
        const isDate = (x: unknown) => t(x) === 'form-date' || t(x) === 'form-calendar';
        if (terms.filter((x) => x.kind === 'record').length !== 1) why.push('it needs exactly ONE "record" term (the chosen room\'s price)');
        for (const x of terms) {
          if (x.kind === 'record' && (!isRecordSelect(x.node) || !RECORD_FIELD_ID.test(String(x.field ?? ''))))
            why.push(`record term: node "${String(x.node ?? '')}" must be a record-sourced form-select and field a fld_ id`);
          if (x.kind === 'nights' && (!isDate(x.start) || !isDate(x.end))) why.push('nights term: start and end must be date fields of this form');
          if (x.kind === 'number' && t(x.node) !== 'form-number') why.push(`number term: "${String(x.node ?? '')}" is not a form-number`);
        }
        for (const r of rules) {
          if ((r.kind === 'dateRange' || r.kind === 'maxNights') && (!isDate(r.start) || !isDate(r.end))) why.push(`${String(r.kind)} rule: start and end must be date fields of this form`);
          if (r.kind === 'capacity' && (!isRecordSelect(r.node) || !RECORD_FIELD_ID.test(String(r.field ?? '')) || t(r.count) !== 'form-number' || (r.per && t(r.per) !== 'form-number')))
            why.push('capacity rule: node must be a record select, field a fld_ id, count (and per) form-number fields');
        }
        if (why.length) {
          out.push({
            code: 'estimate_invalid',
            nodeId: id,
            type,
            problem: `A booking estimate that shows no total or skips a stay rule: ${[...new Set(why)].join('; ')}.`,
            fix: fill('estimate_invalid', { id }),
          });
        }
      }

      // RECORD FILTERS (web_builder PR #157, contract §7.1): a filter/sort control aimed at a
      // record list. Every miss below renders a control that empties the list or narrows nothing.
      {
        const sp = (n.specials ?? {}) as Record<string, unknown>;
        const targets = Array.isArray(sp.filterTargets) ? (sp.filterTargets as unknown[]).map(String) : [];
        const recordTargets = targets.filter((t) => {
          const c = (d.nodes[t] as { config?: Record<string, unknown> } | undefined)?.config;
          return d.nodes[t]?.data.type === 'list-dataset' && c?.datasetSource === 'record';
        });
        const why: string[] = [];
        if (sp.filterSource === 'record') {
          const cfgOf = (t: string) => (d.nodes[t] as { config?: Record<string, unknown> }).config ?? {};
          // web_builder #162: an axis may also be an aggregate (`agg.<key>`, a budget) or a
          // visitor param (`param.<name>`) — both must exist on EVERY targeted list.
          const axis = String(sp.filterAxis ?? '');
          const aggsOf = (t: string) => readRecordAggregates(cfgOf(t).recordAggregates) ?? [];
          if (axis.startsWith('agg.') || axis.startsWith('param.')) {
            const key = axis.startsWith('agg.') ? recordAggKeyOf(axis) : axis.slice(6);
            const has = (t: string) =>
              axis.startsWith('agg.') ? aggsOf(t).some((a) => a.key === key) : recordAggregateParams(aggsOf(t)).has(key);
            if (!key || !recordTargets.length || !recordTargets.every(has))
              why.push(`filterAxis "${axis}" names no aggregate or param of its target list's config.recordAggregates`);
            if (axis.startsWith('param.') && sp.filterArity !== undefined && sp.filterArity !== 'single')
              why.push(`a param axis holds ONE value — filterArity "${String(sp.filterArity)}" lets a visitor tick two and empties the list`);
          } else if (!RECORD_FIELD_ID.test(axis)) why.push(`filterAxis "${axis}" is not a field ID`);
          if (targets.length && recordTargets.length !== targets.length) why.push('a filterTargets entry is not a record list');
          if (recordTargets.some((t) => String(cfgOf(t).recordRelationField ?? ''))) why.push('it targets a relation list');
          if (new Set(recordTargets.map((t) => String(cfgOf(t).recordCollectionId ?? ''))).size > 1) why.push('its targets read different collections');
          if (sp.filterBehavior !== undefined && sp.filterBehavior !== 'filter') why.push(`filterBehavior "${String(sp.filterBehavior)}" — a record filter only narrows ("filter")`);
        }
        if (sp.filterSource === 'sort' && recordTargets.length) {
          const bad = (Array.isArray(sp.filterValues) ? (sp.filterValues as Array<{ value?: unknown }>) : [])
            .map((v) => String(v?.value ?? ''))
            .filter((v) => !/^(?:fld_[0-9a-f]{16}|agg\.[a-z][a-zA-Z0-9_]{0,31})_(?:asc|desc)$/.test(v));
          if (bad.length) why.push(`sort values ${bad.slice(0, 3).map((v) => `"${v}"`).join(', ')} are not "<fieldId>_asc|desc" or "agg.<key>_asc|desc" — a record list ignores product sort keys`);
        }
        if (why.length) {
          out.push({
            code: 'record_filter_invalid',
            nodeId: id,
            type,
            problem: `A record ${sp.filterSource === 'sort' ? 'sort' : 'filter'} control that narrows nothing or empties its list: ${why.join('; ')}.`,
            fix: fill('record_filter_invalid', { id }),
          });
        }
      }
      // RECORD LINK PARAMETERS and VISITOR FAVORITES (web_builder v1.0.174, contract §7.6/§7.7).
      // Both read the record of the row they sit in — or the page's, on a record page.
      {
        const sp = (n.specials ?? {}) as Record<string, unknown>;
        const nodeAt = (x: string) => d.nodes[x] as never;
        let list: string | null | undefined = n.data.parent;
        while (list && d.nodes[list] && d.nodes[list].data.type !== 'list-dataset') list = d.nodes[list].data.parent;
        const hasRecord = recordScope(nodeAt, id).length > 0 || (opts.pageType === 'record' && !list);
        const evs = (n as unknown as { events?: NodeEventLike[] }).events ?? [];
        const binds = (n as { bindings?: Array<{ id?: string; field?: string }> }).bindings ?? [];
        const params = sp.hrefParams;
        if (Array.isArray(params) ? params.length > 0 : params !== undefined) {
          const why = hrefParamProblems(params);
          // A bound path (record.url) is the platform's own same-site address.
          const boundHref = binds.some((b) => b?.field === 'specials.href');
          if (!boundHref && !isSameSitePath(String(sp.href ?? '')))
            why.push(`specials.href "${String(sp.href ?? '')}" is not a same-site path ("/…"), so no param is ever added`);
          if (why.length)
            out.push({ code: 'href_params_invalid', nodeId: id, type, problem: `Link parameters the renderer drops: ${why.join('; ')}.`, fix: fill('href_params_invalid', { id }) });
          if (!hasRecord)
            out.push({
              code: 'href_params_unresolved',
              nodeId: id,
              type,
              problem: 'specials.hrefParams on a node in no record-list row and not on a record page — no record supplies a value, so the link carries no params.',
              fix: fill('href_params_unresolved', { id }),
            });
          const purchase = hasPurchaseBinding(binds);
          if (purchase || (evs.some((e) => e?.name === 'click') && !soleNavigationClick(evs, false)))
            out.push({
              code: 'href_params_stranded',
              nodeId: id,
              type,
              problem: `specials.hrefParams are not applied: ${purchase ? 'the node is purchase-bound' : 'its click is not ONE Open page / Go to URL action'}, so the href never renders as the link.`,
              fix: fill('href_params_stranded', { id }),
            });
        }
        for (const ev of evs) {
          if (ev?.name !== 'click') continue;
          const why: string[] = [];
          if (ev.action === 'toggle_record_favorite' && !hasRecord)
            why.push('the heart sits in no record-list row and not on a record page, so it publishes nothing');
          if (ev.action === 'show_record_favorites') {
            const p = ev.payload ?? {};
            const t = String(p.targetId ?? '');
            const tc = (d.nodes[t] as { config?: Record<string, unknown> } | undefined)?.config;
            if (t && (d.nodes[t]?.data.type !== 'list-dataset' || tc?.datasetSource !== 'record'))
              why.push(`targetId "${t}" is not a record list on this page`);
            else if (t && String(tc?.recordRelationField ?? '')) why.push(`targetId "${t}" is a relation list, which ignores favorites`);
            if (p.view !== 'favorites' && p.view !== 'all') why.push(`view "${String(p.view)}" is neither "favorites" nor "all"`);
          }
          if (why.length)
            out.push({ code: 'record_favorite_invalid', nodeId: id, type, problem: `Its "${String(ev.action)}" does nothing: ${why.join('; ')}.`, key: String(ev.action), fix: fill('record_favorite_invalid', { id }) });
        }
      }
      // A record media-dataset (§7.9) binds ONE plain field id typed gallery/image, and
      // only in its childless leaf form — the container's children bind products.
      if (type === 'media-dataset' && cfg.datasetSource === 'record') {
        const fid = cfg.recordField;
        const why =
          childrenOf(d, id).length > 0
            ? 'it has children — only the CHILDLESS media-dataset renders a record gallery; the container form\'s children bind products'
            : typeof fid !== 'string' || !RECORD_FIELD_ID.test(fid)
              ? `config.recordField ${fid ? `"${String(fid)}" is not a plain field ID` : 'is unset'} — a media tile names one gallery/image field by its fld_ id (no agg., no ref.)`
              : cfg.recordFieldType !== 'gallery' && cfg.recordFieldType !== 'image'
                ? `config.recordFieldType is ${cfg.recordFieldType ? `"${String(cfg.recordFieldType)}"` : 'unset'}, not "gallery" or "image", so it binds nothing`
                : '';
        if (why) out.push({ code: 'record_field_unset', nodeId: id, type, problem: `This record media-dataset shows its authored placeholder images: ${why}.`, fix: fill('record_field_unset', { id }) });
      }
      if (RECORD_TILES.has(type) && type !== 'media-dataset' && cfg.datasetSource === 'record') {
        const fid = cfg.recordField;
        const aggKey = typeof fid === 'string' ? recordAggKeyOf(fid) : '';
        let aggOk = false;
        if (aggKey) {
          let up: string | null | undefined = n.data.parent;
          while (up && d.nodes[up] && d.nodes[up].data.type !== 'list-dataset') up = d.nodes[up].data.parent;
          const lc = up ? (d.nodes[up] as { config?: Record<string, unknown> }).config : undefined;
          aggOk = (readRecordAggregates(lc?.recordAggregates) ?? []).some((a) => a.key === aggKey);
        }
        if (aggKey && !aggOk) {
          out.push({
            code: 'record_field_unset',
            nodeId: id,
            type,
            problem: `config.recordField "${String(fid)}" names an aggregate its record list does not define in config.recordAggregates — it renders its placeholder on every row.`,
            fix: fill('record_field_unset', { id }),
          });
        } else if (!aggKey && (typeof fid !== 'string' || (!RECORD_FIELD_ID.test(fid) && !parseRecordRefAxis(fid)))) {
          out.push({
            code: 'record_field_unset',
            nodeId: id,
            type,
            problem:
              (fid ? `config.recordField "${String(fid)}" is not a field ID` : 'It names no config.recordField') +
              ' — a record tile binds a field by its "fld_<16 hex>" ID, never its key, so it renders its ' +
              'placeholder on every row.',
            fix: fill('record_field_unset', { id }),
          });
        }
      }
      const recordBound = ((n as { bindings?: Array<{ source?: string }> }).bindings ?? []).some((b) =>
        isRecordSource(String(b?.source ?? '')),
      );
      if (recordBound && !inOverlay.has(id)) {
        let list: string | null | undefined = n.data.parent;
        while (list && d.nodes[list] && d.nodes[list].data.type !== 'list-dataset') list = d.nodes[list].data.parent;
        const lcfg = list && d.nodes[list] ? (d.nodes[list] as { config?: Record<string, unknown> }).config : undefined;
        // On a record detail page the PAGE supplies the record outside any list.
        if (lcfg?.datasetSource !== 'record' && !(opts.pageType === 'record' && !list)) {
          out.push({
            code: 'no_data_context',
            nodeId: id,
            type,
            problem:
              'Bound to a record field, but ' +
              (list ? 'its nearest list-dataset is not a record list' : 'it sits in no list-dataset') +
              ' — only a list-dataset with datasetSource "record" supplies one, so it renders its placeholder.',
            key: 'record',
            fix: fill('no_data_context', { id, key: 'record' }),
          });
        }
      }
    }

    // A STORED VALUE NO RENDERER READS. The same vocabulary `sb_set` warns from
    // (`unknownWriteNote` / `unknownValueNote`), asked of what the document
    // already holds — base and every breakpoint — because an import or a write
    // made before the warning existed is still publishing the fallback.
    {
      const layered = n as unknown as {
        config?: Record<string, unknown>;
        responsive?: Record<string, { config?: Record<string, unknown>; specials?: Record<string, unknown> }>;
      };
      const layers: Array<[string, Record<string, unknown> | undefined]> = [
        ['config', layered.config],
        ['specials', n.specials as Record<string, unknown> | undefined],
        ...Object.values(layered.responsive ?? {}).flatMap(
          (r) => [['config', r?.config], ['specials', r?.specials]] as Array<[string, Record<string, unknown> | undefined]>,
        ),
      ];
      const said = new Set<string>();
      for (const [ns, slot] of layers) {
        for (const [k, v] of Object.entries(slot ?? {})) {
          // An icon name the manifest lacks draws the default star or nothing.
          const icon = iconNote(type, ns, k, v);
          if (icon) {
            if (said.has(`${ns}.${k}=${String(v)}`)) continue;
            said.add(`${ns}.${k}=${String(v)}`);
            out.push({
              code: 'unknown_icon',
              nodeId: id,
              type,
              problem: icon.problem,
              key: `${ns}.${k}`,
              fix: fill('unknown_icon', { id, ns, key: k }),
              ...(inOverlay.has(id) ? { overlay: true } : {}),
            });
            continue;
          }
          const unread =
            unknownWriteNote(type, ns, k, v) ?? (ns === 'config' ? unknownValueNote(k, v) : null);
          if (!unread || said.has(`${ns}.${k}=${String(v)}`)) continue;
          said.add(`${ns}.${k}=${String(v)}`);
          const legal = (vocabularyForWrite(type, ns, k) ?? (ns === 'config' ? vocabularyFor(k) : null))?.values ?? [];
          out.push({
            code: 'unread_value',
            nodeId: id,
            type,
            problem:
              `${ns}.${k} = ${JSON.stringify(v)} is not a value the renderer reads; it publishes ` +
              `as its fallback with no error. Legal: ${legal.map((x) => x || '""').join(', ')}.`,
            key: `${ns}.${k}`,
            fix: fill('unread_value', { id, type }),
          });
        }
      }
    }

    if (type === 'custom-code') {
      const rows = hardcodedRecords(String((n.specials ?? {}).code ?? ''));
      if (rows) {
        out.push({
          code: 'hardcoded_dataset',
          nodeId: id,
          type,
          severity: 'maintenance',
          problem:
            `Its script carries ${rows.count} records with the same fields (${rows.keys.slice(0, 6).join(', ')}` +
            `${rows.keys.length > 6 ? ', …' : ''}) — a data table kept in code, so adding a row or changing ` +
            'a value means editing this script and every copy of it.',
          fix: fill('hardcoded_dataset', { id }),
        });
      }
      const native = nativeFor(String((n.specials ?? {}).code ?? ''));
      if (native) {
        out.push({
          code: 'custom_code_native',
          nodeId: id,
          type,
          severity: 'maintenance',
          problem:
            `Hand-written markup a native ${native} covers. It works, but no inspector can edit ` +
            'it, it ignores the theme, and sb_review cannot see inside it.',
          key: native,
          fix: fill('custom_code_native', { id, key: native }),
        });
      }
    }

    // PINNING FAILS WITH NOTHING ON SCREEN AND NOTHING IN THE LOG — both halves
    // of it — which is exactly what a review is for. `sb_set` refuses the second
    // case at write time, but a document reaches here by other roads: an import,
    // a template, or a later edit that un-pinned the host and left the overrides
    // behind.
    const styled = n as unknown as {
      style?: Record<string, unknown>;
      responsive?: Record<string, { style?: Record<string, unknown>; states?: Record<string, unknown> }>;
      states?: Record<string, unknown>;
    };
    if (isPinnedNode(n as never)) {
      const blocker = stickyBlockedBy(d, id);
      // Sticky only: a `fixed` element is positioned against the viewport and an
      // overflow ancestor cannot take that away from it.
      const sticky =
        String(styled.style?.position) === 'sticky' ||
        Object.values(styled.responsive ?? {}).some((r) => String(r?.style?.position) === 'sticky');
      if (blocker && sticky) {
        out.push({
          code: 'sticky_blocked',
          nodeId: id,
          type,
          problem:
            `Pinned, but ancestor "${blocker}" clips its overflow — so that ancestor becomes ` +
            'the scroll container this node pins inside, and it never scrolls. The node does ' +
            'not move, and nothing reports it.',
          key: blocker,
          fix: fill('sticky_blocked', { id, key: blocker }),
        });
      }
    }
    // COUNT THE KEYS, don't ask whether the slot exists — the platform's own
    // `HasStuckOverrides` tests `len(slot.Style) > 0`, and an EMPTY slot paints
    // nothing whether or not there is a host. Asking the weaker question made
    // this a false positive on the one document the fix produces: unsetting the
    // last key leaves `{}` behind, so the repair the finding names left the
    // finding standing.
    const stuckSlots = [
      styled.states?.[STUCK_STATE],
      ...Object.values(styled.responsive ?? {}).map((r) => r?.states?.[STUCK_STATE]),
    ];
    // AN ORDER FORM THAT LEAVES THE SHOPPER WHERE THEY WERE.
    //
    // Measured on a store built entirely with these tools: the order is created
    // and the page stays put, showing a receipt-shaped list of totals that all
    // read 0 because the cart it was summing has just been emptied. Nothing
    // errors, and the shopper cannot tell a completed order from a failed one.
    //
    // The FORM NODE's event, or the RECORD's own `afterSubmit: "redirect"` —
    // carried since web_builder fcfde38ac (`forms/pagesource.go` stamps
    // `sentRedirect`; the runtime follows it after the `form:success` chain).
    // A `pageId` target that is unpublished falls back to the message; that is
    // the page's own defect (readiness reports unpublished pages), not this one.
    if (type === 'form') {
      const events = (n as unknown as { events?: Array<{ name?: string; action?: string }> }).events ?? [];
      const navigates = events.some(
        (e) =>
          e.name === 'form:success' &&
          (e.action === 'go_to_url' || e.action === 'open_page' || e.action === 'go_to_checkout'),
      );
      // AN ORDER-SHAPED PAGE, read off the document rather than off the page
      // record. The record's `type` would need a second round trip on every
      // open, and the form's own type a third; a page that carries BOTH a form
      // and a cart total is the checkout shape and nothing else is — a contact
      // page has no cart to total.
      //
      // NOT THE CART DRAWER'S TOTAL: the drawer is an overlay composed onto EVERY
      // page (trap 1), so counting it made every login and register page a
      // "checkout". And when the site's form list says what this form IS, that
      // answer wins — only an `order` form places an order.
      const sellsFromCart = walkOrder.some((x) => !inOverlay.has(x) && d.nodes[x]?.data.type === 'cart-total');
      const formType = opts.formTypes?.[String(n.specials?.formId ?? '')];
      const isOrder = formType ? formType === 'order' : sellsFromCart;
      const redirects = opts.formRedirects?.has(String(n.specials?.formId ?? '')) ?? false;
      if (!navigates && !redirects && isOrder && !inOverlay.has(id)) {
        out.push({
          code: 'order_goes_nowhere',
          nodeId: id,
          type,
          problem:
            'This is the checkout form and nothing sends the shopper anywhere once the order ' +
            'is placed. They stay on this page, where every cart total now reads 0 because the ' +
            'cart was just emptied — a completed order that looks like a failed one.',
          fix: fill('order_goes_nowhere', { id }),
        });
      }
    }

    // A HOVER STORED WHERE NOBODY READS IT. The universal hover state is not the
    // only home: an element whose meta declares a Hover variant keeps it
    // somewhere its own renderer looks, and for a `button` that is the flat
    // `config.stateHover` map. Every hover this server wrote onto a button
    // before it learned that is still sitting in `states.hover`, painting
    // nothing — on a control that is the single most common thing anyone gives
    // a hover to.
    const hoverSlots = [
      styled.states?.[HOVER_STATE],
      ...Object.values(styled.responsive ?? {}).map((r) => r?.states?.[HOVER_STATE]),
    ];
    const hasHover = hoverSlots.some((slot) => {
      const h = slot as { style?: object; config?: object } | undefined;
      return !!h && (Object.keys(h.style ?? {}).length > 0 || Object.keys(h.config ?? {}).length > 0);
    });
    if (hasHover && hoverHome(type) === 'legacy') {
      out.push({
        code: 'hover_dead',
        nodeId: id,
        type,
        problem:
          `"${type}" keeps its hover in config.stateHover — the flat map its own renderer ` +
          'compiles — and the platform\'s universal hover compiler stands aside for it. These ' +
          'states.hover values are stored, saved, published and painted by nobody.',
        fix: fill('hover_dead', { id }),
      });
    }

    const hasStuck = stuckSlots.some((slot) => {
      const s = slot as { style?: object; config?: object } | undefined;
      return !!s && (Object.keys(s.style ?? {}).length > 0 || Object.keys(s.config ?? {}).length > 0);
    });
    if (hasStuck && !stuckHostOf(d, id)) {
      out.push({
        code: 'stuck_no_host',
        nodeId: id,
        type,
        problem:
          'Carries a "stuck" override, but neither it nor any ancestor can pin — so the ' +
          'renderer emits no rule for it. The styling is stored, saved and published, and ' +
          'never painted.',
        fix: fill('stuck_no_host', { id }),
      });
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
    // OR IT DRAWS ITS OWN CONTROL. `search-input` is a container only for the
    // dropdown an author MAY compose under it; with no children it still renders
    // its `<input>` (render/nodes/search-input/html.go). The platform's own
    // search seed ships it childless, so every seeded search page was flagged.
    // Not `select`: its face lives in its trigger/panel children — and THOSE
    // zones are filled by the host (render/nodes/dropdown WriteSelect: the
    // panel prints one row per filterValues, the trigger the chosen one), so a
    // select's or a selectMode:"select" dropdown's empty zone is correct.
    const host = d.nodes[n.data.parent ?? '']?.data;
    const filledByHost =
      (type === 'dropdown-trigger' || type === 'dropdown-panel') &&
      (host?.type === 'select' || (host?.type === 'dropdown' && d.nodes[n.data.parent!]?.specials?.selectMode === 'select'));
    const drawsOwnControl = type === 'search-input' || filledByHost;
    const isReference =
      (n.specials ?? {})[SPEC_GLOBAL_REF] !== undefined ||
      (n.specials ?? {})[SPEC_APP_BLOCK_REF] !== undefined;
    if (
      meta.isContainer &&
      childrenOf(d, id).length === 0 &&
      !isReference &&
      !drawsOwnControl &&
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
      const blank = (v: unknown) => v === undefined || v === null || String(v).trim() === '';
      const isBlank = blank(value) && alsoCarries(type, key).every((k) => blank((n.specials ?? {})[k]));
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
      if (seed !== undefined && String(seed).trim() !== '' && value === seed && !SEED_IS_COPY.has(type)) {
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

      // THE STORE SEEDS' ENGLISH COPY ON A VIETNAMESE SITE ("Add To Cart") —
      // fine on an English site, so asked only when the site's language is
      // known. sb_page_create now seeds it in Vietnamese; this is for pages
      // made before that, or with locale:"en" on a Vietnamese site.
      else if (
        typeof value === 'string' &&
        SEED_COPY_VI[value] &&
        langOf(opts.siteLocale) === 'vi'
      ) {
        out.push({
          code: 'default_seed_copy',
          nodeId: id,
          type,
          problem:
            `Still the platform's English seed copy (${JSON.stringify(value)}) on a Vietnamese site — ` +
            `"${SEED_COPY_VI[value]}" is what this storefront should say.`,
          key,
          fix: fill('default_seed_copy', { id, key }),
        });
      }

      // A BUILT-IN LAYOUT'S EXAMPLE COPY — see examplecopy.ts.
      else if (typeof value === 'string' && exampleCopy().has(value)) {
        out.push({
          code: 'example_copy',
          nodeId: id,
          type,
          problem:
            `Still the "${exampleCopy().get(value)}" layout's example copy (${JSON.stringify(value)}). ` +
            'A shopper reads it as this shop speaking — and a number, a promise or a ' +
            'testimonial in it is a claim nobody made.',
          key,
          fix: fill('example_copy', { id, key }),
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
      // A record source is a field ID, so no static list holds it; boundHtml takes
      // one only as record.html.<fid> (schema/src/rawSinkBindings.ts:102).
      const recordOk =
        !!b.source && RECORD_SOURCE.test(b.source) && (b.field !== 'specials.boundHtml' || RECORD_HTML_SOURCE.test(b.source));
      if (b.source && !recordOk && !BINDING_SOURCES.includes(b.source)) {
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
  // A PAGE WITH HEADINGS AND NO <h1>. `heading` ships as h2
  // (render/nodes/heading/html.go: SpecialString "htmlTag", default "h2"), and
  // `text` / `text-dataset` take the same key, so a page built here — and every
  // page the platform seeds, product title included — has headings at every
  // level but the one a search engine and a screen reader look for first.
  // Nothing on the canvas shows the tag. Page bands only (`band` excludes the
  // overlays): a drawer heading is not the page's.
  //
  // NAMED ON THE PAGE'S OWN HEADING, never a shared section's. The draft
  // composes the global header in, so its brand line is the first heading on
  // EVERY page — measured on a local store: one node id reported on six pages,
  // and the fix would have made the site name the h1 everywhere. A shared h1
  // still counts as present (that is a site's own decision); a page whose only
  // headings are shared has none of its own and is left alone.
  {
    const shared = new Set<string>();
    for (const sectionId of pageChildren(d)) {
      if (!isSharedSection(d, sectionId)) continue;
      const stack = [sectionId];
      while (stack.length) {
        const id = stack.pop()!;
        if (shared.has(id)) continue;
        shared.add(id);
        for (const k of childrenWithSatellites(d, id)) stack.push(k);
      }
    }
    const level = (id: string): string | null => {
      const n = d.nodes[id];
      const tag = n.specials?.htmlTag;
      if (typeof tag === 'string' && /^h[1-6]$/.test(tag)) return tag;
      return n.data.type === 'heading' ? 'h2' : null;
    };
    const headings = walkOrder.filter((id) => band.has(id) && level(id) !== null);
    const own = headings.filter((id) => !shared.has(id));
    // A FORM DOCUMENT is embedded in a page, and that page owns the h1.
    if (own.length > 0 && !headings.some((id) => level(id) === 'h1') && !isFormDocument(d)) {
      const first = own[0];
      out.push({
        code: 'no_h1',
        nodeId: first,
        type: d.nodes[first].data.type,
        problem:
          `${headings.length} heading${headings.length === 1 ? '' : 's'} and none is an h1 — ` +
          'every heading ships as h2, so the page has no main title for a search engine or a ' +
          'screen reader. Invisible on the canvas.',
        key: 'htmlTag',
        fix: fill('no_h1', { id: first }),
      });
    }
  }

  // A FORM DOCUMENT's fields that store fine and can never be answered.
  for (const f of formFieldFindings(d, opts.formDocType)) out.push({ ...f, fix: fill(f.code, { id: f.nodeId }) });

  return out;
}
