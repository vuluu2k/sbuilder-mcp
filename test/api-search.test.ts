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

const WRITE = new Set(['POST', 'PUT', 'PATCH']);

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

  /**
   * THE INLINE IS NOW A FALLBACK NOTHING REACHES, and that is a measurement
   * rather than dead code.
   *
   * It used to be picked by "the first operation whose body is described and
   * which has no decode-site shape". MEASURED after reads stopped being
   * believed (`copiedBodyDonor`): NO operation is in that state — every WRITE
   * whose body the document describes also has a shape read off its handler,
   * and that wins above; every remaining candidate was a read carrying a copy.
   *
   * The branch stays because it is the honest answer for a handler the shape
   * reader cannot read, which is a state the platform can re-enter at any time.
   * It is exercised with a SYNTHETIC operation, so the test proves the
   * behaviour instead of quietly proving nothing the day a specimen vanishes —
   * which is exactly what happened here.
   */
  it('inlines the definition for a described body with no decode-site shape', () => {
    expect(
      API_OPERATIONS.filter(
        (o) => o.bodyDescribed && WRITE.has(o.method) && !REQUEST_SHAPES[o.id],
      ),
    ).toHaveLength(0);
    const donor = API_OPERATIONS.find((o) => o.bodyDescribed && o.bodyRef)!;
    const synthetic = {
      ...donor,
      id: 'put:/synthetic/not-a-registered-route',
      method: 'PUT',
      path: '/synthetic/not-a-registered-route',
    };
    const d = describeOperation(synthetic) as Record<string, unknown>;
    expect(d.body_schema).toBeDefined();
    expect(d.body_warning).toBeUndefined();
    expect(d.body_note).toBeUndefined();
  });

  it('never lists the body among plain params — it has its own field', () => {
    const op = searchOperations('', { limit: 400 }).find((o) => o.bodyDescribed)!;
    const d = describeOperation(op) as { params: Array<{ in: string }> };
    expect(d.params.every((p) => p.in !== 'body')).toBe(true);
  });

  it('warns when a body IS declared but has no schema to resolve', () => {
    const op = searchOperations('', { limit: 400 }).find(
      (o) =>
        o.params.some((p) => p.in === 'body') &&
        !o.bodyDescribed &&
        !REQUEST_SHAPES[o.id] &&
        WRITE.has(o.method),
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
    const described = searchOperations('', { limit: 500 }).find(
      (o) => o.bodyDescribed && WRITE.has(o.method),
    )!;
    expect(summarizeOperation(described).body).toBe('described');
    const loose = searchOperations('', { limit: 500 }).find(
      (o) => o.params.some((p) => p.in === 'body') && !o.bodyDescribed && WRITE.has(o.method),
    )!;
    expect(summarizeOperation(loose).body).toBe('undescribed');
  });

  /**
   * THIS REPLACES A TEST THAT PINNED THE OPPOSITE, and the reason it did is
   * worth keeping. It asserted that a GET declaring a body still reports one,
   * behind an `if (odd)` guard — the author was describing what the code then
   * did and treating such a GET as a rarity that might not exist in the
   * document at all. MEASURED, there are 90 of them, every one carrying a body
   * param byte-identical to some write's, because one doc comment over several
   * `@Router` lines gives every route in the block the same `@Param`. So it was
   * never an oddity, it was the stacking this file already corrects for prose.
   */
  it('omits a body on a read, whether it declares one or not', () => {
    const all = searchOperations('', { limit: 500 });
    const plain = all.find((o) => o.method === 'GET' && !o.params.some((p) => p.in === 'body'))!;
    expect(summarizeOperation(plain).body).toBeUndefined();
    const copied = all.find((o) => o.method === 'GET' && o.params.some((p) => p.in === 'body'))!;
    expect(copied, 'the document still stacks @Param onto reads').toBeDefined();
    expect(summarizeOperation(copied).body).toBeUndefined();
    // The call sheet says WHY rather than going silent, and names the donor so
    // the schema is still findable if the caller wants it.
    const d = describeOperation(copied) as Record<string, unknown>;
    expect(d.body_schema).toBeUndefined();
    expect(String(d.body_note)).toMatch(/VERBATIM copy of (GET|POST|PUT|PATCH) /);
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

/**
 * FILLING A CATALOGUE WAS REACHABLE AND THREE FACTS ABOUT IT WERE NOT: price
 * lives on the variant, a colliding slug is renamed rather than refused (so a
 * re-run doubles the catalogue in silence), and an image can be ingested from
 * a URL in one hop. All three are recorded in CLAUDE.md and none of them
 * reached the agent at the moment it decides what to send.
 */
describe('the product-write call sheet', () => {
  const sheetFor = (id: string): Record<string, unknown> =>
    describeOperation(API_OPERATIONS.find((o) => o.id === id)!) as Record<string, unknown>;

  it('attaches the note to a product create', () => {
    const traps = sheetFor('post:/api/sites/{siteId}/products').product_traps;
    expect(traps).toBeDefined();
  });

  it('attaches the note to a product replace, on both credential surfaces', () => {
    for (const id of ['put:/api/sites/{siteId}/products/{id}', 'post:/api/v1/products', 'put:/api/v1/products/{id}']) {
      expect(sheetFor(id).product_traps, id).toBeDefined();
    }
  });

  it('does not attach the note to a product listing', () => {
    expect(sheetFor('get:/api/sites/{siteId}/products').product_traps).toBeUndefined();
  });

  it('does not attach the note to a DELETE, an import, or an unrelated write', () => {
    for (const id of [
      'delete:/api/sites/{siteId}/products/{id}',
      'delete:/api/v1/products/{id}',
      'post:/api/sites/{siteId}/products/import',
      'put:/api/sites/{siteId}/products/{productId}/categories',
      'post:/api/sites/{siteId}/orders',
    ]) {
      expect(sheetFor(id).product_traps, id).toBeUndefined();
    }
  });

  it('names the three facts by substance, not by exact wording', () => {
    const traps = sheetFor('post:/api/sites/{siteId}/products').product_traps as Record<string, string>;
    const all = Object.values(traps).join(' ');
    expect(all).toMatch(/variant/i);
    expect(all.toLowerCase()).toContain('priceCents'.toLowerCase());
    expect(all).toMatch(/renam/i);
    expect(all).toMatch(/from-url/);
  });
});

/**
 * ONE DOC BLOCK OVER SEVERAL ROUTES — THE PROSE HALF.
 *
 * This file already pins the BODY correction (a decode site outranks the
 * document). The same stacking copies the SUMMARY, and nothing corrected that:
 * 302 of 524 operations share a summary. Most of it is an umbrella that is true
 * of each member and must stay unflagged; what is flagged is a summary whose
 * members have different literal path tails, so it can describe at most one.
 */
describe('a summary the platform wrote for several routes', () => {
  /**
   * THE COSTLIEST ONE IS MONEY. The platform documents `/refund` as RECORDING a
   * refund made elsewhere and `/refund-via-gateway` as ASKING the gateway to
   * send it; the document gives both — and `POST /payment-transactions`, which
   * opens a pay link — the single sentence "ASK the gateway to send the money
   * back". An agent that trusts it records a refund that never pays anybody.
   */
  it('names the other routes a shared summary covers', () => {
    const op = findOperation(
      'post:/api/sites/{siteId}/payment-transactions/{transactionId}/refund',
    )!;
    const d = describeOperation(op) as { summary_covers?: string[] };
    expect(d.summary_covers).toBeDefined();
    expect(d.summary_covers!.join(' ')).toContain('refund-via-gateway');
    expect(summarizeOperation(op).summary_shared).toBe(true);
  });

  /**
   * AN UMBRELLA IS NOT A DEFECT. "List, create, update or delete a course's
   * lessons" is true of all four routes, and flagging 261 operations like it
   * would bury the 41 that matter. The discriminator is the trailing literal
   * segment — the same signal `scripts/shapes.ts` uses to pick a handler out of
   * a dispatcher that routes by path.
   */
  it('leaves a summary alone when the routes are one resource', () => {
    const op = findOperation('get:/api/sites/{siteId}/customers')!;
    expect((describeOperation(op) as Record<string, unknown>).summary_covers).toBeUndefined();
    expect(summarizeOperation(op).summary_shared).toBeUndefined();
    // ...and it really is a shared summary, so this proves the filter and not
    // merely that the operation is unremarkable.
    const twin = findOperation('post:/api/sites/{siteId}/customers')!;
    expect(twin.summary).toBe(op.summary);
  });

  /** Scoped, not sprayed: a flag on most of the surface is not a flag. */
  it('stays a small share of the surface', () => {
    const flagged = API_OPERATIONS.filter((o) => summarizeOperation(o).summary_shared);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.length).toBeLessThan(API_OPERATIONS.length * 0.15);
  });
});

/**
 * THE SAME STACKING COPIES `@Param`, AND THE PARAMS ARE WHAT AN AGENT BUILDS
 * THE CALL FROM.
 */
describe('parameters the doc block duplicated', () => {
  it('lists each parameter once', () => {
    for (const op of API_OPERATIONS) {
      const names = (describeOperation(op) as { params: Array<{ name: string; in: string }> }).params
        .map((p) => `${p.in}:${p.name}`);
      expect(new Set(names).size, `${op.method} ${op.path}`).toBe(names.length);
    }
  });

  /**
   * Deduplication may only ever REMOVE a repeat. A path parameter the operation
   * genuinely needs must survive, and every `{param}` in a path must still be
   * listed — otherwise a call cannot be built at all.
   */
  it('still lists every path parameter the path declares', () => {
    for (const op of API_OPERATIONS) {
      const listed = new Set(
        (describeOperation(op) as { params: Array<{ name: string; in: string }> }).params
          .filter((p) => p.in === 'path')
          .map((p) => p.name),
      );
      for (const m of op.path.matchAll(/\{([^}]+)\}/g)) {
        expect(listed, `${op.method} ${op.path} lost {${m[1]}}`).toContain(m[1]);
      }
    }
  });
});
