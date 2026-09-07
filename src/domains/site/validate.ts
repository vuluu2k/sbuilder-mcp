import { subtreeIds, type DocLike } from '../../core/tree.js';
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

  // ATTACHMENT, not reachability — and this distinction was paid for.
  //
  // Two earlier rules lived here: "a parent pointer must agree with the child
  // list", and "every node must be reachable from ROOT through child lists".
  // Both refuse documents THE PLATFORM ITSELF SERVES. A real page carries
  // SATELLITE nodes: `list-empty` and `list-loading` (the empty and loading
  // states of a store listing), `quantity-button` and `quantity-input`,
  // `product-variant-label` and friends. The catalog calls them hidden
  // satellites in as many words. They set `parent` to their owner and are
  // deliberately NOT in that owner's `data.nodes`, because they are rendered in
  // place of, or as part of, the owner rather than beside its children.
  //
  // Measured on a live page after one save: 55 nodes, 16 of them satellites
  // hanging off the composed cart drawer and off a list-dataset. The old rules
  // reported all 16 and refused every subsequent save — so sb_set, sb_bind and
  // sb_look were broken on any real site the moment an overlay or a store
  // listing was on the page, which no offline fixture could show.
  //
  // What is still a real defect is a node attached to NOTHING: neither in
  // ROOT's tree nor hanging off something that is. Those bloat every save and
  // never render, and the platform has no use for them either.
  const reachable = new Set(subtreeIds(d, d.root_node_id));
  const attached = (start: string): boolean => {
    const seen = new Set<string>();
    let cur: string | null = start;
    while (cur && !seen.has(cur)) {
      if (reachable.has(cur)) return true;
      seen.add(cur);
      cur = d.nodes[cur]?.data.parent ?? null;
    }
    return false;
  };
  for (const id of Object.keys(d.nodes)) {
    if (id === d.root_node_id) continue;
    if (!attached(id)) {
      problems.push(
        `Node ${id} is attached to nothing — it is not in ROOT's tree, and its parent chain reaches no node that is.`,
      );
    }
  }

  return problems;
}
