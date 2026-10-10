import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { request, redact } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { siteFor, type ToolContext } from './context.js';

/**
 * The SEO keys the platform reads (`editor/src/components/seo/types.ts`, a server
 * contract read by `server/internal/seo`). STRICT: an unknown key would be stored
 * in `settings` and read by nothing, which is the silent shape this repo refuses.
 */
const SEO = z
  .object({
    title: z.string(),
    description: z.string(),
    keywords: z.string(),
    canonical: z.string(),
    ogTitle: z.string(),
    ogDesc: z.string(),
    ogImage: z.string(),
    twitterCard: z.enum(['', 'summary', 'summary_large_image']),
    noIndex: z.boolean(),
    noFollow: z.boolean(),
    metaTags: z.array(
      z
        .object({
          attr: z.enum(['name', 'property', 'http-equiv']),
          key: z.string(),
          content: z.string(),
          disabled: z.boolean(),
        })
        .strict(),
    ),
    jsonld: z.array(z.string()).describe('raw application/ld+json blocks, each must parse'),
  })
  .partial()
  .strict();

/** Page type → the entity kind it renders (`editor/src/features/pagelinks/types.ts`). */
const LINK_TYPE_FOR_PAGE_TYPE: Record<string, string> = {
  product: 'product',
  category: 'productCategory',
  post: 'article',
  blog: 'blogCategory',
  course: 'course',
};

const PUBLISH_NOTICE =
  'Page settings are published verbatim: the storefront shows this change after sb_publish.';

export function registerPageUpdateTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'sb_page_update',
    {
      description:
        "Edit a page's name, slug, home flag, order, SEO (merged key by key) or members_only. " +
        'Reads the page first and merges `settings`, so keys it does not name survive. On a ' +
        'template page (product, category, post, blog, course): default_template makes it the ' +
        'type\'s default, render_for/render_default move entities onto it or back to the default.',
      inputSchema: {
        site_id: z.string().optional(),
        page_id: z.string(),
        name: z.string().optional(),
        slug: z.string().optional(),
        is_homepage: z.boolean().optional(),
        sort_order: z.number().int().optional(),
        seo: SEO.optional(),
        members_only: z.boolean().optional(),
        default_template: z.literal(true).optional(),
        render_for: z.array(z.string()).optional().describe('entity ids that should render through this page'),
        render_default: z.array(z.string()).optional().describe('entity ids to return to the type default'),
        dry_run: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({
      site_id: given,
      page_id,
      name,
      slug,
      is_homepage,
      sort_order,
      seo,
      members_only,
      default_template,
      render_for,
      render_default,
      dry_run,
    }) => {
      seo?.jsonld?.forEach((block, i) => {
        try {
          JSON.parse(block);
        } catch (e) {
          throw new Error(`sbuilder: seo.jsonld[${i}] is not JSON: ${(e as Error).message}`);
        }
      });
      const site = `/api/sites/${encodeURIComponent(siteFor(ctx, given))}`;
      const path = `${site}/pages/${encodeURIComponent(page_id)}`;
      const token = siteToken(ctx);
      const got = (await request({ base: ctx.base, method: 'GET', path, token, fetchImpl: ctx.fetchImpl })) as {
        page?: Record<string, unknown>;
      };
      // No page, no merge base — and a blind write would wipe every settings key.
      if (!got?.page) throw new Error('sbuilder: page read returned no page; refusing to replace settings blind.');
      const page = got.page;
      const old = (page.settings && typeof page.settings === 'object' && !Array.isArray(page.settings)
        ? page.settings
        : {}) as Record<string, unknown>;

      // `settings` REPLACES WHOLESALE (UpdatePageInput), and it carries membersOnly,
      // courseGate, courseLesson and keys unknown here — so the write is always the
      // whole old blob with only the named keys moved, as the editor's PageSeoDialog does.
      const changes: Record<string, [unknown, unknown]> = {};
      const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
      const settings = { ...old };
      for (const [k, v] of Object.entries(seo ?? {})) {
        if (differs(old[k], v)) changes[`seo.${k}`] = [old[k] ?? null, v];
        settings[k] = v;
      }
      if (members_only !== undefined) {
        if (differs(old.membersOnly ?? false, members_only)) changes.members_only = [old.membersOnly ?? false, members_only];
        settings.membersOnly = members_only;
      }
      const body: Record<string, unknown> = {};
      const top: Array<[string, string, unknown]> = [
        ['name', 'name', name?.trim() || undefined],
        ['slug', 'slug', slug],
        ['is_homepage', 'isHomepage', is_homepage],
        ['sort_order', 'sortOrder', sort_order],
      ];
      for (const [arg, key, v] of top) {
        if (v === undefined || !differs(page[key] ?? null, v)) continue;
        changes[arg] = [page[key] ?? null, v];
        body[key] = v;
      }
      if (Object.keys(changes).some((k) => k === 'members_only' || k.startsWith('seo.'))) body.settings = settings;

      // WHICH ENTITIES RENDER THROUGH THIS PAGE — the editor's PageAssignPanel
      // (`features/pagelinks`). The link type follows the page's TYPE; the server
      // refuses a mismatch (422) itself, so this only names it up front.
      const sends: Array<{ method: string; path: string; body?: unknown }> = [];
      const linkType = LINK_TYPE_FOR_PAGE_TYPE[String(page.type ?? '')];
      if ((default_template || render_for?.length || render_default?.length) && !linkType) {
        throw new Error(
          `sbuilder: page ${page_id} is a "${String(page.type ?? 'page')}" page, which renders no entities — ` +
            `default_template/render_for need a ${Object.keys(LINK_TYPE_FOR_PAGE_TYPE).join(', ')} page.`,
        );
      }
      if (default_template && page.isDefaultTemplate !== true) {
        changes.default_template = [false, true];
        sends.push({ method: 'PUT', path: `${path}/default-template` });
      }
      if (render_for?.length) {
        changes.render_for = [null, `${render_for.length} ${linkType}`];
        sends.push({ method: 'POST', path: `${site}/page-links/bulk`, body: { linkType, linkIds: render_for, pageId: page_id } });
      }
      if (render_default?.length) {
        changes.render_default = [null, `${render_default.length} ${linkType}`];
        sends.push({ method: 'POST', path: `${site}/page-links/bulk`, body: { linkType, linkIds: render_default, pageId: null } });
      }
      const patching = Object.keys(body).length > 0;
      if (Object.keys(changes).length === 0) {
        throw new Error('sbuilder: nothing to change — every field given already holds that value on this page.');
      }

      if (dry_run !== false) {
        return text({
          dry_run: true,
          would_send: redact([...(patching ? [{ method: 'PATCH', path, body }] : []), ...sends]),
          changes,
          ...(ctx.notices.peek('page_update_publish', PUBLISH_NOTICE) ? { note: PUBLISH_NOTICE } : {}),
        });
      }
      const res = (
        patching ? await request({ base: ctx.base, method: 'PATCH', path, token, body, fetchImpl: ctx.fetchImpl }) : {}
      ) as { page?: Record<string, unknown> };
      // NOT ATOMIC — separate routes. A refusal midway names what already landed.
      const links: unknown[] = [];
      const landed: string[] = patching ? ['PATCH page'] : [];
      for (const r of sends) {
        try {
          const out = await request({ base: ctx.base, method: r.method, path: r.path, token, body: r.body, fetchImpl: ctx.fetchImpl });
          if (r.path.endsWith('/bulk')) links.push(out);
          landed.push(`${r.method} ${r.path.split('/').slice(-2).join('/')}`);
        } catch (e) {
          throw new Error(`${(e as Error).message} (already applied: ${landed.join(', ') || 'nothing'})`);
        }
      }
      const note = ctx.notices.once('page_update_publish', PUBLISH_NOTICE);
      return text({
        updated: page_id,
        changes,
        ...(links.length ? { links } : {}),
        ...(res?.page?.slug !== undefined && slug !== undefined && res.page.slug !== slug ? { slug_became: res.page.slug } : {}),
        ...(note ? { note } : {}),
      });
    },
  );
}
