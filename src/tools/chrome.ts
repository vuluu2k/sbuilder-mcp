import { request } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { siteFor, type ToolContext } from './context.js';
import { addSubtree } from '../domains/site/builder.js';
import { menuLabel, navSpec, tokensFromPage } from '../domains/site/importmap.js';
import { globalDocumentFrom } from './importpage.js';
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
