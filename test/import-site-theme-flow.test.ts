import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Session } from '../src/transport/auth.js';
import { connectedClient } from './harness.js';
import { clearThemeCache } from '../src/domains/site/theme-fetch.js';
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

/** One fetch that answers both the stranger's site and this platform. */
function fetchFor(sent: Array<{ url: string; method?: string }>): typeof fetch {
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
    if (url.includes('/theme') && init?.method === 'PUT') return json({});
    if (url.includes('/theme')) return json({ theme: themeFixture });
    return json({});
  }) as unknown as typeof fetch;
}

async function run(args: Record<string, unknown>) {
  const sent: Array<{ url: string; method?: string }> = [];
  const f = fetchFor(sent);
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
});
