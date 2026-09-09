import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree, setKeys } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';
import {
  hoverHome,
  hoverHostOf,
  hoverRoutingNote,
  isSatelliteNode,
} from '../src/domains/site/hover.js';
import { HOVER_HOMES } from '../src/catalog/elements.generated.js';

/** A card with a button and an image inside it — the shape the feature is for. */
function card() {
  const d = PageDoc.from({
    schema_version: 2,
    root_node_id: 'rt',
    nodes: {
      rt: { id: 'rt', data: { type: 'root', parent: null, nodes: [] }, style: {}, config: {}, specials: {}, responsive: {} },
    },
  });
  const { patches, ids } = addSubtree(d, 'rt', {
    type: 'flex-section',
    children: [{ type: 'flex-block', children: [{ type: 'image' }, { type: 'button' }] }],
  });
  d.apply(patches);
  const [section, block, image, button] = ids;
  return { d, section, block, image, button };
}

describe('HOVER_HOMES', () => {
  // Twelve element types declare a Hover variant at the 2026-09-09 regen, and
  // the meta's own `storage` field says which of them keep it in the node and
  // which in the legacy flat map. Derived from that field rather than from
  // reading the Go renderers — the first draft did the latter, concluded no
  // element compiles states.hover, and was wrong about six of them.
  it('reads each Hover-variant element\'s declared storage', () => {
    expect(Object.keys(HOVER_HOMES).length).toBeGreaterThanOrEqual(8);
    expect(hoverHome('flex-block')).toBe('state'); // the universal state serves it
    expect(hoverHome('button')).toBe('legacy'); // config.stateHover, base-only
    expect(hoverHome('tab-item')).toBe('state'); // compiled by its owner's skin
    expect(hoverHome('filter-tag')).toBe('state');
  });

  // Measured, not derived: nothing in the metas says which slots a renderer
  // actually reads.
  it('names the element that promises states.hover and paints nothing', () => {
    expect(hoverRoutingNote('product-image-list')).toMatch(/paints nothing/);
    expect(hoverHome('product-image-list')).toBe('state');
  });
});

/**
 * The measured defect: the same write, on the same publish, produced a rule on
 * the card and nothing on the button inside it.
 */
describe('sb_set state:"hover" routing', () => {
  it('writes the universal state slot for an ordinary element', () => {
    const { d, block } = card();
    const patches = setKeys(d, block, { boxShadow: '0 8px 24px #0002' }, { namespace: 'style', state: 'hover', base: true });
    expect(patches[0].path).toEqual(['nodes', block, 'states', 'hover', 'style', 'boxShadow']);
  });

  it('routes a BUTTON to the flat map its own renderer compiles', () => {
    const { d, button } = card();
    const patches = setKeys(d, button, { backgroundColor: '#D33F65' }, { namespace: 'style', state: 'hover', base: true });
    expect(patches[0].path).toEqual(['nodes', button, 'config', 'stateHover', 'backgroundColor']);
  });

  it('says where it went, and that the flat map is base-only', () => {
    const note = hoverRoutingNote('button');
    expect(note).toMatch(/stateHover/);
    expect(note).toMatch(/BASE-ONLY/i);
    expect(hoverRoutingNote('flex-block')).toBeNull();
    // A satellite's hover is compiled by its owner from the node slot, and a
    // filter's by its own option skin — nothing to route for either.
    expect(hoverRoutingNote('tab-item')).toBeNull();
    expect(hoverRoutingNote('filter-tag')).toBeNull();
  });

  it('unsets through the same routing rather than leaving the key behind', () => {
    const { d, button } = card();
    const patches = setKeys(d, button, {}, { namespace: 'style', state: 'hover', base: true, unset: ['backgroundColor'] });
    expect(patches).toEqual([
      { op: 'unset', path: ['nodes', button, 'config', 'stateHover', 'backgroundColor'] },
    ]);
  });
});

/**
 * `parentHover` is universal on every element, but it keys off the node's PARENT
 * — and three structural cases give it nothing to key off.
 */
describe('sb_set state:"parentHover"', () => {
  it('resolves the host to the node\'s own parent', () => {
    const { d, block, image } = card();
    expect(hoverHostOf(d.doc, image)).toBe(block);
  });

  it('accepts a child of a real box', () => {
    const { d, image, block } = card();
    const patches = setKeys(d, image, { transform: 'scale(1.05)' }, { namespace: 'style', state: 'parentHover', base: true });
    expect(patches[0].path).toEqual(['nodes', image, 'states', 'parentHover', 'style', 'transform']);
    expect(hoverHostOf(d.doc, image)).toBe(block);
  });

  // The pointer is inside the page whenever it is inside the window.
  it('refuses a direct child of ROOT, naming why', () => {
    const { d, section } = card();
    expect(hoverHostOf(d.doc, section)).toBeNull();
    expect(() =>
      setKeys(d, section, { opacity: '0.9' }, { namespace: 'style', state: 'parentHover', base: true }),
    ).toThrow(/ROOT/);
  });

  it('refuses a satellite, and points at its own hover instead', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section' }).patches);
    const section = d.outline()[0].id;
    d.apply(addSubtree(d, section, { type: 'list-dataset' }).patches);
    const list = d.outline({ depth: 2 })[0].kids![0].id;
    const empty = (d.node(list) as never as { config: Record<string, string> }).config.emptyStateId;
    expect(empty).toBeTruthy();
    expect(isSatelliteNode(d.doc, empty)).toBe(true);
    expect(() =>
      setKeys(d, empty, { opacity: '0.9' }, { namespace: 'style', state: 'parentHover', base: true }),
    ).toThrow(/SATELLITE/i);
  });

  it('takes config.hidden true and refuses the rest', () => {
    const { d, image } = card();
    expect(() => setKeys(d, image, { hidden: true }, { namespace: 'config', state: 'parentHover' })).not.toThrow();
    expect(() => setKeys(d, image, { hidden: false }, { namespace: 'config', state: 'parentHover' })).toThrow(/only true/i);
    expect(() => setKeys(d, image, { gap: '4px' }, { namespace: 'config', state: 'hover' })).toThrow(/read by no compiler/);
  });
});

describe('config.revealOnHover', () => {
  it('is allowed inside a real box', () => {
    const { d, button } = card();
    expect(() => setKeys(d, button, { revealOnHover: true }, { namespace: 'config' })).not.toThrow();
  });

  it('is refused where there is nothing to hover, so the element cannot stay silently visible', () => {
    const { d, section } = card();
    expect(() => setKeys(d, section, { revealOnHover: true }, { namespace: 'config' })).toThrow(
      /stay visible/i,
    );
  });
});

/**
 * Every site this server built before it learned about the second home carries
 * these — on buttons, which is the single most common thing anyone gives a hover
 * to. The review has to find them, because nothing on the page will.
 */
describe('sb_review hover_dead', () => {
  it('reports a hover stored where the element\'s renderer does not look', () => {
    const { d, button } = card();
    // Written the way this server used to write it, before the routing existed.
    d.apply([
      { op: 'set', path: ['nodes', button, 'states', 'hover', 'style', 'backgroundColor'], value: '#D33F65' },
    ]);
    const f = reviewDesign(d).find((x) => x.code === 'hover_dead');
    expect(f?.nodeId).toBe(button);
    expect(f?.fix).toMatch(/clears the slot nobody reads/);
  });

  it('says nothing about an element the universal state serves', () => {
    const { d, block } = card();
    d.apply(setKeys(d, block, { boxShadow: '0 2px 8px #0002' }, { namespace: 'style', state: 'hover', base: true }));
    expect(reviewDesign(d).some((x) => x.code === 'hover_dead')).toBe(false);
  });

  it('says nothing once the value is written through the routing', () => {
    const { d, button } = card();
    d.apply(setKeys(d, button, { backgroundColor: '#D33F65' }, { namespace: 'style', state: 'hover', base: true }));
    expect(reviewDesign(d).some((x) => x.code === 'hover_dead')).toBe(false);
  });
});

/**
 * A repair that fixed the look and left the dead copy behind would keep the
 * finding standing — and the fix that finding names would still be unreachable,
 * which is the shape this repo has closed twice now.
 */
describe('routing a hover also clears the slot nobody reads', () => {
  it('writes the working home and unsets the dead one in the same call', () => {
    const { d, button } = card();
    d.apply([
      { op: 'set', path: ['nodes', button, 'states', 'hover', 'style', 'backgroundColor'], value: '#D33F65' },
      { op: 'set', path: ['nodes', button, 'responsive', 'mobile', 'states', 'hover', 'style', 'color'], value: '#fff' },
    ]);
    expect(reviewDesign(d).some((f) => f.code === 'hover_dead')).toBe(true);

    d.apply(setKeys(d, button, { backgroundColor: '#D33F65' }, { namespace: 'style', state: 'hover', base: true }));
    const n = d.node(button) as never as {
      config: Record<string, Record<string, unknown>>;
      states?: Record<string, unknown>;
      responsive?: Record<string, { states?: Record<string, unknown> }>;
    };
    expect(n.config.stateHover.backgroundColor).toBe('#D33F65');
    expect(n.states?.hover).toBeUndefined();
    expect(n.responsive?.mobile?.states?.hover).toBeUndefined();
    expect(reviewDesign(d).some((f) => f.code === 'hover_dead')).toBe(false);
  });

  it('leaves an element the universal state serves entirely alone', () => {
    const { d, block } = card();
    d.apply(setKeys(d, block, { boxShadow: '0 2px 8px #0002' }, { namespace: 'style', state: 'hover', base: true }));
    const n = d.node(block) as never as { states: Record<string, { style: Record<string, unknown> }> };
    expect(n.states.hover.style.boxShadow).toBe('0 2px 8px #0002');
  });
});
