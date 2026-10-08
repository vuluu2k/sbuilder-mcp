import { describe, it, expect } from 'vitest';
import { toSpecs, isTitleBar, type Captured } from '../src/domains/site/importmap.js';
import { LAYOUT_PATTERNS, THEME_TOKENS } from '../src/domains/site/patterns.js';
import { measure } from '../src/vision/measure.js';
import { shoot, type Box } from '../src/vision/shoot.js';
import type { NodeSpec } from '../src/domains/site/builder.js';
import type { DocLike } from '../src/core/tree.js';

/**
 * A HEADING WITH "XEM TẤT CẢ" BESIDE IT came out as two equal halves: the link
 * at the left of the right half (mid-band) and hung from the heading's top edge.
 */

const heading: Captured = { kind: 'heading', level: 2, text: 'Sản phẩm nổi bật' };
const link: Captured = { kind: 'button', variant: 'link', text: 'Xem tất cả', href: '#' };
const bar = (extra: Partial<Captured> = {}): Captured => ({ kind: 'group', direction: 'row', children: [heading, link], ...extra });
const rowOf = (c: Captured): NodeSpec => toSpecs([c], {})[0].children![0].children![0];

describe('the title bar shape', () => {
  it('puts the action on the right edge, on the heading’s centre line, and stacks it flush left on mobile', () => {
    const r = rowOf(bar());
    expect(r.style).toMatchObject({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' });
    expect(r.responsive?.mobile?.style).toMatchObject({ flexDirection: 'column', alignItems: 'flex-start' });
    expect(r.children![1].style).toMatchObject({ flex: '0 0 auto', width: 'auto' });
  });

  it('is recognised for an intro column too, and a packed run of buttons', () => {
    const intro: Captured = { kind: 'group', direction: 'column', children: [{ kind: 'text', text: 'Mới' }, heading] };
    const two: Captured = { kind: 'group', direction: 'row', pack: true, children: [link, link] };
    expect(isTitleBar({ kind: 'group', direction: 'row', children: [intro, two] })).toBe(true);
  });

  it('leaves every other row alone — equal columns, a centred band, a heading beside a picture', () => {
    expect(isTitleBar(bar({ align: 'center' }))).toBe(false);
    expect(isTitleBar(bar({ wrap: true }))).toBe(false);
    expect(isTitleBar({ kind: 'group', direction: 'row', children: [heading, { kind: 'image', src: 'x.jpg' }] })).toBe(false);
    expect(isTitleBar({ kind: 'group', direction: 'row', children: [link, heading] })).toBe(false);
    expect(rowOf(bar({ align: 'center' })).style).not.toHaveProperty('justifyContent');
  });

  it('is what the product shelf pattern now builds', () => {
    const shelf = LAYOUT_PATTERNS.find((p) => p.id === 'sb_product_shelf')!.build(THEME_TOKENS)!;
    const r = shelf.children![0].children![0];
    expect(r.style).toMatchObject({ justifyContent: 'space-between', alignItems: 'center' });
  });
});

// ---------------------------------------------------------------------------
// The spec → a document and HTML, so the same tree feeds the rule and Chrome.

interface Flat { doc: DocLike; html: string; css: string }
function flatten(spec: NodeSpec): Flat {
  const nodes: DocLike['nodes'] = {};
  let n = 0;
  let css = '';
  const kebab = (o: Record<string, unknown>) =>
    Object.entries(o).map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${String(v)}`).join(';');
  const visit = (s: NodeSpec, parent: string | null): { id: string; html: string } => {
    const id = `nd_${(n++).toString(16).padStart(8, '0')}`;
    const kids = (s.children ?? []).map((k) => visit(k, id));
    nodes[id] = {
      id,
      data: { type: s.type, parent, nodes: kids.map((k) => k.id) },
      specials: (s.specials ?? {}) as Record<string, unknown>,
      ...({ style: s.style, responsive: s.responsive } as object),
    };
    const mobile = s.responsive?.mobile?.style;
    if (mobile) css += `@media (max-width:767px){#${id}{${kebab(mobile).replace(/;/g, '!important;')}!important}}`;
    const text = String((s.specials as { text?: string } | undefined)?.text ?? '');
    const tag = s.type === 'heading' ? 'h2' : s.type === 'button' ? 'a' : 'div';
    // A heading's font is the theme's; 36px/1.2 stands in for heading-2.
    const own = s.type === 'heading' ? 'margin:0;font:600 36px/1.2 sans-serif;' : s.type === 'button' ? 'display:block;font:500 16px/1.5 sans-serif;' : '';
    return { id, html: `<${tag} id="${id}" class="wb-${s.type}" style="${own}${kebab(s.style ?? {})}">${text}${kids.map((k) => k.html).join('')}</${tag}>` };
  };
  const top = visit(spec, null);
  nodes.ROOT = { id: 'ROOT', data: { type: 'root', parent: null, nodes: [top.id] }, specials: {} };
  nodes[top.id].data.parent = 'ROOT';
  return { doc: { schema_version: 1, root_node_id: 'ROOT', nodes }, html: top.html, css };
}

/** What the mapper built for this shape BEFORE: two equal halves, top-aligned. */
const before: NodeSpec = {
  type: 'flex-block',
  style: { width: '100%', display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'flex-start', gap: '24px' },
  responsive: { mobile: { style: { flexDirection: 'column', gap: '16px' } } },
  children: [
    { type: 'heading', specials: { text: 'Sản phẩm nổi bật' } },
    { type: 'button', specials: { text: 'Xem tất cả' }, style: { width: 'fit-content' } },
  ].map((k) => ({
    type: 'flex-block',
    style: { flex: '1 1 280px', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '12px' },
    responsive: { mobile: { style: { flex: '0 1 auto' } } },
    children: [k as NodeSpec],
  })),
};

function boxRow(doc: DocLike, boxes: Record<string, [number, number, number, number]>): Box[] {
  return Object.entries(boxes).map(([id, [x, y, w, h]]) => ({ id, type: doc.nodes[id]?.data.type ?? 'flex-block', x, y, w, h }));
}

describe('measure() on a title bar', () => {
  const { doc } = flatten(before);
  // nd_0 row, nd_1 heading cell, nd_2 heading, nd_3 action cell, nd_4 link.
  const shot = (width: number, b: Box[]) => ({ width, imageBase64: '', mimeType: 'image/jpeg' as const, boxes: b });

  it('reports a link stranded mid-row and hung from the heading’s top', () => {
    const b = boxRow(doc, {
      nd_00000000: [120, 0, 1200, 44],
      nd_00000001: [120, 0, 588, 44],
      nd_00000002: [120, 0, 588, 44],
      nd_00000003: [732, 0, 588, 24],
      nd_00000004: [732, 0, 90, 24],
    });
    const codes = measure([shot(1440, b)], new Set(), doc).map((f) => `${f.code}@${f.nodeId}`);
    expect(codes).toEqual(['title_bar_stranded@nd_00000004', 'title_bar_offcenter@nd_00000004']);
  });

  it('is silent on the right shape, and on a phone where the pair stacks', () => {
    const right = boxRow(doc, {
      nd_00000000: [120, 0, 1200, 44],
      nd_00000002: [120, 0, 400, 44],
      nd_00000004: [1230, 10, 90, 24],
    });
    const stacked = boxRow(doc, {
      nd_00000000: [16, 0, 358, 80],
      nd_00000002: [16, 0, 358, 44],
      nd_00000004: [16, 56, 90, 24],
    });
    expect(measure([shot(1440, right), shot(390, stacked)], new Set(), doc)).toEqual([]);
  });

  const stranded = (d: DocLike, extra: Record<string, [number, number, number, number]> = {}) =>
    boxRow(d, {
      nd_00000000: [120, 0, 1200, 44],
      nd_00000002: [120, 0, 588, 44],
      nd_00000004: [732, 0, 90, 24],
      ...extra,
    });

  it('is not fooled by a hidden box at the page origin', () => {
    // display:none measures 0x0 at (0,0); in the union it would drag the heading there.
    // nd_2 heading, nd_3 a subtitle hidden at this width, nd_5 the link — all on one line, flush right.
    const sub = flatten({
      type: 'flex-block',
      children: [
        { type: 'flex-block', children: [{ type: 'heading' }, { type: 'text' }] },
        { type: 'flex-block', children: [{ type: 'button' }] },
      ],
    }).doc;
    const b = boxRow(sub, {
      nd_00000000: [120, 400, 1200, 44],
      nd_00000002: [120, 400, 400, 44],
      nd_00000003: [0, 0, 0, 0],
      nd_00000005: [1230, 410, 90, 24],
    });
    expect(measure([shot(1440, b)], new Set(), sub)).toEqual([]);
  });

  it('ignores a text column beside a card that merely CONTAINS a button', () => {
    const split = flatten({
      type: 'flex-block',
      children: [
        { type: 'heading', specials: { text: 'Về chúng tôi' } },
        { type: 'flex-block', children: [{ type: 'image' }, { type: 'button', specials: { text: 'Mua' } }] },
      ],
    }).doc;
    const b = boxRow(split, {
      nd_00000000: [120, 0, 1200, 400],
      nd_00000001: [120, 0, 588, 44],
      nd_00000003: [732, 0, 400, 300],
      nd_00000004: [732, 320, 90, 24],
    });
    expect(measure([shot(1440, b)], new Set(), split)).toEqual([]);
  });

  it('respects a declared spread or a declared bottom line', () => {
    const around = flatten({ ...before, style: { ...before.style, justifyContent: 'space-around' } }).doc;
    expect(measure([shot(1440, stranded(around))], new Set(), around).map((f) => f.code)).toEqual(['title_bar_offcenter']);
    const bottom = flatten({ ...before, style: { ...before.style, alignItems: 'flex-end' } }).doc;
    expect(measure([shot(1440, stranded(bottom))], new Set(), bottom).map((f) => f.code)).toEqual(['title_bar_stranded']);
  });

  it('leaves a row that DECLARES a centred layout to its own decision', () => {
    const centred = flatten({ ...before, style: { ...before.style, justifyContent: 'center' } }).doc;
    const b = boxRow(centred, {
      nd_00000000: [120, 0, 1200, 44],
      nd_00000002: [400, 0, 300, 44],
      nd_00000004: [724, 10, 90, 24],
    });
    expect(measure([shot(1440, b)], new Set(), centred)).toEqual([]);
  });
});

// Opt-in: only a real layout engine can say where the link lands.
describe.runIf(process.env.SB_BROWSER_TEST === '1')('a title bar rendered in Chrome', () => {
  const render = async (spec: NodeSpec) => {
    const f = flatten(spec);
    const page = `<style>body{margin:0}${f.css}</style><div style="max-width:1200px;margin:0 auto;padding:0 16px">${f.html}</div>`;
    return { f, shots: await shoot(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`, { widths: [1440, 390] }) };
  };
  const at = (shots: Awaited<ReturnType<typeof shoot>>, width: number, type: string) =>
    shots.find((s) => s.width === width)!.boxes.find((b) => b.type === type)!;

  it('reproduces the defect on the old shape, at desktop only', async () => {
    const { f, shots } = await render(before);
    const found = measure(shots, new Set(), f.doc);
    expect(found.map((x) => x.code).sort()).toEqual(['title_bar_offcenter', 'title_bar_stranded']);
    expect(found.every((x) => x.widths.join() === '1440')).toBe(true);
  }, 40_000);

  it('the new shape: flush right and centred at 1440, stacked flush left at 390', async () => {
    const { f, shots } = await render(rowOf(bar()));
    expect(measure(shots, new Set(), f.doc)).toEqual([]);
    const row = at(shots, 1440, 'flex-block');
    const [h, b] = [at(shots, 1440, 'heading'), at(shots, 1440, 'button')];
    expect(Math.abs(row.x + row.w - (b.x + b.w))).toBeLessThanOrEqual(2);
    expect(Math.abs(b.y + b.h / 2 - (h.y + h.h / 2))).toBeLessThanOrEqual(2);
    const [mh, mb] = [at(shots, 390, 'heading'), at(shots, 390, 'button')];
    expect(mb.y).toBeGreaterThanOrEqual(mh.y + mh.h);
    expect(mb.x).toBe(mh.x);
  }, 40_000);
});
