import { ancestors, type DocLike } from '../core/tree.js';
import type { Box } from './shoot.js';

export type BoxTuple = [id: string, type: string, x: number, y: number, w: number, h: number];

export const BOXES_FORMAT =
  'boxes are [id, type, x, y, w, h] in CSS px at widths[0], for nodes down to box_depth ' +
  '(default 2). With node_id the depth counts from that node. Pass a larger box_depth to see deeper.';

/**
 * The boxes an agent READS, as tuples, down to a depth.
 *
 * Every box is still measured and kept in the session — the presence cursor and
 * `measure` want all of them. But 200 pretty-printed objects were ~27 KB per
 * look, and a layout judgement is made on bands and their direct children.
 * Ids the document does not hold (a composed overlay's interior) are dropped:
 * their depth is not this page's to compute. ROOT is always kept.
 *
 * `root` is the node a framed look (`sb_look node_id`) is about: depth then
 * counts from it, and only its subtree is kept — the whole page's bands are
 * not what a caller framing one card asked to see.
 */
export function boxesForResponse(doc: DocLike, boxes: Box[], depth: number, root?: string): BoxTuple[] {
  const out: BoxTuple[] = [];
  const top = root ?? doc.root_node_id;
  for (const b of boxes) {
    if (b.id === top) {
      out.push([b.id, b.type, b.x, b.y, b.w, b.h]);
      continue;
    }
    if (!doc.nodes[b.id]) continue;
    const chain = ancestors(doc, b.id);
    const at = chain.indexOf(top);
    if (at === -1) continue; // not under the framed node (never happens for ROOT)
    if (at + 1 <= depth) out.push([b.id, b.type, b.x, b.y, b.w, b.h]);
  }
  return out;
}
