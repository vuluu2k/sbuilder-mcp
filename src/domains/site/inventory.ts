import { PAGE_TYPES } from '../../catalog/storepages.generated.js';

/**
 * THE PAGES A SITE HAS THAT THE PLATFORM CANNOT NAME.
 *
 * `readinessGaps` already reports every page the storefront ROUTES BY TYPE —
 * product, category, search, checkout, complete, account, error. Each of those
 * has a named consequence when it is absent, which is what makes it a defect.
 *
 * The rest of a website has no type at all. Login, register, forgot-password,
 * contact, about and the policies are ordinary pages of type "page", so nothing
 * anywhere can tell a site that has them from a site that does not — and an
 * agent building a store therefore ships whatever it happened to think of. A
 * store built with these tools came out with a home page, a product list and a
 * category grid, and no way to contact the shop, no policy a shopper could
 * read, and no /login for its own header to link to.
 *
 * ADVICE, NOT A DEFECT, AND IT SAYS SO. `readinessGaps` is a list of things
 * that are broken; this is a list of things that are usually there. They are
 * kept apart deliberately: a check that reports a judgement as a defect is one
 * an author learns to ignore, and readiness.ts's own header says exactly that.
 *
 * MATCHED BY NAME, WHICH IS A GUESS, AND THE RESULT SAYS SO. There is no type,
 * no flag and no API that identifies a contact page, so the only signal is what
 * the merchant called it. A page under an unusual name therefore reads as
 * absent. That fails in the safe direction — a line of advice about a page you
 * already have costs a sentence; the reverse ships a shop nobody can reach.
 */

export interface UsualPage {
  key: string;
  /** Slug or name fragments, Vietnamese and English, lowercased. */
  match: string[];
  /** What the site is missing while this page is absent. */
  why: string;
  /**
   * The page LAYOUT this purpose opens with, where the platform declares one.
   *
   * The same keywords that decide a page is MISSING decide what it opens as, so
   * the two answers cannot drift apart: a name this table reads as "the about
   * page" is a name `sb_page_create` gives the about layout to. Absent means the
   * page has no layout of its own — the auth pages are built by sb_store, which
   * puts a real form on them, and a blank page is right for everything else.
   */
  layout?: string;
  /**
   * Only advise this page on a site the condition holds for.
   *
   * Absent means "every site". Present means the page answers a need this site
   * has actually created for itself — a blog listing matters once there is an
   * article template for it to list, and not before. Advice that does not apply
   * is the thing that teaches a reader to skim past the advice that does.
   */
  when?: (pages: InventoryPage[]) => boolean;
}

export const USUAL_PAGES: readonly UsualPage[] = [
  {
    key: 'login',
    match: ['login', 'signin', 'sign-in', 'dang-nhap', 'đăng nhập'],
    why:
      'Nothing for a header, an order email or /account\'s signed-out state to link to. ' +
      'sb_store action:"form" template:"login" page_name:"Đăng nhập" builds the form AND the page it lives on.',
  },
  {
    key: 'register',
    match: ['register', 'signup', 'sign-up', 'dang-ky', 'đăng ký'],
    why:
      'A shopper cannot open an account, so order history, addresses and any member-gated ' +
      'page are unreachable. sb_store action:"form" template:"register" with a page_name.',
  },
  {
    key: 'forgot',
    match: ['forgot', 'reset', 'quen-mat-khau', 'quên mật khẩu', 'doi-mat-khau'],
    why:
      'A customer who forgets a password has no way back in and writes to support instead. ' +
      'sb_store action:"form" template:"forgot" with a page_name.',
  },
  {
    key: 'contact',
    match: ['contact', 'lien-he', 'liên hệ'],
    why:
      'No address, phone or form anywhere, so a shopper with a question about an order has ' +
      'nowhere to put it. sb_store action:"form" template:"contact" with a page_name.',
  },
  {
    key: 'about',
    match: ['about', 'gioi-thieu', 'giới thiệu', 've-chung-toi'],
    why: 'Nothing says who the shop is, which is the page a first-time buyer opens before paying. ' +
      'sb_page_create name:"Giới thiệu" opens it as a heading, a story and a picture.',
    layout: 'about',
  },
  // TWO POLICIES, NOT ONE BUCKET. These were a single entry, and it read a shop
  // carrying only "Chính sách giao hàng & đổi trả" as complete — which is
  // exactly the shop that was measured, and it had no privacy terms at all. One
  // policy page satisfying a check about all of them is the check answering a
  // question it was not asked.
  {
    key: 'policy-delivery',
    match: [
      'doi-tra', 'đổi trả', 'return', 'refund', 'hoan-tien', 'hoàn tiền',
      'shipping', 'van-chuyen', 'vận chuyển', 'giao-hang', 'giao hàng', 'delivery',
    ],
    why:
      'No delivery or return terms a shopper can read before paying. This is the page a buyer ' +
      'looks for when the parcel is late and the one a dispute is settled against. ' +
      'sb_page_create with a name carrying "giao hàng" or "đổi trả" opens it as prose.',
    layout: 'policy',
  },
  {
    key: 'policy-privacy',
    match: [
      'privacy', 'bao-mat', 'bảo mật', 'dieu-khoan', 'điều khoản', 'terms',
      'quy-dinh', 'quy định',
    ],
    why:
      'No privacy policy or terms of use. Payment providers and marketplaces ask for both ' +
      'before they will list a shop, and a checkout form collects personal data either way. ' +
      'sb_page_create with a name carrying "bảo mật" or "điều khoản" opens it as prose.',
    layout: 'policy',
  },
  {
    key: 'faq',
    match: ['faq', 'cau-hoi', 'câu hỏi', 'hoi-dap', 'hỏi đáp', 'help', 'tro-giup', 'trợ giúp'],
    why:
      'The same handful of questions reach support one message at a time, with no page to link ' +
      'an answer to. sb_page_create name:"Câu hỏi thường gặp" opens it on the accordion, which ' +
      'is the element this page is made of.',
    layout: 'faq',
  },
  {
    key: 'blog',
    // ONLY ONCE THERE IS SOMETHING TO LIST. `post` is the ARTICLE template —
    // it answers /blog/{slug} and has no address of its own — so a site with
    // one can publish articles that nothing on the site links to. A site
    // without one has no articles, and telling it to build a listing page is
    // advice about a section it never asked for.
    when: (pages) => pages.some((x) => x.type === 'post'),
    match: ['blog', 'tin-tuc', 'tin tức', 'news', 'bai-viet', 'bài viết', 'kien-thuc', 'cẩm nang'],
    why:
      'This site has an article template, so /blog/{slug} works — but no page LISTS the ' +
      'articles, so each one is reachable only by someone who already has its URL. ' +
      'sb_page_create name:"Tin tức" opens it on a repeater already bound to them.',
    layout: 'articles',
  },
];

export interface InventoryPage {
  name?: unknown;
  slug?: unknown;
  type?: unknown;
}

/**
 * Which of the usual pages this site appears not to have.
 *
 * Only `page`-typed rows are searched: a product TEMPLATE named "Chi tiết sản
 * phẩm" is not an about page, and letting a template satisfy one of these would
 * report a site as complete on the strength of a page that answers a different
 * address entirely.
 */
export function missingUsualPages(pages: InventoryPage[] | null): UsualPage[] {
  if (!pages) return [];
  const hay = pages
    .filter((p) => (typeof p.type === 'string' ? isSlugType(p.type) : true))
    .map((p) => `${typeof p.slug === 'string' ? p.slug : ''} ${typeof p.name === 'string' ? p.name : ''}`.toLowerCase())
    .join('\n');
  return USUAL_PAGES.filter(
    (u) =>
      (u.when ? u.when(pages) : true) &&
      !u.match.some((m) => hay.includes(m)) &&
      // A page of the purpose's own type counts whatever it is called. Not for
      // the two policies: one `policy` page is not proof of the other.
      !pages.some((p) => p.type === u.key),
  );
}

/** Routed at its own slug like `page`: `page` itself and the purpose types (about, login…). */
function isSlugType(type: string): boolean {
  return PAGE_TYPES.some((t) => t.type === type && t.ownSlug);
}

/**
 * The PURPOSE type a page called `name` should be created as — `about`,
 * `contact`, `policy`, `faq` — or undefined for an ordinary page. The platform gave each its own type (and icon) so a page list says what
 * a page is FOR; the same keywords that decide a page is missing decide it here.
 */
export function purposeTypeForName(name: string): string | undefined {
  const hay = name.toLowerCase();
  const key = USUAL_PAGES.find((u) => u.match.some((m) => hay.includes(m)))?.key.replace(/^policy-.*/, 'policy');
  // Not login/register: "Đăng ký tư vấn" is a lead form, not an account page —
  // those come from sb_store action:"form", which sets the type itself.
  return key && key !== 'login' && key !== 'register' && isSlugType(key) ? key : undefined;
}

/**
 * The layout a page called `name` should open with, or undefined.
 *
 * READ OFF THE SAME KEYWORDS that decide a page is missing, so the two answers
 * cannot drift: a name this module reads as "the about page" is the name that
 * gets the about layout. That is the whole reason it lives here rather than in
 * a second table beside sb_page_create.
 *
 * ONLY FOR TYPE `page`. Every other type already opens with the seed its own
 * type describes, and a name-based guess on top of it would contradict a
 * decision the platform has already made.
 */
export function layoutForPageName(name: string, type: string | undefined): string | undefined {
  // A purpose type opens as its own layout, as in the editor. Not login/register:
  // that layout's form is unbound until sb_store action:"form" builds one.
  if (type && type !== 'page') {
    return isSlugType(type) && type !== 'login' && type !== 'register'
      ? USUAL_PAGES.find((u) => u.layout === type)?.layout
      : undefined;
  }
  const hay = name.toLowerCase();
  return USUAL_PAGES.find((u) => u.layout && u.match.some((m) => hay.includes(m)))?.layout;
}
