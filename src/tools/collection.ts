import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { request, redact, ApiError } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { siteFor, type ToolContext } from './context.js';

/**
 * A site's DATA TABLES (`server/internal/collections`, the editor's "Collections"): typed fields,
 * records, CSV in and out, upsert by external id.
 *
 * The EDITOR surface `/api/sites/{siteId}/collections…`, with `siteToken` like sb_code and
 * sb_function: `/api/v1/collections` reaches records only (no table or field writes), and this
 * one takes either credential — a `wbk_` key needs the `collections.read/write` scopes.
 *
 * Every PUT here is a FULL REPLACE, and two of them lose data when a field is left out:
 * a record PUT with no `published` UNPUBLISHES it (`recordBody`: "PUT is a full replace, so
 * omitted there is false"), and its `values` replace the stored ones. So an update reads the
 * row and sends it back whole, with `rev` — a row somebody saved in between is 409
 * `stale_record`, never merged. A field PUT likewise carries every property.
 *
 * There is no GET for one table or one field: they are found in their list. One record is
 * `GET …/collections/records/{rid}` (no table in the path).
 */
/** collections.FieldType, the closed set (ValidFieldType). */
const TYPES = ['text', 'richtext', 'number', 'integer', 'boolean', 'image', 'gallery', 'url', 'date', 'select', 'tags', 'reference'] as const;
/** collections.keyRE, and the sentence ValidateField answers with. */
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const KEY_MSG = 'must start with a lowercase letter and use a-z, 0-9, _ (max 40)';

type Coll = { id: string; name: string; slug: string; publicRead: boolean };
type Field = { id: string; key: string; label: string; type: string; required: boolean; options: string[] | null; position?: number; refCollectionId: string };
type Rec = { id: string; collectionId: string; values: Record<string, unknown>; published: boolean; externalId: string; rev: number; position?: number };

/** The refusals an agent acts on, each said as what to do next. */
function explained<T>(p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => {
    if (e instanceof ApiError) {
      const d = e.details as Record<string, unknown> | undefined;
      if (e.code === 'in_use' && d) e.message += ` — still used by ${JSON.stringify(d)}`;
      else if (e.code === 'invalid_rows' && d) e.message += ` — ${JSON.stringify((d.rows as unknown[] | undefined)?.slice(0, 20))}`;
      else if (e.code === 'stale_record' || e.code === 'fields_changed') e.message += ' — re-run this sb_collection call (it re-reads first).';
    }
    throw e;
  });
}

const fieldOut = ({ id, key, label, type, required, options, refCollectionId }: Field) => ({
  id, key, label, type,
  ...(required ? { required } : {}),
  ...(options?.length ? { options } : {}),
  ...(refCollectionId ? { ref: refCollectionId } : {}),
});
const recOut = ({ id, values, published, externalId, rev }: Rec) => ({
  id, values, rev, ...(published ? {} : { published }), ...(externalId ? { externalId } : {}),
});
/** ponytail: an export answers inline up to this; past it, page with action:"records". */
const CSV_CAP = 200_000;

export function registerCollectionTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'sb_collection',
    {
      description:
        'Data tables (collections): tables, typed fields, records, CSV export/import (appends), upsert by external_id. ' +
        'edit merges values (null clears). get/edit/remove/move take id.',
      inputSchema: {
        action: z.enum([
          'list', 'create', 'update', 'delete', 'fields', 'field_add', 'field_update', 'field_delete', 'field_order',
          'records', 'get', 'add', 'edit', 'remove', 'move', 'order', 'export', 'import', 'upsert',
        ]),
        site_id: z.string().optional(),
        collection: z.string().optional().describe('id or slug'),
        name: z.string().optional().describe('table name / field label'),
        slug: z.string().optional(),
        public_read: z.boolean().optional(),
        field: z.string().optional().describe('id or key'),
        key: z.string().optional(),
        type: z.enum(TYPES).optional(),
        required: z.boolean().optional(),
        options: z.array(z.string()).optional(),
        ref: z.string().optional().describe('reference target table'),
        id: z.string().optional().describe('record'),
        values: z.record(z.string(), z.unknown()).optional(),
        published: z.boolean().optional(),
        external_id: z.string().optional(),
        ids: z.array(z.string()).optional().describe('every id, new order'),
        delta: z.union([z.literal(-1), z.literal(1)]).optional(),
        sort: z.string().optional().describe('key, -key desc'),
        filter: z.record(z.string(), z.string()).optional().describe('{key: value}'),
        offset: z.number().int().optional(),
        limit: z.number().int().optional(),
        csv: z.string().optional(),
        records: z
          .array(z.object({ external_id: z.string(), values: z.record(z.string(), z.unknown()), published: z.boolean().optional() }).strict())
          .max(500)
          .optional(),
        dry_run: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (a) => {
      const base = `/api/sites/${encodeURIComponent(siteFor(ctx, a.site_id))}/collections`;
      const token = siteToken(ctx);
      const call = (method: string, path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>, binary?: boolean) =>
        explained(request({ base: ctx.base, method, path, token, body, query, binary, fetchImpl: ctx.fetchImpl }));
      const dry = a.dry_run !== false;
      const preview = (method: string, path: string, body?: unknown, extra: Record<string, unknown> = {}) =>
        text({ dry_run: true, would_send: redact({ method, path, ...(body !== undefined ? { body } : {}) }), ...extra });

      const list = async () => ((await call('GET', base)) as { collections?: Coll[] }).collections ?? [];
      const find = async (ref: string | undefined, what = 'collection') => {
        if (!ref) throw new Error(`sbuilder: action:"${a.action}" needs ${what} — action:"list" names them.`);
        const c = (await list()).find((x) => x.id === ref || x.slug === ref);
        if (!c) throw new Error(`sbuilder: no collection "${ref}" on this site — action:"list" names them.`);
        return c;
      };
      const coll = async () => find(a.collection);
      const at = (c: Coll, ...rest: string[]) => [base, encodeURIComponent(c.id), ...rest].join('/');
      const fieldsOf = async (c: Coll) => ((await call('GET', at(c, 'fields'))) as { fields?: Field[] }).fields ?? [];
      const fieldOf = async (c: Coll) => {
        if (!a.field) throw new Error(`sbuilder: action:"${a.action}" needs field (id or key) — action:"fields" names them.`);
        const f = (await fieldsOf(c)).find((x) => x.id === a.field || x.key === a.field);
        if (!f) throw new Error(`sbuilder: no field "${a.field}" in ${c.slug} — action:"fields" names them.`);
        return f;
      };
      const record = async () => {
        if (!a.id) throw new Error(`sbuilder: action:"${a.action}" needs id (a record) — action:"records" lists them.`);
        return ((await call('GET', `${base}/records/${encodeURIComponent(a.id)}`)) as { record: Rec }).record;
      };
      const checkKey = (k: string | undefined) => {
        if (k !== undefined && !KEY_RE.test(k)) throw new Error(`sbuilder: field key "${k}" ${KEY_MSG}.`);
      };
      const done = (out: unknown) => text(out ?? { ok: true });

      switch (a.action) {
        case 'list':
          return text({ collections: (await list()).map(({ id, name, slug, publicRead }) => ({ id, name, slug, ...(publicRead ? { publicRead } : {}) })) });

        case 'create':
        case 'update': {
          const cur = a.action === 'update' ? await coll() : undefined;
          const name = a.name ?? cur?.name;
          if (!name) throw new Error('sbuilder: creating a collection needs name (slug defaults from it).');
          const body = { name, slug: a.slug ?? cur?.slug ?? '', ...(a.public_read !== undefined ? { publicRead: a.public_read } : {}) };
          const [method, path] = cur ? ['PUT', at(cur)] : ['POST', base];
          if (dry) return preview(method, path, body);
          // create answers only {name, slug}: publicRead rides a PUT (collectionBody).
          let c = ((await call(method, path, body)) as { collection: Coll }).collection;
          if (!cur && a.public_read) c = ((await call('PUT', at(c), { ...body, slug: c.slug })) as { collection: Coll }).collection;
          return text({ [cur ? 'updated' : 'created']: c });
        }

        case 'delete': {
          const c = await coll();
          const total = ((await call('GET', at(c, 'records'), undefined, { limit: 1 })) as { total?: number }).total ?? 0;
          if (dry) return preview('DELETE', at(c), undefined, { removes: { ...c, records: total, note: 'its fields and every record go with it' } });
          await call('DELETE', at(c));
          return text({ removed: { id: c.id, slug: c.slug, records: total } });
        }

        case 'fields':
          return text({ fields: (await fieldsOf(await coll())).map(fieldOut) });

        case 'field_add':
        case 'field_update': {
          const c = await coll();
          const cur = a.action === 'field_update' ? await fieldOf(c) : undefined;
          checkKey(a.key);
          const ref = a.ref ? (await find(a.ref, 'ref')).id : undefined;
          if (!cur && (!a.key || !a.type)) throw new Error('sbuilder: field_add needs key and type (label defaults to key).');
          // A FULL REPLACE: every property, the stored one where not given.
          const body = {
            key: a.key ?? cur!.key,
            label: a.name ?? cur?.label ?? a.key,
            type: a.type ?? cur!.type,
            required: a.required ?? cur?.required ?? false,
            options: a.options ?? cur?.options ?? [],
            refCollectionId: ref ?? cur?.refCollectionId ?? '',
          };
          const [method, path] = cur ? ['PUT', at(c, 'fields', encodeURIComponent(cur.id))] : ['POST', at(c, 'fields')];
          if (dry) return preview(method, path, body, cur && cur.key !== body.key ? { note: `renames ${cur.key} → ${body.key} in every record` } : {});
          const f = ((await call(method, path, body)) as { field: Field }).field;
          return text({ [cur ? 'updated' : 'created']: fieldOut(f) });
        }

        case 'field_delete': {
          const c = await coll();
          const f = await fieldOf(c);
          const path = at(c, 'fields', encodeURIComponent(f.id));
          if (dry) return preview('DELETE', path, undefined, { removes: { ...fieldOut(f), note: 'its value is removed from every record' } });
          await call('DELETE', path);
          return text({ removed: fieldOut(f) });
        }

        case 'field_order': {
          const c = await coll();
          if (!a.ids?.length) throw new Error('sbuilder: field_order needs ids — every field, in the new order.');
          const fs = await fieldsOf(c);
          const ids = a.ids.map((x) => fs.find((f) => f.id === x || f.key === x)?.id ?? x);
          const path = at(c, 'fields', 'order');
          if (dry) return preview('PUT', path, { ids });
          return done(await call('PUT', path, { ids }));
        }

        case 'records': {
          const c = await coll();
          const filter = Object.entries(a.filter ?? {});
          if (filter.length > 1) throw new Error('sbuilder: filter takes one {key: value} — the platform filters on one field.');
          const desc = a.sort?.startsWith('-');
          const got = (await call('GET', at(c, 'records'), undefined, {
            sort: desc ? a.sort!.slice(1) : a.sort, desc: desc || undefined, filterKey: filter[0]?.[0], filterValue: filter[0]?.[1],
            published: a.published, externalId: a.external_id, offset: a.offset, limit: a.limit,
          })) as { records?: Rec[]; total?: number };
          return text({ records: (got.records ?? []).map(recOut), total: got.total });
        }

        case 'get':
          return text({ record: recOut(await record()) });

        case 'add': {
          const c = await coll();
          if (!a.values) throw new Error('sbuilder: add needs values (by field key).');
          const body = { values: a.values, ...(a.published !== undefined ? { published: a.published } : {}), ...(a.external_id !== undefined ? { externalId: a.external_id } : {}) };
          if (dry) return preview('POST', at(c, 'records'), body);
          return text({ created: recOut(((await call('POST', at(c, 'records'), body)) as { record: Rec }).record) });
        }

        case 'edit': {
          const cur = await record();
          const values = { ...cur.values, ...a.values };
          for (const [k, v] of Object.entries(values)) if (v === null) delete values[k];
          // WHOLE ROW BACK: an omitted `published` would unpublish it.
          const body = { values, published: a.published ?? cur.published, ...(a.external_id !== undefined ? { externalId: a.external_id } : {}), rev: cur.rev };
          const path = `${base}/${encodeURIComponent(cur.collectionId)}/records/${encodeURIComponent(cur.id)}`;
          if (dry) return preview('PUT', path, body);
          return text({ updated: recOut(((await call('PUT', path, body)) as { record: Rec }).record) });
        }

        case 'remove': {
          const cur = await record();
          const path = `${base}/${encodeURIComponent(cur.collectionId)}/records/${encodeURIComponent(cur.id)}`;
          if (dry) return preview('DELETE', path, undefined, { removes: recOut(cur) });
          await call('DELETE', path);
          return text({ removed: cur.id });
        }

        case 'move': {
          const cur = await record();
          if (!a.delta) throw new Error('sbuilder: move needs delta: -1 (up) or 1 (down).');
          const path = `${base}/${encodeURIComponent(cur.collectionId)}/records/${encodeURIComponent(cur.id)}/move`;
          if (dry) return preview('POST', path, { delta: a.delta });
          return done(await call('POST', path, { delta: a.delta }));
        }

        case 'order': {
          const c = await coll();
          if (!a.ids?.length) throw new Error('sbuilder: order needs ids — every record id of the collection, in the new order.');
          if (dry) return preview('PUT', at(c, 'records', 'order'), { ids: a.ids });
          return done(await call('PUT', at(c, 'records', 'order'), { ids: a.ids }));
        }

        case 'export': {
          const c = await coll();
          const csv = new TextDecoder().decode((await call('GET', at(c, 'records.csv'), undefined, undefined, true)) as Uint8Array);
          return text(csv.length > CSV_CAP ? { csv: csv.slice(0, CSV_CAP), truncated: true, chars: csv.length } : { csv });
        }

        case 'import': {
          const c = await coll();
          if (!a.csv) throw new Error('sbuilder: import needs csv — a header row of field keys, then one row per record (appends; use upsert to update by external id).');
          const path = at(c, 'records', 'import');
          if (dry) return preview('POST', path, `${a.csv.length} chars of CSV, ${a.csv.split('\n').filter(Boolean).length - 1} rows`);
          return text(await call('POST', path, new Blob([a.csv], { type: 'text/csv' })));
        }

        case 'upsert': {
          const c = await coll();
          if (!a.records?.length) throw new Error('sbuilder: upsert needs records: [{external_id, values, published?}] (max 500).');
          const body = { records: a.records.map((r) => ({ externalId: r.external_id, values: r.values, ...(r.published !== undefined ? { published: r.published } : {}) })) };
          const path = at(c, 'records', 'upsert');
          if (dry) return preview('POST', path, { records: body.records.slice(0, 3) }, { count: body.records.length });
          const r = (await call('POST', path, body)) as { created?: number; updated?: number; unchanged?: number };
          return text({ created: r.created, updated: r.updated, unchanged: r.unchanged });
        }
      }
    },
  );
}
