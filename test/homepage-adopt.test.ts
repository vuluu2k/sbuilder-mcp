import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Call = { method: string; url: string; body?: Record<string, unknown> };

/** A platform holding `pages`, recording every call made against it. */
function platform(pages: Array<Record<string, unknown>>, listStatus = 200) {
  const calls: Call[] = [];
  const f = (async (url: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const u = String(url);
    calls.push({
      method,
      url: u,
      ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}),
    });
    if (method === 'GET' && u.endsWith('/pages')) {
      return listStatus === 200 ? json({ pages }) : json({ error: 'boom' }, listStatus);
    }
    if (method === 'POST' && u.endsWith('/pages')) {
      return json({ page: { id: 'pg_new', name: 'Trang chủ', slug: '', isHomepage: true } });
    }
    return json({});
  }) as unknown as typeof fetch;
  return { f, calls };
}

const HOME = { id: 'pg_home', name: 'Home', slug: '', path: '/', isHomepage: true };
const args = { site_id: 's1', name: 'Trang chủ', is_homepage: true, chrome: false, dry_run: false };

async function create(f: typeof fetch, over: Record<string, unknown> = {}) {
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  const { client, close } = await connectedClient({
    base: 'http://x',
    session,
    fetchImpl: f,
    notices: new Notices(),
    undo: new UndoLog(),
    siteId: 's1',
  });
  try {
    const res = (await client.callTool({
      name: 'sb_page_create',
      arguments: { ...args, ...over },
    })) as { content: Array<{ text: string }>; isError?: boolean };
    return { text: res.content[0].text, isError: res.isError === true };
  } finally {
    await close();
  }
}

describe('sb_page_create and the site that already has a home page', () => {
  // THE MEASURED BUG. A real store ended with pg_439cb121 "Home" and
  // pg_237719d4 "Trang chủ", both slug "", both path "/" — the first demoted by
  // the create and left reachable at no address at all.
  it('adopts the existing home page instead of creating a second one', async () => {
    const { f, calls } = platform([HOME]);
    const { text, isError } = await create(f);
    expect(isError).toBe(false);

    const posted = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pages'));
    expect(posted).toEqual([]);

    const body = JSON.parse(text) as { into: string; page: { id: string; name: string } };
    expect(body.into).toBe('the existing home page');
    expect(body.page.id).toBe('pg_home');
  });

  // THE LIVENESS ANCHOR. Without it the assertion above passes on a tool that
  // creates nothing ever, which is a different bug wearing this one's test.
  it('still creates the page on a site that has no home page yet', async () => {
    const { f, calls } = platform([]);
    const { isError } = await create(f);
    expect(isError).toBe(false);
    const posted = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pages'));
    expect(posted).toHaveLength(1);
    expect(posted[0].body).toMatchObject({ name: 'Trang chủ', isHomepage: true });
  });

  // …and a create that never asked for the home page is untouched by any of it.
  it('leaves an ordinary create alone even when a home page exists', async () => {
    const { f, calls } = platform([HOME]);
    const { isError } = await create(f, { name: 'Giới thiệu', is_homepage: undefined });
    expect(isError).toBe(false);
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pages'))).toHaveLength(1);
  });

  it('gives the adopted page the name the caller asked for', async () => {
    const { f, calls } = platform([HOME]);
    const { text } = await create(f);
    const patched = calls.filter((c) => c.method === 'PATCH');
    expect(patched).toHaveLength(1);
    expect(patched[0].url).toContain('/pages/pg_home');
    expect(patched[0].body).toEqual({ name: 'Trang chủ' });
    expect(JSON.parse(text).renamed).toEqual({ from: 'Home', to: 'Trang chủ' });
  });

  it('does not rename when the caller asked for the name it already has', async () => {
    const { f, calls } = platform([{ ...HOME, name: 'Trang chủ' }]);
    await create(f);
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);
  });

  it('previews the adoption instead of a POST in a dry run', async () => {
    const { f, calls } = platform([HOME]);
    const { text } = await create(f, { dry_run: true });
    const body = JSON.parse(text) as { dry_run: boolean; into: string; would_post?: string };
    expect(body.dry_run).toBe(true);
    expect(body.into).toBe('the existing home page');
    expect(body.would_post).toBeUndefined();
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  // A listing that could not be READ must not read as a site with no home page:
  // that is the one wrong answer that creates the duplicate this guard prevents.
  it('refuses rather than guessing when the page listing cannot be read', async () => {
    const { f, calls } = platform([HOME], 500);
    const { isError } = await create(f);
    expect(isError).toBe(true);
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pages'))).toEqual([]);
  });
});
