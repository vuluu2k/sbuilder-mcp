import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree, setKeys } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';
import {
  isPinnedNode,
  stuckHostOf,
  stickyBlockedBy,
  stickySeeds,
  stickyWarning,
} from '../src/domains/site/sticky.js';

/** A header section with a logo inside it — the shape the feature is for. */
function page() {
  const d = PageDoc.from({
    schema_version: 2,
    root_node_id: 'rt',
    nodes: {
      rt: {
        id: 'rt',
        data: { type: 'root', parent: null, nodes: [] },
        style: {},
        config: {},
        specials: {},
        responsive: {},
      },
    },
  });
  const { patches, ids } = addSubtree(d, 'rt', {
    type: 'flex-section',
    children: [{ type: 'flex-block', children: [{ type: 'heading' }] }],
  });
  d.apply(patches);
  const [section, block, logo] = ids;
  return { d, section, block, logo };
}

function pin(d: PageDoc, id: string, position: string, bp?: string) {
  d.apply(
    setKeys(d, id, { position }, bp ? { namespace: 'style', breakpoint: bp as never } : { namespace: 'style', base: true }),
  );
}

describe('isPinnedNode() / stuckHostOf()', () => {
  it('a pinned section is its own stuck host, and so is every node under it', () => {
    const { d, section, logo } = page();
    expect(stuckHostOf(d.doc, logo)).toBeNull();
    pin(d, section, 'sticky');
    expect(stuckHostOf(d.doc, section)).toBe(section);
    expect(stuckHostOf(d.doc, logo)).toBe(section);
  });

  // Breakpoint-agnostic on purpose: the class only ever appears while the
  // element is genuinely stuck, which the island re-decides per viewport, so a
  // header pinned at mobile alone still compiles its stuck rules everywhere.
  it('a position declared at one breakpoint alone still pins', () => {
    const { d, section, logo } = page();
    pin(d, section, 'sticky', 'mobile');
    expect(isPinnedNode(d.node(section) as never)).toBe(true);
    expect(stuckHostOf(d.doc, logo)).toBe(section);
  });

  it('fixed pins and absolute does not — absolute scrolls away with the page', () => {
    const { d, section, logo } = page();
    pin(d, section, 'fixed');
    expect(stuckHostOf(d.doc, logo)).toBe(section);
    const other = page();
    pin(other.d, other.section, 'absolute');
    expect(stuckHostOf(other.d.doc, other.logo)).toBeNull();
  });

  it('the NEAREST pinned ancestor is the host', () => {
    const { d, section, block, logo } = page();
    pin(d, section, 'sticky');
    pin(d, block, 'sticky');
    expect(stuckHostOf(d.doc, logo)).toBe(block);
  });
});

/**
 * The refusal that matters most. `render/css.go` emits stuck rules only under a
 * stuck host, so this write is stored, saved, published and never painted.
 */
describe('sb_set state:"stuck"', () => {
  it('refuses an override with nothing pinned, and names the fix', () => {
    const { d, logo, block } = page();
    expect(() =>
      setKeys(d, logo, { fontSize: '14px' }, { namespace: 'style', state: 'stuck' }),
    ).toThrow(/position: "sticky"/);
    // …and names the node to pin, not just the rule.
    expect(() =>
      setKeys(d, logo, { fontSize: '14px' }, { namespace: 'style', state: 'stuck' }),
    ).toThrow(new RegExp(block));
  });

  it('accepts a descendant once the section it lives in pins', () => {
    const { d, section, logo } = page();
    pin(d, section, 'sticky');
    const patches = setKeys(d, logo, { fontSize: '14px' }, { namespace: 'style', state: 'stuck' });
    expect(patches[0].path).toEqual([
      'nodes',
      logo,
      'responsive',
      'desktop',
      'states',
      'stuck',
      'style',
      'fontSize',
    ]);
  });

  it('writes the base slot when asked, which is where a state is usually edited', () => {
    const { d, section } = page();
    pin(d, section, 'sticky');
    const patches = setKeys(
      d,
      section,
      { boxShadow: '0 2px 8px #0002' },
      { namespace: 'style', state: 'stuck', base: true },
    );
    expect(patches[0].path).toEqual(['nodes', section, 'states', 'stuck', 'style', 'boxShadow']);
  });

  // `stuckDecls` translates exactly one config key. Everything else in that slot
  // is stored by the document and read by no compiler.
  it('takes config.hidden true — the one key the state translates', () => {
    const { d, section, logo } = page();
    pin(d, section, 'sticky');
    expect(() =>
      setKeys(d, logo, { hidden: true }, { namespace: 'config', state: 'stuck' }),
    ).not.toThrow();
  });

  it('refuses hidden:false, which would need display:revert', () => {
    const { d, section, logo } = page();
    pin(d, section, 'sticky');
    expect(() =>
      setKeys(d, logo, { hidden: false }, { namespace: 'config', state: 'stuck' }),
    ).toThrow(/only true/i);
  });

  it('refuses any other config key in a stuck slot', () => {
    const { d, section, logo } = page();
    pin(d, section, 'sticky');
    expect(() =>
      setKeys(d, logo, { gap: '4px' }, { namespace: 'config', state: 'stuck' }),
    ).toThrow(/read by no compiler/);
  });
});

/**
 * The seeds. The editor writes all three keys the moment an author picks "Stick
 * on scroll"; an agent that wrote only `position` shipped a header the page
 * paints over — measured in Chromium by the platform.
 */
describe('stickySeeds()', () => {
  it('seeds the offset and the layer order alongside position: sticky', () => {
    const { d, section } = page();
    const patches = setKeys(d, section, { position: 'sticky' }, { namespace: 'style', base: true });
    const wrote = Object.fromEntries(patches.map((p) => [p.path[p.path.length - 1], p.value]));
    expect(wrote).toEqual({ position: 'sticky', top: '0px', zIndex: '10' });
  });

  it("never overwrites the caller's own answer", () => {
    const { d, section } = page();
    const patches = setKeys(
      d,
      section,
      { position: 'sticky', top: '64px', zIndex: '5' },
      { namespace: 'style', base: true },
    );
    const wrote = Object.fromEntries(patches.map((p) => [p.path[p.path.length - 1], p.value]));
    expect(wrote.top).toBe('64px');
    expect(wrote.zIndex).toBe('5');
  });

  it('leaves a bottom-pinned bar alone rather than nailing it to the ceiling', () => {
    const { d, section } = page();
    const patches = setKeys(
      d,
      section,
      { position: 'sticky', bottom: '0px' },
      { namespace: 'style', base: true },
    );
    const wrote = Object.fromEntries(patches.map((p) => [p.path[p.path.length - 1], p.value]));
    expect(wrote.top).toBeUndefined();
    expect(wrote.zIndex).toBe('10');
  });

  it('respects a value the node already carries', () => {
    const { d, section } = page();
    d.apply(setKeys(d, section, { zIndex: '3' }, { namespace: 'style', base: true }));
    expect(stickySeeds(d.node(section) as never, { position: 'sticky' })).toEqual({ top: '0px' });
  });

  it('seeds nothing for fixed — that arrives as a deliberate placement', () => {
    const { d, section } = page();
    const patches = setKeys(d, section, { position: 'fixed' }, { namespace: 'style', base: true });
    expect(patches.length).toBe(1);
  });
});

/**
 * The blocker. Sticky resolves against its nearest SCROLLING ancestor, so a
 * clipping one becomes that ancestor and the node pins inside a box that never
 * scrolls: nothing on screen, nothing in the log.
 */
describe('stickyBlockedBy() / stickyWarning()', () => {
  it('names the clipping ancestor', () => {
    const { d, section, block, logo } = page();
    d.apply(setKeys(d, section, { overflowX: 'hidden' }, { namespace: 'style', base: true }));
    pin(d, block, 'sticky');
    expect(stickyBlockedBy(d.doc, block)).toBe(section);
    expect(stickyWarning(d.doc, block)).toContain(section);
    expect(stickyBlockedBy(d.doc, logo)).toBe(section);
  });

  it('never blames the sticky node for its OWN overflow — that clips its children', () => {
    const { d, block } = page();
    pin(d, block, 'sticky');
    d.apply(setKeys(d, block, { overflowY: 'auto' }, { namespace: 'style', base: true }));
    expect(stickyBlockedBy(d.doc, block)).toBeNull();
    expect(stickyWarning(d.doc, block)).toBeNull();
  });

  // An allowlist of the clipping values, not `!== 'visible'`: an unknown or
  // misspelled value must not produce a warning nobody can act on.
  it('reads visible and an unknown value as no clip', () => {
    const { d, section, block } = page();
    pin(d, block, 'sticky');
    d.apply(setKeys(d, section, { overflowX: 'visible' }, { namespace: 'style', base: true }));
    expect(stickyBlockedBy(d.doc, block)).toBeNull();
    d.apply(setKeys(d, section, { overflowX: 'nonsense' }, { namespace: 'style', base: true }));
    expect(stickyBlockedBy(d.doc, block)).toBeNull();
  });

  it('says nothing about a node that is not sticky', () => {
    const { d, section, block } = page();
    d.apply(setKeys(d, section, { overflowY: 'scroll' }, { namespace: 'style', base: true }));
    expect(stickyWarning(d.doc, block)).toBeNull();
  });

  // A clip declared only at mobile blocks only at mobile.
  it('reads the breakpoint it is asked about', () => {
    const { d, section, block } = page();
    pin(d, block, 'sticky');
    d.apply(setKeys(d, section, { overflowY: 'hidden' }, { namespace: 'style', breakpoint: 'mobile' }));
    expect(stickyBlockedBy(d.doc, block, 'mobile')).toBe(section);
    expect(stickyBlockedBy(d.doc, block, 'desktop')).toBeNull();
  });
});

/**
 * The review half. `sb_set` refuses a hostless stuck override at write time, but
 * a document reaches the reviewer by other roads — an import, a template, or a
 * later edit that un-pinned the host and left the overrides behind.
 */
describe('sb_review sticky findings', () => {
  it('reports a pinned node whose ancestor clips', () => {
    const { d, section, block } = page();
    d.apply(setKeys(d, section, { overflowY: 'hidden' }, { namespace: 'style', base: true }));
    pin(d, block, 'sticky');
    const f = reviewDesign(d).find((x) => x.code === 'sticky_blocked');
    expect(f?.nodeId).toBe(block);
    expect(f?.key).toBe(section);
  });

  it('says nothing about a FIXED node under a clip — the viewport is not an ancestor', () => {
    const { d, section, block } = page();
    d.apply(setKeys(d, section, { overflowY: 'hidden' }, { namespace: 'style', base: true }));
    pin(d, block, 'fixed');
    expect(reviewDesign(d).some((x) => x.code === 'sticky_blocked')).toBe(false);
  });

  it('reports a stuck override left behind when the host was un-pinned', () => {
    const { d, section, logo } = page();
    pin(d, section, 'sticky');
    d.apply(setKeys(d, logo, { fontSize: '12px' }, { namespace: 'style', state: 'stuck' }));
    expect(reviewDesign(d).some((x) => x.code === 'stuck_no_host')).toBe(false);
    // The section stops pinning; the override on the logo is now unreachable.
    d.apply(setKeys(d, section, { position: 'relative' }, { namespace: 'style', base: true }));
    const f = reviewDesign(d).find((x) => x.code === 'stuck_no_host');
    expect(f?.nodeId).toBe(logo);
    expect(f?.fix).toMatch(/position/);
  });
});
