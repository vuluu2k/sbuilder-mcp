/**
 * CAN A SHOPPER ACTUALLY BUY FROM THIS SITE YET?
 *
 * A mirror of the editor's own table (`editor/src/editor/storeReadiness.ts`),
 * which is the only place these rules exist — there is no server endpoint to
 * ask, so an agent that never opens the editor is blind to every one of them.
 *
 * That blindness is not theoretical. A four-page storefront built entirely
 * through these tools reviewed clean, published, and rendered correctly — and
 * the editor's publish panel then listed five gaps the agent had no way to see:
 * no checkout page, no payment gateway, an unpublished product template, no
 * shipping method, and no way to re-open the cart. Each survives publish
 * without a warning and is discovered by a real shopper.
 *
 * SILENT ON UNREAD DATA, exactly like the original: an input that could not be
 * fetched reports nothing rather than a gap the store may not have. A warning
 * that fires on a correctly built site is one the reader learns to ignore.
 */

import { cartGalleryThumbs, cartRelocalize, cartSeedLocale } from './cartlang.js';

/** The purchase binding an Add-to-cart / Buy-now button carries. */
const PRODUCT_ACTION_BINDING_ID = 'bind-product-action';

/** Element types that only make sense in a store. */
const COMMERCE_TYPES = [
  'cart-order',
  'cart-item',
  'cart-total',
  'product-variants',
  'quantity-dataset',
  'pricing-dataset',
  'media-dataset',
  'dataset-block',
  'list-dataset',
];

export type ReadinessGapId =
  | 'checkoutPage'
  | 'payment'
  | 'productPage'
  | 'shipping'
  | 'cartTrigger'
  | 'accountPage'
  | 'searchPage'
  | 'catalogue'
  | 'categoryScope'
  | 'siteChrome'
  | 'errorPage'
  | 'mergedAuthPage'
  | 'categoryPage'
  | 'articleTemplate'
  | 'blogCategoryPage'
  | 'coursePage'
  | 'maintenancePage'
  | 'cartCount'
  | 'cartDrawer'
  | 'cartDrawerLanguage'
  | 'cartDrawerThumbnail'
  | 'pageSeo'
  | 'homepage'
  | 'unreachablePage'
  | 'productImages'
  | 'siteFooter';

export interface ReadinessGap {
  id: ReadinessGapId;
  /** The page exists but is a draft: "publish it", not "create it". */
  draft: boolean;
  problem: string;
  fix: string;
}

export interface ReadinessPage {
  type: string;
  status: string;
  name?: string;
  id?: string;
  /** The served address ("/about"); absent means the list did not carry it. */
  path?: string;
  /** The page served at "/". Absent means the list did not carry the flag. */
  isHomepage?: boolean;
  /**
   * The page's own SEO blob — what the storefront writes into <head>. Absent
   * means the list did not carry it, and the pageSeo rule stays silent.
   */
  settings?: Record<string, unknown> | null;
}

/**
 * The page types a search engine INDEXES under the page's own settings. Entity
 * templates (product, category, post, course) get their <title> and
 * description merged from the entity (storefront/entityroute.go
 * mergeEntitySettings); error and maintain have no address; the fixed-path and
 * auth types are chrome a crawler is not sent to. Mirrors page.SlugTypes minus
 * the auth four, plus the blog listing.
 */
const INDEXED_PAGE_TYPES = new Set(['page', 'about', 'contact', 'policy', 'faq', 'blog']);

interface NodeLike {
  data: { type: string };
  /** Only `formId` is read — which FORM a node shows. See ReadinessInput.forms. */
  specials?: Record<string, unknown>;
  events?: Array<{ action?: string }>;
  bindings?: Array<{ id?: string; target?: { action?: string } }>;
  /** Only a repeater's `datasetSource` / `collectionType` — see categoryScope. */
  config?: Record<string, unknown>;
}

export interface ReadinessInput {
  /**
   * The site's forms, by TYPE; null when the list was unread.
   *
   * A page document carries `specials.formId` and nothing else — which form a
   * node shows, never what KIND it is — so this list is the only way to tell a
   * login form from a register form on a page that holds both.
   */
  forms?: Array<{ id?: string; type?: string }> | null;
  /** How many blog articles the site has written; null when the list was unread. */
  articles?: number | null;
  /** How many blog categories the site has; null when the list was unread. */
  blogCategories?: number | null;
  /** How many courses the site sells; null when the list was unread. */
  courses?: number | null;
  /**
   * Is the storefront switched OFF right now; null when the site could not be
   * read. The one input here that describes a state rather than a shape.
   */
  maintenanceMode?: boolean | null;
  /** `settings.locale` — what `<html lang>` is served from; null when unread or unset. */
  siteLocale?: string | null;
  /** How many product categories the store has; null when the list was unread. */
  categories?: number | null;
  /** How many of them point at a page of their own; null when unread. */
  categoryPageLinks?: number | null;
  /**
   * The open page's type when it is a SHARED template (not a page one entity
   * links to); undefined when unknown. Only `category` is read.
   */
  openPageType?: string;
  /** The site's pages; null when the list could not be read. */
  pages: ReadinessPage[] | null;
  /**
   * Every target the site's MENUS point at — page ids of `page` links and the
   * urls of `url` links, every level deep; null when the menus were unread.
   * With the hrefs on the shared sections and the open page, this is what
   * "reachable" means to a visitor.
   */
  menuLinks?: { pageIds: string[]; hrefs: string[] } | null;
  /** Gateways a shopper could really pay through; null when unread. */
  liveGateways: number | null;
  /** Delivery options the site offers; null when unread. */
  shippingMethods: number | null;
  /**
   * Products a shopper could actually buy — active, priced above zero — and how
   * many active ones there are at all. Null when the list could not be read.
   *
   * The most basic question of all, and the one nothing asked: a store with a
   * published product template, a checkout page, a live gateway and a delivery
   * option reports READY on an empty catalogue, and every repeater on it renders
   * its empty state to a shopper.
   */
  products: { active: number; purchasable: number; inactive?: number; unpictured?: number } | null;
  /** Every node of the open page. */
  pageNodes: NodeLike[];
  /** Every node of every global section master; null when unread. */
  globalNodes: NodeLike[] | null;
  /**
   * The KIND of each shared section the site has — header, footer, or neither.
   *
   * `globalNodes` answers what is inside them and cannot tell an empty list from
   * an unread one, which is the whole question here. Null when unread.
   */
  globalKinds?: string[] | null;
  /** The KIND of each overlay the site has (cart, popup, quickview); null when unread. */
  overlayKinds?: string[] | null;
  /** The site's cart drawer master (its document); null when unread or the site has none. */
  cartOverlay?: { root_node_id: string; nodes: Record<string, unknown> } | null;
}

/** Does this node carry a purchase action (add to cart, buy now)? */
function boundProductAction(n: NodeLike): boolean {
  return (n.bindings ?? []).some(
    (b) => b.id === PRODUCT_ACTION_BINDING_ID && !!b.target?.action,
  );
}

/**
 * Is any node a STANDALONE way to open the cart?
 *
 * The qualifier is the point: a purchase button emits `open_cart` too, so
 * counting every one would call a store covered when the only way to see the
 * basket is to put something else in it.
 */
function opensCart(nodes: NodeLike[]): boolean {
  return nodes.some(
    (n) => !boundProductAction(n) && (n.events ?? []).some((e) => e.action === 'open_cart'),
  );
}

/**
 * Is this a STORE at all? Two independent answers, either enough: the site
 * already has store pages, or the open page sells something. Requiring both
 * would silence the check for the beginner it exists for.
 */
function isStore(input: ReadinessInput): boolean {
  const pages = input.pages ?? [];
  if (pages.some((p) => p.type === 'product' || p.type === 'category' || p.type === 'checkout')) {
    return true;
  }
  if (input.pageNodes.some(boundProductAction)) return true;
  const types = new Set(input.pageNodes.map((n) => n.data.type));
  return COMMERCE_TYPES.some((t) => types.has(t));
}

const published = (pages: ReadinessPage[], type: string) =>
  pages.some((p) => p.type === type && p.status === 'published');
const drafted = (pages: ReadinessPage[], type: string) =>
  pages.some((p) => p.type === type && p.status !== 'published');

/**
 * What stands between this site and a paid order, most-blocking first — and,
 * asked FIRST because it is not about money at all, whether these pages are one
 * SITE.
 *
 * The precedent is `accountPage` and `searchPage`, already here on the same
 * reasoning: a shop with no account page still takes orders, so they are a
 * different question asked second. Shared chrome is a different question asked
 * FIRST, because it is true of every site and not only of a store.
 */
/** "N published pages (a, b, c, …)" — the head of a problem sentence that names its pages. */
function pageCount(rows: ReadinessPage[]): string {
  const named = rows.map((p) => p.name).filter((n): n is string => !!n).slice(0, 3);
  return (
    `${rows.length} published page${rows.length === 1 ? '' : 's'}` +
    (named.length ? ` (${named.join(', ')}${rows.length > named.length ? ', …' : ''})` : '')
  );
}

/** "/about/", "/about?x=1" and "/about" are one address; "" is the home page. */
function normalizePath(p: string): string {
  const s = p.split(/[?#]/)[0].replace(/\/+$/, '');
  return s === '' ? '/' : s;
}

/** Every href a set of nodes carries: `specials.href`, and a menu node's own snapshot rows. */
export function hrefsIn(nodes: NodeLike[]): Set<string> {
  const out = new Set<string>();
  const rows = (items: unknown): void => {
    if (!Array.isArray(items)) return;
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const r = it as { href?: unknown; items?: unknown };
      if (typeof r.href === 'string' && r.href !== '') out.add(normalizePath(r.href));
      rows(r.items);
    }
  };
  for (const n of nodes) {
    const h = n.specials?.href;
    if (typeof h === 'string' && h !== '') out.add(normalizePath(h));
    rows(n.specials?.menuItems);
  }
  return out;
}

/**
 * Published content pages nothing points at. Reachable means a menu item
 * references the page or its path, or a node in the shared chrome, on the open
 * page, or (menuLinks.hrefs, appended by gatherReadiness only when this list
 * is otherwise non-empty) in the body of any other published page carries its
 * path as an href. Empty when the menus or the shared sections were unread.
 */
export function unreachablePages(input: ReadinessInput): ReadinessPage[] {
  const pages = input.pages;
  if (!pages || !input.menuLinks || !input.globalNodes) return [];
  const reach = new Set<string>(input.menuLinks.hrefs.map(normalizePath));
  for (const h of hrefsIn([...input.globalNodes, ...input.pageNodes])) reach.add(h);
  const byId = new Set(input.menuLinks.pageIds);
  return pages.filter(
    (p) =>
      p.status === 'published' &&
      INDEXED_PAGE_TYPES.has(p.type) &&
      p.isHomepage !== true &&
      typeof p.id === 'string' &&
      typeof p.path === 'string' &&
      !byId.has(p.id) &&
      !reach.has(normalizePath(p.path)),
  );
}

export function readinessGaps(input: ReadinessInput): ReadinessGap[] {
  const gaps: ReadinessGap[] = [];
  const pages = input.pages;

  // NOTHING ANSWERS AT "/".
  //
  // storefront.go: the empty slug is the home page, resolved by the
  // isHomepage flag — a site whose pages all carry slugs serves a 404 at its
  // own front door, while every page on it is reachable and reviews clean.
  // Reached by an agent that built pages by name and never named one home, or
  // demoted the home page by moving the star (page.ts explains the flag). Only
  // when the list carried the flag at all.
  if (pages && pages.length > 0 && pages.some((p) => typeof p.isHomepage === 'boolean')) {
    const home = pages.filter((p) => p.isHomepage === true);
    if (!home.some((p) => p.status === 'published')) {
      const draft = home.length > 0;
      gaps.push({
        id: 'homepage',
        draft,
        problem: draft
          ? 'The home page exists but is not published, so "/" — the address on every card, ' +
            'link and search result — answers 404 while every other page is live.'
          : 'No page is the home page, so "/" answers 404. Every page on the site is reachable ' +
            'by its slug and none of them is the front door.',
        fix: draft
          ? 'Publish the home page.'
          : 'Make one: PATCH /api/v1/pages/{id} { "isHomepage": true } on the page that should ' +
            'answer at "/" — it moves the star and clears the slug. Or sb_page_create with ' +
            'is_homepage: true, which adopts the home page the site already has.',
      });
    }
  }

  // A PAGE NO VISITOR CAN GET TO — see unreachablePages().
  //
  // Every tool here authors one page and a menu is a separate record, so a
  // site can carry a published About page that nothing links to: the sitemap
  // lists it, the address works, and no visitor ever arrives. Reachable means
  // a menu item references the page or its path, or something in the shared
  // chrome or on the open page carries its path as an href (a `menu` node's
  // own snapshot included). Content pages only, never the home page, and only
  // when both the menus and the shared sections were read — a footer link
  // this rule could not see must not become a finding.
  {
    const orphans = unreachablePages(input);
    if (orphans.length > 0) {
      gaps.push({
        id: 'unreachablePage',
        draft: false,
        problem:
          pageCount(orphans) +
          ' that no menu item and no link in the shared header, footer or any other page ' +
          'points at. The address works and the sitemap lists it; no visitor ever arrives.',
        fix:
          'Add it to the site menu — read GET /api/sites/{siteId}/menus, append ' +
          '{ label, link: { type: "page", pageId } } and PUT the menu back; every bound menu ' +
          'node follows. Or link it from the footer with sb_event go_to_url. A page kept out ' +
          'on purpose (a landing page for ads) can stay out — say so.',
      });
    }
  }

  // A SITE WITH NO SHARED SECTION IS NOT A SITE, IT IS A STACK OF PAGES.
  //
  // Nothing asked this. Every tool here authors ONE page, so a build that never
  // reaches for a global section gives each page its own header and footer —
  // and then a change to the nav is one edit per page, the copies drift, and a
  // visitor meets a slightly different site on every click. It is the most
  // basic thing a website has that a generated one does not, and it is
  // invisible to `sb_review`, which reads one page and finds it perfect.
  //
  // Two pages is the threshold: a one-page site has nothing to share with.
  if (pages && pages.length >= 2 && input.globalKinds !== null && input.globalKinds?.length === 0) {
    gaps.push({
      id: 'siteChrome',
      draft: false,
      problem:
        `This site has ${pages.length} pages and no global section, so each one carries its own ` +
        'header and footer. Changing the menu is that many edits, the copies drift apart, and a ' +
        'visitor meets a slightly different site on every page.',
      fix:
        'Make them shared: POST /api/sites/{siteId}/global-sections with { name, kind: "header" | ' +
        '"footer", document }, then PUT .../{id}/document with { subtree }. A page then carries a ' +
        'globalRef instead of a copy, and one edit reaches every page.',
    });
  }

  // A HEADER AND NO FOOTER.
  //
  // `sb_store action:"chrome"` builds the header; the footer is an opt-in flag
  // on the same call, so a site built here has a shared header and, on every
  // page, either its own footer or none — no policy links, no contact, no
  // copyright line, and nothing below the last section but the end of the
  // document. The same threshold as siteChrome, asked only once the site HAS
  // shared chrome (an empty list is siteChrome's finding, not this one).
  if (
    pages &&
    pages.length >= 2 &&
    input.globalKinds &&
    input.globalKinds.length > 0 &&
    !input.globalKinds.includes('footer')
  ) {
    gaps.push({
      id: 'siteFooter',
      draft: false,
      problem:
        'The site shares a header and no footer, so every page ends at its last section — ' +
        'no policy links, no contact, no copyright line, and each page that has a footer of ' +
        'its own drifts from the next.',
      fix:
        'sb_store action:"chrome" footer:true builds one shared footer on a real site menu and ' +
        'attaches it to every page. Put the policy, contact and about pages in it.',
    });
  }

  // THE SITE IS DARK RIGHT NOW AND SAYING NOTHING IN ITS OWN VOICE.
  //
  // Reported FIRST, because it is the only finding here that is not about what
  // a visitor might one day meet: with the switch on, every public address is
  // answering 503 this second. `maintenance.go` serves the published `maintain`
  // page as that body when there is one, and a PLAIN SENTENCE when there is
  // not — and it FAILS CLOSED on purpose, so an unresolvable page does not
  // reopen the shop. The owner gets the outage they asked for either way; what
  // they lose is every word of it.
  //
  // ONLY WHILE THE SWITCH IS ON. Telling a site to build a page for an outage
  // it is not having is advice about a page nobody will see, and it would
  // arrive on every review of every site — the nag this file keeps warning
  // about, at the widest possible scale. Silent when the site could not be
  // read, like everything else.
  if (pages && input.maintenanceMode === true && !published(pages, 'maintain')) {
    const draft = drafted(pages, 'maintain');
    gaps.push({
      id: 'maintenancePage',
      draft,
      problem:
        'This storefront is switched OFF right now and has no published page of the "maintain" ' +
        'type, so every address is answering a bare 503 sentence — no header, no logo, no word ' +
        'about when it is back, and nothing that looks like this shop.',
      fix: draft
        ? 'Publish the maintenance page that already exists.'
        : 'Create a page of type "maintain" and publish it. It has no address of its own — the ' +
          'storefront serves it as the BODY of the 503 — so give it the shop\'s name and a line ' +
          'saying when you are back.',
    });
  }

  // A MISTYPED URL ANSWERS IN GO, NOT IN THE SHOP'S VOICE.
  //
  // storefront/errorpage.go: with no PUBLISHED page of type `error`, notFound
  // falls through to http.NotFound — the bare "404 page not found" in plain
  // text. No header, no footer, no way back to the shop, and nothing that looks
  // like the site the shopper was just in.
  //
  // Unlike the completion page, which backstops itself with a built-in receipt
  // (measured 200 on a live store that had none), this fallback carries none of
  // the site. And unlike a dead link, nothing reports it: the only person who
  // sees it is a visitor who already took a wrong turn and now has no way back.
  //
  // Asked of EVERY site, not only a store, and so placed here with siteChrome
  // rather than below the gate — a mistyped URL is not a commerce question.
  //
  // TWO PAGES IS THE THRESHOLD, the same one siteChrome uses and for a related
  // reason: a one-page site has no second address to mistype, no menu to follow
  // a stale link out of, and nothing to put in a header that would make a 404
  // look like the site. Below it this would be a nag at a brochure — which the
  // silence contract in readiness.test.ts names outright.
  if (pages && pages.length >= 2 && !published(pages, 'error')) {
    const draft = drafted(pages, 'error');
    gaps.push({
      id: 'errorPage',
      draft,
      problem:
        'A URL that does not exist answers with the platform\'s own bare "404 page not found" ' +
        'in plain text — no header, no footer, no way back to the shop. A shopper who follows ' +
        'a stale link or mistypes an address lands on a blank page that does not look like ' +
        'this site at all.',
      fix: draft
        ? 'Publish the error page that already exists.'
        : 'Create a page of type "error" and publish it. It has no address of its own — the ' +
          'storefront serves it as the BODY of a 404 — so give it the site\'s header and ' +
          'footer and a link back to the home page.',
    });
  }

  // EVERY PAGE ANSWERS WITH THE SAME <title>, AND NO DESCRIPTION.
  //
  // storefront.go pageSettings.head: a page whose settings carry no `title`
  // serves the SITE NAME as its <title>, and no `description` means no meta
  // description at all — so a site built through these tools, where nothing
  // ever asks for either, publishes N pages that a search result cannot tell
  // apart. Invisible on the canvas, invisible in a screenshot, and the one
  // thing a search engine reads first.
  //
  // Only the types whose head IS the page's own settings (INDEXED_PAGE_TYPES),
  // only published pages, and only when the list carried `settings` at all —
  // an absent blob is "not read", not "empty".
  if (pages) {
    const bare = pages.filter((p) => {
      if (p.status !== 'published' || !INDEXED_PAGE_TYPES.has(p.type)) return false;
      const st = p.settings;
      if (!st || typeof st !== 'object') return false;
      const has = (k: string) => typeof st[k] === 'string' && (st[k] as string).trim() !== '';
      return !(has('title') && has('description'));
    });
    if (bare.length > 0) {
      gaps.push({
        id: 'pageSeo',
        draft: false,
        problem:
          pageCount(bare) +
          (bare.length === 1 ? ' carries' : ' carry') +
          ' no settings.title or settings.description. Each serves the SITE NAME as its ' +
          '<title> and no meta description — a search result cannot tell them apart, and ' +
          'nothing on the canvas or in a screenshot shows it.',
        fix:
          'PATCH /api/v1/pages/{id} with {settings: {...existing, title, description}} — ' +
          '`settings` REPLACES the blob, so read the page and send it back whole. Title is ' +
          'what the tab and the result show (under ~60 chars); description is the ' +
          'two-line summary under it. ogImage takes a share picture.',
      });
    }
  }

  // ONE PAGE QUIETLY BECAME THE WHOLE ACCOUNT AREA.
  //
  // This server used to tell agents, in as many words, to put the login and the
  // register form behind a member-gate on /account. They did. The result is a
  // page carrying two or three different jobs, and — the part that is not a
  // matter of taste — NEITHER JOB HAS AN ADDRESS. A header can link to one
  // thing, an email that says "reset your password" has nowhere specific to
  // point, and a visitor who came to register meets a login form first because
  // that is what was stacked on top.
  //
  // The rule was fixed; the pages it already built were not, and nothing could
  // see them: a page document carries `specials.formId` and never the KIND of
  // form, so only the site's own form list can tell these apart.
  //
  // COUNTED BY DISTINCT TYPE, not by how many form nodes there are. A form split
  // across segments is several nodes of ONE type and is not this defect.
  const authTypes = new Set(['login', 'register', 'forgot', 'reset', 'verify']);
  if (input.forms && input.forms.length > 0) {
    const typeOf = new Map(
      input.forms
        .filter((f): f is { id: string; type: string } => !!f?.id && !!f?.type)
        .map((f) => [f.id, f.type]),
    );
    const onPage = new Set<string>();
    for (const n of input.pageNodes) {
      if (n.data.type !== 'form') continue;
      const id = n.specials?.formId;
      const t = typeof id === 'string' ? typeOf.get(id) : undefined;
      if (t && authTypes.has(t)) onPage.add(t);
    }
    if (onPage.size >= 2) {
      const named = [...onPage].sort().join(', ');
      gaps.push({
        id: 'mergedAuthPage',
        draft: false,
        problem:
          `This page carries ${onPage.size} different account forms (${named}). Neither has an ` +
          'address of its own, so a header can link to only one of them, a password-reset mail ' +
          'has nowhere specific to point, and whoever came to do the second thing meets the ' +
          'first one stacked on top.',
        fix:
          'Give each its own page: sb_store action:"form" with template "login", "register" or ' +
          '"forgot" and a page_name builds the form AND the page in one call. Leave /account ' +
          'showing the profile behind a member-gate with audience "members", and a short ' +
          'sign-in prompt LINKING to the login page behind audience "guests".',
      });
    }
  }

  // ARTICLES WRITTEN AND NOTHING TO RENDER THEM IN.
  //
  // `post` is the ARTICLE template: /blog/{slug} resolves to the site's
  // published page of that type, so a site that has written articles and has
  // none 404s every single one — including the links its own listing page
  // carries, which is the page that makes the articles findable in the first
  // place.
  //
  // ASKED OF EVERY SITE, above the store gate: a blog is not a commerce
  // feature, and a brochure site with a news section has exactly this problem.
  // Gated on having WRITTEN something, so a site with no blog hears nothing.
  if (pages && (input.articles ?? 0) > 0 && !published(pages, 'post')) {
    const draft = drafted(pages, 'post');
    gaps.push({
      id: 'articleTemplate',
      draft,
      problem:
        `This site has ${input.articles} article${input.articles === 1 ? '' : 's'} and no ` +
        'published page of the "post" type. /blog/{slug} needs one, so every article 404s — ' +
        'including the links a listing page carries.',
      fix: draft
        ? 'Publish the article template page that already exists.'
        : 'Create a page of type "post" and publish it. It opens seeded with the cover, ' +
          'headline, date and body an article cannot be read without.',
    });
  }

  // THE LAST TWO ENTITY PREFIXES, the same hole in the same shape.
  //
  // storefront/entityroute.go registers five: /products, /collections, /blog,
  // /blog-categories and /courses. Each resolves to the site's published page of
  // its own TYPE, so each 404s everything under it when that page is missing.
  // Four of the five are now checked above; these are the other two.
  //
  // COUNTED, NOT ASSUMED. A site with no blog categories has nothing under
  // /blog-categories to break, and a site with no courses has not installed the
  // app — the count IS the gate, which is why neither needs to ask about the
  // app separately. Both sit above the store gate: a course is sold, but a blog
  // is not commerce, and a site can be neither and still have one.
  for (const [count, type, id, prefix, what] of [
    [input.blogCategories, 'blog', 'blogCategoryPage' as const, '/blog-categories/{slug}', 'blog category'],
    [input.courses, 'course', 'coursePage' as const, '/courses/{slug}', 'course'],
  ] as const) {
    if (!pages || (count ?? 0) === 0 || published(pages, type)) continue;
    const draft = drafted(pages, type);
    gaps.push({
      id,
      draft,
      problem:
        `This site has ${count} ${what}${count === 1 ? '' : count && count > 1 ? 's' : ''} and no ` +
        `published page of the "${type}" type. ${prefix} needs one, so every ${what} link 404s.`,
      fix: draft
        ? `Publish the ${what} template page that already exists.`
        : `Create a page of type "${type}" and publish it.`,
    });
  }

  // A CART DRAWER IN ANOTHER LANGUAGE. Asked before the store gate: a drawer
  // that exists is shown on every page, whatever this page sells.
  if (input.siteLocale && input.cartOverlay?.root_node_id) {
    const locale = cartSeedLocale(input.siteLocale);
    const changes = cartRelocalize(input.cartOverlay, input.cartOverlay.root_node_id, locale);
    if (changes.length > 0) {
      gaps.push({
        id: 'cartDrawerLanguage',
        draft: false,
        problem:
          `The site's locale is "${input.siteLocale}", but the cart drawer still carries another ` +
          `language's seed words: ${[...new Set(changes.map((c) => `"${c.from}"`))].join(', ')}. ` +
          'Every page shows it.',
        fix:
          'Open any page of this site, then sb_store action:"cart" relocalize:true dry_run:false — it ' +
          `rewrites exactly those seed strings to the "${locale}" seed's, and leaves edited text alone.`,
      });
    }
  }

  if (input.cartOverlay?.root_node_id && cartGalleryThumbs(input.cartOverlay, input.cartOverlay.root_node_id).length) {
    gaps.push({
      id: 'cartDrawerThumbnail',
      draft: false,
      problem:
        'The cart drawer\'s line thumbnail is a GALLERY (feature image plus a thumbs strip) squeezed ' +
        'into a 64px line — a drawer seeded before the platform fixed its seed.',
      fix: 'Open any page of this site, then sb_store action:"cart" relocalize:true dry_run:false — it sets that thumbnail to a single image.',
    });
  }

  if (!isStore(input)) return gaps;

  if (pages && !published(pages, 'checkout')) {
    const draft = drafted(pages, 'checkout');
    gaps.push({
      id: 'checkoutPage',
      draft,
      problem:
        'No published page of the "checkout" type. /checkout resolves by page TYPE, so the ' +
        'Checkout button every cart drawer ships with sends a shopper with a full basket to a 404.',
      // NOT "create a page of type checkout": that page needs an order form
      // bound to the cart, and the four writes that build one have a fixed order
      // the editor keeps in a single file. A fix that names a step which does not
      // work on its own is worse than no fix — it sends the agent to build a
      // checkout page that renders and takes no orders.
      fix: draft
        ? 'Publish the checkout page that already exists (sb_page_list shows it, then sb_publish).'
        : 'sb_store with action:"checkout" — it makes the order form, configures it, saves its ' +
          'fields and publishes the page. Doing it by hand needs all four, in order.',
    });
  }
  if (input.liveGateways === 0) {
    gaps.push({
      id: 'payment',
      draft: false,
      problem:
        'No live payment gateway. The checkout form can offer nothing but cash on delivery, and ' +
        'any order needing an online payment dead-ends at the server.',
      fix: 'Enable and configure a gateway in the store settings (sb_api_find "payment gateways").',
    });
  }
  if (pages && !published(pages, 'product')) {
    const draft = drafted(pages, 'product');
    gaps.push({
      id: 'productPage',
      draft,
      problem:
        'No published page of the "product" type. /products/{slug} needs one, so every link out ' +
        'of a product card 404s.',
      fix: draft
        ? 'Publish the product template page that already exists.'
        : 'Create a page of type "product" and publish it.',
    });
  }
  // AND THE SAME HOLE ON THE OTHER SIDE OF THE CATALOGUE.
  //
  // `/collections/{slug}` resolves the same way /products/{slug} does — through
  // PublishedForEntity, to the category's own page or to the DEFAULT TEMPLATE
  // for the `category` type — so a store with categories and no published one
  // 404s every collection link, including the ones its own menu carries.
  //
  // `categoryScope` below is a different defect and assumes this page EXISTS:
  // it reports a template SHARED across categories, which is the complaint you
  // can only make once there is a template to share. With none, every URL fails
  // outright and the scope question does not arise.
  //
  // GATED ON HAVING CATEGORIES, unlike productPage. A store can genuinely sell
  // without collections — one shop, one flat catalogue — and telling it to build
  // a template for a thing it does not use is the nag this file keeps warning
  // about. Silent when the count could not be read, like everything else here.
  if (pages && (input.categories ?? 0) > 0 && !published(pages, 'category')) {
    const draft = drafted(pages, 'category');
    gaps.push({
      id: 'categoryPage',
      draft,
      problem:
        `This store has ${input.categories} categor${input.categories === 1 ? 'y' : 'ies'} and no ` +
        'published page of the "category" type. /collections/{slug} needs one, so every ' +
        'collection link 404s — including the ones in the site\'s own menu.',
      fix: draft
        ? 'Publish the category template page that already exists.'
        : 'Create a page of type "category" and publish it. It opens seeded with the collection ' +
          'title and a product repeater.',
    });
  }

  // NOTHING TO SELL. Checked before the delivery option, because a shipping
  // method for an empty catalogue is furniture.
  if (input.products) {
    if (input.products.active === 0 && (input.products.inactive ?? 0) > 0) {
      // PRODUCTS EXIST AND NONE IS ACTIVE. A product created without a status is
      // stored as "draft" (products.go: an empty Status becomes ProductStatusDraft),
      // the storefront lists only "active", and since web_builder b4d60a862 the
      // checkout refuses any other status outright — so a catalogue built through
      // the API without saying status:"active" is a store with nothing to buy.
      gaps.push({
        id: 'catalogue',
        draft: false,
        problem:
          `The store has ${input.products.inactive} products and none is active — a product ` +
          'created without status is stored as "draft", which the storefront never lists and ' +
          'the checkout refuses. Every product list renders its empty state.',
        fix:
          'PUT /api/v1/products/{id} with the whole object read back and status: "active" ' +
          '(PATCH is 405). Send status: "active" on every POST /api/v1/products from now on.',
      });
    } else if (input.products.active === 0) {
      gaps.push({
        id: 'catalogue',
        draft: false,
        problem:
          'The store has no active products. Every product list on the site renders its empty ' +
          'state, the product template has nothing to bind to, and there is nothing to add to a ' +
          'cart — on a site that otherwise reports ready.',
        fix:
          'Create products (sb_api_find "create product") with status: "active" — one created ' +
          'without a status is a draft. priceCents is minor units — VND × 100.',
      });
    } else if (input.products.purchasable === 0) {
      gaps.push({
        id: 'catalogue',
        draft: false,
        problem:
          `All ${input.products.active} active products are priced at zero. They render, they add ` +
          'to the cart, and the order totals nothing — which reads as a working store right up ' +
          'to the money.',
        fix: 'Set priceCents on each product and its variants. Minor units: VND × 100.',
      });
    }
  }

  // A CARD WITH THE PLATFORM'S GREY SQUARE WHERE THE PHOTO GOES.
  //
  // render/nodes/image/html.go: no src → nodes.ImagePlaceholder, "a card
  // instead of a broken icon". So a product created without `images` renders
  // on every card, in every drawer line and on its own page as the same grey
  // placeholder — nothing errors, and a catalogue of twenty reads as a
  // template nobody finished. Asked after the money questions: a store with
  // no photos still takes an order.
  if (input.products && input.products.active > 0 && (input.products.unpictured ?? 0) > 0) {
    const n = input.products.unpictured!;
    gaps.push({
      id: 'productImages',
      draft: false,
      problem:
        `${n} of ${input.products.active} active products ${n === 1 ? 'has' : 'have'} no image, so every card, cart ` +
        "line and product page shows the platform's grey placeholder where the photo goes.",
      fix:
        'Get a picture into the library (sb_media_upload: a file, a url, or query + pick), then ' +
        'PUT the whole product back with images: [url, …] — first is the primary. POST ' +
        '/api/media/{siteId}/from-url ingests straight from a url in one hop.',
    });
  }

  if (input.shippingMethods === 0) {
    gaps.push({
      id: 'shipping',
      draft: false,
      problem:
        'No delivery options. The checkout page seeds a shipping select whose options ARE the ' +
        "site's own methods, so the shopper meets a required-looking field with nothing in it " +
        'and every order ships free.',
      fix: 'Add at least one shipping method (sb_api_find "shipping methods").',
    });
  }
  // THE OTHER FIXED PATHS.
  //
  // `page.FixedPathTypes` is four — search, checkout, complete, account — and
  // each resolves to the site's PUBLISHED page of that type
  // (storefront/typeroute.go). `complete` is the one that backstops itself: with
  // no completion page the storefront serves a built-in receipt, measured 200 on
  // a live store that had none. The other three 404, and `/account` and
  // `/search` 404 QUIETLY — nothing links to them by default, so the merchant
  // finds out when a shopper who wants their order history does.
  //
  // Separate from the five above, and after them, because these do not stand
  // between the store and a PAID ORDER: a shop with no account page still takes
  // money. They stand between it and a finished website, which is the next
  // question a merchant asks.
  //
  // WHAT /account OWES A SIGNED-OUT VISITOR IS A WAY IN, NOT EVERY FORM AT ONCE.
  // This fix used to read "put login and register forms behind a member-gate
  // with audience guests", and agents did exactly that — one page carrying the
  // profile, the login form and the register form, with nothing for a header to
  // link to and no /login to bookmark. Reported from a built store as the pages
  // coming out "ngáo": the rule was the cause, not the agent.
  //
  // The gate itself is load-bearing and stays: membersOnlyRedirectTarget sends
  // every gated visitor to /account (and to "/" when there is none), so that
  // page MUST answer a signed-out visitor with something. A prompt and a link
  // is that something.
  for (const [type, id, what, fix] of [
    [
      'account',
      'accountPage' as const,
      '/account 404s. A shopper has no way to see their orders, addresses or saved items, and ' +
        'the account elements (account-info, address-book, wishlist-list, points-card) have ' +
        'nowhere to live.',
      'Create a page of type "account" and publish it: the profile behind a member-gate with ' +
        'audience "members", and behind audience "guests" a short sign-in prompt LINKING to the ' +
        'login page — not the forms themselves. Login, register and forgot-password are three ' +
        'pages of their own (types "login", "register", "page"), each made by sb_store action:"form" with template ' +
        '"login", "register" or "forgot". Putting all three inside /account hands a shopper one ' +
        'crowded page and hands a header nothing to link to: a popup is a fine way to SIGN IN, ' +
        'but only a page has an address, and /account is the address this platform already ' +
        'sends every gated visitor to.',
    ],
    [
      'search',
      'searchPage' as const,
      '/search 404s, so a search box in the header sends every shopper to a dead page.',
      'Create a page of type "search" and publish it.',
    ],
  ] as const) {
    if (!pages || published(pages, type)) continue;
    const draft = drafted(pages, type);
    gaps.push({
      id,
      draft,
      problem: what,
      fix: draft ? `Publish the ${type} page that already exists.` : fix,
    });
  }

  const everywhere = input.globalNodes !== null ? [...input.pageNodes, ...input.globalNodes] : null;

  // A BASKET WITH NO NUMBER ON IT. The platform shipped `cart-count` to fix
  // exactly this, and made it OPT-IN: `open_cart` is an ACTION any element can
  // carry, not an element type, so there is no "cart icon" to give a badge to by
  // default — minting one unasked would put a number on every social glyph in
  // every footer. The cost of that decision is that a site authored through
  // these tools never has one: a shopper adds an item, gets a toast that fades,
  // and nothing anywhere on the page says their basket holds anything.
  //
  // Only asked when something DOES open the cart — otherwise `cartTrigger`
  // below is the finding, and this would be a second sentence about the same
  // missing control.
  if (everywhere && opensCart(everywhere) && !everywhere.some((n) => n.data.type === 'cart-count')) {
    gaps.push({
      id: 'cartCount',
      draft: false,
      problem:
        'Something opens the cart, but nothing shows what is in it. A shopper who adds an item ' +
        'sees a toast that fades and then no evidence anywhere that their basket is not empty.',
      fix:
        'When the control is an icon, sb_add with parent_id = that icon and spec ' +
        '{ type: "cart-count" } attaches the badge as its satellite (config.cartCountId); ' +
        'otherwise sb_add a cart-count beside it.',
    });
  }

  // A CART BUTTON THAT OPENS NOTHING. `open_cart` opens the site's ONE drawer —
  // the overlay of kind `cart` — and a site that never made one has a control
  // that renders, saves, publishes and does nothing when a shopper clicks it.
  // Any node counts here, a purchase button included: it opens the same drawer.
  if (
    input.overlayKinds &&
    !input.overlayKinds.includes('cart') &&
    [...input.pageNodes, ...(input.globalNodes ?? [])].some((n) =>
      (n.events ?? []).some((e) => e.action === 'open_cart'),
    )
  ) {
    gaps.push({
      id: 'cartDrawer',
      draft: false,
      problem:
        'A control opens the cart, but this site has no cart drawer, so clicking it opens nothing.',
      fix:
        'Run sb_store action:"cart" dry_run:false — it creates the site\'s cart drawer from the ' +
        'editor\'s own seed, and the platform composes it onto every page.',
    });
  }

  if (input.globalNodes !== null && !opensCart([...input.pageNodes, ...input.globalNodes])) {
    gaps.push({
      id: 'cartTrigger',
      draft: false,
      problem:
        'Nothing on the site opens the cart on its own. A shopper who closes the drawer cannot ' +
        'get back to it — adding a second item to look at the first is not a way back.',
      fix: 'Put a control with the open_cart event in the header global section.',
    });
  }

  // A SHARED CATEGORY TEMPLATE PINNED TO ONE CATEGORY.
  //
  // `/collections/{slug}` serves the category's own page when a page-link names
  // one, else the default `category` template. Since web_builder b4ca5645 that
  // template scopes itself: `all_products` (and the explicit `page_collection`)
  // on it list the category in the URL, so one shared template is RIGHT and no
  // page per category is needed. What still breaks it is the one kind that
  // names its own id — `collection` + `collectionId` — when that is the only
  // product repeater on the template: every category then shows that one.
  // A pinned shelf BESIDE a repeater that follows the URL is a "you may also
  // like" design, not this defect. Read off the open page, so it speaks only
  // while the template itself is under review.
  const shelves = input.pageNodes.filter(
    (n) => n.data.type === 'list-dataset' && (n.config?.datasetSource ?? 'product') === 'product',
  );
  if (
    input.openPageType === 'category' &&
    (input.categories ?? 0) > 1 &&
    input.categoryPageLinks != null &&
    input.categoryPageLinks < (input.categories ?? 0) &&
    shelves.length > 0 &&
    shelves.every((n) => n.config?.collectionType === 'collection')
  ) {
    gaps.push({
      id: 'categoryScope',
      draft: false,
      problem:
        'This is the shared category template, and every product repeater on it is pinned to ONE ' +
        'named collection — so /collections/{slug} shows that same collection for all ' +
        `${input.categories} categories.`,
      fix:
        'Set the repeater to follow the URL: sb_set config { "collectionType": "page_collection" } ' +
        '(or leave it on "all_products", which scopes itself on a category page). The draft ' +
        'preview has no category in the URL and lists the whole catalogue — judge it at ' +
        '/collections/{slug} on the published storefront.',
    });
  }

  return gaps;
}

// Letters ONLY Vietnamese writes: ă ơ ư đ, the dot-below / hook-above tones and
// circumflex+tone. Bare â ê ô and acute/grave/tilde vowels are French or
// Portuguese too, and counting them read a French page as Vietnamese.
const VI_LETTERS = /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịĩọỏốồổỗộớờởỡợụủũứừửữựỳỵỷỹ]/i;

/**
 * THE SITE SAYS ONE LANGUAGE AND THE PAGE ANOTHER. `settings.locale` is what
 * `<html lang>` is served from — the voice a screen reader picks, the language
 * a search engine indexes, the storefront's own built-in strings — and a site
 * is born with its creator's language, so a Vietnamese shop made from an `en`
 * account reads its whole catalogue in an English voice. Nothing on the page
 * shows it.
 *
 * ponytail: a letter-set heuristic over text nodes, warning only "Vietnamese copy,
 * locale not vi"; a real language detector if a third market ever matters.
 */
export function siteLanguage(locale: string | null | undefined, nodes: NodeLike[]): string | null {
  if (!locale) return null;
  const texts = nodes
    .map((n) => n.specials?.text)
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.replace(/<[^>]*>/g, ' ').trim())
    .filter((t) => /[a-zà-ỹ]{3}/i.test(t));
  if (texts.length < 3) return null;
  const vi = texts.filter((t) => VI_LETTERS.test(t)).length / texts.length;
  // One direction only: no Vietnamese letters on a `vi` site is unaccented copy or
  // English product and brand names far more often than a wrong locale.
  if (vi < 0.5 || /^vi\b/i.test(locale)) return null;
  return (
    `The site's locale is "${locale}" but this page's copy is Vietnamese — <html lang> ` +
    'is served from the locale, so screen readers and search engines read the page in the ' +
    `wrong language, and the storefront's built-in strings follow it. sb_theme locale:"vi" ` +
    'sets it (site-wide).'
  );
}

export const READINESS_NOTICE =
  'These are STORE gaps, not page defects: each one survives publish without a warning and is ' +
  'found by a real shopper. They are the platform\'s own readiness rules, which no API exposes — ' +
  'the editor computes them client-side, so an agent that never opens the editor cannot see them.';
