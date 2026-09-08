import { describe, it, expect } from 'vitest';
import { restampPatches } from '../src/domains/site/traps.js';
import type { DocLike } from '../src/core/tree.js';

/**
 * THE OPTIMISTIC FENCE ON A SHARED MASTER.
 *
 * Compose stamps `specials.globalRev` / `specials.overlayRev` on the node it
 * materialises, the save sends that back as `expectRev`, and the platform
 * refuses a stale one — with a warning, and a 200. So a client that never
 * re-stamps lands its FIRST edit to a shared header or to the cart drawer and
 * silently drops every edit after it, in the same session, while reporting
 * success on each.
 *
 * Measured before the fix: two `sb_remove` calls against the cart drawer. The
 * first removed its subtree; the second answered `{"removed": …}` and changed
 * nothing, and the drawer went on rendering the node in the browser.
 */
function doc(nodes: Record<string, { specials: Record<string, unknown> }>): DocLike {
  return {
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: {
      ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: [] }, specials: {} },
      ...Object.fromEntries(
        Object.entries(nodes).map(([id, n]) => [
          id,
          { id, data: { type: 'flex-section', parent: 'ROOT', nodes: [] }, specials: n.specials },
        ]),
      ),
    },
  } as unknown as DocLike;
}

describe('restampPatches()', () => {
  it('advances a global section to the revision the save reported', () => {
    const d = doc({ hd: { specials: { globalId: 'gs_1', globalRev: 3 } } });
    const p = restampPatches(d, { globals: [{ id: 'gs_1', rev: 4 }] });
    expect(p).toEqual([{ op: 'set', path: ['nodes', 'hd', 'specials', 'globalRev'], value: 4 }]);
  });

  it('advances an overlay on its own key', () => {
    const d = doc({ dr: { specials: { overlayId: 'ov_1', overlayRev: 1 } } });
    const p = restampPatches(d, { overlays: [{ id: 'ov_1', rev: 2 }] });
    expect(p).toEqual([{ op: 'set', path: ['nodes', 'dr', 'specials', 'overlayRev'], value: 2 }]);
  });

  it('writes nothing when the fence has not moved', () => {
    const d = doc({ hd: { specials: { globalId: 'gs_1', globalRev: 4 } } });
    expect(restampPatches(d, { globals: [{ id: 'gs_1', rev: 4 }] })).toEqual([]);
  });

  it('leaves a master the report does not mention alone', () => {
    // Inventing a revision for a master this save did not touch is how a fence
    // stops being one.
    const d = doc({
      hd: { specials: { globalId: 'gs_1', globalRev: 3 } },
      ft: { specials: { globalId: 'gs_2', globalRev: 9 } },
    });
    const p = restampPatches(d, { globals: [{ id: 'gs_1', rev: 4 }] });
    expect(p.map((x) => x.path[1])).toEqual(['hd']);
  });

  it('is silent on a page that carries no shared master', () => {
    const d = doc({ sec: { specials: {} } });
    expect(restampPatches(d, { globals: [{ id: 'gs_1', rev: 4 }] })).toEqual([]);
    expect(restampPatches(d, {})).toEqual([]);
  });

  it('stamps every node carrying the same master', () => {
    const d = doc({
      a: { specials: { globalId: 'gs_1', globalRev: 1 } },
      b: { specials: { globalId: 'gs_1', globalRev: 1 } },
    });
    const p = restampPatches(d, { globals: [{ id: 'gs_1', rev: 2 }] });
    expect(p).toHaveLength(2);
  });
});
