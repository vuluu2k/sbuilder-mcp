import { describe, it, expect } from 'vitest';
import { capture } from '../src/vision/capture.js';
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

  /**
   * FLATNESS WAS THE BIGGEST THING AN IMPORT LOST.
   *
   * A source's three-column feature row came back as three stacked blocks and a
   * card — image, heading, copy, button — as four siblings with nothing saying
   * they belonged together. Everything a reader understands from the
   * ARRANGEMENT was thrown away, and no amount of correct colour brings it back.
   */
  it('rebuilds a captured row as a row, and stacks it at mobile', () => {
    const row: Captured[] = [
      {
        kind: 'section',
        children: [
          {
            kind: 'group',
            direction: 'row',
            children: [
              { kind: 'heading', text: 'One' },
              { kind: 'heading', text: 'Two' },
            ],
          },
        ],
      },
    ];
    const group = toSpecs(row, {})[0].children![0].children![0];
    expect(group.style).toMatchObject({ display: 'flex', flexDirection: 'row' });
    // Rule 3: nothing catches a too-narrow column for you — the columns SHRINK,
    // so no box overflows and `measure` stays silent while a photo becomes a
    // sliver. An import is the one place a row arrives with nobody having
    // thought about 390.
    expect(group.responsive).toMatchObject({ mobile: { style: { flexDirection: 'column' } } });
    expect(group.children!.length).toBe(2);
  });

  it('does not wrap a single child in a row', () => {
    const one: Captured[] = [
      { kind: 'section', children: [{ kind: 'group', direction: 'row', children: [{ kind: 'heading', text: 'Solo' }] }] },
    ];
    expect(toSpecs(one, {})[0].children![0].children![0].type).toBe('heading');
  });

  it('bounds an imported image in BOTH axes', () => {
    // A source image has no known size. `maxWidth: 100%` alone is not a bound:
    // an SVG has no intrinsic pixel size, so it took the container's full width
    // and about as much height again — four of them turned one imported section
    // into a 5,564px column of mostly whitespace.
    const img = toSpecs(page, {})[0].children![0].children![2];
    expect(img.style).toMatchObject({
      maxWidth: '100%',
      maxHeight: '420px',
      height: 'auto',
      objectFit: 'contain',
    });
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

/**
 * THE HALF THAT RUNS IN A BROWSER, against a real one.
 *
 * Opt-in for the same reason `vision.test.ts` gives: a machine without Chrome
 * must fail loudly when the tool is used, not have a test skip quietly and read
 * as green.
 *
 * It exists because of a specific bug. `capturePage` is SERIALIZED and evaluated
 * in the page, so a module-level `const` it closes over is not there — the file
 * already carried a comment saying exactly that, and the first real run still
 * died on `ReferenceError: HEADINGS is not defined`. Nothing but a real browser
 * can catch that: it compiles, and every pure test of the mapper passes.
 */
describe.runIf(process.env.SB_BROWSER_TEST === '1')('capture()', () => {
  const page = `data:text/html,${encodeURIComponent(
    '<main><section>' +
      '<h2>Tiêu đề</h2>' +
      '<p>Một đoạn văn.</p>' +
      '<img src="https://x.example/a.png" alt="Ảnh" style="width:40px;height:40px">' +
      '<ul><li>Một</li><li>Hai</li></ul>' +
      '<a href="/shop" class="btn" style="display:block">Mua ngay</a>' +
      '<p style="display:none">Ẩn</p>' +
      '<script>var x=1</script>' +
      '</section></main>',
  )}`;

  it('reduces a real page to the six kinds this platform renders', async () => {
    const r = await capture(page);
    expect(r.sections.length).toBe(1);
    const kinds = (r.sections[0].children ?? []).map((c) => c.kind);
    expect(kinds).toEqual(['heading', 'text', 'image', 'list', 'button']);
  }, 60_000);

  it('skips what cannot be rendered, and says so', async () => {
    const r = await capture(page);
    // A hidden paragraph and a script are not content; a capture that silently
    // dropped them would be a capture nobody could debug.
    expect(Object.keys(r.skipped)).toContain('hidden');
    expect(Object.keys(r.skipped)).toContain('script');
  }, 60_000);

  /**
   * NESTED SECTIONS WERE CAPTURED TWICE.
   *
   * `section` matches nested ones too, so an outer band and the bands inside it
   * were both taken — and the inner content came back once through its parent's
   * leaf walk and once on its own. Measured on real pages: 15 duplicated strings
   * out of 22, and 12 on another. On an imported page that reads as a stutter
   * nobody typed.
   */
  it('takes the innermost section, so nothing is captured twice', async () => {
    const nested = `data:text/html,${encodeURIComponent(
      '<main><section><section><h2>Inner</h2><p>Only once.</p></section></section></main>',
    )}`;
    const r = await capture(nested);
    expect(r.sections.length).toBe(1);
    const texts = (r.sections[0].children ?? []).map((c) => c.text);
    expect(texts).toEqual(['Inner', 'Only once.']);
  }, 60_000);

  /**
   * A SHORT BLOCK-LEVEL LINK IS NAVIGATION, not a call to action.
   *
   * The rule stopped at "not inline" and a documentation sidebar came back as 38
   * buttons — a page of pink pills where the source had a list of links. A real
   * CTA is PAINTED. And the border half needs WIDTH, not just a style: Tailwind's
   * preflight sets `border-style: solid; border-width: 0` on every element, so
   * the first fix changed nothing on a site built with it.
   */
  /**
   * MOST OF THE WEB DOES NOT USE `<p>`.
   *
   * Capturing only paragraphs meant a page whose prose sits in a `<div>`, a
   * `<td>` or a `<span>` came back EMPTY. Measured across a sweep:
   * news.ycombinator.com (a table layout) and tailwindcss.com both kept 0 of
   * ~4,000 and ~6,000 visible characters. They now keep 41% and 22%.
   */
  it('takes text from any block that holds it, and never twice', async () => {
    const page = `data:text/html,${encodeURIComponent(
      '<main><section>' +
        '<table><tr><td>In a cell</td></tr></table>' +
        '<div>In a div</div>' +
        '<div><p>In a paragraph inside a div</p></div>' +
        '</section></main>',
    )}`;
    const r = await capture(page);
    const texts = (r.sections[0].children ?? []).filter((c) => c.kind === 'text').map((c) => c.text);
    // The wrapping <div> must NOT also offer the paragraph's text: the fallback
    // fires only when nothing inside offered anything.
    expect(texts).toEqual(['In a cell', 'In a div', 'In a paragraph inside a div']);
  }, 60_000);

  it('falls back when the sections it found hold nothing renderable', async () => {
    // A page can offer <section> elements that hold nothing this platform draws.
    // Taking "we found candidates" as "we found content" returned an empty page —
    // measured on a real site that kept 0 of 6,004 characters.
    const page = `data:text/html,${encodeURIComponent(
      '<main><section><canvas></canvas></section><div>Real content</div></main>',
    )}`;
    const r = await capture(page);
    expect(r.sections.length).toBeGreaterThan(0);
    const texts: string[] = [];
    const walk = (c: { text?: string; children?: unknown[] }) => {
      if (c.text) texts.push(c.text);
      for (const k of (c.children ?? []) as { text?: string; children?: unknown[] }[]) walk(k);
    };
    r.sections.forEach(walk);
    expect(texts).toContain('Real content');
  }, 60_000);

  it('bounds the WHOLE import, not each section', async () => {
    // At 40 per section the cap was not a guard against a pathological page, it
    // was a truncation of an ordinary one — three dense pages each stopped at
    // exactly 40 leaves having captured 7-13% of what a reader sees.
    const many = `data:text/html,${encodeURIComponent(
      `<main><section>${Array.from({ length: 20 }, (_, i) => `<div>Line ${i}</div>`).join('')}</section></main>`,
    )}`;
    const r = await capture(many, { maxNodes: 5 });
    const texts = (r.sections[0].children ?? []).filter((c) => c.kind === 'text');
    expect(texts.length).toBe(5);
    expect(r.skipped['over-node-limit']).toBeGreaterThan(0);
  }, 60_000);

  it('takes a painted link as a button and leaves a bare one alone', async () => {
    const page = `data:text/html,${encodeURIComponent(
      '<main><section>' +
        '<a href="/a" style="display:block;background:#E8557A">Real CTA</a>' +
        '<a href="/b" style="display:block;border-style:solid;border-width:0">Tailwind reset</a>' +
        '<a href="/c" style="display:block">Sidebar link</a>' +
        '<a href="/d" class="btn" style="display:block">Classed</a>' +
        '</section></main>',
    )}`;
    const r = await capture(page);
    const buttons = (r.sections[0].children ?? []).filter((c) => c.kind === 'button');
    expect(buttons.map((b) => b.text)).toEqual(['Real CTA', 'Classed']);
  }, 60_000);

  it('bounds how many images one import can carry', async () => {
    // Every image is an upload. A sponsors wall — one measured at 36 logos —
    // means that many sequential round trips inside a single tool call.
    const many = `data:text/html,${encodeURIComponent(
      '<main><section>' +
        Array.from(
          { length: 6 },
          (_, i) => `<img src="https://x.example/${i}.png" style="width:20px;height:20px">`,
        ).join('') +
        '</section></main>',
    )}`;
    const r = await capture(many, { maxImages: 2 });
    expect((r.sections[0].children ?? []).filter((c) => c.kind === 'image').length).toBe(2);
    expect(r.skipped['over-image-limit']).toBe(4);
  }, 60_000);

  it('survives an href it cannot make absolute', async () => {
    // `new URL('/shop', 'data:…')` throws, and a throw inside evaluate kills the
    // whole capture rather than one link.
    const r = await capture(page);
    const button = (r.sections[0].children ?? []).find((c) => c.kind === 'button');
    expect(button?.href).toBe('/shop');
  }, 60_000);
});
