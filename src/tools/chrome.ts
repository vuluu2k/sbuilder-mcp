import { request } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { siteFor, type ToolContext } from './context.js';
import { addSubtree, removeNode } from '../domains/site/builder.js';
import { menuLabel, navSpec, tokensFromPage } from '../domains/site/importmap.js';
import { globalDocumentFrom } from './importpage.js';
import { childrenOf, SPEC_GLOBAL_ID, SPEC_GLOBAL_REF, type DocLike } from '../core/tree.js';
import { middleEnd } from '../domains/site/traps.js';
import type { PageSession } from './page.js';

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
export interface ChromeLink {
  text: string;
  href: string;
}

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
  links: ChromeLink[],
  pages: Array<{ id: string; slug: string }>,
  tokens: Parameters<typeof navSpec>[1],
): Promise<ChromeOutcome> {
  const out: ChromeOutcome = { carried: [], failed: [] };
  const spec = navSpec(links, tokens);
  if (!spec) {
    out.skipped = 'no links to put in it';
    return out;
  }
  const made = (await request({
    base: ctx.base,
    method: 'POST',
    path: `/api/sites/${encodeURIComponent(siteId)}/global-sections`,
    token: siteToken(ctx),
    body: {
      name: kind === 'header' ? 'Header' : 'Footer',
      kind,
      document: globalDocumentFrom(spec),
    },
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
export async function sitePages(
  ctx: ToolContext,
  siteId: string,
): Promise<Array<{ id: string; slug: string; name: string; isHome: boolean }>> {
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
  }));
}

/** The link list a menu built from these pages would carry, home first. */
export function chromeLinks(
  pages: Array<{ slug: string; name: string; isHome: boolean }>,
): ChromeLink[] {
  return [...pages]
    .sort((a, b) => Number(b.isHome) - Number(a.isHome))
    .map((p) => ({ text: menuLabel(p.name), href: p.isHome ? '/' : `/${p.slug}` }));
}

export { siteFor, tokensFromPage };

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
