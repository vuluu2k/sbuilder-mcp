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

describe('sb_code file kinds', () => {
  const rows = [
    { id: 'a', name: 'css/main.scss', language: 'scss', placement: 'head', content: '$x: 1', enabled: true, position: 0, compileError: 'css/main.scss:1:2: expected ";"' },
    { id: 'b', name: 'data/a b.json', language: 'json', placement: 'none', content: '{}', enabled: true, position: 0 },
    { id: 'c', name: 'p.json', pageId: 'p1', language: 'json', placement: 'none', content: '{}', enabled: true, position: 0 },
    { id: 'd', name: 'off.txt', language: 'text', placement: 'none', content: 'x', enabled: false, position: 0 },
    { id: 'e', name: 'never.ts', language: 'typescript', placement: 'none', content: 'let', enabled: true, position: 0, compileError: 'never.ts:1:4: x' },
    { id: 'f', name: 'ok.ts', language: 'typescript', placement: 'none', content: 'let a=1', enabled: true, position: 0, compiled: 'let a=1;' },
  ];
  function kinds() {
    const writes: Array<{ method: string; path: string; body: any }> = [];
    const fake = fakePlatform((method, path, body) => {
      if (method !== 'GET') writes.push({ method, path, body });
      if (path === '/api/sites/s1/code-files') {
        if (method === 'POST') {
          const b = body as { language: string };
          return { codeFile: { id: 'n1', ...(body as object), ...(b.language === 'scss' ? { compileError: 'x.scss:1:1: boom' } : {}) } };
        }
        return { codeFiles: rows };
      }
      if (path === '/api/sites/s1/code-files/a') {
        if (method === 'PUT') return { codeFile: { ...(body as object), id: 'a', compiled: 'old', compileError: 'still broken' } };
        if (method === 'DELETE') return {};
        return { codeFile: { ...rows[0], compiled: 'old', siteId: 's1', updatedAt: '2026-10-30T01:02:03.456789Z' } };
      }
      return undefined;
    });
    return { fake, writes };
  }

  it('infers language from the extension and placement from the language', async () => {
    const { fake, writes } = kinds();
    const { call, close } = await fake.connect();
    try {
      for (const [name, language, placement] of [
        ['css/main.scss', 'scss', 'head'],
        ['site.css', 'css', 'head'],
        ['app.TSX', 'typescript', 'body_end'],
        ['site.webmanifest', 'json', 'none'],
        ['Analytics tag', 'javascript', 'body_end'],
        ['index.html', 'html', 'body_end'],
      ]) {
        await call('sb_code', { site_id: 's1', action: 'set', name, content: 'x', dry_run: false });
        expect(writes.at(-1)!.body, name).toMatchObject({ language, placement });
      }
      // An extension sb_code does not know is refused before any request — "Pixel v2.1" used to be javascript.
      const n = writes.length;
      const r = await call('sb_code', { site_id: 's1', action: 'set', name: 'Pixel v2.1', content: 'x', dry_run: false });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/does not recognise \(\.1\) — pass language explicitly/);
      expect(writes.length).toBe(n);
      await call('sb_code', { site_id: 's1', action: 'set', name: 'Pixel v2.1', language: 'javascript', content: 'x', dry_run: false });
      expect(writes.at(-1)!.body).toMatchObject({ language: 'javascript', placement: 'body_end' });
      // An explicit language still wins over the extension.
      await call('sb_code', { site_id: 's1', action: 'set', name: 'a.txt', language: 'css', content: 'x', dry_run: false });
      expect(writes.at(-1)!.body).toMatchObject({ language: 'css', placement: 'head' });
    } finally {
      await close();
    }
  });

  it('refuses json/text at an injected placement before any request', async () => {
    const { fake, writes } = kinds();
    const { call, close } = await fake.connect();
    try {
      const r = await call('sb_code', { site_id: 's1', action: 'set', name: 'x.json', placement: 'head', content: '{}', dry_run: false });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/placement:"none"/);
      const t = await call('sb_code', { site_id: 's1', action: 'set', name: 'x', language: 'text', placement: 'body_end', content: 'x' });
      expect(t.isError).toBe(true);
      expect(writes).toEqual([]);
    } finally {
      await close();
    }
  });

  it('refuses markup in scss and typescript, which are wrapped in <style> / <script>', async () => {
    const { fake } = kinds();
    const { call, close } = await fake.connect();
    try {
      const s = await call('sb_code', { site_id: 's1', action: 'set', name: 'a.scss', content: '<link rel="x">' });
      expect(s.isError).toBe(true);
      expect(s.text).toMatch(/<style>/);
      const t = await call('sb_code', { site_id: 's1', action: 'set', name: 'a.ts', content: '<div></div>' });
      expect(t.isError).toBe(true);
      expect(t.text).toMatch(/<script>/);
      // scss/ts are ALWAYS wrapped (codeinject.wrap), even when they open with their own tag:
      // a .tsx opening <script> compiles to React.createElement("script") and throws on every page.
      for (const [name, c] of [['b.scss', '<style>a{}</style>'], ['b.ts', '<script>x()</script>'], ['b.tsx', ' <script>x()</script>']]) {
        const r = await call('sb_code', { site_id: 's1', action: 'set', name, content: c });
        expect(r.isError, name).toBe(true);
        expect(r.text).toMatch(/always wraps/);
      }
      // ... at any placement, because a none scss/ts row is still compiled.
      const n = await call('sb_code', { site_id: 's1', action: 'set', name: 'c.scss', placement: 'none', content: '<style>a{}</style>' });
      expect(n.isError).toBe(true);
      // css/javascript opening with their own tag are emitted as authored.
      const css = await call('sb_code', { site_id: 's1', action: 'set', name: 'a.css', content: '<style>a{}</style>' });
      expect(css.isError, css.text).toBe(false);
      // A none css/javascript row is served raw, never wrapped.
      const raw = await call('sb_code', { site_id: 's1', action: 'set', name: 'a.js', placement: 'none', content: '<div></div>' });
      expect(raw.isError, raw.text).toBe(false);
      // json/text are never wrapped, so markup there is content.
      const j = await call('sb_code', { site_id: 's1', action: 'set', name: 'a.svg', content: '<svg/>' });
      expect(j.isError, j.text).toBe(false);
    } finally {
      await close();
    }
  });

  it('lists compile_error and the served url of enabled site-wide none rows', async () => {
    const { fake } = kinds();
    const { call, close } = await fake.connect();
    try {
      const r = await call('sb_code', { site_id: 's1', action: 'list' });
      const by = Object.fromEntries((r.json.code_files as any[]).map((f) => [f.id, f]));
      expect(by.a.compile_error).toBe('css/main.scss:1:2: expected ";"');
      expect(by.a.url).toBeUndefined();
      expect(by.b.url).toBe('/_wb/code/data/a%20b.json');
      expect(by.b.compile_error).toBeUndefined();
      expect(by.c.url).toBeUndefined();
      expect(by.d.url).toBeUndefined();
      expect(by.e.url).toBeUndefined(); // never compiled: the store serves nothing
      expect(by.f.url).toBe('/_wb/code/ok.ts');
    } finally {
      await close();
    }
  });

  it('a set whose build failed leads with compile_error; compiled output is never sent back', async () => {
    const { fake, writes } = kinds();
    const { call, close } = await fake.connect();
    try {
      const c = await call('sb_code', { site_id: 's1', action: 'set', name: 'x.scss', content: '$a', dry_run: false });
      expect(c.isError, c.text).toBe(false);
      expect(Object.keys(c.json)[0]).toBe('compile_error');
      expect(c.json.compile_error).toMatch(/boom/);
      // No build yet: nothing reaches the page.
      expect(c.json.compile_error).toMatch(/nothing is served or injected until a build succeeds/);
      const u = await call('sb_code', { site_id: 's1', action: 'set', id: 'a', content: '$b: 2;', dry_run: false });
      expect(Object.keys(u.json)[0]).toBe('compile_error');
      // A previous build exists: the site keeps it.
      expect(u.json.compile_error).toMatch(/source stored, the site keeps the previous build/);
      const put = writes.at(-1)!;
      expect(put.method).toBe('PUT');
      expect(put.body).not.toHaveProperty('compiled');
      expect(put.body).not.toHaveProperty('compileError');
    } finally {
      await close();
    }
  });

  it('moving a raw none file into an injected placement runs the markup guard', async () => {
    let row: Record<string, unknown> = {};
    const fake = fakePlatform((method, path, body) => {
      if (path === '/api/sites/s1/code-files' && method === 'POST') return { codeFile: (row = { id: 'r', ...(body as object) }) };
      if (path === '/api/sites/s1/code-files/r') return { codeFile: method === 'PUT' ? (row = { ...(body as object), id: 'r' }) : row };
      return undefined;
    });
    const { call, close } = await fake.connect();
    try {
      const made = await call('sb_code', { site_id: 's1', action: 'set', name: 'a.js', placement: 'none', content: '<div></div>', dry_run: false });
      expect(made.isError, made.text).toBe(false);
      const moved = await call('sb_code', { site_id: 's1', action: 'set', id: 'r', placement: 'body_end' });
      expect(moved.isError).toBe(true);
      expect(moved.text).toMatch(/opens with markup but language is "javascript"/);
      // An enable-only edit on an injected row is not re-judged.
      row = { ...row, placement: 'body_end' };
      const off = await call('sb_code', { site_id: 's1', action: 'set', id: 'r', enabled: false, dry_run: false });
      expect(off.isError, off.text).toBe(false);
    } finally {
      await close();
    }
  });

  it('update and remove are guarded by the updatedAt they read', async () => {
    const { fake, writes } = kinds();
    const { call, close } = await fake.connect();
    try {
      await call('sb_code', { site_id: 's1', action: 'set', id: 'a', enabled: false, dry_run: false });
      expect(writes.at(-1)!.body.expectedUpdatedAt).toBe('2026-10-30T01:02:03.456789Z');
      await call('sb_code', { site_id: 's1', action: 'remove', id: 'a', dry_run: false });
      expect(writes.at(-1)!.method).toBe('DELETE');
      expect(writes.at(-1)!.path).toBe('/api/sites/s1/code-files/a');
      expect(fake.writes.at(-1)!.query).toBe('?expectedUpdatedAt=2026-10-30T01%3A02%3A03.456789Z');
    } finally {
      await close();
    }
  });

  it('a 409 from the guard tells the caller to re-run', async () => {
    const fake = fakePlatform((method, path) => {
      if (path !== '/api/sites/s1/code-files/a') return undefined;
      if (method === 'PUT') return { __status: 409, error: 'this code file changed since expectedUpdatedAt; re-read it and retry', code: 'code_file_changed' };
      return { codeFile: { ...rows[0], updatedAt: '2026-10-30T01:02:03Z' } };
    });
    const { call, close } = await fake.connect();
    try {
      const r = await call('sb_code', { site_id: 's1', action: 'set', id: 'a', enabled: false, dry_run: false });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/code_file_changed/);
      expect(r.text).toMatch(/re-run this sb_code call/);
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

describe('sb_page_version on the open page', () => {
  it('takes the open page\'s site when site_id is omitted', async () => {
    const { fake, writes } = platform();
    const { call, close } = await fake.connect();
    try {
      await call('sb_page_open', { site_id: 's1', page_id: 'px' });
      const r = await call('sb_page_version', { action: 'save', label: 'x', dry_run: false });
      expect(r.text).not.toMatch(/no site/);
      expect(writes.at(-1)!.path).toBe('/api/sites/s1/pages/px/versions');
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
