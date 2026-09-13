import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Session } from '../src/transport/auth.js';
import { connectedClient } from './harness.js';
import { siteTheme, clearThemeCache } from '../src/domains/site/theme-fetch.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import type { ToolContext } from '../src/tools/context.js';
import type { CaptureOutcome } from '../src/vision/capture.js';

/**
 * `sb_import_site`'s THEME WRITE, end to end, over the real tool call.
 *
 * `theme_note` (the dry-run warning) and the `theme:false` opt-out are the two
 * safety features of a site-wide, replace-only, history-less write — see
 * `theme.test.ts` for `sb_theme` itself and `import.test.ts` for the pure
 * `themePatchFor` / `applyThemePatch` functions this flow calls. What is left
 * to pin HERE is that the TOOL actually wires them up: the note appears before
 * anything is created, the flag actually stops the write before it reads the
 * entry's own capture, and the default does not silently skip.
 *
 * `captureMany` is mocked rather than run for real — it launches an actual
 * Chrome via `playwright-core`, which is what `SB_BROWSER_TEST=1` gates
 * elsewhere in this suite, and none of these three assertions are about what
 * the browser walk sees. Discovery still runs for real, off a mocked sitemap,
 * the same way `discover.test.ts` tests the plan without a browser either.
 */

vi.mock('../src/vision/capture.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/vision/capture.js')>();
  return {
    ...actual,
    // Every captured page paints a heading and a body line, which is enough
    // for `sourceTokens` to produce a non-null patch — the case that matters
    // for "does the default apply" and "does theme:false skip before this is
    // even read".
    captureMany: vi.fn(
      async (urls: string[]): Promise<CaptureOutcome[]> =>
        urls.map((url) => ({
          url,
          ok: true,
          result: {
            url,
            title: 'Home',
            canonical: url,
            forms: [],
            skipped: {},
            coverage: 100,
            sections: [
              {
                kind: 'section',
                children: [
                  {
                    kind: 'heading',
                    level: 1,
                    text: 'A',
                    sample: { color: 'rgb(179, 18, 58)', fontSize: '44px' },
                  },
                  { kind: 'text', text: 'b', sample: { color: 'rgb(75, 85, 99)', fontSize: '17px' } },
                ],
              },
            ],
          },
        })),
    ),
  };
});

const sitemap =
  '<urlset>' +
  ['/', '/about'].map((p) => `<url><loc>https://shop.example${p}</loc></url>`).join('') +
  '</urlset>';

const themeFixture = {
  version: 6,
  colors: [
    { id: 'heading', name: 'Heading', value: '#111827' },
    { id: 'text', name: 'Text', value: '#374151' },
  ],
  textStyles: [{ slug: 'heading-1', name: 'H1', base: { fontSize: '40px' } }],
  schemes: [{ id: 'light', name: 'Light' }],
  presets: [{ id: 'heading-default', name: 'Heading', kind: 'heading', base: {} }],
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/**
 * One fetch that answers both the stranger's site and this platform.
 *
 * `failTheme` makes the GET to `/theme` answer 500 — a transient failure, the
 * same shape a 401 or a network blip would take through `request()`, which
 * throws `ApiError` on any non-2xx.
 *
 * The theme is held in a closure variable and a PUT overwrites it, so a GET
 * that follows a PUT answers with what was actually written — needed to tell
 * "the cache was cleared and a fresh read came back stale anyway" apart from
 * "the cache was cleared and the fresh read is current", which a fetch that
 * always answered the same fixture could not distinguish.
 */
function fetchFor(
  sent: Array<{ url: string; method?: string }>,
  opts: { failTheme?: boolean } = {},
): typeof fetch {
  let currentTheme = themeFixture;
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, method: init?.method });
    if (url.endsWith('/robots.txt')) {
      return new Response('Sitemap: https://shop.example/sm.xml', { status: 200 });
    }
    if (url.endsWith('/sm.xml')) return new Response(sitemap, { status: 200 });
    if (url.includes('/pages') && init?.method === 'POST') {
      // No `page.id` — the page creation "fails" and is caught per-page, which
      // is fine: these tests are about the theme block, computed before this
      // loop runs, not about whether a page got built.
      return json({});
    }
    if (url.endsWith('/pages')) return json({ pages: [] });
    if (url.includes('/theme') && init?.method === 'PUT') {
      currentTheme = (JSON.parse(init.body as string) as { theme: typeof themeFixture }).theme;
      return json({});
    }
    if (url.includes('/theme') && init?.method === 'GET' && opts.failTheme) {
      return new Response(JSON.stringify({ error: 'boom', code: 'internal' }), { status: 500 });
    }
    if (url.includes('/theme')) return json({ theme: currentTheme });
    return json({});
  }) as unknown as typeof fetch;
}

async function run(args: Record<string, unknown>, opts: { failTheme?: boolean } = {}) {
  const sent: Array<{ url: string; method?: string }> = [];
  const f = fetchFor(sent, opts);
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  const { client, close } = await connectedClient({ fetchImpl: f, session });
  const res = (await client.callTool({
    name: 'sb_import_site',
    arguments: {
      url: 'https://shop.example',
      site_id: 'S1',
      nav: false,
      upload_images: false,
      ...args,
    },
  })) as { content: Array<{ text?: string }>; isError?: boolean };
  await close();
  const out = JSON.parse(res.content[0].text!);
  return { out, sent };
}

describe('sb_import_site — the theme_note and the theme:false opt-out', () => {
  beforeEach(() => clearThemeCache());

  it("a dry run's result carries theme_note, naming the entry URL and the opt-out", async () => {
    const { out, sent } = await run({});
    expect(out.dry_run).toBe(true);
    expect(out.theme_note).toContain('https://shop.example');
    expect(out.theme_note).toMatch(/theme:false/);
    // A dry run must never reach the theme endpoint at all.
    expect(sent.some((s) => s.url.includes('/theme'))).toBe(false);
  });

  it("theme:false produces theme:{skipped:'theme:false'} and never reads the entry's capture for it", async () => {
    const { out, sent } = await run({ theme: false, dry_run: false });
    expect(out.theme).toEqual({ skipped: 'theme:false' });
    // No GET or PUT to the theme endpoint — the flag stops the write before
    // `siteTheme` (which would GET it) or the PUT is ever reached.
    expect(sent.some((s) => s.url.includes('/theme'))).toBe(false);
  });

  it('the default (theme argument omitted) does NOT skip — it reads the entry and applies', async () => {
    const { out, sent } = await run({ dry_run: false });
    expect(out.theme).toBeDefined();
    expect(out.theme.skipped).toBeUndefined();
    expect(out.theme.changed).toBeInstanceOf(Array);
    expect(out.theme.changed.length).toBeGreaterThan(0);
    expect(sent.some((s) => s.url.includes('/theme') && s.method === 'GET')).toBe(true);
    expect(sent.some((s) => s.url.includes('/theme') && s.method === 'PUT')).toBe(true);
  });

  // CRITICAL: a failed GET must never be read as "this site has no theme
  // yet". `siteTheme` (the read-only reader `sb_node_read` uses) tolerates
  // exactly that failure and hands back the starter theme — reusing it on
  // this write path would PUT the starter's colours, text styles and
  // presets over whatever the site actually has, on nothing worse than a
  // transient 500. The fix routes this write through `readTheme`, which
  // does not catch, so the failure must land as a reported `failed` line
  // with ZERO PUTs — never a "successful" write built from the starter.
  it('a failed theme GET results in NO PUT and a reported failure, never a starter-built write', async () => {
    const { out, sent } = await run({ dry_run: false }, { failTheme: true });
    expect(out.theme).toBeDefined();
    expect(out.theme.failed).toBeDefined();
    expect(out.theme.changed).toBeUndefined();
    expect(out.theme.built_from).toBeUndefined();
    expect(sent.some((s) => s.url.includes('/theme') && s.method === 'GET')).toBe(true);
    expect(sent.some((s) => s.url.includes('/theme') && s.method === 'PUT')).toBe(false);
  });

  // `siteTheme`'s process-wide cache (`theme-fetch.ts`) is what `sb_node_read`
  // reads through to flatten a node's preset colours. If the import's own PUT
  // did not invalidate it, the very next read in the same session would
  // report the colour this write just replaced — "a confident wrong answer"
  // about a site this server itself just changed.
  it("a successful theme write clears siteTheme's cache, so the next read is not stale", async () => {
    const sent: Array<{ url: string; method?: string }> = [];
    const f = fetchFor(sent);
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const ctx: ToolContext = {
      base: 'http://x',
      session,
      fetchImpl: f,
      notices: new Notices(),
      undo: new UndoLog(),
    };

    // Prime the cache with the PRE-patch theme, the way an earlier
    // `sb_node_read` call in the same session would have.
    const before = await siteTheme(ctx, 'S1');
    expect(before.theme.colors.find((c) => c.id === 'heading')?.value).toBe('#111827');
    const getsBeforeImport = sent.filter((s) => s.url.includes('/theme') && s.method === 'GET').length;
    expect(getsBeforeImport).toBe(1);

    const { client, close } = await connectedClient({ fetchImpl: f, session });
    const res = (await client.callTool({
      name: 'sb_import_site',
      arguments: {
        url: 'https://shop.example',
        site_id: 'S1',
        nav: false,
        upload_images: false,
        dry_run: false,
      },
    })) as { content: Array<{ text?: string }> };
    await close();
    const out = JSON.parse(res.content[0].text!);
    expect(out.theme.changed).toBeInstanceOf(Array);
    expect(out.theme.changed.length).toBeGreaterThan(0);

    const getsAfterImport = sent.filter((s) => s.url.includes('/theme') && s.method === 'GET').length;
    const after = await siteTheme(ctx, 'S1');
    const getsAfterSecondRead = sent.filter((s) => s.url.includes('/theme') && s.method === 'GET').length;

    // A cleared cache means this read had to go back to the platform.
    expect(getsAfterSecondRead).toBeGreaterThan(getsAfterImport);
    // And it answers with what the import just wrote, not what was cached
    // before it ran.
    expect(after.theme.colors.find((c) => c.id === 'heading')?.value).toBe('#b3123a');
  });
});
