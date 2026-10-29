import { describe, it, expect, vi } from 'vitest';
import { fakePlatform } from './helpers/platform.js';

/**
 * GAP #60 (TTG, 2026-10-29): `sb_look node_id:<the cart drawer> widths:[390]`
 * opened the drawer, photographed it 400px wide on a 390px phone, and reported
 * no layout at all — a framed look ran no measurement. The drawer is the one
 * surface only a framed look opens, so its own subtree is measured there.
 */
const boxes = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock('../src/vision/shoot.js', async (orig) => ({
  ...(await orig<typeof import('../src/vision/shoot.js')>()),
  shoot: async (_url: string, opts: { widths?: number[] }) =>
    (opts.widths ?? [390]).map((width) => ({ width, imageBase64: 'eA==', mimeType: 'image/jpeg', boxes: boxes.current })),
}));

const n = (id: string, type: string, parent: string | null, nodes: string[] = [], style: Record<string, unknown> = {}) => ({
  id,
  data: { type, parent, nodes },
  style,
  config: {},
  specials: type === 'heading' ? { text: 'Giỏ hàng' } : {},
  responsive: {},
  events: [],
  bindings: [],
});

describe('sb_look framing a node inside the cart drawer', () => {
  it('measures the opened drawer and names it when it is wider than the phone', async () => {
    const fake = fakePlatform();
    fake.pages.set('pg', {
      rev: 1,
      document: {
        schema_version: 2,
        root_node_id: 'ROOT',
        nodes: {
          ROOT: n('ROOT', 'root', null, ['fs_00000001', 'ca_f29bbf6a']),
          fs_00000001: n('fs_00000001', 'flex-section', 'ROOT'),
          ca_f29bbf6a: n('ca_f29bbf6a', 'cart-drawer', 'ROOT', ['he_00000001'], { width: '400px' }),
          he_00000001: n('he_00000001', 'heading', 'ca_f29bbf6a'),
        },
      },
    });
    boxes.current = [
      { id: 'ROOT', type: 'root', x: 0, y: 0, w: 390, h: 900 },
      // Content OUTSIDE the drawer is not what a framed look is about.
      { id: 'fs_00000001', type: 'flex-section', x: 0, y: 0, w: 640, h: 200, position: 'static' },
      { id: 'ca_f29bbf6a', type: 'cart-drawer', x: -10, y: 0, w: 400, h: 900, position: 'fixed', layer: 'ca_f29bbf6a' },
      { id: 'he_00000001', type: 'heading', x: 14, y: 24, w: 352, h: 40, position: 'static', layer: 'ca_f29bbf6a' },
    ];
    const { call, close } = await fake.connect();
    try {
      await call('sb_page_open', { site_id: 's1', page_id: 'pg' });
      const look = await call('sb_look', { node_id: 'he_00000001', widths: [390], url: 'https://shop.example/' });
      expect(look.isError, look.text).toBe(false);
      const layout = look.json.layout as Array<{ code: string; nodeId: string; widths: number[] }>;
      expect(layout.map((f) => [f.code, f.nodeId, f.widths])).toEqual([['wider_than_viewport', 'ca_f29bbf6a', [390]]]);
    } finally {
      await close();
    }
  });
});
