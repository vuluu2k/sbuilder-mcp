import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { writeCheck } from '../src/domains/site/writecheck.js';
import { inertHintsFor } from '../src/domains/site/inert.js';
import { bindNode } from '../src/tools/live.js';

/**
 * FOUR DEFECTS FOUND BUILDING A LIVE STOREFRONT, 2026-10-28: a rich special the
 * platform drops whole, a review false positive inside a cart row, an add hint
 * about a placement that was correct, and one paragraph said once per key.
 */

/* 1 ---------------------------------------------------------------------- */

describe('textHtml holding markup the rich-text schema cannot produce', () => {
  // scope.GateInlineRichSpecials deletes the WHOLE value when
  // sanitize.IsInlineRepresentable says no, and the node renders its escaped
  // plain `text` — measured live with a <p> in textHtml.
  it('warns, naming the block tag, and points at <br>', () => {
    const notes = writeCheck('text', 'specials', { textHtml: '<p>Một</p><p>Hai <b>ba</b></p>' }, { id: 't1' }).map((c) => c.note);
    const n = notes.find((x) => x.code === 'rich_dropped');
    expect(n, JSON.stringify(notes)).toMatchObject({ id: 't1', key: 'specials.textHtml' });
    expect(n!.problem).toMatch(/<p>/);
    expect(n!.problem).not.toMatch(/<b>/);
    expect(n!.problem).toMatch(/plain/i);
    expect(n!.fix).toMatch(/<br>/);
  });

  it('names an attribute outside the allowlist too', () => {
    const n = writeCheck('heading', 'specials', { textHtml: 'a <span class="x">b</span>' }).find((c) => c.note.code === 'rich_dropped');
    expect(n?.note.problem).toMatch(/span class/);
  });

  it('is silent on what the schema can produce', () => {
    for (const v of ['Hà Nội', 'a<br>b', '<strong>x</strong> <a href="/p" target="_blank">y</a>', '<span style="color:red">z</span>']) {
      expect(writeCheck('text', 'specials', { textHtml: v }).map((c) => c.note.code), v).not.toContain('rich_dropped');
    }
  });

  // web_builder's SHARED fixture (schema/test/inline-representable-cases.json),
  // which pins the Go gate and the editor's mirror case for case — copied here
  // by codegen so this suite needs no checkout.
  const { cases } = JSON.parse(readFileSync(new URL('./inline-representable-cases.generated.json', import.meta.url), 'utf8')) as {
    cases: Array<{ name: string; html: string; ok: boolean }>;
  };
  it.each(cases)('agrees with the platform gate: $name', ({ html, ok }) => {
    const dropped = writeCheck('text', 'specials', { textHtml: html }).some((c) => c.note.code === 'rich_dropped');
    expect(dropped).toBe(!ok);
  });

  it('reads past a ">" inside a quoted attribute value', () => {
    const n = writeCheck('text', 'specials', { textHtml: '<a title="a>b" class="x">t</a>' }).find((c) => c.note.code === 'rich_dropped');
    expect(n?.note.problem).toMatch(/a class/);
  });
});

/* 2 ---------------------------------------------------------------------- */

describe('no_data_context inside a cart line', () => {
  // CartLineContext (render/scope/scope.go) fills the EXISTING product.* keys,
  // so a product-bound element in a cart row is supplied per line.
  it('a product-bound node in cart-order > cart-item is supplied; a loose one is not', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    d.apply(
      addSubtree(d, 'ROOT', {
        type: 'flex-section',
        children: [{ type: 'cart-order', children: [{ type: 'cart-item', children: [{ type: 'heading' }] }] }, { type: 'heading' }],
      }).patches,
    );
    const nodes = Object.values(d.doc.nodes);
    const [inRow, loose] = nodes.filter((n) => n.data.type === 'heading').map((n) => n.id);
    const rowFirst = d.doc.nodes[d.doc.nodes[inRow].data.parent!].data.type === 'cart-item';
    const [row, out] = rowFirst ? [inRow, loose] : [loose, inRow];
    d.apply(bindNode(d, row, 'product.title', 'specials.text'));
    d.apply(bindNode(d, out, 'product.title', 'specials.text'));
    const flagged = reviewDesign(d, { pageType: 'checkout' }).filter((f) => f.code === 'no_data_context').map((f) => f.nodeId);
    expect(flagged).not.toContain(row);
    expect(flagged).toContain(out);
  });

  // Only cart-order renders its first child with PlaceholderCartLine
  // (render/nodes/cart-order/html.go), and CartLineContext fills exactly
  // product.title/image/price/priceCents — nothing else of a product.
  const review = (wrap: string[], leaf: string, sources?: string[]) => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    let spec: Record<string, unknown> = { type: leaf };
    for (const t of [...wrap].reverse()) spec = { type: t, children: [spec] };
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [spec] } as never).patches);
    // Under the LAST wrapper — cart-order mints an empty state holding a heading too.
    const id = Object.values(d.doc.nodes).find(
      (n) => n.data.type === leaf && d.doc.nodes[n.data.parent!]?.data.type === wrap[wrap.length - 1],
    )!.id;
    if (sources) {
      (d.doc.nodes[id] as { bindings?: unknown[] }).bindings = sources.map((s, i) => ({ id: `b${i}`, source: s, field: `specials.f${i}` }));
    }
    return { id, found: reviewDesign(d, { pageType: 'checkout' }).filter((f) => f.code === 'no_data_context' && f.nodeId === id) };
  };

  it('a cart-item with no cart-order around it supplies nothing', () => {
    expect(review(['cart-item'], 'heading', ['product.title']).found).toHaveLength(1);
  });

  it('cart-order > cart-item > heading bound to product.title is supplied', () => {
    expect(review(['cart-order', 'cart-item'], 'heading', ['product.title']).found).toEqual([]);
  });

  it('a product key the line does not fill still fires there', () => {
    const { found } = review(['cart-order', 'cart-item'], 'text', ['product.description']);
    expect(found).toHaveLength(1);
    expect(found[0].problem).toMatch(/cart line/);
  });

  it('a supplied product binding does not hide an unsupplied category one', () => {
    const { found } = review(['cart-order', 'cart-item'], 'heading', ['product.title', 'category.title']);
    expect(found.map((f) => f.key)).toEqual(['category']);
  });

  it('the platform cart seed shape is silent: seeded pricing and quantity in a line', () => {
    // pricing-dataset seeds compareAtPrice/moneyOverride/product.id beside
    // product.price; the line drives price and leaves the rest empty. The
    // stepper is driven by the row (CartOrder#inc, line.quantity) whatever it binds.
    expect(review(['cart-order', 'cart-item'], 'pricing-dataset').found).toEqual([]);
    expect(review(['cart-order', 'cart-item'], 'quantity-dataset').found).toEqual([]);
  });
});

/* 3 ---------------------------------------------------------------------- */

describe('a placement-dependent inert hint', () => {
  it('is silent when the node sits under its host, and said anywhere else', () => {
    expect(inertHintsFor([{ type: 'accordion-content', parent: 'accordion' }])).toEqual([]);
    expect(inertHintsFor([{ type: 'menu-drawer', parent: 'hamburger-menu' }])).toEqual([]);
    expect(inertHintsFor([{ type: 'accordion-content', parent: 'flex-section' }]).map((h) => h.type)).toEqual(['accordion-content']);
    // A hint that is not about placement does not care where the node sits.
    expect(inertHintsFor([{ type: 'breadcrumb', parent: 'flex-section' }]).map((h) => h.type)).toEqual(['breadcrumb']);
  });
});

/* 3 + 4: through sb_add / sb_set ------------------------------------------ */

const DOC = {
  schema_version: 2,
  root_node_id: 'ROOT',
  nodes: { ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: [] }, specials: {} } },
};

async function openClient() {
  const f = (async (url: unknown) => {
    const path = new URL(String(url)).pathname;
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/source')) return json({ source: { pageId: 'pg_1', siteId: 's1', document: structuredClone(DOC), schemaVersion: 2, rev: 1 } });
    return json({});
  }) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  const { client, close } = await connectedClient({ fetchImpl: f, session, siteId: 's1' });
  await client.callTool({ name: 'sb_page_open', arguments: { page_id: 'pg_1' } });
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text?: string }>; isError?: boolean };
    const raw = res.content.map((c) => c.text ?? '').join('');
    return { raw, isError: !!res.isError, json: (() => { try { return JSON.parse(raw); } catch { return null; } })() };
  };
  return { call, close };
}

describe('sb_add and sb_set notes', () => {
  it('sb_add says nothing inert about accordion-content placed under an accordion — root or nested', async () => {
    const { call, close } = await openClient();
    try {
      const acc = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: { type: 'flex-section', children: [{ type: 'accordion' }] } });
      expect(acc.isError, acc.raw).toBe(false);
      const accId = (acc.json.added as string[])[1];
      const root = await call('sb_add', { parent_id: accId, spec: { type: 'accordion-content' } });
      expect(root.isError, root.raw).toBe(false);
      expect(root.json.inert).toBeUndefined();
      const nested = await call('sb_add', { parent_id: 'ROOT', spec: { type: 'flex-section', children: [{ type: 'accordion', children: [{ type: 'accordion-content' }] }] } });
      expect(nested.isError, nested.raw).toBe(false);
      expect(nested.json.inert).toBeUndefined();
      // …and still said where it does not render.
      const wrong = await call('sb_add', { parent_id: 'ROOT', spec: { type: 'flex-section', children: [{ type: 'accordion-content' }] } });
      expect(wrong.json.inert).toMatch(/accordion/);
    } finally {
      await close();
    }
  });

  it('sb_set explains base-only ONCE and lists every moved key', async () => {
    const { call, close } = await openClient();
    try {
      const added = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: { type: 'flex-section', children: [{ type: 'list-dataset' }] } });
      const list = (added.json.added as string[])[1];
      const set = await call('sb_set', {
        id: list,
        namespace: 'config',
        breakpoint: 'mobile',
        keys: { collectionType: 'all_products', collectionId: '', quantity: 4 },
      });
      expect(set.isError, set.raw).toBe(false);
      const note = set.json.base_only as string;
      expect(note).toMatch(/collectionType, collectionId, quantity/);
      expect(note.match(/BASE only/g)).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it('sb_add explains base-only once for several moved keys', async () => {
    const { call, close } = await openClient();
    try {
      const added = await call('sb_add', {
        parent_id: 'ROOT',
        spec: { type: 'flex-section', children: [{ type: 'list-dataset', responsive: { mobile: { config: { quantity: 3, collectionType: 'all_products' } } } }] },
      });
      expect(added.isError, added.raw).toBe(false);
      const note = added.json.base_only as string;
      expect(note).toMatch(/quantity, collectionType/);
      expect(note.match(/BASE only/g)).toHaveLength(1);
    } finally {
      await close();
    }
  });
});
