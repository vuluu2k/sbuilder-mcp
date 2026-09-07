import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { loadSource, saveSource } from '../transport/pages.js';
import { PageDoc, type OutlineNode } from '../domains/site/document.js';
import {
  addSubtree,
  setKeys,
  moveNode,
  removeNode,
  duplicateNode,
  type NodeSpec,
  type Breakpoint,
} from '../domains/site/builder.js';
import { request } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { validateForSave } from '../domains/site/validate.js';
import { reviewDesign, REVIEW_NOTICE } from '../domains/site/review.js';
import { compactFindings } from '../domains/site/findings.js';
import { globalWarning, RESPONSIVE_NOTICE } from '../domains/site/traps.js';
import { catalogMatches, traitsFor } from '../catalog/element-search.js';
import type { Patch } from '../core/patch.js';
import type { LiveSession } from '../live/session.js';
import type { Box } from '../vision/shoot.js';
import type { ToolContext } from './context.js';
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
    return this.doc.outline();
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
    await saveSource(
      this.ctx,
      this.siteId,
      this.pageId,
      d.doc as unknown as { schema_version?: number; root_node_id: string; nodes: Record<string, unknown> },
    );
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
      inputSchema: { site_id: z.string(), page_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ site_id, page_id }) => {
      const outline = await session.open(site_id, page_id);
      return text({ outline, ...reviewField(ctx, session.current()) });
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
        'Write style, config or specials keys on a node. Style and config are written PER ' +
          'BREAKPOINT by default — a visual quantity written at base vanishes on publish.',
      inputSchema: {
      id: z.string(),
      namespace: z.enum(['style', 'config', 'specials']),
      keys: z.record(z.unknown()),
      breakpoint: z.enum(['desktop', 'laptop', 'tablet', 'mobile']).optional(),
      base: z.boolean().optional(),
      state: z.string().optional().describe('An interaction state, e.g. "hover"'),
      dry_run: z.boolean().optional(),
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, namespace, keys, breakpoint, base, state, dry_run }) => {
      const d = session.current();
      const patches = setKeys(d, id, keys, {
        namespace,
        breakpoint: breakpoint as Breakpoint | undefined,
        base,
        state,
      });
      if (dry_run !== false) {
        const note = ctx.notices.once('responsive', RESPONSIVE_NOTICE);
        return text({ dry_run: true, patches, ...(note ? { note } : {}) });
      }
      session.applyAndPublish(patches);
      await session.save();
      const warn = globalWarning(d.doc, id);
      return text({ set: Object.keys(keys), rev: d.rev, ...(warn ? { warning: warn } : {}) });
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
        'Everything wrong with the open page that a VISITOR would see — a blank band, a ' +
          'placeholder sentence the author never replaced, an image with no source, a binding ' +
          'that will never resolve. Distinct from whether the page saves: a perfectly storable ' +
          'document can publish as an empty box. Run it before you call a page finished.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const field = reviewField(ctx, session.current());
      return text(
        Object.keys(field).length === 0
          ? { findings: [], verdict: 'Nothing a visitor would notice.' }
          : field,
      );
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
      inputSchema: { site_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ site_id }) =>
      text(
        projectList(
          await request({
          base: ctx.base,
          method: 'GET',
          path: `/api/sites/${encodeURIComponent(site_id)}/section-templates`,
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
      site_id: z.string(),
      template_id: z.string(),
      page_id: z.string(),
      dry_run: z.boolean().optional(),
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ site_id, template_id, page_id, dry_run }) => {
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
      inputSchema: { site_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ site_id }) =>
      text(
        projectList(
          await request({
          base: ctx.base,
          method: 'GET',
          path: `/api/sites/${encodeURIComponent(site_id)}/pages`,
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
        'Create a page. It arrives empty; sb_page_open seeds its ROOT so you can build into it.',
      inputSchema: {
      site_id: z.string(),
      name: z.string(),
      settings: z.record(z.unknown()).optional(),
      dry_run: z.boolean().optional(),
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ site_id, name, settings, dry_run }) => {
      const path = `/api/sites/${encodeURIComponent(site_id)}/pages`;
      if (dry_run !== false) return text({ dry_run: true, would_post: path, body: { name, settings } });
      return text(
        await request({
          base: ctx.base,
          method: 'POST',
          path,
          token: siteToken(ctx),
          body: { name, ...(settings ? { settings } : {}) },
          fetchImpl: ctx.fetchImpl,
        }),
      );
    },
  );

  server.registerTool(
    'sb_publish',
    {
      description:
        'Compile the draft into the live page. PUBLISH CASCADES: a page sharing a global ' +
          'section with others republishes them too, because a header edited once must not go ' +
          'live on one page and stay stale on the rest.',
      inputSchema: { site_id: z.string(), page_id: z.string(), dry_run: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ site_id, page_id, dry_run }) => {
      const path = `/api/sites/${encodeURIComponent(site_id)}/pages/${encodeURIComponent(page_id)}/publish`;
      if (dry_run !== false) return text({ dry_run: true, would_post: path });
      return text(
        await request({
          base: ctx.base,
          method: 'POST',
          path,
          token: siteToken(ctx),
          fetchImpl: ctx.fetchImpl,
        }),
      );
    },
  );

  return session;
}
