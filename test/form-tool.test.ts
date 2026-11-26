import { describe, it, expect } from 'vitest';
import { fakePlatform } from './helpers/platform.js';

/** sb_form — form records, settings and responses (web_builder internal/forms/rest). */
const B = '/api/sites/s1/forms';
const FORM = {
  id: 'frm_1', siteId: 's1', name: 'Contact', type: 'custom', version: 2,
  settings: { afterSubmit: { action: 'message', message: 'Thanks' }, notify: { enabled: true, recipients: ['owner@x.vn'] }, submitLabel: 'Send', limitOnePerIpPerDay: true },
};
const SUB = (id: string, read = true) => ({
  id, formId: 'frm_1', status: 'complete', createdAt: '2026-11-20T10:00:00Z', ...(read ? { readAt: '2026-11-21T00:00:00Z' } : {}),
  values: [{ fieldId: 'f1', fieldName: 'email', text: 'visitor@x.vn' }, { fieldId: 'f2', fieldName: 'guests', number: 3 }],
  files: [],
});

type Hit = { method: string; path: string; query: string; body: any };
function platform(opts: { docFails?: boolean; deleteFails?: boolean; putFails?: boolean; forbidden?: boolean; total?: number } = {}) {
  const hits: Hit[] = [];
  const fake = fakePlatform((method, path, body, query) => {
    hits.push({ method, path, query, body });
    if (opts.forbidden) return { __status: 403, error: 'forbidden', code: 'forbidden' };
    if (path === B) return method === 'POST' ? { form: { ...FORM, id: 'frm_n', name: (body as any).name, settings: {} } } : { forms: [{ ...FORM, submissionCount: 4, unreadCount: 1 }], total: 1 };
    if (path === `${B}/frm_n/document` && method === 'PUT' && opts.docFails) return { __status: 409, error: 'duplicate field name', code: 'duplicate_field_name' };
    if (path === `${B}/notify-addresses`) {
      return method === 'POST'
        ? { address: { siteId: 's1', email: (body as any).email } }
        : { addresses: [{ siteId: 's1', email: 'owner@x.vn', verifiedAt: '2026-01-01T00:00:00Z' }, { siteId: 's1', email: 'pending@x.vn' }], total: 2 };
    }
    if (path === `${B}/frm_1` && method === 'PUT' && opts.putFails) return { __status: 409, error: 'version conflict', code: 'conflict' };
    if (path === `${B}/frm_1`) return method === 'PUT' ? { form: { ...FORM, ...(body as object) } } : { form: FORM };
    if (path === `${B}/frm_n` && method === 'DELETE' && opts.deleteFails) return { __status: 500, error: 'db down', code: 'internal' };
    if (path === `${B}/frm_n`) return method === 'DELETE' ? {} : { form: FORM };
    if (path === `${B}/frm_1/submissions`) return { submissions: [SUB('sub_1'), SUB('sub_2', false)], total: opts.total ?? 2 };
    return undefined;
  });
  return { fake, hits, writes: () => hits.filter((h) => h.method !== 'GET') };
}

async function withCall(p: ReturnType<typeof platform>, fn: (call: Awaited<ReturnType<ReturnType<typeof platform>['fake']['connect']>>['call']) => Promise<void>) {
  const { call, close } = await p.fake.connect();
  try {
    await fn(call);
  } finally {
    await close();
  }
}

const S = { site_id: 's1' };
const FIELDS = [
  { type: 'form-text', label: 'Email', required: true, placeholder: 'you@x.vn' },
  { type: 'select', label: 'Dịch vụ', options: ['Cắt', 'Gội'] },
  { type: 'form-text', label: 'Email' },
];

describe('sb_form', () => {
  it('list is compact and never writes', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const r = await call('sb_form', { ...S, action: 'list' });
      expect(r.json.forms).toEqual([{ id: 'frm_1', name: 'Contact', type: 'custom', submissions: 4, unread: 1 }]);
      expect(p.writes()).toEqual([]);
    });
  });

  it('create defaults to a dry run that sends nothing', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const r = await call('sb_form', { ...S, action: 'create', name: 'Booking', fields: FIELDS });
      expect(r.json.dry_run).toBe(true);
      expect(JSON.stringify(r.json.would_send)).toContain('"POST"');
      expect(p.hits, 'a dry create made a request').toEqual([]);
    });
  });

  it('an unknown field type is refused, naming the allowed types, before any request', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const r = await call('sb_form', { ...S, action: 'create', fields: [{ type: 'form-signature', label: 'Sign' }], dry_run: false });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/form-signature/);
      expect(r.text).toMatch(/form-text, form-number, form-select/);
      expect(p.hits, 'a refused create made a request').toEqual([]);
    });
  });

  it('rule keys land in specials; the wrong type or a bad value is refused before any request', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const ok = await call('sb_form', {
        ...S, action: 'create', dry_run: false,
        fields: [
          { type: 'form-checkbox', label: 'Tags', options: ['a', 'b'], minChecked: 1, maxChecked: 2, requiredText: 'Pick one', invalidText: 'Too many' },
          { type: 'form-date', label: 'Day', acceptedDates: 'future', minDate: '2026-01-01', maxDate: '2026-12-31' },
          { type: 'form-file', label: 'Doc', maxFileMB: 5 },
          { type: 'form-timeslot', label: 'Slot', requiredText: 'Pick a time' },
        ],
      });
      expect(ok.isError, ok.text).toBe(false);
      const doc = p.fake.forms.get('frm_n') as { root_node_id: string; nodes: Record<string, any> };
      const kids = doc.nodes[doc.root_node_id].data.nodes.map((id: string) => doc.nodes[id]);
      expect(kids[0].specials).toMatchObject({ minChecked: 1, maxChecked: 2, requiredText: 'Pick one', invalidText: 'Too many' });
      expect(kids[1].specials).toMatchObject({ acceptedDates: 'future', minDate: '2026-01-01', maxDate: '2026-12-31' });
      expect(kids[2].specials.maxFileMB).toBe(5);
      expect(kids[3].data.type, 'liveness: the 4th kid is the slot picker').toBe('form-timeslot');
      expect(kids[3].specials.requiredText).toBe('Pick a time');
    });
    const before = p.hits.length;
    const bad: Array<[Record<string, unknown>, RegExp]> = [
      [{ type: 'form-text', label: 'A', minChecked: 1 }, /minChecked applies to a checkbox group/],
      [{ type: 'form-timeslot', label: 'A', invalidText: 'x' }, /form-timeslot has no invalidText/],
      [{ type: 'form-checkbox', label: 'A', minChecked: 3, maxChecked: 2 }, /minChecked 3 is above maxChecked 2/],
      [{ type: 'form-date', label: 'A', minDate: '2026-02-30' }, /minDate "2026-02-30" is not a date/],
      [{ type: 'form-date', label: 'A', minDate: '2026-05-01', maxDate: '2026-04-01' }, /after maxDate/],
      [{ type: 'form-file', label: 'A', maxFileMB: 26 }, /maxFileMB must be a whole number from 1 to 25/],
      [{ type: 'form-file', label: 'A', maxFileMB: 0 }, /maxFileMB must be/],
    ];
    await withCall(p, async (call) => {
      for (const [f, re] of bad) {
        const r = await call('sb_form', { ...S, action: 'create', fields: [f], dry_run: false });
        expect(r.isError, JSON.stringify(f)).toBe(true);
        expect(r.text).toMatch(re);
      }
      const z = await call('sb_form', { ...S, action: 'create', fields: [{ type: 'form-date', label: 'A', acceptedDates: 'sometimes' }], dry_run: false });
      expect(z.isError, 'a bad acceptedDates word passed the schema').toBe(true);
    });
    expect(p.hits.length, 'a refused create made a request').toBe(before);
  });

  it('create with fields: POST, then a document of seeded form-* nodes with unique names and a submit', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const r = await call('sb_form', { ...S, action: 'create', name: 'Booking', fields: FIELDS, dry_run: false });
      expect(r.isError, r.text).toBe(false);
      expect(p.writes().map((w) => `${w.method} ${w.path}`)).toEqual([`POST ${B}`, `PUT ${B}/frm_n/document`]);
      expect(p.writes()[0].body).toEqual({ name: 'Booking' });
      const doc = p.fake.forms.get('frm_n') as { root_node_id: string; nodes: Record<string, any> };
      const root = doc.nodes[doc.root_node_id];
      expect(root.data.type).toBe('form');
      const kids = root.data.nodes.map((id: string) => doc.nodes[id]);
      expect(kids.map((n: any) => n.data.type)).toEqual(['form-text', 'form-select', 'form-text', 'form-submit']);
      expect(kids.map((n: any) => n.specials.name)).toEqual(['email', 'dich_vu', 'email_2', undefined]);
      expect(kids[0].specials).toMatchObject({ label: 'Email', required: true, placeholder: 'you@x.vn' });
      expect(kids[1].specials.options).toEqual(['Cắt', 'Gội']);
      // Codegen-seeded: keys the caller never gave come from the element's defaults.
      expect(kids[0].specials.inputType).toBe('text');
      expect(kids[3].specials.text).toBeTruthy();
      expect(r.json.created).toEqual({ id: 'frm_n', name: 'Booking' });
      expect(String(r.json.next)).toContain('sb_page_open form_id:"frm_n"');
    });
  });

  it('a blank create still saves a document, so sb_page_open form_id can open it', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const r = await call('sb_form', { ...S, action: 'create', dry_run: false });
      expect(r.isError, r.text).toBe(false);
      const doc = p.fake.forms.get('frm_n') as { root_node_id: string; nodes: Record<string, any> };
      expect(doc.nodes[doc.root_node_id].data.nodes.map((id: string) => doc.nodes[id].data.type)).toEqual(['form-submit']);
    });
  });

  it('a failed document PUT deletes the new form and returns the error', async () => {
    const p = platform({ docFails: true });
    await withCall(p, async (call) => {
      const r = await call('sb_form', { ...S, action: 'create', fields: FIELDS.slice(0, 1), dry_run: false });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/duplicate field name/);
      expect(p.writes().map((w) => `${w.method} ${w.path}`)).toEqual([`POST ${B}`, `PUT ${B}/frm_n/document`, `DELETE ${B}/frm_n`]);
    });
  });

  it('a failed rollback DELETE is named in the error, not swallowed', async () => {
    const p = platform({ docFails: true, deleteFails: true });
    await withCall(p, async (call) => {
      const r = await call('sb_form', { ...S, action: 'create', fields: FIELDS.slice(0, 1), dry_run: false });
      expect(r.isError).toBe(true);
      expect(r.text, 'the original error is lost').toMatch(/duplicate field name/);
      expect(r.text, 'the failed rollback is hidden').toMatch(/rollback delete of frm_n also failed — delete it by hand/);
    });
  });

  it('settings merges the given keys, round-trips the rest, and arms only a new recipient', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const settings = { notify: { recipients: ['owner@x.vn', 'New@x.vn', 'pending@x.vn'] }, collectionId: 'col_a' };
      const dry = await call('sb_form', { ...S, action: 'settings', form_id: 'frm_1', settings });
      expect(dry.json.dry_run).toBe(true);
      expect(p.writes(), 'a dry settings call wrote').toEqual([]);
      // The preview echoes only what the caller gave, never the stored settings.
      expect(JSON.stringify(dry.json)).not.toContain('Thanks');

      const r = await call('sb_form', { ...S, action: 'settings', form_id: 'frm_1', settings, dry_run: false });
      expect(r.isError, r.text).toBe(false);
      const w = p.writes();
      // The settings PUT lands BEFORE the ledger POST that mails a verification link.
      expect(w.map((x) => `${x.method} ${x.path}`)).toEqual([`PUT ${B}/frm_1`, `POST ${B}/notify-addresses`]);
      expect(w[1].body).toEqual({ email: 'new@x.vn' });
      const put = w[0].body;
      expect(put.name).toBe('Contact');
      expect(put.type).toBe('custom');
      // Untouched keys, byte for byte — including one the merge never names.
      expect(put.settings.limitOnePerIpPerDay).toBe(true);
      expect(put.settings.submitLabel).toBe('Send');
      expect(put.settings.afterSubmit).toEqual(FORM.settings.afterSubmit);
      // One level deep: the given notify key replaced, its sibling kept.
      expect(put.settings.notify).toEqual({ enabled: true, recipients: settings.notify.recipients });
      expect(put.settings.collectionId).toBe('col_a');
      expect(r.json.waiting_verification).toEqual(['new@x.vn', 'pending@x.vn']);
      expect(String(r.json.note)).toMatch(/no mail until they click/);
    });
  });

  it('a failed settings PUT mails no verification link', async () => {
    const p = platform({ putFails: true });
    await withCall(p, async (call) => {
      const r = await call('sb_form', { ...S, action: 'settings', form_id: 'frm_1', settings: { notify: { recipients: ['new@x.vn'] } }, dry_run: false });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/version conflict/);
      expect(p.writes().map((w) => `${w.method} ${w.path}`), 'a ledger POST went out before the settings landed').toEqual([`PUT ${B}/frm_1`]);
    });
  });

  it('notify left disabled after the merge is said out loud', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const off = await call('sb_form', { ...S, action: 'settings', form_id: 'frm_1', settings: { notify: { enabled: false, recipients: ['owner@x.vn'] } }, dry_run: false });
      expect(off.isError, off.text).toBe(false);
      expect(String(off.json.notify_disabled), 'disabled notify not noted').toMatch(/no mail is sent until notify is enabled/);
      // Liveness: the stored enabled:true survives a recipients-only merge, so no note.
      const on = await call('sb_form', { ...S, action: 'settings', form_id: 'frm_1', settings: { notify: { recipients: ['owner@x.vn'] } }, dry_run: false });
      expect(on.json.notify_disabled, 'enabled notify noted as disabled').toBeUndefined();
    });
  });

  it('settings with no recipients reads no ledger and posts none', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const r = await call('sb_form', { ...S, action: 'settings', form_id: 'frm_1', settings: { afterSubmit: { action: 'redirect', url: 'https://x.vn/ok' } }, dry_run: false });
      expect(r.isError, r.text).toBe(false);
      expect(p.hits.map((h) => `${h.method} ${h.path}`)).toEqual([`GET ${B}/frm_1`, `PUT ${B}/frm_1`]);
      expect(p.writes()[0].body.settings.afterSubmit).toEqual({ action: 'redirect', message: 'Thanks', url: 'https://x.vn/ok' });
      expect(r.json.waiting_verification).toBeUndefined();
    });
  });

  it('submissions passes the filters through, defaults limit to 20 and names the next offset', async () => {
    const p = platform({ total: 5 });
    await withCall(p, async (call) => {
      const r = await call('sb_form', {
        ...S, action: 'submissions', form_id: 'frm_1', offset: 2, status: 'complete', q: 'an', from: '2026-11-01', to: '2026-11-30T00:00:00Z', field: 'email', value: 'a@x.vn', unread: true,
      });
      expect(r.isError, r.text).toBe(false);
      const q = new URLSearchParams(p.hits[0].query);
      expect(Object.fromEntries(q)).toEqual({
        limit: '20', offset: '2', status: 'complete', q: 'an', from: '2026-11-01T00:00:00.000Z', to: '2026-11-30T00:00:00.000Z', field: 'email', value: 'a@x.vn', unread: 'true',
      });
      expect(r.json.total).toBe(5);
      expect(r.json.next_offset).toBe(4);
      expect(r.json.submissions).toEqual([
        { id: 'sub_1', at: '2026-11-20T10:00:00Z', status: 'complete', values: { email: 'visitor@x.vn', guests: 3 } },
        { id: 'sub_2', at: '2026-11-20T10:00:00Z', status: 'complete', unread: true, values: { email: 'visitor@x.vn', guests: 3 } },
      ]);
      expect(p.writes()).toEqual([]);
    });
  });

  it('a date-only `to` includes that whole day; a date-only `from` starts it', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const r = await call('sb_form', { ...S, action: 'submissions', form_id: 'frm_1', from: '2026-11-01', to: '2026-11-30' });
      expect(r.isError, r.text).toBe(false);
      const q = new URLSearchParams(p.hits[0].query);
      expect(q.get('from')).toBe('2026-11-01T00:00:00.000Z');
      // The platform filters created_at < to, so the end of the 30th is the start of the 1st.
      expect(q.get('to')).toBe('2026-12-01T00:00:00.000Z');
    });
  });

  it('no next_offset once the page reaches the total', async () => {
    const p = platform({ total: 2 });
    await withCall(p, async (call) => {
      const r = await call('sb_form', { ...S, action: 'submissions', form_id: 'frm_1', limit: 50 });
      expect(new URLSearchParams(p.hits[0].query).get('limit')).toBe('50');
      expect(r.json.next_offset).toBeUndefined();
    });
  });

  it('submissions needs form_id, and an unparseable date is refused rather than silently dropped', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const r = await call('sb_form', { ...S, action: 'submissions' });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/needs form_id/);
      const d = await call('sb_form', { ...S, action: 'submissions', form_id: 'frm_1', from: 'last week' });
      expect(d.isError).toBe(true);
      expect(d.text).toMatch(/not a date/);
      expect(p.hits).toEqual([]);
    });
  });

  it('a 403 names forms.read instead of reading as an empty list', async () => {
    const p = platform({ forbidden: true });
    await withCall(p, async (call) => {
      const r = await call('sb_form', { ...S, action: 'submissions', form_id: 'frm_1' });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/forms\.read permission/);
      expect(r.text).not.toMatch(/"submissions"/);
    });
  });
});
