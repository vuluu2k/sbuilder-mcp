import { describe, it, expect, vi } from 'vitest';
import { fakePlatform } from './helpers/platform.js';

// site_template photographs the published homepage; no real Chrome in tests.
const snap = vi.hoisted(() => ({
  fn: vi.fn(async (_url: string, _opts?: { allowPrivate?: boolean }) => new Uint8Array([0xff, 0xd8, 0xff])),
}));
vi.mock('../src/vision/shoot.js', async (orig) => ({
  ...(await orig<typeof import('../src/vision/shoot.js')>()),
  snapshot: (url: string, opts?: { allowPrivate?: boolean }) => snap.fn(url, opts),
}));

/**
 * "Set as Global" and "Save as template" were editor-only: an agent had to
 * serialize the subtree itself and swap in the reference by hand — the shape
 * that left pages blank when a stamp went along with it.
 */
type Doc = { root_node_id: string; nodes: Record<string, any> };

const sec = (id: string, nodes: string[] = [], specials: Record<string, unknown> = {}) => ({
  id,
  data: { type: 'flex-section', parent: 'ROOT', nodes },
  style: {},
  specials,
});

function page(): Doc {
  return {
    root_node_id: 'ROOT',
    nodes: {
      ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['s1', 's2', 's3'] } },
      s1: sec('s1'),
      s2: sec('s2', ['t1']),
      t1: { id: 't1', data: { type: 'text', parent: 's2', nodes: [] }, specials: { text: 'Hi' } },
      s3: sec('s3'),
    },
  };
}

async function setup(globals: Array<{ id: string; kind: string }> = [], stampS3 = false, broken = false) {
  const posted: Array<{ path: string; body: any }> = [];
  const seen: string[] = [];
  let patchFails = false;
  const p = fakePlatform((method, path, body) => {
    seen.push(`${method} ${path}`);
    if (path.endsWith('/section-templates/st_1') && method === 'PATCH' && patchFails) {
      return { __status: 500, error: 'boom' };
    }
    if (path.endsWith('/global-sections') && method === 'GET') return { globalSections: globals };
    if (path.endsWith('/global-sections') && method === 'POST') {
      posted.push({ path, body });
      return { globalSection: { id: 'gs_new' } };
    }
    if (path.endsWith('/section-templates') && method === 'GET') {
      return { sectionTemplates: [{ id: 'st_1', name: 'Hero', rev: 3, source: 'site' }, { id: 'st_p', name: 'Gallery', rev: 1, source: 'platform' }] };
    }
    if (path.endsWith('/section-templates/st_1/document') && method === 'PUT') {
      posted.push({ path, body });
      return { sectionTemplate: { id: 'st_1' } };
    }
    if (path.endsWith('/section-templates/categories') && method === 'GET') {
      return { categories: [{ id: 'sc_hero', slug: 'hero', name: 'Đầu trang' }, { id: 'sc_faq', slug: 'faq', name: 'Hỏi đáp' }] };
    }
    if (path.endsWith('/section-templates/st_1') && method === 'PATCH') {
      posted.push({ path, body });
      return { sectionTemplate: { id: 'st_1' } };
    }
    if (path.endsWith('/section-templates') && method === 'POST') {
      posted.push({ path, body });
      return { sectionTemplate: { id: 'st_new', categoryIds: (body as any).categoryIds } };
    }
    if (/\/global-sections\/[^/]+\/pages$/.test(path)) return { pages: [{ pageId: 'pg_1' }] };
    return undefined;
  });
  const d0 = page();
  if (stampS3) d0.nodes.s3.specials = { globalId: 'gs_x', globalKind: 'custom' };
  if (broken) d0.nodes.ROOT.data.nodes.push('ghost');
  p.pages.set('pg_1', { document: { schema_version: 2, ...d0 }, rev: 1 });
  const { call: raw, close } = await p.connect();
  const call = (name: string, args: Record<string, unknown>) => raw(name, { site_id: 's1', ...args });
  await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
  const doc = () => p.pages.get('pg_1')!.document as Doc;
  return { call, close, posted, doc, seen, failPatch: () => (patchFails = true) };
}

describe('sb_store action:"global_promote"', () => {
  it('stores the section with its subtree as a master and leaves a reference in its place', async () => {
    const { call, close, posted, doc } = await setup();
    const out = await call('sb_store', { action: 'global_promote', node_id: 's2', name: 'Promo', dry_run: false });
    expect(out.isError).toBe(false);
    const master = posted[0].body;
    expect(master).toMatchObject({ name: 'Promo', kind: 'custom' });
    expect(master.document.root_node_id).toBe('s2');
    expect(Object.keys(master.document.nodes).sort()).toEqual(['s2', 't1']);
    expect(master.document.nodes.s2.data.parent).toBeNull();

    const d = doc();
    const kids = d.nodes.ROOT.data.nodes;
    expect(kids).toHaveLength(3);
    expect(kids[0]).toBe('s1');
    expect(d.nodes[kids[1]].specials).toMatchObject({ globalRef: 'gs_new', globalKind: 'custom' });
    expect(kids[2]).toBe('s3');
    expect(d.nodes.s2).toBeUndefined();
    expect(d.nodes.t1).toBeUndefined();
    await close();
  });

  it('puts a promoted header first', async () => {
    const { call, close, doc } = await setup();
    await call('sb_store', { action: 'global_promote', node_id: 's3', global_kind: 'header', dry_run: false });
    const d = doc();
    expect(d.nodes[d.nodes.ROOT.data.nodes[0]].specials.globalRef).toBe('gs_new');
    await close();
  });

  it('dry run sends nothing', async () => {
    const { call, close, posted, doc } = await setup();
    const out = await call('sb_store', { action: 'global_promote', node_id: 's2' });
    expect(out.json.dry_run).toBe(true);
    expect(posted).toEqual([]);
    expect(doc().nodes.s2).toBeDefined();
    await close();
  });

  it('refuses a second header and a non-section', async () => {
    const { call, close, posted } = await setup([{ id: 'gs_h', kind: 'header' }]);
    const two = await call('sb_store', { action: 'global_promote', node_id: 's1', global_kind: 'header' });
    expect(two.isError).toBe(true);
    expect(two.text).toMatch(/global_attach/);
    expect((await call('sb_store', { action: 'global_promote', node_id: 't1' })).text).toMatch(/SECTION/);
    expect(posted).toEqual([]);
    await close();
  });

  it('refuses a section that is already shared, for a template too', async () => {
    const { call, close, posted } = await setup([], true);
    expect((await call('sb_store', { action: 'global_promote', node_id: 's3' })).text).toMatch(/globalId/);
    expect((await call('sb_store', { action: 'template_save', node_id: 's3', name: 'X' })).text).toMatch(/globalId/);
    expect(posted).toEqual([]);
    await close();
  });
});

describe('sb_store action:"global_promote" on a page that cannot be stored', () => {
  it('refuses before creating the master, dry run included', async () => {
    const { call, close, posted } = await setup([], false, true);
    expect((await call('sb_store', { action: 'global_promote', node_id: 's2' })).text).toMatch(/refusing to save/);
    expect((await call('sb_store', { action: 'global_promote', node_id: 's2', dry_run: false })).text).toMatch(/refusing to save/);
    expect(posted).toEqual([]);
    await close();
  });
});

describe('sb_store action:"template_save"', () => {
  it('saves the section as a template and leaves the page alone', async () => {
    const { call, close, posted, doc } = await setup();
    const out = await call('sb_store', { action: 'template_save', node_id: 's2', name: 'Hero', dry_run: false });
    expect(out.json.template).toEqual({ id: 'st_new', name: 'Hero' });
    expect(posted[0].path).toBe('/api/sites/s1/section-templates');
    expect(Object.keys(posted[0].body.document.nodes).sort()).toEqual(['s2', 't1']);
    expect(doc().nodes.ROOT.data.nodes).toEqual(['s1', 's2', 's3']);
    await close();
  });

  it('with template_id rewrites that template, fenced on its rev', async () => {
    const { call, close, posted } = await setup();
    const dry = await call('sb_store', { action: 'template_save', node_id: 's2', template_id: 'st_1' });
    expect(dry.json.dry_run).toBe(true);
    expect(posted).toEqual([]);
    const out = await call('sb_store', { action: 'template_save', node_id: 's2', template_id: 'st_1', dry_run: false });
    expect(out.isError, out.text).toBe(false);
    expect(posted[0].path).toBe('/api/sites/s1/section-templates/st_1/document');
    expect(posted[0].body.rev).toBe(3);
    expect(posted[0].body.document.root_node_id).toBe('s2');
    expect((await call('sb_store', { action: 'template_save', node_id: 's2', template_id: 'st_p' })).text).toMatch(/platform template/);
    expect((await call('sb_store', { action: 'template_save', node_id: 's2', template_id: 'nope' })).text).toMatch(/no section template/);
    await close();
  });

  it('needs a name', async () => {
    const { call, close } = await setup();
    expect((await call('sb_store', { action: 'template_save', node_id: 's2' })).text).toMatch(/needs name/);
    await close();
  });

  it('the dry run offers the catalogue; the save files description + categories by slug or id', async () => {
    const { call, close, posted } = await setup();
    const dry = await call('sb_store', { action: 'template_save', node_id: 's2', name: 'Hero' });
    expect(dry.json.categories_available).toEqual([{ slug: 'hero', name: 'Đầu trang' }, { slug: 'faq', name: 'Hỏi đáp' }]);
    expect(dry.json.write, 'brief missing while nothing is chosen').toMatch(/description/);
    expect(posted).toEqual([]);
    const out = await call('sb_store', {
      action: 'template_save', node_id: 's2', name: 'Hero', description: 'Ảnh lớn và 2 nút', categories: ['hero', 'sc_faq'], dry_run: false,
    });
    expect(out.isError, out.text).toBe(false);
    expect(posted[0].body).toMatchObject({ name: 'Hero', description: 'Ảnh lớn và 2 nút', categoryIds: ['sc_hero', 'sc_faq'] });
    expect(out.json.categories).toEqual(['hero', 'faq']);
    expect(out.json.warning, 'filed in full, no warning').toBeUndefined();
    const bad = await call('sb_store', { action: 'template_save', node_id: 's2', name: 'Hero', categories: ['nope'], dry_run: false });
    expect(bad.text).toMatch(/no section-template category "nope".*hero \(Đầu trang\)/);
    await close();
  });

  it('a plain save never reads the category catalogue', async () => {
    const { call, close, seen } = await setup();
    const out = await call('sb_store', { action: 'template_save', node_id: 's2', name: 'Hero', dry_run: false });
    expect(out.isError, out.text).toBe(false);
    expect(seen.filter((x) => x.includes('/categories')), 'a save without categories read the catalogue').toEqual([]);
    await close();
  });

  it('a metadata failure after the content PUT says the content was saved', async () => {
    const { call, close, failPatch } = await setup();
    failPatch();
    const out = await call('sb_store', {
      action: 'template_save', node_id: 's2', template_id: 'st_1', name: 'Hero mới', dry_run: false,
    });
    expect(out.isError, out.text).toBe(false);
    expect(out.json.warning).toMatch(/CONTENT was saved/);
    await close();
  });

  it('a rewrite PATCHes the metadata it was given after the content', async () => {
    const { call, close, posted } = await setup();
    const out = await call('sb_store', {
      action: 'template_save', node_id: 's2', template_id: 'st_1', name: 'Hero mới', categories: ['faq'], dry_run: false,
    });
    expect(out.isError, out.text).toBe(false);
    expect(posted.map((p) => p.path)).toEqual(['/api/sites/s1/section-templates/st_1/document', '/api/sites/s1/section-templates/st_1']);
    expect(posted[1].body).toEqual({ name: 'Hero mới', categoryIds: ['sc_faq'] });
    await close();
  });
});

describe('sb_store action:"site_template"', () => {
  async function site(orgId = '', publicUrl?: string) {
    const sent: Array<{ method: string; path: string; body: any }> = [];
    const p = fakePlatform((method, path, body, query) => {
      if (method !== 'GET') sent.push({ method, path, body });
      if (path === '/api/sites/s1' && method === 'GET') {
        return { site: { name: 'Shop', orgId, publicUrl, isTemplate: !!publicUrl, templateName: 'Cũ' } };
      }
      if (path === '/api/sites/s1/preview') return { preview: { status: 'ready' } };
      if (path === '/api/sites/s1/pages') return { pages: [{ name: 'Trang chủ' }, { name: 'Sản phẩm' }] };
      if (path === '/api/templates/categories') {
        const fileable = query.includes('orgId=org_p');
        return {
          categories: [{ slug: 'fashion', name: 'Thời trang' }],
          fileable,
        };
      }
      if (path === '/api/sites/s1/template' && method === 'GET') {
        return { template: { isTemplate: true, categories: ['fashion'] } };
      }
      if (path === '/api/sites/s1/section-templates/st_1/share') return { sectionTemplate: { share: 'pending' } };
      if (path === '/api/sites/s1/template') return { site: { isTemplate: true } };
      if (path === '/api/sites/s1/org') return { site: { orgId: body && (body as any).orgId } };
      return undefined;
    });
    const { call: raw, close } = await p.connect();
    const call = (args: Record<string, unknown>) => raw('sb_store', { site_id: 's1', action: 'site_template', ...args });
    return { call, close, sent };
  }

  it('dry run shows pages + catalogue and sends nothing', async () => {
    const { call, close, sent } = await site('org_p');
    const dry = await call({ name: 'Shop thời trang' });
    expect(dry.json).toMatchObject({ dry_run: true, organization: 'org_p', pages: ['Trang chủ', 'Sản phẩm'] });
    expect(dry.json.categories_available).toEqual([{ slug: 'fashion', name: 'Thời trang' }]);
    expect(sent).toEqual([]);
    await close();
  });

  it('attaches to org_id when unattached, then marks with name, description and slugs', async () => {
    const { call, close, sent } = await site('');
    const out = await call({ name: 'Shop thời trang', description: 'Cho shop quần áo nữ', categories: ['fashion'], org_id: 'org_p', dry_run: false });
    expect(out.isError, out.text).toBe(false);
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual(['PUT /api/sites/s1/org', 'POST /api/sites/s1/template']);
    expect(sent[0].body).toEqual({ orgId: 'org_p' });
    expect(sent[1].body).toEqual({ name: 'Shop thời trang', description: 'Cho shop quần áo nữ', categories: ['fashion'] });
    await close();
  });

  it('refuses a site in no org without org_id, a different org, and an unknown category', async () => {
    let s = await site('');
    expect((await s.call({ name: 'X', dry_run: false })).text).toMatch(/belongs to no organization/);
    await s.close();
    s = await site('org_a');
    expect((await s.call({ name: 'X', org_id: 'org_p', dry_run: false })).text).toMatch(/already belongs to organization org_a/);
    expect((await s.call({ name: 'X', categories: ['fashion'], dry_run: false })).text).toMatch(/not the platform organization/);
    expect(s.sent, 'a refusal sent a write').toEqual([]);
    await s.close();
    s = await site('org_p');
    expect((await s.call({ name: 'X', categories: ['food'], dry_run: false })).text).toMatch(/no template category "food"/);
    expect(s.sent, 'a refusal sent a write').toEqual([]);
    await s.close();
  });

  it('acting with no name refuses instead of answering a plan that reads like success', async () => {
    const { call, close, sent } = await site('org_p');
    expect((await call({ dry_run: false })).text).toMatch(/needs name/);
    expect(sent).toEqual([]);
    await close();
  });

  it('photographs the published homepage as the card picture', async () => {
    snap.fn.mockClear();
    const { call, close, sent } = await site('org_p', 'https://shop.sbuilder.site/');
    const out = await call({ name: 'Shop', dry_run: false });
    expect(out.isError, out.text).toBe(false);
    // The platform here is not local, so private addresses stay refused.
    expect(snap.fn).toHaveBeenCalledWith('https://shop.sbuilder.site/', { allowPrivate: false });
    const put = sent.find((x) => x.path === '/api/sites/s1/preview');
    expect(put?.method, 'no preview upload').toBe('PUT');
    expect(put?.body instanceof Blob && put.body.type, 'uploaded as a JPEG blob').toBe('image/jpeg');
    expect(out.json.picture).toMatch(/captured from the published homepage/);
    await close();
  });

  it('the dry run of an existing template shows its current filing', async () => {
    const { call, close } = await site('org_p', 'https://shop.sbuilder.site/');
    const dry = await call({ name: 'Shop' });
    expect(dry.json.already_template).toEqual({ name: 'Cũ', categories: ['fashion'] });
    await close();
  });

  it('a failed photograph is a note — the mark still stands', async () => {
    snap.fn.mockClear();
    snap.fn.mockRejectedValueOnce(new Error('the page answered HTTP 404'));
    const { call, close, sent } = await site('org_p', 'https://shop.sbuilder.site/');
    const out = await call({ name: 'Shop', dry_run: false });
    expect(out.isError, out.text).toBe(false);
    expect(out.json.picture).toMatch(/not captured \(the page answered HTTP 404\)/);
    expect(sent.map((x) => x.path)).toEqual(['/api/sites/s1/template']);
    await close();
  });

  it('a non-platform org gets no catalogue in the dry run', async () => {
    const { call, close } = await site('org_a');
    const dry = await call({ name: 'X' });
    expect(dry.json.categories_available).toEqual([]);
    expect(dry.json.note).toMatch(/not the platform organization/);
    await close();
  });

  it('site_template_remove withdraws; template_share sends a section for review', async () => {
    const p2 = await site('org_p');
    const raw = p2.call;
    expect((await raw({ action: 'site_template_remove' })).json.dry_run).toBe(true);
    expect(p2.sent).toEqual([]);
    await raw({ action: 'site_template_remove', dry_run: false });
    expect((await raw({ action: 'template_share', dry_run: false })).text).toMatch(/needs template_id/);
    const shared = await raw({ action: 'template_share', template_id: 'st_1', dry_run: false });
    expect(shared.json.share).toBe('pending');
    expect(p2.sent.map((x) => `${x.method} ${x.path}`)).toEqual([
      'DELETE /api/sites/s1/template',
      'POST /api/sites/s1/section-templates/st_1/share',
    ]);
    await p2.close();
  });
});
