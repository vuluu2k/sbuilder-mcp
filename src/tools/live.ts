import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text, images } from '../mcp/response.js';
import { BINDING_SOURCES } from '../catalog/elements.generated.js';
import { previewUrl } from '../vision/preview.js';
import { shoot, DEFAULT_WIDTHS } from '../vision/shoot.js';
import { RealtimeSocket } from '../transport/socket.js';
import { LiveSession } from '../live/session.js';
import type { Patch } from '../core/patch.js';
import type { PageDoc } from '../domains/site/document.js';
import { siteToken } from './credentialpick.js';
import type { ToolContext } from './context.js';
import { reviewDesign, REVIEW_NOTICE } from '../domains/site/review.js';
import type { PageSession } from './page.js';

/**
 * Bind a node's content to real store data.
 *
 * Two validations, and both close a SILENT no-op:
 *
 *  - the `source` must be one the renderer's scope actually provides. An unknown
 *    one resolves to nothing and the element renders its own placeholder, which
 *    looks exactly like "the data has not loaded yet".
 *  - the `field` must live under `specials`. `applyBindings` (schema/src/binding.ts)
 *    reads the namespace off the field and `continue`s on anything else — so a
 *    `style.color` binding is stored, saved, published, and ignored forever.
 */
export function bindNode(doc: PageDoc, id: string, source: string, field: string): Patch[] {
  const node = doc.node(id) as unknown as { bindings: unknown[] };
  if (!BINDING_SOURCES.includes(source)) {
    throw new Error(
      `sbuilder: "${source}" is not a binding source the renderer provides, so the binding ` +
        `would render as a placeholder forever. Valid sources: ${BINDING_SOURCES.join(', ')}.`,
    );
  }
  const dot = field.indexOf('.');
  if (dot < 0 || field.slice(0, dot) !== 'specials' || !field.slice(dot + 1)) {
    throw new Error(
      `sbuilder: a binding field must be "specials.<key>", not "${field}". The renderer ignores ` +
        'every other namespace, so the binding would be stored and never applied.',
    );
  }
  return [
    {
      op: 'insert',
      path: ['nodes', id, 'bindings'],
      index: node.bindings.length,
      value: { id: randomBytes(6).toString('hex'), source, field },
    },
  ];
}

export function registerLiveTools(
  server: McpServer,
  ctx: ToolContext,
  session: PageSession,
): void {
  server.tool(
    'sb_live_join',
    "Join the editor's live-edit room for this site, as a visible peer. Once joined, every " +
      'sb_add / sb_set / sb_move / sb_remove / sb_bind also goes out as a live op, so anyone ' +
      'with the editor open watches the page assemble. Safe alongside a human: this client ' +
      'always yields — it never answers a snapshot request and re-pulls on any divergence.',
    { site_id: z.string() },
    async ({ site_id }) => {
      const wsBase = ctx.base.replace(/^http/, 'ws').replace(/\/$/, '');
      const socket = new RealtimeSocket(
        `${wsBase}/api/realtime/ws?site=${encodeURIComponent(site_id)}`,
        () => siteToken(ctx),
      );
      const live = new LiveSession(socket, {
        onRemote: (patches) => session.applyRemote(patches),
        onDesync: (reason) => session.markStale(reason),
      });
      socket.connect();
      session.attachLive(live);
      return text({
        joined: site_id,
        note: 'Edits now publish to the room as they are made. Call sb_page_open next.',
      });
    },
  );

  server.tool(
    'sb_look',
    "Save the open page, render it through the platform's own renderer, and return " +
      'screenshots at desktop, tablet and mobile widths — plus the measured bounding box of ' +
      'every node. Pass node_id to frame ONE element instead of the whole page. Judge your ' +
      'own work from these rather than guessing.',
    {
      widths: z.array(z.number().int().min(320).max(2560)).optional(),
      with_boxes: z.boolean().optional(),
      node_id: z
        .string()
        .optional()
        .describe('Frame just this node instead of the whole page — how a designer looks at one card'),
    },
    async ({ widths, with_boxes, node_id }) => {
      await session.save();
      const { siteId, pageId } = session.location();
      const url = await previewUrl(ctx, siteId, pageId);
      const shots = await shoot(url, { widths: widths ?? DEFAULT_WIDTHS, node: node_id });
      // The boxes feed the presence cursor as well as the agent's own reading.
      session.noteBoxes(shots[0]?.boxes ?? []);
      // The findings ride WITH the picture. Judging a page by eye and judging it
      // by rule are the same act, and separating them is how the second one gets
      // skipped.
      const findings = reviewDesign(session.current());
      return images(shots.map((s) => ({ dataBase64: s.pngBase64 })), {
        widths: shots.map((s) => s.width),
        ...(node_id ? { framed: node_id } : {}),
        ...(with_boxes === false ? {} : { boxes: shots[0]?.boxes ?? [] }),
        ...(findings.length > 0 ? { findings, findings_notice: REVIEW_NOTICE } : {}),
      });
    },
  );

  server.tool(
    'sb_bind',
    "Bind a node's content to real store data, so the page shows actual products rather than " +
      'placeholder text.',
    {
      id: z.string(),
      source: z.string().describe(`One of: ${BINDING_SOURCES.join(', ')}`),
      field: z.string().describe('Where the value lands, always "specials.<key>"'),
      dry_run: z.boolean().optional(),
    },
    async ({ id, source, field, dry_run }) => {
      const d = session.current();
      const patches = bindNode(d, id, source, field);
      if (dry_run !== false) return text({ dry_run: true, patches });
      session.applyAndPublish(patches);
      await session.save();
      return text({ bound: id, source, field, rev: d.rev });
    },
  );
}
