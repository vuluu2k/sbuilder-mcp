import { describe, it, expect } from 'vitest';
import { fakePlatform } from './helpers/platform.js';
import { PageDoc } from '../src/domains/site/document.js';
import { validateForSave } from '../src/domains/site/validate.js';
import { formFieldFindings } from '../src/domains/site/formdoc.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { applyPatches } from '../src/core/patch.js';

/**
 * A FORM'S FIELD DOCUMENT HAS RULES THE PAGE TOOLS DID NOT KNOW.
 *
 * The platform REFUSES a save carrying two fields with one posted name or one
 * mapTo (forms/schema.go DeriveSchema → 409 duplicate_field_name /
 * duplicate_field_mapping), and stores, without a word, a manual choice field
 * with no options, a time slot whose hours produce no slot, and a booking form
 * with a third date field — check-in/out are the FIRST TWO dates in document
 * order (booking.go CheckBookingRules), so a third silently shifts the stay.
 */
const node = (id: string, type: string, parent: string | null, specials: Record<string, unknown> = {}, nodes: string[] = [], config: Record<string, unknown> = {}) => ({
  id,
  data: { type, parent, nodes, isCanvas: false, hidden: false, custom: {} },
  style: {},
  config,
  specials,
  responsive: {},
  events: [],
  bindings: [],
});

function formDoc(extra: Record<string, ReturnType<typeof node>> = {}, order?: string[]) {
  const kids = order ?? ['fm_t', 'fm_a', 'fm_b', ...Object.keys(extra), 'fm_s'];
  return {
    root_node_id: 'fm_1',
    nodes: {
      fm_1: node('fm_1', 'form', null, { formId: '', segmentId: '', formRules: '' }, kids),
      fm_t: node('fm_t', 'form-title', 'fm_1', { text: 'Đặt lịch' }),
      fm_a: node('fm_a', 'form-text', 'fm_1', { name: 'full_name', label: 'Họ và tên' }),
      fm_b: node('fm_b', 'form-text', 'fm_1', { name: 'phone', label: 'Số điện thoại', mapTo: 'customer.phone' }),
      ...extra,
      fm_s: node('fm_s', 'form-submit', 'fm_1', { text: 'Gửi' }),
    },
  };
}

describe('A — duplicate posted names / mappings refuse the save', () => {
  it('refuses two fields posting under one TRIMMED name, and names both nodes', () => {
    const doc = PageDoc.from(formDoc({ fm_c: node('fm_c', 'form-text', 'fm_1', { name: ' phone ' }) }));
    const problems = validateForSave(doc);
    expect(problems.join(' ')).toMatch(/fm_b.*fm_c.*"phone"/);
  });

  it('refuses two fields mapping the same column', () => {
    const doc = PageDoc.from(formDoc({ fm_c: node('fm_c', 'form-text', 'fm_1', { name: 'phone2', mapTo: 'customer.phone' }) }));
    expect(validateForSave(doc).join(' ')).toMatch(/customer\.phone/);
  });

  it('is case-sensitive, falls back to the node id, and skips titles — as DeriveSchema does', () => {
    const doc = PageDoc.from(
      formDoc({
        fm_c: node('fm_c', 'form-text', 'fm_1', { name: 'Phone' }),
        fm_d: node('fm_d', 'form-text', 'fm_1', { name: '' }),
        fm_e: node('fm_e', 'form-text', 'fm_1', { name: '  ' }),
        fm_t2: node('fm_t2', 'form-title', 'fm_1', { text: 'x' }),
      }),
    );
    expect(validateForSave(doc)).toEqual([]);
  });

  it('a page is untouched by the form rule', () => {
    const page = PageDoc.from({
      root_node_id: 'ROOT',
      nodes: {
        ROOT: node('ROOT', 'root', null, {}, ['a', 'b']),
        a: node('a', 'form-text', 'ROOT', { name: 'x' }),
        b: node('b', 'form-text', 'ROOT', { name: 'x' }),
      },
    });
    expect(validateForSave(page)).toEqual([]);
  });
});

describe('A — fields that can never be answered', () => {
  const codes = (doc: unknown, type?: string) => formFieldFindings(doc as never, type).map((f) => `${f.code}:${f.nodeId}`);

  it('a manual choice field with no options', () => {
    const d = formDoc({
      fm_c: node('fm_c', 'form-select', 'fm_1', { name: 'svc', options: [] }),
      fm_d: node('fm_d', 'form-radio', 'fm_1', { name: 'r', options: ['  '] }),
      fm_e: node('fm_e', 'form-checkbox', 'fm_1', { name: 'c', options: ['A'] }),
      // Fed from the catalogue: the authored list is only the fallback.
      fm_f: node('fm_f', 'form-select', 'fm_1', { name: 'p', options: [] }, [], { optionSource: 'products' }),
    });
    expect(codes(d)).toEqual(['form_options_empty:fm_c', 'form_options_empty:fm_d']);
  });

  it('a time slot whose hours produce no slot', () => {
    const d = formDoc({
      fm_c: node('fm_c', 'form-timeslot', 'fm_1', { name: 'a', start: '18:00', end: '09:00', step: 60 }),
      fm_d: node('fm_d', 'form-timeslot', 'fm_1', { name: 'b', start: '09:00', end: '18:00', step: 0 }),
      fm_e: node('fm_e', 'form-timeslot', 'fm_1', { name: 'c', start: '09:00', end: '09:30', step: 60 }),
      fm_f: node('fm_f', 'form-timeslot', 'fm_1', { name: 'd', start: '09:00', end: '18:00', step: 60 }),
    });
    expect(codes(d)).toEqual(['form_timeslot_dead:fm_c', 'form_timeslot_dead:fm_d', 'form_timeslot_dead:fm_e']);
  });

  it('a third date field on a BOOKING form only', () => {
    const d = formDoc({
      fm_c: node('fm_c', 'form-calendar', 'fm_1', { name: 'in' }),
      fm_d: node('fm_d', 'form-calendar', 'fm_1', { name: 'out' }),
      fm_e: node('fm_e', 'form-date', 'fm_1', { name: 'dob' }),
    });
    expect(codes(d, 'booking')).toEqual(['form_booking_dates:fm_e']);
    expect(codes(d, 'contact')).toEqual([]);
    expect(codes(d)).toEqual([]);
  });
});

describe('B — a new field lands above the send button, as the editor puts it', () => {
  it('inserts before a direct form-submit when no index is given', () => {
    const d = PageDoc.from(formDoc());
    const { patches, ids } = addSubtree(d, 'fm_1', { type: 'form-text' });
    applyPatches(d.doc as never, patches);
    const kids = d.doc.nodes.fm_1.data.nodes;
    expect(kids.indexOf(ids[0])).toBe(kids.indexOf('fm_s') - 1);
  });

  it('inserts before a step bar too, and an explicit index still wins', () => {
    const doc = {
      root_node_id: 'fm_1',
      nodes: {
        fm_1: node('fm_1', 'form', null, {}, ['sg']),
        sg: node('sg', 'form-segment', 'fm_1', {}, ['x', 'nav']),
        x: node('x', 'form-text', 'sg', { name: 'x' }),
        nav: node('nav', 'form-step-nav', 'sg'),
      },
    };
    const d = PageDoc.from(doc);
    const a = addSubtree(d, 'sg', { type: 'form-text' });
    expect(a.patches.at(-1)).toMatchObject({ op: 'insert', index: 1 });
    const b = addSubtree(d, 'sg', { type: 'form-text' }, 2);
    expect(b.patches.at(-1)).toMatchObject({ op: 'insert', index: 2 });
  });
  it('refuses a field on the ROOT of a step form — the platform reads only its segments', () => {
    const d = PageDoc.from({
      root_node_id: 'fm_1',
      nodes: {
        fm_1: node('fm_1', 'form', null, {}, ['sg']),
        sg: node('sg', 'form-segment', 'fm_1', {}, ['x']),
        x: node('x', 'form-text', 'sg', { name: 'x' }),
      },
    });
    expect(() => addSubtree(d, 'fm_1', { type: 'form-text' })).toThrow(/parent_id sg/);
    expect(() => addSubtree(d, 'fm_1', { type: 'form-segment' })).not.toThrow();
    expect(() => addSubtree(PageDoc.from(formDoc()), 'fm_1', { type: 'form-text' })).not.toThrow();
  });
});

/** The platform: a booking form whose record says so, and its document. */
function bookingPlatform(type = 'booking') {
  const p = fakePlatform((method, path) =>
    method === 'GET' && path === '/api/sites/s1/forms/frm_1'
      ? { form: { id: 'frm_1', name: 'Đặt lịch', type, settings: {} } }
      : undefined,
  );
  p.forms.set('frm_1', formDoc());
  return p;
}

describe('A/C — through the tools, on an open form document', () => {
  it('a rename that would clash: dry run says would_refuse, the real write refuses and sends nothing', async () => {
    const p = bookingPlatform();
    const { call, close } = await p.connect();
    await call('sb_page_open', { site_id: 's1', form_id: 'frm_1' });
    const dry = await call('sb_set', { id: 'fm_b', namespace: 'specials', keys: { name: 'full_name' } });
    expect(String(dry.json.would_refuse)).toMatch(/full_name/);
    const real = await call('sb_set', { id: 'fm_b', namespace: 'specials', keys: { name: 'full_name' }, dry_run: false });
    expect(real.isError).toBe(true);
    expect(p.writes.filter((w) => w.path.endsWith('/document'))).toEqual([]);
    await close();
  });

  it('warns on sb_set / sb_add, and sb_review reports the open document', async () => {
    const p = bookingPlatform();
    const { call, close } = await p.connect();
    await call('sb_page_open', { site_id: 's1', form_id: 'frm_1' });
    const add = await call('sb_add', {
      parent_id: 'fm_1',
      dry_run: false,
      spec: { type: 'form-select', specials: { name: 'svc', label: 'Dịch vụ', options: [] } },
    });
    expect(JSON.stringify(add.json.checks)).toMatch(/form_options_empty|no options/);
    for (const name of ['d1', 'd2', 'd3']) {
      await call('sb_add', { parent_id: 'fm_1', dry_run: false, spec: { type: 'form-calendar', specials: { name } } });
    }
    const review = await call('sb_review', {});
    const codes = ((review.json.findings ?? []) as Array<{ code: string }>).map((f) => f.code);
    expect(codes).toContain('form_options_empty');
    expect(codes).toContain('form_booking_dates');
    expect(Object.keys(review.json.fixes as object)).toContain('form_booking_dates');
    await close();
  });

  it('C — a field added without a name is told what its answers post under', async () => {
    const p = bookingPlatform();
    const { call, close } = await p.connect();
    await call('sb_page_open', { site_id: 's1', form_id: 'frm_1' });
    const add = await call('sb_add', { parent_id: 'fm_1', spec: { type: 'form-text', specials: { label: 'Dịch vụ' } } });
    const checks = (add.json.checks ?? []) as Array<{ code: string; key: string; fix: string }>;
    const note = checks.find((c) => c.key === 'specials.name');
    expect(note?.fix).toContain('"dich_vu"');
    await close();
  });
});

describe('E — sb_store action:"form" settings', () => {
  function storePlatform(refuse = false) {
    const puts: Array<{ path: string; body: unknown }> = [];
    const p = fakePlatform((method, path, body) => {
      if (method === 'POST' && path === '/api/sites/s1/forms') {
        if (refuse) return undefined;
        return { form: { id: 'frm_1', name: 'x', type: (body as { type: string }).type, settings: { notify: { owner: true } } } };
      }
      if (method === 'PUT' && path === '/api/sites/s1/forms/frm_1') {
        puts.push({ path, body });
        return { form: body };
      }
      return undefined;
    });
    return { p, puts };
  }

  it('previews the merged settings and warns on a key the platform does not read', async () => {
    const { p } = storePlatform();
    const { call, close } = await p.connect();
    const dry = await call('sb_store', {
      site_id: 's1',
      action: 'form',
      template: 'booking',
      settings: { booking: { maxPerSlot: 2, maxPerSlott: 3 }, colour: 'red' },
    });
    expect(dry.json.settings).toMatchObject({ booking: { maxPerSlot: 2 } });
    const warn = JSON.stringify(dry.json.settings_unknown);
    expect(warn).toContain('booking.maxPerSlott');
    expect(warn).toContain('colour');
    expect(warn).not.toContain('"booking.maxPerSlot"');
    expect(p.writes).toEqual([]);
    await close();
  });

  it('the PUT-whole step carries them, merged over what the platform returned', async () => {
    const { p, puts } = storePlatform();
    const { call, close } = await p.connect();
    const out = await call('sb_store', {
      site_id: 's1',
      action: 'form',
      template: 'stay',
      settings: { booking: { minStayNights: 2, maxStayNights: 14 } },
      dry_run: false,
    });
    expect(out.isError).toBe(false);
    expect(puts[0].body).toMatchObject({
      type: 'booking',
      settings: { notify: { owner: true }, booking: { minStayNights: 2, maxStayNights: 14 } },
    });
    await close();
  });

  it('a booking form on a site without the Booking app names the install', async () => {
    const { call, close } = await fakePlatformRefusing().connect();
    const r = await call('sb_store', { site_id: 's1', action: 'form', template: 'booking', dry_run: false });
    await close();
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/booking_app_required/);
    expect(r.text).toMatch(/action:"app" app_key:"booking"/);
  });
});

/** POST /forms answers 409 booking_app_required, as forms/rest.go does with the app absent. */
function fakePlatformRefusing() {
  return {
    async connect() {
      const { Session } = await import('../src/transport/auth.js');
      const { connectedClient } = await import('./harness.js');
      const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if ((init?.method ?? 'GET') === 'POST' && url.pathname === '/api/sites/s1/forms') {
          return new Response(
            JSON.stringify({ error: 'install the Booking app before creating a booking form', code: 'booking_app_required' }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch;
      const session = new Session('http://x', fetchImpl);
      (session as unknown as { access: string }).access = 'jwt';
      const { client, close } = await connectedClient({ fetchImpl, session });
      const call = async (name: string, args: Record<string, unknown>) => {
        const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text?: string }> };
        return { isError: !!res.isError, text: res.content.map((c) => c.text ?? '').join('') };
      };
      return { call, close };
    },
  };
}
