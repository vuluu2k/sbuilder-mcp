import { describe, it, expect } from 'vitest';
import { fakePlatform } from './helpers/platform.js';

/**
 * sb_template_use for a SERVER-SIDE template, against the real Go shapes
 * (web_builder origin/main):
 *  - GET  /api/sites/{site}/section-templates → `{ sectionTemplates: [...] }`, each row
 *    carrying `source` ("site" | "org" | "platform") and `document`, a
 *    `{ root_node_id, nodes }` envelope holding ONE flex-section tree
 *    (server/internal/sectiontemplates/sectiontemplate.go, Template.Document).
 *  - POST …/section-templates/{id}/instantiate reads NO body, inserts into no page,
 *    copies the template's media into the site and answers
 *    `{ document, droppedRefs }`, droppedRefs never null
 *    (server/internal/sectiontemplates/rest/rest.go, `instantiate`).
 * A site's own template needs no instantiate — the editor inserts its document
 * straight from the list (editor/src/components/TemplateCards.vue), under fresh
 * ids (features/sectiontemplates/store.ts `previewTreeFor` → `cloneTree`).
 */

const tplDoc = (root: string, text: string) => ({
  root_node_id: root,
  nodes: {
    [root]: { id: root, data: { type: 'flex-section', parent: null, nodes: [`${root}_h`] }, style: {}, config: {}, specials: {}, responsive: {}, events: [] },
    [`${root}_h`]: { id: `${root}_h`, data: { type: 'heading', parent: root, nodes: [] }, style: {}, config: {}, specials: { text }, responsive: {}, events: [] },
  },
});

type Node = { id: string; data: { type: string; parent: string | null; nodes: string[] }; specials?: Record<string, unknown> };
type Doc = { root_node_id: string; nodes: Record<string, Node> };

function platform() {
  const posts: Array<{ path: string; body: unknown }> = [];
  const p = fakePlatform((method, path, body) => {
    if (method === 'GET' && path === '/api/sites/s1/section-templates') {
      return {
        sectionTemplates: [
          { id: 'tpl_own', siteId: 's1', name: 'Own hero', source: 'site', rev: 3, listed: false, sortOrder: 0, document: tplDoc('fs_own', 'Own') },
          { id: 'tpl_plat', siteId: 's_p', name: 'Platform hero', source: 'platform', rev: 1, listed: true, sortOrder: 0, document: tplDoc('fs_plat', 'Plat') },
        ],
      };
    }
    if (method === 'POST' && path === '/api/sites/s1/section-templates/tpl_plat/instantiate') {
      posts.push({ path, body });
      return { document: tplDoc('fs_copy', 'Copied'), droppedRefs: [{ namespace: 'product', oldId: 'p_gone' }] };
    }
    return undefined;
  });
  return { p, posts };
}

const stored = (p: ReturnType<typeof fakePlatform>) => p.pages.get('pg_1')!.document as Doc;

describe('sb_template_use — a server-side template', () => {
  it("inserts the site's own template from the list document, under fresh ids, without instantiate", async () => {
    const { p, posts } = platform();
    const { call, close } = await p.connect();
    await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
    const out = await call('sb_template_use', { site_id: 's1', page_id: 'pg_1', template_id: 'tpl_own', dry_run: false });
    expect(out.isError).toBe(false);
    expect(posts).toEqual([]);
    const doc = stored(p);
    const section = out.json.section as string;
    expect(section).toBeTruthy();
    expect(section).not.toBe('fs_own');
    expect(doc.nodes.ROOT.data.nodes).toContain(section);
    expect(doc.nodes[section].data.type).toBe('flex-section');
    const kid = doc.nodes[doc.nodes[section].data.nodes[0]];
    expect(kid.specials?.text).toBe('Own');
    expect(kid.id).not.toBe('fs_own_h');
    expect(out.json.nodes).toBe(2);
    expect(out.json.dropped_refs).toBeUndefined();
    await close();
  });

  it('instantiates a platform template with no body and inserts the copy, reporting dropped refs', async () => {
    const { p, posts } = platform();
    const { call, close } = await p.connect();
    await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
    const out = await call('sb_template_use', { site_id: 's1', page_id: 'pg_1', template_id: 'tpl_plat', dry_run: false });
    expect(out.isError).toBe(false);
    expect(posts).toEqual([{ path: '/api/sites/s1/section-templates/tpl_plat/instantiate', body: undefined }]);
    const doc = stored(p);
    const section = out.json.section as string;
    expect(doc.nodes.ROOT.data.nodes).toContain(section);
    expect(doc.nodes[doc.nodes[section].data.nodes[0]].specials?.text).toBe('Copied');
    expect(out.json.dropped_refs).toEqual([{ namespace: 'product', oldId: 'p_gone' }]);
    await close();
  });

  it('a dry run of either makes no POST and stores nothing', async () => {
    const { p, posts } = platform();
    const { call, close } = await p.connect();
    await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
    const own = await call('sb_template_use', { site_id: 's1', page_id: 'pg_1', template_id: 'tpl_own' });
    expect(own.json.dry_run).toBe(true);
    expect(own.json.nodes).toBe(2);
    const plat = await call('sb_template_use', { site_id: 's1', page_id: 'pg_1', template_id: 'tpl_plat' });
    expect(plat.json.dry_run).toBe(true);
    expect(plat.json.nodes).toBe(2);
    expect(posts).toEqual([]);
    expect(p.writes).toEqual([]);
    await close();
  });

  it('refuses an id that is neither a built-in nor on the shelf', async () => {
    const { p } = platform();
    const { call, close } = await p.connect();
    const out = await call('sb_template_use', { site_id: 's1', page_id: 'pg_1', template_id: 'nope' });
    expect(out.isError).toBe(true);
    expect(out.text).toMatch(/sb_templates/);
    await close();
  });
});
