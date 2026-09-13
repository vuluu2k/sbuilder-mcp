/**
 * ELEMENTS THAT RENDER CONVINCINGLY WHILE DOING NOTHING.
 *
 * The ordinary silent failure in this platform is a value stored where nothing
 * reads it. This is the other shape: the element renders, looks finished, and is
 * wired to nothing — so neither `sb_review` (which reads the tree, and the tree
 * is correct) nor `sb_look` (which photographs the page, and the page looks
 * right) can see it. The only moment the fact is cheap to deliver is the moment
 * the element is ADDED, which is what this table is for.
 *
 * Each entry names what the element still NEEDS, because in every case the first
 * write — dropping it on the page — succeeds completely. For most that is a
 * second WRITE: a config key to point at a host, an id to reference, a setting
 * to turn on. For a few it is a CONDITION the agent cannot write at all —
 * `rating-stars` renders zero pixels until the store has published reviews, and
 * says so rather than offering a fix that does not exist. Both shapes belong;
 * the header used to promise only the first, which stopped being true the day
 * the table was audited from three entries to twenty.
 *
 * NOT every element that can render empty belongs here. A list with no products
 * yet is a CORRECT list waiting for data — it shows its own honest empty state,
 * and the catalogue check already reports it. What belongs is narrower: a
 * competent author who did the first, obvious thing would be SURPRISED, because
 * nothing anywhere — not the tree, not the screenshot, not an error — says so.
 *
 * This table is hand-kept, and it will go stale on the next platform release —
 * `quickview` was the proof once already: it arrived with the element, and this
 * table did not know. It cannot be generated today. Fourteen of the eighteen
 * element types that appear in some parent's `childAllows` genuinely need one
 * (`tab-content`, `list-item`, …) and four are just general elements a permissive
 * parent happens to accept (`heading` inside `search-input`, `image` inside
 * `image-marquee`) — nothing on the meta separates the two. `locked` is true for
 * only some of the entries below and false on others that belong just as much
 * (`bundle-items`, `chat-widget`); `hideInLayer` is false on all of them; and
 * `category` puts a real trap (`accordion-content`) in the same bucket as
 * ordinary content (`heading`) that is not one. The durable fix is upstream: a
 * flag on the element meta saying it renders only through a host, or only once
 * a named condition (an app, a locale count, a signed grant) is met — until the
 * platform declares that, this table is the only place the fact lives.
 */
export interface InertHint {
  /** Said once per process per element type. */
  note: string;
}

export const INERT_ON_ADD: Record<string, InertHint> = {
  // `localeSwitchPayload` returns "" below two languages, and the renderer's
  // fallback is a FABRICATED chip — `sample = {Code: "VI", Name: "Tiếng Việt",
  // Currency: "VND", Flag: "🌐"}` — chosen deliberately "so the element is never
  // an empty box". So a single-language store gets a language switcher that
  // looks live, names a language, and switches nothing. The globe is the tell,
  // and it is not one an agent photographing the page would read as a warning.
  'locale-switcher': {
    note:
      'A locale-switcher paints a FABRICATED chip until the site actually has two or more ' +
      'locales: below that the payload is empty and the renderer falls back to a sample ' +
      '("🌐 Tiếng Việt / VND") so the element is never an empty box. It looks live and ' +
      'switches nothing, and neither sb_review nor sb_look can tell the difference. Configure ' +
      'the site locales first (site settings: locales, defaultLocale, localeUrlMode), or leave ' +
      'the element off a single-language store.',
  },

  // The trail IS derived and the root label IS authorable — `Steps(n, page.Trail)`
  // plus `specials.homeLabel`. What is not automatic is the LANGUAGE of that one
  // word: the resolver supplies every entity's own label and leaves the root
  // empty precisely so the node can fill it, defaulting to the English "Home".
  // Same class as the seeded empty-state copy `default_seed_copy` reports, in a
  // place that check cannot see because it is not seeded content.
  breadcrumb: {
    note:
      "A breadcrumb derives its trail from the page, but the ROOT crumb's word comes from the " +
      'node: specials.homeLabel, defaulting to the English "Home". The resolver leaves that step ' +
      'empty on purpose so it can be authored, which is the only way it is translatable. On a ' +
      'store that is not in English, set it (e.g. "Trang chủ") or the trail reads half-translated ' +
      'on every product page.',
  },

  // THE SHARPEST OF THE THREE, because the placeholder is not a placeholder: it
  // is a REAL scene on Spline's own servers, and it loads, renders and responds
  // to the mouse. The other two entries here describe an element that looks
  // finished; this one looks finished AND is somebody else's work, published on
  // the merchant's domain. `sb_review` reads a correct tree, `sb_look`
  // photographs a convincing 3D hero, and nothing anywhere says whose it is.
  'spline-scene': {
    note:
      "A spline-scene is born pointing at SPLINE'S OWN DEMO SCENE (specials.sceneUrl defaults to " +
      'a real prod.spline.design link), so an unset one publishes a 3D hero that loads, moves, ' +
      "and belongs to somebody else — it looks finished, so no check can flag it. Set sceneUrl " +
      'to the merchant\'s own export (Spline: Export → Viewer → the …/scene.splinecode link), and ' +
      'set specials.posterUrl too or the box is blank until the engine chunk arrives.',
  },

  // Belongs to the SITE, not a page — `quickview` is what `bundle-items` arrived
  // as before this audit existed, i.e. the proof this table goes stale on every
  // platform release. Its own AVOID says it plainly: hidden until a shopper
  // opens it, and it only opens through a list that names it.
  quickview: {
    note:
      'A quickview panel belongs to the SITE, not a page, and stays hidden until a shopper opens ' +
      "it from a product card — added and left alone, it renders nothing on its own. Point a " +
      "list-dataset's quickviewId control at this panel's node id; unreferenced, it can sit in " +
      'the outline looking complete while no page ever opens it.',
  },

  // `product.bundleItems` only a bundle-kind product carries, so the same node
  // is either a real row of components or dead weight — nothing on the page
  // tree says which.
  'bundle-items': {
    note:
      'A bundle-items row binds product.bundleItems, which only a bundle-kind product carries — ' +
      'on an ordinary product it renders nothing on the published page, with no error anywhere. ' +
      'Pin the block to an actual bundle product (or place it on one) before judging the layout; ' +
      'a plain product leaves it empty forever.',
  },

  // By design: a half-configured assistant must never answer a shopper, so the
  // widget is invisible rather than broken-looking. That design choice is
  // exactly what makes it silent to sb_review and sb_look — both see a page
  // with one less floating element and nothing wrong with it.
  'chat-widget': {
    note:
      'A chat-widget renders nothing at all until the Chat app is installed and an API key is ' +
      "set in its Manage screen — deliberately, so a half-configured assistant never answers a " +
      'shopper. Install the app and add the key before judging it; added to a site with neither, ' +
      'it is invisible on every page it sits on.',
  },

  // Its own AVOID uses the word this table is named after: "the switcher would
  // be inert". A single-currency store is the common case, not an edge one.
  'currency-switcher': {
    note:
      'A currency-switcher is inert on a single-currency store — its own AVOID note says so ' +
      'outright. Publish at least one additional storefront currency (and its rate) before it ' +
      'does anything a shopper can act on; below that it is a control with nothing to switch.',
  },

  // Its own AVOID phrase is almost the table's own name: "the control would
  // render but change nothing on screen". A toggle that visibly toggles and
  // does nothing is the purest case of the failure this file exists for.
  'theme-switcher': {
    note:
      'A theme-switcher renders as a normal, working-looking toggle and changes nothing on ' +
      'screen until a dark colour scheme is assigned to the site theme — its own AVOID says so. ' +
      'Assign one first, or leave the switcher off a site that has none; otherwise every click ' +
      'looks handled and does nothing, on every page it sits on.',
  },

  // Filled at LOAD, by the published page's own island — never by anything
  // authored here. Inside a form-step-nav that is a brief, real transition;
  // anywhere else it is permanent, and a screenshot cannot tell the two apart.
  'form-step-count': {
    note:
      'A form-step-count is a "2/3" counter that renders empty on both renderers — the ' +
      "published page's own island fills the numbers in at load. Inside a form-step-nav that is " +
      'momentary; anywhere else nothing ever fills it, so it renders as an empty box forever with ' +
      'no error. Place it only inside a form-step-nav.',
  },

  // A real, clickable-looking button whose click handler is the step island's,
  // fired only inside its own bar. Outside one, the click is simply dropped —
  // no navigation, no error, nothing sb_look could ever photograph as wrong.
  'form-step-button': {
    note:
      "A form-step-button carries the step bar's Back/Next action, which only fires inside a " +
      'form-step-nav — elsewhere it renders as an ordinary, clickable-looking button that does ' +
      'nothing when pressed, with no error at any step. Place it only inside a form-step-nav; for ' +
      'a plain click action use a button instead.',
  },

  // Reads one order through a signed grant the payment-return endpoint stamps
  // onto the completion URL. Preview never carries that grant, so a correct
  // placement and a wrong one render byte-identically — nothing.
  'order-receipt': {
    note:
      'An order-receipt reads one order through a signed grant the payment-return endpoint ' +
      'attaches to the checkout-completion URL. On any other page — or previewed directly, ' +
      'which never carries that grant — it hides itself and renders nothing, indistinguishable ' +
      "from a correct one being previewed. Place it only on the site's completion page and judge " +
      'it against a real completed order, never the preview.',
  },

  // Same shape as order-receipt, reading a `status` the platform writes into
  // the return URL after verifying the gateway signature — absent on every
  // page reached without paying, and on every preview.
  'payment-status': {
    note:
      'A payment-status block reads its message from a `status` the platform writes into the ' +
      'return URL after a real payment attempt — reached without paying, or in preview, there is ' +
      'no status, so it hides itself and occupies no space. Place it only on the checkout-' +
      'completion page; a correct placement and a wrong one look identical until a real payment ' +
      'reaches it.',
  },

  // Both hide themselves "by design" the moment the Loyalty app is off, which
  // is most stores most of the time — nobody ships a points program on day one.
  'points-card': {
    note:
      'A points-card renders nothing at all on a store without the Loyalty app installed and its ' +
      'points program enabled — by design, so it never shows a balance nobody can earn. Install ' +
      'the app and turn the program on before judging it; until then it is invisible on every ' +
      'page it sits on.',
  },
  'points-prompt': {
    note:
      "A points-prompt is a one-line estimate of what the cart would earn, and it renders " +
      "nothing at all until the Loyalty app is installed and its points program is enabled. Turn " +
      "the program on first; until then the line is invisible wherever it is placed, with " +
      'nothing on the page or in the tree to say why.',
  },

  // Both are satellites a list mints for ITSELF at creation, referenced by the
  // owner's own config.emptyStateId / loadingStateId. A fresh one added by hand
  // attaches to nothing — it is a second, disconnected copy, not the one shown.
  'list-empty': {
    note:
      "A list-empty is a satellite a list mints for itself at creation, referenced by the " +
      "owner's own config.emptyStateId — a fresh one sb_add-ed by hand attaches to nothing: per " +
      'its own AVOID, "it only renders through the surface that owns it." Edit the satellite the ' +
      'owner already created (sb_outline shows it under the owner) rather than adding a second, ' +
      'disconnected one.',
  },
  'list-loading': {
    note:
      "A list-loading is a satellite a list-dataset mints for itself at creation, referenced by " +
      "config.loadingStateId — a fresh one sb_add-ed by hand attaches to nothing: per its own " +
      'AVOID, "it only renders through the list that owns it." Edit the satellite the list ' +
      'already created (sb_outline shows it under the list) rather than adding a second, ' +
      'disconnected one.',
  },

  // The one entry here with NO config fix, and its own tip says so: typing a
  // fallback number "publishes a score nobody gave". Zero pixels, not an empty
  // state, so a real placement and a forgotten one look the same either way.
  'rating-stars': {
    note:
      'A rating-stars element renders NOTHING on a store with no published reviews yet — zero ' +
      'pixels, not an empty state — so a correct placement and a forgotten one look identical ' +
      'until real reviews exist. There is no config fix for this: leave the authored fallback ' +
      'empty (a typed number publishes a score nobody gave) and judge it against a product that ' +
      'already has reviews, never the empty preview.',
  },

  // Its own AVOID uses render-language, not merely "valid" — "it only renders
  // AS an accordion child" — and nothing refuses placing it under a permissive
  // parent instead, since only ACCORDION restricts its own children.
  'accordion-content': {
    note:
      "An accordion-content row only renders as an accordion's own child — placed under any " +
      'other container it is accepted (nothing refuses it) and, per its own AVOID, does not ' +
      'render there. Add it only as a child of an accordion; for a standalone section use ' +
      'flex-section instead.',
  },

  // hamburger-menu is a container with NO childAllows restriction, so it
  // accepts a menu-drawer anywhere in the page just as readily as inside
  // itself — only the second one actually opens when the icon is clicked.
  'menu-drawer': {
    note:
      'A menu-drawer is the off-canvas panel a hamburger-menu opens, and it must be added AS ' +
      "THAT MENU'S OWN CHILD — hamburger-menu accepts any child, so nothing refuses a menu-" +
      'drawer placed elsewhere on the page, and per its own AVOID it then "only renders as that ' +
      "element's panel,\" i.e. never. Add it under the hamburger-menu it should belong to, not " +
      'beside it.',
  },

  // `menu` itself cannot hold children at all (isContainer: false), so a
  // menu-panel is wired from the MENU ENTRY's own configuration, never from
  // the page tree — yet any ordinary container on a page will accept one.
  'menu-panel': {
    note:
      'A menu-panel is a mega-menu surface behind ONE entry of a site menu, wired from that ' +
      "entry's own configuration — not from the page tree, since a menu node cannot hold " +
      'children at all. Placed loose on a page it is accepted by any ordinary container and, per ' +
      'its own AVOID, "only renders inside its owning menu entry" — never on its own. Reference ' +
      'it from the menu entry it belongs to (Manage menu), not by adding it to a page.',
  },
};

/** The hint for a type, or null. */
export function inertHint(type: string): string | null {
  return INERT_ON_ADD[type]?.note ?? null;
}

/** Every distinct hint for the types in a subtree spec, deduped, in add order. */
export function inertHintsFor(types: readonly string[]): Array<{ type: string; note: string }> {
  const seen = new Set<string>();
  const out: Array<{ type: string; note: string }> = [];
  for (const t of types) {
    if (seen.has(t)) continue;
    const note = inertHint(t);
    if (!note) continue;
    seen.add(t);
    out.push({ type: t, note });
  }
  return out;
}
