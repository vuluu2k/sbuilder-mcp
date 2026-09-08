import { chromium, type Browser, type Page } from 'playwright-core';
import { settleDom } from './shoot.js';
import type { Captured } from '../domains/site/importmap.js';

/**
 * READ SOMEBODY ELSE'S PAGE, and hand back only what this platform can render.
 *
 * The reduction happens IN THE PAGE, not here, and that is the whole design: a
 * browser hands back arbitrary markup, this platform renders a fixed catalog,
 * and shipping the raw DOM across the boundary would mean doing the translation
 * against a structure nothing can test. What crosses is six kinds of node.
 *
 * It is a SEPARATE browser launch from `shoot.ts`'s. That module keeps one
 * browser for the life of the process because a vision loop shoots constantly;
 * an import happens once and should not hold a tab open afterwards, and sharing
 * the instance would couple a rare, slow, untrusted-page operation to the one
 * that has to stay at 400ms.
 *
 * UNTRUSTED INPUT. The page being read belongs to someone else: its scripts run
 * (they have to, or a client-rendered page captures as an empty shell), so the
 * launch is sandboxed to a fresh context with no storage of its own, and nothing
 * it returns is ever executed — the strings become node content and are escaped
 * by the platform's own renderer like any other authored text.
 */

/**
 * THE DOM, declared as narrowly as this file uses it.
 *
 * `shoot.ts` does the same and for the same reason: pulling `lib.dom` into the
 * compiler makes every browser global visible in SERVER code, where touching one
 * is a crash rather than a type error. The shim is the contract this file may
 * rely on, and nothing more.
 */
interface El {
  tagName: string;
  className: unknown;
  textContent: string | null;
  children: ArrayLike<El>;
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): ArrayLike<El>;
  getBoundingClientRect(): { width: number; height: number };
  contains(other: El): boolean;
}
declare const document: {
  title: string;
  body: El;
  querySelectorAll(selector: string): ArrayLike<El>;
};
declare function getComputedStyle(el: El): {
  display: string;
  visibility: string;
  opacity: string;
  backgroundColor: string;
  borderStyle: string;
  borderWidth: string;
  flexDirection: string;
  flexWrap: string;
  position: string;
};
declare const location: { href: string };

export interface CaptureResult {
  url: string;
  title: string;
  sections: Captured[];
  /** What was skipped and why, so a thin capture explains itself. */
  skipped: Record<string, number>;
}

/**
 * The in-page walk, as a string the browser evaluates.
 *
 * Written as one function rather than composed helpers because it is
 * serialized: anything it closes over does not exist on the other side.
 */
function capturePage(limits: { maxSections: number; maxImages: number; maxTextChars: number; maxNodes: number }): CaptureResult {
  // EVERY constant this function uses is declared INSIDE it. The body is
  // serialized and evaluated in the page, so a module-level `const` it closes
  // over is simply not there — caught the first time this ran against a real
  // page, as `ReferenceError: HEADINGS is not defined`, by which point the file
  // already carried a comment saying exactly that.
  const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  const taken = { images: 0, nodes: 0 };
  const skipped: Record<string, number> = {};
  const skip = (why: string): void => void (skipped[why] = (skipped[why] ?? 0) + 1);
  const here = location.href;

  const visible = (el: El): boolean => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const clean = (s: string | null): string => (s ?? '').replace(/\s+/g, ' ').trim();

  // ABSOLUTE where it can be, RAW where it cannot. `new URL(rel, base)` throws
  // when the base is not hierarchical — a `data:` page is the case that reaches
  // this — and a throw inside `evaluate` kills the whole capture rather than one
  // link. A relative href that survives as-is is a link this site cannot follow;
  // a capture that died is a page nobody imported.
  const abs = (v: string): string => {
    try {
      return new URL(v, here).href;
    } catch {
      return v;
    }
  };

  // A link is a BUTTON when it looks like one: a class saying so, or a short
  // label in a box with a background. Everything else is prose with a link in
  // it, and turning those into buttons produces a page of buttons.
  const looksLikeButton = (el: El): boolean => {
    const t = clean(el.textContent);
    if (t.length === 0 || t.length > 32) return false;
    const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
    if (/\b(btn|button|cta)\b/.test(cls)) return true;
    // A SHORT BLOCK-LEVEL LINK IS USUALLY NAVIGATION, not a call to action. The
    // rule used to stop at "not inline" and a documentation sidebar came back as
    // 38 buttons — a page of pink pills where the source had a list of links.
    // A real CTA is PAINTED: it has a fill or a border. Nav links have neither.
    const cs = getComputedStyle(el);
    const filled = cs.backgroundColor !== '' &&
      cs.backgroundColor !== 'transparent' &&
      !cs.backgroundColor.startsWith('rgba(0, 0, 0, 0)');
    // A BORDER NEEDS WIDTH, not just a style. Tailwind's preflight sets
    // `border-style: solid; border-width: 0` on every element, so "has a border
    // style" is true of an entire site built with it — which is how a
    // documentation sidebar came back as 38 buttons even after the first fix.
    const bordered =
      cs.borderStyle !== '' && cs.borderStyle !== 'none' && parseFloat(cs.borderWidth || '0') > 0;
    return cs.display !== 'inline' && (filled || bordered);
  };

  const IGNORE = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'IFRAME', 'CANVAS',
    'NAV', 'FORM', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON',
  ]);

  /**
   * The renderable content under one section, AS A TREE.
   *
   * It used to return a flat list, and flatness was the biggest thing an import
   * lost. A source's three-column feature row came back as three stacked blocks;
   * a card — image, heading, copy, button — came back as four siblings with
   * nothing saying they belonged together. Everything a reader understands from
   * the ARRANGEMENT was thrown away, and no amount of correct colour brings it
   * back.
   *
   * So a container that actually lays its children out — `display:flex` or
   * `grid` — and has two or more of them that produced something becomes a
   * GROUP carrying its direction. Anything else flattens, because a `<div>` that
   * merely wraps is not a design decision and reproducing it would nest the
   * result ten deep for nothing.
   */
  const leaves = (root: El): Captured[] => {
    const walkChildren = (el: El): Captured[] => {
      const kids: Captured[] = [];
      for (const child of Array.from(el.children)) {
        for (const c of walk(child)) kids.push(c);
      }
      return kids;
    };
    const walk = (el: El): Captured[] => {
      // ONE BOUND, on the whole import. There used to be a second, per section,
      // and it kept doing the same wrong job under a new number: a page whose
      // <body> has a single child is ONE section, so the per-section cap became
      // the page cap and truncated it — news.ycombinator.com captured 84 links
      // and 45 lines and lost the rest at exactly 120. Two limits for one
      // quantity means the tighter one is always the real limit, and nobody
      // remembers which that is.
      if (taken.nodes >= limits.maxNodes) {
        skip('over-node-limit');
        return [];
      }
      const tag = el.tagName;
      if (IGNORE.has(tag)) {
        skip(tag.toLowerCase());
        return [];
      }
      if (!visible(el)) {
        skip('hidden');
        return [];
      }

      if (HEADINGS.has(tag)) {
        const text = clean(el.textContent);
        if (!text) return [];
        taken.nodes++;
        return [{ kind: 'heading', level: Number(tag.slice(1)), text }];
      }
      if (tag === 'IMG') {
        const src = el.getAttribute('src');
        if (!src || src.startsWith('data:')) {
          skip('image-without-src');
          return [];
        }
        if (taken.images >= limits.maxImages) {
          skip('over-image-limit');
          return [];
        }
        taken.images++;
        taken.nodes++;
        return [{ kind: 'image', src: abs(src), alt: clean(el.getAttribute('alt')) }];
      }
      if (tag === 'A') {
        const text = clean(el.textContent);
        // A LINK THAT IS NOT A BUTTON IS STILL A LINK. It used to contribute
        // NOTHING, and on a page whose content IS a list of links that is the
        // whole page: news.ycombinator.com lost 1,595 characters of story titles
        // and bylines that way. The platform has no inline-link element — its
        // own idiom is a `button` carrying `href`, styled flat — so that is what
        // an unpainted link becomes, and the variant is what keeps it from
        // arriving as a call to action.
        if (text && el.children.length === 0) {
          const href = el.getAttribute('href');
          taken.nodes++;
          return [{
            kind: 'button',
            variant: looksLikeButton(el) ? 'cta' : 'link',
            text,
            ...(href ? { href: abs(href) } : {}),
          }];
        }
        if (looksLikeButton(el) && text) {
          const href = el.getAttribute('href');
          taken.nodes++;
          return [{ kind: 'button', variant: 'cta', text, ...(href ? { href: abs(href) } : {}) }];
        }
        // A LINK WITH MARKUP INSIDE IT IS STILL A LINK. `<a><span>Docs</span></a>`
        // has children, so it fell through to the child walk — and when those
        // children produced nothing renderable (an icon font's ligature, a
        // decorative span) the link's words went with them. Same shape as the
        // text fallback below, and for the same reason: offer your own content
        // only when nothing inside offered any.
        const inner = walkChildren(el);
        if (inner.length > 0) return inner;
        if (text) {
          const href = el.getAttribute('href');
          taken.nodes++;
          return [{ kind: 'button', variant: 'link', text, ...(href ? { href: abs(href) } : {}) }];
        }
        return [];
      }
      if (tag === 'UL' || tag === 'OL') {
        const items = Array.from(el.querySelectorAll('li'))
          .map((li) => clean(li.textContent))
          .filter(Boolean);
        if (!items.length) return [];
        taken.nodes++;
        return [{ kind: 'list', items }];
      }
      if (tag === 'P' || tag === 'BLOCKQUOTE') {
        const text = clean(el.textContent);
        if (!text) return [];
        taken.nodes++;
        return [{ kind: 'text', text }];
      }

      const kids = walkChildren(el);

      if (kids.length > 0) {
        const cs = getComputedStyle(el);
        const lays = cs.display === 'flex' || cs.display === 'grid' ||
          cs.display === 'inline-flex' || cs.display === 'inline-grid';
        // A ROW is worth keeping; a column is what the page already is, so
        // wrapping one in a group would add a level that renders identically.
        const row = cs.display.indexOf('grid') >= 0
          ? true
          : cs.flexDirection === 'row' || cs.flexDirection === 'row-reverse';
        if (lays && row && kids.length >= 2) {
          taken.nodes++;
          return [{ kind: 'group', direction: 'row', wrap: cs.flexWrap === 'wrap', children: kids }];
        }
        return kids;
      }

      // THE TEXT FALLBACK, and it is most of the web. Capturing only <p> meant a
      // page whose prose sits in a <div>, a <td> or a <span> came back EMPTY:
      // measured, news.ycombinator.com (a table layout) and tailwindcss.com both
      // kept 0 of ~4,000 and ~6,000 characters.
      //
      // Safe because it only fires when nothing INSIDE offered anything, so a
      // paragraph is never taken twice — once through its <p> and again through
      // the <div> around it. Bounded because a fallback that fires high in the
      // tree would otherwise carry a whole page as one string.
      const own = clean(el.textContent);
      if (own && own.length <= limits.maxTextChars) {
        taken.nodes++;
        return [{ kind: 'text', text: own }];
      }
      if (own) skip('text-too-long');
      return [];
    };
    return walk(root);
  };

  // SECTION CANDIDATES, widest first: a page that marks its bands up
  // semantically is read that way, and one that does not falls back to the
  // top-level children of its main content, which is what a hand-written page
  // usually is.
  let candidates = Array.from(
    document.querySelectorAll('main > section, body > section, section, main > div'),
  );
  if (candidates.length === 0) {
    const main = document.querySelectorAll('main')[0] ?? document.body;
    candidates = Array.from(main.children);
  }
  // INNERMOST ONLY. `section` matches nested ones too, so an outer band and the
  // bands inside it were both taken — and the inner content came back TWICE,
  // once through its parent's leaf walk and once on its own. Measured: 15
  // duplicated strings out of 22 on one real page, 12 on another, which on an
  // imported page reads as a stutter nobody typed.
  //
  // Innermost rather than outermost because a `<section>` that wraps the whole
  // document is one candidate too, and keeping THAT would reduce every page to a
  // single band. The finest ones are the page's actual bands.
  candidates = candidates.filter((el) => !candidates.some((o) => o !== el && el.contains(o)));

  // THE SOURCE'S OWN HEADER AND FOOTER ARE NEVER WANTED. The target site has its
  // own, as shared globals, and importing somebody else's navigation onto a
  // storefront is a second menu pointing at a different website. Only the
  // PAGE-LEVEL ones are dropped — a `<header>` inside a section is a hero, and
  // excluding those would lose the first thing on most landing pages.
  const chrome = new Set<El>();
  for (const el of Array.from(document.body.children)) {
    if (el.tagName === 'HEADER' || el.tagName === 'FOOTER') chrome.add(el);
  }

  const build = (from: El[]): Captured[] => {
    const acc: Captured[] = [];
    for (const el of from) {
      if (chrome.has(el)) {
        skip('page-chrome');
        continue;
      }
      if (acc.length >= limits.maxSections) {
        skip('over-section-limit');
        break;
      }
      if (!visible(el)) {
        skip('hidden');
        continue;
      }
      const children = leaves(el);
      if (children.length === 0) {
        skip('empty-section');
        continue;
      }
      // PINNING IS THE ONE BEHAVIOUR WORTH CARRYING OVER, and the only one this
      // importer reads off computed style rather than off the tree. A sticky
      // category bar or a fixed buy bar is a layout DECISION — the section is
      // there to stay in view — and a copy that scrolls away is not the same
      // section. Sticky and fixed only: `absolute` and `relative` describe where
      // a box sits inside a layout this import is not copying, so carrying them
      // would place a section against coordinates that no longer exist.
      const pos = getComputedStyle(el).position;
      const pinned = pos === 'sticky' || pos === 'fixed' ? pos : undefined;
      acc.push({ kind: 'section', children, ...(pinned ? { pinned } : {}) });
    }
    return acc;
  };

  let sections = build(candidates);
  // THE FALLBACK HAS TO FIRE ON AN EMPTY RESULT, not only on an empty candidate
  // LIST. A page can offer `<section>` elements that hold nothing this platform
  // renders — a wrapper around a canvas, a slot filled by script later — and the
  // old order took "we found candidates" as "we found content", so the whole
  // page came back empty. Measured: tailwindcss.com kept 0 of 6,004 characters
  // while reporting one skipped empty section.
  if (sections.length === 0) {
    const main = document.querySelectorAll('main')[0] ?? document.body;
    sections = build(Array.from(main.children));
  }

  return { url: here, title: clean(document.title), sections, skipped };
}

/**
 * Open a URL and capture it.
 *
 * `load` plus a short settle rather than `networkidle`, for the same reason
 * `shoot.ts` gives: a page with a poller never goes idle, and waiting for that
 * spends the whole budget on a timeout that cannot resolve.
 */
export async function capture(
  url: string,
  opts: { maxSections?: number; maxImages?: number; maxTextChars?: number; maxNodes?: number; width?: number } = {},
): Promise<CaptureResult> {
  const limits = {
    maxSections: opts.maxSections ?? 24,
    maxImages: opts.maxImages ?? 24,
    maxTextChars: opts.maxTextChars ?? 1200,
    maxNodes: opts.maxNodes ?? 400,
  };
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
  } catch (e) {
    throw new Error(
      'sbuilder: could not start Chrome to read that page. This server uses the SYSTEM ' +
        `browser (playwright-core, channel "chrome") and did not find one: ${(e as Error).message}`,
    );
  }
  let page: Page | undefined;
  try {
    page = await browser.newPage({ viewport: { width: opts.width ?? 1440, height: 900 } });
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    // THE SAME SETTLE `sb_look` USES, not a flat sleep. A fixed 600ms is wrong
    // at both ends: example.com is finished long before it, and a page that
    // builds itself with scripts is not finished after it — which is exactly the
    // page an import is most likely to be pointed at. `settleDom` asks the
    // question actually being asked (has the page stopped changing) and answers
    // when it becomes true, bounded so a page that never settles is still read.
    await settleDom(page);
    return (await page.evaluate(capturePage, limits)) as CaptureResult;
  } finally {
    await page?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
