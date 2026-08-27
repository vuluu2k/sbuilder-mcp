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
  type NodeSpec,
  type Breakpoint,
} from '../domains/site/builder.js';
import { validateForSave } from '../domains/site/validate.js';
import { globalWarning, RESPONSIVE_NOTICE } from '../domains/site/traps.js';
import { ELEMENTS } from '../catalog/elements.generated.js';
import type { ToolContext } from './context.js';

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

  constructor(private readonly ctx: ToolContext) {}

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

export function registerPageTools(server: McpServer, ctx: ToolContext): void {
  const session = new PageSession(ctx);

  server.tool(
    'sb_page_open',
    'Open a page for editing and return its outline. Call before any sb_add / sb_set / ' +
      'sb_move / sb_remove. Find page ids with sb_api_find "list pages".',
    { site_id: z.string(), page_id: z.string() },
    async ({ site_id, page_id }) => text(await session.open(site_id, page_id)),
  );

  server.tool(
    'sb_outline',
    'The open page as a compressed tree — id, type, name, child count, band, and whether a ' +
      'node is a shared global or a site overlay. Never the raw document: a real page is ' +
      'hundreds of KB of JSON.',
    { depth: z.number().int().min(1).max(6).optional() },
    async ({ depth }) => text(session.current().outline({ depth })),
  );

  server.tool(
    'sb_node_read',
    'One node in full — style, config, specials, per-breakpoint overrides, bindings.',
    { id: z.string() },
    async ({ id }) => {
      const d = session.current();
      const node = d.node(id);
      const warn = globalWarning(d.doc, id);
      return text({ node, ...(warn ? { warning: warn } : {}) });
    },
  );

  server.tool(
    'sb_catalog_search',
    "Find an element type by what you want it to do. Searches the platform's own AI hints — " +
      'when to use each element, when not to, and what content suits it.',
    { query: z.string(), limit: z.number().int().min(1).max(30).optional() },
    async ({ query, limit }) => {
      const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const scored = Object.values(ELEMENTS)
        .map((el) => {
          const hay = [el.type, el.label, el.category, el.description, ...el.semantics, ...el.useWhen]
            .join(' ')
            .toLowerCase();
          return { el, score: terms.filter((t) => hay.includes(t)).length };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score || a.el.type.localeCompare(b.el.type))
        .slice(0, limit ?? 10);
      return text(
        scored.map(({ el }) => ({
          type: el.type,
          label: el.label,
          category: el.category,
          isContainer: el.isContainer,
          isRootOnly: el.isRootOnly,
          description: el.description,
          useWhen: el.useWhen,
          avoidWhen: el.avoidWhen,
          contentTips: el.contentTips,
        })),
      );
    },
  );

  server.tool(
    'sb_traits_for',
    'Which inspector trait GROUPS an element accepts (size, typography, background, spacing …), ' +
      'plus its seeded defaults and containment rules.',
    { type: z.string() },
    async ({ type }) => {
      const el = ELEMENTS[type];
      if (!el) throw new Error(`sbuilder: unknown element "${type}" — use sb_catalog_search`);
      return text({
        type: el.type,
        traitGroups: el.traits,
        defaults: el.defaults,
        isContainer: el.isContainer,
        isRootOnly: el.isRootOnly,
        childAllows: el.childAllows,
        contentTips: el.contentTips,
      });
    },
  );

  server.tool(
    'sb_add',
    'Add an element — or a whole NESTED subtree — under a parent. One call builds a complete ' +
      'section: pass children rather than calling this once per node.',
    {
      parent_id: z.string(),
      spec: specSchema,
      index: z.number().int().min(0).optional(),
      dry_run: z.boolean().optional(),
    },
    async ({ parent_id, spec, index, dry_run }) => {
      const d = session.current();
      const { patches, ids } = addSubtree(d, parent_id, spec, index);
      if (dry_run !== false) {
        return text({ dry_run: true, would_add: ids.length, patches: patches.length });
      }
      d.apply(patches);
      await session.save();
      return text({ added: ids, rev: d.rev });
    },
  );

  server.tool(
    'sb_set',
    'Write style, config or specials keys on a node. Style and config are written PER ' +
      'BREAKPOINT by default — a visual quantity written at base vanishes on publish.',
    {
      id: z.string(),
      namespace: z.enum(['style', 'config', 'specials']),
      keys: z.record(z.unknown()),
      breakpoint: z.enum(['desktop', 'laptop', 'tablet', 'mobile']).optional(),
      base: z.boolean().optional(),
      dry_run: z.boolean().optional(),
    },
    async ({ id, namespace, keys, breakpoint, base, dry_run }) => {
      const d = session.current();
      const patches = setKeys(d, id, keys, {
        namespace,
        breakpoint: breakpoint as Breakpoint | undefined,
        base,
      });
      if (dry_run !== false) return text({ dry_run: true, patches, note: RESPONSIVE_NOTICE });
      d.apply(patches);
      await session.save();
      const warn = globalWarning(d.doc, id);
      return text({ set: Object.keys(keys), rev: d.rev, ...(warn ? { warning: warn } : {}) });
    },
  );

  server.tool(
    'sb_move',
    'Move a node to another parent at an index.',
    {
      id: z.string(),
      parent_id: z.string(),
      index: z.number().int().min(0),
      dry_run: z.boolean().optional(),
    },
    async ({ id, parent_id, index, dry_run }) => {
      const d = session.current();
      const patches = moveNode(d, id, parent_id, index);
      if (dry_run !== false) return text({ dry_run: true, patches });
      d.apply(patches);
      await session.save();
      return text({ moved: id, rev: d.rev });
    },
  );

  server.tool(
    'sb_remove',
    'Remove a node and its whole subtree.',
    { id: z.string(), dry_run: z.boolean().optional() },
    async ({ id, dry_run }) => {
      const d = session.current();
      const patches = removeNode(d, id);
      if (dry_run !== false) return text({ dry_run: true, removing: patches.length });
      d.apply(patches);
      await session.save();
      return text({ removed: id, rev: d.rev });
    },
  );
}
