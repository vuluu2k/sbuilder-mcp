import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { request, redact, ApiError } from '../transport/http.js';
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
 * unless the content already OPENS with that tag; scss/typescript output is
 * ALWAYS wrapped (codeinject.wrap has no exemption for them); html goes in
 * verbatim. scss/typescript are COMPILED on write and inject (or serve) their
 * output; a failed build stores the source plus `compileError`, and keeps the
 * previous output only when one existed and the language did not change. json/text are never injected — placement `none` only — and an
 * ENABLED SITE-WIDE `none` row is served at `/_wb/code/<name>` on the store host.
 */
const LANGUAGES = ['html', 'css', 'javascript', 'scss', 'typescript', 'json', 'text'] as const;
const PLACEMENTS = ['head', 'body_start', 'body_end', 'none'] as const;
type Language = (typeof LANGUAGES)[number];
type Placement = (typeof PLACEMENTS)[number];

/** Mirrors the Code Dock's `EXT` (editor/src/features/codedock/paths.ts); test/code-tables.test.ts checks it against WB_REPO. */
export const CODE_EXT: Record<string, Language> = {
  css: 'css', js: 'javascript', mjs: 'javascript', html: 'html', htm: 'html', scss: 'scss',
  ts: 'typescript', tsx: 'typescript', json: 'json', webmanifest: 'json',
  txt: 'text', md: 'text', xml: 'text', svg: 'text', csv: 'text',
};
/** Mirrors Go `codefiles.DefaultPlacement` / paths.ts `DEFAULT_PLACEMENT`. */
export const CODE_DEFAULT_PLACEMENT: Record<Language, Placement> = {
  html: 'body_end', css: 'head', javascript: 'body_end', scss: 'head',
  typescript: 'body_end', json: 'none', text: 'none',
};
/**
 * A known extension names the language; NO extension stays javascript ("Analytics tag").
 * An UNKNOWN one is refused rather than taken as text (the editor's rule): "Pixel v2.1"
 * would be stored at placement none and never run, where it used to be injected.
 */
function languageFromName(name: string): Language {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  if (!m) return 'javascript';
  const lang = CODE_EXT[m[1].toLowerCase()];
  if (lang) return lang;
  throw new Error(
    `sbuilder: "${name}" ends in an extension sb_code does not recognise (.${m[1]}) — pass language explicitly ` +
      `(${LANGUAGES.join('/')}; "text" stores it as a raw file served at /_wb/code/).`,
  );
}
/** The optimistic-concurrency guard's 409 (codefiles/rest writeErr): the next call re-reads, so re-running is the fix. */
function guarded<T>(p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => {
    if (e instanceof ApiError && e.code === 'code_file_changed') {
      e.message += ' — someone else wrote this file since it was read; re-run this sb_code call (it re-reads first).';
    }
    throw e;
  });
}
/** The tag the server wraps a language's content in; html/json/text are not wrapped. */
const WRAP: Partial<Record<Language, string>> = { css: 'style', scss: 'style', javascript: 'script', typescript: 'script' };

type CodeFile = {
  id: string;
  pageId?: string;
  name: string;
  language: Language;
  placement: Placement;
  content: string;
  enabled: boolean;
  position: number;
  updatedAt?: string;
  /** Server-owned build output of scss/typescript — never sent back. */
  compiled?: string;
  compileError?: string;
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
        'Create infers language from the extension, placement from the language. scss/typescript compile ' +
        'on write (compile_error). json/text: placement "none" only; an enabled site-wide "none" file is served at its url. ' +
        'action:"list" | "set" (no id creates; with id merges the named fields over the stored row) ' +
        '| "remove". Not the custom-code element.',
      inputSchema: {
        action: z.enum(['list', 'set', 'remove']),
        site_id: z.string().optional(),
        id: z.string().optional(),
        page_id: z.string().optional().describe('list: that page\'s files plus site-wide; set: scope to it ("" = site-wide)'),
        name: z.string().optional(),
        language: z.enum(LANGUAGES).optional(),
        placement: z.enum(PLACEMENTS).optional(),
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
        ...(f.compileError ? { compile_error: f.compileError } : {}),
        // Served only when enabled, site-wide, `none` — and for scss/ts only once a build succeeded.
        ...(!f.pageId && f.enabled && f.placement === 'none' && (f.compiled || !(f.language === 'scss' || f.language === 'typescript'))
          ? { url: `/_wb/code/${f.name.split('/').map(encodeURIComponent).join('/')}` }
          : {}),
      });

      if (action === 'list') {
        const q = page_id ? `?pageId=${encodeURIComponent(page_id)}&includeSiteWide=true` : '';
        const got = (await call('GET', base + q)) as { codeFiles?: CodeFile[] };
        return text({ code_files: (got.codeFiles ?? []).map(brief) });
      }

      if (action === 'remove') {
        if (!id) throw new Error('sbuilder: action:"remove" needs id — sb_code action:"list" names them.');
        const item = `${base}/${encodeURIComponent(id)}`;
        const cur = ((await call('GET', item)) as { codeFile?: CodeFile }).codeFile;
        if (!cur) throw new Error(`sbuilder: no code file "${id}" on this site.`);
        // Guarded by the row just read: a 409 instead of deleting someone else's newer edit.
        const path = cur.updatedAt ? `${item}?expectedUpdatedAt=${encodeURIComponent(cur.updatedAt)}` : item;
        if (dry_run !== false) {
          return text({ dry_run: true, would_send: redact({ method: 'DELETE', path }), removes: brief(cur) });
        }
        await guarded(call('DELETE', path));
        return text({ removed: brief(cur) });
      }

      // set
      const given_ = { name, language, placement, content, enabled, position };
      const named = Object.fromEntries(Object.entries(given_).filter(([, v]) => v !== undefined));
      let method: 'POST' | 'PUT';
      let path: string;
      let body: Omit<CodeFile, 'id'>;
      let changes: Record<string, [unknown, unknown]> | undefined;
      /** The stored row sat at none (served raw, never wrapped) — moving it out must be judged. */
      let wasNone = false;
      if (!id) {
        if (!name?.trim() || content === undefined) {
          throw new Error('sbuilder: creating a code file needs name and content (language from the extension, placement from the language).');
        }
        method = 'POST';
        path = base;
        const lang = language ?? languageFromName(name.trim());
        body = {
          pageId: page_id ?? '',
          name: name.trim(),
          language: lang,
          placement: placement ?? CODE_DEFAULT_PLACEMENT[lang],
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
        wasNone = cur.placement === 'none';
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
        // compiled/compileError are the server's build output, never ours to send.
        const { id: _id, compiled: _c, compileError: _e, ...rest } = cur;
        void _id, void _c, void _e;
        // expectedUpdatedAt: the PUT refuses (409) if the row moved since this read.
        body = { ...rest, ...named, ...(cur.updatedAt ? { expectedUpdatedAt: cur.updatedAt } : {}) } as Omit<CodeFile, 'id'>;
      }
      const lang = body.language;
      // Go LanguageAllowsPlacement: the injector has no wrapper for json/text — a 400 otherwise.
      if ((lang === 'json' || lang === 'text') && body.placement !== 'none') {
        throw new Error(
          `sbuilder: a ${lang} file is never injected — pass placement:"none" (an enabled site-wide one is served at /_wb/code/<name>).`,
        );
      }
      // A <script> pasted into a css file, or markup into javascript, would be wrapped
      // again and reach the page as text — say so before it is stored. Only when this
      // call sets content or language: a stored row must stay editable (enable, move).
      const tag = WRAP[lang];
      // The server trims ASCII whitespace only (codeinject.startsWithTag).
      const opens = body.content.replace(/^[ \t\r\n\f]+/, '').slice(0, 8).toLowerCase();
      const checks = content !== undefined || language !== undefined || (wasNone && body.placement !== 'none');
      // scss/ts: compiled at ANY placement and always wrapped, so no leading markup at all —
      // a .tsx opening <script> compiles to React.createElement("script") and throws on every page.
      if (checks && (lang === 'scss' || lang === 'typescript') && opens.startsWith('<')) {
        throw new Error(
          `sbuilder: language "${lang}" is compiled and the platform always wraps the output in <${tag}> — ` +
            `write plain ${lang === 'scss' ? 'SCSS' : 'TypeScript'} with no tags, or use language:"html" for a vendor snippet with its own tags.`,
        );
      }
      // css/javascript at placement none are served raw, never wrapped.
      if (checks && body.placement !== 'none' && tag && opens.startsWith('<') && !opens.startsWith(`<${tag}`)) {
        throw new Error(
          `sbuilder: this content opens with markup but language is "${lang}", which wraps it in ` +
            `<${tag}> — use language:"html" for a vendor snippet with its own tags.`,
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
      const res = (await guarded(call(method, path, body))) as { codeFile?: CodeFile };
      const note = ctx.notices.once('code_live', LIVE_NOTICE);
      // A failed build is stored, not refused — so it leads the answer rather than hiding in the row.
      const { compile_error, ...row } = res.codeFile ? brief(res.codeFile) : { compile_error: undefined };
      // The server keeps the previous output only if one existed and the language did not change.
      const kept = res.codeFile?.compiled
        ? 'source stored, the site keeps the previous build'
        : 'source stored, nothing is served or injected until a build succeeds';
      return text({
        ...(compile_error ? { compile_error: `${compile_error} — ${kept}` } : {}),
        [id ? 'updated' : 'created']: res.codeFile ? row : id ?? null,
        ...(changes ? { changes } : {}),
        ...(note ? { note } : {}),
      });
    },
  );
}
