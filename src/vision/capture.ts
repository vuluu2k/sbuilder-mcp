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
  setAttribute(name: string, value: string): void;
  querySelectorAll(selector: string): ArrayLike<El>;
  getBoundingClientRect(): { width: number; height: number };
  contains(other: El): boolean;
}
declare const document: {
  title: string;
  body: El;
  querySelectorAll(selector: string): ArrayLike<El>;
};
declare const console: { error(...args: unknown[]): void };
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
  /**
   * The forms this page carried, which are NOT nodes here.
   *
   * A form on this platform lives in its own document — created, PUT back whole
   * and filled in by `sb_store action:"form"`, whose 17 templates carry field
   * `mapTo` values the server validates. Reproducing one from captured markup
   * would mean guessing that vocabulary, which is the guess the catalog exists
   * to remove. So the form is REPORTED rather than rebuilt: a contact page that
   * silently arrives with no way to contact anybody is the failure worth
   * avoiding, and naming the tool that makes one is the fix that works.
   */
  forms?: Array<{ fields: number; labels: string[] }>;
  /**
   * What the page says its own address is, when it says.
   *
   * `<link rel="canonical">` is how a site declares that several URLs are ONE
   * page, and it is not a rare flourish: modelcontextprotocol.io's home page
   * points at a dated docs path. Without it a crawl imports the same content
   * twice under two slugs and nothing in the plan looks wrong.
   */
  canonical?: string;
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

  // IFRAME IS NOT HERE ANY MORE. It was, and it took every embedded video, every
  // map and every audio player with it — silently, as a skip count. The platform
  // has `video`, `youtube`, `vimeo`, `soundcloud` and `google-map`; a hero video
  // and a contact page's map are ordinary things to import, and they were the
  // one kind of content that could not survive the trip at all.
  const IGNORE = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'CANVAS',
    // FORM is NOT here: its own branch below records it before returning
    // nothing, so a contact page says it had one. The CONTROLS stay ignored —
    // a stray input outside a form is chrome, and the fields of a form that IS
    // reported are counted there rather than walked into.
    'NAV', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON',
  ]);
  const forms: Array<{ fields: number; labels: string[] }> = [];

  /** The provider and id behind an embed URL, or null if this platform has no element for it. */
  const embedOf = (raw: string): { provider: string; videoId?: string; src?: string } | null => {
    const u = raw.split('?')[0];
    let m = /(?:youtube(?:-nocookie)?\.com\/(?:embed|v|shorts)\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/.exec(u);
    if (m) return { provider: 'youtube', videoId: m[1] };
    m = /player\.vimeo\.com\/video\/(\d+)/.exec(u);
    if (m) return { provider: 'vimeo', videoId: m[1] };
    if (/(?:google\.[a-z.]+|maps\.google\.[a-z.]+)\/maps?\/embed/.test(u)) {
      return { provider: 'map', src: raw };
    }
    if (/w\.soundcloud\.com\/player/.test(u)) return { provider: 'soundcloud', src: raw };
    return null;
  };

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
  // THE SOURCE'S OWN HEADER AND FOOTER ARE NEVER WANTED. The target site has its
  // own, as shared globals, and importing somebody else's navigation onto a
  // storefront is a second menu pointing at a different website.
  //
  // NOT NAMED `chrome`: that is a BROWSER GLOBAL (the extension API), so a
  // `const chrome` declared in a nested scope left every OTHER scope resolving
  // the name to `window.chrome` — `chrome.has is not a function`, thrown inside
  // `evaluate`, which kills the whole capture. The same shape as the closure
  // trap this file already carries, reached from the opposite direction.
  //
  // PAGE-LEVEL, BY THE SPEC'S OWN DEFINITION rather than by depth. This used to
  // ask whether the element was a DIRECT child of `<body>`, which almost no real
  // site satisfies — one wrapper div is enough — so blender.org's footer came
  // through as eleven sections of link columns and the page a merchant asked for
  // was its site map. `<header>` and `<footer>` belong to their nearest
  // SECTIONING ancestor (article, aside, nav, section), so one with none of
  // those above it is the page's, however deeply it is wrapped; one inside an
  // `<article>` is that article's byline, and one inside a `<section>` is the
  // hero the old comment was right to protect. `<main>` is not sectioning
  // content, so it does not shield a footer.
  // A COLLAPSED `<details>` MEASURES AS ZERO, so its body would read as hidden and
  // an FAQ would import as a list of questions with no answers. The source's
  // collapsed state is not content — this platform's accordion has its own
  // `openItems` — so every one is opened before anything is measured. The page is
  // a throwaway tab that is closed straight after.
  for (const d of Array.from(document.querySelectorAll('details'))) d.setAttribute('open', '');

  /**
   * What the page CALLS this icon, in its own words. A candidate, never a verdict.
   *
   * Four places a real page says it, in falling order of how much it means:
   * a sprite reference names the icon outright; an `aria-label` or `<title>` is
   * what a screen reader is told; a class is the icon set's own id. The mapper
   * decides whether this platform has one by that name — nothing in the page can
   * answer that.
   */
  const iconName = (el: El): string => {
    const use = Array.from(el.querySelectorAll('use'))[0];
    const ref = use ? use.getAttribute('href') ?? use.getAttribute('xlink:href') : null;
    if (ref && ref.charAt(0) === '#' && ref.length > 1) return ref.slice(1);
    const label = clean(el.getAttribute('aria-label'));
    if (label) return label;
    const title = Array.from(el.querySelectorAll('title'))[0];
    const titled = title ? clean(title.textContent) : '';
    if (titled) return titled;
    const dataIcon = clean(el.getAttribute('data-icon'));
    if (dataIcon) return dataIcon;
    // A class list holds the icon set's id and a pile of layout classes with it.
    // The longest hyphenated token is the id in every set seen here — `ri-…`,
    // `fa-…`, `lucide-…`, `bi-…` — and a bare `w-4` cannot outrank it.
    // `getAttribute('class')`, NOT `className`: on an SVG element the property is
    // an SVGAnimatedString, so `String(el.className)` is the literal
    // "[object SVGAnimatedString]" and every class-named icon went unrecognised.
    let best = '';
    for (const w of (el.getAttribute('class') ?? '').split(/\s+/)) {
      if (w.indexOf('-') > 0 && w.length > best.length) best = w;
    }
    return best;
  };

  const sectioning = Array.from(document.querySelectorAll('article, section, aside, nav'));
  // A CLASS NAME IS EVIDENCE FOR A FOOTER AND NOT FOR A HEADER, and the
  // asymmetry is the whole point. blender.org marks its site map
  // `<div class="footer-navigation">` — no `<footer>` tag anywhere near it — so
  // the spec rule alone let eleven sections of somebody else's links through as
  // the page a merchant asked for. The same trick on the header side would eat
  // HEROES: blender's own first band is `<div class="hero header-size-large">`,
  // and losing the first thing on a landing page costs more than a stray footer.
  // A header is caught by its tag or its ARIA role, and its links are `<nav>`,
  // which is ignored already.
  //
  // The token must START with `footer` (footer, footer-note, footer__inner) so
  // `card-footer` inside an ordinary div is not swept up with it.
  const footerish = (el: El): boolean => {
    const words = `${el.getAttribute('id') ?? ''} ${el.getAttribute('class') ?? ''}`.toLowerCase();
    for (const w of words.split(/[\s]+/)) {
      if (!w) continue;
      if (w === 'colophon' || w === 'site-footer' || w === 'page-footer') return true;
      if (w === 'footer' || w.indexOf('footer-') === 0 || w.indexOf('footer_') === 0) return true;
    }
    return false;
  };
  const pageChromeRoots: El[] = [];
  const chromeCandidates = Array.from(
    document.querySelectorAll('header, footer, [role="banner"], [role="contentinfo"], [class*="footer"], [id*="footer"]'),
  );
  for (const el of chromeCandidates) {
    const role = el.getAttribute('role');
    const isChrome =
      el.tagName === 'HEADER' ||
      el.tagName === 'FOOTER' ||
      role === 'banner' ||
      role === 'contentinfo' ||
      footerish(el);
    if (!isChrome) continue;
    if (sectioning.some((sec) => sec !== el && sec.contains(el))) continue;
    // A NESTED ONE ADDS NOTHING: the outer root already covers it, and keeping
    // both makes the containment test scan the same subtree twice.
    if (pageChromeRoots.some((c) => c.contains(el))) continue;
    pageChromeRoots.push(el);
  }
  // INSIDE the chrome, not equal to it. A real footer holds `<section>`s, and
  // the candidate walk deliberately takes the INNERMOST sections — so on
  // blender.org the candidates were the footer's own link columns, none of which
  // IS the footer, and eleven sections of somebody else's site map came through
  // as the page. Asking about containment is the same question the candidate
  // list already answers for nesting.
  const inPageChrome = (el: El): boolean =>
    pageChromeRoots.some((c) => c === el || c.contains(el));

  const leaves = (root: El): Captured[] => {
    const walkChildren = (el: El): Captured[] => {
      const kids: Captured[] = [];
      for (const child of Array.from(el.children)) {
        for (const c of walk(child)) kids.push(c);
      }
      // CONSECUTIVE `<details>` ARE ONE ACCORDION. An FAQ is written as eight
      // siblings, and eight separate accordions is eight containers where the
      // author had one list — the same content, with seven wrappers nobody asked
      // for and no shared open/close behaviour.
      const merged: Captured[] = [];
      for (const c of kids) {
        const last = merged[merged.length - 1];
        if (c.kind === 'accordion' && last && last.kind === 'accordion') {
          last.children = (last.children ?? []).concat(c.children ?? []);
          continue;
        }
        merged.push(c);
      }
      return merged;
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
      if (inPageChrome(el)) {
        skip('page-chrome');
        return [];
      }
      // UPPERCASED, because an SVG element's `tagName` is not.
      //
      // `tagName` preserves case for XML-namespaced elements, so an inline
      // `<svg>` reports "svg" while every HTML element reports "P", "DIV". The
      // ignore list had held 'SVG' and 'PATH' since it was written and neither
      // had ever matched — the icons were falling through to the text fallback,
      // contributing nothing because an svg's textContent is empty, which is why
      // it looked like the entry was working.
      const tag = el.tagName.toUpperCase();
      // AN ICON IS DECORATION, WHICH IS THE ONE THING `aria-hidden` MARKS AND
      // THIS PLATFORM HAS AN ELEMENT FOR. Almost every real icon carries the
      // attribute — that is correct authoring, the label beside it does the
      // talking — so testing it before this branch would mean the `icon` element
      // could never be reached from a real page. The attribute still governs
      // everything else, and an aria-hidden CONTAINER is skipped before the walk
      // ever descends to the svg inside it.
      if (tag === 'SVG') {
        const name = iconName(el);
        if (!name) {
          skip('svg');
          return [];
        }
        taken.nodes++;
        return [{ kind: 'icon', name }];
      }
      // WHAT THE PAGE ITSELF SAYS IS NOT CONTENT.
      //
      // `aria-hidden="true"` is the author's own mark for decoration and for
      // duplicates — a carousel's cloned slides, the mobile copy of a menu that
      // the desktop layout also carries, an icon that repeats the label beside
      // it. Measured on real pages before this: 53 such elements on one, 15 on
      // another, every one of them walked and some of them captured twice.
      // Nothing here reads the accessibility tree, so this attribute is the only
      // place that answer exists.
      if (el.getAttribute('aria-hidden') === 'true') {
        skip('aria-hidden');
        return [];
      }
      if (IGNORE.has(tag)) {
        skip(tag.toLowerCase());
        return [];
      }
      if (!visible(el)) {
        skip('hidden');
        return [];
      }
      if (tag === 'DETAILS') {
        const kids2 = Array.from(el.children);
        const summary = kids2.filter((c) => c.tagName === 'SUMMARY')[0];
        const label = summary ? clean(summary.textContent) : '';
        const body: Captured[] = [];
        for (const child of kids2) {
          if (child.tagName === 'SUMMARY') continue;
          for (const c of walk(child)) body.push(c);
        }
        if (!label && body.length === 0) {
          skip('empty-details');
          return [];
        }
        taken.nodes++;
        return [{ kind: 'accordion', children: [{ kind: 'accordion-item', text: label, children: body }] }];
      }
      // A RULE BETWEEN SECTIONS IS A DESIGN DECISION, and it is one node.
      // A FORM IS SEEN AND NOT REBUILT. Its fields are a vocabulary the server
      // validates (`mapTo`), and `sb_store action:"form"` owns that; what this
      // walk can honestly do is say the page had one, so a contact page does not
      // arrive with no way to contact anybody and nothing saying why.
      if (tag === 'FORM') {
        const controls = Array.from(el.querySelectorAll('input, textarea, select'));
        const labels: string[] = [];
        for (const l of Array.from(el.querySelectorAll('label'))) {
          const t = clean(l.textContent);
          if (t && labels.length < 10) labels.push(t);
        }
        if (controls.length > 0) forms.push({ fields: controls.length, labels });
        skip('form');
        return [];
      }
      if (tag === 'HR') {
        taken.nodes++;
        return [{ kind: 'divider' }];
      }
      if (tag === 'VIDEO') {
        const direct = el.getAttribute('src');
        const source = Array.from(el.querySelectorAll('source'))[0];
        const src = direct || (source ? source.getAttribute('src') : null);
        if (!src) {
          skip('video-without-src');
          return [];
        }
        taken.nodes++;
        const poster = el.getAttribute('poster');
        return [{
          kind: 'video',
          src: abs(src),
          ...(poster ? { poster: abs(poster) } : {}),
        }];
      }
      if (tag === 'IFRAME') {
        const src = el.getAttribute('src');
        const embed = src ? embedOf(abs(src)) : null;
        if (!embed) {
          // An advert, a tracking pixel, a chat widget, a comment system: real
          // pages carry several, and this platform has an element for none of
          // them. Counted rather than guessed at.
          skip('iframe');
          return [];
        }
        taken.nodes++;
        return [{ kind: 'embed', ...embed } as Captured];
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
        // A NESTED LIST WAS TAKEN TWICE, and the duplication reads as a page
        // that stutters. `querySelectorAll('li')` returns the nested items as
        // well as the outer ones, and an outer item's `textContent` ALREADY
        // contains its sublist — so every nested entry arrived once inside its
        // parent's line and once again on its own. Measured on a real import:
        // one section of blender.org repeated five sublists that way.
        //
        // Walked by DIRECT children instead, with each item's own words
        // separated from its sublist's and the sublist flattened after it. This
        // platform's `list` is flat, so flattening is the honest translation —
        // and the order a reader sees is preserved.
        const items: string[] = [];
        const collect = (list: El): void => {
          for (const li of Array.from(list.children)) {
            if (li.tagName !== 'LI') continue;
            const sublists = Array.from(li.children).filter(
              (c) => c.tagName === 'UL' || c.tagName === 'OL',
            );
            let text = clean(li.textContent);
            for (const sub of sublists) {
              const inner = clean(sub.textContent);
              // textContent runs in document order, so a sublist's words are the
              // tail of its parent's. Only strip what is actually there.
              if (inner && text.length > inner.length && text.slice(-inner.length) === inner) {
                text = clean(text.slice(0, text.length - inner.length));
              }
            }
            if (text) items.push(text);
            for (const sub of sublists) collect(sub);
          }
        };
        collect(el);
        if (!items.length) return [];
        taken.nodes++;
        return [{ kind: 'list', items }];
      }
      // A CODE BLOCK IS ONE THING, and walking into it produces rubble.
      //
      // Every syntax highlighter wraps each token in its own <span>, so the leaf
      // walk took them one at a time: a twenty-line JSON config arrived as forty
      // separate text nodes — `{`, `"mcpServers"`, `: {` — each its own block on
      // its own line. Measured on a real import; it also ate forty of the node
      // budget to say what one node says.
      //
      // Whitespace is collapsed like any other text because this platform has no
      // code element to preserve it in — the six kinds are what can cross — so
      // the honest translation is one paragraph the merchant can then restyle,
      // not a shredded imitation of a listing.
      if (tag === 'PRE' || tag === 'CODE') {
        const text = clean(el.textContent);
        if (!text) return [];
        taken.nodes++;
        return [{ kind: 'text', text }];
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
        const grid = cs.display.indexOf('grid') >= 0;
        const row = grid || cs.flexDirection === 'row' || cs.flexDirection === 'row-reverse';
        // A ROW OF 279 IS NOT A ROW.
        //
        // Measured on a real import of a documentation site: its content wrapper
        // is a GRID, every grid was read as a single row, and the whole page came
        // back as one flex row of 279 columns — each column a sliver, every line
        // of prose broken to one word, and 80 nodes hanging past the viewport.
        // The page was structurally perfect and visually destroyed.
        //
        // A design row is a feature trio, a card shelf, a logo wall: a handful of
        // columns, chosen. Past that the container is not arranging things side
        // by side, it is the page's own content column and the browser is
        // wrapping it — so the honest translation is the stack it already reads
        // as. Twelve is above any real row seen here and far below a content
        // grid.
        const ROW_MAX = 12;
        if (lays && row && kids.length >= 2 && kids.length <= ROW_MAX) {
          taken.nodes++;
          return [{
            kind: 'group',
            direction: 'row',
            // A GRID ALWAYS WRAPS — that is what a grid IS — and `flexWrap` reads
            // `nowrap` on one because the property does not apply. Carrying that
            // literally gave the columns nowhere to go at any width.
            wrap: grid || cs.flexWrap === 'wrap',
            children: kids,
          }];
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

  const build = (from: El[]): Captured[] => {
    const acc: Captured[] = [];
    for (const el of from) {
      if (inPageChrome(el)) {
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

  const link = Array.from(document.querySelectorAll('link[rel="canonical"]'))[0];
  const canonical = link ? (link.getAttribute('href') ?? '') : '';
  return {
    url: here,
    title: clean(document.title),
    ...(canonical ? { canonical: abs(canonical) } : {}),
    ...(forms.length ? { forms } : {}),
    sections,
    skipped,
  };
}

/**
 * ONE BROWSER FOR THE WHOLE CALL.
 *
 * A site import reads a dozen pages, and launching Chrome once per page pays
 * the launch a dozen times for nothing. It is still a launch of its OWN rather
 * than `shoot.ts`'s pooled one, for the reason that module gives: an import is
 * rare, slow and runs untrusted script, and coupling that to the tool a vision
 * loop calls every few hundred milliseconds is how the fast path gets slow.
 *
 * Closed in a `finally`, always. `shoot()` pools for the process lifetime and a
 * caller that forgets `closeBrowser()` never exits — there is no `beforeExit`
 * rescue, because an open browser connection is precisely what stops the event
 * loop draining.
 */
async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
  } catch (e) {
    throw new Error(
      'sbuilder: could not start Chrome to read that page. This server uses the SYSTEM ' +
        `browser (playwright-core, channel "chrome") and did not find one: ${(e as Error).message}`,
    );
  }
  try {
    return await fn(browser);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * Open one URL in an existing browser, let it settle, and run one evaluate.
 *
 * `load` plus a short settle rather than `networkidle`, for the same reason
 * `shoot.ts` gives: a page with a poller never goes idle, and waiting for that
 * spends the whole budget on a timeout that cannot resolve.
 */
async function readPage<T>(
  browser: Browser,
  url: string,
  width: number,
  work: (page: Page) => Promise<T>,
): Promise<T> {
  let page: Page | undefined;
  try {
    page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    // THE SAME SETTLE `sb_look` USES, not a flat sleep. A fixed 600ms is wrong
    // at both ends: example.com is finished long before it, and a page that
    // builds itself with scripts is not finished after it — which is exactly the
    // page an import is most likely to be pointed at. `settleDom` asks the
    // question actually being asked (has the page stopped changing) and answers
    // when it becomes true, bounded so a page that never settles is still read.
    await settleDom(page);
    return await work(page);
  } finally {
    await page?.close().catch(() => undefined);
  }
}

function limitsFrom(opts: CaptureOpts) {
  return {
    maxSections: opts.maxSections ?? 24,
    maxImages: opts.maxImages ?? 24,
    maxTextChars: opts.maxTextChars ?? 1200,
    maxNodes: opts.maxNodes ?? 400,
  };
}

export interface CaptureOpts {
  maxSections?: number;
  maxImages?: number;
  maxTextChars?: number;
  maxNodes?: number;
  width?: number;
}

/** Open a URL and capture it. */
export async function capture(url: string, opts: CaptureOpts = {}): Promise<CaptureResult> {
  const limits = limitsFrom(opts);
  return withBrowser((browser) =>
    readPage(browser, url, opts.width ?? 1440, (page) =>
      page.evaluate(capturePage, limits) as Promise<CaptureResult>,
    ),
  );
}

/** One page's outcome in a multi-page read: what was captured, or why it was not. */
export type CaptureOutcome =
  | { url: string; ok: true; result: CaptureResult }
  | { url: string; ok: false; why: string };

/**
 * Capture several pages through one browser.
 *
 * A PAGE THAT FAILS MUST NOT END THE RUN. Half the reason to import a site
 * rather than a page is that the caller does not know what is at each URL: one
 * of them is behind a login, one 404s, one hangs. Throwing would discard the
 * eleven that read fine and give the caller nothing to act on, so each outcome
 * is carried and the tool reports the failures by reason.
 */
export async function captureMany(urls: string[], opts: CaptureOpts = {}): Promise<CaptureOutcome[]> {
  const limits = limitsFrom(opts);
  return withBrowser(async (browser) => {
    const out: CaptureOutcome[] = [];
    for (const url of urls) {
      try {
        const result = (await readPage(browser, url, opts.width ?? 1440, (page) =>
          page.evaluate(capturePage, limits),
        )) as CaptureResult;
        out.push({ url, ok: true, result });
      } catch (e) {
        out.push({ url, ok: false, why: (e as Error).message.slice(0, 160) });
      }
    }
    return out;
  });
}

/**
 * Every link on a page, absolute.
 *
 * A SECOND, TINY EVALUATE RATHER THAN A FIELD ON `capturePage`. Discovery
 * visits pages the import may never take — that is what a depth-2 crawl IS —
 * and running the whole leaf walk on each of them would pay for content that is
 * thrown away. This asks the one question discovery has.
 *
 * Everything it uses is declared INSIDE it: the function is serialized, so a
 * module-level constant it closes over simply is not there on the other side.
 */
function linksOnPage(): { title: string; canonical: string; links: string[] } {
  const here = location.href;
  const links: string[] = [];
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  for (const a of anchors) {
    const h = a.getAttribute('href');
    if (!h) continue;
    try {
      links.push(new URL(h, here).href);
    } catch {
      // `new URL(rel, base)` THROWS on a non-hierarchical base (a data: page).
      // One unresolvable href must not kill the crawl.
    }
  }
  const link = Array.from(document.querySelectorAll('link[rel="canonical"]'))[0];
  let canonical = '';
  if (link) {
    const href = link.getAttribute('href');
    if (href) {
      try {
        canonical = new URL(href, here).href;
      } catch {
        canonical = '';
      }
    }
  }
  return { title: document.title, canonical, links };
}

/**
 * Walk a site's own links from one entry page, breadth first.
 *
 * THE FALLBACK, never the first choice — every step is a browser navigation, so
 * the sitemap path exists to avoid this entirely. Bounded on both axes: `depth`
 * limits how far from the entry a page may be, `maxVisits` limits how many
 * navigations the whole crawl may spend, and the queue is filtered by the
 * caller's own `keep` so the bound is spent on pages that could actually become
 * pages.
 */
export async function crawlLinks(
  entry: string,
  opts: {
    depth?: number;
    maxVisits?: number;
    /**
     * Called with a raw absolute href: returns its ONE canonical spelling, or
     * null to drop it before it costs a navigation.
     *
     * A predicate is not enough. `/a`, `/a/` and `/a#top` are one page under
     * three names, so a crawl that dedupes on the raw href visits it three times
     * and reports three pages — and the caller is the half that knows how this
     * platform folds them.
     */
    canon: (url: string) => string | null;
  },
): Promise<{ urls: string[]; titles: Map<string, string>; canonical: Map<string, string>; visited: number }> {
  const depth = Math.max(0, opts.depth ?? 1);
  const maxVisits = opts.maxVisits ?? 24;
  const found = new Set<string>([entry]);
  const titles = new Map<string, string>();
  const canonical = new Map<string, string>();
  let visited = 0;
  await withBrowser(async (browser) => {
    let frontier = [entry];
    // NAVIGATE ONLY WHILE THE LINKS CAN STILL BE USED. `depth` is how far from
    // the entry a discovered page may be, so the pages AT that distance are
    // results and are never opened: opening them would pay a navigation each for
    // links the bound has already ruled out. The import pass opens them anyway.
    for (let level = 0; level < depth && frontier.length > 0; level += 1) {
      const next: string[] = [];
      for (const url of frontier) {
        if (visited >= maxVisits) break;
        visited += 1;
        try {
          const got = await readPage(browser, url, 1440, (page) => page.evaluate(linksOnPage));
          if (got.title) titles.set(url, got.title);
          if (got.canonical) {
            const c = opts.canon(got.canonical);
            // A PAGE THAT NAMES ANOTHER ADDRESS AS ITS OWN is that page. Recorded
            // rather than acted on here: the crawl still walks this copy for its
            // links, and the caller folds the two when it builds the plan.
            if (c && c !== url) canonical.set(url, c);
          }
          // A LEVEL BELOW THE LAST IS WALKED FOR ITS LINKS AND NOT QUEUED: at
          // `depth` the crawl still wants what that page points at, it just
          // must not navigate any further.
          for (const raw of got.links) {
            const url2 = opts.canon(raw);
            if (!url2 || found.has(url2)) continue;
            found.add(url2);
            next.push(url2);
          }
        } catch {
          // A page that will not open contributes nothing and ends nothing.
        }
      }
      frontier = next;
    }
  });
  return { urls: [...found], titles, canonical, visited };
}
