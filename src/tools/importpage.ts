import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { capture, captureMany, crawlLinks } from '../vision/capture.js';
import { uploadMedia } from '../transport/media.js';
import { addSubtree } from '../domains/site/builder.js';
import { middleEnd } from '../domains/site/traps.js';
import type { Patch } from '../core/patch.js';
import {
  toSpecs,
  tokensFromPage,
  imageSources,
  rehostImages,
  type Captured,
} from '../domains/site/importmap.js';
import {
  canonFor,
  choosePages,
  normalizeUrl,
  robotsRules,
  robotsSitemaps,
  sitemapUrls,
  type RobotsRules,
  type Found,
  type Planned,
} from '../domains/site/discover.js';
import { loadSource } from '../transport/pages.js';
import { PageDoc } from '../domains/site/document.js';
import { request } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { projectList, PAGE_FIELDS } from './project.js';
import { siteFor, type ToolContext } from './context.js';
import type { PageSession } from './page.js';

/**
 * Read a URL from SOMEBODY ELSE'S ORIGIN.
 *
 * NOT through `request()`, and that is the point: every path in that module
 * attaches a credential, and this one must attach none. A sitemap fetch that
 * carried `SB_TOKEN` would hand this install's key to a stranger's server
 * because the caller pasted a link — the same envelope rule this repo keeps for
 * every other secret, applied to the one call that leaves the platform.
 *
 * A failure is an ANSWER, not an error: most sites have no robots.txt, plenty
 * have no sitemap, and discovery falls through to the link crawl. Nothing here
 * is worth ending a tool call over.
 */
async function fetchForeign(ctx: ToolContext, url: string): Promise<string | null> {
  const f = ctx.fetchImpl ?? fetch;
  try {
    const res = await f(url, {
      signal: AbortSignal.timeout(8_000),
      redirect: 'follow',
    } as RequestInit);
    if (!res.ok) return null;
    const body = await res.text();
    // A sitemap is text from a stranger. Bounded so a multi-megabyte one costs
    // a slice rather than the process.
    return body.length > 5_000_000 ? body.slice(0, 5_000_000) : body;
  } catch {
    return null;
  }
}

/**
 * THE PUBLISHER'S OWN LIST OF ITS PAGES, or null if it does not offer one.
 *
 * One fetch and no browser, and it lists pages nothing links to — which is why
 * it is tried before the crawl rather than after it.
 */
export async function fromSitemap(ctx: ToolContext, entry: string, declaredIn: string[]): Promise<Found[] | null> {
  const origin = new URL(entry).origin;
  const declared = new Set<string>(declaredIn);
  for (const guess of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml']) {
    declared.add(`${origin}${guess}`);
  }

  const pages = new Set<string>();
  let queue = [...declared].slice(0, 5);
  // ONE level of index expansion. A sitemap index of indexes exists and is rare;
  // the bound is what keeps a pathological one from becoming a fetch storm on
  // somebody else's server.
  for (let round = 0; round < 2 && queue.length > 0; round += 1) {
    const next: string[] = [];
    for (const sm of queue.slice(0, 5)) {
      const xml = await fetchForeign(ctx, sm);
      if (!xml) continue;
      const got = sitemapUrls(xml);
      for (const u of got.pages) pages.add(u);
      for (const u of got.sitemaps) next.push(u);
    }
    queue = next;
  }

  // TWO IS THE THRESHOLD, NOT ONE. A sitemap listing only the home page is what a
  // half-configured generator emits, and taking it would import a one-page site
  // off a site that has forty.
  if (pages.size < 2) return null;
  // THE ENTRY IS NOT PUSHED HERE. `choosePages` guarantees it is page one, so
  // adding it would arrive as a second copy and be counted as a dropped
  // duplicate — a phantom loss on every sitemap run.
  const urls: Found[] = [];
  for (const u of pages) {
    // NORMALIZED, NOT FILTERED. `canonFor` exists to stop a crawl spending a
    // NAVIGATION on a PDF; a sitemap costs no navigation, so there is nothing to
    // save by dropping one here — and dropping it here means `choosePages` never
    // sees it and never counts the reason. Filtering twice and reporting once is
    // how a caller ends up asking why the cart page vanished.
    const c = normalizeUrl(u, entry);
    if (c) urls.push({ url: c, from: 'sitemap' });
  }
  return urls;
}

/**
 * THE PAGES THIS SITE ALREADY HAS — read by the preview as well as the run.
 *
 * The dry run used to make no platform call at all, which made it cheap and
 * made it LIE: it promised twelve pages on a site where four of those slugs
 * were taken (each of which the run then skips, because the platform renames a
 * collision and answers 200) and never said the entry URL was about to be
 * merged into an existing home page rather than given one of its own. A preview
 * whose count does not survive contact with the run is not a preview.
 */
async function existingPages(ctx: ToolContext, siteId: string): Promise<Array<Record<string, unknown>>> {
  const listed = (await request({
    base: ctx.base,
    method: 'GET',
    path: `/api/sites/${encodeURIComponent(siteId)}/pages`,
    token: siteToken(ctx),
    fetchImpl: ctx.fetchImpl,
  })) as { pages?: Array<Record<string, unknown>> };
  return Array.isArray(listed.pages) ? listed.pages : [];
}

/**
 * WHAT PAGES THIS SITE HAS — the publisher's own answer first, a crawl second.
 *
 * The order is about cost, not preference. A sitemap is one fetch and no browser;
 * a crawl is a browser navigation per page and can only find what the entry page
 * points at. So the crawl is the fallback, automatically: there is no knob to
 * force it, because a caller who wants fewer pages than the sitemap offers wants
 * `include` or `max_pages`, not a slower way to find the same list.
 */
async function discoverSite(
  ctx: ToolContext,
  entry: string,
  opts: { depth?: number; maxVisits?: number },
): Promise<{
  source: 'sitemap' | 'links';
  urls: Found[];
  titles: Map<string, string>;
  visited: number;
  robots?: RobotsRules;
  /** How many crawled URLs turned out to be another page under a different address. */
  aliases: number;
}> {
  // ROBOTS.TXT ANSWERS TWO QUESTIONS AND IS FETCHED ONCE. Where the sitemap
  // really is — plenty are not at /sitemap.xml, a shop platform names
  // /sitemap_products_1.xml and a CMS a dated path — and which paths a general
  // crawler is asked to leave alone.
  const origin = new URL(entry).origin;
  const txt = await fetchForeign(ctx, `${origin}/robots.txt`);
  const robots = txt ? robotsRules(txt) : undefined;
  const listed = await fromSitemap(ctx, entry, txt ? robotsSitemaps(txt) : []);
  if (listed) return { source: 'sitemap', urls: listed, titles: new Map(), visited: 0, robots, aliases: 0 };

  const crawled = await crawlLinks(entry, {
    depth: opts.depth ?? 1,
    maxVisits: opts.maxVisits ?? 24,
    canon: canonFor(entry),
  });
  // A PAGE THAT NAMES ANOTHER ADDRESS AS ITS OWN IS THAT PAGE. Folded here, on
  // the crawl path, where the answer is already in hand — the sitemap path has
  // no canonical until the page is opened, and the import pass folds that one.
  const seen = new Set<string>();
  const urls: Found[] = [];
  let aliases = 0;
  for (const u of crawled.urls) {
    const real = crawled.canonical.get(u) ?? u;
    if (real !== u) aliases += 1;
    if (seen.has(real)) continue;
    seen.add(real);
    urls.push({ url: real, from: real === entry ? 'entry' : 'links' });
  }
  return { source: 'links', urls, titles: crawled.titles, visited: crawled.visited, robots, aliases };
}

export function registerImportTools(
  server: McpServer,
  ctx: ToolContext,
  session: PageSession,
): void {
  server.registerTool(
    'sb_import',
    {
      description:
        'Read a page from any public URL and add its structure and content to the OPEN page as ' +
        'real elements, styled with this page\'s own tokens. Not a clone: the source\'s layout ' +
        'and CSS are not copied. Dry run returns what was found.',
      inputSchema: {
        url: z.string().describe('The page to read'),
        site_id: z.string().optional(),
        max_sections: z.number().int().min(1).max(60).optional(),
        max_images: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe('Default 24 — every image is an upload'),
        max_nodes: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe('Default 300 — the bound on the whole import'),
        upload_images: z
          .boolean()
          .optional()
          .describe('Copy the images into this site\'s media library, default true'),
        dry_run: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ url, site_id: given, max_sections, max_images, max_nodes, upload_images, dry_run }) => {
      const siteId = siteFor(ctx, given);
      // THE TARGET PAGE MUST BE OPEN, and not only because that is where the
      // nodes go: its own heading, button and section are where the tokens come
      // from, so an import with no open page is an import with no design.
      const doc = session.current();

      const shot = await capture(url, {
        maxSections: max_sections,
        maxImages: max_images,
        maxNodes: max_nodes,
      });
      const tokens = tokensFromPage(doc.doc);
      const images = imageSources(shot.sections);

      if (dry_run !== false) {
        const specs = toSpecs(shot.sections, tokens);
        return text({
          dry_run: true,
          read: shot.url,
          title: shot.title,
          sections: specs.length,
          images: images.length,
          tokens,
          skipped: shot.skipped,
          note:
            'Structure and content only — the source\'s CSS and layout are NOT copied, and the ' +
            'tokens above were read off the page you have open. Pass dry_run:false to add it.',
        });
      }

      // IMAGES ARE COPIED BEFORE THE NODES ARE MADE. Hotlinking somebody else's
      // images is a page that breaks when their site changes, and on a storefront
      // that is a product photo going missing. A failed upload leaves the
      // original source in place rather than an empty frame.
      const rehosted = new Map<string, string>();
      // WHY it failed, not just how many. Four images refused for the same
      // reason is ONE thing to fix, and a bare count is the shape that sends a
      // caller to re-run the import hoping for a different answer.
      //
      // The measurement that proved it worth having also proved a CONCLUSION
      // WRONG. A real import lost all four images to `only image, video, or font
      // (woff2/woff/ttf/otf) uploads are supported`, and that was written up here
      // as the platform refusing SVG. It does not refuse SVG: it accepts any
      // declared `image/*`, and `image/svg+xml` is one. `uploadMedia` was sending
      // a typeless Blob, so EVERY url upload arrived as `application/octet-stream`
      // — a PNG was refused by the same message. A reason carried verbatim is
      // what makes a wrong reading of it findable.
      const failures = new Map<string, number>();
      if (upload_images !== false) {
        for (const src of images) {
          try {
            const up = await uploadMedia(ctx, siteId, { url: src });
            if (up.url) rehosted.set(src, up.url);
          } catch (e) {
            const why = (e as Error).message.replace(/^sbuilder:\s*/, '').slice(0, 160);
            failures.set(why, (failures.get(why) ?? 0) + 1);
          }
        }
      }
      const failed = [...failures.entries()].map(([reason, count]) => ({ reason, count }));

      const sections: Captured[] = rehosted.size > 0 ? rehostImages(shot.sections, rehosted) : shot.sections;
      const specs = toSpecs(sections, tokens);
      if (specs.length === 0) {
        throw new Error(
          `sbuilder: nothing renderable was found at ${shot.url}. ` +
            `Skipped: ${JSON.stringify(shot.skipped)}. A page that builds itself with scripts ` +
            'after load, or one behind a login, reads as empty here.',
        );
      }

      // STAGED ON A COPY, committed once.
      //
      // Each section's patch set is computed from the tree the previous one
      // left, so they have to be applied in order — but applying them to the
      // REAL document means a refusal at the end leaves the page half imported,
      // with no way for the caller to tell which half. Building on a throwaway
      // and committing the whole run through `applyAndSave` keeps the import
      // all-or-nothing, and keeps it to one save and one live frame.
      const added: string[] = [];
      const all: Patch[] = [];
      const staged = doc.preview([]);
      for (const spec of specs) {
        // BEFORE THE GLOBAL FOOTER, not after it. Appending to ROOT is the
        // obvious thing and it breaks trap 3 on every page that has a footer —
        // the platform refuses the whole save, and the caller is told about a
        // band rule they did not knowingly break. Recomputed each time because
        // the last insert moved it.
        const { patches, ids } = addSubtree(
          staged,
          staged.doc.root_node_id,
          spec,
          middleEnd(staged.doc),
        );
        staged.apply(patches);
        all.push(...patches);
        added.push(ids[0]);
      }
      await session.applyAndSave(all);

      return text({
        read: shot.url,
        added_sections: added,
        // WHAT WAS LEFT BEHIND, on the real run too. The dry run said it and the
        // real one did not, which is the wrong way round: a caller who skipped
        // the preview is exactly the caller who needs to be told that 21 nodes
        // hit the ceiling, or that the page's own header was dropped on purpose.
        ...(Object.keys(shot.skipped).length ? { skipped: shot.skipped } : {}),
        images: {
          copied: rehosted.size,
          ...(failed.length ? { failed } : {}),
        },
        rev: doc.rev,
        note:
          'Added with THIS page\'s tokens, not the source\'s. Look at it before publishing — ' +
          'an imported page is a starting point, and the source\'s own layout was not copied.' +
          (failed.length
            ? ' An image that could not be copied KEPT ITS ORIGINAL URL, so the page still ' +
              'shows it — but it now depends on somebody else\'s server.'
            : ''),
      });
    },
  );

  server.registerTool(
    'sb_import_site',
    {
      description:
        'Read a WHOLE site from one URL — its sitemap, or the links on that page — and give each ' +
        'page found its own DRAFT page here, built from this site\'s tokens. Not a clone. Dry run ' +
        'returns the page list before anything is created.',
      inputSchema: {
        url: z.string().describe('Any page of the site'),
        site_id: z.string().optional(),
        max_pages: z.number().int().min(1).max(60).optional().describe('Default 12'),
        depth: z.number().int().min(0).max(3).optional().describe('No sitemap: link depth, default 1'),
        include: z.array(z.string()).optional().describe('Path substrings to keep'),
        exclude: z.array(z.string()).optional(),
        max_images: z.number().int().min(0).max(200).optional().describe('Default 24, whole import'),
        max_nodes: z.number().int().min(1).max(1000).optional().describe('Per page, default 300'),
        upload_images: z.boolean().optional(),
        homepage: z.boolean().optional().describe("Entry into this site's home page, default true"),
        dry_run: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({
      url,
      site_id: given,
      max_pages,
      depth,
      include,
      exclude,
      max_images,
      max_nodes,
      upload_images,
      homepage,
      dry_run,
    }) => {
      const siteId = siteFor(ctx, given);
      const entry = normalizeUrl(url);
      if (!entry) {
        throw new Error(
          `sbuilder: "${url}" is not a page address this server can read — an http or https URL is needed.`,
        );
      }

      const found = await discoverSite(ctx, entry, {
        depth,
        // The crawl may look at more pages than it imports — that is how it finds
        // the twelfth — but not without bound.
        maxVisits: Math.max(4, (max_pages ?? 12) * 2),
      });
      const chosen = choosePages(entry, found.urls, {
        maxPages: max_pages,
        include,
        exclude,
        robots: found.robots,
      });
      // A CRAWL ALREADY READ THE TITLE. `nameFor` derives a name from the slug
      // because a sitemap offers nothing else, but the link crawl opened every
      // one of these pages to read its links and has the page's own `<title>` —
      // so the plan can name them the way their author does, before anything is
      // captured.
      const plan = {
        ...chosen,
        pages: chosen.pages.map((p) => ({ ...p, name: found.titles.get(p.url) || p.name })),
      };
      if (plan.pages.length === 0) {
        throw new Error(
          `sbuilder: no page worth importing was found from ${entry}. Discovered by ` +
            `${found.source}; skipped ${JSON.stringify(plan.skipped)}. A site behind a login, or ` +
            'one whose links are all off-site, reads as empty here.',
        );
      }

      // FORTY URLS UNDER ONE PREFIX ARE NOT FORTY PAGES ON THIS PLATFORM.
      //
      // They are one entity TEMPLATE plus a catalogue: `/products/x` resolves to
      // the site's published page of type `product`, bound to the record in the
      // URL. Importing them as static pages produces a shop where every price is
      // a literal, nothing is buyable, and `sb_review` reports a missing purchase
      // action on forty pages at once. Said before anything is created, because
      // after it the fix is forty deletes.
      const heavy = Object.entries(plan.groups)
        .filter(([, n]) => n >= 3)
        .map(([seg, n]) => `${seg} (${n})`);
      const templateNote =
        heavy.length > 0
          ? `Several URLs share a prefix — ${heavy.join(', ')}. If those are products, ` +
            'collections or posts, they are ONE template plus real records here, not one page ' +
            'each: sb_page_create type:"product" (or category/post) seeds the bound page, and ' +
            'the catalogue comes from the API. Pass exclude to leave them out of the import.'
          : undefined;

      // BEST EFFORT IN THE PREVIEW, REQUIRED IN THE RUN.
      //
      // The listing is what makes the preview honest — which slugs are taken,
      // whether the entry merges into an existing home page — but demanding it
      // would turn "what is on that website?" into a question only a connected
      // install may ask, and the discovery half needs no credential at all. So a
      // dry run that cannot read the site says the landing spot is unknown
      // rather than inventing one; the real run must not guess, and rethrows.
      let existing: Array<Record<string, unknown>> = [];
      let unlistable = '';
      try {
        existing = await existingPages(ctx, siteId);
      } catch (e) {
        // NAME WHAT FAILED. The bare platform string ("boom", "not found") tells
        // a caller who asked to import a website nothing about WHICH call broke,
        // and the one that broke is this site's own page listing — without it the
        // run cannot tell a free slug from a taken one, or find the home page.
        if (dry_run === false) {
          throw new Error(
            `sbuilder: could not read this site's own pages, so the import cannot tell which ` +
              `slugs are free or which page is the home page — nothing was created. ` +
              `${(e as Error).message.replace(/^sbuilder:\s*/, '')}`,
          );
        }
        unlistable = (e as Error).message.replace(/^sbuilder:\s*/, '');
      }
      const home = existing.find((e) => e.isHomepage === true);
      const taken = new Set(
        existing.map((e) => (typeof e.slug === 'string' ? e.slug : '')).filter(Boolean),
      );
      const lands = (p: { url: string; slug: string }) =>
        unlistable
          ? {}
          : p.url === entry && homepage !== false && home
            ? { into: 'the existing home page' }
            : taken.has(p.slug)
              ? { conflict: `a page with slug "${p.slug}" already exists — this one is SKIPPED` }
              : {};

      if (dry_run !== false) {
        return text({
          dry_run: true,
          entry,
          discovered_by: found.source,
          ...(found.visited ? { pages_read_to_find_them: found.visited } : {}),
          pages: plan.pages.map((p) => ({ url: p.url, slug: p.slug, name: p.name, ...lands(p) })),
          ...(Object.keys(plan.skipped).length || found.aliases
            ? { skipped: { ...plan.skipped, ...(found.aliases ? { 'canonical-alias': found.aliases } : {}) } }
            : {}),
          ...(unlistable
            ? {
                landing_unknown:
                  `This site's own pages could not be read (${unlistable}), so which of the above ` +
                  'would merge into an existing home page, and which would collide with a slug ' +
                  'already taken, is not known yet.',
              }
            : {}),
          ...(templateNote ? { entity_pages: templateNote } : {}),
          note:
            'Nothing has been created. Each page above becomes a DRAFT page here, filled with the ' +
            "source's structure and text and styled with this site's own tokens — the source's CSS " +
            'and layout are not copied. Pass dry_run:false to build them.',
        });
      }

      // THE TOKENS COME FROM THIS SITE, ONCE, FOR EVERY IMPORTED PAGE.
      //
      // `sb_import` reads them off the OPEN page, which is right when the import
      // is one section onto a page that already has a look. Here most of the
      // target pages do not exist yet and the ones that do are blank, so reading
      // per page would give the first page element defaults and every later page
      // the defaults of the blank page before it — rule 0 failing on every page
      // at once. The open page if there is one, the site's home page otherwise.
      let tokenDoc = session.peek();
      if (!tokenDoc && home && typeof home.id === 'string') {
        try {
          tokenDoc = PageDoc.from((await loadSource(ctx, siteId, home.id)).document);
        } catch {
          // An unreadable home page costs the tokens, not the import: every field
          // of PageTokens is optional and falls back to the element's own
          // defaults, which is the same answer an empty target gives.
        }
      }
      const tokens = tokenDoc ? tokensFromPage(tokenDoc.doc) : {};

      const shots = await captureMany(
        plan.pages.map((p) => p.url),
        { maxImages: max_images ?? 24, maxNodes: max_nodes ?? 300 },
      );
      const byUrl = new Map(shots.map((s) => [s.url, s]));

      // ONE UPLOAD PER IMAGE FOR THE WHOLE SITE, not per page. A logo, a payment
      // strip and a footer badge appear on every page of a real site, and
      // uploading each of them twelve times would fill the merchant's library
      // with twelve copies and pay twelve round trips for one asset.
      const budget = max_images ?? 24;
      const seenSrc = new Set<string>();
      for (const s of shots) {
        if (!s.ok) continue;
        for (const src of imageSources(s.result.sections)) seenSrc.add(src);
      }
      const wanted = [...seenSrc].slice(0, budget);
      const overBudget = seenSrc.size - wanted.length;
      const rehosted = new Map<string, string>();
      const failures = new Map<string, number>();
      if (upload_images !== false) {
        for (const src of wanted) {
          try {
            const up = await uploadMedia(ctx, siteId, { url: src });
            if (up.url) rehosted.set(src, up.url);
          } catch (e) {
            const why = (e as Error).message.replace(/^sbuilder:\s*/, '').slice(0, 160);
            failures.set(why, (failures.get(why) ?? 0) + 1);
          }
        }
      }
      const failedImages = [...failures.entries()].map(([reason, count]) => ({ reason, count }));

      // A PAGE THAT FAILS DOES NOT END THE RUN, and this is the one place in the
      // server where that is the right call. A site import is not atomic and
      // cannot be — each page is its own create and its own save — so the honest
      // shape is per-page outcomes. Aborting on the fourth of twelve would leave
      // three pages built, nine not, and no report saying which.
      const built: Array<Record<string, unknown>> = [];
      const failed: Array<{ url: string; why: string }> = [];
      // WHAT EACH PAGE SAYS ITS OWN ADDRESS IS. A sitemap cannot tell you that
      // two of its entries are one page — only the page can, and only once it is
      // open. Measured: modelcontextprotocol.io's home page declares a dated
      // docs path as its canonical, so `/` and that path are the same content
      // under two slugs, and nothing in the plan looks wrong.
      const identities = new Set<string>();
      const aliased: Array<{ url: string; same_as: string }> = [];
      let lastOpened = '';

      for (const p of plan.pages as Planned[]) {
        const shot = byUrl.get(p.url);
        if (!shot || !shot.ok) {
          failed.push({ url: p.url, why: shot ? shot.why : 'was not read' });
          continue;
        }
        const identity = normalizeUrl(shot.result.canonical ?? p.url) ?? p.url;
        if (identities.has(identity)) {
          aliased.push({ url: p.url, same_as: identity });
          continue;
        }
        identities.add(identity);
        try {
          const sections =
            rehosted.size > 0 ? rehostImages(shot.result.sections, rehosted) : shot.result.sections;
          const specs = toSpecs(sections, tokens);
          if (specs.length === 0) {
            failed.push({
              url: p.url,
              why: `nothing renderable — skipped ${JSON.stringify(shot.result.skipped)}`,
            });
            continue;
          }

          let pageId = '';
          let into: string | undefined;
          const isEntry = p.url === entry;
          if (isEntry && homepage !== false && home && typeof home.id === 'string') {
            pageId = home.id;
            into = 'the existing home page';
          } else {
            // A COLLIDING SLUG IS RENAMED BY THE PLATFORM, NOT REFUSED, so
            // creating over one answers 200 under a name nobody asked for. On a
            // second run of this tool that would silently double the site.
            if (taken.has(p.slug)) {
              failed.push({
                url: p.url,
                why: `a page with slug "${p.slug}" already exists — left alone, because the ` +
                  'platform would have stored this one under a different slug and reported success',
              });
              continue;
            }
            const made = (await request({
              base: ctx.base,
              method: 'POST',
              path: `/api/sites/${encodeURIComponent(siteId)}/pages`,
              token: siteToken(ctx),
              // BLANK, DELIBERATELY. `type: "page"` has no seed, and a seeded
              // page would mix the platform's own content with the imported
              // page's — two headings, two heroes, and no way to tell them apart.
              body: { name: shot.result.title || p.name, type: 'page', slug: p.slug },
              fetchImpl: ctx.fetchImpl,
            })) as { page?: { id?: unknown; slug?: unknown } };
            if (typeof made.page?.id !== 'string' || !made.page.id) {
              failed.push({ url: p.url, why: 'the platform created no page for it' });
              continue;
            }
            pageId = made.page.id;
            if (typeof made.page.slug === 'string') taken.add(made.page.slug);
          }

          await session.open(siteId, pageId);
          const doc = session.current();
          // STAGED ON A COPY, committed once — the same reason `sb_import` does
          // it: each section's patches are computed from the tree the last one
          // left, and applying them to the real document means a refusal halfway
          // leaves a page half imported with nothing saying which half.
          const staged = doc.preview([]);
          const all: Patch[] = [];
          const added: string[] = [];
          for (const spec of specs) {
            const { patches, ids } = addSubtree(
              staged,
              staged.doc.root_node_id,
              spec,
              middleEnd(staged.doc),
            );
            staged.apply(patches);
            all.push(...patches);
            added.push(ids[0]);
          }
          await session.applyAndSave(all);
          lastOpened = pageId;
          built.push({
            url: p.url,
            slug: p.slug,
            page_id: pageId,
            sections: added.length,
            ...(into ? { into } : {}),
            ...(Object.keys(shot.result.skipped).length ? { skipped: shot.result.skipped } : {}),
          });
        } catch (e) {
          failed.push({ url: p.url, why: (e as Error).message.replace(/^sbuilder:\s*/, '').slice(0, 200) });
        }
      }

      return text({
        entry,
        discovered_by: found.source,
        built,
        ...(failed.length ? { failed } : {}),
        ...(aliased.length ? { same_page: aliased } : {}),
        ...(Object.keys(plan.skipped).length || found.aliases
          ? { skipped: { ...plan.skipped, ...(found.aliases ? { 'canonical-alias': found.aliases } : {}) } }
          : {}),
        images: {
          copied: rehosted.size,
          ...(failedImages.length ? { failed: failedImages } : {}),
          ...(overBudget > 0 ? { over_budget: overBudget } : {}),
        },
        ...(lastOpened ? { open: lastOpened } : {}),
        ...(templateNote ? { entity_pages: templateNote } : {}),
        directive: ctx.notices.once(
          'import_site',
          'These pages are DRAFTS: nothing is live until sb_publish. Three things the import ' +
            "cannot do for you — the source's header and footer were skipped on purpose (this " +
            'site has its own as globals, and a second menu pointing at somebody else\'s site is ' +
            'worse than none), no menu links the new pages together, and nothing has been seen at ' +
            '390px yet. sb_look each page at the three widths before publishing.',
        ),
      });
    },
  );

}
