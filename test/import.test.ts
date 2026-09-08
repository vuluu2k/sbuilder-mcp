import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree, setKeys } from '../src/domains/site/builder.js';
import {
  toSpecs,
  tokensFromPage,
  imageSources,
  rehostImages,
  type Captured,
} from '../src/domains/site/importmap.js';

/**
 * IMPORTING FROM ELSEWHERE IS THE ONE OPERATION THAT THREATENS RULE 0.
 *
 * A section that answers the accent, the ink and the radius differently does not
 * read as a new section — it reads as a different website. So the mapper takes
 * the TARGET page's tokens, and these tests are about that as much as about the
 * element choices.
 *
 * The mapper is pure on purpose: the browser half decides what a heading IS, and
 * this half decides which element renders it. Testing them apart means the
 * element choices can be argued about without a network.
 */

function emptyDoc() {
  return PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
}

/** A page with a heading, a body line and a primary button already on it. */
function styledPage() {
  const d = emptyDoc();
  d.apply(
    addSubtree(d, 'ROOT', {
      type: 'flex-section',
      style: { padding: '96px 24px' },
      children: [
        {
          type: 'flex-block',
          style: { maxWidth: '1200px' },
          children: [{ type: 'heading' }, { type: 'text' }, { type: 'button' }],
        },
      ],
    }).patches,
  );
  const section = d.node('ROOT').data.nodes[0];
  const block = d.node(section).data.nodes[0];
  const [heading, text, button] = d.node(block).data.nodes;
  d.apply(setKeys(d, heading, { color: '#2E2A3B', fontWeight: '800' }, { namespace: 'style', base: true }));
  d.apply(setKeys(d, text, { color: '#7C7389', fontSize: '16px' }, { namespace: 'style', base: true }));
  d.apply(
    setKeys(
      d,
      button,
      { backgroundColor: '#E8557A', color: '#FFFFFF', borderRadius: '999px' },
      { namespace: 'style', base: true },
    ),
  );
  return d;
}

describe('tokensFromPage()', () => {
  it('reads the page\'s own heading, body and button', () => {
    const t = tokensFromPage(styledPage().doc);
    expect(t).toMatchObject({
      headingColor: '#2E2A3B',
      headingWeight: '800',
      textColor: '#7C7389',
      textSize: '16px',
      buttonBg: '#E8557A',
      buttonColor: '#FFFFFF',
      buttonRadius: '999px',
      sectionPadding: '96px 24px',
      sectionMaxWidth: '1200px',
    });
  });

  it('answers nothing for an empty page rather than inventing a palette', () => {
    // An empty page is a legitimate import target, and a made-up accent is
    // exactly the invention rule 0 exists to prevent.
    expect(tokensFromPage(emptyDoc().doc)).toEqual({});
  });

  it('ignores a transparent nav link when looking for the primary button', () => {
    const d = emptyDoc();
    d.apply(
      addSubtree(d, 'ROOT', {
        type: 'flex-section',
        children: [{ type: 'flex-block', children: [{ type: 'button' }, { type: 'button' }] }],
      }).patches,
    );
    const block = d.node(d.node('ROOT').data.nodes[0]).data.nodes[0];
    const [nav, primary] = d.node(block).data.nodes;
    d.apply(setKeys(d, nav, { backgroundColor: 'transparent' }, { namespace: 'style', base: true }));
    d.apply(setKeys(d, primary, { backgroundColor: '#E8557A' }, { namespace: 'style', base: true }));
    // Taking the nav link's "fill" would give every imported button no fill.
    expect(tokensFromPage(d.doc).buttonBg).toBe('#E8557A');
  });
});

describe('toSpecs()', () => {
  const page: Captured[] = [
    {
      kind: 'section',
      children: [
        { kind: 'heading', level: 1, text: 'Áo cho bé' },
        { kind: 'text', text: 'Cotton mềm, đường may chắc.' },
        { kind: 'image', src: 'https://elsewhere.example/a.png', alt: 'Áo thun' },
        { kind: 'button', text: 'Mua ngay', href: 'https://elsewhere.example/shop' },
        { kind: 'list', items: ['Đổi size 7 ngày', 'Giao toàn quốc'] },
      ],
    },
  ];

  it('renders each captured kind as the element that can show it', () => {
    const [section] = toSpecs(page, {});
    expect(section.type).toBe('flex-section');
    const inner = section.children![0];
    expect(inner.type).toBe('flex-block');
    expect(inner.children!.map((c) => c.type)).toEqual([
      'heading',
      'text',
      'image',
      'button',
      'flex-block',
    ]);
    expect(inner.children![0].specials).toMatchObject({ htmlTag: 'h1', text: 'Áo cho bé' });
    expect(inner.children![2].specials).toMatchObject({ src: 'https://elsewhere.example/a.png' });
    expect(inner.children![3].specials).toMatchObject({ href: 'https://elsewhere.example/shop' });
  });

  it('dresses the import in the TARGET page\'s tokens, not the source\'s', () => {
    const t = tokensFromPage(styledPage().doc);
    const inner = toSpecs(page, t)[0].children![0];
    expect(inner.children![0].style).toMatchObject({ color: '#2E2A3B', fontWeight: '800' });
    expect(inner.children![3].style).toMatchObject({
      backgroundColor: '#E8557A',
      borderRadius: '999px',
    });
    // The section takes the page's own measure — a full-window band on a site
    // whose sections are 1200 reads as a different site even when every colour
    // matches.
    expect(toSpecs(page, t)[0].children![0].style).toMatchObject({ maxWidth: '1200px' });
  });

  it('drops what has nothing to show instead of adding an empty node', () => {
    const thin: Captured[] = [
      { kind: 'section', children: [{ kind: 'heading', text: '   ' }, { kind: 'image' }] },
      { kind: 'section', children: [{ kind: 'text', text: 'Kept' }] },
    ];
    const out = toSpecs(thin, {});
    // An empty node is an sb_review finding on a page nobody has looked at yet.
    expect(out.length).toBe(1);
    expect(out[0].children![0].children!.length).toBe(1);
  });

  it('wraps a bare leaf in a section, because flex-section is root-only', () => {
    const out = toSpecs([{ kind: 'heading', text: 'Solo' }], {});
    expect(out[0].type).toBe('flex-section');
  });
});

describe('images are copied, not hotlinked', () => {
  const page: Captured[] = [
    {
      kind: 'section',
      children: [
        { kind: 'image', src: 'https://x.example/1.png' },
        { kind: 'image', src: 'https://x.example/2.png' },
        { kind: 'image', src: 'https://x.example/1.png' },
      ],
    },
  ];

  it('lists every source once, in order', () => {
    expect(imageSources(page)).toEqual(['https://x.example/1.png', 'https://x.example/2.png']);
  });

  it('rewrites the ones that uploaded and LEAVES the ones that did not', () => {
    // A failed upload must leave a visible image behind, not an empty frame.
    const out = rehostImages(page, new Map([['https://x.example/1.png', 'https://mine/a.png']]));
    const kids = out[0].children!;
    expect(kids[0].src).toBe('https://mine/a.png');
    expect(kids[1].src).toBe('https://x.example/2.png');
    expect(kids[2].src).toBe('https://mine/a.png');
  });
});
