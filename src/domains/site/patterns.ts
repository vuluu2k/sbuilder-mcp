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

const h = (text: string, level = 2, textAlign?: Captured['textAlign']): Captured => ({
  kind: 'heading',
  level,
  text,
  ...(textAlign ? { textAlign } : {}),
});
const p = (text: string, textAlign?: Captured['textAlign']): Captured => ({
  kind: 'text',
  text,
  ...(textAlign ? { textAlign } : {}),
});
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
/** A link beside a heading, never a filled button — "see all", not "buy now". */
const linkTo = (text: string, href = '#'): Captured => ({ kind: 'button', variant: 'link', text, href });
/** A leaf icon, by its exact platform RemixIcon id — never a guess. */
const icon = (name: string): Captured => ({ kind: 'icon', name });

/**
 * A CARD BOUND TO A REAL RECORD, never a static tile.
 *
 * `dataset-block`, `media-dataset`, `text-dataset` and `pricing-dataset` have no
 * `Captured` kind, and cannot: nothing an import ever WALKS produces one — a
 * repeater is a document's own data axis, not a shape a browser discovers. So
 * these are raw `NodeSpec`, hand-assembled, and that is the honest exception to
 * this file's own rule rather than a violation of it — the mapper has nothing
 * to say about a shape it was never taught.
 *
 * What still must not be hand-assembled is the BINDING. This function names
 * only `config.datasetSource` (and, where an element has a kind axis,
 * `config.kind`) — never a `source`/`field`/`target` triple — because
 * `bindingsForConfig` (through `createNode`, at `addSubtree` time) derives that
 * from the platform's own factory. This repo has already paid twice for the
 * alternative: a repeater switched to a category and left bound to
 * `product_list`, and a `sb_import` list rendered its rows three times over,
 * both because a binding was carried as a VALUE instead of being re-derived.
 */
function datasetCard(source: 'product' | 'category'): NodeSpec {
  const children: NodeSpec[] = [
    { type: 'media-dataset', config: { datasetSource: source } },
    { type: 'text-dataset', config: { datasetSource: source, kind: 'title' } },
  ];
  // A category has no price. Binding one anyway would not fail loudly — it
  // would read a product field off a category record and publish a card that
  // says "$0.00" under every collection, the exact class of silent mismatch
  // this repo keeps finding.
  if (source === 'product') {
    children.push({ type: 'pricing-dataset', config: { datasetSource: source, kind: 'prices' } });
  }
  return {
    type: 'dataset-block',
    config: { datasetSource: source },
    style: { display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', height: 'fit-content' },
    children,
  };
}

/**
 * The repeater itself — the catalogue's own rows, not a guess at how many
 * there are. `list-dataset`'s own defaults already answer the mobile axis
 * (`itemsPerRow`: 4 desktop, 2 tablet, 1 mobile) and mint the list's empty
 * state (`list-empty`, keyed to the same `datasetSource`), so nothing here
 * repeats either.
 */
function datasetShelf(source: 'product' | 'category'): NodeSpec {
  return { type: 'list-dataset', config: { datasetSource: source }, children: [datasetCard(source)] };
}

/**
 * Splice a raw `NodeSpec` (one `Captured` cannot describe) in after a
 * section's own `Captured` children, inside the same measured block.
 */
function withRepeater(built: NodeSpec | null, repeater: NodeSpec): NodeSpec | null {
  if (!built) return null;
  const [inner, ...rest] = built.children ?? [];
  if (!inner) return built;
  return { ...built, children: [{ ...inner, children: [...(inner.children ?? []), repeater] }, ...rest] };
}

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
        // Centred on the NODES, not left to the section's inherited textAlign —
        // the theme's heading preset declares its own and wins.
        [h('Tiêu đề chính', 1, 'center'), p('Một câu nói rõ bạn bán gì và cho ai.', 'center'), cta('Mua ngay')],
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
            { kind: 'group', direction: 'column', children: [h('1.000+', 2, 'center'), p('Khách hàng', 'center')] },
            { kind: 'group', direction: 'column', children: [h('4,9/5', 2, 'center'), p('Đánh giá trung bình', 'center')] },
            { kind: 'group', direction: 'column', children: [h('24h', 2, 'center'), p('Giao trong nội thành', 'center')] },
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
        // CENTRED ON THE NODES. The section's own `textAlign` is inherited, and
        // the theme's heading preset declares its own — so the band came out
        // with its words hard left and only the button in the middle.
        [h('Sẵn sàng bắt đầu?', 2, 'center'), p('Một câu nhắc lại lời hứa chính.', 'center'), cta('Mua ngay')],
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
      const picked: MediaPick[] = [];
      for (let i = 0; i < 6; i += 1) {
        const m = pick(pool, used, 'any');
        if (!m) break;
        picked.push(m);
      }
      // ONE FRAME FOR THE WALL, MEASURED RATHER THAN INVENTED.
      //
      // Rule 6 says match a frame's ratio to the ASSET, and a wall of
      // photographs is the case it does not cover: there is no single asset.
      // Left alone, every tile keeps its own shape and the grid's rows come out
      // different heights — measured on a real build, four tiles at 330x220 and
      // a fifth noticeably taller, which reads as unfinished.
      //
      // The MEDIAN of the pictures actually being shown is the honest frame:
      // most crop by nothing, the outliers crop least, and a library of
      // portraits gets a portrait wall rather than a landscape one imposed on
      // it. A picture whose size the library did not report votes for nothing.
      const ratios = picked
        .map((m) => (m.width && m.height ? m.width / m.height : 0))
        .filter((r) => r > 0)
        .sort((a, b) => a - b);
      const frame = ratios.length ? ratios[Math.floor(ratios.length / 2)].toFixed(2) : undefined;
      for (const m of picked) {
        shots.push({ kind: 'image', src: m.url, alt: m.name ?? 'Ảnh', ...(frame ? { ratio: frame } : {}) });
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
  // ---------------------------------------------------------------------
  // A STORE BUILDER SHIPPED SEVEN LAYOUT PATTERNS AND NONE OF THEM WAS A
  // STORE. The seven above close "an agent asked for a hero had 111
  // elements and no layout"; these four close the same gap one level up —
  // an agent asked for a shelf of featured products had `list-dataset` and
  // nothing telling it how to compose one.
  // ---------------------------------------------------------------------
  {
    id: 'sb_product_shelf',
    name: 'Kệ sản phẩm',
    use: 'Tiêu đề, link "xem tất cả", và một dải sản phẩm THẬT lấy tự động từ danh mục — không phải ô tĩnh',
    build: (t) =>
      withRepeater(
        section([row([h('Sản phẩm nổi bật', 2), linkTo('Xem tất cả')])], t),
        datasetShelf('product'),
      ),
  },
  {
    id: 'sb_category_strip',
    name: 'Dải danh mục',
    use: 'Các danh mục của cửa hàng dưới dạng ô ảnh + tên, lấy tự động từ danh mục thật — không phải ô tĩnh',
    build: (t) => withRepeater(section([h('Danh mục sản phẩm', 2)], t), datasetShelf('category')),
  },
  {
    id: 'sb_brand_wall',
    name: 'Dải logo thương hiệu',
    use: 'Một hàng logo cuốn dòng, lấy từ thư viện ảnh của chính site — như dải ảnh, cho logo',
    images: 8,
    build: (t, pool) => {
      const used = new Set<string>();
      const shots: Captured[] = [];
      // A brand wall is a longer row than a product gallery — a merchant
      // collects partner logos over years, not per campaign.
      for (let i = 0; i < 8; i += 1) {
        const m = pick(pool, used, 'any');
        if (!m) break;
        // NO frame, deliberately. A gallery wall's median-ratio frame exists
        // because a WALL of PHOTOGRAPHS reads as unfinished with rows of
        // different heights — logos are a different problem: a transparent
        // PNG wordmark forced into a photograph's crop loses its own shape.
        // `contain`, the mapper's default with no `ratio` set, is the honest
        // answer here.
        shots.push({ kind: 'image', src: m.url, alt: m.name ?? 'Logo' });
      }
      if (shots.length === 0) {
        return section(
          [
            h('Đối tác của chúng tôi'),
            p('Chưa có logo nào trong thư viện — sb_media_upload từng logo rồi dựng lại dải này.'),
          ],
          t,
        );
      }
      return section([h('Đối tác của chúng tôi'), row(shots, true)], t);
    },
  },
  {
    id: 'sb_trust_band',
    name: 'Dải cam kết',
    use: 'Ba đến bốn lý do nên mua — icon, tiêu đề nhỏ và một câu: giao hàng, bảo hành, đổi trả, thanh toán',
    build: (t) =>
      section(
        [
          h('Cam kết của chúng tôi'),
          row([
            {
              kind: 'group',
              direction: 'column',
              children: [icon('TruckLine'), h('Giao hàng nhanh', 3), p('Giao toàn quốc trong 24-48h.')],
            },
            {
              kind: 'group',
              direction: 'column',
              children: [icon('ShieldCheckLine'), h('Bảo hành chính hãng', 3), p('Đổi mới trong 7 ngày nếu lỗi.')],
            },
            {
              kind: 'group',
              direction: 'column',
              children: [icon('RefreshLine'), h('Đổi trả dễ dàng', 3), p('30 ngày đổi ý, hoàn tiền nhanh.')],
            },
            {
              kind: 'group',
              direction: 'column',
              children: [icon('BankCardLine'), h('Thanh toán an toàn', 3), p('Hỗ trợ nhiều hình thức thanh toán.')],
            },
          ]),
        ],
        t,
      ),
  },
];

export const PATTERN_BY_ID = new Map(LAYOUT_PATTERNS.map((p2) => [p2.id, p2]));
