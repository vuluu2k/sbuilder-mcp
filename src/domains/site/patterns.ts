import type { NodeSpec } from './builder.js';
import { toSpecs, type Captured, type PageTokens } from './importmap.js';

/**
 * THE COMPOSITIONS A PAGE IS MADE OF, which nothing here had.
 *
 * An agent asked for "a hero" or "a features band" had 111 ELEMENTS and no
 * LAYOUT. Every band was invented from flex-blocks on the spot, which is exactly
 * why a generated page reads as generated: the elements are right, the
 * composition is a guess, and the guess is different on every section of the
 * same site.
 *
 * The platform's own library is the first place to look and it is thin —
 * measured on a live site: TWO section templates. `sb_templates` lists those
 * first and these second, because a template a merchant designed beats a
 * default every time.
 *
 * BUILT AS `Captured` TREES AND RUN THROUGH `toSpecs`, never hand-assembled.
 * That is the whole design of this file: the mapper already knows how to dress a
 * section in the page's own tokens (rule 0), how to give a row a stack
 * breakpoint (rule 3), and how to keep a stacked column from becoming 280px of
 * air. A pattern written by hand would re-derive all of it and drift from it on
 * the next fix; a pattern written as capture inherits every one of them, and
 * every fix that lands there lands here too.
 */
export interface LayoutPattern {
  id: string;
  name: string;
  /** What it is for, in the words a caller would use to look for it. */
  use: string;
  /**
   * How many PICTURE SLOTS this band can fill, when the library has that many.
   *
   * Declared rather than derived, because the count is only discoverable by
   * building the band against a pool big enough to saturate it — and the caller
   * needs it BEFORE that, to know how many photographs to go and get. A site
   * this server has just built has an empty library, so without the number the
   * agent finds out how short it was by reading a sentence where a photo
   * should be.
   */
  images?: number;
  build: (t: PageTokens, pool?: MediaPick[]) => NodeSpec | null;
}

/** One image the site already owns. */
export interface MediaPick {
  url: string;
  name?: string;
  width?: number;
  height?: number;
}

/**
 * A REAL IMAGE, from the site's own library, or nothing.
 *
 * The instinct a pattern library invites is a placeholder — a grey box, a stock
 * photo keyed off a word — and both are worse than an empty slot. This repo
 * already records why stock is not a source: `loremflickr` answered
 * "kids,clothing" with a cat statue and a photo of an adult, and ten photos from
 * ten sources read as a scrape. A grey box reads as unfinished, which it is.
 *
 * The library is the honest source: those are the merchant's own images, already
 * uploaded, already the right subject. Measured on a live store: 164 assets, 50
 * of them images. A `want` of "landscape" is a shape request, not a subject one —
 * a hero panel filled with a portrait crop is the aspect-ratio mistake rule 6 is
 * about — and it degrades to any unused image rather than to none.
 */
function pick(pool: MediaPick[] | undefined, used: Set<string>, want: 'landscape' | 'any'): MediaPick | null {
  if (!pool?.length) return null;
  const free = pool.filter((m) => m.url && !used.has(m.url));
  const wide = free.filter((m) => (m.width ?? 0) > (m.height ?? 0));
  const chosen = (want === 'landscape' && wide[0]) || free[0] || null;
  if (chosen) used.add(chosen.url);
  return chosen;
}

/**
 * THE LOOK A PAGE HAS BEFORE IT HAS ANYTHING, and it is not nothing.
 *
 * Rule 0 says read the page's own pattern. A blank page has none — and the next
 * authority is not invention, it is the SITE'S THEME, which is where every
 * element's style preset resolves from anyway.
 *
 * Written as `var(--wb-color-…)` rather than as the hex those resolve to, which
 * is the whole point: a literal on a node OUTRANKS the preset beneath it
 * permanently, so a pattern that baked today's `#171717` in would stop following
 * the theme the moment the merchant changed it — the exact detachment this repo
 * already records for imported icons. The variable is what the theme's own
 * scheme roles use.
 */
export const THEME_TOKENS: PageTokens = {
  headingColor: 'var(--wb-color-heading)',
  textColor: 'var(--wb-color-text)',
  buttonBg: 'var(--wb-color-primary)',
  buttonColor: '#ffffff',
  // A PAGE WITH NO MEASURE IS NOT AN UNSTYLED PAGE, IT IS A WRONGLY STYLED ONE.
  //
  // `sectionMaxWidth` is read off the TARGET page so an imported band matches
  // what is already there — and a blank page offers nothing to read, so it came
  // out unbounded. MEASURED at 1440 on a page built entirely by these tools:
  // every block 1392px wide, every heading and paragraph set on a 1392px line.
  // That is roughly 200 characters where prose is readable at 60-75, and it is
  // the single loudest way a generated page announces itself.
  //
  // Unbounded was a decision too, and the worse one. This is the same class of
  // answer as the `64px 24px` padding and the `16px` gap the mapper already
  // commits to for a page that cannot answer for itself.
  sectionMaxWidth: '1200px',
};

/** One section, through the same mapper an import goes through. */
function section(
  children: Captured[],
  t: PageTokens,
  style?: Record<string, unknown>,
  innerStyle?: Record<string, unknown>,
): NodeSpec | null {
  const [spec] = toSpecs([{ kind: 'section', children }], t);
  if (!spec) return null;
  const outer = style ? { ...spec, style: { ...spec.style, ...style } } : spec;
  if (!innerStyle) return outer;
  // THE SECTION CENTRES ITS BLOCK; THE BLOCK CENTRES ITS CHILDREN. `textAlign`
  // moves the words and leaves a `width: fit-content` button where it was, so a
  // centred band came out with its call to action against the left margin.
  const [inner, ...rest] = outer.children ?? [];
  if (!inner) return outer;
  return {
    ...outer,
    children: [{ ...inner, style: { ...inner.style, ...innerStyle } }, ...rest],
  };
}

const row = (children: Captured[], wrap = false, align?: Captured['align']): Captured => ({
  kind: 'group',
  direction: 'row',
  wrap,
  ...(align ? { align } : {}),
  children,
});

const h = (text: string, level = 2): Captured => ({ kind: 'heading', level, text });
const p = (text: string): Captured => ({ kind: 'text', text });
const cta = (text: string, href = '#'): Captured => ({ kind: 'button', variant: 'cta', text, href });
/**
 * The picture slot: a real image when the site has one, and WORDS when it does
 * not.
 *
 * An image with no src is dropped by the mapper, which is right — an empty frame
 * is not content — so the fallback is a sentence naming the call that fills it,
 * not a grey box. A grey box reads as unfinished because it is.
 */
const img = (m: MediaPick | null, alt: string, hint: string): Captured =>
  m
    ? { kind: 'image', src: m.url, alt: m.name ?? alt }
    : { kind: 'text', text: hint };

/**
 * The set. Deliberately small and deliberately ordinary: these are the bands
 * every commercial page is built from, and a library that tried to be clever
 * would be a library nobody could predict.
 */
export const LAYOUT_PATTERNS: LayoutPattern[] = [
  {
    id: 'sb_hero_split',
    name: 'Hero — hai cột',
    use: 'Mở đầu trang: tiêu đề, một câu, nút hành động bên trái; chỗ cho ảnh bên phải',
    images: 1,
    build: (t, pool) => {
      const used = new Set<string>();
      return section(
        [
          // CENTRED, because a hero's two columns are unequal BY DESIGN: a few
          // words on one side, a photograph on the other. Top-aligned they
          // measured 154px beside 420px, and the band read as a caption that
          // had slipped off the picture.
          row([
            { kind: 'group', direction: 'column', children: [h('Tiêu đề chính', 1), p('Một câu nói rõ bạn bán gì và cho ai.'), cta('Mua ngay')] },
            {
              kind: 'group',
              direction: 'column',
              children: [
                img(
                  pick(pool, used, 'landscape'),
                  'Ảnh mở đầu',
                  'Chưa có ảnh nào trong thư viện — sb_media_upload một URL, rồi sb_set src lên khối này.',
                ),
              ],
            },
          ], false, 'center'),
        ],
        t,
      );
    },
  },
  {
    id: 'sb_hero_centered',
    name: 'Hero — canh giữa',
    use: 'Mở đầu trang khi chưa có ảnh: tiêu đề lớn, một câu, một nút',
    build: (t) =>
      section(
        [h('Tiêu đề chính', 1), p('Một câu nói rõ bạn bán gì và cho ai.'), cta('Mua ngay')],
        t,
        { alignItems: 'center', textAlign: 'center' },
        { alignItems: 'center' },
      ),
  },
  {
    id: 'sb_feature_trio',
    name: 'Ba lợi ích',
    use: 'Ba cột ngang nhau: mỗi cột một tiêu đề nhỏ và một đoạn — lý do nên mua',
    build: (t) =>
      section(
        [
          h('Vì sao chọn chúng tôi'),
          row([
            { kind: 'group', direction: 'column', children: [h('Lợi ích một', 3), p('Một hoặc hai câu.')] },
            { kind: 'group', direction: 'column', children: [h('Lợi ích hai', 3), p('Một hoặc hai câu.')] },
            { kind: 'group', direction: 'column', children: [h('Lợi ích ba', 3), p('Một hoặc hai câu.')] },
          ]),
        ],
        t,
      ),
  },
  {
    id: 'sb_stats_row',
    name: 'Dải số liệu',
    use: 'Ba đến bốn con số lớn với nhãn bên dưới — bằng chứng, không phải lời hứa',
    build: (t) =>
      section(
        [
          row([
            { kind: 'group', direction: 'column', children: [h('1.000+', 2), p('Khách hàng')] },
            { kind: 'group', direction: 'column', children: [h('4,9/5', 2), p('Đánh giá trung bình')] },
            { kind: 'group', direction: 'column', children: [h('24h', 2), p('Giao trong nội thành')] },
          ]),
        ],
        t,
        { alignItems: 'center', textAlign: 'center' },
        { alignItems: 'center' },
      ),
  },
  {
    id: 'sb_cta_band',
    name: 'Dải kêu gọi hành động',
    use: 'Một câu và một nút, đặt cuối trang hoặc giữa hai band nội dung',
    build: (t) =>
      section(
        [h('Sẵn sàng bắt đầu?'), p('Một câu nhắc lại lời hứa chính.'), cta('Mua ngay')],
        t,
        { alignItems: 'center', textAlign: 'center' },
        { alignItems: 'center' },
      ),
  },
  {
    id: 'sb_gallery',
    name: 'Dải ảnh',
    images: 6,
    use: 'Một hàng ảnh cuốn dòng, lấy từ thư viện ảnh của chính site',
    build: (t, pool) => {
      const used = new Set<string>();
      const shots: Captured[] = [];
      // SIX IS A WALL, THREE IS A ROW. Bounded because a gallery is a design
      // decision and not a dump of the library — a merchant with 164 assets does
      // not want 164 of them in one band.
      for (let i = 0; i < 6; i += 1) {
        const m = pick(pool, used, 'any');
        if (!m) break;
        shots.push({ kind: 'image', src: m.url, alt: m.name ?? 'Ảnh' });
      }
      if (shots.length === 0) {
        return section(
          [
            h('Thư viện ảnh'),
            p('Chưa có ảnh nào trong thư viện — sb_media_upload một URL rồi dựng lại dải này.'),
          ],
          t,
        );
      }
      return section([h('Thư viện ảnh'), row(shots, true)], t);
    },
  },
  {
    id: 'sb_faq',
    name: 'Câu hỏi thường gặp',
    use: 'Ba câu hỏi mở/đóng — nơi trả lời những gì cản trở việc mua',
    build: (t) =>
      section(
        [
          h('Câu hỏi thường gặp'),
          {
            kind: 'accordion',
            children: [
              { kind: 'accordion-item', text: 'Giao hàng mất bao lâu?', children: [p('Trả lời ngắn gọn.')] },
              { kind: 'accordion-item', text: 'Đổi trả thế nào?', children: [p('Trả lời ngắn gọn.')] },
              { kind: 'accordion-item', text: 'Thanh toán ra sao?', children: [p('Trả lời ngắn gọn.')] },
            ],
          },
        ],
        t,
      ),
  },
];

export const PATTERN_BY_ID = new Map(LAYOUT_PATTERNS.map((p2) => [p2.id, p2]));
