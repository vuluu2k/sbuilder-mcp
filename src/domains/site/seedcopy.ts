/**
 * THE STORE SEEDS' ENGLISH COPY, IN VIETNAMESE — applied when the page is made
 * for a Vietnamese site.
 *
 * The platform seeds in English on purpose (editor/src/element/emptyState.ts:
 * "a seed is a seed", decided 2026-09-17) and a table per language was offered
 * there and declined. Here the agent IS the author, and it knows the site's
 * language: measured on a store built end to end, the product page published
 * "Add To Cart" / "Buy It Now" to a Vietnamese storefront and every page
 * reviewed clean. sb_page_create seeds through this; sb_review (which reads the
 * site's locale) reports a page still carrying the English. Exact strings only; a seed string
 * this table does not carry is left as it was — and test/store-page-seeds
 * fails when codegen brings one in, so the table cannot fall behind silently.
 */
export const SEED_COPY_VI: Readonly<Record<string, string>> = {
  'Add To Cart': 'Thêm vào giỏ',
  'Buy It Now': 'Mua ngay',
  'This item is unavailable': 'Sản phẩm tạm hết',
  'It may have been removed. Have a look at the rest of the shop.': 'Sản phẩm có thể đã ngừng bán. Mời bạn xem các sản phẩm khác.',
  'No products yet': 'Chưa có sản phẩm',
  'New arrivals will show up here. Check back soon.': 'Sản phẩm mới sẽ sớm có ở đây — mời bạn quay lại sau.',
  'No posts yet': 'Chưa có bài viết',
  'New stories will show up here. Check back soon.': 'Bài viết mới sẽ sớm có ở đây.',
};

/** The language part of a locale tag — "vi-VN", "vi_VN" and "VI" are all "vi". */
export function langOf(locale: string | null | undefined): string {
  return String(locale ?? '').toLowerCase().split(/[-_]/)[0];
}
