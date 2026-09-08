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
  | 'searchPage';

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
}

interface NodeLike {
  data: { type: string };
  events?: Array<{ action?: string }>;
  bindings?: Array<{ id?: string; target?: { action?: string } }>;
}

export interface ReadinessInput {
  /** The site's pages; null when the list could not be read. */
  pages: ReadinessPage[] | null;
  /** Gateways a shopper could really pay through; null when unread. */
  liveGateways: number | null;
  /** Delivery options the site offers; null when unread. */
  shippingMethods: number | null;
  /** Every node of the open page. */
  pageNodes: NodeLike[];
  /** Every node of every global section master; null when unread. */
  globalNodes: NodeLike[] | null;
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

/** What stands between this site and a paid order, most-blocking first. */
export function readinessGaps(input: ReadinessInput): ReadinessGap[] {
  if (!isStore(input)) return [];
  const gaps: ReadinessGap[] = [];
  const pages = input.pages;

  if (pages && !published(pages, 'checkout')) {
    const draft = drafted(pages, 'checkout');
    gaps.push({
      id: 'checkoutPage',
      draft,
      problem:
        'No published page of the "checkout" type. /checkout resolves by page TYPE, so the ' +
        'Checkout button every cart drawer ships with sends a shopper with a full basket to a 404.',
      fix: draft
        ? 'Publish the checkout page that already exists (sb_page_list shows it, then sb_publish).'
        : 'Create a page of type "checkout" and publish it.',
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
  for (const [type, id, what, fix] of [
    [
      'account',
      'accountPage' as const,
      '/account 404s. A shopper has no way to see their orders, addresses or saved items, and ' +
        'the account elements (account-info, address-book, wishlist-list, points-card) have ' +
        'nowhere to live.',
      'Create a page of type "account" and publish it. Put login and register forms behind a ' +
        'member-gate with audience "guests", and the profile behind audience "members".',
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
  return gaps;
}

export const READINESS_NOTICE =
  'These are STORE gaps, not page defects: each one survives publish without a warning and is ' +
  'found by a real shopper. They are the platform\'s own readiness rules, which no API exposes — ' +
  'the editor computes them client-side, so an agent that never opens the editor cannot see them.';
