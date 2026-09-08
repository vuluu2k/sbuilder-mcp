import { describe, it, expect } from 'vitest';
import { searchOperations, describeOperation, summarizeOperation, findOperation } from '../src/catalog/search.js';
import { REQUEST_SHAPES } from '../src/catalog/shapes.generated.js';

describe('searchOperations()', () => {
  it('finds menu operations from the word "menu"', () => {
    const hits = searchOperations('menu');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((o) => o.path.includes('menu') || o.tags.includes('menus'))).toBe(true);
  });

  it('ranks a tag match above an incidental path match', () => {
    const hits = searchOperations('products');
    expect(hits[0].tags.includes('products') || hits[0].path.includes('product')).toBe(true);
  });

  it('filters by tag when asked', () => {
    const hits = searchOperations('list', { tag: 'menus' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((o) => o.tags.includes('menus'))).toBe(true);
  });

  it('honours the limit', () => {
    expect(searchOperations('site', { limit: 3 }).length).toBeLessThanOrEqual(3);
  });

  it('returns an empty list rather than everything for nonsense', () => {
    expect(searchOperations('zzzzqqqq')).toEqual([]);
  });

  it('is deterministic — equal scores break by id, not by map order', () => {
    const a = searchOperations('page').map((o) => o.id);
    const b = searchOperations('page').map((o) => o.id);
    expect(a).toEqual(b);
  });
});

describe('describeOperation()', () => {
  it('warns that a write op declaring no body may simply be un-annotated', () => {
    // NOT `PUT .../source` any more, and that is the point: the handler scan now
    // reads its `{ document, schemaVersion }` off the decode site — the shape
    // CLAUDE.md records somebody having to read out of the editor's own
    // `saveSource` by hand. This note is for what is still unshaped.
    const op = searchOperations('', { limit: 600 }).find(
      (o) =>
        ['POST', 'PUT', 'PATCH'].includes(o.method) &&
        !o.params.some((p) => p.in === 'body') &&
        !REQUEST_SHAPES[o.id],
    )!;
    expect(op).toBeDefined();
    const d = describeOperation(op) as Record<string, unknown>;
    expect(String(d.body_note)).toMatch(/declares NO request body/i);
  });

  it('inlines the definition when the body IS described', () => {
    const op = searchOperations('', { limit: 400 }).find(
      (o) => o.bodyDescribed && !REQUEST_SHAPES[o.id],
    )!;
    const d = describeOperation(op) as Record<string, unknown>;
    expect(d.body_schema).toBeDefined();
    expect(d.body_warning).toBeUndefined();
  });

  it('never lists the body among plain params — it has its own field', () => {
    const op = searchOperations('', { limit: 400 }).find((o) => o.bodyDescribed)!;
    const d = describeOperation(op) as { params: Array<{ in: string }> };
    expect(d.params.every((p) => p.in !== 'body')).toBe(true);
  });

  it('warns when a body IS declared but has no schema to resolve', () => {
    const op = searchOperations('', { limit: 400 }).find(
      (o) => o.params.some((p) => p.in === 'body') && !o.bodyDescribed && !REQUEST_SHAPES[o.id],
    )!;
    expect(op).toBeDefined();
    const d = describeOperation(op) as Record<string, unknown>;
    expect(String(d.body_warning)).toMatch(/does not describe its shape/i);
    expect(d.body_note).toBeUndefined();
  });

  it('keeps the two under-description cases distinct - never both at once', () => {
    for (const op of searchOperations('', { limit: 400 })) {
      const d = describeOperation(op) as Record<string, unknown>;
      expect(d.body_warning !== undefined && d.body_note !== undefined).toBe(false);
    }
  });
});

describe('summarizeOperation()', () => {
  it('names params with ? on optional ones and never inlines a schema', () => {
    const op = searchOperations('media', { limit: 50 }).find(
      (o) => o.path.endsWith('/media') && o.method === 'GET',
    )!;
    const s = summarizeOperation(op);
    expect(s.params).toContain('siteId');
    expect(s.params.some((p) => p.startsWith('?'))).toBe(true);
    expect('body_schema' in s).toBe(false);
    expect(JSON.stringify(s).length).toBeLessThan(400);
  });

  it('gives the three body verdicts as one word', () => {
    const put = searchOperations('source', { limit: 50 }).find(
      (o) => o.method === 'PUT' && o.path.endsWith('/source'),
    )!;
    expect(summarizeOperation(put).body).toBe('none_declared');
    const described = searchOperations('', { limit: 500 }).find((o) => o.bodyDescribed)!;
    expect(summarizeOperation(described).body).toBe('described');
    const loose = searchOperations('', { limit: 500 }).find(
      (o) => o.params.some((p) => p.in === 'body') && !o.bodyDescribed,
    )!;
    expect(summarizeOperation(loose).body).toBe('undescribed');
  });

  it('omits body on a read that declares none, and still reports one a GET declares', () => {
    const all = searchOperations('', { limit: 500 });
    const plain = all.find((o) => o.method === 'GET' && !o.params.some((p) => p.in === 'body'))!;
    expect(summarizeOperation(plain).body).toBeUndefined();
    const odd = all.find((o) => o.method === 'GET' && o.params.some((p) => p.in === 'body'));
    if (odd) expect(summarizeOperation(odd).body).toBeDefined();
  });

  it('defaults to eight matches', () => {
    expect(searchOperations('site').length).toBeLessThanOrEqual(8);
  });
});

describe('findOperation()', () => {
  it('returns the operation by id, or undefined', () => {
    expect(findOperation('get:/api/sites')?.method).toBe('GET');
    expect(findOperation('nope')).toBeUndefined();
  });
});

describe('request shapes — the handler outranks the document', () => {
  it('gives PUT .../source the shape a human had to read out of the editor', () => {
    const op = findOperation('put:/api/sites/{siteId}/pages/{pageId}/source')!;
    const d = describeOperation(op) as { body_shape?: { fields: Array<{ name: string }> } };
    // CLAUDE.md records this body as `{ document, schemaVersion }`, discovered by
    // reading `editor/src/features/pages/api.ts:115` by hand because the OpenAPI
    // document declares no body for it at all. The generator recovers both.
    const names = d.body_shape?.fields.map((f) => f.name) ?? [];
    expect(names).toContain('document');
    expect(names).toContain('schemaVersion');
  });

  it('keeps the trap a field comment carries, not just the field name', () => {
    const op = findOperation('post:/api/sites/{siteId}/shipping-methods')!;
    const d = describeOperation(op) as {
      body_shape?: { fields: Array<{ name: string; note?: string }> };
    };
    const free = d.body_shape?.fields.find((f) => f.name === 'freeOverCents');
    // "ZERO MEANS 'never free', not 'always free'" is in the SECOND sentence of
    // that field's comment. A shape that kept only the first would ship a store
    // that delivers everything for nothing.
    expect(free?.note).toMatch(/ZERO MEANS/);
  });

  it('says which fields the platform owns, so a create does not send an id', () => {
    const op = findOperation('post:/api/sites/{siteId}/products')!;
    const d = describeOperation(op) as { body_shape?: { readOnly?: string[] } };
    expect(d.body_shape?.readOnly).toContain('id');
    expect(d.body_shape?.readOnly).toContain('siteId');
  });

  it('drops the two under-description warnings once a shape is known', () => {
    for (const id of Object.keys(REQUEST_SHAPES)) {
      const op = findOperation(id);
      if (!op) continue;
      const d = describeOperation(op) as Record<string, unknown>;
      expect(d.body_warning, id).toBeUndefined();
      expect(d.body_note, id).toBeUndefined();
    }
  });

  it('shapes a clear majority of writes — a scan that stops matching is silent', () => {
    const writes = searchOperations('', { limit: 600 }).filter((o) =>
      ['POST', 'PUT', 'PATCH'].includes(o.method),
    );
    const shaped = writes.filter((o) => REQUEST_SHAPES[o.id] || (o.bodyDescribed && o.bodyRef));
    expect(shaped.length / writes.length).toBeGreaterThan(0.6);
  });
});
