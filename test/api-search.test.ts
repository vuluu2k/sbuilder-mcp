import { describe, it, expect } from 'vitest';
import { searchOperations, describeOperation, summarizeOperation, findOperation } from '../src/catalog/search.js';
import { REQUEST_SHAPES } from '../src/catalog/shapes.generated.js';
import { API_OPERATIONS } from '../src/catalog/api.generated.js';

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

describe('nested shapes — where the price actually lives', () => {
  it('expands a variant list, because a product carries no price of its own', () => {
    const op = findOperation('post:/api/v1/products')!;
    const d = describeOperation(op) as {
      body_shape?: { fields: Array<{ name: string; fields?: Array<{ name: string }> }> };
    };
    const variants = d.body_shape?.fields.find((f) => f.name === 'variants');
    expect(variants).toBeDefined();
    // `products.Product` has no price column at all — price is a variant's. A
    // shape that stopped at the type name told an agent everything except the one
    // field that decides whether the store can take money.
    expect(variants?.fields?.map((f) => f.name)).toContain('priceCents');
  });

  it('stops at one level, so a shape stays an argument rather than a schema dump', () => {
    for (const [id, shape] of Object.entries(REQUEST_SHAPES)) {
      for (const f of shape.fields) {
        for (const inner of f.fields ?? []) {
          expect(inner.fields, `${id}.${f.name}.${inner.name}`).toBeUndefined();
        }
      }
    }
  });
});

describe('the scanner refuses rather than guesses', () => {
  it('gives no body to a POST that switches on a path segment, not a method', () => {
    // `sitedomain`'s `action` serves verify, primary, canonical, redirect and
    // redirect-code from one POST handler. Only verify and primary are annotated,
    // and neither takes a body — but three of its siblings decode one, so reading
    // the first decode in the arm handed both of them `{ canonical }`.
    expect(REQUEST_SHAPES['post:/api/sites/{siteId}/domains/{id}/verify']).toBeUndefined();
    expect(REQUEST_SHAPES['post:/api/sites/{siteId}/domains/{id}/primary']).toBeUndefined();
  });

  it('leaves no shape with an empty field list', () => {
    for (const [id, shape] of Object.entries(REQUEST_SHAPES)) {
      expect(shape.fields.length, id).toBeGreaterThan(0);
    }
  });
});

/**
 * AN APP'S BLOCKS WERE REACHABLE AND UNUSABLE.
 *
 * Every route is in the catalog and `/apps/blocks` returns the rows, but the
 * one thing needed to PLACE one is a string format that exists only in Go:
 * `page/appblocks.go` spells SpecAppBlockRef as "<installId>/<blockKey>". An
 * agent had the list, the route, and no way to turn a row into a node.
 */
describe('the app-block call sheet', () => {
  const sheetFor = (id: string): Record<string, unknown> =>
    describeOperation(API_OPERATIONS.find((o) => o.id === id)!) as Record<string, unknown>;

  it('spells the reference format, which lives nowhere else on the wire', () => {
    const app = sheetFor('get:/api/sites/{siteId}/apps/blocks').app_blocks as Record<string, string>;
    expect(app.place).toContain('specials.appBlockRef');
    expect(app.place).toContain('<installId>/<blockKey>');
  });

  it('carries the two traps that fail silently', () => {
    // Authoring the composed stamp makes the next save decompose the node OVER
    // the app; an edit inside a composed block is stored nowhere at all.
    const app = sheetFor('get:/api/sites/{siteId}/apps').app_blocks as Record<string, string>;
    expect(app.never).toContain('appBlockId');
    expect(app.interior).toMatch(/stored nowhere/);
  });

  it('says which apps this server can install', () => {
    const app = sheetFor('post:/api/sites/{siteId}/builtin-apps/{key}').app_blocks as Record<string, string>;
    expect(app.installing).toMatch(/BUILT-IN/);
  });

  it('answers a MARKETPLACE app with what to show and what the credential allows', () => {
    // Neither "ask a human" nor "just install it". Suggesting is always
    // available; installing is the platform's own line — consent parses an
    // ACCESS TOKEN, so a session reaches it and an agent key does not, because
    // the app holds SCOPES against the store.
    const app = sheetFor('get:/api/sites/{siteId}/apps').app_blocks as Record<string, string>;
    expect(app.marketplace).toMatch(/authorize-info/);
    expect(app.marketplace).toMatch(/SCOPES/);
    expect(app.marketplace).toMatch(/SESSION/);
    // A paid app is refused without an accepted price rather than assumed, so
    // nothing automated can commit a merchant to a subscription.
    expect(app.marketplace).toMatch(/PAID one is refused/);
  });

  it('has both OAuth routes in the catalog at all, which is the point', () => {
    for (const id of ['get:/oauth/authorize-info', 'post:/oauth/authorize']) {
      expect(API_OPERATIONS.find((o) => o.id === id), id).toBeTruthy();
    }
  });

  it('NAMES EVERY INSTALLABLE KEY, because no route lists what is installable', () => {
    // GET /builtin-apps answers what is INSTALLED. The key parameter's own
    // description is the only place the installable set exists on the wire, and
    // it named two of eight until the platform's annotation was fixed.
    const op = API_OPERATIONS.find((o) => o.id === 'post:/api/sites/{siteId}/builtin-apps/{key}')!;
    const key = op.params!.find((p) => p.name === 'key')!;
    for (const k of ['mail', 'multilingual', 'agent', 'chat', 'booking', 'loyalty', 'payments', 'courses']) {
      expect(key.description, k).toContain(k);
    }
  });
});
