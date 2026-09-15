import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { reviewDesign } from '../src/domains/site/review.js';

type Kid = { type: string; children?: Kid[] };

/**
 * A composed page, written out literally.
 *
 * NOT through `addSubtree`: the builder REFUSES specials.globalId, correctly —
 * that stamp is the server's, and writing it from a document decomposes the node
 * over the shared master. But a composed page is exactly what the review reads,
 * and `bandOf` reads the band off that stamp, so the fixture has to be the thing
 * the server produces rather than the thing a caller may write.
 */
function page(headerInner: Kid, middleInner?: Kid) {
  const nodes: Record<string, unknown> = {};
  let n = 0;
  const add = (spec: Kid, parent: string): string => {
    const id = `n${++n}`;
    const kids = (spec.children ?? []).map((k) => add(k, id));
    nodes[id] = {
      id,
      data: { type: spec.type, parent, nodes: kids, isCanvas: true, hidden: false, custom: {} },
      style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [],
    };
    return id;
  };
  const sections: string[] = [];
  const header = add({ type: 'flex-section', children: [headerInner] }, 'rt');
  (nodes[header] as { specials: Record<string, unknown> }).specials = {
    globalId: 'g_hdr',
    globalKind: 'header',
  };
  sections.push(header);
  if (middleInner) sections.push(add({ type: 'flex-section', children: [middleInner] }, 'rt'));
  nodes.rt = {
    id: 'rt',
    data: { type: 'root', parent: null, nodes: sections, isCanvas: true, hidden: false, custom: {} },
    style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [],
  };
  return PageDoc.from({ schema_version: 2, root_node_id: 'rt', nodes } as never);
}

const menus = (d: PageDoc) => reviewDesign(d).filter((f) => f.code === 'handbuilt_menu');
const row = (n: number): Kid => ({
  type: 'flex-block',
  children: Array.from({ length: n }, () => ({ type: 'button' })),
});

describe('sb_review handbuilt_menu', () => {
  // THE MEASURED CASE. A store built with these tools shipped a header whose
  // navigation was six buttons in a flex-block — correct on a desktop canvas,
  // no drawer at all on a phone, and nothing anywhere said so.
  it('reports a row of buttons standing in for a navigation in the header', () => {
    const f = menus(page(row(6)))[0];
    expect(f).toBeTruthy();
    expect(f.problem).toMatch(/6 buttons/);
    expect(f.fix).toMatch(/menu-drawer/);
    expect(f.fix).toMatch(/hamburger-menu/);
  });

  it('fires at three, the point where a row stops being a pair of calls to action', () => {
    expect(menus(page(row(3)))).toHaveLength(1);
    expect(menus(page(row(2)))).toHaveLength(0);
  });

  // DELIBERATELY NARROW — each of these is a shape the check must NOT claim.
  it('leaves a middle-band row alone: only a header navigation loses its drawer', () => {
    expect(menus(page({ type: 'flex-block', children: [{ type: 'text' }] }, row(6)))).toHaveLength(0);
  });

  it('leaves a header row that is not all buttons — that is an actions cluster', () => {
    const actions: Kid = {
      type: 'flex-block',
      children: [{ type: 'button' }, { type: 'button' }, { type: 'button' }, { type: 'icon' }],
    };
    expect(menus(page(actions))).toHaveLength(0);
  });

  it('leaves buttons that are containers of something, which are not links in a row', () => {
    const nested: Kid = {
      type: 'flex-block',
      children: [
        { type: 'button', children: [{ type: 'icon' }] },
        { type: 'button', children: [{ type: 'icon' }] },
        { type: 'button', children: [{ type: 'icon' }] },
      ],
    };
    expect(menus(page(nested))).toHaveLength(0);
  });

  // THE LIVENESS ANCHOR. Four of the assertions above are that NOTHING is
  // reported; this is what proves the fixture can still report.
  it('still reports on the same fixture shape when the row IS a plain header nav', () => {
    const d = page(row(4), { type: 'flex-block', children: [{ type: 'text' }] });
    expect(menus(d)).toHaveLength(1);
  });
});
