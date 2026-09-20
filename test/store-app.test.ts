import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import { APP_SCAFFOLDS } from '../src/catalog/appscaffolds.generated.js';

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

/**
 * A site that already has one page of the courses scaffold — the "courses"
 * list page, present by SLUG — and answers every route `installApp` touches.
 */
function storefront() {
  const calls: Call[] = [];
  const created: Array<{ id: string; slug: string; type: string }> = [];
  let n = 0;
  const f = (async (url: unknown, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path, body });

    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

    if (path.endsWith('/builtin-apps/courses') && method === 'POST') {
      return json({ builtinApp: { key: 'courses' } });
    }
    if (path.endsWith('/builtin-apps/mail') && method === 'POST') {
      return json({ builtinApp: { key: 'mail' } });
    }
    if (path.endsWith('/pages') && method === 'GET') {
      return json({ pages: [{ id: 'p1', slug: 'courses', type: 'page' }, ...created] });
    }
    if (path.endsWith('/pages') && method === 'POST') {
      const id = `p_new_${++n}`;
      const page = {
        id,
        slug: typeof body?.slug === 'string' ? body.slug : '',
        type: typeof body?.type === 'string' ? body.type : '',
      };
      created.push(page);
      return json({ page }, 201);
    }
    return json({});
  }) as unknown as typeof fetch;

  return { f, calls };
}

async function clientOver(f: typeof fetch) {
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  return connectedClient({
    base: 'http://x',
    session,
    fetchImpl: f,
    notices: new Notices(),
    undo: new UndoLog(),
    siteId: 's1',
  });
}

const parse = (r: unknown) =>
  JSON.parse((r as { content: Array<{ text: string }> }).content[0].text) as Record<string, unknown>;

const coursesSpecs = APP_SCAFFOLDS.courses;
const missingSpecs = coursesSpecs.filter((s) => s.slug !== 'courses');

describe('sb_store action:"app"', () => {
  it('dry run lists the install step plus the missing pages, and names the present one', async () => {
    const { f, calls } = storefront();
    const { client, close } = await clientOver(f);

    const out = parse(
      await client.callTool({
        name: 'sb_store',
        arguments: { action: 'app', app_key: 'courses' },
      }),
    );

    expect(out.dry_run).toBe(true);
    const plan = out.plan as Array<{ step: number; method: string; path: string; body?: Record<string, unknown> }>;
    expect(plan[0]).toMatchObject({
      method: 'POST',
      path: '/api/sites/s1/builtin-apps/courses',
    });
    expect(plan.length).toBe(1 + missingSpecs.length);
    for (const p of plan.slice(1)) {
      expect(p.method).toBe('POST');
      expect(p.path).toBe('/api/sites/s1/pages');
    }
    expect(out.present).toEqual([coursesSpecs.find((s) => s.slug === 'courses')!.name.vi]);

    // A dry run reads the page list to say what is missing, and sends
    // nothing that mutates — the same shape action:"chrome" already has.
    expect(calls).toEqual([{ method: 'GET', path: '/api/sites/s1/pages', body: undefined }]);

    await close();
  });

  it('real run installs, re-checks the page list as it grows, and creates the missing pages', async () => {
    const { f, calls } = storefront();
    const { client, close } = await clientOver(f);

    const out = parse(
      await client.callTool({
        name: 'sb_store',
        arguments: { action: 'app', app_key: 'courses', dry_run: false },
      }),
    );

    const installCalls = calls.filter((c) => c.path.endsWith('/builtin-apps/courses'));
    expect(installCalls.length).toBe(1);
    expect(installCalls[0].method).toBe('POST');

    const pagePosts = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/pages'));
    expect(pagePosts.length).toBe(missingSpecs.length);

    for (const call of pagePosts) {
      const body = call.body!;
      expect(body.name).toBeTruthy();
      expect(body.type).toBeTruthy();
      expect(body.document).toBeTruthy();
      const spec = missingSpecs.find((s) => s.type === body.type && s.name.vi === body.name);
      expect(spec).toBeTruthy();
      if (spec!.slug) {
        expect(body.slug).toBe(spec!.slug);
      } else {
        // Sending '' would ask the server to claim the empty slug.
        expect('slug' in body).toBe(false);
      }
    }

    expect(out).toMatchObject({
      installed: 'courses',
      present: [coursesSpecs.find((s) => s.slug === 'courses')!.name.vi],
    });
    expect((out.created as string[]).sort()).toEqual(
      missingSpecs.map((s) => s.name.vi).sort(),
    );

    await close();
  });

  it('a key with no scaffold installs and reports created: []', async () => {
    const { f, calls } = storefront();
    const { client, close } = await clientOver(f);

    const out = parse(
      await client.callTool({
        name: 'sb_store',
        arguments: { action: 'app', app_key: 'mail', dry_run: false },
      }),
    );

    expect(calls.some((c) => c.path.endsWith('/builtin-apps/mail') && c.method === 'POST')).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/pages'))).toBe(false);
    expect(out).toMatchObject({ installed: 'mail', created: [], present: [] });

    await close();
  });

  it('refuses action:"app" with no app_key', async () => {
    const { f } = storefront();
    const { client, close } = await clientOver(f);

    const failed = (await client.callTool({
      name: 'sb_store',
      arguments: { action: 'app' },
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(failed.isError).toBe(true);
    expect(failed.content[0].text).toContain('app_key');

    await close();
  });
});
