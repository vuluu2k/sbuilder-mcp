import { describe, it, expect, beforeEach } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { tokensFromPage } from '../src/domains/site/importmap.js';
import { clearThemeCache } from '../src/domains/site/theme-fetch.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { STARTER_THEME, detachNote, presetLayer } from '../src/domains/site/theme.js';
import { measureShot } from '../src/vision/measure.js';
import type { Box, Shot } from '../src/vision/shoot.js';
import { fakePlatform } from './helpers/platform.js';
import { readinessGaps } from '../src/domains/site/readiness.js';
import { animationNote } from '../src/domains/site/vocabulary.js';
import { summarize } from '../src/tools/undo.js';
import { globalWarning, sharedWriteNotes } from '../src/domains/site/traps.js';
import { describeOperation, findOperation, searchOperations } from '../src/catalog/search.js';
import { REQUEST_SHAPES } from '../src/catalog/shapes.generated.js';
import { shapeResponse } from '../src/tools/api.js';
import { traitsFor } from '../src/catalog/element-search.js';

/**
 * TTG GAPS #64–#81, found building a blog and a landing page on a Vietnamese
 * store (2026-10-29, sbuilder-mcp v0.100.5). Each block names its gap.
 */

beforeEach(() => clearThemeCache());

function page(...sections: unknown[]) {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  for (const s of sections) d.apply(addSubtree(d, 'ROOT', s as never).patches);
  return d;
}

/* #64 ---------------------------------------------------------------------- */

describe('#64 a page\'s tokens are not read off a hero on a picture', () => {
  // The landing page's hand-built hero: gradient + photo ground, NO
  // backgroundColor, white h1, a pale-blue 13px label, a 620px copy column.
  const hero = {
    type: 'flex-section',
    style: { backgroundImage: 'linear-gradient(rgba(0,0,0,.6), rgba(0,0,0,.6)), url(https://x/hero.jpg)' },
    children: [
      {
        type: 'flex-block',
        style: { maxWidth: '620px' },
        children: [
          { type: 'heading', style: { color: '#ffffff' } },
          { type: 'text', style: { color: '#7cc3e3', fontSize: '13px' } },
        ],
      },
    ],
  };

  it('a background image is an inverted ground: its white type is not the page\'s ink', () => {
    const t = tokensFromPage(page(hero).doc);
    expect(t.headingColor).toBeUndefined();
    expect(t.textColor).toBeUndefined();
    expect(t.textSize).toBeUndefined();
    expect(t.sectionMaxWidth).toBeUndefined();
  });

  it('a light band after the hero is read, and the hero colours do not leak into it', () => {
    const light = {
      type: 'flex-section',
      children: [
        { type: 'flex-block', style: { maxWidth: '1200px' }, children: [{ type: 'heading', style: { color: '#191c1e' } }] },
      ],
    };
    const t = tokensFromPage(page(hero, light).doc);
    expect(t.headingColor).toBe('#191c1e');
    expect(t.sectionMaxWidth).toBe('1200px');
  });

  it('the section width is the band\'s content container, never a nested column', () => {
    const band = {
      type: 'flex-section',
      children: [
        {
          type: 'flex-block',
          style: { maxWidth: '1200px' },
          children: [{ type: 'flex-block', style: { maxWidth: '620px' }, children: [{ type: 'text' }] }],
        },
      ],
    };
    const nestedFirst = {
      type: 'flex-section',
      children: [{ type: 'flex-block', children: [{ type: 'flex-block', style: { maxWidth: '480px' }, children: [{ type: 'text' }] }] }],
    };
    expect(tokensFromPage(page(nestedFirst, band).doc).sectionMaxWidth).toBe('1200px');
    expect(tokensFromPage(page(nestedFirst).doc).sectionMaxWidth).toBeUndefined();
  });

  it('a bg video or scene is a picture ground too', () => {
    const vid = { ...hero, style: {}, config: { backgroundSceneSource: 'effect' } };
    expect(tokensFromPage(page(vid).doc).headingColor).toBeUndefined();
  });
});

/* #65 ---------------------------------------------------------------------- */

describe('#65 sb_review reads a preset-painted ground', () => {
  const band = (kids: unknown[], style: Record<string, unknown> = {}) => ({
    type: 'flex-section',
    style,
    children: [{ type: 'flex-block', children: kids }],
  });
  const codes = (d: PageDoc, theme?: typeof STARTER_THEME) =>
    reviewDesign(d, theme ? { theme } : {}).filter((f) => f.code === 'invisible_text' || f.code === 'low_contrast');

  it('white type on the container-section preset ground is invisible_text, pale blue is low_contrast', () => {
    const d = page(band([
      { type: 'heading', specials: { text: 'Câu hỏi' }, style: { color: '#ffffff' } },
      { type: 'text', specials: { text: 'Trả lời' }, style: { color: '#7cc3e3' } },
    ]));
    expect(codes(d)).toEqual([]); // no theme: the ground is unknown, say nothing
    const found = codes(d, STARTER_THEME);
    expect(found.map((f) => f.code).sort()).toEqual(['invisible_text', 'low_contrast']);
  });

  it('type on a picture ground is not judged from the tree, and theme-on-theme is the theme\'s design', () => {
    const hero = band([{ type: 'heading', specials: { text: 'Hero' }, style: { color: '#ffffff' } }], {
      backgroundImage: 'url(https://x/a.jpg)',
    });
    const plain = band([{ type: 'heading', specials: { text: 'Plain' } }]);
    expect(codes(page(hero, plain), STARTER_THEME)).toEqual([]);
  });
});

/* #66 ---------------------------------------------------------------------- */

describe('#66 sb_publish dry run names the cascade and the unreviewed shared edits', () => {
  const root = (kids: Record<string, Record<string, unknown>>) => ({
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: {
      ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: Object.keys(kids) } },
      ...Object.fromEntries(
        Object.entries(kids).map(([id, specials]) => [id, { id, data: { type: 'flex-section', parent: 'ROOT', nodes: [] }, specials }]),
      ),
    },
  });
  const platform = (method: string, path: string) => {
    if (method !== 'GET') return undefined;
    if (path === '/api/sites/s1/pages') {
      return {
        pages: [
          { id: 'pg_post', name: 'QA bài viết', slug: 'qa', type: 'post', updatedAt: '2026-10-29T15:00:00Z' },
          { id: 'pg_home', name: 'Trang chủ', slug: '', type: 'page', updatedAt: '2026-10-29T12:00:00Z', publishedAt: '2026-10-29T12:04:00Z' },
          { id: 'pg_about', name: 'Giới thiệu', slug: 'gt', type: 'about', updatedAt: '2026-10-29T12:00:00Z', publishedAt: '2026-10-29T12:04:00Z' },
        ],
      };
    }
    if (path === '/api/sites/s1/pages/pg_post/source') {
      return { source: { pageId: 'pg_post', document: root({ fs_foot: { globalRef: 'gs_foot', globalKind: 'footer' } }) } };
    }
    if (path === '/api/sites/s1/global-sections') {
      return { globalSections: [{ id: 'gs_foot', name: 'Footer', kind: 'footer', rev: 5, updatedAt: '2026-10-29T13:10:58Z' }] };
    }
    if (path === '/api/sites/s1/overlays') {
      return { overlays: [{ id: 'ov_cart', name: 'Giỏ hàng', kind: 'cart', rev: 2, updatedAt: '2026-10-29T11:00:00Z' }] };
    }
    if (path === '/api/sites/s1/published') {
      return {
        published: [
          { pageId: 'pg_home', document: root({ fs_f: { globalId: 'gs_foot', globalRev: 3 }, ca_1: { overlayId: 'ov_cart', overlayRev: 2 } }) },
          // Not carrying the footer: the cascade does not reach it.
          { pageId: 'pg_about', document: root({ fs_x: {}, ca_1: { overlayId: 'ov_cart', overlayRev: 2 } }) },
        ],
      };
    }
    return undefined;
  };

  it('lists the page a publish would republish, and the master saved after it went live', async () => {
    const p = fakePlatform(platform);
    const { call, close } = await p.connect();
    try {
      const r = await call('sb_publish', { site_id: 's1', page_id: 'pg_post' });
      expect(r.isError, r.text).toBe(false);
      const would = r.json.would_cascade as Array<{ pageId: string; name: string; because: string[] }>;
      expect(would.map((w) => w.pageId)).toEqual(['pg_home']);
      expect(would[0].because.join(' ')).toMatch(/gs_foot/);
      const shared = r.json.shared_unpublished as Array<{ id: string }>;
      expect(shared.map((s) => s.id)).toEqual(['gs_foot']);
      expect(String(r.json.shared_warning)).toMatch(/Footer/);
    } finally {
      await close();
    }
  });
});

/* #68 ---------------------------------------------------------------------- */

describe('#68 the blog type is the /blog-categories/{slug} entity template', () => {
  const home = { id: 'pg_home', type: 'page', status: 'published', name: 'Trang chủ', path: '/', isHomepage: true, settings: { title: 't', description: 'd' } };
  const blog = { id: 'pg_blog', type: 'blog', status: 'published', name: 'QA Blog danh mục', path: '/qa-blog-danh-muc', settings: {} };

  it('is judged neither for its own SEO nor for being linked — the category supplies both', () => {
    const ids = readinessGaps({
      liveGateways: null,
      shippingMethods: null,
      pageNodes: [],
      globalNodes: [],
      globalKinds: ['header'],
      menuLinks: { pageIds: [], hrefs: [] },
      pages: [home, blog],
      openPageId: 'pg_blog',
    } as never).map((g) => g.id);
    expect(ids).not.toContain('pageSeo');
    expect(ids).not.toContain('unreachablePage');
  });

  const platform = (method: string, path: string) => {
    if (method === 'GET' && path === '/api/sites/s1/pages') {
      return { pages: [{ id: 'pg_blog', name: 'QA Blog', slug: 'qa-blog-danh-muc', type: 'blog', updatedAt: '2026-10-29T15:00:00Z' }] };
    }
    if (method === 'GET' && path === '/api/sites/s1/blog-categories') {
      return { blogCategories: [{ id: 'bcat_1', slug: 'qa-kinh-nghiem-build-pc', name: 'QA' }] };
    }
    if (method === 'GET' && path === '/api/sites/s1/pages/pg_blog/preview') return { preview: { url: 'https://shop.example/_wb/preview?t=x' } };
    if (method === 'POST' && path === '/api/sites/s1/publish') {
      return { published: [{ pageId: 'pg_blog', slug: 'qa-blog-danh-muc', publishedAt: 'now', document: { root_node_id: 'ROOT', nodes: { ROOT: { data: { nodes: ['fs_1'] } } } } }] };
    }
    if (method === 'POST' && path === '/api/sites/s1/pages') return { page: { id: 'pg_blog', slug: 'qa-blog-danh-muc', type: 'blog' } };
    return undefined;
  };

  it('sb_publish verify checks a REAL category address, not the template\'s own slug', async () => {
    const p = fakePlatform(platform);
    const { call, close } = await p.connect();
    try {
      const r = await call('sb_publish', { site_id: 's1', page_id: 'pg_blog', dry_run: false, verify: true });
      expect(r.isError, r.text).toBe(false);
      const live = r.json.live as { url: string };
      expect(live.url).toBe('https://shop.example/blog-categories/qa-kinh-nghiem-build-pc');
    } finally {
      await close();
    }
  });

  it('sb_page_create answers the route the template serves', async () => {
    const p = fakePlatform(platform);
    const { call, close } = await p.connect();
    try {
      const r = await call('sb_page_create', { site_id: 's1', name: 'QA Blog', type: 'blog', dry_run: false, seed: false, chrome: false });
      expect(r.isError, r.text).toBe(false);
      expect(r.json.route).toBe('/blog-categories/{slug}');
    } finally {
      await close();
    }
  });
});

/* #69 ---------------------------------------------------------------------- */

describe('#69 a dead desktop slot inside the shared header', () => {
  const node = (id: string, type: string, parent: string | null, nodes: string[] = [], extra: Record<string, unknown> = {}) => ({
    id, data: { type, parent, nodes }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [], ...extra,
  });
  const doc = (dead: boolean, baseHidden?: boolean) => ({
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: {
      ROOT: node('ROOT', 'root', null, ['fs_head', 'fs_body']),
      fs_head: node('fs_head', 'flex-section', 'ROOT', ['fb_2ea82bf3'], { specials: { globalId: 'gs_7465c2fb', globalKind: 'header' } }),
      fb_2ea82bf3: node('fb_2ea82bf3', 'flex-block', 'fs_head', ['he_1'], {
        responsive: { desktop: { config: { hidden: dead } } },
        config: baseHidden === undefined ? {} : { hidden: baseHidden },
      }),
      he_1: node('he_1', 'heading', 'fb_2ea82bf3', [], { specials: { text: 'TTG Shop' } }),
      fs_body: node('fs_body', 'flex-section', 'ROOT', ['he_2']),
      he_2: node('he_2', 'heading', 'fs_body', [], { specials: { text: 'Nội dung' } }),
    },
  });
  const dead = (d: unknown) => reviewDesign(PageDoc.from(d as never)).find((f) => f.code === 'hidden_desktop_dead')!;

  it('is marked global, and is maintenance when the dead value matches what renders', () => {
    const agrees = dead(doc(false));
    expect(agrees.global).toBe(true);
    expect(agrees.severity).toBe('maintenance');
    // `hidden:true` in the dead slot while base shows it: the author's intent is not what renders.
    expect(dead(doc(true)).severity).toBeUndefined();
  });

  it('a shared master\'s finding is said once per process, not on every page and every call', async () => {
    const p = fakePlatform();
    p.pages.set('pg_1', { rev: 1, document: doc(true) });
    const { call, close } = await p.connect();
    try {
      const first = await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
      const codes = (r: typeof first) => JSON.stringify(r.json.findings ?? []);
      expect(codes(first)).toMatch(/hidden_desktop_dead.*"global":true/);
      const second = await call('sb_review', {});
      expect(codes(second)).not.toMatch(/hidden_desktop_dead/);
      // The page's own findings still come back every time.
      expect(codes(second)).toMatch(/no_h1/);
    } finally {
      await close();
    }
  });
});

/* #70 ---------------------------------------------------------------------- */

describe('#70 {active:false} switches an animation off and is a complete value', () => {
  it('raises no "active:true is missing" warning', () => {
    expect(animationNote({ active: false })).toBeNull();
    // A value meant to run still says what is missing.
    expect(animationNote({ type: 'fade_in' })).toMatch(/active:true is missing/);
  });
});

/* #71 + #77 ---------------------------------------------------------------- */

describe('#71 #77 patterns and the pop-up seed speak the site\'s language; template_use names its nodes', () => {
  const vi = (method: string, path: string) =>
    method === 'GET' && path === '/api/sites/s1/settings' ? { settings: { locale: 'vi' } } : undefined;
  const texts = (d: unknown) =>
    Object.values((d as { nodes: Record<string, { specials?: Record<string, unknown> }> }).nodes).flatMap((n) =>
      ['text', 'label', 'closeLabel'].map((k) => n.specials?.[k]).filter(Boolean),
    );

  it('sb_template_use sb_product_shelf on a vi site: Vietnamese empty states, an id → type map, and "#" is flagged', async () => {
    const p = fakePlatform(vi);
    const { call, close } = await p.connect();
    try {
      await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
      const r = await call('sb_template_use', { site_id: 's1', page_id: 'pg_1', template_id: 'sb_product_shelf', dry_run: false });
      expect(r.isError, r.text).toBe(false);
      const doc = p.pages.get('pg_1')!.document;
      expect(texts(doc)).toContain('Chưa có sản phẩm');
      expect(texts(doc)).not.toContain('No products yet');
      expect(texts(doc)).not.toContain('This item is unavailable');
      expect(Object.values(r.json.ids as Record<string, string>)).toContain('list-dataset');
      const review = await call('sb_review', {});
      expect(JSON.stringify(review.json.findings)).toMatch(/placeholder_link/);
    } finally {
      await close();
    }
  });

  it('the pop-up seed is created in Vietnamese on a vi site', async () => {
    let created: unknown;
    const p = fakePlatform((method, path, body) => {
      if (method === 'POST' && path === '/api/sites/s1/overlays') {
        created = (body as { document: unknown }).document;
        return { overlay: { id: 'ov_1' } };
      }
      return vi(method, path);
    });
    const { call, close } = await p.connect();
    try {
      await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
      await call('sb_store', { site_id: 's1', action: 'overlay_attach', kind: 'popup', dry_run: false });
      expect(texts(created)).toEqual(expect.arrayContaining(['Đóng', 'Đã hiểu']));
      expect(texts(created)).not.toContain('Got it');
    } finally {
      await close();
    }
  });
});

describe('#77 a cross-page sb_duplicate returns the copies map too', () => {
  it('to_page_id answers old → [new, type] like the same-page call', async () => {
    const p = fakePlatform();
    const { call, close } = await p.connect();
    try {
      await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
      const add = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: { type: 'flex-section', children: [{ type: 'heading', specials: { text: 'A' } }] } });
      const section = Object.entries(add.json.added as Record<string, string>).find(([, t]) => t === 'flex-section')![0];
      const r = await call('sb_duplicate', { id: section, to_page_id: 'pg_2', dry_run: false });
      expect(r.isError, r.text).toBe(false);
      const copies = r.json.copies as Record<string, [string, string]>;
      expect(copies[section][1]).toBe('flex-section');
      expect(Object.values(copies).map((c) => c[1])).toContain('heading');
    } finally {
      await close();
    }
  });
});

describe('#77 the sb_undo listing is compact and names the template', () => {
  it('a template_use row says which template; open-page rows do not repeat the operation and path', async () => {
    expect(summarize('sb_template_use', { template_id: 'sb_faq', page_id: 'pg_1' })).toContain('sb_faq');
    const p = fakePlatform();
    const { call, close } = await p.connect();
    try {
      await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
      await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: { type: 'flex-section' } });
      await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: { type: 'flex-section' } });
      const r = await call('sb_undo', {});
      const rows = r.json.undoable as Array<Record<string, unknown>>;
      expect(rows.length).toBe(2);
      for (const row of rows) {
        expect(row.operationId).toBeUndefined();
        expect(row.path).toBeUndefined();
        expect(row.tool).toBe('sb_add');
      }
      expect(String(r.json.page_saves)).toMatch(/pg_1/);
    } finally {
      await close();
    }
  });
});

/* #72 ---------------------------------------------------------------------- */

describe('#72 a call sheet lists a named string type\'s values, and what renders', () => {
  type F = { name: string; type: string; note?: string };
  const field = (name: string): F => {
    const fields = (JSON.parse(JSON.stringify(describeOperation(findOperation('post:/api/sites/{siteId}/articles')!))) as { body_shape: { fields: F[] } })
      .body_shape.fields;
    return fields.find((f) => f.name === name)!;
  };
  it('status and bodyType carry their values; the sheet says only richtext renders and only published is served', () => {
    expect(field('status').type).toBe('"draft" | "published" | "archived"');
    expect(field('status').note).toContain('StorefrontVisible() is true only for "published"');
    expect(field('bodyType').type).toBe('"richtext" | "page"');
    expect(field('bodyType').note).toContain('BodyTypeRenders() is true only for "richtext"');
  });

  it('a type with consts but no predicate stays silent — its consts may be a subset (site.Role)', () => {
    expect(JSON.stringify(REQUEST_SHAPES)).not.toContain(JSON.stringify('"owner" | "admin" | "editor" | "viewer"').slice(1, -1));
  });
});

/* #73 ---------------------------------------------------------------------- */

describe('#73 sb_traits_for narrowed to one control keeps what the full answer knows', () => {
  it('a declared control carries its allowed values', () => {
    const r = traitsFor('list-dataset', 'articleSourceType') as { values?: string[] };
    expect(r.values).toEqual(expect.arrayContaining(['category', 'page_category', 'slot']));
  });

  it('an undeclared control names the config keys it most likely writes, not "set the CSS"', () => {
    const r = traitsFor('popup', 'popup_trigger') as { likely_keys?: string[]; note?: string };
    expect(r.likely_keys).toEqual(expect.arrayContaining(['config.triggerType', 'config.triggerDelay', 'config.triggerFreq']));
  });
});

/* #74 ---------------------------------------------------------------------- */

describe('#74 an edit inside a pop-up is not "site-wide"', () => {
  const docOf = (rootType: string) => ({
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: {
      ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['ov'] }, specials: {} },
      ov: { id: 'ov', data: { type: rootType, parent: 'ROOT', nodes: ['bt'] }, specials: { overlayId: 'ov_b806' } },
      bt: { id: 'bt', data: { type: 'button', parent: 'ov', nodes: [] }, specials: {} },
    },
  });
  it('a pop-up names the pages it is attached to; the cart drawer stays site-wide', () => {
    const pop = sharedWriteNotes(docOf('popup') as never, ['bt'])[0].note;
    expect(pop).not.toMatch(/site-wide/);
    expect(pop).toMatch(/attached/);
    expect(pop).toContain('/overlays/ov_b806/pages');
    expect(globalWarning(docOf('popup') as never, 'bt')).not.toMatch(/site-wide/);
    expect(sharedWriteNotes(docOf('cart-drawer') as never, ['bt'])[0].note).toMatch(/site-wide/);
  });
});

/* #76 ---------------------------------------------------------------------- */

describe('#76 sb_event open_page takes a bare page id', () => {
  it('resolves url and label from the page list, and the href is projected', async () => {
    const p = fakePlatform((method, path) =>
      method === 'GET' && path === '/api/sites/s1/pages'
        ? { pages: [{ id: 'pg_2', name: 'Giới thiệu', slug: 'gioi-thieu', type: 'about' }, { id: 'pg_home', name: 'Trang chủ', slug: '', isHomepage: true }] }
        : undefined,
    );
    const { call, close } = await p.connect();
    try {
      await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
      const add = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: { type: 'flex-section', children: [{ type: 'button', specials: { text: 'Xem' } }] } });
      const btn = Object.entries(add.json.added as Record<string, string>).find(([, t]) => t === 'button')![0];
      const r = await call('sb_event', { id: btn, action: 'open_page', payload: { pageId: 'pg_2' }, dry_run: false });
      expect(r.isError, r.text).toBe(false);
      const node = (p.pages.get('pg_1')!.document as { nodes: Record<string, { specials: Record<string, unknown>; events: Array<{ payload: Record<string, unknown> }> }> }).nodes[btn];
      expect(node.events[0].payload).toMatchObject({ linkType: 'page', id: 'pg_2', label: 'Giới thiệu', url: '/gioi-thieu' });
      expect(node.specials.href).toBe('/gioi-thieu');
    } finally {
      await close();
    }
  });
});

/* #81 ---------------------------------------------------------------------- */

describe('#81 sb_api_find ranks the resource the query names', () => {
  it('"list products" puts a GET of the products collection above a category\'s products', () => {
    const ids = searchOperations('list products').map((o) => o.id);
    const products = ids.findIndex((i) => i === 'get:/api/sites/{siteId}/products' || i === 'get:/api/v1/products');
    const nested = ids.findIndex((i) => i.includes('/product-categories/{id}/products'));
    expect(products).toBeGreaterThanOrEqual(0);
    expect(products).toBeLessThan(nested === -1 ? Infinity : nested);
    expect(ids[0].startsWith('get:')).toBe(true);
  });

  it('a picked field no record carries is named', () => {
    const out = shapeResponse({ products: [{ id: 'p1', title: 'A' }], total: 1 }, { pick: ['id', 'categoryIds'] }) as Record<string, unknown>;
    expect(JSON.stringify(out)).toMatch(/not on these records: categoryIds/);
  });
});

/* #78 ---------------------------------------------------------------------- */

describe('#78 a theme-variable value does not "detach the node from the theme"', () => {
  it('detachNote stays silent for var(--wb-…) and still speaks for a literal', () => {
    const layer = presetLayer(STARTER_THEME, 'site', { data: { type: 'button' } })!;
    expect(detachNote(layer, ['color'], { color: 'var(--wb-color-primary)' })).toBeNull();
    expect(detachNote(layer, ['color'], { color: '#ff0000' })).toMatch(/OUTRANKS/);
  });

  it('sb_set with a theme var raises no detach check', async () => {
    const p = fakePlatform();
    const { call, close } = await p.connect();
    try {
      await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
      const add = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: { type: 'flex-section', children: [{ type: 'button', specials: { text: 'Mua' } }] } });
      const btn = Object.entries(add.json.added as Record<string, string>).find(([, t]) => t === 'button')![0];
      const r = await call('sb_set', { edits: [{ id: btn, namespace: 'style', keys: { color: 'var(--wb-color-primary)' } }], dry_run: false });
      expect(r.isError, r.text).toBe(false);
      expect(r.text).not.toMatch(/stops following the theme/);
    } finally {
      await close();
    }
  });
});

/* #65 sb_look -------------------------------------------------------------- */

describe('#65 sb_look measures contrast on the render', () => {
  const box = (id: string, extra: Partial<Box>): Box => ({ id, type: 'text', x: 0, y: 0, w: 100, h: 20, hasText: true, fontPx: 16, ...extra });
  const shot = (boxes: Box[]): Shot => ({ width: 1440, imageBase64: '', mimeType: 'image/jpeg', boxes });

  it('a computed colour against the nearest opaque ground under 3:1 is low_contrast', () => {
    const f = measureShot(shot([box('tx_00000001', { fg: 'rgb(255, 255, 255)', bg: 'rgb(247, 249, 251)' })]));
    expect(f.map((x) => x.code)).toContain('low_contrast');
  });

  it('readable text and text over a picture are silent', () => {
    const f = measureShot(shot([
      box('tx_00000001', { fg: 'rgb(25, 28, 30)', bg: 'rgb(247, 249, 251)' }),
      box('tx_00000002', { fg: 'rgb(255, 255, 255)', bg: 'rgb(255, 255, 255)', overImage: true }),
    ]));
    expect(f.filter((x) => x.code === 'low_contrast')).toEqual([]);
  });
});
