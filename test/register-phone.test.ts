import { describe, it, expect } from 'vitest';
import { fakePlatform } from './helpers/platform.js';
import { formFieldFindings } from '../src/domains/site/formdoc.js';
import { FORM_TEMPLATES } from '../src/catalog/checkout.generated.js';

/**
 * A REGISTER FORM'S PHONE IS READ BY CONTROL NAME (web_builder 6427c495b,
 * runtime/src/nodes/form.ts authValues): the island sends the control named
 * exactly `phone` — the palette's contact-phone row (editor contactFields.ts) —
 * and nothing else, so a phone field posting under any other name stores
 * nothing on the customer, with a 200.
 */
const node = (id: string, type: string, parent: string | null, specials: Record<string, unknown> = {}, nodes: string[] = []) => ({
  id,
  data: { type, parent, nodes, isCanvas: false, hidden: false, custom: {} },
  style: {},
  config: {},
  specials,
  responsive: {},
  events: [],
  bindings: [],
});

const reg = (specials: Record<string, unknown>) => ({
  root_node_id: 'fm_1',
  nodes: {
    fm_1: node('fm_1', 'form', null, {}, ['fm_e', 'fm_p', 'fm_s']),
    fm_e: node('fm_e', 'form-text', 'fm_1', { name: 'email', mapTo: 'customer.email', inputType: 'email' }),
    fm_p: node('fm_p', 'form-text', 'fm_1', specials),
    fm_s: node('fm_s', 'form-submit', 'fm_1', { text: 'Đăng ký' }),
  },
});

const codes = (doc: unknown, type?: string) => formFieldFindings(doc as never, type).map((f) => `${f.code}:${f.nodeId}`);

describe('a register form keeps its phone only under the name "phone"', () => {
  it('flags a phone-ish field (mapTo customer.phone, or a tel input) not named "phone" — on register only', () => {
    expect(codes(reg({ name: 'sdt', mapTo: 'customer.phone', inputType: 'tel' }), 'register')).toEqual(['form_register_phone:fm_p']);
    expect(codes(reg({ name: 'so_dien_thoai', inputType: 'tel' }), 'register')).toEqual(['form_register_phone:fm_p']);
    expect(codes(reg({ name: 'phone', mapTo: 'customer.phone', inputType: 'tel' }), 'register')).toEqual([]);
    expect(codes(reg({ name: 'sdt', mapTo: 'customer.phone', inputType: 'tel' }), 'contact')).toEqual([]);
  });

  // The re-entry box AHEAD of the phone, so a check that took it for the phone would name fm_c.
  const withConfirm = (confirm: Record<string, unknown>, phone: Record<string, unknown> = { name: 'sdt', inputType: 'tel' }) => {
    const doc = reg(phone) as { nodes: Record<string, unknown> };
    doc.nodes.fm_1 = node('fm_1', 'form', null, {}, ['fm_e', 'fm_c', 'fm_p', 'fm_s']);
    doc.nodes.fm_c = node('fm_c', 'form-text', 'fm_1', confirm);
    return doc;
  };

  it('a confirm box (mapTo confirmPhone, or tel with a re-entry name or label) beside the phone is not taken for it', () => {
    for (const c of [
      { name: 'confirm_phone', mapTo: 'customer.confirmPhone', inputType: 'tel' },
      { name: 'confirm_phone', inputType: 'tel' },
      { name: 'phoneConfirm', inputType: 'tel' },
      { name: 'sdt_2', label: 'Nhập lại số điện thoại', inputType: 'tel' },
      { name: 'xac_nhan_sdt', inputType: 'tel' },
    ]) {
      expect(codes(withConfirm(c), 'register'), c.name).toEqual(['form_register_phone:fm_p']);
      expect(codes(withConfirm(c, { name: 'phone', inputType: 'tel' }), 'register'), c.name).toEqual([]);
    }
    // mapTo customer.phone is the platform's own word for the phone — a name never overrides it.
    expect(codes(reg({ name: 'confirm', mapTo: 'customer.phone', inputType: 'tel' }), 'register')).toEqual(['form_register_phone:fm_p']);
  });

  it('a confirm-looking tel box that is the ONLY phone-like field is the phone, and is flagged', () => {
    for (const s of [
      { name: 'sdt', label: 'Số điện thoại xác nhận đơn', inputType: 'tel' },
      { name: 'ma', label: 'SĐT nhận mã xác nhận', inputType: 'tel' },
      { name: 'repeat_customer_phone', inputType: 'tel' },
      { name: 'confirmed_phone', inputType: 'tel' },
    ]) expect(codes(reg(s), 'register'), s.name).toEqual(['form_register_phone:fm_p']);
  });

  it('every platform form template that carries a phone names it "phone"', () => {
    for (const [key, tpl] of Object.entries(FORM_TEMPLATES)) {
      const doc = (tpl as { document: { nodes: Record<string, { specials?: Record<string, unknown> }> } }).document;
      for (const n of Object.values(doc.nodes)) {
        if (n.specials?.mapTo === 'customer.phone') expect(n.specials.name, key).toBe('phone');
      }
      expect(codes(doc, key).filter((c) => c.startsWith('form_register_phone')), key).toEqual([]);
    }
  });

  it('sb_add warns on an open register form, and sb_review reports it with a fix', async () => {
    const p = fakePlatform((method, path) =>
      method === 'GET' && path === '/api/sites/s1/forms/frm_1'
        ? { form: { id: 'frm_1', name: 'Đăng ký', type: 'register', settings: {} } }
        : undefined,
    );
    p.forms.set('frm_1', reg({ name: 'full_name', mapTo: 'customer.fullName' }));
    const { call, close } = await p.connect();
    try {
      await call('sb_page_open', { site_id: 's1', form_id: 'frm_1' });
      const add = await call('sb_add', {
        parent_id: 'fm_1',
        dry_run: false,
        spec: { type: 'form-text', specials: { name: 'sdt', label: 'Số điện thoại', inputType: 'tel' } },
      });
      const checks = (add.json.checks ?? []) as Array<{ key: string; fix: string }>;
      expect(checks.find((c) => c.key === 'specials.name')?.fix).toMatch(/"name": "phone"/);
      const review = await call('sb_review', {});
      expect(((review.json.findings ?? []) as Array<{ code: string }>).map((f) => f.code)).toContain('form_register_phone');
      expect((review.json.fixes as Record<string, string>).form_register_phone).toMatch(/"name": "phone"/);
    } finally {
      await close();
    }
  });
});
