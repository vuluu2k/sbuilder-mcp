import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { request, redact, ApiError } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { siteFor, type ToolContext } from './context.js';
import { createNode } from '../domains/site/node.js';
import { addSubtree } from '../domains/site/builder.js';
import { PageDoc } from '../domains/site/document.js';
import { validateForSave } from '../domains/site/validate.js';
import { nameFromLabel } from '../domains/site/formdoc.js';
import { unknownSettingKeys } from './store.js';

/**
 * A site's FORMS as records (`server/internal/forms/rest`): list them, make one, change its
 * settings, read its responses. The FIELD document is edited with the page tools
 * (`sb_page_open form_id`); a template form with mapped fields is `sb_store action:"form"`.
 *
 * CREATE IS TWO WRITES, and the second can fail after the first landed: POST the record, then
 * PUT its field document. A failed PUT deletes the form again — the store.ts precedent, because a
 * form nobody can open is the orphan the obvious retry duplicates. A "blank" form still gets a
 * document (the form root and its submit button): `sb_page_open form_id` refuses a form whose
 * document was never saved, so a record alone would answer with a hint that does not work.
 *
 * SETTINGS IS A FULL REPLACE of the record (`forms.Form` decoded whole), so it reads, merges the
 * given keys one level deep and sends the rest back untouched. A notify recipient receives mail
 * only after clicking the link the platform mails it, so a new one is put on the site's
 * notify-addresses ledger and reported as WAITING, never as delivered.
 *
 * SUBMISSIONS ARE VISITOR PII. Nothing here logs one or puts one in a notice.
 */

/** Field types `fields` may name: the value-collecting ones with no order or address wiring. */
const FIELD_TYPES = ['form-text', 'form-number', 'form-select', 'form-radio', 'form-checkbox', 'form-date', 'form-calendar', 'form-file', 'form-timeslot'];
const CHOICE = new Set(['form-select', 'form-radio', 'form-checkbox']);
const PLACEHOLDER = new Set(['form-text', 'form-number', 'form-select', 'form-file']);

type Form = { id: string; name: string; type: string; settings?: Record<string, unknown>; submissionCount?: number; unreadCount?: number };
type Value = { fieldName: string; text?: string; number?: number; bool?: boolean; json?: unknown };
type Submission = { id: string; status: string; createdAt: string; readAt?: string; values?: Value[]; files?: unknown[] };
type FieldIn = {
  type: string; label: string; required?: boolean; placeholder?: string; options?: string[];
  requiredText?: string; invalidText?: string; minChecked?: number; maxChecked?: number;
  acceptedDates?: 'past' | 'future'; minDate?: string; maxDate?: string; maxFileMB?: number;
};

/** Message keys: every type that carries field rules (FIELD_RULE_SPECIALS in web_builder); form-timeslot has none. */
const MESSAGE = new Set(['form-text', 'form-number', 'form-select', 'form-radio', 'form-checkbox', 'form-date', 'form-calendar', 'form-file']);
const RULE_TYPE: Record<string, [string, string]> = {
  minChecked: ['form-checkbox', 'a checkbox group'], maxChecked: ['form-checkbox', 'a checkbox group'],
  acceptedDates: ['form-date', 'a date field'], minDate: ['form-date', 'a date field'], maxDate: ['form-date', 'a date field'],
  maxFileMB: ['form-file', 'a file field'],
};
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

/** Throws before any request, like options/placeholder: a rule on the wrong type would be dropped on save, silently. */
function checkRules(f: FieldIn, type: string): void {
  for (const k of ['requiredText', 'invalidText'] as const) {
    if (f[k] !== undefined && !MESSAGE.has(type)) throw new Error(`sbuilder: ${type} has no ${k}.`);
  }
  for (const [k, [owner, what]] of Object.entries(RULE_TYPE)) {
    if ((f as Record<string, unknown>)[k] !== undefined && type !== owner) throw new Error(`sbuilder: ${k} applies to ${what} (${owner}), not ${type}.`);
  }
  for (const k of ['minChecked', 'maxChecked'] as const) {
    if (f[k] !== undefined && (!Number.isInteger(f[k]) || f[k]! < 0)) throw new Error(`sbuilder: ${k} must be a whole number, 0 or more (0 = no bound).`);
  }
  if (f.minChecked && f.maxChecked && f.minChecked > f.maxChecked) throw new Error(`sbuilder: minChecked ${f.minChecked} is above maxChecked ${f.maxChecked}.`);
  for (const k of ['minDate', 'maxDate'] as const) {
    if (f[k] !== undefined && f[k] !== '' && !isDay(f[k]!)) throw new Error(`sbuilder: ${k} "${f[k]}" is not a date — use YYYY-MM-DD.`);
  }
  if (f.minDate && f.maxDate && f.minDate > f.maxDate) throw new Error(`sbuilder: minDate ${f.minDate} is after maxDate ${f.maxDate}.`);
  if (f.maxFileMB !== undefined && (!Number.isInteger(f.maxFileMB) || f.maxFileMB < 1 || f.maxFileMB > 25)) throw new Error('sbuilder: maxFileMB must be a whole number from 1 to 25.');
}
const RULE_KEYS = ['requiredText', 'invalidText', 'minChecked', 'maxChecked', 'acceptedDates', 'minDate', 'maxDate', 'maxFileMB'] as const;

const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** `patch` over `cur`, one level deep — `settings.notify` is a whole object on the wire too. */
const merge = (cur: Record<string, unknown>, patch: Record<string, unknown>) => {
  const out = { ...cur };
  for (const [k, v] of Object.entries(patch)) out[k] = plain(v) && plain(cur[k]) ? { ...cur[k], ...v } : v;
  return out;
};

/** The field document, built the way sb_add builds a node: catalog defaults, then the spec. Throws before any request. */
export function formDocument(fields: FieldIn[]) {
  const root = createNode('form');
  const doc = PageDoc.from({ root_node_id: root.id, nodes: { [root.id]: root } });
  const names = new Set<string>();
  const out: Array<{ id: string; type: string; name: string }> = [];
  for (const f of fields) {
    const type = f.type.startsWith('form-') ? f.type : `form-${f.type}`;
    if (!FIELD_TYPES.includes(type)) throw new Error(`sbuilder: field type "${f.type}" is not one sb_form makes — use ${FIELD_TYPES.join(', ')}. Others: sb_page_open form_id, then sb_add.`);
    if (f.options && !CHOICE.has(type)) throw new Error(`sbuilder: options apply to form-select, form-radio and form-checkbox, not ${type}.`);
    if (f.placeholder !== undefined && !PLACEHOLDER.has(type)) throw new Error(`sbuilder: ${type} has no placeholder.`);
    checkRules(f, type);
    // The posted name from the label, unique: answers read as {email: …}, not {form-text_x9: …}.
    const stem = nameFromLabel(f.label) || 'field';
    let name = stem;
    for (let i = 2; names.has(name); i++) name = `${stem}_${i}`;
    names.add(name);
    const specials: Record<string, unknown> = { name, label: f.label };
    if (f.required !== undefined) specials.required = f.required;
    if (f.placeholder !== undefined) specials.placeholder = f.placeholder;
    if (f.options) specials.options = f.options;
    for (const k of RULE_KEYS) if (f[k] !== undefined) specials[k] = f[k];
    const { patches, ids } = addSubtree(doc, root.id, { type, specials });
    doc.apply(patches);
    out.push({ id: ids[0], type, name });
  }
  doc.apply(addSubtree(doc, root.id, { type: 'form-submit' }).patches);
  const problems = validateForSave(doc);
  if (problems.length) throw new Error(`sbuilder: ${problems.join(' ')}`);
  return { document: doc.doc, fields: out };
}

/** The refusal an agent acts on: a key without the forms permission is not an empty list. */
function explained<T>(p: Promise<T>, perm: string): Promise<T> {
  return p.catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 403) {
      e.message = `${e.message} — this credential lacks ${perm}; an API key needs the ${perm} permission (or use the account session).`;
    }
    throw e;
  });
}

const submissionOut = ({ id, status, createdAt, readAt, values, files }: Submission) => ({
  id,
  at: createdAt,
  status,
  ...(readAt ? {} : { unread: true }),
  values: Object.fromEntries((values ?? []).map((v) => [v.fieldName, v.text ?? v.number ?? v.bool ?? v.json ?? ''])),
  ...(files?.length ? { files: files.length } : {}),
});

/**
 * RFC 3339, which is all the platform parses — anything else is dropped there without a word.
 * A date-only `to` means the END of that day: the platform filters `created_at < to`, so it is
 * sent as the next day's start. A date-only `from` stays the start of its day.
 */
function when(v: string | undefined, key: 'from' | 'to'): string | undefined {
  if (v === undefined) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`sbuilder: ${key} "${v}" is not a date — use 2026-11-01 or an RFC 3339 time.`);
  if (key === 'to' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export function registerFormTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'sb_form',
    {
      description:
        'Forms: list; create (blank, or fields → custom form); settings (merged one level over the stored ones: notify, afterSubmit, collectionId…); ' +
        'submissions (paged responses). Fields of an existing form: sb_page_open form_id.',
      inputSchema: {
        action: z.enum(['list', 'create', 'settings', 'submissions']),
        site_id: z.string().optional(),
        form_id: z.string().optional(),
        name: z.string().optional(),
        fields: z
          .array(
            z
              .object({
                type: z.string(), label: z.string(), required: z.boolean().optional(), placeholder: z.string().optional(), options: z.array(z.string()).optional(),
                requiredText: z.string().optional(), invalidText: z.string().optional(),
                minChecked: z.number().optional(), maxChecked: z.number().optional(),
                acceptedDates: z.enum(['past', 'future']).optional(), minDate: z.string().optional(), maxDate: z.string().optional(),
                maxFileMB: z.number().optional(),
              })
              .strict(),
          )
          .optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
        status: z.string().optional(),
        q: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        field: z.string().optional(),
        value: z.string().optional(),
        unread: z.boolean().optional(),
        dry_run: z.boolean().optional(),
      },
      // ONE tool, so one annotation set: create and settings write. Neither destroys —
      // the only DELETE is create's rollback of the form it just made.
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (a) => {
      const site = encodeURIComponent(siteFor(ctx, a.site_id));
      const base = `/api/sites/${site}/forms`;
      const call = <T>(method: string, path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>) =>
        explained(
          request({ base: ctx.base, method, path, token: siteToken(ctx), body, query, fetchImpl: ctx.fetchImpl }) as Promise<T>,
          method === 'GET' ? 'forms.read' : 'forms.write',
        );
      const dry = a.dry_run !== false;
      const formPath = () => {
        if (!a.form_id) throw new Error(`sbuilder: action:"${a.action}" needs form_id — action:"list" names them.`);
        return `${base}/${encodeURIComponent(a.form_id)}`;
      };

      switch (a.action) {
        case 'list': {
          const got = await call<{ forms?: Form[] }>('GET', base);
          return text({
            forms: (got.forms ?? []).map(({ id, name, type, submissionCount, unreadCount }) => ({
              id, name, type, ...(submissionCount ? { submissions: submissionCount } : {}), ...(unreadCount ? { unread: unreadCount } : {}),
            })),
          });
        }

        case 'create': {
          const { document, fields } = formDocument(a.fields ?? []);
          const body = { name: a.name ?? 'Form' };
          if (dry) {
            return text({
              dry_run: true,
              would_send: redact([{ method: 'POST', path: base, body }, { method: 'PUT', path: `${base}/{formId}/document`, fields: fields.map(({ type, name }) => ({ type, name })) }]),
            });
          }
          const form = (await call<{ form?: Form }>('POST', base, body)).form;
          if (!form?.id) throw new Error('sbuilder: the platform accepted the form create and returned no form');
          const at = `${base}/${encodeURIComponent(form.id)}`;
          try {
            await call('PUT', `${at}/document`, { document });
          } catch (e) {
            // A form nobody can open is the orphan a retry duplicates — and one we failed to delete is said, not hidden.
            const undone = await call('DELETE', at).then(() => true, () => false);
            if (!undone && e instanceof Error) e.message += ` — rollback delete of ${form.id} also failed — delete it by hand`;
            throw e;
          }
          return text({
            created: { id: form.id, name: form.name },
            fields,
            next: `sb_page_open form_id:"${form.id}" edits its fields; place it with sb_add {type:"form", specials:{formId:"${form.id}"}}.`,
          });
        }

        case 'settings': {
          const path = formPath();
          if (!a.settings || !Object.keys(a.settings).length) throw new Error('sbuilder: action:"settings" needs settings — the keys to change, e.g. {notify:{enabled:true, recipients:["a@x.vn"]}}.');
          const unknown = unknownSettingKeys(a.settings);
          const warn = unknown.length ? { settings_unknown: { keys: unknown, note: 'Not in the platform\'s form Settings — the decoder drops them, so they are stored as nothing.' } } : {};
          const recipients = (a.settings.notify as { recipients?: unknown } | undefined)?.recipients;
          const wanted = Array.isArray(recipients) ? recipients.filter((r): r is string => typeof r === 'string').map((r) => r.trim().toLowerCase()).filter(Boolean) : [];
          const ledger = wanted.length
            ? ((await call<{ addresses?: Array<{ email: string; verifiedAt?: string }> }>('GET', `${base}/notify-addresses`)).addresses ?? [])
            : [];
          const known = new Map(ledger.map((l) => [l.email.toLowerCase(), !!l.verifiedAt]));
          const toArm = wanted.filter((e) => !known.has(e));
          const waiting = wanted.filter((e) => known.get(e) !== true);
          // The PREVIEW carries only what the caller gave: the stored settings are read data.
          if (dry) {
            return text({
              dry_run: true,
              would_send: redact([
                { method: 'PUT', path, body: { settings: a.settings }, note: 'merged one level over the stored settings; every other key is sent back unchanged' },
                ...toArm.map((email) => ({ method: 'POST', path: `${base}/notify-addresses`, body: { email } })),
              ]),
              ...warn,
            });
          }
          const cur = (await call<{ form: Form }>('GET', path)).form;
          const settings = merge(cur.settings ?? {}, a.settings);
          // Settings first: each ledger POST mails a verification link, which a failed PUT would leave pointing at nothing.
          const updated = (await call<{ form: Form }>('PUT', path, { name: cur.name, type: cur.type, settings })).form;
          for (const email of toArm) await call('POST', `${base}/notify-addresses`, { email });
          const off = a.settings.notify !== undefined && (settings.notify as { enabled?: unknown } | undefined)?.enabled !== true;
          return text({
            updated: { id: updated?.id ?? cur.id, changed: Object.keys(a.settings) },
            ...(waiting.length ? { waiting_verification: waiting, note: 'These receive no mail until they click the link the platform mailed them.' } : {}),
            ...(off ? { notify_disabled: 'notify.enabled is false — no mail is sent until notify is enabled.' } : {}),
            ...warn,
          });
        }

        case 'submissions': {
          const path = `${formPath()}/submissions`;
          if ((a.field === undefined) !== (a.value === undefined)) throw new Error('sbuilder: field and value filter together — field is the posted name, value its answer.');
          const offset = a.offset ?? 0;
          const got = await call<{ submissions?: Submission[]; total?: number }>('GET', path, undefined, {
            limit: a.limit ?? 20, offset, status: a.status, q: a.q, from: when(a.from, 'from'), to: when(a.to, 'to'),
            field: a.field, value: a.value, unread: a.unread || undefined,
          });
          const rows = got.submissions ?? [];
          const total = got.total ?? rows.length;
          const next = offset + rows.length;
          return text({ submissions: rows.map(submissionOut), total, ...(next < total && rows.length ? { next_offset: next } : {}) });
        }
      }
    },
  );
}
