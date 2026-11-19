import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { ELEMENTS } from '../src/catalog/elements.generated.js';

/**
 * CODE COMPONENTS: the site's own React, pinned by a `code-component` node as
 * `specials: { component, version, props }`. A wrong pin is not refused by the
 * platform — the node saves BLANK and a `codeComponentRender` warning is the
 * only trace — so sb_add / sb_set check it here, before anything is written.
 */
const FAQ_V3 = {
  name: 'Faq',
  version: 3,
  propsSchema: {
    question: { kind: 'text', default: 'Q?' },
    open: { kind: 'boolean', default: false },
    tone: { kind: 'enum', options: ['light', 'dark'], default: 'light' },
    'gap-size': { kind: 'css', default: '12px' },
  },
};
const FAQ_V2 = { name: 'Faq', version: 2, propsSchema: { question: { kind: 'text' } } };
const HERO_V1 = { name: 'Hero', version: 1, propsSchema: { title: { kind: 'text' } } };
const VERSIONS: Record<string, unknown[]> = { Faq: [FAQ_V3, FAQ_V2], Hero: [HERO_V1] };

const RENDER_WARN = { code: 'codeComponentRender', globalId: '', nodeId: 'cc_1', name: 'Faq', reason: 'render threw: boom' };

async function openClient(opts: { saveWarnings?: unknown[] } = {}) {
  let doc: unknown = {
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: { ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: [] }, specials: {} } },
  };
  const puts: Array<{ nodes: Record<string, { data: { type: string }; specials?: Record<string, unknown> }> }> = [];
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const f = (async (url: unknown, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = (init?.method ?? 'GET').toUpperCase();
    if (u.pathname === '/api/sites/s1/code-components') {
      return json({ codeComponents: [FAQ_V3, HERO_V1], total: 2 });
    }
    const v = /^\/api\/sites\/s1\/code-components\/([^/]+)\/versions$/.exec(u.pathname);
    if (v) {
      const list = VERSIONS[decodeURIComponent(v[1])];
      return list ? json({ versions: list, total: list.length }) : json({ error: 'no such component', code: 'not_found' }, 404);
    }
    if (u.pathname.endsWith('/source')) {
      if (method === 'PUT') {
        doc = JSON.parse(String(init!.body)).document;
        puts.push(doc as never);
      }
      const warnings = method === 'PUT' && opts.saveWarnings ? { warnings: opts.saveWarnings } : {};
      return json({ source: { pageId: 'pg_1', siteId: 's1', document: doc, schemaVersion: 2, rev: puts.length + 1, ...warnings } });
    }
    return json({});
  }) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  const { client, close } = await connectedClient({ fetchImpl: f, session, siteId: 's1' });
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text?: string }>; isError?: boolean };
    const raw = res.content.map((c) => c.text ?? '').join('');
    return { raw, isError: !!res.isError, json: (() => { try { return JSON.parse(raw); } catch { return null; } })() };
  };
  await call('sb_page_open', { page_id: 'pg_1' });
  return { call, close, puts };
}

const section = (specials: Record<string, unknown>) => ({
  type: 'flex-section',
  children: [{ type: 'code-component', name: 'cc', specials }],
});
const ccOf = (doc: { nodes: Record<string, { data: { type: string }; specials?: Record<string, unknown> }> }) =>
  Object.values(doc.nodes).find((n) => n.data.type === 'code-component')!;

describe('code components', () => {
  it('the catalog carries the code-component element, so sb_traits_for answers it', async () => {
    expect(ELEMENTS['code-component'], 'code-component missing from the generated catalog').toBeDefined();
    const { call, close } = await openClient();
    try {
      const t = await call('sb_traits_for', { type: 'code-component' });
      expect(t.isError, t.raw).toBe(false);
      const ops = (await call('sb_api_find', { query: 'code components versions' })).json.matches as Array<{ id: string }>;
      const ids = ops.map((o) => o.id);
      expect(ids, 'sb_api_find does not reach the v1 code-components list').toContain('get:/api/v1/code-components');
      expect(ids, 'sb_api_find does not reach the site versions read sb_components uses').toContain('get:/api/sites/{siteId}/code-components/{name}/versions');
    } finally {
      await close();
    }
  });

  it('sb_components lists every component with its latest version, versions and props schemas', async () => {
    const { call, close } = await openClient();
    try {
      const out = await call('sb_components', {});
      expect(out.isError, out.raw).toBe(false);
      expect(out.json.components).toEqual([
        { name: 'Faq', latest: 3, versions: [{ version: 3, props: FAQ_V3.propsSchema }, { version: 2, props: FAQ_V2.propsSchema }] },
        { name: 'Hero', latest: 1, versions: [{ version: 1, props: HERO_V1.propsSchema }] },
      ]);
      expect(out.json.note, 'placement notice not said on first call').toMatch(/sb site push/);
      expect((await call('sb_components', {})).json.note, 'placement notice repeated').toBeUndefined();
    } finally {
      await close();
    }
  });

  it('sb_add places a valid pin', async () => {
    const { call, close, puts } = await openClient();
    try {
      const out = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: section({ component: 'Faq', version: 3, props: { question: 'How long?', open: true, tone: 'dark' } }) });
      expect(out.isError, out.raw).toBe(false);
      expect(ccOf(puts.at(-1)!).specials).toMatchObject({ component: 'Faq', version: 3, props: { question: 'How long?', open: true, tone: 'dark' } });
    } finally {
      await close();
    }
  });

  it('sb_add refuses an unknown prop, naming the props the version takes, and writes nothing', async () => {
    const { call, close, puts } = await openClient();
    try {
      const out = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: section({ component: 'Faq', version: 3, props: { colour: 'red' } }) });
      expect(out.isError, out.raw).toBe(true);
      expect(out.raw).toContain('unknown prop "colour"');
      expect(out.raw).toContain('Faq v3 takes: question, open, tone');
      expect(puts, 'a refused add still saved').toHaveLength(0);
      // The dry run refuses the same way.
      expect((await call('sb_add', { parent_id: 'ROOT', spec: section({ component: 'Faq', version: 3, props: { colour: 'red' } }) })).isError).toBe(true);
    } finally {
      await close();
    }
  });

  it('sb_add refuses an unknown component, an unknown version, a wrong kind and a css prop in props', async () => {
    const { call, close } = await openClient();
    try {
      const add = (specials: Record<string, unknown>) => call('sb_add', { parent_id: 'ROOT', spec: section(specials) });
      expect((await add({ component: 'Nope', version: 1, props: {} })).raw).toContain('no code component "Nope" (it has: Faq, Hero)');
      expect((await add({ component: 'Faq', version: 9, props: {} })).raw).toContain('no version 9 — versions: 3, 2');
      expect((await add({ component: 'Faq', version: 3, props: { open: 'yes' } })).raw).toContain('prop "open" of Faq v3 is kind boolean');
      expect((await add({ component: 'Faq', version: 3, props: { tone: 'neon' } })).raw).toContain('one of light, dark');
      expect((await add({ component: 'Faq', version: 3, props: { 'gap-size': '8px' } })).raw).toContain('style "--gap-size"');
      expect((await add({ version: 3, props: {} })).raw).toContain('needs specials.component');
    } finally {
      await close();
    }
  });

  it('sb_add strips a supplied html / clientUrl and says the platform renders them', async () => {
    const { call, close, puts } = await openClient();
    try {
      const out = await call('sb_add', {
        parent_id: 'ROOT',
        dry_run: false,
        spec: section({ component: 'Hero', version: 1, props: { title: 'Hi' }, html: '<b>mine</b>', clientUrl: '/x.js' }),
      });
      expect(out.isError, out.raw).toBe(false);
      expect(out.json.derived).toMatch(/html \/ clientUrl dropped: the platform renders them/);
      const sent = ccOf(puts.at(-1)!).specials!;
      expect(sent.html, 'caller html reached the save').not.toBe('<b>mine</b>');
      expect(sent, 'caller clientUrl reached the save').not.toHaveProperty('clientUrl');
    } finally {
      await close();
    }
  });

  it('a save\'s codeComponentRender warning comes back verbatim, and only that code', async () => {
    const other = { code: 'globalMissing', globalId: 'g_1' };
    const { call, close } = await openClient({ saveWarnings: [RENDER_WARN, other] });
    try {
      const out = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: section({ component: 'Faq', version: 3, props: {} }) });
      expect(out.isError, out.raw).toBe(false);
      expect(out.json.render_warnings).toEqual([RENDER_WARN]);
    } finally {
      await close();
    }
  });

  it('sb_set re-checks the pin: a version that no longer takes a prop is refused, and html is dropped', async () => {
    const { call, close, puts } = await openClient({ saveWarnings: [RENDER_WARN] });
    try {
      const added = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: section({ component: 'Faq', version: 3, props: { open: true } }) });
      const id = Object.keys(added.json.added as Record<string, string>)[1];
      const down = await call('sb_set', { id, namespace: 'specials', keys: { version: 2 }, dry_run: false });
      expect(down.isError, down.raw).toBe(true);
      expect(down.raw).toContain('unknown prop "open" — Faq v2 takes: question');
      const n = puts.length;
      const ok = await call('sb_set', { id, namespace: 'specials', keys: { version: 2, props: { question: 'Q' }, html: '<i>x</i>' }, dry_run: false });
      expect(ok.isError, ok.raw).toBe(false);
      expect(ok.json.derived).toMatch(/html dropped/);
      expect(ok.json.render_warnings).toEqual([RENDER_WARN]);
      expect(puts.length).toBe(n + 1);
      expect(ccOf(puts.at(-1)!).specials).toMatchObject({ version: 2, props: { question: 'Q' } });
      expect(ccOf(puts.at(-1)!).specials!.html).not.toBe('<i>x</i>');
    } finally {
      await close();
    }
  });
});
