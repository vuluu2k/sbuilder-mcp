import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { request, redact, redactSecretBody, ApiError } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { siteFor, type ToolContext } from './context.js';

/**
 * A site's BACKEND FUNCTIONS (`server/internal/functions`, web_builder v1.0.201): author
 * TypeScript/JavaScript served at `/_wb/fn/<slug>` on the store host, run in QuickJS-on-wasm
 * with the site's sealed secrets, its collections and the network. Its own table and its own
 * editor routes (`functions/rest/rest.go`) — NOT a code_files row, so not `sb_code`.
 *
 * Same surface and credential as sb_code: `/api/sites/{siteId}/functions…`, `siteToken`. The
 * gateway gates it on the `functions` RBAC domain, CLOSED BELOW ADMIN for read as well as
 * write — a `wbk_` key needs `functions.read`/`functions.write` scopes AND a minter who is
 * owner/admin, whatever scopes it lists.
 *
 * THE PUT IS A FULL REPLACE (`FunctionInput.function()`; an omitted `enabled` reads as TRUE),
 * so an update reads the row and sends it back whole with `expectedUpdatedAt` — a row that
 * moved answers 409 `function_changed`. `compileError` is server-owned and the compiled bundle
 * never leaves the server. A failed build is STORED, not refused; an update keeps the previous
 * build (`Service.build` returns `prev.Compiled`).
 *
 * SECRETS ARE WRITE-ONLY on the platform (no response field can hold a value) and here: the
 * value goes on the wire and nowhere else — not in a preview, not in a result.
 */
const LANGUAGES = ['typescript', 'javascript'] as const;
/** functions.SlugPattern / SecretKeyPattern, verbatim (the table CHECKs). A leading `_` is a module. */
const SLUG_RE = /^_?[a-z0-9][a-z0-9-]{0,62}$/;
const KEY_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;

type Fn = {
  id: string;
  slug: string;
  language: (typeof LANGUAGES)[number];
  content: string;
  enabled: boolean;
  compileError?: string;
  updatedAt?: string;
};

const OFF =
  'backend functions are switched off on this platform (the operator has not set WB_FUNCTIONS=1) — nothing can list, write or run one here';
const NO_PLAN = "the site's plan grants no function runs (its monthly limit is 0)";
const QUOTA_NOTICE =
  "A test run executes the function for real — its fetches, collection writes and secrets are live — and counts toward the site's monthly function quota (action:\"usage\").";

/** One clear sentence for the refusals an agent cannot fix by retrying differently. */
function explained<T>(p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => {
    if (e instanceof ApiError) {
      // Editor API unwired → 404 functions_disabled; the /api/v1 switch-off → 503 resource_unavailable.
      if (e.code === 'functions_disabled' || e.code === 'resource_unavailable') e.message = `sbuilder: ${OFF}. ${e.message}`;
      else if (e.code === 'function_not_in_plan') e.message = `sbuilder: ${NO_PLAN}. ${e.message}`;
      else if (e.code === 'function_changed') e.message += ' — someone else wrote this function since it was read; re-run this sb_function call (it re-reads first).';
    }
    throw e;
  });
}

function checkSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `sbuilder: slug "${slug}" is refused by the platform — lowercase letters, digits and "-", 1-63 chars, ` +
        'starting with a letter or digit; a leading "_" makes it a MODULE (importable, no route).',
    );
  }
}

const brief = (f: Fn) => ({
  id: f.id,
  slug: f.slug,
  language: f.language,
  enabled: f.enabled,
  chars: f.content.length,
  ...(f.slug.startsWith('_') ? { module: true } : { route: `/_wb/fn/${f.slug}` }),
  ...(f.compileError ? { compile_error: f.compileError } : {}),
});

export function registerFunctionTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'sb_function',
    {
      description:
        'Backend functions: server-side TS/JS at /_wb/fn/<slug> with the site\'s secrets, collections and fetch ' +
        '("_" slug = importable module). Not sb_code. action: list | get | set (no id creates; id merges) ' +
        '| remove (id, or secret key) | test (method/path/query/headers/cookies/body) | logs | usage ' +
        '| secret (no key lists; key+value sets). Owner/admin only.',
      inputSchema: {
        action: z.enum(['list', 'get', 'set', 'remove', 'test', 'logs', 'usage', 'secret']),
        site_id: z.string().optional(),
        id: z.string().optional().describe('logs: filters to it'),
        slug: z.string().optional(),
        language: z.enum(LANGUAGES).optional(),
        content: z.string().optional(),
        enabled: z.boolean().optional(),
        method: z.string().optional(),
        path: z.string().optional(),
        query: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
        cookies: z.record(z.string(), z.string()).optional(),
        body: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        key: z.string().optional(),
        value: z.string().optional(),
        dry_run: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (a) => {
      const base = `/api/sites/${encodeURIComponent(siteFor(ctx, a.site_id))}/functions`;
      const token = siteToken(ctx);
      const call = (method: string, path: string, body?: unknown, query?: Record<string, string | number | undefined>) =>
        explained(request({ base: ctx.base, method, path, token, body, query, fetchImpl: ctx.fetchImpl }));
      const dry = a.dry_run !== false;
      const item = (id: string) => `${base}/${encodeURIComponent(id)}`;
      const read = async (id: string) => {
        const f = ((await call('GET', item(id))) as { function?: Fn }).function;
        if (!f) throw new Error(`sbuilder: no function "${id}" on this site — action:"list" names them.`);
        return f;
      };
      const needId = (what: string) => {
        if (!a.id) throw new Error(`sbuilder: action:"${what}" needs id — action:"list" names them.`);
        return a.id;
      };
      const needKey = (key: string) => {
        if (!KEY_RE.test(key)) throw new Error(`sbuilder: secret key "${key}" is refused by the platform — UPPER_SNAKE, 1-64 chars (^[A-Z_][A-Z0-9_]{0,63}$).`);
        return `${base}/secrets/${encodeURIComponent(key)}`;
      };

      switch (a.action) {
        case 'list': {
          const got = (await call('GET', base)) as { functions?: Fn[] };
          return text({ functions: (got.functions ?? []).map(brief) });
        }
        case 'get': {
          const f = await read(needId('get'));
          return text({ function: { ...brief(f), content: f.content, updatedAt: f.updatedAt } });
        }
        case 'usage': {
          const u = ((await call('GET', `${base}/usage`)) as { usage?: { limit?: number } }).usage;
          return text({ usage: u, ...(u?.limit === 0 ? { note: NO_PLAN } : {}) });
        }
        case 'logs': {
          const got = (await call('GET', `${base}/invocations`, undefined, { functionId: a.id, limit: a.limit })) as {
            invocations?: Array<Record<string, unknown>>;
            total?: number;
          };
          // Empty console/error and the memory figure are noise on a page of 50.
          const rows = (got.invocations ?? []).map(({ memoryBytes, console: out, error, ...r }) => {
            void memoryBytes;
            return { ...r, ...(out ? { console: out } : {}), ...(error ? { error } : {}) };
          });
          return text({ invocations: rows, total: got.total });
        }
        case 'secret': {
          if (!a.key) {
            const got = (await call('GET', `${base}/secrets`)) as { secrets?: unknown[] };
            return text({ secrets: got.secrets ?? [] });
          }
          const path = needKey(a.key);
          if (a.value === undefined) {
            throw new Error('sbuilder: action:"secret" with a key needs value to set it — to delete it use action:"remove" with key.');
          }
          // NEVER the value: the preview carries a marker, the result is the platform's {key, updatedAt}.
          if (dry) return text({ dry_run: true, would_send: { method: 'PUT', path, body: redactSecretBody(path, { value: a.value }) } });
          const got = (await call('PUT', path, { value: a.value })) as { secret?: unknown };
          return text({ secret: got.secret ?? null });
        }
        case 'remove': {
          if (a.key && a.id) throw new Error('sbuilder: action:"remove" takes id (a function) OR key (a secret), not both — say which one to delete.');
          if (a.key) {
            const path = needKey(a.key);
            if (dry) return text({ dry_run: true, would_send: { method: 'DELETE', path } });
            await call('DELETE', path);
            return text({ removed_secret: a.key });
          }
          const cur = await read(needId('remove'));
          if (dry) return text({ dry_run: true, would_send: { method: 'DELETE', path: item(cur.id) }, removes: brief(cur) });
          await call('DELETE', item(cur.id));
          return text({ removed: brief(cur) });
        }
        case 'test': {
          const path = `${item(needId('test'))}/test`;
          const body = { method: a.method ?? 'GET', path: a.path, query: a.query, headers: a.headers, cookies: a.cookies, body: a.body };
          if (dry) {
            return text({
              dry_run: true,
              would_send: redact({ method: 'POST', path, body }),
              ...(ctx.notices.peek('function_quota', QUOTA_NOTICE) ? { note: QUOTA_NOTICE } : {}),
            });
          }
          const r = ((await call('POST', path, body)) as { result?: Record<string, unknown> }).result ?? {};
          const note = ctx.notices.once('function_quota', QUOTA_NOTICE);
          const { memoryBytes, ...result } = r;
          void memoryBytes;
          return text({ result, ...(note ? { note } : {}) });
        }
        case 'set':
          break;
      }

      // set
      const named = Object.fromEntries(
        Object.entries({ slug: a.slug, language: a.language, content: a.content, enabled: a.enabled }).filter(([, v]) => v !== undefined),
      );
      if (a.slug !== undefined) checkSlug(a.slug);
      let method: 'POST' | 'PUT';
      let path: string;
      let body: Record<string, unknown>;
      let changes: Record<string, [unknown, unknown]> | undefined;
      if (!a.id) {
        if (!a.slug || a.content === undefined) throw new Error('sbuilder: creating a function needs slug and content (language defaults to typescript).');
        method = 'POST';
        path = base;
        body = { slug: a.slug, language: a.language ?? 'typescript', content: a.content, enabled: a.enabled ?? true };
      } else {
        const cur = await read(a.id);
        changes = {};
        for (const [k, v] of Object.entries(named)) {
          const was = cur[k as keyof Fn];
          if (was !== v) changes[k] = k === 'content' ? [`${String(was).length} chars`, `${String(v).length} chars`] : [was, v];
        }
        if (Object.keys(changes).length === 0) throw new Error('sbuilder: nothing to change — every field given already holds that value.');
        method = 'PUT';
        path = item(cur.id);
        // WHOLE ROW BACK (the PUT replaces), never the server-owned fields.
        body = {
          slug: cur.slug, language: cur.language, content: cur.content, enabled: cur.enabled, ...named,
          ...(cur.updatedAt ? { expectedUpdatedAt: cur.updatedAt } : {}),
        };
      }
      if (dry) {
        return text({
          dry_run: true,
          would_send: redact({ method, path, body: { ...body, content: `${String(body.content).length} chars` } }),
          ...(changes ? { changes } : {}),
        });
      }
      const f = ((await call(method, path, body)) as { function?: Fn }).function;
      const kept = a.id ? 'source stored; the route keeps serving the previous build, if one existed' : 'source stored; the route serves nothing until a build succeeds';
      const { compile_error, ...row } = f ? brief(f) : { compile_error: undefined };
      return text({
        ...(compile_error ? { compile_error: `${compile_error} — ${kept}` } : {}),
        [a.id ? 'updated' : 'created']: f ? row : a.id ?? null,
        ...(changes ? { changes } : {}),
      });
    },
  );
}
