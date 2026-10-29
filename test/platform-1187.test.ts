import { describe, it, expect } from 'vitest';
import { writeCheck } from '../src/domains/site/writecheck.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { PageDoc } from '../src/domains/site/document.js';
import { measureShot } from '../src/vision/measure.js';
import type { Box, Shot } from '../src/vision/shoot.js';

/**
 * web_builder v1.0.187 moved three facts this server's checks were built on.
 *
 * 1. a8097f59e — `.wb-text a` / `.wb-heading a {color:inherit;text-decoration:underline}`:
 *    a link in a heading's or a text's textHtml no longer paints UA blue. A BUTTON
 *    renders textHtml too (`nodes.RichText`) and its static CSS has no `a` rule.
 * 2. e8900e4d9 — element seeds wear `var(--wb-ts-<slug>-family, Inter)`, not "Inter".
 *    A literal "Inter" is now the OLD seed: a node created before the move.
 * 3. 9f51a4cc4 — the cart drawer is capped `max-width:100%` by static CSS.
 */

const page = (nodes: Record<string, unknown>, top: string[]) =>
  PageDoc.from({
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: {
      ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['s'] }, specials: {} },
      s: { id: 's', data: { type: 'flex-section', parent: 'ROOT', nodes: top }, specials: {} },
      ...nodes,
    },
  } as never);

describe('link_colour: only where no platform rule colours the link', () => {
  const codes = (type: string, html: string) => writeCheck(type, 'specials', { textHtml: html }).map((c) => c.note.code);
  it('is silent for heading and text — their static CSS makes a link inherit', () => {
    expect(codes('text', 'Xem <a href="/p">đây</a>')).not.toContain('link_colour');
    expect(codes('heading', 'Xem <a href="/p">đây</a>')).not.toContain('link_colour');
    const doc = page(
      {
        t: { id: 't', data: { type: 'text', parent: 's', nodes: [] }, specials: { text: 'x', textHtml: 'Xem <a href="/p">đây</a>' } },
        h: { id: 'h', data: { type: 'heading', parent: 's', nodes: [] }, specials: { text: 'x', textHtml: '<a href="/p">x</a>' } },
      },
      ['t', 'h'],
    );
    expect(reviewDesign(doc).map((f) => f.code)).not.toContain('link_colour');
  });
  it('still warns on a button, whose static CSS styles no <a>', () => {
    expect(codes('button', 'Mua <a href="/p">ngay</a>')).toContain('link_colour');
    expect(codes('button', '<a href="/p" style="color:inherit">x</a>')).not.toContain('link_colour');
    const doc = page(
      { b: { id: 'b', data: { type: 'button', parent: 's', nodes: [] }, specials: { text: 'x', textHtml: '<a href="/p">x</a>' } } },
      ['b'],
    );
    expect(reviewDesign(doc).map((f) => f.code)).toContain('link_colour');
  });
});

describe('default_font: a literal OLD seed font, never a theme variable', () => {
  const item = (style: Record<string, unknown>, responsive: Record<string, unknown> = {}) =>
    page(
      {
        a: { id: 'a', data: { type: 'accordion', parent: 's', nodes: [] }, config: { accordionItemId: 'ai' }, specials: {} },
        ai: { id: 'ai', data: { type: 'accordion-item', parent: 'a', nodes: [] }, style, responsive, specials: {} },
      },
      ['a'],
    );
  const codes = (doc: PageDoc, fonts?: Record<string, string>) => reviewDesign(doc, { fonts }).map((f) => f.code);

  it('flags a node still on literal "Inter" when its own text style is another family', () => {
    const f = reviewDesign(item({ fontFamily: 'Inter' }), { fonts: { 'text-2': 'Be Vietnam Pro' } }).find((x) => x.code === 'default_font');
    expect(f?.nodeId).toBe('ai');
    expect(f?.problem).toMatch(/Be Vietnam Pro/);
    expect(f?.problem).toContain('var(--wb-ts-text-2-family, Inter)');
  });
  it('never flags the new seed, a theme variable', () => {
    expect(codes(item({ fontFamily: 'var(--wb-ts-text-2-family, Inter)' }), { 'text-2': 'Be Vietnam Pro' })).not.toContain('default_font');
  });
  it('asks the text style the element wears, not the body font', () => {
    const label = (fonts: Record<string, string>) =>
      codes(
        page(
          {
            pv: { id: 'pv', data: { type: 'product-variants', parent: 's', nodes: [] }, config: { variantLabelId: 'vl' }, specials: {} },
            vl: { id: 'vl', data: { type: 'product-variant-label', parent: 'pv', nodes: [] }, style: { fontFamily: 'Inter' }, specials: {} },
          },
          ['pv'],
        ),
        fonts,
      );
    expect(label({ 'text-2': 'Be Vietnam Pro', 'heading-6': 'Inter' })).not.toContain('default_font');
    expect(label({ 'text-2': 'Inter', 'heading-6': 'Lora' })).toContain('default_font');
  });
  it('is silent when the theme agrees, is unknown, or the element seeds no font', () => {
    expect(codes(item({ fontFamily: 'Inter' }), { 'text-2': 'Inter' })).not.toContain('default_font');
    expect(codes(item({ fontFamily: 'Inter' }))).not.toContain('default_font');
    const h = page({ h: { id: 'h', data: { type: 'heading', parent: 's', nodes: [] }, style: { fontFamily: 'Inter' }, specials: { text: 'x' } } }, ['h']);
    expect(codes(h, { 'heading-1': 'Lora', 'text-2': 'Lora' })).not.toContain('default_font');
  });
  it('keeps the per-breakpoint skip', () => {
    const doc = item({ fontFamily: 'Inter' }, { desktop: { style: { fontFamily: 'Be Vietnam Pro' } } });
    expect(codes(doc, { 'text-2': 'Be Vietnam Pro' })).not.toContain('default_font');
  });
});

describe('wider_than_viewport on a drawer the platform caps', () => {
  const shot = (width: number, boxes: Box[]): Shot => ({ width, imageBase64: '', mimeType: 'image/jpeg', boxes });
  const drawer = (x: number, w: number) => ({ id: 'ca_1', type: 'cart-drawer', x, y: 0, w, h: 900, position: 'fixed' }) as Box;
  it('says nothing about an open drawer capped at the viewport, from either edge', () => {
    expect(measureShot(shot(390, [drawer(0, 390)]))).toEqual([]);
    expect(measureShot(shot(1440, [drawer(1040, 400)]))).toEqual([]);
  });
  it('still names one whose own maxWidth outranks the cap', () => {
    expect(measureShot(shot(390, [drawer(-10, 400)])).map((f) => f.code)).toEqual(['wider_than_viewport']);
  });
});
