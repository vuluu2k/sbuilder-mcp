import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { attachedGlobals, positionFor } from '../src/tools/chrome.js';
import { validateForSave } from '../src/domains/site/validate.js';

/**
 * ATTACHING A SHARED SECTION WAS HAND-WORK, and the hand-work has a trap in it.
 *
 * A page REFERENCES a master with `specials.globalRef` + `globalKind`; the
 * server composes the master onto the page on read and stamps the result
 * `specials.globalId`. Writing the COMPOSED stamp instead makes the next save
 * DECOMPOSE that node over the master and empty it for every page carrying it
 * — four pages went blank here before `sb_add` and `sb_set` learned to refuse
 * it, and until `sb_store action:"global_attach"` existed, hand-writing the
 * reference was the only way to put an existing header on a page.
 *
 * Measured on the storefront this was written against: seven of twenty-four
 * pages carried neither the header nor the footer while both masters existed.
 */

/**
 * `globalId` is applied as a RAW PATCH, never through `addSubtree`, and that
 * is not a test convenience — `refuseComposedStamp` refuses the composed stamp
 * at every authoring door, which is the guard four blank pages bought. A
 * composed node arrives from the SERVER, so a fixture standing in for one has
 * to arrive the same way.
 */
function page(kids: Array<{ globalId?: string; globalRef?: string; kind?: string }>): PageDoc {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  for (const k of kids) {
    const specials: Record<string, unknown> = {};
    if (k.globalRef) specials.globalRef = k.globalRef;
    if (k.kind) specials.globalKind = k.kind;
    const { patches, ids } = addSubtree(d, 'ROOT', { type: 'flex-section', specials });
    d.apply(patches);
    if (k.globalId) {
      d.apply([{ op: 'set', path: ['nodes', ids[0], 'specials', 'globalId'], value: k.globalId }]);
    }
  }
  return d;
}

describe('which masters a page already carries', () => {
  /**
   * BOTH STAMPS, and this is the whole reason it is a function. A page read
   * back from the server carries `globalId`; a reference this session wrote
   * and has not saved carries `globalRef`. Knowing only one of them lets a
   * caller attach the same master twice — which `validateForSave` then refuses
   * with a message about duplicate stamps, blaming a reasonable-looking write.
   */
  it('reads the composed stamp and the stored reference alike', () => {
    const d = page([
      { globalId: 'gs_header', kind: 'header' },
      { globalRef: 'gs_footer', kind: 'footer' },
      {},
    ]);
    expect(attachedGlobals(d.doc).map((g) => g.globalId)).toEqual(['gs_header', 'gs_footer']);
  });

  it('says nothing about a page that shares nothing', () => {
    expect(attachedGlobals(page([{}, {}]).doc)).toEqual([]);
  });

  /** Only a DIRECT child of ROOT may be one — the platform refuses the rest. */
  it('does not go looking below ROOT', () => {
    const d = page([{}]);
    const section = d.node('ROOT').data.nodes[0];
    const made = addSubtree(d, section, { type: 'flex-block' });
    d.apply(made.patches);
    d.apply([{ op: 'set', path: ['nodes', made.ids[0], 'specials', 'globalId'], value: 'gs_x' }]);
    expect(attachedGlobals(d.doc)).toEqual([]);
    // And the save gate is the one that refuses it, so the two agree.
    expect(validateForSave(d).join(' ')).toContain('not a direct child of ROOT');
  });
});

describe('where a reference has to go', () => {
  /**
   * TRAP 3, and it is a refusal rather than a preference: ROOT's children must
   * read [header*][middle*][footer*] and the platform refuses EVERY save
   * otherwise. Compose turns the reference into a real band, so the index the
   * reference takes is the index the band will have.
   */
  it('puts a header first and a footer last', () => {
    const d = page([{}, {}]);
    expect(positionFor(d.doc, 'header')).toBe(0);
    expect(positionFor(d.doc, 'footer')).toBe(2);
  });

  it('puts anything else at the end of the middle band, ahead of a footer', () => {
    const d = page([{ globalId: 'gs_h', kind: 'header' }, {}, { globalId: 'gs_f', kind: 'footer' }]);
    expect(positionFor(d.doc, 'section')).toBe(2);
  });

  /** A header appended at the end is a band_order refusal on the next save. */
  it('produces a document the save gate accepts', () => {
    const d = page([{}, { globalId: 'gs_f', kind: 'footer' }]);
    const at = positionFor(d.doc, 'header');
    d.apply(
      addSubtree(
        d,
        'ROOT',
        { type: 'flex-section', specials: { globalRef: 'gs_h', globalKind: 'header' } },
        at,
      ).patches,
    );
    expect(validateForSave(d)).toEqual([]);
  });

  it('and the wrong index would not — which is what makes the rule load-bearing', () => {
    const d = page([{}, { globalId: 'gs_f', kind: 'footer' }]);
    d.apply(
      addSubtree(
        d,
        'ROOT',
        { type: 'flex-section', specials: { globalRef: 'gs_h', globalKind: 'header' } },
      ).patches,
    );
    expect(validateForSave(d).join(' ')).toMatch(/header|band/i);
  });
});
