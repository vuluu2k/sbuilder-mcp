import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { ELEMENTS } from '../src/catalog/elements.generated.js';
import { PageSession } from '../src/tools/page.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import { setKeys } from '../src/domains/site/builder.js';

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
const NUM_V1 = { name: 'Num', version: 1, propsSchema: { n: { kind: 'number' } } };
const LINK_V1 = { name: 'Card', version: 1, propsSchema: { href: { kind: 'link' }, pic: { kind: 'image' }, body: { kind: 'richtext' } } };
const VERSIONS: Record<string, unknown[]> = { Faq: [FAQ_V3, FAQ_V2], Hero: [HERO_V1], Num: [NUM_V1], Card: [LINK_V1] };

const RENDER_WARN = { code: 'codeComponentRender', globalId: '', nodeId: 'cc_1', name: 'Faq', reason: 'render threw: boom' };

async function openClient(opts: { saveWarnings?: unknown[]; versionsStatus?: { status: number; code?: string } } = {}) {
  let doc: unknown = {
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: { ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: [] }, specials: {} } },
  };
  const gets: string[] = [];
  const puts: Array<{ nodes: Record<string, { data: { type: string }; specials?: Record<string, unknown> }> }> = [];
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const f = (async (url: unknown, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET') gets.push(u.pathname + u.search);
    if (u.pathname === '/api/sites/s1/code-components') {
      return json({ codeComponents: [FAQ_V3, HERO_V1], total: 2 });
    }
    const v = /^\/api\/sites\/s1\/code-components\/([^/]+)\/versions$/.exec(u.pathname);
    if (v) {
      if (opts.versionsStatus) {
        const { status, code } = opts.versionsStatus;
        return json({ error: 'upstream trouble', ...(code ? { code } : {}) }, status);
      }
      const list = VERSIONS[decodeURIComponent(v[1])];
      return list ? json({ versions: list, total: list.length }) : json({ error: 'no such component', code: 'not_found' }, 404);
    }
    if (u.pathname.endsWith('/source')) {
      if (method === 'PUT') {
        doc = JSON.parse(String(init!.body)).document;
        puts.push(doc as never);
      }
      const warnings = method === 'PUT' && opts.saveWarnings?.length ? { warnings: opts.saveWarnings } : {};
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
  return { call, close, puts, gets };
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

  it('sb_components lists each component with its latest version and props schema, from ONE read', async () => {
    const { call, close, gets } = await openClient();
    try {
      const before = gets.length;
      const out = await call('sb_components', {});
      expect(out.isError, out.raw).toBe(false);
      expect(out.json.components).toEqual([
        { name: 'Faq', latest: 3, props: FAQ_V3.propsSchema },
        { name: 'Hero', latest: 1, props: HERO_V1.propsSchema },
      ]);
      expect(gets.slice(before), 'the list should not fetch versions per component').toEqual(['/api/sites/s1/code-components']);
      expect(out.json.note, 'placement notice not said on first call').toMatch(/sb site push/);
      expect((await call('sb_components', {})).json.note, 'placement notice repeated').toBeUndefined();
    } finally {
      await close();
    }
  });

  it('sb_components with name lists every version and its props schema, asking for the 200 cap', async () => {
    const { call, close, gets } = await openClient();
    try {
      const out = await call('sb_components', { name: 'Faq' });
      expect(out.isError, out.raw).toBe(false);
      expect(out.json).toMatchObject({ name: 'Faq', latest: 3, versions: [{ version: 3, props: FAQ_V3.propsSchema }, { version: 2, props: FAQ_V2.propsSchema }] });
      expect(gets.at(-1)).toBe('/api/sites/s1/code-components/Faq/versions?limit=200');
      expect((await call('sb_components', { name: 'Nope' })).raw).toContain('no code component "Nope"');
    } finally {
      await close();
    }
  });

  it('a 500, or a 404 that is not the platform\'s not_found, on /versions is an error, never "no such component"', async () => {
    for (const versionsStatus of [{ status: 500, code: 'internal' }, { status: 404 }]) {
      const { call, close } = await openClient({ versionsStatus });
      try {
        const out = await call('sb_add', { parent_id: 'ROOT', spec: section({ component: 'Faq', version: 3, props: {} }) });
        expect(out.isError, out.raw).toBe(true);
        expect(out.raw).toContain(`http ${versionsStatus.status}`);
        expect(out.raw).not.toContain('no code component');
      } finally {
        await close();
      }
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
      expect((await add({ component: 'Faq', version: null, props: {} })).raw).toContain('needs specials.version');
      expect((await add({ component: 'Faq', version: 3, props: 'x' })).raw).toContain('specials.props must be an object');
      expect((await add({ component: 'Faq', version: 3, props: ['x'] })).raw).toContain('specials.props must be an object');
      expect((await add({ component: 'Faq', version: 3, props: { question: 7 } })).raw).toContain('prop "question" of Faq v3 is kind text: expected a string');
      expect((await add({ component: 'Num', version: 1, props: { n: '3' } })).raw).toContain('is kind number: expected a finite number');
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

  it('mirrors SanitizeProps: URLs, byte caps, UTF-8, null values and null props', async () => {
    const { call, close } = await openClient();
    try {
      const add = (props: unknown) => call('sb_add', { parent_id: 'ROOT', spec: section({ component: 'Card', version: 1, props }) });
      for (const ok of [{ href: '/shop', pic: 'https://x.test/a.png' }, { href: '#top' }, { href: 'shop/a:b', pic: '' }, { href: '?q=1' }]) {
        expect((await add(ok)).isError, `refused a URL the platform accepts: ${JSON.stringify(ok)}`).toBe(false);
      }
      for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.test', '/\\evil', 'mailto:a@b', 'a:b/c']) {
        expect((await add({ href: bad })).raw, `accepted ${bad}`).toContain('must be an http(s) or site-relative URL');
      }
      const longUrl = '/' + 'a'.repeat(2048);
      expect(Buffer.byteLength(longUrl)).toBe(2049);
      expect((await add({ href: longUrl })).raw).toContain('longer than 2048 bytes');
      expect((await add({ href: '/' + 'a'.repeat(2047) })).isError, 'a 2048-byte link is allowed').toBe(false);
      // Counted in UTF-8 BYTES: 22,000 three-byte characters is 66,000 bytes over a 65,536 cap.
      const wide = String.fromCharCode(0x1ec7).repeat(22_000); // ệ
      expect(wide.length).toBeLessThan(64 << 10);
      expect(Buffer.byteLength(wide)).toBeGreaterThan(64 << 10);
      expect((await add({ body: wide })).raw).toContain('longer than 65536 bytes');
      expect((await add({ body: String.fromCharCode(0xd800) + 'x' })).raw).toContain('not valid UTF-8');
      expect((await add({ href: null, body: null })).isError, 'a null prop is "use the default"').toBe(false);
      expect((await add(null)).isError, 'props: null is no props').toBe(false);
    } finally {
      await close();
    }
  });

  it('sb_add takes an omitted version as the element default (1), and reads each component once per call', async () => {
    const { call, close, puts, gets } = await openClient();
    try {
      const before = gets.length;
      const out = await call('sb_add', {
        parent_id: 'ROOT',
        dry_run: false,
        spec: { type: 'flex-section', children: [
          { type: 'code-component', specials: { component: 'Hero', props: { title: 'A' } } },
          { type: 'code-component', specials: { component: 'Hero', props: { title: 'B' } } },
        ] },
      });
      expect(out.isError, out.raw).toBe(false);
      expect(ccOf(puts.at(-1)!).specials!.version).toBe(1);
      expect(gets.slice(before).filter((g) => g.includes('/versions')), 'versions read more than once in one call').toHaveLength(1);
    } finally {
      await close();
    }
  });

  it('strips hydrateProps like html and clientUrl', async () => {
    const { call, close, puts } = await openClient();
    try {
      const out = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: section({ component: 'Hero', version: 1, props: {}, hydrateProps: { title: 'x' } }) });
      expect(out.isError, out.raw).toBe(false);
      expect(out.json.derived).toContain('hydrateProps');
      expect(ccOf(puts.at(-1)!).specials, 'caller hydrateProps reached the save').not.toHaveProperty('hydrateProps');
    } finally {
      await close();
    }
  });

  it('a clean save after a warned one carries no render_warnings', async () => {
    const saveWarnings: unknown[] = [RENDER_WARN];
    const { call, close } = await openClient({ saveWarnings });
    try {
      const first = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: section({ component: 'Hero', version: 1, props: {} }) });
      expect(first.json.render_warnings, 'fixture did not warn').toEqual([RENDER_WARN]);
      saveWarnings.length = 0;
      const second = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: section({ component: 'Hero', version: 1, props: {} }) });
      expect(second.isError, second.raw).toBe(false);
      expect(second.json, 'a stale render warning was reported again').not.toHaveProperty('render_warnings');
    } finally {
      await close();
    }
  });

  it('sb_set: unset of a content key re-checks the pin, and a batch is judged per node on its final state', async () => {
    const { call, close, gets } = await openClient();
    try {
      const added = await call('sb_add', { parent_id: 'ROOT', dry_run: false, spec: section({ component: 'Faq', version: 3, props: { open: true } }) });
      const id = Object.keys(added.json.added as Record<string, string>)[1];
      expect((await call('sb_set', { id, namespace: 'specials', unset: ['version'], dry_run: false })).raw).toContain('needs specials.version');
      expect((await call('sb_set', { id, namespace: 'specials', unset: ['component'], dry_run: false })).raw).toContain('needs specials.component');
      const before = gets.length;
      const cleared = await call('sb_set', { id, namespace: 'specials', unset: ['props'], dry_run: false });
      expect(cleared.isError, cleared.raw).toBe(false);
      expect(gets.slice(before).some((g) => g.includes('/Faq/versions')), 'unset props skipped the pin check').toBe(true);
      // Down to v2, then props it takes: each edit alone would be refused on the way.
      await call('sb_set', { id, namespace: 'specials', keys: { props: { open: true } }, dry_run: false });
      const batch = await call('sb_set', {
        dry_run: false,
        edits: [
          { id, namespace: 'specials', keys: { version: 2 } },
          { id, namespace: 'specials', keys: { props: { question: 'Q' } } },
        ],
      });
      expect(batch.isError, batch.raw).toBe(false);
      // And the reverse: the node is now v2 + `question`, so the LAST edit alone (version 2)
      // reads fine on it, while the batch's final state is v2 + `open`.
      const folded = await call('sb_set', {
        dry_run: false,
        edits: [
          { id, namespace: 'specials', keys: { props: { open: true } } },
          { id, namespace: 'specials', keys: { version: 2 } },
        ],
      });
      expect(folded.raw, 'the batch was judged edit by edit, not on its final state').toContain('unknown prop "open" — Faq v2 takes: question');
    } finally {
      await close();
    }
  });

  it('a save that changes nothing reports no render warnings from the save before it', async () => {
    let warn = true;
    const doc = {
      schema_version: 2,
      root_node_id: 'ROOT',
      nodes: {
        ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['fs_1'] }, specials: {} },
        fs_1: { id: 'fs_1', data: { type: 'flex-section', parent: 'ROOT', nodes: [] }, style: {}, config: {}, specials: {}, responsive: {} },
      },
    };
    const fetchImpl = (async (_u: string, init?: { method?: string }) => {
      const put = (init?.method ?? 'GET') === 'PUT';
      const source = { pageId: 'pg_1', siteId: 's1', document: doc, schemaVersion: 2, updatedAt: '', rev: 1, ...(put && warn ? { warnings: [RENDER_WARN] } : {}) };
      return new Response(JSON.stringify({ source }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const session = new PageSession({ base: 'http://x', session: new Session('http://x'), apiKey: 'wbk_k', fetchImpl, notices: new Notices(), undo: new UndoLog() } as never);
    await session.open('s1', 'pg_1');
    session.applyAndPublish(setKeys(session.current(), 'fs_1', { color: '#fff' }, { namespace: 'style', base: true }));
    await session.save();
    expect(session.renderWarnings(), 'fixture did not warn').toEqual([RENDER_WARN]);
    warn = false;
    await session.save(); // nothing changed: skipped, no PUT
    expect(session.renderWarnings(), 'a skipped save reported the previous save\'s warning').toEqual([]);
  });
});
