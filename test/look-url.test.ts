import { describe, it, expect, vi } from 'vitest';
import { fakePlatform } from './helpers/platform.js';

/**
 * TTG GAP #80 (2026-10-29): `sb_look url:` on ANOTHER page framed that page,
 * and answered with the OPEN page's review findings as if they were its own.
 * And #65: text that sits on a picture is said once, not judged.
 */
const boxes = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock('../src/vision/shoot.js', async (orig) => ({
  ...(await orig<typeof import('../src/vision/shoot.js')>()),
  shoot: async (_url: string, opts: { widths?: number[] }) =>
    (opts.widths ?? [390]).map((width) => ({ width, imageBase64: 'eA==', mimeType: 'image/jpeg', boxes: boxes.current })),
}));

const n = (id: string, type: string, parent: string | null, nodes: string[] = [], specials: Record<string, unknown> = {}) => ({
  id,
  data: { type, parent, nodes },
  style: {},
  config: {},
  specials,
  responsive: {},
  events: [],
  bindings: [],
});

async function opened() {
  const fake = fakePlatform();
  fake.pages.set('pg', {
    rev: 1,
    document: {
      schema_version: 2,
      root_node_id: 'ROOT',
      nodes: {
        ROOT: n('ROOT', 'root', null, ['fs_00000001']),
        // A placeholder heading: the open page has a finding of its own.
        fs_00000001: n('fs_00000001', 'flex-section', 'ROOT', ['he_00000001']),
        he_00000001: n('he_00000001', 'heading', 'fs_00000001', [], { text: 'Heading' }),
      },
    },
  });
  const c = await fake.connect();
  await c.call('sb_page_open', { site_id: 's1', page_id: 'pg' });
  return c;
}

describe('#80 sb_look url: on a different page', () => {
  it('does not return the open page\'s findings for a page it did not shoot', async () => {
    boxes.current = [
      { id: 'ROOT', type: 'root', x: 0, y: 0, w: 390, h: 900 },
      { id: 'fs_99999999', type: 'flex-section', x: 0, y: 0, w: 390, h: 200, position: 'static' },
    ];
    const { call, close } = await opened();
    try {
      const look = await call('sb_look', { widths: [390], url: 'https://shop.example/blog-categories/x' });
      expect(look.isError, look.text).toBe(false);
      expect(look.json.findings).toBeUndefined();
      expect(String(look.json.findings_note)).toMatch(/not the open page/);
    } finally {
      await close();
    }
  });

  it('keeps them when the url renders the open page', async () => {
    boxes.current = [
      { id: 'ROOT', type: 'root', x: 0, y: 0, w: 390, h: 900 },
      { id: 'fs_00000001', type: 'flex-section', x: 0, y: 0, w: 390, h: 200, position: 'static' },
      { id: 'he_00000001', type: 'heading', x: 0, y: 0, w: 390, h: 40, position: 'static', fg: 'rgb(255, 255, 255)', overImage: true },
    ];
    const { call, close } = await opened();
    try {
      const look = await call('sb_look', { widths: [390], url: 'https://shop.example/' });
      expect(look.json.findings).toBeDefined();
      expect(look.json.findings_note).toBeUndefined();
      expect(String(look.json.contrast_note)).toMatch(/picture/);
    } finally {
      await close();
    }
  });
});
