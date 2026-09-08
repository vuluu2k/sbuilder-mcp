import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { composeWarnings, type ComposeWarning } from '../domains/site/findings.js';
import { text } from '../mcp/response.js';
import { loadSource, saveSource } from '../transport/pages.js';
import { PageDoc, type OutlineNode } from '../domains/site/document.js';
import {
  addSubtree,
  setKeys,
  setMany,
  moveNode,
  removeNode,
  duplicateNode,
  type NodeSpec,
  type Breakpoint,
  type SetEdit,
} from '../domains/site/builder.js';
import { request, redact } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { validateForSave } from '../domains/site/validate.js';
import { reviewDesign, REVIEW_NOTICE } from '../domains/site/review.js';
import { compactFindings } from '../domains/site/findings.js';
import { readinessGaps, READINESS_NOTICE } from '../domains/site/readiness.js';
import { gatherReadiness } from '../domains/site/readiness-fetch.js';
import { globalWarning, restampPatches, RESPONSIVE_NOTICE } from '../domains/site/traps.js';
import { catalogMatches, traitsFor } from '../catalog/element-search.js';
import type { Patch } from '../core/patch.js';
import type { LiveSession } from '../live/session.js';
import type { Box } from '../vision/shoot.js';
import { siteFor, type ToolContext } from './context.js';
import { projectList, PAGE_FIELDS, TEMPLATE_FIELDS } from './project.js';

/**
 * Findings, in the shape every surface returns them.
 *
 * Spread rather than repeated: three tools attach this, and three hand-written
 * copies of a directive is how one of them quietly loses it. The fix for each
 * KIND is sent once under `fixes`, and the directive once per process.
 */
export function reviewField(ctx: ToolContext, doc: PageDoc): Record<string, unknown> {
  const all = reviewDesign(doc);
  if (all.length === 0) return {};
  const { findings, fixes } = compactFindings(all);
  const notice = ctx.notices.once('review', REVIEW_NOTICE);
  return { findings, fixes, ...(notice ? { findings_notice: notice } : {}) };
}

/**
 * The one open page.
 *
 * The write tools share it rather than each re-fetching: a fetch per edit would
 * discard local work on every call, and would turn one hero section into forty
 * round trips.
 */
export class PageSession {
  private doc: PageDoc | null = null;
  private siteId = '';
  private pageId = '';
  private live: LiveSession | null = null;
  private stale: string | null = null;
  private warnings: ComposeWarning[] = [];
  private boxes: Box[] = [];

  constructor(private readonly ctx: ToolContext) {}

  attachLive(live: LiveSession): void {
    this.live = live;
  }

  location(): { siteId: string; pageId: string } {
    this.current();
    return { siteId: this.siteId, pageId: this.pageId };
  }

  /** Remember where each node landed, so the presence cursor can be honest. */
  noteBoxes(boxes: Box[]): void {
    this.boxes = boxes;
  }

  /**
   * Apply MY patches and, when joined to a room, put them on the wire.
   *
   * ONE method rather than two calls at every site, because "applied locally and
   * forgot to publish" is invisible: this session's document is right, the save
   * is right, and only the humans watching see nothing happen.
   */
  applyAndPublish(patches: Patch[]): void {
    const d = this.current();
    d.apply(patches);
    this.live?.publish(patches);
    // Move the cursor to what was just touched, but ONLY when a real
    // measurement exists. Presence with a made-up coordinate is theatre;
    // presence with a measured one is information.
    const touched = String(patches[0]?.path[1] ?? '');
    const box = this.boxes.find((b) => b.id === touched);
    if (box && this.live) {
      this.live.select(touched);
      this.live.cursor(box.x + box.w / 2, box.y + box.h / 2);
    }
  }

  applyRemote(patches: Patch[]): void {
    this.doc?.apply(patches);
  }

  /** The yield rule's local half: the next save re-pulls instead of overwriting. */
  markStale(reason: string): void {
    this.stale = reason;
  }

  async open(siteId: string, pageId: string): Promise<OutlineNode[]> {
    const src = await loadSource(this.ctx, siteId, pageId);
    this.doc = PageDoc.from(src.document);
    this.siteId = siteId;
    this.pageId = pageId;
    // The platform's own account of what it could not compose. Typed on the
    // response since the transport was written and read by nothing until now.
    this.warnings = composeWarnings(src.warnings);
    return this.doc.outline();
  }

  /** What the server said it could not compose when this page was opened. */
  composeWarnings(): ComposeWarning[] {
    return this.warnings;
  }

  current(): PageDoc {
    if (!this.doc) throw new Error('sbuilder: no page is open — call sb_page_open first');
    return this.doc;
  }

  /**
   * Validate, then save.
   *
   * The validation is not belt-and-braces. The platform refuses a band-order
   * violation or a broken tree on EVERY save, and learning that from a 409 one
   * autosave later means the agent has spent the interval editing a tree nobody
   * will ever store.
   */
  async save(): Promise<void> {
    if (this.stale) {
      // THE YIELD RULE. The room moved in a way this client cannot reconcile, so
      // it must not write its copy over whatever is there now. Re-pull, and make
      // the caller redo the intent against the current tree — loudly, because a
      // silently dropped edit is the outcome this whole rule exists to prevent.
      const reason = this.stale;
      this.stale = null;
      await this.open(this.siteId, this.pageId);
      throw new Error(
        `sbuilder: the page changed under this session (${reason}). It has been re-loaded from ` +
          'the server; re-read it with sb_outline and reapply your change.',
      );
    }
    const d = this.current();
    const problems = validateForSave(d);
    if (problems.length > 0) {
      throw new Error(`sbuilder: refusing to save — ${problems.join(' ')}`);
    }
    const saved = await saveSource(
      this.ctx,
      this.siteId,
      this.pageId,
      d.doc as unknown as { schema_version?: number; root_node_id: string; nodes: Record<string, unknown> },
    );
    // RE-STAMP THE FENCE, or lose every edit after this one.
    //
    // The save reports each shared master's new revision precisely so the client
    // can carry it into the next save; the platform refuses a stale `expectRev`
    // with a warning and a 200. Applied locally rather than published: these are
    // the server's own numbers coming back, not an edit anybody made, and a peer
    // in the room gets them from its own save.
    d.apply(restampPatches(d.doc, { globals: saved.globals, overlays: saved.overlays }));
  }
}

const specSchema: z.ZodType<NodeSpec> = z.lazy(() =>
  z.object({
    type: z.string(),
    name: z.string().optional(),
    style: z.record(z.unknown()).optional(),
    config: z.record(z.unknown()).optional(),
    specials: z.record(z.unknown()).optional(),
    children: z.array(specSchema).optional(),
  }),
);

export function registerPageTools(server: McpServer, ctx: ToolContext): PageSession {
  const session = new PageSession(ctx);

  server.registerTool(
    'sb_page_open',
    {
      description:
        'Open a page for editing and return its outline. Call before any sb_add / sb_set / ' +
          'sb_move / sb_remove. Find page ids with sb_api_find "list pages".',
      inputSchema: { site_id: z.string().optional(), page_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ site_id: given, page_id }) => {
      const outline = await session.open(siteFor(ctx, given), page_id);
      const doc = session.current();
      // A page whose stored document named its root under the app-block key
      // renders as an empty <body> and says nothing about why. Nobody else can
      // see this, so it is reported on open rather than left for the screenshot.
      const blank_page_repair = doc.adoptedRootKey
        ? `This page's document names its root as "${doc.adoptedRootKey}", not "root_node_id", so ` +
          'the renderer finds no root and publishes an EMPTY BODY. The next save from here writes ' +
          'the canonical key and fixes it; publish afterwards.'
        : undefined;
      const warnings = session.composeWarnings();
      return text({
        outline,
        ...(blank_page_repair ? { blank_page_repair } : {}),
        ...(warnings.length ? { compose_warnings: warnings } : {}),
        ...reviewField(ctx, doc),
      });
    },
  );

  server.registerTool(
    'sb_outline',
    {
      description:
        'The open page as a compressed tree — id, type, name, child count, band, and whether a ' +
          'node is a shared global or a site overlay. Never the raw document: a real page is ' +
          'hundreds of KB of JSON.',
      inputSchema: { depth: z.number().int().min(1).max(6).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ depth }) => text(session.current().outline({ depth })),
  );

  server.registerTool(
    'sb_node_read',
    {
      description:
        'One node in full — style, config, specials, per-breakpoint overrides, bindings.',
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const d = session.current();
      const node = d.node(id);
      const warn = globalWarning(d.doc, id);
      return text({ node, ...(warn ? { warning: warn } : {}) });
    },
  );

  server.registerTool(
    'sb_catalog_search',
    {
      description:
        'Find an element type by what you want it to do. Four fields per match; pass detail:true ' +
          "for the platform's AI hints, or read them with sb_traits_for once you have chosen.",
      inputSchema: {
      query: z.string(),
      limit: z.number().int().min(1).max(30).optional().describe('Default 8'),
      detail: z.boolean().optional().describe('Include useWhen / avoidWhen / contentTips per match'),
    },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit, detail }) => text(catalogMatches(query, { limit, detail })),
  );

  server.registerTool(
    'sb_traits_for',
    {
      description:
        "This element's INSPECTOR, as a person sees it: tabs, groups, and every control name — " +
          'with what each DECLARED control writes, and the AI hints for using the element. Read ' +
          'this before styling an element; pass control to read one control in full.',
      inputSchema: {
      type: z.string(),
      control: z.string().optional().describe('Narrow to one control, e.g. "font_size"'),
    },
      annotations: { readOnlyHint: true },
    },
    async ({ type, control }) => text(traitsFor(type, control)),
  );

  server.registerTool(
    'sb_add',
    {
      description:
        'Add an element — or a whole NESTED subtree — under a parent. One call builds a complete ' +
          'section: pass children rather than calling this once per node.',
      inputSchema: {
      parent_id: z.string(),
      spec: specSchema,
      index: z.number().int().min(0).optional(),
      dry_run: z.boolean().optional(),
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ parent_id, spec, index, dry_run }) => {
      const d = session.current();
      const { patches, ids } = addSubtree(d, parent_id, spec, index);
      if (dry_run !== false) {
        return text({ dry_run: true, would_add: ids.length, patches: patches.length });
      }
      session.applyAndPublish(patches);
      await session.save();
      return text({ added: ids, rev: d.rev });
    },
  );

  server.registerTool(
    'sb_set',
    {
      description:
        'Write style, config or specials keys on one node, or on many through edits (one ' +
          'save, one live frame). Per BREAKPOINT by default; base:true writes the fallback ' +
          'layer, right for a value that should not vary.',
      inputSchema: {
        id: z.string().optional(),
        namespace: z.enum(['style', 'config', 'specials']).optional(),
        keys: z.record(z.unknown()).optional(),
        breakpoint: z.enum(['desktop', 'laptop', 'tablet', 'mobile']).optional(),
        base: z.boolean().optional(),
        state: z.string().optional().describe('An interaction state, e.g. "hover"'),
        edits: z
          .array(
            z.object({
              id: z.string(),
              namespace: z.enum(['style', 'config', 'specials']),
              keys: z.record(z.unknown()),
              breakpoint: z.enum(['desktop', 'laptop', 'tablet', 'mobile']).optional(),
              base: z.boolean().optional(),
              state: z.string().optional(),
            }),
          )
          .optional(),
        dry_run: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, namespace, keys, breakpoint, base, state, edits, dry_run }) => {
      const d = session.current();
      // One shape inside: a single edit is a batch of one.
      const batch: SetEdit[] = edits ?? [];
      if (!edits) {
        if (!id || !namespace || !keys) {
          throw new Error('sbuilder: sb_set needs id + namespace + keys, or edits[]');
        }
        batch.push({ id, namespace, keys, breakpoint: breakpoint as Breakpoint | undefined, base, state });
      }
      const { patches, touched } = setMany(d, batch);
      if (dry_run !== false) {
        const note = ctx.notices.once('responsive', RESPONSIVE_NOTICE);
        return text({ dry_run: true, patches, ...(note ? { note } : {}) });
      }
      session.applyAndPublish(patches);
      await session.save();
      const warnings: Record<string, string> = {};
      for (const t of touched) {
        const w = globalWarning(d.doc, t.id);
        if (w) warnings[t.id] = w;
      }
      if (!edits) {
        const warn = warnings[batch[0].id];
        return text({ set: touched[0].keys, rev: d.rev, ...(warn ? { warning: warn } : {}) });
      }
      return text({ set: touched, rev: d.rev, ...(Object.keys(warnings).length ? { warnings } : {}) });
    },
  );

  server.registerTool(
    'sb_move',
    {
      description:
        'Move a node to another parent at an index.',
      inputSchema: {
      id: z.string(),
      parent_id: z.string(),
      index: z.number().int().min(0),
      dry_run: z.boolean().optional(),
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, parent_id, index, dry_run }) => {
      const d = session.current();
      const patches = moveNode(d, id, parent_id, index);
      if (dry_run !== false) return text({ dry_run: true, patches });
      session.applyAndPublish(patches);
      await session.save();
      return text({ moved: id, rev: d.rev });
    },
  );

  server.registerTool(
    'sb_remove',
    {
      description:
        'Remove a node and its whole subtree.',
      inputSchema: { id: z.string(), dry_run: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id, dry_run }) => {
      const d = session.current();
      const patches = removeNode(d, id);
      if (dry_run !== false) return text({ dry_run: true, removing: patches.length });
      session.applyAndPublish(patches);
      await session.save();
      return text({ removed: id, rev: d.rev });
    },
  );

  server.registerTool(
    'sb_review',
    {
      description:
        'What a VISITOR would meet on the open page (blank band, placeholder, dead binding) AND ' +
          "what stands between this store and a paid order (checkout page, gateway, delivery, a " +
          'way back to the cart). Run it before calling a page finished.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const doc = session.current();
      const field = reviewField(ctx, doc);
      // THE STORE'S OWN READINESS, which no API exposes and no page document
      // can show. A page can review perfectly clean and still sit on a store
      // with no checkout page, no gateway and no way back to the cart.
      let store: Record<string, unknown> = {};
      try {
        const { siteId } = session.location();
        const gaps = readinessGaps(
          await gatherReadiness(ctx, siteId, Object.values(doc.doc.nodes) as never),
        );
        if (gaps.length > 0) {
          const notice = ctx.notices.once('readiness', READINESS_NOTICE);
          store = { store_gaps: gaps, ...(notice ? { store_notice: notice } : {}) };
        }
      } catch {
        // Readiness is additional information, never the reason a review fails.
      }
      const clean = Object.keys(field).length === 0;
      return text({
        ...(clean ? { findings: [], verdict: 'Nothing a visitor would notice on this page.' } : field),
        ...store,
      });
    },
  );

  server.registerTool(
    'sb_duplicate',
    {
      description:
        'Copy a node and everything under it, under fresh ids, right after the original. The ' +
          'move a designer makes constantly — build one card, duplicate it twice.',
      inputSchema: { id: z.string(), dry_run: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, dry_run }) => {
      const d = session.current();
      const { patches, ids } = duplicateNode(d, id);
      if (dry_run !== false) return text({ dry_run: true, would_copy: ids.length });
      session.applyAndPublish(patches);
      await session.save();
      return text({ duplicated: id, into: ids[0], nodes: ids.length, rev: d.rev });
    },
  );

  server.registerTool(
    'sb_templates',
    {
      description:
        "The store's saved section templates — designed sections a person starts from rather " +
          'than assembling one. Use sb_template_use to drop one into the open page.',
      inputSchema: { site_id: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ site_id: given }) =>
      text(
        projectList(
          await request({
          base: ctx.base,
          method: 'GET',
          path: `/api/sites/${encodeURIComponent(siteFor(ctx, given))}/section-templates`,
          token: siteToken(ctx),
          fetchImpl: ctx.fetchImpl,
        }),
          'sectionTemplates',
          TEMPLATE_FIELDS,
        ),
      ),
  );

  server.registerTool(
    'sb_template_use',
    {
      description:
        'Instantiate a saved section template into a page. The server does the copy, so the ' +
          'section arrives exactly as it was designed — then re-open the page to see it.',
      inputSchema: {
      site_id: z.string().optional(),
      template_id: z.string(),
      page_id: z.string(),
      dry_run: z.boolean().optional(),
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ site_id: given, template_id, page_id, dry_run }) => {
      const site_id = siteFor(ctx, given);
      const path = `/api/sites/${encodeURIComponent(site_id)}/section-templates/${encodeURIComponent(template_id)}/instantiate`;
      if (dry_run !== false) {
        return text({ dry_run: true, would_post: path, body: { pageId: page_id } });
      }
      const out = await request({
        base: ctx.base,
        method: 'POST',
        path,
        token: siteToken(ctx),
        body: { pageId: page_id },
        fetchImpl: ctx.fetchImpl,
      });
      return text({
        instantiated: template_id,
        into: page_id,
        result: out,
        note: 'Re-open the page with sb_page_open — this session still holds the old tree.',
      });
    },
  );

  server.registerTool(
    'sb_page_list',
    {
      description:
        "Every page on the site, with its slug and whether it is live.",
      inputSchema: { site_id: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ site_id: given }) =>
      text(
        projectList(
          await request({
          base: ctx.base,
          method: 'GET',
          path: `/api/sites/${encodeURIComponent(siteFor(ctx, given))}/pages`,
          token: siteToken(ctx),
          fetchImpl: ctx.fetchImpl,
        }),
          'pages',
          PAGE_FIELDS,
        ),
      ),
  );

  server.registerTool(
    'sb_page_create',
    {
      description:
        'Create a page. It arrives empty; sb_page_open seeds its ROOT. TYPE is the route for ' +
          'checkout, product, category, post and course: /checkout and /products/{slug} need a ' +
          'PUBLISHED page of that type or they 404.',
      inputSchema: {
      site_id: z.string().optional(),
      name: z.string(),
      type: z.string().optional().describe('page (default), checkout, product, category, post, course'),
      slug: z.string().optional(),
      is_homepage: z.boolean().optional(),
      settings: z.record(z.unknown()).optional(),
      dry_run: z.boolean().optional(),
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ site_id: given, name, type, slug, is_homepage, settings, dry_run }) => {
      const site_id = siteFor(ctx, given);
      const path = `/api/sites/${encodeURIComponent(site_id)}/pages`;
      // TYPE IS THE ROUTE for several kinds of page: /checkout and
      // /products/{slug} resolve to the site's PUBLISHED page of that type and
      // fall through to a 404 when there is none. Without this argument the
      // agent could build a shop it could never let anyone buy from, which is
      // exactly the gap sb_review's store_gaps now reports.
      const body = {
        name,
        ...(type ? { type } : {}),
        ...(slug ? { slug } : {}),
        ...(is_homepage !== undefined ? { isHomepage: is_homepage } : {}),
        ...(settings ? { settings } : {}),
      };
      // `settings` is the one free-form object a caller hands this server, so the
      // preview and the echo both go through redact — everything else on this
      // path is built from narrow arguments.
      if (dry_run !== false) return text({ dry_run: true, would_post: path, body: redact(body) });
      const res = redact(
        await request({
          base: ctx.base,
          method: 'POST',
          path,
          token: siteToken(ctx),
          body,
          fetchImpl: ctx.fetchImpl,
        }),
      ) as { page?: Record<string, unknown> };
      // A COLLIDING SLUG IS RENAMED, NOT REFUSED. `uniqueSlug` suffixes -1, -2 …
      // and its own comment says it "never errors"
      // (server/internal/page/service.go:877). ErrSlugConflict exists and maps to
      // 409; this path never reaches it. So the create answers 200 carrying a
      // DIFFERENT slug than the one asked for, and every link the caller then
      // authors to the slug it requested is dead.
      const got = res.page?.slug;
      const renamed = slug && typeof got === 'string' && got !== slug;
      return text({
        ...res,
        ...(renamed
          ? {
              slug_renamed: `The slug "${slug}" was already taken, so the platform stored ` +
                `"${got}" instead and reported success. Link to "${got}", or free the name and ` +
                'create it again.',
            }
          : {}),
      });
    },
  );

  server.registerTool(
    'sb_publish',
    {
      description:
        'Compile the draft into the live page. PUBLISH CASCADES: a page sharing a global ' +
          'section with others republishes them too, because a header edited once must not go ' +
          'live on one page and stay stale on the rest.',
      inputSchema: { site_id: z.string().optional(), page_id: z.string(), dry_run: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ site_id: given, page_id, dry_run }) => {
      const site_id = siteFor(ctx, given);
      // PUBLISH IS A SITE-LEVEL CALL that NAMES pages, not a page-level route.
      // This used to POST /pages/{id}/publish, which the platform answers 404 —
      // it mounts "publish" as its own resource beside "pages"
      // (server/internal/page/rest/rest.go), taking {"pageIds": [...]}. An empty
      // list means the whole site, so the id is always sent: publishing one page
      // must never become publishing every page by accident.
      const path = `/api/sites/${encodeURIComponent(site_id)}/publish`;
      const body = { pageIds: [page_id] };
      if (dry_run !== false) return text({ dry_run: true, would_post: path, body });
      const res = (await request({
        base: ctx.base,
        method: 'POST',
        path,
        token: siteToken(ctx),
        body,
        fetchImpl: ctx.fetchImpl,
      })) as { published?: Array<Record<string, unknown>>; total?: number };
      // A PUBLISHED ROW CARRIES THE WHOLE RENDERED PAGE — document, html and css
      // — and publish CASCADES, so returning the response as it arrives pours
      // every republished page's markup into the reader. Kept: what identifies
      // the row and what a caller would act on.
      const published = (res.published ?? []).map((p) => ({
        pageId: p.pageId,
        ...(p.slug !== undefined ? { slug: p.slug } : {}),
        ...(p.isHomepage ? { isHomepage: true } : {}),
      }));
      // PUBLISH SKIPS A PAGE WITH NO SAVED DRAFT and still answers 200 with
      // whatever did publish (`server/internal/page/service.go:650`, a bare
      // `continue`). sb_page_create followed by sb_publish does exactly that:
      // the call succeeds, the page never flips to published, and the URL 404s.
      const landed = published.some((p) => p.pageId === page_id);
      return text({
        published,
        ...(published.length !== (res.total ?? published.length) ? { total: res.total } : {}),
        ...(landed
          ? {}
          : {
              not_published: `Page ${page_id} has no saved draft, so the platform published ` +
                'nothing for it and reported success anyway. Open it with sb_page_open, save an ' +
                'edit, then publish again.',
            }),
      });
    },
  );

  return session;
}
