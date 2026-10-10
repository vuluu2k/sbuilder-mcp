import { describe, it, expect } from 'vitest';
import { fakePlatform } from './helpers/platform.js';

/** sb_code, sb_page_version and sb_page_update's template assignment. */
function platform() {
  const writes: Array<{ method: string; path: string; body: any }> = [];
  let file: Record<string, unknown> = {
    id: 'cf1',
    name: 'GA',
    language: 'javascript',
    placement: 'head',
    content: 'gtag()',
    enabled: true,
    position: 0,
  };
  const fake = fakePlatform((method, path, body) => {
    if (method !== 'GET') writes.push({ method, path, body });
    if (path === '/api/sites/s1/code-files') {
      if (method === 'POST') return { codeFile: { id: 'cf2', ...(body as object) } };
      return { codeFiles: [file] };
    }
    if (path === '/api/sites/s1/code-files/cf1') {
      if (method === 'PUT') file = { ...(body as object), id: 'cf1' };
      return method === 'DELETE' ? {} : { codeFile: file };
    }
    if (path === '/api/sites/s1/pages/pt') return { page: { id: 'pt', type: 'product', isDefaultTemplate: false } };
    if (path === '/api/sites/s1/pages/pp') return { page: { id: 'pp', type: 'page' } };
    if (path === '/api/sites/s1/page-links/bulk') return { assigned: 2, moved: 0, unchanged: 0, skipped: 0 };
    if (path.endsWith('/versions')) {
      return method === 'POST' ? { version: { id: 'v9' } } : { versions: [{ id: 'v1', versionNo: 1, label: 'before', createdAt: 't' }], total: 1 };
    }
    if (path.endsWith('/history')) return { history: [{ id: 'h1', createdAt: 't' }] };
    if (path.endsWith('/restore')) return { source: {} };
    if (path.startsWith('/api/sites/s1/pages/pt/')) return { page: { id: 'pt' } };
    return undefined;
  });
  return { fake, writes, file: () => file };
}

describe('sb_code', () => {
  it('update sends the whole stored row back with only the named field moved', async () => {
    const { fake, writes, file } = platform();
    const { call, close } = await fake.connect();
    try {
      const r = await call('sb_code', { site_id: 's1', action: 'set', id: 'cf1', enabled: false, dry_run: false });
      expect(r.isError, r.text).toBe(false);
      expect(writes[0].method).toBe('PUT');
      expect(file()).toMatchObject({ content: 'gtag()', placement: 'head', enabled: false, name: 'GA' });
    } finally {
      await close();
    }
  });

  it('creates site-wide with defaults; dry run by default sends nothing', async () => {
    const { fake, writes } = platform();
    const { call, close } = await fake.connect();
    try {
      const dry = await call('sb_code', { site_id: 's1', action: 'set', name: 'Pixel', content: 'fbq()' });
      expect(dry.json.dry_run).toBe(true);
      expect(writes).toEqual([]);
      await call('sb_code', { site_id: 's1', action: 'set', name: 'Pixel', content: 'fbq()', dry_run: false });
      expect(writes[0].body).toMatchObject({ pageId: '', language: 'javascript', placement: 'body_end', enabled: true });
    } finally {
      await close();
    }
  });

  it('refuses markup in a javascript file, which the server would wrap again', async () => {
    const { fake } = platform();
    const { call, close } = await fake.connect();
    try {
      const r = await call('sb_code', { site_id: 's1', action: 'set', name: 'X', content: '<!-- tag --><script>x()</script>' });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/language:"html"/);
      const ok = await call('sb_code', { site_id: 's1', action: 'set', name: 'X', content: '<script>x()</script>' });
      expect(ok.isError, ok.text).toBe(false);
    } finally {
      await close();
    }
  });
});

describe('sb_page_version', () => {
  it('lists, saves and restores', async () => {
    const { fake, writes } = platform();
    const { call, close } = await fake.connect();
    try {
      const l = await call('sb_page_version', { site_id: 's1', page_id: 'pt', action: 'list' });
      expect(l.json.versions).toEqual([{ id: 'v1', no: 1, label: 'before', at: 't' }]);
      expect((await call('sb_page_version', { site_id: 's1', page_id: 'pt', action: 'save' })).text).toMatch(/needs label/);
      expect((await call('sb_page_version', { site_id: 's1', page_id: 'pt', action: 'save', label: 'x' })).json.dry_run).toBe(true);
      expect(writes).toEqual([]);
      await call('sb_page_version', { site_id: 's1', page_id: 'pt', action: 'save', label: 'x', dry_run: false });
      const dry = await call('sb_page_version', { site_id: 's1', page_id: 'pt', action: 'restore', version_id: 'v1' });
      expect(dry.json.dry_run).toBe(true);
      expect(writes.map((w) => w.path)).toEqual(['/api/sites/s1/pages/pt/versions']);
      await call('sb_page_version', { site_id: 's1', page_id: 'pt', action: 'restore', version_id: 'v1', dry_run: false });
      expect(writes.at(-1)!.path).toBe('/api/sites/s1/pages/pt/versions/v1/restore');
    } finally {
      await close();
    }
  });
});

describe('sb_page_update template assignment', () => {
  it('assigns by the page type\'s link type and sets the default', async () => {
    const { fake, writes } = platform();
    const { call, close } = await fake.connect();
    try {
      const r = await call('sb_page_update', {
        site_id: 's1',
        page_id: 'pt',
        default_template: true,
        render_for: ['p1', 'p2'],
        dry_run: false,
      });
      expect(r.isError, r.text).toBe(false);
      expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual([
        'PUT /api/sites/s1/pages/pt/default-template',
        'POST /api/sites/s1/page-links/bulk',
      ]);
      expect(writes[1].body).toEqual({ linkType: 'product', linkIds: ['p1', 'p2'], pageId: 'pt' });
    } finally {
      await close();
    }
  });

  it('refuses on a page that renders no entities', async () => {
    const { fake } = platform();
    const { call, close } = await fake.connect();
    try {
      const r = await call('sb_page_update', { site_id: 's1', page_id: 'pp', render_for: ['p1'] });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/renders no entities/);
    } finally {
      await close();
    }
  });
});
