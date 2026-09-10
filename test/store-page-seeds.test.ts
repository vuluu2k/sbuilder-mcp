import { describe, it, expect } from 'vitest';
import { hasSeed, seedDocument, seedSummary, seededTypes } from '../src/domains/site/storepage.js';
import {
  COMPLETION_HEADLINE,
  COMPLETION_HEADLINE_SENTINEL,
  STORE_PAGE_SEEDS,
} from '../src/catalog/storepages.generated.js';
import { PageDoc } from '../src/domains/site/document.js';

/**
 * storePageSeeds.ts opens with the argument for this, and it is about the AUTHOR
 * rather than the canvas: "the blank was not the problem — what the author had
 * to already know was". A merchant stopped being in that position when the
 * editor started seeding; an agent stayed in it, and sb_page_create told it "It
 * arrives empty" as though that were the platform's behaviour.
 */
describe('a store page opens with what the editor gives a merchant', () => {
  it('seeds the six store types and leaves an ordinary page blank', () => {
    expect(seededTypes().sort()).toEqual(
      ['blog', 'category', 'complete', 'post', 'product', 'search'].sort(),
    );
    expect(hasSeed('page')).toBe(false);
    expect(hasSeed(undefined)).toBe(false);
    expect(seedDocument('page')).toBeNull();
  });

  // THE BUY BOX IS THE ONE THAT MATTERS, and "it has nodes" is not proof it
  // buys anything: the button's BINDING is what adds to cart, not its click
  // action, and a card that lost it would still look like a product page.
  it('gives a product page a buy box that is actually wired to the cart', () => {
    const doc = seedDocument('product')!;
    const raw = JSON.stringify(doc);
    expect(raw).toContain('add_to_cart');
    expect(raw).toContain('bind-product-action');
    expect(Object.keys(doc.nodes).length).toBeGreaterThan(20);
  });

  // THE ROOT CAUSE OF A DEFECT THIS REPO ONLY HAD THE SYMPTOM OF.
  // completionPage.ts:91 returns `{ rootId: 'ROOT', nodes }` — no root_node_id
  // and no schema_version. CLAUDE.md records that such a document "renders an
  // EMPTY <body> with a 200 — the order-complete page of a real store did
  // exactly that", and now names where the alias came from. Normalised at
  // codegen, because this seed is PUT to a real page.
  it('never hands out the rootId alias that renders an empty body', () => {
    for (const type of seededTypes()) {
      const doc = seedDocument(type)!;
      expect(doc).not.toHaveProperty('rootId');
      expect(typeof doc.root_node_id).toBe('string');
      expect(doc.root_node_id).toBeTruthy();
      expect(doc.nodes[doc.root_node_id]).toBeDefined();
      expect(doc.schema_version).toBeGreaterThanOrEqual(1);
    }
  });

  it('produces a document this client can open', () => {
    for (const type of seededTypes()) {
      const d = PageDoc.from(seedDocument(type) as never);
      expect(d.doc.root_node_id).toBeTruthy();
      expect(Object.keys(d.doc.nodes).length).toBeGreaterThan(0);
    }
  });

  // A seeded page in the wrong language is the defect `default_seed_copy`
  // reports on everybody else's seeds. The platform ships the sentence in both.
  it("writes the thank-you line in the merchant's language, not English by default", () => {
    expect(COMPLETION_HEADLINE.vi).toBe('Cảm ơn bạn đã đặt hàng');
    expect(COMPLETION_HEADLINE.en).toBe('Thank you for your order');
    expect(JSON.stringify(seedDocument('complete'))).toContain(COMPLETION_HEADLINE.vi);
    expect(JSON.stringify(seedDocument('complete', { locale: 'en' }))).toContain(
      COMPLETION_HEADLINE.en,
    );
  });

  it("lets the caller's own wording win over both", () => {
    const raw = JSON.stringify(seedDocument('complete', { headline: 'Đơn đã nhận — cảm ơn!' }));
    expect(raw).toContain('Đơn đã nhận');
    expect(raw).not.toContain(COMPLETION_HEADLINE_SENTINEL);
    expect(raw).not.toContain(COMPLETION_HEADLINE.vi);
  });

  it('escapes a headline carrying a quote instead of breaking the document', () => {
    const doc = seedDocument('complete', { headline: 'Cảm ơn "bạn" \\ nhé' });
    expect(doc).not.toBeNull();
    expect(JSON.stringify(doc)).toContain('Cảm ơn');
  });

  it('substitutes the sentinel out of every seed it hands back', () => {
    for (const type of seededTypes()) {
      expect(JSON.stringify(seedDocument(type))).not.toContain(COMPLETION_HEADLINE_SENTINEL);
    }
  });

  it('hands back a COPY, so a caller mutating one seed cannot poison the next', () => {
    const a = seedDocument('product')!;
    a.nodes.injected = { hacked: true };
    expect(seedDocument('product')!.nodes.injected).toBeUndefined();
    expect(Object.keys(STORE_PAGE_SEEDS.product.nodes)).not.toContain('injected');
  });

  it('summarises what a seed will place, for the dry run', () => {
    expect(seedSummary('product')?.nodes).toBeGreaterThan(20);
    expect(seedSummary('page')).toBeNull();
  });
});
