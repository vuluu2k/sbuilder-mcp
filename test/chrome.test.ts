import { describe, it, expect } from 'vitest';
import { chromeLinks } from '../src/tools/chrome.js';

/**
 * THE HEADER A SITE SHARES — the gap `sb_review` reports as `siteChrome` and
 * that no tool could close.
 *
 * The flow existed and was reachable by nobody outside ONE tool:
 * `sb_import_site` builds exactly this from the pages it just made. A site
 * built any other way had to reproduce it by hand — create the master, know
 * that its `document` is page-shaped but rooted at the SECTION, then give every
 * page a ROOT child carrying `globalRef` + `globalKind`, FIRST, because a
 * header after middle content is a band-order refusal on the next save.
 */
describe('the menu a shared header carries', () => {
  const pages = [
    { slug: 'lien-he', name: 'Liên hệ', isHome: false },
    { slug: '', name: 'Trang chủ', isHome: true },
    { slug: 'gioi-thieu', name: 'Giới thiệu', isHome: false },
  ];

  it('puts the home page first, whatever order the pages came back in', () => {
    // A menu that starts anywhere but home reads as a menu with a page missing.
    expect(chromeLinks(pages).map((l) => l.href)).toEqual(['/', '/lien-he', '/gioi-thieu']);
  });

  it('links home to "/" rather than to its own empty slug', () => {
    expect(chromeLinks(pages)[0]).toEqual({ text: 'Trang chủ', href: '/' });
  });

  it('names each page the way a menu would, not the way a database does', () => {
    // menuLabel is the same shortener the import uses on a captured page title:
    // what the page calls ITSELF, before the first separator.
    const long = [{ slug: 'ban-hang', name: 'Bán hàng trực tuyến | Cửa hàng ABC', isHome: false }];
    expect(chromeLinks(long)[0].text).not.toContain('|');
  });
});
