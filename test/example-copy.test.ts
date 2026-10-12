import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { exampleCopy } from '../src/domains/site/examplecopy.js';
import { PATTERN_BY_ID, THEME_TOKENS } from '../src/domains/site/patterns.js';

/**
 * Measured on a store built end to end: the home page published the layouts'
 * example copy — and the agent instruction in an empty picture slot — while
 * sb_review called it clean.
 */
describe('example_copy', () => {
  const placed = (id: string) => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    d.apply(addSubtree(d, 'ROOT', PATTERN_BY_ID.get(id)!.build(THEME_TOKENS, [])!).patches);
    return reviewDesign(d).filter((f) => f.code === 'example_copy');
  };

  it('reports a hero placed and never rewritten, including the picture-slot instruction', () => {
    const texts = placed('sb_hero_split').map((f) => f.problem);
    expect(texts.some((t) => t.includes('Tiêu đề chính'))).toBe(true);
    expect(texts.some((t) => t.includes('sb_media_upload'))).toBe(true);
    expect(texts.some((t) => t.includes('"Mua ngay"'))).toBe(false);
  });

  it('treats invented figures and testimonials as example copy, never as labels', () => {
    const copy = exampleCopy();
    for (const s of ['1.000+', '4,9/5', 'Nguyễn Minh Anh', '30 ngày đổi ý, hoàn tiền nhanh.']) expect(copy.has(s), s).toBe(true);
    for (const s of ['Mua ngay', 'Xem tất cả', 'Sản phẩm nổi bật']) expect(copy.has(s), s).toBe(false);
  });

  it('goes quiet once the shop writes its own words', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const { patches, ids } = addSubtree(d, 'ROOT', PATTERN_BY_ID.get('sb_cta_band')!.build(THEME_TOKENS, [])!);
    d.apply(patches);
    for (const id of ids) {
      const sp = d.node(id).specials as Record<string, unknown>;
      if (typeof sp.text === 'string' && exampleCopy().has(sp.text)) sp.text = 'Trà mới vụ thu đã về.';
    }
    expect(reviewDesign(d).filter((f) => f.code === 'example_copy')).toEqual([]);
  });
});

describe('demo_variant_options and invisible_text', () => {
  const doc = () => PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const codes = (d: PageDoc) => reviewDesign(d).map((f) => f.code);

  it('reports the picker\'s seeded demo options, and not once they are cleared', () => {
    const d = doc();
    const { patches, ids } = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'product-variants' }] });
    d.apply(patches);
    expect(codes(d)).toContain('demo_variant_options');
    (d.node(ids[1]) as unknown as { config: Record<string, unknown> }).config.attributes = [];
    expect(codes(d)).not.toContain('demo_variant_options');
  });

  it('reports a button whose text is its own fill, and only on literal colours', () => {
    const d = doc();
    const { patches, ids } = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'button', specials: { text: 'Mua ngay' } }] });
    d.apply(patches);
    const style = (d.node(ids[1]) as unknown as { style: Record<string, unknown> }).style;
    Object.assign(style, { color: '#ffffff', backgroundColor: '#ffffff' });
    expect(codes(d)).toContain('invisible_text');
    style.backgroundColor = '#166534';
    expect(codes(d)).not.toContain('invisible_text');
    style.backgroundColor = 'var(--wb-color-primary)';
    expect(codes(d)).not.toContain('invisible_text'); // unknown ground: say nothing
  });
});

describe('the store seeds\' English copy, judged by the site\'s language', () => {
  it('is reported on a Vietnamese site and left alone on an English one', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'button', specials: { text: 'Add To Cart' } }] }).patches);
    const seed = (siteLocale?: string) => reviewDesign(d, { siteLocale }).filter((f) => f.code === 'default_seed_copy');
    expect(seed('vi')[0]?.problem).toMatch(/Thêm vào giỏ/);
    expect(seed('en')).toEqual([]);
    expect(seed(undefined)).toEqual([]);
  });
});

