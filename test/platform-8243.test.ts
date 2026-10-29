import { describe, it, expect, beforeEach } from 'vitest';
import { fakePlatform, blank } from './helpers/platform.js';
import { STARTER_THEME, presetLayer, resolveVars } from '../src/domains/site/theme.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { PageDoc } from '../src/domains/site/document.js';
import { clearThemeCache } from '../src/domains/site/theme-fetch.js';
import { traitsFor } from '../src/catalog/element-search.js';

/**
 * web_builder 8243d5180 (81d036721 + feat/page-root-traits): the starter text
 * styles carry NO fontFamily, and ROOT gained page-level controls.
 */
beforeEach(() => clearThemeCache());

/** A site theme as the platform now stores it: text styles with no family. */
const inheriting = () => structuredClone(STARTER_THEME);

function accordionPage(literal: string) {
  return PageDoc.from({
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: {
      ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['s'] }, specials: {} },
      s: { id: 's', data: { type: 'flex-section', parent: 'ROOT', nodes: ['a'] }, specials: {} },
      a: { id: 'a', data: { type: 'accordion', parent: 's', nodes: [] }, config: { accordionItemId: 'ai' }, specials: {} },
      ai: { id: 'ai', data: { type: 'accordion-item', parent: 'a', nodes: [] }, style: { fontFamily: literal }, specials: {} },
    },
  } as never);
}

describe('a starter text style with no family', () => {
  it('is what the regenerated starter holds', () => {
    for (const t of STARTER_THEME.textStyles) expect(t.base?.fontFamily, t.slug).toBeUndefined();
  });

  it('reads as INHERIT through var(--wb-ts-<slug>-family, Inter), never as the fallback', () => {
    // schema theme.ts textStyleDecls declares every prop, EMPTY when unset, so the
    // var's fallback never applies — the element inherits the page/site font.
    expect(resolveVars(STARTER_THEME, 'var(--wb-ts-heading-1-family, Inter)')).toBe('inherit');
    const vn = inheriting();
    vn.textStyles.find((t) => t.slug === 'heading-1')!.base.fontFamily = 'Be Vietnam Pro';
    expect(resolveVars(vn, 'var(--wb-ts-heading-1-family, Inter)')).toBe('Be Vietnam Pro');
    // A slug the theme does not carry is undeclared: the fallback DOES apply.
    expect(resolveVars(STARTER_THEME, 'var(--wb-ts-nope-family, Inter)')).toBe('Inter');
    const heading = presetLayer(STARTER_THEME, 'starter', { data: { type: 'heading' }, specials: {} });
    if (heading?.paints.fontFamily) expect(heading.paints.fontFamily).not.toBe('Inter');
  });

  it('default_font neither crashes nor fires when the site theme names no family', () => {
    const fonts: Record<string, string> = {};
    for (const t of inheriting().textStyles) {
      const f = t.base?.fontFamily;
      if (typeof f === 'string' && f) fonts[t.slug] = f;
    }
    expect(fonts).toEqual({});
    expect(reviewDesign(accordionPage('Inter'), { fonts }).map((x) => x.code)).not.toContain('default_font');
    // ...and still fires where the theme DOES name one.
    expect(reviewDesign(accordionPage('Inter'), { fonts: { 'text-2': 'Be Vietnam Pro' } }).map((x) => x.code)).toContain('default_font');
  });

  it('sb_review reads such a site theme without failing', async () => {
    const p = fakePlatform((method, path) =>
      method === 'GET' && path === '/api/sites/s1/theme' ? { theme: inheriting() } : undefined,
    );
    p.pages.set('pg_1', { document: accordionPage('Inter').doc, rev: 1 });
    const { call, close } = await p.connect();
    try {
      await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
      const r = await call('sb_review', {});
      expect(r.isError, r.text).toBe(false);
      expect(r.text).not.toMatch(/default_font/);
    } finally {
      await close();
    }
  });
});

describe('ROOT carries page-level controls', () => {
  const CONTROLS = ['font_family', 'bg_color', 'bg_image', 'padding', 'class_css'];

  it('sb_traits_for root lists them', () => {
    const t = traitsFor('root') as { inspector: Array<{ groups: Array<{ controls: string[] }> }> };
    const listed = t.inspector.flatMap((tab) => tab.groups.flatMap((g) => g.controls));
    expect(listed).toEqual(expect.arrayContaining(CONTROLS));
  });

  it('sb_set on ROOT writes them with no unknown-key warning', async () => {
    const p = fakePlatform();
    p.pages.set('pg_1', { document: blank(), rev: 1 });
    const { call, close } = await p.connect();
    try {
      await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
      const r = await call('sb_set', {
        dry_run: false,
        edits: [
          {
            id: 'ROOT',
            namespace: 'style',
            base: true,
            keys: { fontFamily: 'Be Vietnam Pro', backgroundColor: '#fff7f2', backgroundImage: 'url(https://x/y.png)', padding: '0px' },
          },
          { id: 'ROOT', namespace: 'specials', keys: { className: 'page-x', customCss: '.page-x{}' } },
        ],
      });
      expect(r.isError, r.text).toBe(false);
      expect(r.text).not.toMatch(/unknown_key|not a key/);
      const root = (p.pages.get('pg_1')!.document as { nodes: Record<string, { style?: Record<string, unknown>; specials?: Record<string, unknown> }> }).nodes.ROOT;
      expect(root.style).toMatchObject({ fontFamily: 'Be Vietnam Pro', backgroundColor: '#fff7f2', padding: '0px' });
      expect(root.specials).toMatchObject({ className: 'page-x', customCss: '.page-x{}' });
    } finally {
      await close();
    }
  });
});
