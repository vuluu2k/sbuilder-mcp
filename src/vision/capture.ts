import { chromium, type Browser, type Page } from 'playwright-core';
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
function capturePage(limits: { maxSections: number; maxPerSection: number }): CaptureResult {
  // EVERY constant this function uses is declared INSIDE it. The body is
  // serialized and evaluated in the page, so a module-level `const` it closes
  // over is simply not there — caught the first time this ran against a real
  // page, as `ReferenceError: HEADINGS is not defined`, by which point the file
  // already carried a comment saying exactly that.
  const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
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
    const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
    if (/\b(btn|button|cta)\b/.test(cls)) return true;
    const t = clean(el.textContent);
    return t.length > 0 && t.length <= 32 && getComputedStyle(el).display !== 'inline';
  };

  const IGNORE = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'IFRAME', 'CANVAS',
    'NAV', 'FORM', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON',
  ]);

  /** Collect the renderable leaves under one section, in document order. */
  const leaves = (root: El): Captured[] => {
    const out: Captured[] = [];
    const walk = (el: El): void => {
      if (out.length >= limits.maxPerSection) return;
      const tag = el.tagName;
      if (IGNORE.has(tag)) {
        skip(tag.toLowerCase());
        return;
      }
      if (!visible(el)) {
        skip('hidden');
        return;
      }
      if (HEADINGS.has(tag)) {
        const text = clean(el.textContent);
        if (text) out.push({ kind: 'heading', level: Number(tag.slice(1)), text });
        return;
      }
      if (tag === 'IMG') {
        const src = el.getAttribute('src');
        if (src && !src.startsWith('data:')) {
          out.push({ kind: 'image', src: abs(src), alt: clean(el.getAttribute('alt')) });
        } else skip('image-without-src');
        return;
      }
      if (tag === 'A' && looksLikeButton(el)) {
        const text = clean(el.textContent);
        const href = el.getAttribute('href');
        if (text) {
          out.push({ kind: 'button', text, ...(href ? { href: abs(href) } : {}) });
        }
        return;
      }
      if (tag === 'UL' || tag === 'OL') {
        const items = Array.from(el.querySelectorAll('li'))
          .map((li) => clean(li.textContent))
          .filter(Boolean);
        if (items.length) out.push({ kind: 'list', items });
        return;
      }
      if (tag === 'P' || tag === 'BLOCKQUOTE') {
        const text = clean(el.textContent);
        if (text) out.push({ kind: 'text', text });
        return;
      }
      for (const child of Array.from(el.children)) walk(child);
    };
    walk(root);
    return out;
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

  const sections: Captured[] = [];
  for (const el of candidates) {
    if (sections.length >= limits.maxSections) {
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
    sections.push({ kind: 'section', children });
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
  opts: { maxSections?: number; maxPerSection?: number; width?: number } = {},
): Promise<CaptureResult> {
  const limits = {
    maxSections: opts.maxSections ?? 24,
    maxPerSection: opts.maxPerSection ?? 40,
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
    await page.waitForTimeout(600);
    return (await page.evaluate(capturePage, limits)) as CaptureResult;
  } finally {
    await page?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
