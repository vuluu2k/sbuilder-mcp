import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { request, redact } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { siteFor, type ToolContext } from './context.js';
import type { PageSession } from './page.js';

/**
 * The platform's own recovery points for a page — the editor's Versions dialog
 * and history popover (`server/internal/page/rest/rest.go` versions/history).
 *
 * `sb_undo` covers what THIS process wrote; these cover everyone's: a named
 * snapshot taken before a risky change, and the autosave history any save
 * leaves. A restore rewrites the DRAFT, so the open session is re-read after it
 * — otherwise the next write here would be applied to a tree the server has
 * already replaced — and the live page keeps the old copy until a publish.
 */
export function registerPageVersionTools(server: McpServer, ctx: ToolContext, session: PageSession): void {
  server.registerTool(
    'sb_page_version',
    {
      description:
        'A page\'s platform recovery points, everyone\'s edits included (sb_undo covers this ' +
        'process only). action:"list" — named versions and autosave history; "save" {label} — ' +
        'snapshot the current draft; "restore" {version_id | history_id} — put the draft back. ' +
        'Writes are dry runs by default.',
      inputSchema: {
        action: z.enum(['list', 'save', 'restore']),
        site_id: z.string().optional(),
        page_id: z.string().optional().describe('Defaults to the open page'),
        label: z.string().optional(),
        version_id: z.string().optional(),
        history_id: z.string().optional(),
        dry_run: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ action, site_id: given, page_id, label, version_id, history_id, dry_run }) => {
      const siteId = siteFor(ctx, given);
      const open = session.page();
      const pageId = page_id ?? (open?.siteId === siteId ? open.pageId : undefined);
      if (!pageId) throw new Error('sbuilder: sb_page_version needs page_id, or a page opened with sb_page_open.');
      const base = `/api/sites/${encodeURIComponent(siteId)}/pages/${encodeURIComponent(pageId)}`;
      const call = (method: string, path: string, body?: unknown) =>
        request({ base: ctx.base, method, path, token: siteToken(ctx), body, fetchImpl: ctx.fetchImpl });

      if (action === 'list') {
        const [v, h] = await Promise.all([
          call('GET', `${base}/versions?limit=20`) as Promise<{ versions?: Array<Record<string, unknown>>; total?: number }>,
          call('GET', `${base}/history?limit=20`) as Promise<{ history?: Array<Record<string, unknown>> }>,
        ]);
        const pick = (r: Record<string, unknown>) => ({
          id: r.id,
          ...(r.versionNo !== undefined ? { no: r.versionNo } : {}),
          ...(r.label ? { label: r.label } : {}),
          ...(r.isLive ? { live: true } : {}),
          at: r.createdAt,
          ...(r.createdBy ? { by: r.createdBy } : {}),
        });
        return text({
          versions: (v.versions ?? []).map(pick),
          ...(v.total && v.total > (v.versions ?? []).length ? { versions_total: v.total } : {}),
          history: (h.history ?? []).map(pick),
        });
      }

      if (action === 'save') {
        if (!label?.trim()) throw new Error('sbuilder: action:"save" needs label — what this snapshot is before.');
        // No document: the server snapshots the page's CURRENT draft, which is
        // what this session saved — never an unsaved local copy.
        if (dry_run !== false) {
          return text({
            dry_run: true,
            would_send: redact({ method: 'POST', path: `${base}/versions`, body: { label: label.trim() } }),
            next: 'Nothing was sent. Re-call with dry_run:false to take the snapshot.',
          });
        }
        const res = (await call('POST', `${base}/versions`, { label: label.trim() })) as { version?: { id?: string } };
        return text({ saved: { id: res.version?.id ?? null, label: label.trim() } });
      }

      // restore
      if (!version_id === !history_id) {
        throw new Error('sbuilder: action:"restore" needs exactly one of version_id or history_id — action:"list" names them.');
      }
      const path = version_id
        ? `${base}/versions/${encodeURIComponent(version_id)}/restore`
        : `${base}/history/${encodeURIComponent(history_id!)}/restore`;
      if (dry_run !== false) {
        return text({
          dry_run: true,
          would_send: redact({ method: 'POST', path, body: {} }),
          next:
            'Nothing was sent. The restore REPLACES the draft; save a version first if the current ' +
            'draft is worth keeping. Re-call with dry_run:false.',
        });
      }
      await call('POST', path, {});
      const reopened = open?.siteId === siteId && open.pageId === pageId;
      if (reopened) await session.open(siteId, pageId);
      return text({
        restored: version_id ? { version_id } : { history_id },
        ...(reopened ? { session: 're-read — the open page is the restored draft' } : {}),
        next: 'Publish the page: a restore changes the draft, and visitors see the published copy until then.',
      });
    },
  );
}
