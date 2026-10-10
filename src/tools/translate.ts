import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { request, redact } from '../transport/http.js';
import { loadSource } from '../transport/pages.js';
import { collectPageEntries, rowStatus, sourceHash, translationField, type TrNode } from '../domains/site/translate.js';
import { siteToken } from './credentialpick.js';
import { siteFor, type ToolContext } from './context.js';
import { LOCALE_TAG } from './theme.js';
import type { PageSession } from './page.js';

/**
 * THE EDITOR'S MULTILINGUAL FLOW, as one tool.
 *
 * Every /translations route was already reachable through `sb_api_call`, and
 * that was not enough: a page translation needs the editor's collector
 * (`editor/src/features/translations/pageFill.ts`), its FNV source fingerprint
 * and a whole-settings merge to enable a locale — three pieces of client logic
 * an agent had to rebuild by hand, and each one fails silently when it is
 * rebuilt slightly wrong (a row the applier cannot address, every row OUTDATED,
 * a settings PUT that wipes the store's configuration).
 *
 * The page is read COMPOSED — globals and overlays included — because that is
 * what the editor's page fill collects from (`getSource(...).document.nodes`).
 */

const REVIEW_GATE =
  'Only source "human" rows are served to shoppers. Machine rows (the default here, and everything ' +
  'action:"auto" writes) stay hidden until action:"review" approves them, or until the site turns on ' +
  'settings.translations.autoApprove. Send source:"human" only for text a person has read.';

const BATCH = 40; // the editor's fill batch: under the provider's per-call character cap
const ROWS = 60; // page rows per answer; `offset` pages through the rest
const IDS = 200; // node ids per batched read

type Settings = Record<string, unknown>;

/** sitelang.DefaultOf + sitelocales.Resolve: the default first, then the list, lowercased and deduped. */
function localesOf(s: Settings): { def: string; locales: string[] } {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const list = Array.isArray(s.locales) ? s.locales.map(str).filter((l) => l && LOCALE_TAG.test(l)) : [];
  const def = (str(s.defaultLocale) || str(s.locale) || list[0] || 'vi').toLowerCase();
  return { def, locales: [...new Set([def, ...list.map((l) => l.toLowerCase())])] };
}

export function registerTranslateTools(server: McpServer, ctx: ToolContext, session: PageSession): void {
  server.registerTool(
    'sb_translate',
    {
      description:
        'Multilingual, as the editor does it. status | locales (add/remove) | page (rows: missing, done, ' +
        'outdated) | write (node id+field+value; registry fields only) | auto (machine-fill missing) | review (approve).',
      inputSchema: {
        action: z.enum(['status', 'locales', 'page', 'write', 'auto', 'review']),
        site_id: z.string().optional(),
        locale: z.string().optional(),
        page_id: z.string().optional(),
        add: z.array(z.string()).optional(),
        remove: z.array(z.string()).optional(),
        entries: z
          .array(z.object({ entity_id: z.string(), field: z.string(), value: z.string().optional(), entity_type: z.string().optional() }))
          .optional(),
        all: z.boolean().optional(),
        source: z.enum(['human', 'machine']).optional(),
        from: z.string().optional(),
        offset: z.number().int().min(0).optional(),
        dry_run: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      const site = siteFor(ctx, args.site_id);
      const base = `/api/sites/${encodeURIComponent(site)}`;
      const token = siteToken(ctx);
      const call = (method: string, path: string, opts: { body?: unknown; query?: Record<string, string> } = {}) =>
        request({ base: ctx.base, method, path: base + path, token, fetchImpl: ctx.fetchImpl, ...opts });
      const readSettings = async (): Promise<Settings> =>
        ((await call('GET', '/settings')) as { settings?: Settings | null })?.settings ?? {};
      const need = <T>(v: T | undefined, name: string): T => {
        if (v === undefined || v === '') throw new Error(`sbuilder: action "${args.action}" needs ${name}.`);
        return v;
      };
      const locale = () => {
        const l = need(args.locale, 'locale').trim().toLowerCase();
        if (!LOCALE_TAG.test(l)) throw new Error(`sbuilder: "${args.locale}" is not a language tag — use one like "en" or "en-gb".`);
        return l;
      };
      const pageNodes = async (): Promise<Record<string, TrNode>> => {
        const pageId = need(args.page_id, 'page_id');
        const open = session.page();
        if (open && open.siteId === site && open.pageId === pageId) return session.current().doc.nodes as Record<string, TrNode>;
        return (((await loadSource(ctx, site, pageId)).document as { nodes?: object } | null)?.nodes ?? {}) as Record<string, TrNode>;
      };
      const enabledNote = (l: string, s: Settings) =>
        localesOf(s).locales.includes(l)
          ? {}
          : { locale_not_enabled: `${l} is not in settings.locales, so no storefront serves it — sb_translate action:"locales" add:["${l}"].` };
      const gate = (dry: boolean) => {
        const n = dry ? ctx.notices.peek('translate_review_gate', REVIEW_GATE) : ctx.notices.once('translate_review_gate', REVIEW_GATE);
        return n ? { note: n } : {};
      };
      const dry = args.dry_run !== false;

      switch (args.action) {
        case 'status': {
          const s = await readSettings();
          const { def, locales } = localesOf(s);
          const auto = (await call('GET', '/translations/auto')) as { available?: boolean; budgetRemaining?: number };
          const progress = args.locale
            ? ((await call('GET', '/translations/progress', { query: { locale: locale() } })) as { counts?: unknown[] }).counts ?? []
            : undefined;
          const tr = s.translations as { autoApprove?: unknown } | undefined;
          return text({
            default: def,
            locales,
            auto_approve: tr?.autoApprove === true,
            auto_translate: { available: auto?.available === true, ...(auto?.budgetRemaining !== undefined ? { budget_remaining: auto.budgetRemaining } : {}) },
            ...(progress ? { progress } : {}),
          });
        }

        case 'locales': {
          const norm = (l: string) => {
            const t = l.trim().toLowerCase();
            if (!LOCALE_TAG.test(t)) throw new Error(`sbuilder: "${l}" is not a language tag.`);
            return t;
          };
          const add = (args.add ?? []).map(norm);
          const remove = (args.remove ?? []).map(norm);
          if (!add.length && !remove.length) throw new Error('sbuilder: action "locales" needs add or remove.');
          const s = await readSettings();
          const { def, locales: before } = localesOf(s);
          if (remove.includes(def)) {
            throw new Error(`sbuilder: ${def} is the site default and cannot be removed; change settings.locale first (sb_theme locale).`);
          }
          const after = [...new Set([...before, ...add])].filter((l) => !remove.includes(l));
          if (JSON.stringify(after) === JSON.stringify(before)) throw new Error(`sbuilder: nothing to change — locales are already ${before.join(', ')}.`);
          // PUT REPLACES THE WHOLE SETTINGS DOCUMENT: send the read copy back with only `locales` moved.
          const body = { settings: { ...s, locales: after } };
          if (dry) return text({ dry_run: true, would_send: redact({ method: 'PUT', path: `${base}/settings`, body: { settings: { locales: after, '…': 'every other key as read' } } }), before, after });
          await call('PUT', '/settings', { body });
          return text({ locales: after, before });
        }

        case 'page': {
          const l = locale();
          const nodes = await pageNodes();
          const rows = collectPageEntries(nodes);
          const ids = [...new Set(rows.map((r) => r.entityId))];
          const byEntity: Record<string, Record<string, string>> = {};
          const hashes: Record<string, Record<string, string>> = {};
          for (let i = 0; i < ids.length; i += IDS) {
            const got = (await call('GET', '/translations', {
              query: { locale: l, entityType: 'node', entityIds: ids.slice(i, i + IDS).join(',') },
            })) as { byEntity?: typeof byEntity; hashes?: typeof hashes };
            Object.assign(byEntity, got?.byEntity ?? {});
            Object.assign(hashes, got?.hashes ?? {});
          }
          const joined = rowStatus(rows, byEntity, hashes);
          const counts = { rows: joined.length, missing: 0, done: 0, outdated: 0 };
          for (const r of joined) counts[r.status]++;
          // Work first: what needs translating, then what is done.
          const order = { missing: 0, outdated: 1, done: 2 };
          const sorted = joined.sort((a, b) => order[a.status] - order[b.status]);
          const at = args.offset ?? 0;
          const cut = (s: string) => (s.length > 200 ? s.slice(0, 200) + '…' : s);
          return text({
            page_id: args.page_id,
            locale: l,
            counts,
            rows: sorted.slice(at, at + ROWS).map((r) => ({
              id: r.entityId,
              field: r.field,
              status: r.status,
              text: cut(r.text),
              ...(r.value !== undefined ? { value: cut(r.value) } : {}),
            })),
            ...(sorted.length > at + ROWS ? { next_offset: at + ROWS } : {}),
            ...enabledNote(l, await readSettings()),
          });
        }

        case 'write': {
          const l = locale();
          const entries = need(args.entries, 'entries');
          if (!entries.length || entries.length > 500) throw new Error('sbuilder: write takes 1–500 entries per call.');
          const nodes = await pageNodes();
          const errors: string[] = [];
          const out = entries.map((e) => {
            const hit = translationField(nodes, e.entity_id, e.field);
            if ('error' in hit) errors.push(hit.error);
            if (e.value === undefined) errors.push(`${e.entity_id}.${e.field}: no value`);
            return {
              locale: l,
              entityType: 'node',
              entityId: e.entity_id,
              field: e.field,
              value: e.value ?? '',
              source: args.source ?? 'machine',
              sourceHash: 'text' in hit ? sourceHash(hit.text) : '',
            };
          });
          // ALL OR NOTHING, like the route: one bad row would otherwise land the rest.
          if (errors.length) throw new Error(`sbuilder: nothing written — ${errors.join('; ')}`);
          const body = { entries: out };
          if (dry) return text({ dry_run: true, would_send: redact({ method: 'PUT', path: `${base}/translations`, body }), ...gate(true) });
          const res = (await call('PUT', '/translations', { body })) as { written?: number };
          return text({ written: res?.written ?? out.length, source: args.source ?? 'machine', ...(args.source === 'human' ? {} : gate(false)) });
        }

        case 'auto': {
          const l = locale();
          const s = await readSettings();
          const from = (args.from?.trim().toLowerCase() || localesOf(s).def);
          if (from === l) throw new Error(`sbuilder: ${l} is the source language; pick another target or pass from.`);
          const rows = collectPageEntries(await pageNodes(), { machine: true }).map((r) => ({
            entityType: 'node',
            entityId: r.entityId,
            field: r.field,
            text: r.text,
            sourceHash: sourceHash(r.text),
          }));
          if (!rows.length) throw new Error('sbuilder: this page has no translatable text.');
          const avail = (await call('GET', '/translations/auto')) as { available?: boolean };
          if (avail?.available !== true) {
            throw new Error('sbuilder: no machine translator is configured on this deployment — write translations with action:"write".');
          }
          const batches = Math.ceil(rows.length / BATCH);
          if (dry) {
            return text({
              dry_run: true,
              would_send: redact({ method: 'POST', path: `${base}/translations/auto`, body: { locale: l, from, entries: rows.slice(0, 3) } }),
              rows: rows.length,
              batches,
              ...enabledNote(l, s),
              ...gate(true),
            });
          }
          let written = 0;
          let skipped = 0;
          for (let i = 0; i < rows.length; i += BATCH) {
            try {
              const res = (await call('POST', '/translations/auto', { body: { locale: l, from, entries: rows.slice(i, i + BATCH) } })) as {
                translations?: unknown[];
                skipped?: number;
              };
              written += res?.translations?.length ?? 0;
              skipped += res?.skipped ?? 0;
            } catch (e) {
              // What landed stays written; running again continues (the route fills only what is missing).
              return text({ written, skipped, stopped: (e as Error).message, sent: i, rows: rows.length });
            }
          }
          return text({ written, skipped, rows: rows.length, ...enabledNote(l, s), ...gate(false) });
        }

        case 'review': {
          const l = locale();
          let body: Record<string, unknown>;
          if (args.all) body = { locale: l, all: true };
          else if (args.entries?.length) {
            if (args.entries.length > 500) throw new Error('sbuilder: review takes at most 500 entries per call; use all:true for the whole queue.');
            body = {
              locale: l,
              entries: args.entries.map((e) => ({ entityType: e.entity_type ?? 'node', entityId: e.entity_id, field: e.field })),
            };
          } else throw new Error('sbuilder: action "review" needs entries or all:true.');
          if (dry) return text({ dry_run: true, would_send: redact({ method: 'POST', path: `${base}/translations/review/bulk`, body }) });
          const res = (await call('POST', '/translations/review/bulk', { body })) as { reviewed?: number };
          return text({ reviewed: res?.reviewed ?? 0 });
        }
      }
    },
  );
}
