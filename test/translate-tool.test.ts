import { describe, it, expect } from 'vitest';
import { fakePlatform, blank } from './helpers/platform.js';
import { sourceHash } from '../src/domains/site/translate.js';

/**
 * `sb_translate` runs the editor's Multilingual flow — collect, join, write,
 * fill, approve, enable a language — so an agent no longer rebuilds the
 * collector, the FNV fingerprint and the settings merge by hand.
 */
function site() {
  const doc = blank() as { nodes: Record<string, unknown> };
  doc.nodes.ROOT = { ...(doc.nodes.ROOT as object), data: { type: 'root', parent: null, nodes: ['h1', 'm'] } };
  doc.nodes.h1 = {
    id: 'h1',
    data: { type: 'heading', parent: 'ROOT', nodes: [] },
    specials: { text: 'Hello', textHtml: '<b>Hello</b>', htmlTag: 'h1' },
    style: {},
    config: {},
  };
  doc.nodes.m = {
    id: 'm',
    data: { type: 'menu', parent: 'ROOT', nodes: [] },
    specials: { menuItems: [{ id: 'a', label: 'Home' }] },
    style: {},
    config: {},
  };
  let settings: Record<string, unknown> | null = { locale: 'vi', currency: 'VND', theme: { keep: 1 } };
  const sent: Array<{ method: string; path: string; body: unknown }> = [];
  const fake = fakePlatform((method, path, body) => {
    if (!path.startsWith('/api/sites/s1/') || path.endsWith('/source')) return undefined;
    sent.push({ method, path, body });
    if (path === '/api/sites/s1/settings') {
      if (method === 'PUT') settings = (body as { settings: Record<string, unknown> }).settings;
      return { settings };
    }
    if (path === '/api/sites/s1/translations' && method === 'GET') {
      return { byEntity: { h1: { text: 'Hi' } }, hashes: { h1: { text: sourceHash('Hello') } } };
    }
    if (path === '/api/sites/s1/translations' && method === 'PUT') {
      return { written: (body as { entries: unknown[] }).entries.length };
    }
    if (path === '/api/sites/s1/translations/progress') return { counts: [{ entityType: 'node', entities: 1, fields: 1 }], locales: ['en'] };
    if (path === '/api/sites/s1/translations/auto') {
      if (method === 'GET') return { available: true };
      const entries = (body as { entries: unknown[] }).entries;
      return { translations: entries.map(() => ({})), total: entries.length, skipped: 0 };
    }
    if (path === '/api/sites/s1/translations/review/bulk') return { reviewed: 2 };
    return {};
  });
  fake.pages.set('p1', { document: doc, rev: 1 });
  return { fake, sent, settings: () => settings };
}

const writes = (sent: Array<{ method: string }>) => sent.filter((s) => s.method !== 'GET');

describe('sb_translate', () => {
  it('page: joins the collected rows with stored values and hashes', async () => {
    const { fake } = site();
    const { call, close } = await fake.connect();
    try {
      const r = await call('sb_translate', { action: 'page', site_id: 's1', page_id: 'p1', locale: 'en' });
      expect(r.isError, r.text).toBe(false);
      expect(r.json.counts).toEqual({ rows: 3, missing: 2, done: 1, outdated: 0 });
      expect(r.json.locale_not_enabled).toBeDefined();
    } finally {
      await close();
    }
  });

  it('write: refuses a field the registry does not allow, and sends nothing', async () => {
    const { fake, sent } = site();
    const { call, close } = await fake.connect();
    try {
      const r = await call('sb_translate', {
        action: 'write', site_id: 's1', page_id: 'p1', locale: 'en',
        entries: [{ entity_id: 'h1', field: 'text', value: 'Hi' }, { entity_id: 'h1', field: 'htmlTag', value: 'h2' }],
        dry_run: false,
      });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/htmlTag is not translatable/);
      expect(writes(sent)).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('write: dry_run defaults true; a real write carries the source hash and machine source', async () => {
    const { fake, sent } = site();
    const { call, close } = await fake.connect();
    try {
      const args = {
        action: 'write', site_id: 's1', page_id: 'p1', locale: 'en',
        entries: [{ entity_id: 'm', field: 'menuItems.a.label', value: 'Home' }],
      };
      const dry = await call('sb_translate', args);
      expect(dry.isError, dry.text).toBe(false);
      expect(dry.json.dry_run).toBe(true);
      expect(writes(sent)).toHaveLength(0);
      const real = await call('sb_translate', { ...args, dry_run: false });
      expect(real.isError, real.text).toBe(false);
      const put = writes(sent)[0];
      expect(put.path).toBe('/api/sites/s1/translations');
      expect(put.body).toEqual({
        entries: [{ locale: 'en', entityType: 'node', entityId: 'm', field: 'menuItems.a.label', value: 'Home', source: 'machine', sourceHash: sourceHash('Home') }],
      });
    } finally {
      await close();
    }
  });

  it('locales: merges into settings, keeps every other key, never drops the default', async () => {
    const { fake, sent, settings } = site();
    const { call, close } = await fake.connect();
    try {
      const dry = await call('sb_translate', { action: 'locales', site_id: 's1', add: ['en'] });
      expect(dry.isError, dry.text).toBe(false);
      expect(writes(sent)).toHaveLength(0);
      const real = await call('sb_translate', { action: 'locales', site_id: 's1', add: ['EN', 'ja'], dry_run: false });
      expect(real.isError, real.text).toBe(false);
      expect(settings()).toEqual({ locale: 'vi', currency: 'VND', theme: { keep: 1 }, locales: ['vi', 'en', 'ja'] });
      const drop = await call('sb_translate', { action: 'locales', site_id: 's1', remove: ['vi'], dry_run: false });
      expect(drop.isError).toBe(true);
      expect(drop.text).toMatch(/default/);
      expect(writes(sent)).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it('auto: sends machine rows only (no html) with hashes, from the site default', async () => {
    const { fake, sent } = site();
    const { call, close } = await fake.connect();
    try {
      const dry = await call('sb_translate', { action: 'auto', site_id: 's1', page_id: 'p1', locale: 'en' });
      expect(dry.isError, dry.text).toBe(false);
      expect(writes(sent)).toHaveLength(0);
      const real = await call('sb_translate', { action: 'auto', site_id: 's1', page_id: 'p1', locale: 'en', dry_run: false });
      expect(real.isError, real.text).toBe(false);
      const post = writes(sent)[0].body as { locale: string; from: string; entries: Array<{ field: string; sourceHash: string }> };
      expect(post.from).toBe('vi');
      expect(post.entries.map((e) => e.field).sort()).toEqual(['menuItems.a.label', 'text']);
      expect(post.entries.every((e) => /^[0-9a-f]{8}$/.test(e.sourceHash))).toBe(true);
      expect(real.json.written).toBe(2);
    } finally {
      await close();
    }
  });

  it('review: needs entries or all, and sends one bulk call', async () => {
    const { fake, sent } = site();
    const { call, close } = await fake.connect();
    try {
      const none = await call('sb_translate', { action: 'review', site_id: 's1', locale: 'en', dry_run: false });
      expect(none.isError).toBe(true);
      const r = await call('sb_translate', { action: 'review', site_id: 's1', locale: 'en', all: true, dry_run: false });
      expect(r.isError, r.text).toBe(false);
      expect(writes(sent)).toEqual([{ method: 'POST', path: '/api/sites/s1/translations/review/bulk', body: { locale: 'en', all: true } }]);
      expect(r.json.reviewed).toBe(2);
    } finally {
      await close();
    }
  });

  it('status: default, enabled locales, progress and the translator', async () => {
    const { fake } = site();
    const { call, close } = await fake.connect();
    try {
      const r = await call('sb_translate', { action: 'status', site_id: 's1', locale: 'en' });
      expect(r.isError, r.text).toBe(false);
      expect(r.json).toMatchObject({ default: 'vi', locales: ['vi'], auto_translate: { available: true } });
      expect(r.json.progress).toEqual([{ entityType: 'node', entities: 1, fields: 1 }]);
    } finally {
      await close();
    }
  });
});
