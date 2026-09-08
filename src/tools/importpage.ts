import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { capture } from '../vision/capture.js';
import { uploadMedia } from '../transport/media.js';
import { addSubtree } from '../domains/site/builder.js';
import {
  toSpecs,
  tokensFromPage,
  imageSources,
  rehostImages,
  type Captured,
} from '../domains/site/importmap.js';
import { siteFor, type ToolContext } from './context.js';
import type { PageSession } from './page.js';

/**
 * BRING A PAGE FROM ELSEWHERE ONTO THIS SITE.
 *
 * Not a clone, on purpose. The platform HAS an escape hatch that would produce
 * one — `custom-code` embeds raw markup verbatim — and using it would give the
 * merchant a Store Builder page that no inspector can edit, that has no
 * responsive cascade, that binds to nothing, and that carries somebody else's
 * CSS and scripts. Visually closest, structurally a dead end.
 *
 * So the import is a TRANSLATION: the source's structure and content, rendered
 * with THIS site's own tokens, as real elements the merchant can then edit.
 * Rule 0 of the design skill is the reason — a section that answers the accent,
 * the ink and the radius differently does not read as a new section, it reads as
 * a different website, and importing from elsewhere is the one operation that
 * threatens to do that on purpose.
 *
 * The tokens are read off the OPEN PAGE rather than asked for, because that is
 * the same thing rule 0 tells a person to do: `sb_node_read` a heading, a
 * button, a section, and reuse those exact values.
 */
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
      // caller to re-run the import hoping for a different answer. Measured: a
      // real import lost all four images to `only image, video, or font
      // (woff2/woff/ttf/otf) uploads are supported` — the platform refusing SVG,
      // whose own sentinel exists precisely so a caller can be told "convert it
      // first". The count alone said none of that.
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

      const added: string[] = [];
      for (const spec of specs) {
        const { patches, ids } = addSubtree(doc, doc.doc.root_node_id, spec);
        session.applyAndPublish(patches);
        added.push(ids[0]);
      }
      await session.save();

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
}
