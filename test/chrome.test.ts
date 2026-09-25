import { describe, it, expect } from 'vitest';
import { headerMenuItems } from '../src/tools/chrome.js';

/**
 * THE MENU A SHARED HEADER CARRIES — a site menu of REFERENCES, which is what
 * `sb_store action:"chrome"` creates before it builds the header on it.
 */
describe('the menu a shared header carries', () => {
  const pages = [
    { id: 'c', slug: 'lien-he', name: 'Liên hệ', isHome: false, type: 'contact' },
    { id: 'h', slug: '', name: 'Trang chủ', isHome: true, type: 'page' },
    { id: 'a', slug: 'gioi-thieu', name: 'Giới thiệu', isHome: false, type: 'about' },
    { id: 't', slug: 'product', name: 'Product', isHome: false, type: 'product' },
  ];

  it('puts the home page first, whatever order the pages came back in', () => {
    // A menu that starts anywhere but home reads as a menu with a page missing.
    expect(headerMenuItems(pages, []).map((l) => l.link)).toEqual([
      { type: 'page', pageId: 'h' },
      { type: 'page', pageId: 'c' },
      { type: 'page', pageId: 'a' },
    ]);
  });

  it('names each page the way a menu would, not the way a database does', () => {
    const long = [{ id: 'b', slug: 'ban-hang', name: 'Bán hàng trực tuyến | Cửa hàng ABC', isHome: false, type: 'page' }];
    expect(headerMenuItems(long, [])[0].label).not.toContain('|');
  });

  it('a category with sub-categories lists them; one without lists its products', () => {
    const cats = [
      { id: 'k1', name: 'Áo', parentId: '', products: [{ id: 'p1', name: 'Áo thun' }] },
      { id: 'k2', name: 'Áo khoác', parentId: 'k1', products: [{ id: 'p2', name: 'Áo gió' }] },
      { id: 'k3', name: 'Quần', parentId: '', products: [{ id: 'p3', name: 'Quần jean' }] },
    ];
    const rows = headerMenuItems([], cats);
    expect(rows.map((r) => r.link?.entityId)).toEqual(['k1', 'k3']);
    expect(rows[0].items?.map((r) => r.link)).toEqual([{ type: 'productCategory', entityId: 'k2' }]);
    expect(rows[1].items?.map((r) => r.link)).toEqual([{ type: 'product', entityId: 'p3' }]);
  });
});
