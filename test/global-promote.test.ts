import { describe, it, expect } from 'vitest';
import { fakePlatform } from './helpers/platform.js';

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
  const p = fakePlatform((method, path, body) => {
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
    if (path.endsWith('/section-templates') && method === 'POST') {
      posted.push({ path, body });
      return { sectionTemplate: { id: 'st_new' } };
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
  return { call, close, posted, doc };
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
});
