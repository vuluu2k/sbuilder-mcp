import type { Box, Shot } from './shoot.js';
import { fill } from '../domains/site/findings.js';
import { childrenOf, subtreeIds, type DocLike } from '../core/tree.js';

/**
 * A defect measured on the RENDERED page, not read off the document.
 *
 * `sb_review` reads the tree and catches what is missing — an empty section, a
 * placeholder never replaced, an image with no source. It cannot see anything
 * that only exists once the browser has laid the page out: a card wider than the
 * column holding it, two elements on top of each other, body copy that lands at
 * nine pixels on a phone. Those are the defects a person notices FIRST, and they
 * are objective — the boxes are already measured on every `sb_look`.
 *
 * What this deliberately does NOT judge is taste. Whether a hero reads well is
 * not measurable, and a tool that pretended otherwise would spend the agent's
 * attention arguing about the things it cannot know.
 */
export interface VisualFinding {
  code: string;
  nodeId: string;
  width: number;
  problem: string;
  fix: string;
}

/** Below this, body text is uncomfortable on a phone. */
const MIN_BODY_PX = 12;
/** A few pixels of overlap is a rounding artefact, not a defect. */
const SLOP = 2;

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.w - SLOP &&
    b.x < a.x + a.w - SLOP &&
    a.y < b.y + b.h - SLOP &&
    b.y < a.y + a.h - SLOP
  );
}

/**
 * Everything measurably wrong with how one shot laid out.
 *
 * Reported per width, because these defects are per width: a card that fits at
 * 1440 and spills at 390 is the ordinary responsive failure, and saying which
 * width it happened at is most of the fix.
 */
export function measureShot(shot: Shot, skip: ReadonlySet<string> = new Set(), doc?: DocLike): VisualFinding[] {
  const out: VisualFinding[] = [];
  const byId = new Map(shot.boxes.map((b) => [b.id, b]));
  const seen = new Set<string>();

  for (const b of shot.boxes) {
    if (b.id === 'ROOT') continue;
    // AN OVERLAY IS OFF-SCREEN ON PURPOSE. The cart drawer is parked outside
    // the viewport until a shopper opens it, so every node inside it measures
    // as off-canvas — 24 findings on one page, on every page carrying the
    // drawer, at every width. They are also not this page's to fix: an overlay
    // is composed onto ROOT on read and stripped on write (trap 1), which is
    // why `reviewDesign` already skips them and this had to as well. A list
    // that is two dozen false positives long is a list nobody reads.
    if (skip.has(b.id)) continue;

    // OFF-CANVAS. A negative x, or a right edge past the viewport, is content
    // the visitor cannot reach — and on a phone it also drags a horizontal
    // scrollbar across the whole page.
    if (b.x < -SLOP || b.x + b.w > shot.width + SLOP) {
      out.push({
        code: 'off_canvas',
        nodeId: b.id,
        width: shot.width,
        problem: `Extends past the ${shot.width}px viewport (${b.x} → ${b.x + b.w}).`,
        fix: fill('off_canvas', { id: b.id }),
      });
    }

    // TEXT TOO SMALL. Only where text actually renders: a container inherits a
    // font size it never shows, and reporting that would be noise.
    if (b.hasText && b.fontPx && b.fontPx < MIN_BODY_PX) {
      out.push({
        code: 'text_too_small',
        nodeId: b.id,
        width: shot.width,
        problem: `Renders at ${b.fontPx}px at ${shot.width}px wide — below the ${MIN_BODY_PX}px a phone can read comfortably.`,
        fix: fill('text_too_small', { id: b.id }),
      });
    }
  }

  // OVERLAP, between siblings only. Any parent overlaps its children by
  // definition, and an absolutely-positioned decoration over a band is a design
  // choice — but two elements in the same flow row sitting on top of each other
  // is one of them being unreadable.
  for (const a of shot.boxes) {
    if (skip.has(a.id)) continue;
    for (const b of shot.boxes) {
      if (a.id >= b.id || a.id === 'ROOT' || b.id === 'ROOT') continue;
      // Same reason as above, and it needs saying twice because the pair loop is
      // its own pass: a drawer parked off-screen overlaps whatever the page has
      // at those coordinates, and neither half of that pair is a defect.
      if (skip.has(b.id)) continue;
      if (a.w === 0 || a.h === 0 || b.w === 0 || b.h === 0) continue;
      // AND THE COMMENT ABOVE IS NOW IMPLEMENTED. It has always said that "an
      // absolutely-positioned decoration over a band is a design choice", and
      // nothing checked: `Box` carried no `position`, so the rule could not tell
      // a deliberate overlay from a collision. Every quickview badge, sale
      // ribbon and wishlist heart on a product card is an overlay BY
      // CONSTRUCTION, so this fired on storefronts that were built correctly —
      // measured on a live home page, a `collection-media` reported against the
      // `icon` sitting in its own corner.
      //
      // `static` is the only value that means "in the flow", which is what the
      // rest of this rule is about: two boxes the LAYOUT put on top of each
      // other. `relative` counts as in-flow too — it still takes its space, and
      // a relative element overlapping a sibling is the negative-margin defect
      // this check exists to find.
      if (a.position && a.position !== 'static' && a.position !== 'relative') continue;
      if (b.position && b.position !== 'static' && b.position !== 'relative') continue;
      const pairKey = `${a.id}|${b.id}`;
      if (seen.has(pairKey)) continue;
      // Skip ancestry: a box containing another is nesting, not collision.
      if (contains(a, b) || contains(b, a)) continue;
      if (!overlaps(a, b)) continue;
      seen.add(pairKey);
      out.push({
        code: 'overlap',
        nodeId: a.id,
        width: shot.width,
        problem: `Overlaps ${b.id} at ${shot.width}px wide — one of them is unreadable.`,
        fix: fill('overlap', { id: a.id }),
      });
    }
  }

  if (doc) out.push(...titleBars(shot, doc, byId, skip));
  return out;
}

type Rect = { x: number; y: number; w: number; h: number };
function union(bs: Rect[]): Rect | null {
  if (!bs.length) return null;
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}

type Styled = { style?: Record<string, unknown>; responsive?: Record<string, { style?: Record<string, unknown> }> };
/** Every value a node declares for one style key, at any width. */
function declared(doc: DocLike, id: string, key: string): unknown[] {
  const n = doc.nodes[id] as unknown as Styled | undefined;
  return [n?.style, ...Object.values(n?.responsive ?? {}).map((r) => r?.style)].map((s) => s?.[key]).filter((v) => v !== undefined);
}
/** Spacings that mean "not flush right" on purpose. */
const SPREAD = new Set(['center', 'space-around', 'space-evenly']);
/** Cross-axis answers that mean "not on the centre line" on purpose. */
const LINED = new Set(['flex-end', 'end', 'baseline']);
/** Containers an action may sit in, and nothing else. */
const WRAPS = new Set(['flex-block']);
const visible = (b: Box | undefined): b is Box => !!b && b.w > 0 && b.h > 0;

/**
 * A HEADING WITH ONE ACTION BESIDE IT, judged where the eye judges it.
 *
 * The row that went wrong split itself in two equal halves: the action sat at
 * the left of its half — mid-band — and the top-aligned row hung it from the
 * heading's top edge. Neither shows in the tree as a defect, because every
 * style on it is a legitimate value. Only side-by-side pairs are judged, so a
 * stacked phone layout is not reported; the action side must be buttons and
 * their wrappers ONLY (the mapper's `isTitleBar`), so a text column beside a
 * card or a grid holding buttons is a different shape; and a row that DECLARES
 * a centred spacing or cross-axis line is left to its own decision.
 */
function titleBars(shot: Shot, doc: DocLike, byId: Map<string, Box>, skip: ReadonlySet<string>): VisualFinding[] {
  const out: VisualFinding[] = [];
  const typeOf = (id: string): string => doc.nodes[id]?.data.type ?? '';
  for (const id of Object.keys(doc.nodes)) {
    const kids = childrenOf(doc, id);
    const row = byId.get(id);
    if (kids.length !== 2 || !visible(row) || skip.has(id)) continue;
    const trees = kids.map((k) => subtreeIds(doc, k));
    const isAction = (t: string[]): boolean => {
      const n = t.filter((x) => typeOf(x) === 'button').length;
      return n >= 1 && n <= 3 && t.every((x) => typeOf(x) === 'button' || WRAPS.has(typeOf(x)));
    };
    const isHead = (t: string[]): boolean => t.some((x) => typeOf(x) === 'heading') && !t.some((x) => typeOf(x) === 'button');
    const h = isHead(trees[0]) && isAction(trees[1]) ? 0 : isHead(trees[1]) && isAction(trees[0]) ? 1 : -1;
    if (h === -1) continue;
    const btnIds = trees[1 - h].filter((x) => typeOf(x) === 'button');
    const head = union(trees[h].filter((x) => !childrenOf(doc, x).length).map((x) => byId.get(x)).filter(visible));
    const btn = union(btnIds.map((x) => byId.get(x)).filter(visible));
    if (!head || !btn) continue;
    // Stacked (a phone), or the action leads: not this shape.
    if (btn.x < head.x + head.w - SLOP || btn.y >= head.y + head.h || head.y >= btn.y + btn.h) continue;
    const centredText = [id, kids[h], ...trees[h].filter((x) => typeOf(x) === 'heading')].some((x) =>
      declared(doc, x, 'textAlign').includes('center'),
    );
    const rightGap = row.x + row.w - (btn.x + btn.w);
    if (!centredText && !declared(doc, id, 'justifyContent').some((v) => SPREAD.has(String(v))) && rightGap > Math.max(24, row.w * 0.15)) {
      out.push({
        code: 'title_bar_stranded',
        nodeId: btnIds[0],
        width: shot.width,
        problem: `Sits ${Math.round(rightGap)}px short of the right edge of its ${row.w}px row, beside a heading — it reads as floating mid-band.`,
        fix: fill('title_bar_stranded', { id, cell: kids[1 - h] }),
      });
    }
    const dy = Math.abs(btn.y + btn.h / 2 - (head.y + head.h / 2));
    if (!declared(doc, id, 'alignItems').some((v) => LINED.has(String(v))) && dy > Math.max(6, head.h * 0.2)) {
      out.push({
        code: 'title_bar_offcenter',
        nodeId: btnIds[0],
        width: shot.width,
        problem: `Its centre is ${Math.round(dy)}px off the heading's at ${shot.width}px wide — the pair does not share a line.`,
        fix: fill('title_bar_offcenter', { id }),
      });
    }
  }
  return out;
}

function contains(outer: Box, inner: Box): boolean {
  return (
    outer.x - SLOP <= inner.x &&
    outer.y - SLOP <= inner.y &&
    outer.x + outer.w + SLOP >= inner.x + inner.w &&
    outer.y + outer.h + SLOP >= inner.y + inner.h
  );
}

/**
 * Measure every width, and report each defect once.
 *
 * A card that spills at three widths is one problem, not three — but WHICH
 * widths it spills at is the useful part, so the widths are collected onto the
 * single finding rather than repeated as separate ones.
 */
export function measure(
  shots: Shot[],
  skip: ReadonlySet<string> = new Set(),
  doc?: DocLike,
): Array<VisualFinding & { widths: number[] }> {
  const merged = new Map<string, VisualFinding & { widths: number[] }>();
  for (const shot of shots) {
    for (const f of measureShot(shot, skip, doc)) {
      const key = `${f.code}|${f.nodeId}`;
      const existing = merged.get(key);
      if (existing) existing.widths.push(f.width);
      else merged.set(key, { ...f, widths: [f.width] });
    }
  }
  return [...merged.values()];
}

export const MEASURE_NOTICE =
  'These were MEASURED on the rendered page, not read off the document — they are what a ' +
  'visitor meets at those widths. Fix them at the breakpoint named; a defect at 390px and ' +
  'not at 1440px is a responsive failure, not a broken element.';
