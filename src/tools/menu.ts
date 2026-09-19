/**
 * `sb_store action:"menu"` — BIND A MENU NODE TO THE SITE'S MENU.
 *
 * A `menu` element drops onto the canvas holding its own seeded
 * `specials.menuItems` (Home / Categories / Contact / About us, every href
 * empty) — the same placeholder every fresh drop carries, editor or agent.
 * Nothing here turns that into a real menu: the site's menu is a SEPARATE
 * record (`GET/POST /api/sites/{siteId}/menus`), and nothing this server ships
 * ever wrote `specials.menuId` or replaced the seed with the site's own rows.
 * A page built entirely with these tools therefore ships a menu that reads
 * "Home / Categories / Contact / About us" on a site with different pages and
 * no way to change the wording once, because nothing on the node points at
 * anything shared.
 *
 * The editor closes this the moment a menu node lands
 * (`editor/src/features/menus/sync.ts`, `ensureMenuBinding` →
 * `syncBoundMenuNode`), and this mirrors that flow write for write:
 *
 *   1. bind: use the given menu, or the site's first, or CREATE "Main menu"
 *      seeded from the node's own current rows (so binding never changes
 *      what is already on canvas) — `specials.menuId = menu.id`;
 *   2. read the bound menu's items fresh (`GET /menus/{id}`);
 *   3. resolve each item's REFERENCE (a page id, a category/article id) to
 *      the address the storefront actually serves, the way
 *      `linkResolver.ts` does — an unreachable listing degrades to `href:''`
 *      rather than blocking the sync, exactly as the editor's own resolver
 *      swallows its failures;
 *   4. write the resolved snapshot as `specials.menuItems`, carrying forward
 *      any row's `panelId` a caller had already set (`preservePanels`).
 *
 * Steps 1 and 4 land in the SAME `applyAndSave` batch, the way every other
 * multi-write flow in this file does — a node bound but not yet snapshotted
 * is a state nobody should be able to observe.
 */
import { request } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import type { ToolContext } from './context.js';
import type { PageSession } from './page.js';
import { setKeys } from '../domains/site/builder.js';

interface MenuLink {
  type: string;
  pageId?: string;
  entityId?: string;
  url?: string;
  target?: string;
}

interface MenuItem {
  id: string;
  label: string;
  link?: MenuLink;
  items?: MenuItem[];
}

interface MenuItemInput {
  id?: string;
  label: string;
  link?: MenuLink;
  items?: MenuItemInput[];
}

interface Menu {
  id: string;
  name: string;
  items?: MenuItem[];
}

interface Step {
  step: number;
  what: string;
  method: string;
  path: string;
  body?: unknown;
}

const DEFAULT_MENU_NAME = 'Main menu';

/** The four rows every fresh menu element already carries, as create input. */
const DEFAULT_MENU_ITEMS: MenuItemInput[] = ['Home', 'Categories', 'Contact', 'About us'].map((label) => ({
  label,
  link: { type: 'none' },
}));

/**
 * A per-entity WHOLE-LIST route, mirroring `pagelinks/entityUrl.ts`'s
 * `ENTITY_URL_PREFIX` for the three kinds fetched as one unpaginated listing —
 * a category tree and a site's blog are small enough that asking for
 * everything and indexing it costs the same one round trip a by-id batch
 * would. `product` is NOT here: the editor's own resolver batches it BY ID
 * against a different route (`getProductsByIds`) because a shop may hold
 * thousands, so it is resolved separately in `resolveLinks` below.
 */
const ENTITY_ROUTES: Record<string, { segment: string; envelope: string; prefix: string }> = {
  productCategory: { segment: 'product-categories', envelope: 'categories', prefix: 'collections' },
  article: { segment: 'articles', envelope: 'articles', prefix: 'blog' },
  blogCategory: { segment: 'blog-categories', envelope: 'blogCategories', prefix: 'blog-categories' },
};

/** Every entity kind a menu link can carry, whole-list or by-id. */
const ENTITY_KINDS = new Set<string>([...Object.keys(ENTITY_ROUTES), 'product']);

/**
 * The editor's own inverse read (`snapshot.ts`'s `linkFromHref`): a stored
 * href back into the link a create/update body carries. LOSSY BY DESIGN — a
 * page id cannot be recovered from a bare href, so any non-empty href short
 * of the four scheme-prefixed shapes becomes a plain url link. That is fine
 * here: it only ever feeds a freshly seeded node's OWN rows back into a menu
 * create, never a row a picker built.
 */
function linkFromHref(href: string): MenuLink {
  if (href === '') return { type: 'none' };
  if (href.startsWith('mailto:')) return { type: 'email', url: href.slice('mailto:'.length) };
  if (href.startsWith('tel:')) return { type: 'phone', url: href.slice('tel:'.length) };
  if (href.startsWith('#')) return { type: 'anchor', url: href.slice(1) };
  return { type: 'url', url: href };
}

/** A `specials.menuItems` snapshot, read back into `MenuItemInput` rows for a create body. */
function seedFromSnapshot(rows: unknown): MenuItemInput[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      ...(typeof r.id === 'string' && r.id !== '' ? { id: r.id } : {}),
      label: typeof r.label === 'string' ? r.label : '',
      link: {
        ...linkFromHref(typeof r.href === 'string' ? r.href : ''),
        ...(r.target === '_blank' ? { target: '_blank' } : {}),
      },
      ...(Array.isArray(r.items) && r.items.length ? { items: seedFromSnapshot(r.items) } : {}),
    }));
}

/**
 * The forward read (`toMenuSnapshot`'s per-row rule): a link back into the
 * address the storefront serves. `resolve` is the ONLY way a `page` or
 * entity reference becomes a real address — everything else needs no lookup.
 */
function hrefFor(link: MenuLink | undefined, resolve: (type: string, id: string) => string | undefined): string {
  const l = link ?? { type: 'none' };
  const val = l.url ?? '';
  if (l.type === 'url') return val;
  if (l.type === 'email') return val === '' ? '' : `mailto:${val}`;
  if (l.type === 'phone') return val === '' ? '' : `tel:${val}`;
  if (l.type === 'anchor') return val === '' ? '' : `#${val.replace(/^#/, '')}`;
  if (l.type === 'page' && l.pageId) return resolve('page', l.pageId) ?? '';
  if (l.entityId && ENTITY_KINDS.has(l.type)) return resolve(l.type, l.entityId) ?? '';
  return '';
}

/** Every `(kind, id)` reference a menu's rows carry, submenus included. */
function collectRefs(items: MenuItem[], into: Map<string, Set<string>>): void {
  for (const it of items) {
    const link = it.link;
    if (link?.type === 'page' && link.pageId) {
      (into.get('page') ?? into.set('page', new Set()).get('page')!).add(link.pageId);
    } else if (link?.entityId && ENTITY_KINDS.has(link.type)) {
      (into.get(link.type) ?? into.set(link.type, new Set()).get(link.type)!).add(link.entityId);
    }
    if (it.items?.length) collectRefs(it.items, into);
  }
}

/**
 * Warm only the listings these rows actually reference, then hand back a
 * synchronous lookup — the same split `createMenuLinkResolver` makes, for the
 * same reason: `toMenuSnapshot`'s per-row rule has to stay a plain function.
 *
 * TOLERANT PER KIND. A listing that fails leaves that kind's map empty rather
 * than throwing, so one unreachable list degrades every reference of that
 * kind to `href:''` instead of blocking the whole sync — the editor's own
 * resolver swallows its failures the same way.
 */
async function resolveLinks(
  ctx: ToolContext,
  siteId: string,
  items: MenuItem[],
): Promise<(type: string, id: string) => string | undefined> {
  const site = encodeURIComponent(siteId);
  const refs = new Map<string, Set<string>>();
  collectRefs(items, refs);

  const get = async <T>(path: string): Promise<T | null> => {
    try {
      return (await request({
        base: ctx.base,
        method: 'GET',
        path,
        token: siteToken(ctx),
        fetchImpl: ctx.fetchImpl,
      })) as T;
    } catch {
      return null;
    }
  };

  const maps: Record<string, Map<string, string>> = {};

  if (refs.has('page')) {
    const got = await get<{ pages?: Array<{ id: string; slug?: string; path?: string }> }>(
      `/api/sites/${site}/pages`,
    );
    const map = new Map<string, string>();
    for (const p of got?.pages ?? []) {
      if (p.id) map.set(p.id, p.path || `/${p.slug ?? ''}`);
    }
    maps.page = map;
  }

  for (const [kind, route] of Object.entries(ENTITY_ROUTES)) {
    if (!refs.has(kind)) continue;
    const got = await get<Record<string, Array<{ id: string; slug?: string }>>>(
      `/api/sites/${site}/${route.segment}`,
    );
    const rows = got?.[route.envelope] ?? [];
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.id && row.slug) map.set(row.id, `/${route.prefix}/${row.slug}`);
    }
    maps[kind] = map;
  }

  // PRODUCTS ARE THE ONE UNBOUNDED SET, so they are batched BY ID rather than
  // read as a whole list — a menu names a handful and a shop may hold
  // thousands, the same split `createMenuLinkResolver` makes. The platform
  // accepts `?ids=` repeated or comma-joined (`parseIDs`,
  // `products/rest/rest.go`); comma-joined is one query param.
  if (refs.has('product')) {
    const ids = [...(refs.get('product') ?? [])];
    const got = await get<{ products?: Array<{ id: string; slug?: string }> }>(
      `/api/sites/${site}/products?ids=${ids.map((id) => encodeURIComponent(id)).join(',')}`,
    );
    const map = new Map<string, string>();
    for (const p of got?.products ?? []) {
      if (p.id && p.slug) map.set(p.id, `/products/${p.slug}`);
    }
    maps.product = map;
  }

  return (type, id) => maps[type]?.get(id);
}

/** The snapshot rows both renderers read, built recursively off the resolved menu. */
function buildSnapshot(
  items: MenuItem[],
  resolve: (type: string, id: string) => string | undefined,
): Array<Record<string, unknown>> {
  return items.map((it) => {
    const kids = it.items ?? [];
    return {
      id: it.id,
      label: it.label,
      href: hrefFor(it.link, resolve),
      ...(it.link?.target === '_blank' ? { target: '_blank' } : {}),
      ...(kids.length ? { items: buildSnapshot(kids, resolve) } : {}),
    };
  });
}

/**
 * Carry each row's LOCAL mega-panel reference (`panelId`) across a snapshot
 * rebuild, matched by id at every depth — the site-level menu knows nothing
 * about panels, so a plain re-sync from it would silently strip them.
 */
function preservePanels(
  current: unknown,
  next: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const byId = new Map<string, string>();
  const collect = (rows: unknown): void => {
    if (!Array.isArray(rows)) return;
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      const row = r as Record<string, unknown>;
      if (typeof row.id === 'string' && typeof row.panelId === 'string' && row.panelId !== '') {
        byId.set(row.id, row.panelId);
      }
      collect(row.items);
    }
  };
  collect(current);
  if (byId.size === 0) return next;
  const apply = (rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
    rows.map((r) => {
      const pid = typeof r.id === 'string' ? byId.get(r.id) : undefined;
      return {
        ...r,
        ...(pid ? { panelId: pid } : {}),
        ...(Array.isArray(r.items) ? { items: apply(r.items as Array<Record<string, unknown>>) } : {}),
      };
    });
  return apply(next);
}

/** A row shape both `MenuItem` and `MenuItemInput` satisfy — all `classifyLinks` needs. */
interface LinkedRow {
  label: string;
  link?: MenuLink;
  items?: LinkedRow[];
}

/**
 * Which rows carry a REFERENCE that came back with no address, versus which
 * were never linked to anything in the first place.
 *
 * `type:'none'` (every row of a freshly seeded menu element, before an author
 * has pointed any of them anywhere) is UNLINKED — a placeholder by design, not
 * a failure. Only a row that named a page, an entity or a plain address and
 * still resolved to `''` is UNRESOLVED: a dangling reference the caller should
 * go fix, exactly the shape `unresolved.length` is reported for.
 */
function classifyLinks(
  items: LinkedRow[],
  resolve: (type: string, id: string) => string | undefined,
): { unresolved: string[]; unlinked: number } {
  const unresolved: string[] = [];
  let unlinked = 0;
  const walk = (list: LinkedRow[]): void => {
    for (const it of list) {
      const type = it.link?.type ?? 'none';
      if (type === 'none') {
        unlinked += 1;
      } else if (hrefFor(it.link, resolve) === '') {
        unresolved.push(it.label);
      }
      if (it.items?.length) walk(it.items);
    }
  };
  walk(items);
  return { unresolved, unlinked };
}

export async function bindMenu(
  ctx: ToolContext,
  session: PageSession,
  siteId: string,
  nodeId: string,
  opts: { menuId?: string; dryRun: boolean },
): Promise<unknown> {
  const doc = session.current();
  const node = doc.node(nodeId);
  const site = encodeURIComponent(siteId);

  const get = async <T>(path: string): Promise<T> =>
    (await request({ base: ctx.base, method: 'GET', path, token: siteToken(ctx), fetchImpl: ctx.fetchImpl })) as T;
  const post = async <T>(path: string, body: unknown): Promise<T> =>
    (await request({
      base: ctx.base,
      method: 'POST',
      path,
      token: siteToken(ctx),
      body,
      fetchImpl: ctx.fetchImpl,
    })) as T;

  const steps: Step[] = [];
  let n = 1;

  const listed = await get<{ menus?: Menu[] }>(`/api/sites/${site}/menus`);
  const menus = listed.menus ?? [];

  let menu: Menu | undefined;
  let created = false;

  if (opts.menuId) {
    menu = menus.find((m) => m.id === opts.menuId);
    if (!menu) {
      throw new Error(
        `sbuilder: no menu "${opts.menuId}" on this site. This site has: ` +
          (menus.length ? menus.map((m) => `${m.id} (${m.name})`).join(', ') : 'none') +
          '.',
      );
    }
    steps.push({ step: n++, what: `use the menu "${menu.name}"`, method: 'GET', path: `/api/sites/${site}/menus` });
  } else if (menus.length > 0) {
    menu = menus[0];
    steps.push({
      step: n++,
      what: `use the site's first menu, "${menu.name}"`,
      method: 'GET',
      path: `/api/sites/${site}/menus`,
    });
  } else {
    const currentItems = node.specials.menuItems;
    const seedRows =
      Array.isArray(currentItems) && currentItems.length ? seedFromSnapshot(currentItems) : DEFAULT_MENU_ITEMS;
    const createBody = { name: DEFAULT_MENU_NAME, items: seedRows };
    steps.push({
      step: n++,
      what: `create "${DEFAULT_MENU_NAME}" — this site has no menu yet`,
      method: 'POST',
      path: `/api/sites/${site}/menus`,
      body: createBody,
    });
    if (!opts.dryRun) {
      const madeMenu = await post<{ menu?: Menu }>(`/api/sites/${site}/menus`, createBody);
      if (!madeMenu.menu?.id) {
        throw new Error('sbuilder: the platform accepted the menu create and returned no menu');
      }
      menu = madeMenu.menu;
      created = true;
    }
  }

  if (!menu) {
    // DRY RUN, would-create branch: there is no real id to read back, so what
    // would be written is computed PURELY from the seed rows — none of them
    // can be a page or entity link (`linkFromHref` never produces one), so no
    // further lookup is needed or possible. The remaining steps are still
    // named, with the id filled in once the create actually runs.
    const currentItems = node.specials.menuItems;
    const seedRows =
      Array.isArray(currentItems) && currentItems.length ? seedFromSnapshot(currentItems) : DEFAULT_MENU_ITEMS;
    const preview = seedRows.map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      label: r.label,
      href: hrefFor(r.link, () => undefined),
      ...(r.link?.target === '_blank' ? { target: '_blank' } : {}),
    }));
    const { unresolved, unlinked } = classifyLinks(seedRows, () => undefined);
    const { siteId: openSite, pageId } = session.location();
    steps.push({
      step: n++,
      what: 'bind the node to the new menu and read its items back',
      method: 'GET',
      path: `/api/sites/${site}/menus/{id}`,
    });
    steps.push({
      step: n++,
      what: `save the node — specials.menuId (the new menu's id), specials.menuItems (${preview.length} item(s))`,
      method: 'PUT',
      path: `/api/sites/${encodeURIComponent(openSite)}/pages/${encodeURIComponent(pageId)}/source`,
    });
    return {
      dry_run: true,
      plan: steps,
      menu: { would_create: DEFAULT_MENU_NAME },
      items: preview,
      ...(unresolved.length ? { unresolved } : {}),
      ...(unlinked ? { unlinked } : {}),
      note: 'Nothing was sent. Re-call with dry_run:false to create the menu, bind the node and write its snapshot.',
    };
  }

  const bindPatches = setKeys(doc, nodeId, { menuId: menu.id }, { namespace: 'specials' });

  const detail = await get<{ menu?: Menu }>(`/api/sites/${site}/menus/${encodeURIComponent(menu.id)}`);
  const fullMenu = detail.menu ?? menu;
  steps.push({
    step: n++,
    what: `read "${fullMenu.name}"'s items`,
    method: 'GET',
    path: `/api/sites/${site}/menus/${menu.id}`,
  });

  const items = fullMenu.items ?? [];
  const resolve = await resolveLinks(ctx, siteId, items);
  steps.push({
    step: n++,
    what: 'resolve each item\'s reference to the address the storefront serves',
    method: 'GET',
    path: '(page / category / article listings, only the kinds these rows reference)',
  });

  const built = buildSnapshot(items, resolve);
  const snapshot = preservePanels(node.specials.menuItems, built);
  const { unresolved, unlinked } = classifyLinks(items, resolve);

  const itemsPatches = setKeys(doc, nodeId, { menuItems: snapshot }, { namespace: 'specials' });

  const { siteId: openSite, pageId } = session.location();
  steps.push({
    step: n++,
    what: `save the node — specials.menuId="${menu.id}", specials.menuItems (${snapshot.length} item(s))`,
    method: 'PUT',
    path: `/api/sites/${encodeURIComponent(openSite)}/pages/${encodeURIComponent(pageId)}/source`,
  });

  if (opts.dryRun) {
    return {
      dry_run: true,
      plan: steps,
      menu: { id: menu.id, name: fullMenu.name },
      items: snapshot,
      ...(unresolved.length ? { unresolved } : {}),
      ...(unlinked ? { unlinked } : {}),
      note: 'Nothing was sent. Re-call with dry_run:false to bind the node and write its menu snapshot.',
    };
  }

  await session.applyAndSave([...bindPatches, ...itemsPatches]);

  return {
    node: nodeId,
    menu_id: menu.id,
    created,
    items: snapshot.length,
    ...(unresolved.length ? { unresolved } : {}),
    ...(unlinked ? { unlinked } : {}),
  };
}
