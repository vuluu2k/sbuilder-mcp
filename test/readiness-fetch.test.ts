import { describe, it, expect } from 'vitest';
import { gatherReadiness } from '../src/domains/site/readiness-fetch.js';
import { readinessGaps } from '../src/domains/site/readiness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import type { ToolContext } from '../src/tools/context.js';

/** A platform answering each readiness read, recording the paths asked for. */
function platform(forms: unknown) {
  const paths: string[] = [];
  const f = (async (url: unknown) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.endsWith('/forms')) return json(forms);
    if (path.includes('/articles')) return json({ articles: [{}], total: 7 });
    if (path.includes('/blog-categories')) return json({ blogCategories: [{}], total: 2 });
    if (path.includes('/courses')) return json({ courses: [{}], total: 5 });
    if (path.endsWith('/pages')) return json({ pages: [{ type: 'page', status: 'published' }] });
    if (path.endsWith('/global-sections')) return json({ globalSections: [{ kind: 'header' }] });
    return json({});
  }) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  const ctx: ToolContext = {
    base: 'http://x', session, fetchImpl: f, notices: new Notices(), undo: new UndoLog(),
  };
  return { ctx, paths };
}

const formNode = (formId: string) => ({ data: { type: 'form' }, specials: { formId } }) as never;

describe('gatherReadiness reads the form list', () => {
  // PROVING THE WIRING. readiness.test.ts hands `forms` in directly, so every
  // assertion there passes whether or not anything ever fetches it — the trap
  // this repo keeps walking into.
  it('asks the platform for it', async () => {
    const { ctx, paths } = platform({ forms: [] });
    await gatherReadiness(ctx, 's1', []);
    expect(paths.some((p) => p.endsWith('/forms'))).toBe(true);
  });

  it('carries the types through to the gap that needs them', async () => {
    const { ctx } = platform({
      forms: [{ id: 'f_login', type: 'login' }, { id: 'f_register', type: 'register' }],
    });
    const input = await gatherReadiness(ctx, 's1', [formNode('f_login'), formNode('f_register')]);
    expect(readinessGaps(input).map((g) => g.id)).toContain('mergedAuthPage');
  });

  // SILENT ON UNREAD DATA, end to end: a shape this reader does not recognise
  // must read as "not known", never as "no forms".
  // THE SAME WIRING, FOR THE COUNT THAT DECIDES /blog/{slug} RESOLVES. The gap's
  // own tests hand `articles` in directly and pass whether or not anything reads
  // the platform for it.
  it('asks for the articles and carries the count through', async () => {
    const { ctx, paths } = platform({ forms: [] });
    const input = await gatherReadiness(ctx, 's1', []);
    expect(paths.some((p) => p.includes('/articles'))).toBe(true);
    expect(input.articles).toBe(7);
  });

  // EVERY COUNT THE TEMPLATE CHECKS READ, asked for and carried through. Each
  // gap's own tests hand its number in directly and pass whether or not anything
  // fetches it.
  it('asks for the blog categories and the courses too', async () => {
    const { ctx, paths } = platform({ forms: [] });
    const input = await gatherReadiness(ctx, 's1', []);
    expect(paths.some((p) => p.includes('/blog-categories'))).toBe(true);
    expect(paths.some((p) => p.endsWith('/courses'))).toBe(true);
    expect(input.blogCategories).toBe(2);
    expect(input.courses).toBe(5);
  });

  it('reports null rather than an empty list when the read gives no forms', async () => {
    const { ctx } = platform({ unexpected: true });
    const input = await gatherReadiness(ctx, 's1', [formNode('f_login'), formNode('f_register')]);
    expect(input.forms).toBeNull();
    expect(readinessGaps(input).map((g) => g.id)).not.toContain('mergedAuthPage');
  });
});
