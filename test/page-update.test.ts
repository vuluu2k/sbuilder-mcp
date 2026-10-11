import { describe, it, expect } from 'vitest';
import { fakePlatform } from './helpers/platform.js';

/**
 * `settings` REPLACES WHOLESALE on PATCH /api/sites/{s}/pages/{p}, and it holds
 * more than SEO — membersOnly, courseGate and keys nobody here knows. A write
 * that sent only the SEO it was given would un-gate a members page.
 */
function site() {
  let page: Record<string, unknown> = {
    id: 'p1',
    name: 'Old',
    slug: 'old',
    settings: { title: 'T0', membersOnly: true, courseGate: 'c9', mystery: { keep: 1 } },
  };
  const patches: unknown[] = [];
  const fake = fakePlatform((method, path, body) => {
    if (path !== '/api/sites/s1/pages/p1') return undefined;
    if (method === 'PATCH') {
      patches.push(body);
      page = { ...page, ...(body as object) };
    }
    return { page };
  });
  return { fake, patches, page: () => page };
}

describe('sb_page_update', () => {
  it('merges seo over the existing settings, keeping unrelated keys', async () => {
    const { fake, patches, page } = site();
    const { call, close } = await fake.connect();
    try {
      const r = await call('sb_page_update', {
        site_id: 's1',
        page_id: 'p1',
        name: 'New',
        seo: { description: 'D', twitterCard: 'summary', jsonld: ['{"@type":"Thing"}'] },
        dry_run: false,
      });
      expect(r.isError, r.text).toBe(false);
      expect(patches).toHaveLength(1);
      expect(page().settings).toEqual({
        title: 'T0',
        description: 'D',
        twitterCard: 'summary',
        jsonld: ['{"@type":"Thing"}'],
        membersOnly: true,
        courseGate: 'c9',
        mystery: { keep: 1 },
      });
      expect(page().name).toBe('New');
    } finally {
      await close();
    }
  });

  it('dry_run defaults to true: a preview and a diff, no write', async () => {
    const { fake, patches } = site();
    const { call, close } = await fake.connect();
    try {
      const r = await call('sb_page_update', { site_id: 's1', page_id: 'p1', seo: { title: 'T1' }, members_only: false });
      expect(r.isError, r.text).toBe(false);
      expect(r.json.dry_run).toBe(true);
      expect(r.json.changes).toEqual({ 'seo.title': ['T0', 'T1'], members_only: [true, false] });
      expect(patches).toHaveLength(0);
      expect(fake.writes).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('refuses an unknown seo key, a bad twitterCard, bad JSON-LD, and a no-op', async () => {
    const { fake, patches } = site();
    const { call, close } = await fake.connect();
    try {
      const unknown = await call('sb_page_update', { site_id: 's1', page_id: 'p1', seo: { titel: 'x' } });
      expect(unknown.isError).toBe(true);
      const card = await call('sb_page_update', { site_id: 's1', page_id: 'p1', seo: { twitterCard: 'big' } });
      expect(card.isError).toBe(true);
      const ld = await call('sb_page_update', { site_id: 's1', page_id: 'p1', seo: { jsonld: ['{nope'] } });
      expect(ld.isError).toBe(true);
      expect(ld.text).toMatch(/jsonld/);
      const none = await call('sb_page_update', { site_id: 's1', page_id: 'p1', dry_run: false });
      expect(none.isError).toBe(true);
      const same = await call('sb_page_update', { site_id: 's1', page_id: 'p1', name: 'Old', seo: { title: 'T0' }, dry_run: false });
      expect(same.isError).toBe(true);
      expect(same.text).toMatch(/nothing/i);
      expect(patches).toHaveLength(0);
    } finally {
      await close();
    }
  });
  it('a brand page takes render_for — linkType "brand", as Go linkTypeForPageType (page/entitylinks.go)', async () => {
    const fake = fakePlatform((method, path) =>
      path === '/api/sites/s1/pages/pb' ? { page: { id: 'pb', type: 'brand', settings: {} } } : undefined,
    );
    const { call, close } = await fake.connect();
    try {
      const r = await call('sb_page_update', { site_id: 's1', page_id: 'pb', render_for: ['b1'] });
      expect(r.isError, r.text).toBe(false);
      expect(r.json.would_send).toEqual([
        { method: 'POST', path: '/api/sites/s1/page-links/bulk', body: { linkType: 'brand', linkIds: ['b1'], pageId: 'pb' } },
      ]);
    } finally {
      await close();
    }
  });
});
