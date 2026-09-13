import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { capture, captureMany, crawlLinks } from '../src/vision/capture.js';
import { canonFor } from '../src/domains/site/discover.js';
import { checkBandOrder, middleEnd } from '../src/domains/site/traps.js';
import { globalDocumentFrom } from '../src/tools/importpage.js';
import { validateForSave } from '../src/domains/site/validate.js';
import type { Patch } from '../src/core/patch.js';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree, setKeys } from '../src/domains/site/builder.js';
import { sourceTokens } from '../src/domains/site/sourcetokens.js';
import { themePatchFor, applyThemePatch } from '../src/domains/site/theme.js';
import type { StarterTheme } from '../src/catalog/theme-types.js';
import {
  menuLabel,
  navSpec,
  relink,
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

  it('takes an embed, a video and a rule — and drops an iframe this platform cannot render', async () => {
    // `IFRAME` used to be in the ignore list wholesale, so every embedded video
    // and every map arrived as a skip count. What genuinely has no element here
    // — an advert, a tracker, a comment system — still does, counted rather than
    // guessed at.
    //
    // THE `<video>` HERE IS LOAD-BEARING, and it caught a real regression while
    // reading as an ordinary line of the list. A video sizes itself from its
    // MEDIA, and a `poster` is what it measures before any media loads — so this
    // one, carrying a poster and no explicit width/height, measured 0×0 and was
    // dropped as `hidden` with nothing but a count. The identical element with
    // `width`/`height`, or with no poster at all, came through: the one video
    // most worth importing was the one that disappeared.
    //
    // It survived because the browser suite is opt-in (`SB_BROWSER_TEST=1`) and
    // the standard gate does not run it — the "a skip that reads as green"
    // failure this repo keeps closing, found by finally running it.
    const media = `data:text/html,${encodeURIComponent(
      '<main><section>' +
        '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=abc"></iframe>' +
        '<iframe src="https://player.vimeo.com/video/76979871"></iframe>' +
        '<iframe src="https://www.google.com/maps/embed?pb=!1m18"></iframe>' +
        '<iframe src="https://ads.example/banner.html"></iframe>' +
        '<video src="https://x.example/a.mp4" poster="https://x.example/p.jpg"></video>' +
        '<hr>' +
        '<p>Sau đường kẻ.</p>' +
        '</section></main>',
    )}`;
    const r = await capture(media);
    const kids = r.sections[0].children ?? [];
    expect(kids.map((c) => c.kind)).toEqual([
      'embed', 'embed', 'embed', 'video', 'divider', 'text',
    ]);
    expect(kids[0]).toMatchObject({ provider: 'youtube', videoId: 'dQw4w9WgXcQ' });
    expect(kids[1]).toMatchObject({ provider: 'vimeo', videoId: '76979871' });
    expect(kids[2]).toMatchObject({ provider: 'map' });
    expect(kids[3]).toMatchObject({ poster: expect.stringContaining('p.jpg') });
    expect(r.skipped.iframe).toBe(1);
  }, 60_000);

  it('drops the site footer even when it is a div, and keeps the hero that merely says "header"', async () => {
    // MEASURED ON blender.org: its site map is `<div class="footer-navigation">`
    // with no <footer> tag anywhere near it, so a spec-only rule let eleven
    // sections of somebody else's links through as the page. The same trick on
    // the header side would eat heroes — blender's first band is
    // `<div class="hero header-size-large">` — so a class name is evidence for a
    // footer and not for a header.
    const page = `data:text/html,${encodeURIComponent(
      '<meta charset="utf-8">' +
        '<div class="hero header-size-large"><section><h1>Hero</h1></section></div>' +
        '<main><section><p>Nội dung thật.</p>' +
        '<div class="card-footer"><p>Chân thẻ, vẫn là nội dung.</p></div>' +
        '</section></main>' +
        '<div class="footer-navigation"><section><ul><li>Điều khoản</li><li>Bảo mật</li></ul></section></div>' +
        '<footer class="footer-note"><p>© 2026</p></footer>',
    )}`;
    const r = await capture(page);
    const all = JSON.stringify(r.sections);
    expect(all).toContain('Hero');
    expect(all).toContain('Nội dung thật.');
    // `card-footer` does not START with "footer", so it is not swept up.
    expect(all).toContain('Chân thẻ');
    expect(all).not.toContain('Điều khoản');
    expect(all).not.toContain('© 2026');
    expect(r.skipped['page-chrome']).toBeGreaterThan(0);
  }, 60_000);

  it('an FAQ of <details> becomes ONE accordion, opened so the answers survive', async () => {
    // A COLLAPSED `<details>` MEASURES AS ZERO, so its body reads as hidden and
    // the import would keep the questions and lose every answer. And eight
    // siblings is one list to the author, not eight containers.
    const faq = `data:text/html,${encodeURIComponent(
      '<meta charset="utf-8"><main><section>' +
        '<details><summary>Giao hàng bao lâu?</summary><p>Hai đến ba ngày.</p></details>' +
        '<details><summary>Đổi trả thế nào?</summary><p>Trong bảy ngày.</p></details>' +
        '</section></main>',
    )}`;
    const r = await capture(faq);
    const kids = r.sections[0].children ?? [];
    expect(kids.map((c) => c.kind)).toEqual(['accordion']);
    const items = kids[0].children ?? [];
    expect(items.map((i) => i.text)).toEqual(['Giao hàng bao lâu?', 'Đổi trả thế nào?']);
    expect(items[0].children?.[0]).toMatchObject({ kind: 'text', text: 'Hai đến ba ngày.' });
  }, 60_000);

  it('names an icon the way the source page does, and skips one it cannot place', async () => {
    const icons = `data:text/html,${encodeURIComponent(
      '<meta charset="utf-8"><main><section>' +
        '<svg class="ri-search-line" aria-hidden="true"></svg>' +
        '<svg aria-label="Acme Store"></svg>' +
        '<svg><title>Menu</title></svg>' +
        '</section></main>',
    )}`;
    const r = await capture(icons);
    const kids = r.sections[0].children ?? [];
    // An icon is DECORATION, which is what `aria-hidden` marks — testing that
    // first would put this element permanently out of reach of a real page.
    expect(kids.map((c) => c.name)).toEqual(['ri-search-line', 'Acme Store', 'Menu']);
    expect(kids.every((c) => c.kind === 'icon')).toBe(true);
  }, 60_000);

  it('reports a form rather than dropping it, because rebuilding one means guessing mapTo', async () => {
    // A contact page that silently arrives with no way to contact anybody is the
    // failure worth avoiding. The fields are a vocabulary the server validates
    // and `sb_store action:"form"` owns it, so the honest move is to say the
    // page had one and name the tool that makes it.
    const contact = `data:text/html,${encodeURIComponent(
      '<meta charset="utf-8"><main><section><h2>Liên hệ</h2>' +
        '<form><label>Tên</label><input><label>Email</label><input type="email">' +
        '<label>Nội dung</label><textarea></textarea></form></section></main>',
    )}`;
    const r = await capture(contact);
    expect(r.forms).toEqual([{ fields: 3, labels: ['Tên', 'Email', 'Nội dung'] }]);
    // The heading around it is still content, and no field became a node.
    expect((r.sections[0].children ?? []).map((c) => c.kind)).toEqual(['heading']);
    expect(r.skipped.form).toBe(1);
  }, 60_000);

  it('flattens a nested list instead of taking it twice', async () => {
    // `querySelectorAll('li')` returns nested items as well as outer ones, and an
    // outer item's textContent already contains its sublist — so every nested
    // entry arrived once inside its parent's line and once again on its own.
    // Measured on a real import: one section repeated five sublists that way.
    const nested = `data:text/html,${encodeURIComponent(
      '<meta charset="utf-8"><main><section><ul>' +
        '<li>Cha một<ul><li>Con A</li><li>Con B</li></ul></li><li>Cha hai</li>' +
        '</ul></section></main>',
    )}`;
    const r = await capture(nested);
    expect((r.sections[0].children ?? [])[0].items).toEqual(['Cha một', 'Con A', 'Con B', 'Cha hai']);
  }, 60_000);

  it('skips what the page itself marks as not content', async () => {
    // `aria-hidden="true"` is the author's own mark for decoration and for
    // duplicates — a carousel's clones, the mobile copy of a menu the desktop
    // layout also carries. Nothing here reads the accessibility tree, so the
    // attribute is the only place that answer exists.
    const marked = `data:text/html,${encodeURIComponent(
      // A `data:` page declares no charset, so the bytes come back as latin-1
      // without this — the fixture's own encoding, not the walk's.
      '<meta charset="utf-8"><main><section><p>Thật.</p>' +
        '<div aria-hidden="true"><p>Trang trí.</p></div></section></main>',
    )}`;
    const r = await capture(marked);
    const texts = (r.sections[0].children ?? []).map((c) => c.text);
    expect(texts).toEqual(['Thật.']);
    expect(r.skipped['aria-hidden']).toBe(1);
  }, 60_000);

  it('reports the page\'s own canonical address', async () => {
    const canon = `data:text/html,${encodeURIComponent(
      '<link rel="canonical" href="https://shop.example/real"><main><section><p>Nội dung.</p></section></main>',
    )}`;
    const r = await capture(canon);
    expect(r.canonical).toBe('https://shop.example/real');
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

  /**
   * A LINK THAT IS NOT A BUTTON IS STILL A LINK.
   *
   * It used to contribute NOTHING, and on a page whose content IS a list of
   * links that is the whole page: news.ycombinator.com lost 1,595 characters of
   * story titles that way, and now loses none. The platform has no inline-link
   * element — its own idiom is a `button` carrying `href`, styled flat.
   */
  it('keeps an unpainted link as a link, not as a call to action', async () => {
    const page = `data:text/html,${encodeURIComponent(
      '<main><section>' +
        '<a href="/story">A story title</a>' +
        '<a href="/buy" style="display:block;background:#E8557A">Buy now</a>' +
        '</section></main>',
    )}`;
    const r = await capture(page);
    const buttons = (r.sections[0].children ?? []).filter((c) => c.kind === 'button');
    expect(buttons.map((b) => [b.text, b.variant])).toEqual([
      ['A story title', 'link'],
      ['Buy now', 'cta'],
    ]);
  }, 60_000);

  it("drops the source's own header and footer, but not a section's", async () => {
    // The target has its own, as shared globals. Importing somebody else's
    // navigation onto a storefront is a second menu pointing at another site.
    // Only PAGE-LEVEL ones: a <header> inside a section is a hero.
    const page = `data:text/html,${encodeURIComponent(
      '<header><p>Site nav</p></header>' +
        '<main><section><header><h1>Hero</h1></header><p>Body</p></section></main>' +
        '<footer><p>Site footer</p></footer>',
    )}`;
    const r = await capture(page);
    const texts: string[] = [];
    const walk = (c: { text?: string; children?: unknown[] }) => {
      if (c.text) texts.push(c.text);
      for (const k of (c.children ?? []) as { text?: string; children?: unknown[] }[]) walk(k);
    };
    r.sections.forEach(walk);
    expect(texts).toContain('Hero');
    expect(texts).toContain('Body');
    expect(texts).not.toContain('Site nav');
    expect(texts).not.toContain('Site footer');
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

  it('tells a painted call to action from an ordinary link', async () => {
    // Both are kept — dropping the plain ones lost a whole page of story titles.
    // What must not blur is WHICH is which: painting every link produced 38 pink
    // pills out of a documentation sidebar. And the border test needs WIDTH,
    // because Tailwind's preflight sets `border-style: solid; border-width: 0`
    // on every element, so testing the style alone is true of a whole site.
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
    expect(buttons.map((b) => [b.text, b.variant])).toEqual([
      ['Real CTA', 'cta'],
      ['Tailwind reset', 'link'],
      ['Sidebar link', 'link'],
      ['Classed', 'cta'],
    ]);
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

/**
 * THE KINDS THAT HAD NO ELEMENT, AND NOW DO.
 *
 * An embedded video, a map and a rule were the one class of content that could
 * not survive the trip at all: `IFRAME` sat in the ignore list, so a hero video
 * and a contact page's map arrived as a skip count. The platform has had
 * `video`, `youtube`, `vimeo`, `soundcloud`, `google-map` and `divider` the
 * whole time.
 */
describe('media and rules map to the elements that render them', () => {
  const t = {};

  it('a youtube or vimeo embed stores the ID, never the URL', () => {
    // The elements read `specials.videoId`. Handing them a watch URL renders an
    // empty frame — the failure looks like the embed being unsupported.
    expect(toSpecs([{ kind: 'section', children: [
      { kind: 'embed', provider: 'youtube', videoId: 'dQw4w9WgXcQ' },
      { kind: 'embed', provider: 'vimeo', videoId: '76979871' },
    ] }] as Captured[], t)[0].children![0].children!.map((n) => [n.type, n.specials])).toEqual([
      ['youtube', { videoId: 'dQw4w9WgXcQ' }],
      ['vimeo', { videoId: '76979871' }],
    ]);
  });

  it('a map takes the embed URL, and soundcloud takes it under a different key again', () => {
    const kids = toSpecs([{ kind: 'section', children: [
      { kind: 'embed', provider: 'map', src: 'https://www.google.com/maps/embed?pb=x' },
      { kind: 'embed', provider: 'soundcloud', src: 'https://w.soundcloud.com/player/?url=y' },
    ] }] as Captured[], t)[0].children![0].children!;
    expect(kids[0]).toMatchObject({ type: 'google-map', specials: { src: expect.stringContaining('maps/embed'), mapType: 'location' } });
    expect(kids[1]).toMatchObject({ type: 'soundcloud', specials: { trackUrl: expect.stringContaining('soundcloud') } });
  });

  it('a video carries its poster, and neither carries a style of its own', () => {
    // Every media element seeds `width: 100%` + `height: fit-content`, and
    // google-map seeds a height per breakpoint. A literal over that detaches the
    // node from the element's own responsive answer to be less correct than it.
    const [video] = toSpecs(
      [{ kind: 'section', children: [{ kind: 'video', src: 'https://x/a.mp4', poster: 'https://x/p.jpg' }] }] as Captured[],
      t,
    )[0].children![0].children!;
    expect(video).toEqual({ type: 'video', specials: { videoSrc: 'https://x/a.mp4', poster: 'https://x/p.jpg' } });
  });

  it('an embed with nothing behind it is dropped rather than added empty', () => {
    const empty = toSpecs(
      [{ kind: 'section', children: [{ kind: 'embed', provider: 'youtube' }, { kind: 'video' }] }] as Captured[],
      t,
    );
    expect(empty).toEqual([]);
  });

  it('a rule between sections is one node', () => {
    const [rule] = toSpecs([{ kind: 'section', children: [{ kind: 'divider' }] }] as Captured[], t)[0]
      .children![0].children!;
    expect(rule.type).toBe('divider');
  });
});

/**
 * WHERE AN IMPORT LANDS ON A PAGE THAT ALREADY HAS GLOBALS.
 *
 * Trap 3 is not a style rule: the platform refuses EVERY save whose ROOT
 * children do not read [header*][middle*][footer*]. So appending — the obvious
 * thing, and what both importers used to do — costs the whole page on any site
 * that has a global footer, which is most of them.
 */
/**
 * A SITE WHOSE MENU LEAVES FOR THE SITE IT WAS COPIED FROM IS NOT A SITE.
 *
 * A captured link keeps the source's absolute URL, so twelve pages were built
 * here and not one way to reach any of them — every click went back to the
 * original. The most basic feature a website has, and the import was working
 * against it.
 */
describe('imported links point at the imported pages', () => {
  const sections: Captured[] = [
    {
      kind: 'section',
      children: [
        { kind: 'button', text: 'Về', href: 'https://src.example/about/' },
        { kind: 'button', text: 'Blog', href: 'https://src.example/blog' },
        { kind: 'button', text: 'Ngoài', href: 'https://other.example/x' },
        { kind: 'group', children: [{ kind: 'button', text: 'Trang chủ', href: 'https://src.example' }] },
      ],
    },
  ];
  const local = new Map([
    ['https://src.example/', '/'],
    ['https://src.example/about', '/gioi-thieu'],
  ]);

  it('rewrites a link to a page that was imported, in any of its spellings', () => {
    const r = relink(sections, local, 'https://src.example');
    const kids = r.sections[0].children!;
    expect(kids[0].href).toBe('/gioi-thieu');
    // Nested as well as top level, and the entry resolves to the home page.
    expect(kids[3].children![0].href).toBe('/');
    expect(r.rewritten).toBe(2);
  });

  it('leaves a same-origin page the cap left out alone, and COUNTS it', () => {
    // An off-site link that works beats a local one that 404s, and the count is
    // what tells the caller to raise max_pages.
    const r = relink(sections, local, 'https://src.example');
    expect(r.sections[0].children![1].href).toBe('https://src.example/blog');
    expect(r.unimported).toBe(1);
  });

  it('does not touch a genuinely external link', () => {
    const r = relink(sections, local, 'https://src.example');
    expect(r.sections[0].children![2].href).toBe('https://other.example/x');
  });

  it('keeps the fragment, which is part of the link even though it is not part of the page', () => {
    // `normalizeUrl` drops it because it is not part of a page's IDENTITY — that
    // is what folds /a and /a#top into one page — but a "jump to the forums"
    // link that lands at the top of the page looks broken.
    const r = relink(
      [{ kind: 'section', children: [{ kind: 'button', text: 'Diễn đàn', href: 'https://src.example/about#forums' }] }],
      local,
      'https://src.example',
    );
    expect(r.sections[0].children![0].href).toBe('/gioi-thieu#forums');
  });

  it('leaves the captured input untouched', () => {
    relink(sections, local, 'https://src.example');
    expect(sections[0].children![0].href).toBe('https://src.example/about/');
  });
});

/**
 * THE MENU THAT LINKS THE IMPORTED PAGES TOGETHER.
 *
 * The last thing `sb_import_site`'s directive said it could not do. It is built
 * from the pages that were ACTUALLY created and never from the source's own nav:
 * that one points at the site this was copied from, half of it at pages the cap
 * left out, and its structure is somebody else's.
 */
/**
 * AIR IS A DEFECT THAT NOTHING MEASURES.
 *
 * `measure` reports a box that overflows and two boxes that overlap. A column
 * three times taller than its own content breaks neither rule, so a page can be
 * 6,000px of mostly nothing and review clean at every width.
 */
describe("a stacked row's columns are as tall as their content", () => {
  const row = (n: number) =>
    toSpecs(
      [
        {
          kind: 'section',
          children: [
            {
              kind: 'group',
              direction: 'row',
              children: Array.from({ length: n }, (_, i) => ({
                kind: 'text' as const,
                text: `Cột ${i + 1}`,
              })),
            },
          ],
        },
      ] as Captured[],
      {},
    )[0].children![0].children![0];

  it('keeps the basis that makes a ROW work, and drops it where the row is a column', () => {
    // `flex: 1 1 280px` sizes the MAIN axis, and the row's own mobile override
    // turns the main axis from width into HEIGHT — so every stacked column came
    // out 280px tall whatever was in it. Measured at 390 on a real import: 6,009
    // px of page, most of it empty, with zero findings.
    const columns = row(3).children!;
    expect(columns).toHaveLength(3);
    for (const col of columns) {
      expect(col.style?.flex).toBe('1 1 280px');
      expect((col.responsive as { mobile?: { style?: Record<string, unknown> } })?.mobile?.style?.flex).toBe(
        '0 1 auto',
      );
    }
  });

  it('a single child is not a row at all, so it carries neither', () => {
    expect(row(1).style?.flex).toBeUndefined();
  });
});

describe('the shared header', () => {
  it('names a page the way the page names itself, minus the site it belongs to', () => {
    // A title is written for a browser tab — "Example Servers — Model Context
    // Protocol" — and a menu row of those wraps to three lines.
    expect(menuLabel('Example Servers — Model Context Protocol')).toBe('Example Servers');
    expect(menuLabel('Giới thiệu')).toBe('Giới thiệu');
    expect(menuLabel('Trang chủ | Cửa hàng')).toBe('Trang chủ');
    expect(menuLabel('x'.repeat(40))).toHaveLength(28);
  });

  it('wears the same tokens every imported section does', () => {
    // A header that answers the accent differently is rule 0 broken on the one
    // band that appears on every page.
    const spec = navSpec([{ text: 'Về', href: '/gioi-thieu' }], { headingColor: '#2E2A3B' })!;
    expect(spec.type).toBe('flex-section');
    // A section's 64px is right for a band of content and absurd for a menu.
    expect(spec.style?.padding).toBe('16px 24px');
    expect(JSON.stringify(spec)).toContain('/gioi-thieu');
  });

  it('is nothing at all when there is nothing to link', () => {
    expect(navSpec([], {})).toBeNull();
  });

  it('lifts the section into the document shape a global stores', () => {
    // A global's document is page-document SHAPED but its root_node_id IS the
    // section: compose carries its nodes over and re-parents that root onto the
    // page's ROOT, so a master has no parent until a page composes it.
    const doc = globalDocumentFrom(navSpec([{ text: 'Về', href: '/a' }], {})!);
    expect(doc.schema_version).toBe(2);
    const root = doc.nodes[doc.root_node_id] as { data: { type: string; parent: unknown } };
    expect(root.data.type).toBe('flex-section');
    expect(root.data.parent).toBeNull();
    // Every node of the subtree came with it, and the throwaway ROOT did not.
    expect(Object.keys(doc.nodes).length).toBeGreaterThan(2);
    expect(doc.nodes.ROOT).toBeUndefined();
  });
});

describe('an icon is looked up, never guessed', () => {
  const kid = (c: Captured) =>
    toSpecs([{ kind: 'section', children: [c] }] as Captured[], {})[0]?.children![0].children![0];

  it('resolves the id every icon set writes, and the Line/Fill variants', () => {
    expect(kid({ kind: 'icon', name: 'ri-search-line' })).toMatchObject({ specials: { name: 'SearchLine' } });
    expect(kid({ kind: 'icon', name: 'lucide-menu' })).toMatchObject({ specials: { name: 'MenuLine' } });
    expect(kid({ kind: 'icon', name: 'fa-twitter' })).toMatchObject({ specials: { name: 'TwitterLine' } });
    expect(kid({ kind: 'icon', name: 'ri-twitter-x-fill' })).toMatchObject({ specials: { name: 'TwitterXFill' } });
    expect(kid({ kind: 'icon', name: 'Search' })).toMatchObject({ specials: { name: 'SearchLine' } });
  });

  it('drops a name this platform does not hold rather than inventing one', () => {
    // A WRONG icon is worse than none — "Acme Store" resolving to a shop glyph
    // where a wordmark was is indistinguishable from a right answer to
    // everything downstream. There is deliberately no last-word fallback.
    expect(kid({ kind: 'icon', name: 'Acme Store' })).toBeUndefined();
    expect(kid({ kind: 'icon', name: 'Open main menu' })).toBeUndefined();
    expect(kid({ kind: 'icon', name: '' })).toBeUndefined();
  });

  it('sets no colour, so an imported icon still follows the theme', () => {
    // The colour lives in the `icon-default` style preset; a literal on the node
    // outranks it permanently and the next palette change moves every other icon
    // and not this one.
    expect(kid({ kind: 'icon', name: 'ri-home-line' })).toEqual({
      type: 'icon',
      specials: { name: 'HomeLine' },
    });
  });
});

describe('a details list becomes an accordion', () => {
  it('one container, one accordion-content per question, the summary as its label', () => {
    const spec = toSpecs(
      [{
        kind: 'section',
        children: [{
          kind: 'accordion',
          children: [
            { kind: 'accordion-item', text: 'Câu một', children: [{ kind: 'text', text: 'Đáp một' }] },
            { kind: 'accordion-item', text: 'Câu hai', children: [{ kind: 'text', text: 'Đáp hai' }] },
          ],
        }],
      }] as Captured[],
      {},
    );
    const acc = spec[0].children![0].children![0];
    expect(acc.type).toBe('accordion');
    expect(acc.children!.map((c) => [c.type, c.specials?.label])).toEqual([
      ['accordion-content', 'Câu một'],
      ['accordion-content', 'Câu hai'],
    ]);
    expect(acc.children![0].children![0]).toMatchObject({ type: 'text' });
  });

  it('omits the label when the source had no summary, rather than inventing English', () => {
    const acc = toSpecs(
      [{ kind: 'section', children: [{ kind: 'accordion', children: [
        { kind: 'accordion-item', children: [{ kind: 'text', text: 'Chỉ có thân' }] },
      ] }] }] as Captured[],
      {},
    )[0].children![0].children![0];
    expect(acc.children![0].specials).toBeUndefined();
  });
});

describe('an import lands inside the middle band', () => {
  function pageWithGlobals() {
    const d = emptyDoc();
    d.apply(
      addSubtree(d, 'ROOT', { type: 'flex-section', name: 'header' }).patches,
    );
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', name: 'footer' }).patches,);
    const [header, footer] = d.node('ROOT').data.nodes;
    // Stamped the way the platform stamps a composed master.
    d.apply([
      { op: 'set', path: ['nodes', header, 'specials', 'globalId'], value: 'g1' },
      { op: 'set', path: ['nodes', header, 'specials', 'globalKind'], value: 'header' },
      { op: 'set', path: ['nodes', footer, 'specials', 'globalId'], value: 'g2' },
      { op: 'set', path: ['nodes', footer, 'specials', 'globalKind'], value: 'footer' },
    ] as Patch[]);
    return d;
  }

  it('appending to ROOT would break the band order — this is the trap, stated', () => {
    const d = pageWithGlobals();
    const naive = d.preview([]);
    naive.apply(addSubtree(naive, 'ROOT', { type: 'flex-section' }).patches);
    expect(checkBandOrder(naive.doc)).toMatch(/after a global footer/);
  });

  it('so content goes in at middleEnd — before the footer, after the header', () => {
    const d = pageWithGlobals();
    const at = middleEnd(d.doc);
    expect(at).toBe(1);
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section' }, at).patches);
    expect(checkBandOrder(d.doc)).toBeNull();
    expect(validateForSave(d)).toEqual([]);
    // Header first, imported section second, footer last.
    expect(d.node('ROOT').data.nodes.length).toBe(3);
    expect(d.node(d.node('ROOT').data.nodes[2]).specials?.globalKind).toBe('footer');
  });

  it('a page with no footer still appends at the end', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section' }).patches);
    expect(middleEnd(d.doc)).toBe(1);
  });
});

/**
 * THE CRAWL, AGAINST A REAL SERVER.
 *
 * `capturePage` and `linksOnPage` are SERIALIZED into the browser, so anything
 * they close over is not there on the other side — it compiles, every pure test
 * passes, and it dies on the first real page (measured once already, as
 * `ReferenceError: HEADINGS is not defined`). Nothing cheaper than a browser
 * catches it, so every evaluate site in this repo has a test here.
 *
 * A LOCAL SERVER rather than the `data:` URLs the capture tests use: a data page
 * has no origin, so `new URL('/a', base)` throws there and a crawl of one would
 * find nothing at all — which is a property of the fixture, not of the crawl.
 */
describe.runIf(process.env.SB_BROWSER_TEST === '1')('crawlLinks() and captureMany()', () => {
  const pages: Record<string, string> = {
    '/':
      '<title>Trang chủ | Cửa hàng</title><main><section><h1>Trang chủ</h1>' +
      '<a href="/a">A</a><a href="/a/">A lần nữa</a><a href="/b">B</a>' +
      '<a href="https://elsewhere.example/x">Ngoài</a>' +
      '<a href="/tai-lieu.pdf">PDF</a><a href="/cart">Giỏ</a>' +
      '<a href="/dup">A dưới tên khác</a>' +
      '</section></main>',
    '/a': '<title>Trang A</title><main><section><h2>Trang A</h2><p>Nội dung A.</p></section></main>',
    '/b': '<title>Trang B</title><main><section><h2>Trang B</h2><a href="/c">C</a></section></main>',
    // `/dup` is `/a` under a second address: the crawl must not import it twice.
    '/dup':
      '<title>Bản sao</title><link rel="canonical" href="/a">' +
      '<main><section><h2>Trang A</h2></section></main>',
    '/c': '<title>Trang C</title><main><section><h2>Trang C</h2><p>Sâu hai tầng.</p></section></main>',
  };

  let base = '';
  let server: ReturnType<typeof createServer>;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0].replace(/\/$/, '') || '/';
      const body = pages[path];
      res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body ?? 'not found');
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((ok) => server.close(() => ok()));
  });

  it('walks the site\'s own links, in ONE spelling, and spends nothing on what cannot be a page', async () => {
    const got = await crawlLinks(`${base}/`, { depth: 2, maxVisits: 10, canon: canonFor(`${base}/`) });
    expect([...got.urls].sort()).toEqual([`${base}/`, `${base}/a`, `${base}/b`, `${base}/c`, `${base}/dup`]);
    // /a and /a/ are one page; the PDF, the cart and the other site are not this
    // crawl's to visit — and each of them would have cost a navigation.
    expect(got.visited).toBe(4);
    // AND `/dup` SAYS IT IS `/a`. Recorded rather than acted on in the crawl: it
    // is still walked for its links, and the caller folds the two when it builds
    // the plan.
    expect(got.canonical.get(`${base}/dup`)).toBe(`${base}/a`);
    // The crawl opened the entry to read its links and got its `<title>` for
    // free — which is the name the plan shows, rather than one derived from a
    // slug.
    expect(got.titles.get(`${base}/`)).toBe('Trang chủ | Cửa hàng');
  }, 60_000);

  it('depth is what decides how far from the entry a page may be', async () => {
    const shallow = await crawlLinks(`${base}/`, { depth: 1, maxVisits: 10, canon: canonFor(`${base}/`) });
    expect(shallow.urls).not.toContain(`${base}/c`);
    const deep = await crawlLinks(`${base}/`, { depth: 2, maxVisits: 10, canon: canonFor(`${base}/`) });
    expect(deep.urls).toContain(`${base}/c`);
  }, 120_000);

  it('a page that will not open is an outcome, not the end of the run', async () => {
    // Half the reason to import a site rather than a page is that the caller does
    // not know what is at each URL. Throwing would discard everything that read
    // fine and leave nothing to act on.
    const got = await captureMany([`${base}/a`, 'http://127.0.0.1:1/nope']);
    expect(got[0].ok).toBe(true);
    expect(got[0].ok && got[0].result.sections.length).toBe(1);
    expect(got[1].ok).toBe(false);
    expect(got[1].ok === false && got[1].why.length).toBeGreaterThan(0);
  }, 60_000);
});

/**
 * WHAT A REAL SHOP LOOKS LIKE, and the four ways an import used to lose it.
 *
 * Measured on ttgshop.vn — a PC shop with 2,856 divs, 602 paragraphs, 110
 * headings and 100 images. Before these four, the import kept 0% of its
 * content: the document's only two `<section>` elements are a BREADCRUMB and
 * one more, the selector privileged `<section>` absolutely, and because a
 * breadcrumb is not an EMPTY result nothing fell back. A shop imported as its
 * own breadcrumb, with no error at any step.
 */
// A CAPTURE LAUNCHES ITS OWN CHROME, deliberately — `capture.ts` does not share
// the pooled browser a vision loop keeps warm, because an import is rare, slow
// and runs untrusted script. So each of these pays a launch, and the 5s default
// assumes none: under parallel load one of them ran over and failed a suite
// that was otherwise green. The timeout is the honest number for what the test
// actually does, not a way to quieten a real failure.
const BROWSER_TIMEOUT = 30_000;
describe.runIf(process.env.SB_BROWSER_TEST === '1')('capture() on a shop-shaped page', () => {
  const shop = `data:text/html,${encodeURIComponent(
    '<body>' +
      // The page's only <section> is a breadcrumb, exactly as the real shop.
      '<section class="crumb"><span>Trang chủ</span></section>' +
      '<div class="homepage"><div class="container">' +
      '<div class="band"><h2>PC GAMING</h2>' +
      // The open tab.
      '<div class="panel"><div class="p-item">' +
      '<img data-src="/media/pc-1.jpg" alt="PC một" style="width:40px;height:40px">' +
      '<p class="price">69.980.000 VNĐ</p>' +
      '<button class="btn" style="background:#e33;display:block">Mua ngay</button>' +
      '</div></div>' +
      // The tabs nobody clicked: display:none, beside a visible peer.
      '<div class="panel" style="display:none"><div class="p-item">' +
      '<img data-src="/media/pc-2.jpg" alt="PC hai" style="width:40px;height:40px">' +
      '<p class="price">10.280.000 VNĐ</p>' +
      '</div></div>' +
      '<div class="panel" style="display:none"><div class="p-item">' +
      '<p class="price">1.490.000 VNĐ</p></div></div>' +
      '</div></div></div>' +
      // A modal has NO visible peer, so it must stay hidden.
      '<div style="display:none"><p>Bản tin — đăng ký ngay để nhận ưu đãi</p></div>' +
      '</body>',
  )}`;

  const strings = (got: Awaited<ReturnType<typeof capture>>): string => JSON.stringify(got.sections);

  it('does not import a shop as its breadcrumb', async () => {
    // The fallback has to fire on a DERISORY result, not only an empty one:
    // "we captured something" is not "we captured the page".
    const got = await capture(shop, { maxImages: 20, maxNodes: 400 });
    expect(strings(got)).toContain('69.980.000');
  }, BROWSER_TIMEOUT);

  it('reads the image a lazy loader parked in data-src', async () => {
    // 84 of ttgshop.vn's 100 images carry data-src and no src, and those 84 are
    // the product photos. Reading src alone imported a shop with a sixth of its
    // pictures and blamed the page for the rest.
    const got = await capture(shop, { maxImages: 20, maxNodes: 400 });
    expect(strings(got)).toContain('pc-1.jpg');
    expect(got.skipped['image-without-src']).toBeUndefined();
  }, BROWSER_TIMEOUT);

  it('opens the TABS NOBODY CLICKED, which on a shop is most of the catalogue', async () => {
    // Same sentence as the <details> pass: the source's collapsed state is not
    // content. 73% of the real page's text sat in panels carrying display:none.
    const got = await capture(shop, { maxImages: 20, maxNodes: 400 });
    expect(strings(got)).toContain('10.280.000');
    expect(strings(got)).toContain('1.490.000');
    expect(strings(got)).toContain('pc-2.jpg');
  }, BROWSER_TIMEOUT);

  it('leaves a modal hidden, because a panel is known by its VISIBLE PEER', async () => {
    // Unhiding whatever is hidden is how an import grows a newsletter pop-up and
    // a navigation drawer in the middle of a page. What marks a panel is that it
    // sits beside a peer of the same kind that IS shown.
    const got = await capture(shop, { maxImages: 20, maxNodes: 400 });
    expect(strings(got)).not.toContain('đăng ký ngay');
  }, BROWSER_TIMEOUT);

  it('captures a real <button>, which on a shop is the whole point of the page', async () => {
    // BUTTON was filed with the form controls, on reasoning that fits `input`
    // and does not fit it: 27 dropped in one capture of the real shop, every
    // "Mua ngay" among them. A button inside a form is still unreachable — that
    // branch returns without walking its children.
    const got = await capture(shop, { maxImages: 20, maxNodes: 400 });
    expect(strings(got)).toContain('Mua ngay');
  }, BROWSER_TIMEOUT);
});

/**
 * A SET OF PANELS WITH A BUTTON ROW IS A `tab`, and the labels decide it.
 *
 * The platform synthesizes a tab's whole button row from each `tab-content`
 * child's `specials.label`, so a tab without labels is a stack of panels
 * wearing a control nobody can use. That makes "can the labels be read" both
 * the right question and the right DISCRIMINATOR — the panel-set stamp also
 * lands on a product grid that happens to hide one card, and a label row is
 * exactly what that grid has not got.
 */
describe.runIf(process.env.SB_BROWSER_TEST === '1')('capture() reading tabs', () => {
  // charset=utf-8 or the Vietnamese arrives as mojibake and every label
  // assertion compares two different strings.
  const page = (bar: string, panels: string) =>
    `data:text/html;charset=utf-8,${encodeURIComponent(`<body><div class="wrap">${bar}${panels}</div></body>`)}`;

  const kinds = (got: Awaited<ReturnType<typeof capture>>): string[] => {
    const out: string[] = [];
    const walk = (c: { kind: string; children?: unknown[] }): void => {
      out.push(c.kind);
      for (const k of (c.children ?? []) as typeof c[]) walk(k);
    };
    for (const s of got.sections) walk(s as never);
    return out;
  };
  const tabOf = (got: Awaited<ReturnType<typeof capture>>): { children?: Array<{ text?: string }> } | null => {
    let found: never | null = null;
    const walk = (c: { kind: string; children?: unknown[] }): void => {
      if (c.kind === 'tab') found = c as never;
      for (const k of (c.children ?? []) as typeof c[]) walk(k);
    };
    for (const s of got.sections) walk(s as never);
    return found;
  };

  it('pairs a panel with its button through ARIA, which says it outright', async () => {
    const got = await capture(
      page(
        '<div role="tablist"><button role="tab" aria-controls="p1">Máy tính</button>' +
          '<button role="tab" aria-controls="p2">Màn hình</button></div>',
        '<div id="p1"><p>Nội dung máy tính ở đây.</p></div>' +
          '<div id="p2" style="display:none"><p>Nội dung màn hình ở đây.</p></div>',
      ),
      { maxImages: 5, maxNodes: 200 },
    );
    expect(kinds(got)).toContain('tab');
    expect(tabOf(got)!.children!.map((c) => c.text)).toEqual(['Máy tính', 'Màn hình']);
  }, BROWSER_TIMEOUT);

  it('pairs through a SHARED data-* value, which is how most tab scripts wire up', async () => {
    const got = await capture(
      page(
        '<ul><li><button data-id="7">Khuyến mãi</button></li>' +
          '<li><button data-id="9">Hàng mới</button></li></ul>',
        '<div data-id="7"><p>Các sản phẩm khuyến mãi.</p></div>' +
          '<div data-id="9" style="display:none"><p>Các sản phẩm mới về.</p></div>',
      ),
      { maxImages: 5, maxNodes: 200 },
    );
    // Deliberately out of document order relative to the bar: a shared value
    // survives reordering, which is the reason it outranks position.
    expect(tabOf(got)!.children!.map((c) => c.text)).toEqual(['Khuyến mãi', 'Hàng mới']);
  }, BROWSER_TIMEOUT);

  it('falls back to POSITION only when the row holds exactly as many items', async () => {
    const got = await capture(
      page(
        '<ul><li><button>Một</button></li><li><button>Hai</button></li></ul>',
        '<div class="pane"><p>Nội dung thứ nhất.</p></div>' +
          '<div class="pane" style="display:none"><p>Nội dung thứ hai.</p></div>',
      ),
      { maxImages: 5, maxNodes: 200 },
    );
    expect(tabOf(got)!.children!.map((c) => c.text)).toEqual(['Một', 'Hai']);
  }, BROWSER_TIMEOUT);

  it('IS NOT A TAB WITHOUT LABELS — and keeps every panel as content anyway', async () => {
    // ttgshop.vn is this case: its tab buttons are empty in the DOM and filled
    // by script. Deriving a label from the `data-url` slug was available and
    // refused — a Vietnamese slug comes back stripped of its diacritics, which
    // is the invented-copy defect this repo reports on everybody else's seeds.
    const got = await capture(
      page(
        '<ul><li><button data-url="/collection/hot-sale"></button></li>' +
          '<li><button data-url="/collection/moi"></button></li></ul>',
        '<div data-id="7"><p>Sản phẩm khuyến mãi.</p></div>' +
          '<div data-id="9" style="display:none"><p>Sản phẩm mới về.</p></div>',
      ),
      { maxImages: 5, maxNodes: 200 },
    );
    expect(kinds(got)).not.toContain('tab');
    const json = JSON.stringify(got.sections);
    expect(json).toContain('Sản phẩm khuyến mãi');
    expect(json).toContain('Sản phẩm mới về');
  }, BROWSER_TIMEOUT);
});

describe('a panel set becomes a tab', () => {
  const build = (children: Captured[]): ReturnType<typeof toSpecs> =>
    toSpecs([{ kind: 'section', children: [{ kind: 'tab', children }] }] as Captured[], {});

  it('one tab container, one tab-content per panel, the button text as its label', () => {
    // The platform synthesizes the whole button row from these labels
    // (render/nodes/tab/html.go), so the label is not decoration — it is the
    // only way a visitor reaches the panel.
    const spec = build([
      { kind: 'tab-item', text: 'Máy tính', children: [{ kind: 'text', text: 'Nội dung một' }] },
      { kind: 'tab-item', text: 'Màn hình', children: [{ kind: 'text', text: 'Nội dung hai' }] },
    ] as Captured[]);
    const tab = spec[0].children![0].children![0];
    expect(tab.type).toBe('tab');
    expect(tab.children).toHaveLength(2);
    expect(tab.children!.map((c) => c.type)).toEqual(['tab-content', 'tab-content']);
    expect(tab.children![0].specials).toEqual({ label: 'Máy tính' });
  });

  it('DROPS AN UNLABELLED PANEL, which is stricter than the accordion beside it', () => {
    // accordion-content seeds its own summary, so an unlabelled one still
    // opens. `tab` builds its button row from the labels, so an unlabelled
    // panel is one the visitor has no way to reach at all.
    const spec = build([
      { kind: 'tab-item', text: 'Có nhãn', children: [{ kind: 'text', text: 'Một' }] },
      { kind: 'tab-item', children: [{ kind: 'text', text: 'Hai' }] },
      { kind: 'tab-item', text: 'Cũng có', children: [{ kind: 'text', text: 'Ba' }] },
    ] as Captured[]);
    const tab = spec[0].children![0].children![0];
    expect(tab.children!.map((c) => c.specials)).toEqual([{ label: 'Có nhãn' }, { label: 'Cũng có' }]);
  });

  it('is no tab at all below two panels — one pane under a button is a heading', () => {
    const spec = build([
      { kind: 'tab-item', text: 'Một mình', children: [{ kind: 'text', text: 'Nội dung' }] },
    ] as Captured[]);
    expect(JSON.stringify(spec)).not.toContain('"tab"');
  });
});

/**
 * SETTLING IS NOT FAILING, which is the one outcome a capture could not express.
 *
 * A page read while it is still building returns a small, correct-looking
 * result: `skipped` empty, no error, a handful of nodes. MEASURED on ttgshop.vn
 * while the origin was taking 45 SECONDS to answer — 6 text nodes and 114
 * characters — and nothing in the answer said the import was thin. A thin
 * import that says so is one a caller retries; a silent one ships.
 *
 * The denominator is the honest one this file already argues for: page chrome
 * is skipped ON PURPOSE, so counting it would make every correct import of a
 * nav-heavy site look broken.
 */
describe.runIf(process.env.SB_BROWSER_TEST === '1')('capture() reporting how much it kept', () => {
  const page = (body: string) => `data:text/html;charset=utf-8,${encodeURIComponent(body)}`;

  it('reports a high number when it took the page', async () => {
    const got = await capture(
      page('<body><main><section><p>Một đoạn văn khá dài để đo đạc cho tử tế.</p>' +
        '<p>Và một đoạn nữa, cũng dài không kém gì đoạn ở trên kia.</p></section></main></body>'),
      { maxImages: 5, maxNodes: 200 },
    );
    expect(got.coverage).toBeGreaterThan(80);
  }, BROWSER_TIMEOUT);

  it('DOES NOT COUNT PAGE CHROME against the result', async () => {
    // A nav-heavy site imported correctly must not look like a failure: the
    // header and footer are skipped deliberately, so they are not in the
    // denominator either.
    const got = await capture(
      page(
        '<body><header><nav><a href="/a">Trang chủ</a><a href="/b">Giới thiệu</a>' +
          '<a href="/c">Sản phẩm</a><a href="/d">Liên hệ</a></nav></header>' +
          '<main><section><p>Nội dung thật của trang nằm ở đây.</p></section></main>' +
          '<footer><p>Bản quyền và một dòng dài dằng dặc ở chân trang.</p></footer></body>',
      ),
      { maxImages: 5, maxNodes: 200 },
    );
    expect(got.coverage).toBeGreaterThan(70);
  }, BROWSER_TIMEOUT);

  /**
   * THE DENOMINATOR USED A NARROWER CHROME RULE THAN THE WALK DID.
   *
   * `inPageChrome` recognises a footer by TAG *or* by a class/id starting
   * with `footer` — deliberately, since blender.org's site map carried no
   * `<footer>` tag at all. The walk honours that and skips a
   * `class="footer-…"` div correctly. The coverage denominator did not: it
   * re-derived chrome with its own `querySelectorAll('header, nav, footer')`
   * and filtered by tag, so a class-only footer was counted as real content
   * lost — even though the walk never touched it. MEASURED on
   * rust-lang.org this way: reported 92% while having lost nothing.
   */
  it('does not count a footer-shaped DIV against the denominator', async () => {
    const got = await capture(
      page(
        '<body><div class="footer-navigation">' +
          '<a href="/a">Điều khoản dịch vụ và chính sách bảo mật của chúng tôi về dữ liệu khách hàng</a>' +
          '<a href="/b">Chính sách đổi trả hàng hóa trong vòng ba mươi ngày kể từ khi nhận hàng</a>' +
          '<a href="/c">Hướng dẫn thanh toán và giao nhận hàng trên toàn quốc mọi lúc mọi nơi</a>' +
          '</div>' +
          '<main><section><p>Nội dung thật của trang nằm ở đây và được giữ nguyên vẹn không mất gì cả.</p></section></main></body>',
      ),
      { maxImages: 5, maxNodes: 200 },
    );
    expect(got.coverage).toBeGreaterThanOrEqual(97);
  }, BROWSER_TIMEOUT);

  /**
   * A LIST'S WORDS ARE WORDS. `textOf` counted `c.text` alone and a list
   * Captured carries `items: string[]` and never a `text`, so every list scored
   * ZERO. MEASURED on ttgshop.vn/quy-dinh-bao-hanh: 800 characters counted
   * against 4,012 characters of list, reported 28% for a capture that had taken
   * the page nearly whole.
   *
   * It is not only the report. The same measure decides whether the wider-root
   * fallback runs at all, and then which of the two trees WINS — so a correct
   * capture full of lists loses to a worse one made of paragraphs.
   */
  it('counts the words inside a list', async () => {
    const got = await capture(
      page(
        '<body><main><section><h2>Điều kiện bảo hành</h2><ul>' +
          '<li>Sản phẩm còn trong thời hạn bảo hành của nhà sản xuất.</li>' +
          '<li>Tem bảo hành còn nguyên vẹn, không rách, không tẩy xóa.</li>' +
          '<li>Ngoại hình không bị va đập, không có dấu hiệu vào nước.</li>' +
          '<li>Có đầy đủ hộp và phụ kiện đi kèm theo sản phẩm.</li>' +
          '</ul></section></main></body>',
      ),
      { maxImages: 5, maxNodes: 200 },
    );
    expect(got.sections.flatMap((s) => s.children ?? []).some((c) => c.kind === 'list')).toBe(true);
    expect(got.coverage).toBeGreaterThan(80);
  }, BROWSER_TIMEOUT);

  /**
   * THE NUMERATOR AND THE DENOMINATOR ARE NOT THE SAME UNITS.
   *
   * `kept` sums each node's own cleaned text, concatenated with no separator
   * between blocks. `contentChars` is `body.innerText.length`, which DOES carry
   * a newline (or more) between every block-level element. A page made of many
   * separate blocks — every one of them kept, nothing dropped — reads under
   * 100% anyway, and the gap widens with the block count rather than with
   * anything actually missing. MEASURED against a whitespace-free ratio:
   * rust-lang.org read 90% while having lost nothing.
   */
  it('reports at or near 100 for many separate blocks, all of them kept', async () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => `<p>Đoạn ${i}.</p>`).join('');
    const got = await capture(page(`<body><main><section>${paragraphs}</section></main></body>`), {
      maxImages: 5,
      maxNodes: 200,
    });
    expect(got.skipped).toEqual({});
    expect(got.coverage).toBeGreaterThanOrEqual(97);
  }, BROWSER_TIMEOUT);

  it('never answers more than 100', async () => {
    // A caller reads this as a percentage and acts on it; a number above 100
    // reads as a broken measure and makes the honest ones untrustworthy too.
    const got = await capture(
      page('<body><main><section><ul><li>Một</li><li>Hai</li><li>Ba</li></ul></section></main></body>'),
      { maxImages: 5, maxNodes: 200 },
    );
    expect(got.coverage).toBeLessThanOrEqual(100);
  }, BROWSER_TIMEOUT);

  it('answers 100 for a page with no text to measure against', async () => {
    // Not 0: an empty page is not a failed import, and a zero here would send a
    // caller to fix something that is already right.
    const got = await capture(page('<body><main><section><hr></section></main></body>'), {
      maxImages: 5,
      maxNodes: 200,
    });
    expect(got.coverage).toBe(100);
  }, BROWSER_TIMEOUT);
});

describe.runIf(process.env.SB_BROWSER_TEST === '1')('capture() sampling the source design', () => {
  const page = (body: string) => `data:text/html;charset=utf-8,${encodeURIComponent(body)}`;

  it('samples the computed colour, size and weight of a heading', async () => {
    const got = await capture(
      page(
        '<body style="background:#fffaf5"><main><section>' +
          '<h1 style="color:#b3123a;font-size:44px;font-weight:800">Tiêu đề</h1>' +
          '<p style="color:#4b5563;font-size:17px">Một đoạn văn để đo.</p>' +
          '</section></main></body>',
      ),
      { maxImages: 5, maxNodes: 200 },
    );
    const flat: Captured[] = [];
    const walk = (c: Captured): void => {
      flat.push(c);
      for (const k of c.children ?? []) walk(k);
    };
    got.sections.forEach(walk);

    const heading = flat.find((c) => c.kind === 'heading');
    expect(heading?.sample?.color).toBe('rgb(179, 18, 58)');
    expect(heading?.sample?.fontSize).toBe('44px');
    expect(heading?.sample?.fontWeight).toBe('800');

    const text = flat.find((c) => c.kind === 'text');
    expect(text?.sample?.color).toBe('rgb(75, 85, 99)');
    expect(text?.sample?.fontSize).toBe('17px');
  }, BROWSER_TIMEOUT);

  it('samples a painted button\'s fill and radius', async () => {
    const got = await capture(
      page(
        '<body><main><section>' +
          '<a href="/x" style="display:block;background:#b3123a;color:#fff;border-radius:999px;padding:12px 28px">Mua ngay</a>' +
          '</section></main></body>',
      ),
      { maxImages: 5, maxNodes: 200 },
    );
    const flat: Captured[] = [];
    const walk = (c: Captured): void => {
      flat.push(c);
      for (const k of c.children ?? []) walk(k);
    };
    got.sections.forEach(walk);
    const button = flat.find((c) => c.kind === 'button');
    expect(button?.sample?.backgroundColor).toBe('rgb(179, 18, 58)');
    expect(button?.sample?.borderRadius).toBe('999px');
  }, BROWSER_TIMEOUT);

  it('DOES NOT change what the mapper produces', async () => {
    // The samples are observations for Task 2. `toSpecs` must go on ignoring
    // them: stamping a source colour onto a node is P3's decision, and if it
    // leaked in here every imported node would silently detach from its preset.
    const got = await capture(
      page('<body><main><section><h1 style="color:#b3123a">Tiêu đề</h1></section></main></body>'),
      { maxImages: 5, maxNodes: 200 },
    );
    const specs = toSpecs(got.sections, {});
    expect(JSON.stringify(specs)).not.toContain('b3123a');
    expect(JSON.stringify(specs)).not.toContain('179, 18, 58');
  }, BROWSER_TIMEOUT);
});

describe('sb_import_site — the theme patch', () => {
  it('names only the roles the source expressed', () => {
    const patch = themePatchFor(
      sourceTokens([
        {
          kind: 'section',
          children: [
            { kind: 'heading', level: 1, text: 'A', sample: { color: 'rgb(179, 18, 58)', fontSize: '44px' } },
            { kind: 'text', text: 'b', sample: { color: 'rgb(75, 85, 99)', fontSize: '17px' } },
          ],
        },
      ]),
    );
    expect(patch).not.toBeNull();
    expect(patch!.colors).toEqual({ heading: '#b3123a', text: '#4b5563' });
    expect('primary' in patch!.colors).toBe(false);
    expect(patch!.text_styles['heading-1'].fontSize).toBe('44px');
  });

  it('sends nothing at all when the source expressed no design', () => {
    // A patch of `{}` against a replace-only endpoint is the shape that once
    // let a site lose its whole palette. Sending no request is the right answer.
    const patch = themePatchFor(sourceTokens([]));
    expect(patch).toBeNull();
  });

  it('drops fontFamily and converts lineHeight to a percentage of the sample\'s own fontSize', () => {
    // getComputedStyle hands back a whole CSS stack for fontFamily (or a
    // bundler's mangled name) and a resolved PX lineHeight — neither is what
    // the starter's text-style slots hold (a bare registered name; a
    // percentage paired with a separate mobile fontSize this patch never
    // touches), so writing either verbatim would detach the target site from
    // its own font registration and pin its leading to the wrong scale.
    const patch = themePatchFor(
      sourceTokens([
        {
          kind: 'section',
          children: [
            {
              kind: 'heading',
              level: 1,
              text: 'A',
              sample: {
                color: 'rgb(179, 18, 58)',
                fontSize: '44px',
                lineHeight: '57.2px',
                fontFamily: '__Inter_e8ce0c, __Inter_Fallback_e8ce0c, sans-serif',
              },
            },
          ],
        },
      ]),
    );
    expect(patch).not.toBeNull();
    const h1 = patch!.text_styles['heading-1'];
    expect(h1.fontFamily).toBeUndefined();
    expect(h1.lineHeight).toBe('130%'); // 57.2 / 44 = 1.3
  });
});

describe('applyThemePatch — a token the site theme does not carry', () => {
  const theme = (): StarterTheme => ({
    version: 6,
    colors: [{ id: 'heading', name: 'Heading', value: '#111827' }],
    textStyles: [{ slug: 'heading-1', name: 'H1', base: { fontSize: '40px' } }],
    schemes: [{ id: 'light', name: 'Light' }],
    presets: [],
  });

  it('SKIPS a colour id and a text-style slug the theme lacks, and NAMES both', () => {
    // The site's theme has no `text` colour role and no `heading-2` slug —
    // `SourceTokens`' vocabulary is closed, so this cannot be a typo, only a
    // narrower theme. Refusing the whole write over it would throw away the
    // `heading` colour that DID match.
    const { changes, skipped } = applyThemePatch(theme(), {
      colors: { heading: '#b3123a', text: '#4b5563' },
      text_styles: { 'heading-1': { fontSize: '44px' }, 'heading-2': { fontSize: '32px' } },
    });
    expect(changes).toEqual([
      { what: 'colors.heading', from: '#111827', to: '#b3123a' },
      { what: 'textStyles.heading-1.fontSize', from: '40px', to: '44px' },
    ]);
    expect(skipped).toEqual(['colors.text', 'textStyles.heading-2']);
  });

  it('reports nothing lost when every token in the patch matched', () => {
    const { skipped } = applyThemePatch(theme(), {
      colors: { heading: '#b3123a' },
      text_styles: {},
    });
    expect(skipped).toEqual([]);
  });

  // The caller used to be the one required to clone before calling this —
  // "never pass the live document" was a comment, not a guarantee. A future
  // caller that forgot and passed `siteTheme`'s cached STARTER_THEME (held
  // by reference) would corrupt that module constant for the rest of the
  // process. Cloning INSIDE the function removes the way to get this wrong.
  it('never mutates the theme it was given — the caller gets a fresh clone back', () => {
    const input = theme();
    const { theme: draft } = applyThemePatch(input, {
      colors: { heading: '#b3123a' },
      text_styles: { 'heading-1': { fontSize: '44px' } },
    });
    expect(input.colors[0].value).toBe('#111827');
    expect(input.textStyles[0].base?.fontSize).toBe('40px');
    expect(draft).not.toBe(input);
    expect(draft.colors[0].value).toBe('#b3123a');
    expect(draft.textStyles[0].base?.fontSize).toBe('44px');
  });
});
