import type { NodeSpec } from './builder.js';
import { LAYOUT_PATTERNS, THEME_TOKENS } from './patterns.js';

/**
 * THE BUILT-IN LAYOUTS' EXAMPLE COPY, so a review can tell it was never replaced.
 *
 * Measured on a store built end to end with these tools: the home page published
 * "Tiêu đề chính", "Lợi ích một / Một hoặc hai câu." and, in the hero's picture
 * slot, the sentence telling the AGENT to run sb_media_upload — all to shoppers —
 * and sb_review called the page clean, because none of it is an element's own
 * seed. Worse are the CLAIMS: "1.000+ khách hàng", "4,9/5", "Đổi mới trong 7 ngày",
 * a testimonial signed "Nguyễn Minh Anh" — published, they are statements about
 * this shop that nobody made.
 *
 * DERIVED by building every pattern, minus the short list of labels that are fine
 * as they stand. Derived rather than listed so a pattern added or reworded later is
 * covered on the day it lands: new copy is example copy until someone says it is a
 * usable label — the safe direction to be wrong in.
 */
const USABLE_AS_IS = new Set([
  'Mua ngay', 'Tìm hiểu thêm', 'Tìm hiểu thêm →', 'Xem tất cả', 'Sản phẩm nổi bật', 'Danh mục sản phẩm',
  'Bộ sưu tập mới', 'Chào mừng', 'Lợi ích', 'Vì sao chọn chúng tôi', 'Sẵn sàng bắt đầu?', 'Thư viện ảnh',
  'Hỗ trợ', 'Câu hỏi thường gặp', 'Giao hàng mất bao lâu?', 'Đổi trả thế nào?', 'Thanh toán ra sao?',
  'Đối tác của chúng tôi', 'Cam kết của chúng tôi', 'Giao hàng nhanh', 'Bảo hành chính hãng',
  'Đổi trả dễ dàng', 'Thanh toán an toàn', 'Khách hàng nói gì', '★★★★★', 'Cách hoạt động',
  'Ba bước đơn giản', '01', '02', '03', 'Chọn sản phẩm', 'Đặt hàng', 'Nhận hàng', 'Câu chuyện',
  'Bảng giá', 'Chọn gói phù hợp', 'Cơ bản', 'Chọn gói', 'Khách hàng', 'Đánh giá trung bình',
  'Giao trong nội thành', 'Tiêu chuẩn', 'Cao cấp',
]);

const TEXT_KEYS = ['text', 'label', 'alt'] as const;
let cache: Map<string, string> | null = null;

/** Example copy → the id of the layout it came from. Built once per process. */
export function exampleCopy(): Map<string, string> {
  if (cache) return cache;
  const out = new Map<string, string>();
  const walk = (n: NodeSpec | null | undefined, id: string): void => {
    if (!n) return;
    for (const k of TEXT_KEYS) {
      const v = (n.specials as Record<string, unknown> | undefined)?.[k];
      if (typeof v === 'string' && v.trim() && !USABLE_AS_IS.has(v) && !out.has(v)) out.set(v, id);
    }
    for (const c of n.children ?? []) walk(c as NodeSpec, id);
  };
  for (const p of LAYOUT_PATTERNS) {
    try {
      walk(p.build(THEME_TOKENS, []), p.id);
    } catch {
      // A pattern that cannot build without a pool contributes nothing here.
    }
  }
  cache = out;
  return out;
}
