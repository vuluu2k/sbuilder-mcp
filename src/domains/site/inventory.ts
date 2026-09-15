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
}

export const USUAL_PAGES: readonly UsualPage[] = [
  {
    key: 'login',
    match: ['login', 'signin', 'sign-in', 'dang-nhap', 'đăng nhập'],
    why:
      'Nothing for a header, an order email or /account\'s signed-out state to link to. ' +
      'Seed it with sb_store action:"form" template "login" on a page of type "page".',
  },
  {
    key: 'register',
    match: ['register', 'signup', 'sign-up', 'dang-ky', 'đăng ký'],
    why:
      'A shopper cannot open an account, so order history, addresses and any member-gated ' +
      'page are unreachable. Template "register".',
  },
  {
    key: 'forgot',
    match: ['forgot', 'reset', 'quen-mat-khau', 'quên mật khẩu', 'doi-mat-khau'],
    why:
      'A customer who forgets a password has no way back in and writes to support instead. ' +
      'Template "forgot".',
  },
  {
    key: 'contact',
    match: ['contact', 'lien-he', 'liên hệ'],
    why:
      'No address, phone or form anywhere, so a shopper with a question about an order has ' +
      'nowhere to put it. Template "contact".',
  },
  {
    key: 'about',
    match: ['about', 'gioi-thieu', 'giới thiệu', 've-chung-toi'],
    why: 'Nothing says who the shop is, which is the page a first-time buyer opens before paying.',
  },
  {
    key: 'policy',
    match: [
      'policy', 'policies', 'chinh-sach', 'chính sách', 'dieu-khoan', 'điều khoản',
      'terms', 'privacy', 'bao-mat', 'bảo mật', 'doi-tra', 'đổi trả', 'return',
      'shipping', 'van-chuyen', 'vận chuyển', 'giao-hang', 'giao hàng', 'refund',
    ],
    why:
      'No delivery, return or privacy terms a shopper can read before paying — the pages a ' +
      'marketplace and a payment provider both ask for.',
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
    .filter((p) => (typeof p.type === 'string' ? p.type === 'page' : true))
    .map((p) => `${typeof p.slug === 'string' ? p.slug : ''} ${typeof p.name === 'string' ? p.name : ''}`.toLowerCase())
    .join('\n');
  return USUAL_PAGES.filter((u) => !u.match.some((m) => hay.includes(m)));
}
