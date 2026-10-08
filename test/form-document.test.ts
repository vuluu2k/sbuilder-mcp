import { describe, it, expect } from 'vitest';
import { fakePlatform } from './helpers/platform.js';
import { FORM_RULE_VOCAB } from '../src/catalog/formrules.generated.js';
import { formRuleChecks } from '../src/domains/site/writecheck.js';

/**
 * A FORM'S FIELD DOCUMENT WAS WRITE-ONCE. `sb_store action:"form"` created it
 * and nothing could edit it afterwards — no default, no field, no dependent
 * rule. `sb_page_open form_id` opens it in the same session the page tools use,
 * saving through PUT …/forms/{id}/document.
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

function formDoc() {
  return {
    root_node_id: 'fm_1',
    nodes: {
      fm_1: node('fm_1', 'form', null, { formId: '', segmentId: '', formRules: '' }, ['fm_2', 'fm_3', 'fm_4']),
      fm_2: node('fm_2', 'form-select', 'fm_1', { name: 'delivery', label: 'Delivery' }),
      fm_3: node('fm_3', 'form-text', 'fm_1', { name: 'address', label: 'Address' }),
      fm_4: node('fm_4', 'form-submit', 'fm_1', { text: 'Send' }),
    },
  };
}

const rule = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  join: 'and',
  conditions: [{ field: 'delivery', op: 'is', value: 'ship' }],
  targets: [{ field: 'address', action: 'required' }],
  ...over,
});

const rulesOf = (doc: unknown) =>
  JSON.parse(String((doc as ReturnType<typeof formDoc>).nodes.fm_1.specials.formRules || '[]'));

describe('form rule vocabulary (codegen)', () => {
  it('carries the platform lists', () => {
    expect(FORM_RULE_VOCAB.joins).toEqual(['and', 'or']);
    expect(FORM_RULE_VOCAB.actions).toEqual(['hidden', 'shown', 'optional', 'required']);
    expect(FORM_RULE_VOCAB.ops).toEqual(expect.arrayContaining(['is', 'isNot', 'filled', 'empty']));
  });
});

describe('formRuleChecks', () => {
  const doc = formDoc();
  const codes = (v: unknown) => formRuleChecks(doc as never, v).map((n) => n.problem);

  it('is silent on a valid rule, as a string or an array, and on the empty seed', () => {
    expect(codes(JSON.stringify([rule()]))).toEqual([]);
    expect(codes([rule()])).toEqual([]);
    expect(codes('')).toEqual([]);
  });

  it('names each invalid case', () => {
    expect(codes('[{oops')).toEqual([expect.stringMatching(/not valid JSON/)]);
    expect(codes({ id: 'x' })).toEqual([expect.stringMatching(/must be a JSON array/)]);
    expect(codes([rule({ join: 'xor' })])).toEqual([expect.stringMatching(/join "xor"/)]);
    expect(codes([rule({ conditions: [{ field: 'delivery', op: 'equals', value: 'ship' }] })])).toEqual([
      expect.stringMatching(/op "equals"/),
    ]);
    expect(codes([rule({ targets: [{ field: 'address', action: 'show' }] })])).toEqual([
      expect.stringMatching(/action "show"/),
    ]);
    expect(codes([rule({ conditions: [{ field: 'nope', op: 'filled', value: '' }] })])).toEqual([
      expect.stringMatching(/"nope".*no field/),
    ]);
    // A named field is keyed by its NAME — its node id is not an answer key.
    expect(codes([rule({ targets: [{ field: 'fm_3', action: 'hidden' }] })])).toEqual([
      expect.stringMatching(/"fm_3".*no field/),
    ]);
    expect(codes([rule({ targets: [{ field: 'delivery', action: 'hidden' }] })])).toEqual([
      expect.stringMatching(/targets "delivery", which it also conditions on/),
    ]);
    expect(codes([rule({ id: '' })])).toEqual([expect.stringMatching(/no id/)]);
  });
});

describe('sb_page_open form_id', () => {
  it('edits a form document end to end: rule, save, reopen, undo; page paths say no', async () => {
    const fake = fakePlatform();
    fake.forms.set('f1', formDoc());
    const { call, close } = await fake.connect();
    try {
      const opened = await call('sb_page_open', { site_id: 's1', form_id: 'f1' });
      expect(opened.isError).toBe(false);
      expect(opened.json.form).toBe('f1');
      expect(JSON.stringify(opened.json.outline)).toContain('fm_3');

      // Every invalid write is reported in the dry run, and nothing is sent.
      const bad = await call('sb_set', {
        id: 'fm_1',
        namespace: 'specials',
        keys: { formRules: JSON.stringify([rule({ join: 'xor' })]) },
      });
      expect((bad.json.checks as Array<{ code: string }>).map((c) => c.code)).toEqual(['form_rule']);

      const good = await call('sb_set', {
        id: 'fm_1',
        namespace: 'specials',
        keys: { formRules: JSON.stringify([rule()]) },
        dry_run: false,
      });
      expect(good.isError).toBe(false);
      expect(good.json.checks).toBeUndefined();
      expect(rulesOf(fake.forms.get('f1'))).toEqual([rule()]);
      expect(fake.writes.filter((w) => w.method === 'PUT').map((w) => w.path)).toEqual([
        '/api/sites/s1/forms/f1/document',
      ]);

      // Round trip: a reopen reads back what was stored.
      await call('sb_page_open', { site_id: 's1', form_id: 'f1' });
      const read = await call('sb_node_read', { id: 'fm_1' });
      expect(JSON.stringify(read.json)).toContain('required');

      // Page-only paths refuse by name rather than act on a page that is not open.
      const look = await call('sb_look', {});
      expect(look.isError).toBe(true);
      expect(look.text).toMatch(/form f1's field document/);

      // sb_undo puts the previous field document back…
      const listed = await call('sb_undo', {});
      expect(JSON.stringify(listed.json.undoable)).toContain('put:/api/sites/{siteId}/forms/{id}/document');
      const undone = await call('sb_undo', { index: 1, dry_run: false });
      expect(undone.isError).toBe(false);
      expect(rulesOf(fake.forms.get('f1'))).toEqual([]);

      // …and the next write re-pulls first, so it does not save the rule back over the undo.
      await call('sb_set', { id: 'fm_3', namespace: 'specials', keys: { label: 'Street' }, dry_run: false });
      const stored = fake.forms.get('f1') as ReturnType<typeof formDoc>;
      expect(rulesOf(stored)).toEqual([]);
      expect(stored.nodes.fm_3.specials.label).toBe('Street');

      // A page still opens as a page.
      const page = await call('sb_page_open', { site_id: 's1', page_id: 'p1' });
      expect(page.isError).toBe(false);
      expect(page.json.form).toBeUndefined();
    } finally {
      await close();
    }
  });

  it('says so when the form has no field document', async () => {
    const fake = fakePlatform();
    const { call, close } = await fake.connect();
    try {
      const r = await call('sb_page_open', { site_id: 's1', form_id: 'missing' });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/no field document/);
    } finally {
      await close();
    }
  });
});
