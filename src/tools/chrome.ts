import { request } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { siteFor, type ToolContext } from './context.js';
import { addSubtree, removeNode, type NodeSpec } from '../domains/site/builder.js';
import { menuLabel } from '../domains/site/importmap.js';
import { PageDoc } from '../domains/site/document.js';
import { childrenOf, subtreeIds, SPEC_GLOBAL_ID, SPEC_GLOBAL_REF, type DocLike } from '../core/tree.js';
import { middleEnd } from '../domains/site/traps.js';
import { setEvent } from './live.js';
import { DEFAULT_MENU_NAME, menuSnapshot, type Menu, type MenuItemInput } from './menu.js';
import { redact } from '../transport/http.js';
import type { PageSession } from './page.js';
import { ensureCartDrawer } from './overlay.js';

/**
 * THE HEADER A SITE SHARES, for a site that was BUILT rather than imported.
 *
 * `sb_review` reports `siteChrome` on any site with two pages and no global
 * section — each page carries its own header, changing the menu is that many
 * edits, the copies drift, and a visitor meets a slightly different site on
 * every click. It is the most basic thing a website has that a generated one
 * does not.
 *
 * The flow that fixes it already existed and was reachable by nobody outside
 * ONE tool: `sb_import_site` builds exactly this from the pages it just made.
 * A site built any other way — patterns, `sb_add`, a store seeded from
 * `sb_store` — had to reproduce it by hand: create the master, know that its
 * `document` is page-shaped but rooted at the SECTION, then give every page a
 * ROOT child carrying `globalRef` + `globalKind`, FIRST, because a header after
 * middle content is a band-order refusal on the next save.
 *
 * So it moved here and both callers share it. Nothing about the shape is new;
 * what is new is that it can be asked for.
 */
export interface ChromeOutcome {
  created?: string;
  carried: string[];
  failed: Array<{ page: string; why: string }>;
  skipped?: string;
}

/** Does this site already share a section of this kind? */
export async function hasGlobal(ctx: ToolContext, siteId: string, kind: string): Promise<boolean> {
  const got = (await request({
    base: ctx.base,
    method: 'GET',
    path: `/api/sites/${encodeURIComponent(siteId)}/global-sections`,
    token: siteToken(ctx),
    fetchImpl: ctx.fetchImpl,
  })) as { globalSections?: Array<{ kind?: string }> };
  return (got.globalSections ?? []).some((g) => g.kind === kind);
}

/**
 * Create ONE global section from a link list and give every named page a
 * reference to it.
 *
 * NOT ATOMIC, and it must not pretend to be: one page that will not take the
 * header does not undo the header. The master exists, the others carry it, and
 * the refusal is reported per page — the same shape `sb_import_site` uses for
 * its own per-page report.
 */
export async function shareChrome(
  ctx: ToolContext,
  session: PageSession,
  siteId: string,
  kind: 'header' | 'footer',
  document: ReturnType<typeof chromeDocument>,
  pages: Array<{ id: string; slug: string }>,
): Promise<ChromeOutcome> {
  const out: ChromeOutcome = { carried: [], failed: [] };
  const made = (await request({
    base: ctx.base,
    method: 'POST',
    path: `/api/sites/${encodeURIComponent(siteId)}/global-sections`,
    token: siteToken(ctx),
    body: { name: kind === 'header' ? 'Header' : 'Footer', kind, document },
    fetchImpl: ctx.fetchImpl,
  })) as { globalSection?: { id?: unknown } };
  const gid = made.globalSection?.id;
  if (typeof gid !== 'string' || !gid) {
    out.skipped = 'the platform created no global section';
    return out;
  }
  out.created = gid;
  for (const p of pages) {
    try {
      await session.open(siteId, p.id);
      const doc = session.current();
      // A HEADER GOES IN FIRST AND A FOOTER LAST. ROOT's children must read
      // [header*][middle*][footer*] and the platform refuses EVERY save
      // otherwise — compose turns the reference into a real band, so its index
      // is the band it becomes.
      const at = kind === 'header' ? 0 : doc.doc.nodes[doc.doc.root_node_id]?.data?.nodes?.length ?? 0;
      const { patches } = addSubtree(
        doc,
        doc.doc.root_node_id,
        { type: 'flex-section', specials: { globalRef: gid, globalKind: kind } },
        at,
      );
      await session.applyAndSave(patches);
      // The edge is recorded on the NEXT save, not this one — see
      // `PageSession.recompose`. Without this every page here would carry the
      // header correctly and none of them would be counted as doing so.
      await session.recompose();
      out.carried.push(p.slug);
    } catch (e) {
      out.failed.push({ page: p.slug, why: (e as Error).message.replace(/^sbuilder:\s*/, '').slice(0, 160) });
    }
  }
  return out;
}

/** Every page this site has, as the menu would name them. */
export interface NavPage {
  id: string;
  slug: string;
  name: string;
  isHome: boolean;
  type: string;
}

export async function sitePages(ctx: ToolContext, siteId: string): Promise<NavPage[]> {
  const got = (await request({
    base: ctx.base,
    method: 'GET',
    path: `/api/sites/${encodeURIComponent(siteId)}/pages`,
    token: siteToken(ctx),
    fetchImpl: ctx.fetchImpl,
  })) as { pages?: Array<Record<string, unknown>> };
  return (got.pages ?? []).map((p) => ({
    id: String(p.id ?? ''),
    slug: String(p.slug ?? ''),
    name: String(p.name ?? p.title ?? p.slug ?? ''),
    isHome: p.isHomepage === true || p.slug === '',
    type: String(p.type ?? 'page'),
  }));
}

/**
 * THE PAGES A MENU LINKS TO are the ones a visitor navigates to by name. The
 * store's templates (product, category, checkout, search, account …) are
 * reached THROUGH a product or a fixed path, never from a menu row, and
 * login/register belong behind `/account` (see sbuilder-store-flows).
 */
const CONTENT_TYPES = new Set(['page', 'about', 'contact', 'faq', 'policy']);

export interface NavCategory {
  id: string;
  name: string;
  parentId: string;
  products: Array<{ id: string; name: string }>;
}

/**
 * The catalogue as a menu would show it: only categories that hold products,
 * because a menu row into an empty collection is a dead end a shopper meets.
 * TOLERANT: a listing that fails yields no categories rather than no chrome.
 */
// ponytail: one request per category, capped; a counts endpoint if a store has hundreds.
const MAX_CATEGORIES = 24;
export async function stockedCategories(ctx: ToolContext, siteId: string): Promise<NavCategory[]> {
  const site = encodeURIComponent(siteId);
  const get = async <T>(path: string): Promise<T | null> => {
    try {
      return (await request({ base: ctx.base, method: 'GET', path, token: siteToken(ctx), fetchImpl: ctx.fetchImpl })) as T;
    } catch {
      return null;
    }
  };
  const cats =
    (await get<{ categories?: Array<Record<string, unknown>> }>(`/api/sites/${site}/product-categories`))?.categories ?? [];
  const out: NavCategory[] = [];
  for (const c of cats.slice(0, MAX_CATEGORIES)) {
    const id = String(c.id ?? '');
    if (!id) continue;
    const got = await get<{ products?: Array<Record<string, unknown>> }>(
      `/api/sites/${site}/product-categories/${encodeURIComponent(id)}/products`,
    );
    const products = (got?.products ?? []).map((p) => ({ id: String(p.id ?? ''), name: String(p.name ?? '') }));
    if (products.length) out.push({ id, name: String(c.name ?? ''), parentId: String(c.parentId ?? ''), products });
  }
  return out;
}

const pageRow = (p: NavPage): MenuItemInput => ({ label: menuLabel(p.name), link: { type: 'page', pageId: p.id } });
const categoryRow = (c: NavCategory, items?: MenuItemInput[]): MenuItemInput => ({
  label: menuLabel(c.name),
  link: { type: 'productCategory', entityId: c.id },
  ...(items?.length ? { items } : {}),
});

/**
 * The header menu: home, the stocked top-level categories, then the content
 * pages — every row a REFERENCE (page id, category id, product id), never an
 * address, so a re-slugged page keeps its row working. A category gets child
 * rows: its own stocked sub-categories, or, having none, its first products.
 */
export function headerMenuItems(pages: NavPage[], cats: NavCategory[]): MenuItemInput[] {
  const content = pages.filter((p) => CONTENT_TYPES.has(p.type) || p.isHome);
  const home = content.find((p) => p.isHome);
  const roots = cats.filter((c) => !c.parentId || !cats.some((x) => x.id === c.parentId)).slice(0, 6);
  return [
    ...(home ? [pageRow(home)] : []),
    ...roots.map((c) => {
      const subs = cats.filter((x) => x.parentId === c.id);
      return categoryRow(
        c,
        subs.length
          ? subs.map((x) => categoryRow(x))
          : c.products.slice(0, 6).map((p) => ({ label: menuLabel(p.name), link: { type: 'product', entityId: p.id } })),
      );
    }),
    ...content.filter((p) => !p.isHome && p.type !== 'policy').map(pageRow),
  ];
}

const FOOTER_TITLES = {
  vi: { shop: 'Cửa hàng', info: 'Thông tin' },
  en: { shop: 'Shop', info: 'Information' },
};

/** The footer's link columns: one site menu each, so each is edited once. */
export function footerMenus(
  pages: NavPage[],
  cats: NavCategory[],
  lang: 'vi' | 'en',
): Array<{ name: string; title: string; items: MenuItemInput[] }> {
  const t = FOOTER_TITLES[lang];
  const roots = cats.filter((c) => !c.parentId || !cats.some((x) => x.id === c.parentId));
  const info = pages.filter((p) => CONTENT_TYPES.has(p.type) && !p.isHome);
  return [
    { name: 'Footer — Shop', title: t.shop, items: roots.map((c) => categoryRow(c)) },
    { name: 'Footer — Info', title: t.info, items: info.map(pageRow) },
  ].filter((m) => m.items.length > 0);
}

export interface MenuPlan {
  name: string;
  would?: 'create' | 'reuse' | 'fill';
  id?: string;
  created?: boolean;
  filled?: boolean;
  items?: MenuItemInput[];
  rows?: Array<Record<string, unknown>>;
}

const rowCount = (items: Array<{ items?: unknown[] }>): number =>
  items.reduce((n, it) => n + 1 + rowCount((it.items ?? []) as Array<{ items?: unknown[] }>), 0);

/**
 * ONE SITE MENU PER NAME. A menu of that name already on the site is reused
 * as it is — the merchant may have edited it since — so a re-run creates no
 * duplicate. The exception is a menu that links NOWHERE: every row
 * `type:'none'` (what `sb_menu` seeds — four placeholders), or no rows at all.
 * Reusing that puts a header on every page whose links go nowhere, so its rows
 * are replaced with the real ones; a menu with even one link is the merchant's
 * and stays untouched. Judged on the STORED link types only, never on whether
 * a lookup resolved them: the resolver reads a failed GET as "no match", so a
 * 5xx would have made a real menu look empty and overwritten it with no undo.
 */
async function ensureMenu(
  ctx: ToolContext,
  siteId: string,
  existing: Menu[],
  name: string,
  items: MenuItemInput[],
  dryRun: boolean,
): Promise<MenuPlan> {
  const found = existing.find((m) => m.name === name);
  if (found) {
    const snap = await menuSnapshot(ctx, siteId, found.id);
    const rows = snap.menu?.items ?? [];
    const placeholder = snap.unlinked === rowCount(rows);
    if (!placeholder) return { name, would: 'reuse', id: found.id, rows: snap.snapshot };
    if (dryRun) return { name, would: 'fill', id: found.id, rows: snap.snapshot, items };
    await request({
      base: ctx.base,
      method: 'PUT',
      path: `/api/sites/${encodeURIComponent(siteId)}/menus/${encodeURIComponent(found.id)}`,
      token: siteToken(ctx),
      body: { name, items },
      fetchImpl: ctx.fetchImpl,
    });
    return { name, id: found.id, filled: true };
  }
  if (dryRun) return { name, would: 'create', items };
  const made = (await request({
    base: ctx.base,
    method: 'POST',
    path: `/api/sites/${encodeURIComponent(siteId)}/menus`,
    token: siteToken(ctx),
    body: { name, items },
    fetchImpl: ctx.fetchImpl,
  })) as { menu?: Menu };
  if (!made.menu?.id) throw new Error(`sbuilder: the platform accepted the "${name}" menu and returned no menu`);
  existing.push(made.menu);
  return { name, id: made.menu.id, created: true };
}

/** A menu node bound to a site menu, carrying the snapshot both renderers read. */
function menuSpec(
  bound: { menuId?: string; menuItems?: unknown },
  config: Record<string, unknown>,
  extra: Partial<NodeSpec> = {},
): NodeSpec {
  return {
    type: 'menu',
    ...extra,
    config: { ...config, ...(extra.config ?? {}) },
    specials: { ...(bound.menuId ? { menuId: bound.menuId } : {}), ...(bound.menuItems ? { menuItems: bound.menuItems } : {}) },
  };
}

const ROW = { flexDirection: 'row', alignItems: 'center' };

/**
 * THE HEADER, as the editor's own "Navigation" card composes it
 * (`editor/src/element/pickerPresets.ts` navigationTree): a desktop `menu`
 * hidden on mobile, and a `hamburger-menu` shown ONLY on mobile holding a
 * `menu-drawer` with a ✕ carrying `close_menu` over a vertical `menu`. Both
 * menus bind the SAME site menu, so it is edited once. `config.hidden` is
 * NON-cascading (`render/style/cascade.go`), so the base value is desktop's
 * alone and each narrower slot says its own.
 *
 * The cart is the ICON itself carrying `open_cart`, badged by a `cart-count`
 * SATELLITE — not a box wrapping two nodes with the click on one of them.
 * The section wears `section-wide` (`--wb-content-max: none`): the default
 * `container-section` caps the band at 1440px, which squeezes a top bar.
 * No colour is written: every node wears its element's theme preset.
 */
export function headerSpec(bound: { menuId?: string; menuItems?: unknown }, brand: string): NodeSpec {
  const heading = (text: string): NodeSpec => ({
    type: 'heading',
    specials: { text, htmlTag: 'h4' },
    config: { textGlobalStyle: 'heading-5' },
    style: { fontSize: 'var(--wb-ts-heading-5-size)', width: 'fit-content' },
  });
  return {
    type: 'flex-section',
    specials: { stylePreset: 'section-wide' },
    children: [
      {
        type: 'flex-block',
        // A header bar never stacks: on a phone only the ☰ is left in it.
        style: { ...ROW, justifyContent: 'space-between', gap: '24px', padding: '12px 24px' },
        responsive: { mobile: { style: ROW } },
        children: [
          ...(brand ? [heading(brand)] : []),
          menuSpec(
            bound,
            { expandType: 'hover', submenuStyle: 'dropdown' },
            { style: { width: 'fit-content' }, responsive: { mobile: { config: { hidden: true } } } },
          ),
          {
            type: 'flex-block',
            style: { ...ROW, width: 'fit-content', gap: '16px' },
            responsive: { mobile: { style: ROW } },
            children: [
              { type: 'icon', name: 'Account', specials: { name: 'UserLine' } },
              { type: 'icon', name: 'Cart', specials: { name: 'ShoppingCartLine' }, children: [{ type: 'cart-count' }] },
              {
                type: 'hamburger-menu',
                config: { hidden: true },
                responsive: { laptop: { config: { hidden: true } }, tablet: { config: { hidden: true } } },
                children: [
                  {
                    type: 'menu-drawer',
                    children: [
                      {
                        type: 'flex-block',
                        style: { ...ROW, justifyContent: 'space-between', gap: '16px', minHeight: '56px' },
                        responsive: { mobile: { style: ROW } },
                        children: [
                          ...(brand ? [heading(brand)] : []),
                          { type: 'icon', name: 'Close menu', specials: { name: 'CloseLine' }, config: { iconSize: 20 } },
                        ],
                      },
                      menuSpec(
                        bound,
                        { expandType: 'click', submenuStyle: 'collapse' },
                        { style: { flexDirection: 'column', alignItems: 'stretch', gap: '8px' } },
                      ),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** The footer: one titled column per menu, each a VERTICAL menu bound to its site menu. */
export function footerSpec(
  columns: Array<{ title: string; bound: { menuId?: string; menuItems?: unknown } }>,
): NodeSpec {
  return {
    type: 'flex-section',
    specials: { stylePreset: 'section-wide' },
    children: [
      {
        type: 'flex-block',
        style: { flexDirection: 'row', flexWrap: 'wrap', gap: '48px', padding: '48px 24px' },
        children: columns.map((c) => ({
          type: 'flex-block',
          style: { flexDirection: 'column', width: 'fit-content', gap: '12px' },
          children: [
            {
              type: 'heading',
              specials: { text: c.title, htmlTag: 'h4' },
              config: { textGlobalStyle: 'heading-6' },
              style: { fontSize: 'var(--wb-ts-heading-6-size)' },
            },
            menuSpec(
              c.bound,
              { expandType: 'click', submenuStyle: 'collapse' },
              { style: { flexDirection: 'column', alignItems: 'flex-start', gap: '8px' } },
            ),
          ],
        })),
      },
    ],
  };
}

/** The clicks the header's named controls carry, written through `setEvent` so each sole navigation gets its `<a href>`. */
const CHROME_EVENTS: Record<string, { action: string; payload?: Record<string, unknown> }> = {
  Account: { action: 'go_to_url', payload: { url: '/account' } },
  Cart: { action: 'open_cart' },
  'Close menu': { action: 'close_menu' },
};

/** A global section's document: page-shaped, rooted at the SECTION. */
export function chromeDocument(spec: NodeSpec): {
  schema_version: number;
  root_node_id: string;
  nodes: Record<string, unknown>;
} {
  const scratch = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const { patches, ids } = addSubtree(scratch, scratch.doc.root_node_id, spec);
  scratch.apply(patches);
  for (const id of ids) {
    const ev = CHROME_EVENTS[String(scratch.doc.nodes[id]?.data.name ?? '')];
    if (ev) scratch.apply(setEvent(scratch, id, 'click', ev.action, ev.payload));
  }
  const rootId = ids[0];
  const nodes: Record<string, unknown> = {};
  for (const id of subtreeIds(scratch.doc, rootId)) nodes[id] = scratch.doc.nodes[id];
  (nodes[rootId] as { data: { parent: unknown } }).data.parent = null;
  return { schema_version: 2, root_node_id: rootId, nodes };
}

/** The spec as a caller reads it: types, nested. */
export function specTree(s: NodeSpec): unknown {
  const label = s.name ? `${s.type} (${s.name})` : s.type;
  return s.children?.length ? { [label]: s.children.map(specTree) } : label;
}

/**
 * `sb_store action:"chrome"`: the site menus, then the shared header or footer
 * built on them, then every page given a reference to it.
 */
export async function buildChrome(
  ctx: ToolContext,
  session: PageSession,
  siteId: string,
  kind: 'header' | 'footer',
  opts: { dryRun: boolean; language: 'vi' | 'en' },
): Promise<unknown> {
  if (await hasGlobal(ctx, siteId, kind)) {
    return { skipped: `this site already shares a ${kind} — a second one is two of them, not a menu` };
  }
  const site = encodeURIComponent(siteId);
  const get = async <T>(path: string): Promise<T> =>
    (await request({ base: ctx.base, method: 'GET', path, token: siteToken(ctx), fetchImpl: ctx.fetchImpl })) as T;
  const pages = await sitePages(ctx, siteId);
  const cats = await stockedCategories(ctx, siteId);
  const wanted =
    kind === 'header'
      ? [{ name: DEFAULT_MENU_NAME, title: '', items: headerMenuItems(pages, cats) }]
      : footerMenus(pages, cats, opts.language);
  // Counted across the whole band: a footer's two columns of one link each still
  // go to two places.
  if (wanted.reduce((n, m) => n + m.items.length, 0) < 2) {
    return { skipped: 'fewer than two pages or stocked categories to link — a menu to one place is a link to itself' };
  }
  const existing = (await get<{ menus?: Menu[] }>(`/api/sites/${site}/menus`)).menus ?? [];
  const plans: MenuPlan[] = [];
  for (const m of wanted) plans.push(await ensureMenu(ctx, siteId, existing, m.name, m.items, opts.dryRun));

  const bound = await Promise.all(
    plans.map(async (p) =>
      p.id && !opts.dryRun ? { menuId: p.id, menuItems: (await menuSnapshot(ctx, siteId, p.id)).snapshot } : {},
    ),
  );
  // The brand line is the site's own name; a site that will not say leaves the header without one.
  const brand =
    kind === 'header'
      ? String((await get<{ site?: { name?: unknown } }>(`/api/sites/${site}`).catch(() => undefined))?.site?.name ?? '')
      : '';
  const spec =
    kind === 'header'
      ? headerSpec(bound[0], brand)
      : footerSpec(wanted.map((m, i) => ({ title: m.title, bound: bound[i] })));
  // Every page wears it, templates included: a product page is still this site.
  const onto = pages;
  // The header's cart icon carries `open_cart`, which opens the site's ONE cart
  // overlay — a site with none gets one, or the icon opens nothing.
  const cartFor = async (dryRun: boolean) =>
    kind === 'header' ? { cart: await ensureCartDrawer(ctx, session, siteId, dryRun) } : {};
  // The drawer's whole seed document is sb_store action:"cart"'s preview;
  // here it is one line beside the header tree.
  const cartPreview = async () => {
    const got = (await cartFor(true)) as { cart?: { dry_run?: boolean; plan?: Array<{ body?: { document?: { nodes?: object } } }> } };
    if (!got.cart?.dry_run) return got;
    const nodes = Object.keys(got.cart.plan?.[0]?.body?.document?.nodes ?? {}).length;
    return { cart: { dry_run: true, would: 'create', kind: 'cart', nodes } };
  };
  if (opts.dryRun) {
    return {
      dry_run: true,
      would_create: kind,
      menus: redact(plans),
      tree: specTree(spec),
      ...(await cartPreview()),
      onto: onto.map((p) => p.slug || '/'),
      note:
        'Nothing was sent. The menus are site records every menu node binds by id, so the ' +
        'header and its mobile drawer are edited once; the header is ONE shared master every ' +
        'page references. Re-call with dry_run:false.',
    };
  }
  const out = await shareChrome(ctx, session, siteId, kind, chromeDocument(spec), onto);
  const cart = await cartFor(false);
  return {
    ...out,
    ...cart,
    menus: plans.map((p) => ({
      name: p.name,
      id: p.id,
      ...(p.created ? { created: true } : p.filled ? { filled: true } : { reused: true }),
    })),
    next:
      'Publish the pages: a global section reaches a visitor through each page it is ' +
      'composed onto, so a saved page keeps the old chrome until it is published again.',
  };
}

export { siteFor };

/**
 * ATTACHING A SHARED SECTION TO A PAGE, which nothing here could do.
 *
 * `shareChrome` above CREATES a master and puts it on every page — the right
 * answer for a site that has none, and the wrong one for the ordinary case: a
 * site whose header already exists and whose newest page does not carry it. On
 * the storefront this was written against, seven of twenty-four pages carried
 * neither the header nor the footer while both masters existed, and the only
 * way to fix one was to hand-write the reference node.
 *
 * Hand-writing it is exactly the write this repo has already paid for twice.
 * A page REFERENCES a master with `specials.globalRef` + `globalKind`; the
 * server COMPOSES the master onto the page on read and stamps the result
 * `specials.globalId`. Authoring the composed stamp instead makes the next save
 * DECOMPOSE that node over the master and empty it for every page carrying it —
 * four pages went blank before `sb_add` and `sb_set` learned to refuse it.
 *
 * So the reference is written here, once, by the code that knows which stamp is
 * which — and the caller never sees a stamp at all.
 */
export interface GlobalSection {
  id: string;
  name: string;
  kind: string;
  rev?: number;
  usageCount?: number;
}

export async function listGlobals(ctx: ToolContext, siteId: string): Promise<GlobalSection[]> {
  const got = (await request({
    base: ctx.base,
    method: 'GET',
    path: `/api/sites/${encodeURIComponent(siteId)}/global-sections`,
    token: siteToken(ctx),
    fetchImpl: ctx.fetchImpl,
  })) as { globalSections?: Array<Record<string, unknown>> };
  return (got.globalSections ?? []).map((g) => ({
    id: String(g.id ?? ''),
    name: String(g.name ?? ''),
    kind: String(g.kind ?? ''),
    ...(typeof g.rev === 'number' ? { rev: g.rev } : {}),
    ...(typeof g.usageCount === 'number' ? { usageCount: g.usageCount } : {}),
  }));
}

/**
 * Which pages reference this master, according to the PLATFORM rather than
 * according to a walk of every page done here.
 *
 * `GET .../global-sections/{id}/pages` is the site's own answer, so an attach
 * can be checked against the same list the editor's own usage count comes from
 * — which is what "consistent" has to mean. Reading 24 page documents to
 * recompute it would be 24 round trips and a second opinion nobody asked for.
 */
export async function pagesReferencing(
  ctx: ToolContext,
  siteId: string,
  globalId: string,
): Promise<Array<{ pageId: string; name: string }>> {
  const got = (await request({
    base: ctx.base,
    method: 'GET',
    path: `/api/sites/${encodeURIComponent(siteId)}/global-sections/${encodeURIComponent(globalId)}/pages`,
    token: siteToken(ctx),
    fetchImpl: ctx.fetchImpl,
  })) as { pages?: Array<Record<string, unknown>> };
  return (got.pages ?? []).map((p) => ({
    pageId: String(p.pageId ?? p.id ?? ''),
    name: String(p.name ?? ''),
  }));
}

/**
 * Every master this OPEN document already carries, by ROOT child.
 *
 * BOTH STAMPS ARE READ, and that is the whole reason this is a function. A
 * page read back from the server carries the COMPOSED stamp (`globalId`); a
 * reference this session wrote a moment ago and has not saved yet carries
 * `globalRef`. A check that knew only one of them would let a caller attach the
 * same master twice — which `validateForSave` then refuses with a message about
 * duplicate stamps, blaming a write that looked perfectly reasonable.
 */
export function attachedGlobals(doc: DocLike): Array<{ nodeId: string; globalId: string }> {
  const out: Array<{ nodeId: string; globalId: string }> = [];
  for (const nodeId of childrenOf(doc, doc.root_node_id)) {
    const s = doc.nodes[nodeId]?.specials ?? {};
    const id = s[SPEC_GLOBAL_ID] ?? s[SPEC_GLOBAL_REF];
    if (typeof id === 'string' && id) out.push({ nodeId, globalId: id });
  }
  return out;
}

/**
 * Where a reference of this kind must sit among ROOT's children.
 *
 * TRAP 3, and it is a refusal rather than a cosmetic preference: ROOT's
 * children must read `[header*][middle*][footer*]` and the platform refuses
 * EVERY save otherwise. Compose turns the reference into a real band, so the
 * index a reference takes is the index the band will have — a header appended
 * at the end is a `band_order` refusal on the next save, reported against a
 * caller who never knowingly touched a band.
 */
export function positionFor(doc: DocLike, kind: string): number {
  if (kind === 'header') return 0;
  if (kind === 'footer') return childrenOf(doc, doc.root_node_id).length;
  return middleEnd(doc);
}

export interface AttachOutcome {
  dry_run?: true;
  attached?: { globalId: string; kind: string; nodeId?: string; at: number };
  detached?: { globalId: string; nodeId: string };
  skipped?: string;
  /** The platform's own list, read AFTER the write, so it is the site's answer. */
  pages_referencing?: number;
  available?: Array<{ id: string; name: string; kind: string }>;
  next?: string;
}

/**
 * Give the OPEN page a reference to a global section that already exists.
 *
 * `globalRef`, never `globalId`. The caller names a master; which stamp goes in
 * the document is not theirs to get wrong.
 */
export async function attachGlobal(
  ctx: ToolContext,
  session: PageSession,
  siteId: string,
  globalId: string | undefined,
  opts: { dryRun: boolean },
): Promise<AttachOutcome> {
  const masters = await listGlobals(ctx, siteId);
  if (!globalId) {
    throw new Error(
      'sbuilder: action:"global_attach" needs global_id — which shared section to put on this ' +
        `page. This site has: ${
          masters.length
            ? masters.map((m) => `${m.id} (${m.kind}, "${m.name}")`).join('; ')
            : 'none, so build one with action:"chrome" first'
        }.`,
    );
  }
  const master = masters.find((m) => m.id === globalId);
  if (!master) {
    throw new Error(
      `sbuilder: this site has no global section "${globalId}". It has: ${
        masters.map((m) => `${m.id} (${m.kind})`).join('; ') || 'none'
      }.`,
    );
  }
  const doc = session.current();
  const already = attachedGlobals(doc.doc).find((g) => g.globalId === globalId);
  if (already) {
    return {
      skipped: `this page already references ${globalId} at node ${already.nodeId}`,
      pages_referencing: (await pagesReferencing(ctx, siteId, globalId)).length,
    };
  }
  const at = positionFor(doc.doc, master.kind);
  if (opts.dryRun) {
    return {
      dry_run: true,
      attached: { globalId, kind: master.kind, at },
      next:
        `Nothing was sent. A ${master.kind} goes in at index ${at} because ROOT's children must ` +
        'read header, middle, footer and the platform refuses every save otherwise. Re-call ' +
        'with dry_run:false.',
    };
  }
  const { patches, ids } = addSubtree(
    doc,
    doc.doc.root_node_id,
    { type: 'flex-section', specials: { globalRef: globalId, globalKind: master.kind } },
    at,
  );
  await session.applyAndSave(patches);
  // RE-READ AND STORE IT BACK, which is TWO things and both are required.
  //
  // The re-read is because what this session now holds is the REFERENCE and
  // what the page actually has is the COMPOSED section — every later call must
  // see the composed tree or it is reasoning about a node the server has
  // already replaced. The same reason `attachOverlay` re-reads.
  //
  // The second SAVE is because the platform records a page's global edges from
  // the COMPOSED stamp alone, so the reference this call just planted is
  // invisible to `page_global_refs` until it has been through one compose /
  // decompose round trip. See `PageSession.recompose` for the measurement.
  await session.recompose();
  return {
    attached: { globalId, kind: master.kind, nodeId: ids[0], at },
    pages_referencing: (await pagesReferencing(ctx, siteId, globalId)).length,
    next:
      'Publish the page: a global section reaches a visitor through each page it is composed ' +
      'onto, so the saved page keeps the old chrome until it is published again.',
  };
}

/**
 * Take a shared section off the OPEN page, leaving the master alone.
 *
 * REMOVING THE COMPOSED NODES DOES NOT TOUCH THE MASTER, and that is worth
 * stating because it looks like it should. The master is its own record
 * (`/global-sections/{id}`); what sits in this page document is a composition
 * the server performed on read and undoes on write. A page with no stamped
 * ROOT child simply produces no reference when `Decompose` runs — which is
 * exactly what "this page does not carry the header" means.
 */
export async function detachGlobal(
  ctx: ToolContext,
  session: PageSession,
  siteId: string,
  globalId: string | undefined,
  opts: { dryRun: boolean },
): Promise<AttachOutcome> {
  const doc = session.current();
  const attached = attachedGlobals(doc.doc);
  if (attached.length === 0) {
    return { skipped: 'this page references no global section' };
  }
  const hit = globalId
    ? attached.find((g) => g.globalId === globalId)
    : attached.length === 1
      ? attached[0]
      : undefined;
  if (!hit) {
    throw new Error(
      globalId
        ? `sbuilder: this page does not reference "${globalId}". It references: ${attached
            .map((g) => g.globalId)
            .join(', ')}.`
        : `sbuilder: action:"global_detach" needs global_id — this page references ${attached
            .map((g) => g.globalId)
            .join(' and ')}, so which one is not obvious.`,
    );
  }
  if (opts.dryRun) {
    return {
      dry_run: true,
      detached: { globalId: hit.globalId, nodeId: hit.nodeId },
      next:
        'Nothing was sent. The master itself is untouched by this — only this page stops ' +
        'carrying it. Re-call with dry_run:false.',
    };
  }
  await session.applyAndSave(removeNode(doc, hit.nodeId));
  // The same round trip as attach, for the mirror-image reason: the edge this
  // page no longer has must stop being counted, and `SetPageRefs` only runs
  // off a decompose.
  await session.recompose();
  return {
    detached: { globalId: hit.globalId, nodeId: hit.nodeId },
    pages_referencing: (await pagesReferencing(ctx, siteId, hit.globalId)).length,
    next: 'Publish the page, or the live copy keeps the section this draft no longer has.',
  };
}
