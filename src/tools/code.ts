import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { request, redact } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { siteFor, type ToolContext } from './context.js';

/**
 * A site's CUSTOM CODE — the editor's "Mã tuỳ chỉnh" for the site and per page
 * (`server/internal/codefiles`). This is where a tracking pixel, an analytics
 * tag or a chat widget goes: a snippet injected into the served document at
 * head, body start or body end. Not `custom-code` the ELEMENT, which renders
 * inside the page body where the canvas can see it.
 *
 * THE PUT IS A FULL REPLACE (`store.go Update` writes the body wholesale), so a
 * partial body blanks `content` — an update here always reads the row first and
 * sends it back whole with only the named fields moved.
 *
 * INJECTED AT SERVE TIME (`codeinject.go`), so a write is live on the next
 * request without a publish. css is wrapped in <style>, javascript in <script>,
 * unless the content already OPENS with that tag; html goes in verbatim.
 */
type CodeFile = {
  id: string;
  pageId?: string;
  name: string;
  language: 'html' | 'css' | 'javascript';
  placement: 'head' | 'body_start' | 'body_end';
  content: string;
  enabled: boolean;
  position: number;
};

const LIVE_NOTICE =
  'Custom code is injected when a page is served — it is live on the next request, no publish needed. ' +
  'It runs unsandboxed on every page it applies to.';

export function registerCodeTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'sb_code',
    {
      description:
        'The site\'s custom code files — tracking pixels, analytics, chat widgets, site-wide CSS — ' +
        'injected at head, body_start or body_end of every page (no page_id) or one page. ' +
        'action:"list" | "set" (no id creates; with id merges the named fields over the stored row) ' +
        '| "remove". Not the custom-code element.',
      inputSchema: {
        action: z.enum(['list', 'set', 'remove']),
        site_id: z.string().optional(),
        id: z.string().optional(),
        page_id: z.string().optional().describe('list: that page\'s files plus site-wide; set: scope to it ("" = site-wide)'),
        name: z.string().optional(),
        language: z.enum(['html', 'css', 'javascript']).optional(),
        placement: z.enum(['head', 'body_start', 'body_end']).optional(),
        content: z.string().optional(),
        enabled: z.boolean().optional(),
        position: z.number().int().min(0).optional(),
        dry_run: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ action, site_id: given, id, page_id, name, language, placement, content, enabled, position, dry_run }) => {
      const base = `/api/sites/${encodeURIComponent(siteFor(ctx, given))}/code-files`;
      const token = siteToken(ctx);
      const call = (method: string, path: string, body?: unknown) =>
        request({ base: ctx.base, method, path, token, body, fetchImpl: ctx.fetchImpl });
      const brief = (f: CodeFile) => ({
        id: f.id,
        scope: f.pageId ? `page ${f.pageId}` : 'site',
        name: f.name,
        language: f.language,
        placement: f.placement,
        enabled: f.enabled,
        chars: f.content.length,
      });

      if (action === 'list') {
        const q = page_id ? `?pageId=${encodeURIComponent(page_id)}&includeSiteWide=true` : '';
        const got = (await call('GET', base + q)) as { codeFiles?: CodeFile[] };
        return text({ code_files: (got.codeFiles ?? []).map(brief) });
      }

      if (action === 'remove') {
        if (!id) throw new Error('sbuilder: action:"remove" needs id — sb_code action:"list" names them.');
        const path = `${base}/${encodeURIComponent(id)}`;
        const cur = ((await call('GET', path)) as { codeFile?: CodeFile }).codeFile;
        if (!cur) throw new Error(`sbuilder: no code file "${id}" on this site.`);
        if (dry_run !== false) {
          return text({ dry_run: true, would_send: redact({ method: 'DELETE', path }), removes: brief(cur) });
        }
        await call('DELETE', path);
        return text({ removed: brief(cur) });
      }

      // set
      const given_ = { name, language, placement, content, enabled, position };
      const named = Object.fromEntries(Object.entries(given_).filter(([, v]) => v !== undefined));
      let method: 'POST' | 'PUT';
      let path: string;
      let body: Omit<CodeFile, 'id'>;
      let changes: Record<string, [unknown, unknown]> | undefined;
      if (!id) {
        if (!name?.trim() || content === undefined) {
          throw new Error('sbuilder: creating a code file needs name and content (language default javascript, placement body_end).');
        }
        method = 'POST';
        path = base;
        body = {
          pageId: page_id ?? '',
          name: name.trim(),
          language: language ?? 'javascript',
          placement: placement ?? 'body_end',
          content,
          enabled: enabled ?? true,
          position: position ?? 0,
        };
      } else {
        // page_id moves the file between scopes ('' = site-wide); the PUT carries it.
        if (page_id !== undefined) named.pageId = page_id;
        path = `${base}/${encodeURIComponent(id)}`;
        const cur = ((await call('GET', path)) as { codeFile?: CodeFile }).codeFile;
        if (!cur) throw new Error(`sbuilder: no code file "${id}" on this site.`);
        changes = {};
        for (const [k, v] of Object.entries(named)) {
          const was = k === 'pageId' ? cur.pageId ?? '' : cur[k as keyof CodeFile];
          if (was !== v) changes[k] = [k === 'content' ? `${String(was).length} chars` : was, k === 'content' ? `${String(v).length} chars` : v];
        }
        if (Object.keys(changes).length === 0) {
          throw new Error('sbuilder: nothing to change — every field given already holds that value.');
        }
        method = 'PUT';
        // WHOLE ROW BACK: the PUT replaces wholesale.
        const { id: _id, ...rest } = cur;
        void _id;
        body = { ...rest, ...named } as Omit<CodeFile, 'id'>;
      }
      // A <script> pasted into a css file, or markup into javascript, would be wrapped
      // again and reach the page as text — say so before it is stored. Only when this
      // call sets content or language: a stored row must stay editable (enable, move).
      const lang = body.language;
      // The server trims ASCII whitespace only (codeinject.startsWithTag).
      const opens = body.content.replace(/^[ \t\r\n\f]+/, '').slice(0, 8).toLowerCase();
      if ((content !== undefined || language !== undefined) && lang !== 'html' && opens.startsWith('<') && !opens.startsWith(lang === 'css' ? '<style' : '<script')) {
        throw new Error(
          `sbuilder: this content opens with markup but language is "${lang}", which wraps it in ` +
            `<${lang === 'css' ? 'style' : 'script'}> — use language:"html" for a vendor snippet with its own tags.`,
        );
      }
      if (dry_run !== false) {
        return text({
          dry_run: true,
          would_send: redact({ method, path, body: { ...body, content: `${body.content.length} chars` } }),
          ...(changes ? { changes } : {}),
          ...(ctx.notices.peek('code_live', LIVE_NOTICE) ? { note: LIVE_NOTICE } : {}),
        });
      }
      const res = (await call(method, path, body)) as { codeFile?: CodeFile };
      const note = ctx.notices.once('code_live', LIVE_NOTICE);
      return text({
        [id ? 'updated' : 'created']: res.codeFile ? brief(res.codeFile) : id ?? null,
        ...(changes ? { changes } : {}),
        ...(note ? { note } : {}),
      });
    },
  );
}
