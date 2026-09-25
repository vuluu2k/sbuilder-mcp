import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

/**
 * THE SITE SAYS ONE LANGUAGE AND THE PAGE ANOTHER.
 *
 * `settings.locale` is what `<html lang>` is served from — screen readers pick
 * a voice by it, search engines index by it, and the storefront's own built-in
 * strings follow it. A Vietnamese shop whose site was born `en` reads its whole
 * catalogue in an English voice, and nothing on the page shows it.
 */
const text = (id: string, t: string) => ({
  id,
  data: { type: 'text', parent: 'sec', nodes: [] },
  specials: { text: `<p>${t}</p>` },
});

function site(opts: { locale?: string | null; texts: string[]; refuse?: (body: any, auth: string) => boolean }) {
  const calls: Array<{ method: string; path: string; body?: any; auth: string }> = [];
  let settings: Record<string, unknown> | null =
    opts.locale === null ? null : { currency: 'VND', locale: opts.locale ?? 'en' };
  const ids = opts.texts.map((_, i) => `t${i}`);
  const doc = {
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: {
      ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['sec'] } },
      sec: { id: 'sec', data: { type: 'flex-section', parent: 'ROOT', nodes: ids } },
      ...Object.fromEntries(opts.texts.map((t, i) => [ids[i], text(ids[i], t)])),
    },
  };
  const f = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
    calls.push({ method, path, body, auth });
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/source')) return json({ source: { pageId: 'p1', document: doc, schemaVersion: 2 } });
    if (path.endsWith('/settings') && method === 'GET') return json({ settings });
    if (path.endsWith('/settings') && method === 'PUT') {
      if (opts.refuse?.(body, auth)) return json({ error: 'forbidden', code: 'forbidden' }, 403);
      settings = { ...(settings ?? {}), ...body.settings };
      return json({ settings });
    }
    return json({});
  }) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  return {
    calls,
    now: () => settings,
    ctx: { base: 'http://x', session, fetchImpl: f, notices: new Notices(), undo: new UndoLog(), siteId: 's1' },
  };
}

const parse = (r: unknown) => {
  const res = r as { content: Array<{ text: string }>; isError?: boolean };
  return res.isError ? { error: res.content[0].text } : JSON.parse(res.content[0].text);
};

const VI = ['Áo thun cotton mềm mại', 'Giao hàng miễn phí toàn quốc', 'Đổi trả trong 30 ngày', 'Thêm vào giỏ'];
const EN = ['Soft cotton tee', 'Free shipping nationwide', 'Returns within 30 days', 'Add to cart'];

describe('sb_review: the site locale against the page language', () => {
  it('warns ONCE when a Vietnamese page sits on an `en` site', async () => {
    const { ctx } = site({ locale: 'en', texts: VI });
    const { client, close } = await connectedClient(ctx);
    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'p1' } });
    const first = parse(await client.callTool({ name: 'sb_review', arguments: {} }));
    expect(first.site_language).toMatch(/locale is "en".*Vietnamese/);
    expect(first.site_language).toMatch(/sb_theme locale:"vi"/);
    const second = parse(await client.callTool({ name: 'sb_review', arguments: {} }));
    expect(second.site_language).toBeUndefined();
    await close();
  });

  // One page of English on a `vi` site is product and brand names far more
  // often than a wrong locale, so the reverse direction is never warned.
  it.each([
    ['an English page on a `vi` site', 'vi', EN],
    ['unaccented Vietnamese on a `vi` site', 'vi', ['Ao thun cotton', 'Giao hang mien phi', 'Doi tra 30 ngay', 'Them vao gio']],
    ['English brand names on a `vi` site', 'vi', ['Nike Air Max', 'Adidas Ultraboost', 'New Balance 574', 'Converse Chuck']],
    ['a French page on an `fr` site', 'fr', ['Château de rêve', 'Tête-à-tête côté forêt', 'Hôtel près du lac', 'Fenêtre sur côte']],
  ])('is silent on %s', async (_label, locale, texts) => {
    const { ctx } = site({ locale, texts });
    const { client, close } = await connectedClient(ctx);
    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'p1' } });
    const out = parse(await client.callTool({ name: 'sb_review', arguments: {} }));
    expect(out.site_language).toBeUndefined();
    await close();
  });

  it('still warns a Vietnamese page on an `fr` site', async () => {
    const { ctx } = site({ locale: 'fr', texts: VI });
    const { client, close } = await connectedClient(ctx);
    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'p1' } });
    const out = parse(await client.callTool({ name: 'sb_review', arguments: {} }));
    expect(out.site_language).toMatch(/locale is "fr".*Vietnamese/);
    await close();
  });

  it('is silent when they agree, and when the locale is unread', async () => {
    for (const s of [site({ locale: 'vi', texts: VI }), site({ locale: 'en', texts: EN }), site({ locale: null, texts: VI })]) {
      const { client, close } = await connectedClient(s.ctx);
      await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'p1' } });
      expect(parse(await client.callTool({ name: 'sb_review', arguments: {} })).site_language).toBeUndefined();
      await close();
    }
  });
});

describe('sb_theme locale', () => {
  it('dry run by default: names the change and sends nothing', async () => {
    const { ctx, calls } = site({ locale: 'en', texts: [] });
    const { client, close } = await connectedClient(ctx);
    const out = parse(await client.callTool({ name: 'sb_theme', arguments: { locale: 'vi' } }));
    expect(out).toMatchObject({ dry_run: true, locale: { from: 'en', to: 'vi' } });
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
    await close();
  });

  it('writes the locale and keeps every other setting', async () => {
    const { ctx, now } = site({ locale: 'en', texts: [] });
    const { client, close } = await connectedClient(ctx);
    const out = parse(await client.callTool({ name: 'sb_theme', arguments: { locale: 'vi', dry_run: false } }));
    expect(out.locale).toMatchObject({ from: 'en', to: 'vi' });
    expect(now()).toEqual({ currency: 'VND', locale: 'vi' });
    await close();
  });

  it('falls back to the locale-only body the platform lets a narrower credential send', async () => {
    const { ctx, calls, now } = site({ locale: 'en', texts: [], refuse: (b) => Object.keys(b.settings).length > 1 });
    const { client, close } = await connectedClient(ctx);
    await client.callTool({ name: 'sb_theme', arguments: { locale: 'vi', dry_run: false } });
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts.at(-1)!.body).toEqual({ settings: { locale: 'vi' } });
    expect(now()!.locale).toBe('vi');
    await close();
  });

  it('a 403 on every door says so plainly, naming the credential', async () => {
    const { ctx } = site({ locale: 'en', texts: [], refuse: () => true });
    const { client, close } = await connectedClient(ctx);
    const out = parse(await client.callTool({ name: 'sb_theme', arguments: { locale: 'vi', dry_run: false } }));
    expect(out.error).toMatch(/403/);
    expect(out.error).toMatch(/settings/);
    await close();
  });

  it('refuses a tag the platform would refuse', async () => {
    const { ctx } = site({ locale: 'en', texts: [] });
    const { client, close } = await connectedClient(ctx);
    const out = parse(await client.callTool({ name: 'sb_theme', arguments: { locale: 'Vietnamese!' } }));
    expect(out.error).toMatch(/language tag/);
    await close();
  });
});
