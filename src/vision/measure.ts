import type { Box, Shot } from './shoot.js';
import { fill } from '../domains/site/findings.js';

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
export function measureShot(shot: Shot, skip: ReadonlySet<string> = new Set()): VisualFinding[] {
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

  void byId;
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
): Array<VisualFinding & { widths: number[] }> {
  const merged = new Map<string, VisualFinding & { widths: number[] }>();
  for (const shot of shots) {
    for (const f of measureShot(shot, skip)) {
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
