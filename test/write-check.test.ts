import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { ELEMENTS, BOUND_SPECIALS } from '../src/catalog/elements.generated.js';
import { writeCheck, specCheck } from '../src/domains/site/writecheck.js';
import { LAYOUT_PATTERNS, THEME_TOKENS } from '../src/domains/site/patterns.js';

/**
 * AN UNKNOWN KEY WAS STORED IN SILENCE. `setKeys` and `createNode` never asked
 * whether a key belongs to the element, so `config.colour` on a heading saved,
 * published and changed nothing. The check is a WARNING (the catalog can be
 * older than the platform), and it must never fire on a key the element itself
 * seeds — a caller warned about correct work stops reading warnings.
 */
describe('writeCheck', () => {
  it("every element's OWN defaults produce no unknown_key", () => {
    const noisy: string[] = [];
    for (const [type, el] of Object.entries(ELEMENTS)) {
      const d = el.defaults;
      const layers: Array<[string, Record<string, unknown> | undefined]> = [
        ['config', d.config],
        ['specials', d.specials],
      ];
      for (const slot of Object.values((d.responsive ?? {}) as Record<string, Record<string, Record<string, unknown>>>)) {
        layers.push(['config', slot?.config], ['specials', slot?.specials]);
      }
      for (const st of Object.values((d.states ?? {}) as Record<string, Record<string, Record<string, unknown>>>)) {
        layers.push(['config', st?.config]);
      }
      for (const [ns, keys] of layers) {
        for (const c of writeCheck(type, ns, keys ?? {})) {
          if (c.note.code === 'unknown_key') noisy.push(`${type} ${c.note.key}`);
        }
      }
    }
    expect(noisy).toEqual([]);
  });

  it('a bare default spec of every element is silent end to end', () => {
    const noisy = Object.keys(ELEMENTS).flatMap((type) =>
      specCheck({ type, config: ELEMENTS[type].defaults.config, specials: ELEMENTS[type].defaults.specials })
        .map((c) => `${type}: ${c.note.code} ${c.note.key}`),
    );
    expect(noisy).toEqual([]);
  });

  it("this repo's own built-in layout patterns are silent", () => {
    const noisy = LAYOUT_PATTERNS.flatMap((p) => {
      const spec = p.build(THEME_TOKENS, []);
      return spec ? specCheck(spec).map((c) => `${p.id}: ${c.note.key}`) : [];
    });
    expect(noisy).toEqual([]);
  });

  it('names a key the element does not read, with a fix', () => {
    const [c] = writeCheck('heading', 'config', { colour: 'red' }, { id: 'h1' });
    expect(c.note).toMatchObject({ code: 'unknown_key', id: 'h1', key: 'config.colour' });
    expect(c.note.fix).toMatch(/sb_traits_for/);
  });

  it('accepts universal keys every element can carry', () => {
    expect(writeCheck('heading', 'config', { hidden: true, animation: { active: true, type: 'fade_in' } })).toEqual([]);
    expect(writeCheck('heading', 'specials', { stylePreset: 'x', hoverHostDepth: 2 })).toEqual([]);
  });

  it('never judges style (it is CSS) or an element the catalog does not know', () => {
    expect(writeCheck('heading', 'style', { anything: 1 })).toEqual([]);
    expect(writeCheck('no-such-element', 'config', { anything: 1 })).toEqual([]);
  });

  it('carries the moved value notes as structured notes', () => {
    const [c] = writeCheck('heading', 'config', { animation: 'fade-in' });
    expect(c.note.code).toBe('animation');
    expect(c.note.problem).toMatch(/OBJECT/);
  });

  it('walks a nested spec', () => {
    const out = specCheck({ type: 'flex-section', children: [{ type: 'heading', specials: { txet: 'x' } }] });
    expect(out.map((c) => c.note.key)).toEqual(['specials.txet']);
  });
});

/* ---------------------------------------------------------------- tools -- */

const DOC = {
  schema_version: 2,
  root_node_id: 'ROOT',
  nodes: {
    ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['sec', 'txt', 'btn'] }, specials: {} },
    sec: { id: 'sec', data: { type: 'flex-section', parent: 'ROOT', nodes: [] } },
    txt: { id: 'txt', data: { type: 'text-dataset', parent: 'ROOT', nodes: [] }, bindings: [] },
    btn: { id: 'btn', data: { type: 'button', parent: 'ROOT', nodes: [] }, specials: { text: 'Go' } },
  },
};

async function openClient(doc: unknown = DOC, pages: Record<string, unknown> = {}) {
  const writes: string[] = [];
  const f = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if ((init?.method ?? 'GET') !== 'GET') writes.push(path);
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/source')) {
      return json({ source: { pageId: 'pg_1', siteId: 's1', document: JSON.parse(JSON.stringify(Object.entries(pages).find(([id]) => path.includes(`/${id}/`))?.[1] ?? doc)), schemaVersion: 2, updatedAt: 'now', rev: 1 } });
    }
    return json({});
  }) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  const { client, close } = await connectedClient({ fetchImpl: f, session, siteId: 's1' });
  await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text?: string }>; isError?: boolean };
    const raw = res.content.map((c) => c.text ?? '').join('');
    return { raw, isError: !!res.isError, json: (() => { try { return JSON.parse(raw); } catch { return null; } })() };
  };
  return { call, close, writes };
}

describe('sb_add and sb_set report unknown keys', () => {
  it('sb_add names the nested child key it does not recognise, and still adds', async () => {
    const { call, close } = await openClient();
    try {
      const r = await call('sb_add', {
        parent_id: 'sec',
        spec: { type: 'flex-block', children: [{ type: 'heading', config: { colour: 'red' } }] },
        dry_run: false,
      });
      expect(r.raw).not.toMatch(/^sbuilder:/);
      expect(r.json.added.length).toBeGreaterThan(0);
      expect(r.json.checks).toEqual([expect.objectContaining({ code: 'unknown_key', key: 'config.colour' })]);
    } finally {
      await close();
    }
  });

  it('sb_set names the key, on the node, and writes it anyway', async () => {
    const { call, close } = await openClient();
    try {
      const r = await call('sb_set', { id: 'btn', namespace: 'specials', keys: { lable: 'x' }, dry_run: false });
      expect(r.json.set).toBeDefined();
      expect(r.json.checks).toEqual([expect.objectContaining({ code: 'unknown_key', id: 'btn', key: 'specials.lable' })]);
    } finally {
      await close();
    }
  });
});

describe('sb_bind checks the field against what the element renders', () => {
  it('refuses a field the element never reads, naming the allowed ones', async () => {
    expect(BOUND_SPECIALS['text-dataset']).toContain('boundText');
    const { call, close } = await openClient();
    try {
      const r = await call('sb_bind', { id: 'txt', source: 'product.title', field: 'specials.boundImage' });
      expect(r.raw).toMatch(/boundText/);
      expect(r.raw).toMatch(/force:true/);
    } finally {
      await close();
    }
  });

  it('passes an allowed field, and force passes a refused one as forced', async () => {
    const { call, close } = await openClient();
    try {
      expect((await call('sb_bind', { id: 'txt', source: 'product.title', field: 'specials.boundText' })).json.dry_run).toBe(true);
      const forced = await call('sb_bind', { id: 'txt', source: 'product.title', field: 'specials.boundImage', force: true });
      expect(forced.json.forced?.[0]).toMatch(/boundText/);
    } finally {
      await close();
    }
  });
});

describe('sb_event refuses a navigation with nowhere to go', () => {
  it('go_to_url without payload.url is refused with the shape', async () => {
    const { call, close } = await openClient();
    try {
      const r = await call('sb_event', { id: 'btn', action: 'go_to_url' });
      expect(r.raw).toMatch(/payload\.url/);
      expect(r.raw).toMatch(/force:true/);
    } finally {
      await close();
    }
  });

  it('open_page without a resolved url is refused too', async () => {
    const { call, close } = await openClient();
    try {
      const r = await call('sb_event', { id: 'btn', action: 'open_page', payload: { linkType: 'page', id: 'pg_2' } });
      expect(r.raw).toMatch(/payload\.url/);
    } finally {
      await close();
    }
  });

  it('popup without payload.id is refused', async () => {
    const { call, close } = await openClient();
    try {
      const r = await call('sb_event', { id: 'btn', action: 'popup' });
      expect(r.raw).toMatch(/payload\.id/);
    } finally {
      await close();
    }
  });

  it('a complete payload passes', async () => {
    const { call, close } = await openClient();
    try {
      const r = await call('sb_event', { id: 'btn', action: 'go_to_url', payload: { url: '/a' } });
      expect(r.json.dry_run).toBe(true);
    } finally {
      await close();
    }
  });
});
