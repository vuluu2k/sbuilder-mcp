import { describe, it, expect } from 'vitest';
import { BINDING_SOURCES, ELEMENTS } from '../src/catalog/elements.generated.js';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { bindNode } from '../src/tools/live.js';

describe('BINDING_SOURCES', () => {
  it('carries the keys the renderer actually provides', () => {
    expect(BINDING_SOURCES).toContain('product.title');
    expect(BINDING_SOURCES).toContain('product.price');
    expect(BINDING_SOURCES).toContain('category.title');
    expect(BINDING_SOURCES).toContain('article.title');
    expect(BINDING_SOURCES.length).toBeGreaterThan(15);
  });

  it('is sorted and unique, so a diff of the generated file is readable', () => {
    expect([...BINDING_SOURCES].sort()).toEqual(BINDING_SOURCES);
    expect(new Set(BINDING_SOURCES).size).toBe(BINDING_SOURCES.length);
  });
});

describe('the source list is complete enough not to cry wolf', () => {
  it('carries the keys the platform ITSELF seeds', () => {
    // pricing-dataset ships a binding to product.moneyOverride. Reading only
    // the Go renderer's context missed it, so sb_review reported the platform's
    // own element as a dead binding on every page that priced anything.
    // cartLine.variantLabel reaches a cart row through a row directive
    // (render/html.go rowDirectiveFor), never through a *Context scope.
    for (const seeded of ['product.moneyOverride', 'product.price', 'product.compareAtPrice', 'cartLine.variantLabel']) {
      expect(BINDING_SOURCES, seeded).toContain(seeded);
    }
  });

  it('every source an element seeds by default is a source the review accepts', () => {
    for (const el of Object.values(ELEMENTS)) {
      for (const b of (el.defaults.bindings ?? []) as Array<{ source?: string }>) {
        if (!b.source) continue;
        expect(BINDING_SOURCES, `${el.type} seeds ${b.source}`).toContain(b.source);
      }
    }
  });
});

// THE NAMESPACES USED TO BE A HAND-KEPT REGEX ALTERNATION, and `blogCategory.*`
// (blogCategoryContext) and `brand.*` (brandContext, web_builder f70fe86d1)
// arrived behind it unseen: sb_bind refused `brand.title`, and sb_review called
// a correct `blogCategory.image` binding dead. They are derived from every
// *Context function now; this pins the two that slipped through, at both doors.
describe('every entity context the renderer binds is a source', () => {
  const ENTITY_KEYS = [
    'blogCategory.title', 'blogCategory.image', 'brand.title', 'brand.description', 'brand.image',
    // Built by a namespace-parameterised helper (`tagContext(ns, t)`) — no literal
    // key in either file, so the literal-key reader dropped them (web_builder 2819884c2).
    'productTag.title', 'productTag.description', 'productTag.image', 'productTag.url',
    'blogTag.title', 'blogTag.description', 'blogTag.image', 'blogTag.url',
  ];

  it('lists blogCategory.* and brand.*', () => {
    for (const k of ENTITY_KEYS) expect(BINDING_SOURCES, k).toContain(k);
  });

  function headingDoc() {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'heading' }] }).patches);
    return { d, id: d.node(d.node('ROOT').data.nodes[0]).data.nodes[0] };
  }

  it('sb_bind accepts them', () => {
    for (const k of ENTITY_KEYS) {
      const { d, id } = headingDoc();
      expect(() => d.apply(bindNode(d, id, k, 'specials.text')), k).not.toThrow();
    }
  });

  it('a tag page supplies its own tag, and only its own', () => {
    for (const [pageType, key, other] of [
      ['product-tag', 'productTag.title', 'blog-tag'],
      ['blog-tag', 'blogTag.title', 'product-tag'],
    ] as const) {
      const { d, id } = headingDoc();
      d.apply(bindNode(d, id, key, 'specials.text'));
      const on = reviewDesign(d, { pageType }).map((f) => f.code);
      expect(on, `${key} on ${pageType}`).not.toContain('dead_binding_source');
      expect(on, `${key} on ${pageType}`).not.toContain('no_data_context');
      expect(reviewDesign(d, { pageType: other }).map((f) => f.code), `${key} on ${other}`).toContain('no_data_context');
      expect(reviewDesign(d, { pageType: 'page' }).map((f) => f.code), `${key} on page`).toContain('no_data_context');
    }
  });

  it('sb_review does not call them dead, and a brand page supplies the brand', () => {
    const { d, id } = headingDoc();
    d.apply(bindNode(d, id, 'brand.title', 'specials.text'));
    const onBrand = reviewDesign(d, { pageType: 'brand' }).map((f) => f.code);
    expect(onBrand).not.toContain('dead_binding_source');
    expect(onBrand).not.toContain('no_data_context');
    // …and a plain page does not: the heading would show its placeholder there.
    expect(reviewDesign(d, { pageType: 'page' }).map((f) => f.code)).toContain('no_data_context');

    const blog = headingDoc();
    blog.d.apply(bindNode(blog.d, blog.id, 'blogCategory.image', 'specials.text'));
    expect(reviewDesign(blog.d, { pageType: 'blog' }).map((f) => f.code)).not.toContain('dead_binding_source');
  });

  it('a cartLine field is supplied inside a cart-order and nowhere else', () => {
    const loose = headingDoc();
    loose.d.apply(bindNode(loose.d, loose.id, 'cartLine.quantity', 'specials.text'));
    expect(reviewDesign(loose.d, { pageType: 'checkout' }).map((f) => f.code)).toContain('no_data_context');

    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'cart-order', children: [{ type: 'heading' }] }] }).patches);
    const cart = d.node(d.node('ROOT').data.nodes[0]).data.nodes[0];
    const id = d.node(cart).data.nodes.find((c: string) => d.node(c).data.type === 'heading')!;
    d.apply(bindNode(d, id, 'cartLine.quantity', 'specials.text'));
    expect(reviewDesign(d, { pageType: 'checkout' }).filter((f) => f.code === 'no_data_context' && f.nodeId === id)).toEqual([]);
  });
});
