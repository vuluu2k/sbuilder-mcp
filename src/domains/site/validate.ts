import { childrenOf, subtreeIds, type DocLike } from '../../core/tree.js';
import { checkBandOrder } from './traps.js';
import type { PageDoc } from './document.js';

/**
 * Everything that would make the platform refuse this document on save.
 *
 * Each check mirrors one the server runs. Running them here turns a silent
 * failure — an autosave rejected twenty minutes ago, with the agent still
 * happily editing a tree nobody will ever store — into a refusal at the call
 * that caused it.
 *
 * Returns an empty array when the document is storable.
 */
export function validateForSave(doc: PageDoc): string[] {
  const d: DocLike = doc.doc;
  const problems: string[] = [];

  const band = checkBandOrder(d);
  if (band) problems.push(band);

  // Dangling child ids: a parent naming a node that is not in the map. The
  // renderer walks children by id, so this is a hole in the rendered page.
  for (const [id, n] of Object.entries(d.nodes)) {
    for (const kid of n.data.nodes) {
      if (!d.nodes[kid]) {
        problems.push(`Node ${id} lists child "${kid}", which is not in the document.`);
      }
    }
  }

  // Parent pointers that disagree with the child lists. BOTH are stored, and the
  // renderer trusts the child list while a move trusts the pointer — so a
  // disagreement renders one tree and edits another.
  for (const [id, n] of Object.entries(d.nodes)) {
    if (id === d.root_node_id) continue;
    const p = n.data.parent;
    if (p && d.nodes[p] && !childrenOf(d, p).includes(id)) {
      problems.push(`Node ${id} claims parent ${p}, but ${p} does not list it as a child.`);
    }
  }

  // Orphans: reachable from nobody. They bloat every save and never render.
  // Walking from ROOT covers overlays too — they are composed onto ROOT's child
  // list, so they are reachable and correctly not reported here.
  const reachable = new Set(subtreeIds(d, d.root_node_id));
  for (const id of Object.keys(d.nodes)) {
    if (!reachable.has(id)) {
      problems.push(`Node ${id} is unreachable from ROOT — nothing references it.`);
    }
  }

  return problems;
}
