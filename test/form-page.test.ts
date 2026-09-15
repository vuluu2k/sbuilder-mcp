import { describe, it, expect, beforeEach } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

const emptyDoc = {
  schema_version: 2,
  root_node_id: 'rt',
  nodes: {
    rt: { id: 'rt', data: { type: 'root', parent: null, nodes: [], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
  },
};

type Call = { method: string; path: string; body?: Record<string, unknown> };

/** A platform that answers every call the form+page flow makes. */
function platform(opts: { pageCreateFails?: boolean } = {}) {
  const calls: Call[] = [];
  const f = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path, body });
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

    if (path.endsWith('/forms') && method === 'POST') {
      return json({ form: { id: 'frm_1', name: 'X', type: 'login', settings: {} } }, 201);
    }
    if (path.endsWith('/pages') && method === 'POST') {
      return opts.pageCreateFails
        ? json({ error: 'nope', code: 'validation' }, 400)
        : json({ page: { id: 'pg_new', name: 'Đăng nhập' } }, 201);
    }
    if (path.endsWith('/source')) {
      return json({ source: { pageId: 'pg_new', siteId: 's1', document: emptyDoc, schemaVersion: 2, updatedAt: 'now' } });
    }
    return json({});
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function run(f: typeof fetch, args: Record<string, unknown>) {
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  const { client, close } = await connectedClient({
    base: 'http://x', session, fetchImpl: f,
    notices: new Notices(), undo: new UndoLog(), siteId: 's1',
  });
  try {
    const res = (await client.callTool({ name: 'sb_store', arguments: args })) as {
      content: Array<{ text: string }>;
    };
    return JSON.parse(res.content[0].text) as Record<string, unknown>;
  } finally {
    await close();
  }
}

let harness: ReturnType<typeof platform>;
beforeEach(() => {
  harness = platform();
});

describe('sb_store action:"form" builds the page the form lives on', () => {
  // THE MEASURED GAP. seedForm made a form and stopped — "No page is made" —
  // leaving three steps nothing insisted belonged together, and a store built
  // with these tools had no login, register or forgot page at all.
  it('creates the page and saves the form onto it', async () => {
    const body = await run(harness.f, {
      action: 'form', template: 'login', page_name: 'Đăng nhập', dry_run: false,
    });
    expect((body.page as { id: string }).id).toBe('pg_new');

    const created = harness.calls.find((c) => c.method === 'POST' && c.path.endsWith('/pages'));
    expect(created?.body).toMatchObject({ name: 'Đăng nhập', type: 'page' });

    // The form element really carries the form that was just made — a page with
    // an unbound form element is the same blank page, one element heavier.
    const saved = harness.calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/source'));
    expect(saved.length).toBeGreaterThan(0);
    const doc = JSON.stringify(saved[saved.length - 1].body);
    expect(doc).toContain('"formId":"frm_1"');
    expect(doc).toContain('"type":"form"');
  });

  it('puts the headline on the page when one is given', async () => {
    await run(harness.f, {
      action: 'form', template: 'login', page_name: 'Đăng nhập',
      headline: 'Chào mừng trở lại', dry_run: false,
    });
    const saved = harness.calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/source'));
    expect(JSON.stringify(saved[saved.length - 1].body)).toContain('Chào mừng trở lại');
  });

  // THE LIVENESS ANCHOR. Without page_name the old behaviour is untouched —
  // otherwise this is a tool that always makes a page, which is a different
  // change wearing this one's test.
  it('makes no page when none was asked for, and still seeds the form', async () => {
    const body = await run(harness.f, { action: 'form', template: 'login', dry_run: false });
    expect(body.form).toBeTruthy();
    expect(body.page).toBeUndefined();
    expect(harness.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/pages'))).toEqual([]);
    expect(String(body.next)).toMatch(/page_name/);
  });

  // THE FORM EXISTS THE MOMENT ITS OWN CALLS LAND. A refused page must not take
  // it away — that leaves the caller exactly what they had before this argument
  // existed, and they can place it by hand.
  it('reports a refused page without destroying the form', async () => {
    const h = platform({ pageCreateFails: true });
    const body = await run(h.f, {
      action: 'form', template: 'login', page_name: 'Đăng nhập', dry_run: false,
    });
    expect(body.form).toBeTruthy();
    expect(body.page).toBeUndefined();
    expect(body.page_failed).toBeTruthy();
    expect(h.calls.filter((c) => c.method === 'DELETE')).toEqual([]);
  });

  it('says in a dry run whether a page is part of the plan', async () => {
    const withPage = await run(harness.f, {
      action: 'form', template: 'login', page_name: 'Đăng nhập',
    });
    expect(String(withPage.would_also)).toMatch(/create a page/);
    const without = await run(platform().f, { action: 'form', template: 'login' });
    expect(String(without.no_page)).toMatch(/page_name/);
  });
});
