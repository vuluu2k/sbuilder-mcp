import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text, images } from '../mcp/response.js';
import { BINDING_SOURCES } from '../catalog/elements.generated.js';
import { previewUrl } from '../vision/preview.js';
import { uploadMedia } from '../transport/media.js';
import { request } from '../transport/http.js';
import { shoot, DEFAULT_WIDTHS } from '../vision/shoot.js';
import { measure, MEASURE_NOTICE } from '../vision/measure.js';
import { compactFindings } from '../domains/site/findings.js';
import { reviewField } from './page.js';
import { boxesForResponse, BOXES_FORMAT } from '../vision/boxes.js';

/** Element types whose content comes from the store, not from the document. */
const DATASET_TYPES = new Set([
  'list-dataset',
  'dataset-block',
  'text-dataset',
  'pricing-dataset',
  'media-dataset',
  'collection-media',
  'quantity-dataset',
  'product-variants',
]);
import { RealtimeSocket } from '../transport/socket.js';
import { LiveSession } from '../live/session.js';
import type { Patch } from '../core/patch.js';
import type { PageDoc } from '../domains/site/document.js';
import { refuseAppBlockInterior } from '../domains/site/builder.js';
import { siteToken } from './credentialpick.js';
import type { ToolContext } from './context.js';
import { projectList, MEDIA_FIELDS } from './project.js';
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
  refuseAppBlockInterior(doc, id, 'binding');
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

/**
 * The live socket takes a session JWT only.
 *
 * `server/internal/server/realtime.go:38` refuses API keys, and a rejected
 * socket auth still fires `onopen` — so without this check an API-key-only
 * agent would "join", publish every edit into the void, and never learn why
 * nobody saw them. Every other tool works with the key; this one says so.
 */
export function requireSessionForLive(ctx: ToolContext): () => string {
  if (!ctx.session.loggedIn()) {
    throw new Error(
      'sbuilder: the live-edit room takes a session token only — an API key cannot join. Set ' +
        'SB_EMAIL and SB_PASSWORD and call sb_connect, then sb_live_join. Every other tool ' +
        'works with the key alone.',
    );
  }
  return () => ctx.session.token();
}

export function registerLiveTools(
  server: McpServer,
  ctx: ToolContext,
  session: PageSession,
): void {
  server.registerTool(
    'sb_live_join',
    {
      description:
        "Join the site's live-edit room as a visible peer: every write then appears in any open " +
          'editor as it happens. Always yields, so it is safe beside a human. Needs ' +
          'SB_EMAIL / SB_PASSWORD; the socket refuses API keys.',
      inputSchema: { site_id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ site_id }) => {
      const tokenFn = requireSessionForLive(ctx);
      const wsBase = ctx.base.replace(/^http/, 'ws').replace(/\/$/, '');
      const socket = new RealtimeSocket(
        `${wsBase}/api/realtime/ws?site=${encodeURIComponent(site_id)}`,
        tokenFn,
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

  server.registerTool(
    'sb_look',
    {
      description:
        "Save, render through the platform's own renderer, and return screenshots at desktop, " +
          'tablet and mobile widths, measured boxes for the bands and their children, and any ' +
          'layout defect measured on the render (overflow, overlap, unreadable text). node_id ' +
          'frames one element. Judge your work from these, not from memory.',
      inputSchema: {
      widths: z.array(z.number().int().min(320).max(2560)).optional(),
      with_boxes: z.boolean().optional(),
      box_depth: z
        .number()
        .int()
        .min(1)
        .max(8)
        .optional()
        .describe('Boxes down to this depth in the tree (default 2: bands and their children)'),
      node_id: z
        .string()
        .optional()
        .describe('Frame just this node instead of the whole page — how a designer looks at one card'),
      url: z
        .string()
        .optional()
        .describe('Shoot this address instead of the draft preview — use the PUBLISHED storefront URL to see real store data'),
      format: z
        .enum(['jpeg', 'png'])
        .optional()
        .describe('jpeg (default) is smaller and faster; png for pixel-exact colour'),
    },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ widths, with_boxes, box_depth, node_id, format, url }) => {
      await session.save();
      const { siteId, pageId } = session.location();
      // THE DRAFT PREVIEW THREADS NO STORE DATA. `/_wb/preview` renders the
      // document with an empty scope, so every repeater falls back to its empty
      // state — a product grid looks broken there and is not. Judging a
      // data-driven page by a preview screenshot is how an agent spends an hour
      // fixing a page that was already right. Pass the PUBLISHED storefront
      // address as `url` to see the real thing; it is also the escape hatch when
      // the minted preview origin is unreachable, which a dev host with
      // STOREFRONT_BASE_DOMAIN set and no TLS is.
      const target = url ?? (await previewUrl(ctx, siteId, pageId));
      // The widths are shot in parallel inside one Chrome that stays open for
      // the process; `shoot` keeps them in `widths` order. The format changes
      // bytes and latency only — the client prices an image by its pixel size,
      // so jpeg and png cost the agent the same tokens.
      const shots = await shoot(target, { widths: widths ?? DEFAULT_WIDTHS, node: node_id, format });
      // The boxes feed the presence cursor as well as the agent's own reading.
      session.noteBoxes(shots[0]?.boxes ?? []);
      // The findings ride WITH the picture. Judging a page by eye and judging it
      // by rule are the same act, and separating them is how the second one gets
      // skipped.
      const review = reviewField(ctx, session.current());
      // Measured on the render, not read off the document — a card that spills
      // at 390px is invisible to every check that only reads the tree.
      const visual = node_id ? [] : measure(shots);
      const layout = compactFindings(visual);
      const layoutNotice = visual.length > 0 ? ctx.notices.once('measure', MEASURE_NOTICE) : undefined;
      // The legend rides with the first look only; the shape does not change after.
      const fmt = with_boxes === false ? undefined : ctx.notices.once('boxes', BOXES_FORMAT);
      // Say it ONCE, and only when it can actually mislead: a page with no
      // store-driven element has nothing to be missing from the preview.
      const dataDriven = Object.values(session.current().doc.nodes).some((n) =>
        DATASET_TYPES.has((n as { data: { type: string } }).data.type),
      );
      const previewNote =
        !url && dataDriven
          ? ctx.notices.once(
              'preview-scope',
              'This is the DRAFT PREVIEW, which threads no store data: every repeater renders its ' +
                'empty state there, however correct the page is. Publish and pass the storefront ' +
                'URL as `url` to see real products.',
            )
          : undefined;
      return images(shots.map((s) => ({ dataBase64: s.imageBase64, mimeType: s.mimeType })), {
        widths: shots.map((s) => s.width),
        ...(url ? { shot: url } : {}),
        ...(previewNote ? { preview_note: previewNote } : {}),
        ...(node_id ? { framed: node_id } : {}),
        ...(with_boxes === false
          ? {}
          : {
              boxes: boxesForResponse(session.current().doc, shots[0]?.boxes ?? [], box_depth ?? 2, node_id),
              ...(fmt ? { boxes_format: fmt } : {}),
            }),
        ...review,
        ...(visual.length > 0
          ? {
              layout: layout.findings,
              layout_fixes: layout.fixes,
              ...(layoutNotice ? { layout_notice: layoutNotice } : {}),
            }
          : {}),
      });
    },
  );

  server.registerTool(
    'sb_media_list',
    {
      description:
        "The site's media library. Reuse an image before adding another; search by name, filter " +
          'by type, page with limit/offset.',
      inputSchema: {
      site_id: z.string(),
      search: z.string().optional(),
      media_type: z.string().optional().describe('e.g. "image"'),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
      annotations: { readOnlyHint: true },
    },
    async ({ site_id, search, media_type, limit, offset }) =>
      text(
        projectList(
          await request({
          base: ctx.base,
          method: 'GET',
          path: `/api/sites/${encodeURIComponent(site_id)}/media`,
          token: siteToken(ctx),
          query: { search, mediaType: media_type, limit, offset },
          fetchImpl: ctx.fetchImpl,
        }),
          'assets',
          MEDIA_FIELDS,
        ),
      ),
  );

  server.registerTool(
    'sb_media_upload',
    {
      description:
        'Put an image into the media library and get its URL back, ready for sb_set. Takes a ' +
          'local file path or a URL to fetch. This is the ONLY way to add an image: the upload ' +
          'is multipart, which sb_api_call cannot send.',
      inputSchema: {
      site_id: z.string(),
      path: z.string().optional().describe('A file on this machine'),
      url: z.string().optional().describe('Fetched, then uploaded'),
      name: z.string().optional(),
      folder_id: z.string().optional(),
      dry_run: z.boolean().optional(),
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ site_id, path, url, name, folder_id, dry_run }) => {
      if (!path && !url) throw new Error('sbuilder: give sb_media_upload either a path or a url');
      if (dry_run !== false) {
        return text({
          dry_run: true,
          would_upload: path ?? url,
          into: site_id,
          note: 'Nothing was sent. Re-call with dry_run:false to upload.',
        });
      }
      const asset = await uploadMedia(ctx, site_id, { path, url, name, folderId: folder_id });
      return text({
        asset,
        next: asset.url
          ? `Use it: sb_set id "<node>", namespace specials, keys { "src": ${JSON.stringify(asset.url)} }`
          : 'Uploaded, but the server returned no url — read it back with sb_media_list.',
      });
    },
  );

  server.registerTool(
    'sb_bind',
    {
      description:
        "Bind a node's content to real store data, so the page shows actual products rather than " +
          'placeholder text.',
      inputSchema: {
      id: z.string(),
      source: z
        .string()
        .describe(
          // The full list GROWS with the platform and would push the tool list
          // over its budget on its own; the refusal carries every source, so an
          // unknown one costs one round trip and the schema stays small.
          `e.g. ${BINDING_SOURCES.slice(0, 4).join(', ')}; ${BINDING_SOURCES.length} in all, and a wrong one is refused with the list`,
        ),
      field: z.string().describe('Where the value lands, always "specials.<key>"'),
      dry_run: z.boolean().optional(),
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
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
