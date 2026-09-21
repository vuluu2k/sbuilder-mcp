import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { validateForSave } from '../src/domains/site/validate.js';

/**
 * `sb_review` THREW ON THE DOCUMENT IT EXISTS TO EXPLAIN.
 *
 * A parent whose `data.nodes` names an id the document does not hold is a real,
 * reachable shape: a subtree half-removed, an import that ran out of budget
 * mid-write, a hand-built `sb_api_call`. The review's own recursion pushed the
 * dangling id into its walk order like any other and then read
 * `d.nodes[id].data.type` off `undefined` —
 *
 *     TypeError: Cannot read properties of undefined (reading 'data')
 *
 * — which names no page, no node and nothing to do about it, from the one tool
 * whose entire job is to say what is wrong with the page.
 *
 * `walk()` in core/tree.ts has carried `if (!n) return` from the start. This
 * recursion carries its own scope down (am I inside a repeater, an overlay) and
 * so cannot hand the traversal to `walk` — which is precisely the caller
 * `walk`'s own comment warns will get this wrong.
 */
function docWithDanglingChild(): { d: PageDoc; parent: string; child: string } {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const { patches, ids } = addSubtree(d, 'ROOT', {
    type: 'flex-section',
    children: [{ type: 'heading', specials: { text: 'Thời trang công sở' } }],
  });
  d.apply(patches);
  const parent = ids[0];
  const child = ids[1];
  // Delete the NODE and leave the parent still naming it — the half-removal
  // that produces this in the wild.
  d.apply([{ op: 'unset', path: ['nodes', child] }]);
  return { d, parent, child };
}

describe('a review of a damaged document explains it instead of throwing', () => {
  it('does not throw on a child id that names no node', () => {
    const { d } = docWithDanglingChild();
    expect(() => reviewDesign(d)).not.toThrow();
  });

  it('reports the hole, naming both the parent and the missing child', () => {
    const { d, parent, child } = docWithDanglingChild();
    const f = reviewDesign(d).find((x) => x.code === 'missing_node');
    expect(f).toBeDefined();
    expect(f!.nodeId).toBe(parent);
    expect(f!.problem).toContain(child);
    expect(f!.fix).toContain(child);
  });

  /**
   * The two checks must AGREE. `validateForSave` is what refuses the save; the
   * review is what tells a caller why before they get there. A document one
   * refuses and the other calls clean is how a caller ends up fixing the wrong
   * thing and being blamed for the next command.
   */
  it('agrees with the save gate about the same document', () => {
    const { d, child } = docWithDanglingChild();
    const problems = validateForSave(d);
    expect(problems.join(' ')).toContain(child);
    expect(reviewDesign(d).some((f) => f.code === 'missing_node')).toBe(true);
  });

  it('still reviews the rest of the page rather than stopping at the hole', () => {
    const { d } = docWithDanglingChild();
    // A second, undamaged band with a defect of its own. Before the guard the
    // walk died at the dangling id and this was never reached.
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section' }).patches);
    const codes = reviewDesign(d).map((f) => f.code);
    expect(codes).toContain('missing_node');
    expect(codes).toContain('empty_container');
  });
});
