import { describe, it, expect } from 'vitest';
import { Session } from '../src/transport/auth.js';
import { connectedClient } from './harness.js';
import { STARTER_THEME } from '../src/domains/site/theme.js';

/**
 * THE ONE DESIGN DECISION THAT REACHES EVERY PAGE.
 *
 * A style preset compiles to a class rule BENEATH a node's own values, so every
 * node that has not been given a literal follows the theme's tokens. That made
 * the palette both the cheapest way to restyle a site and — until this tool —
 * the one lever the tools pushed an agent away from: `theme.ts` carried read
 * helpers only, and the PUT's shape is `{theme: object}` because the SERVER
 * genuinely does not know the shape.
 *
 * The write is a WHOLE-DOCUMENT REPLACE against a surface with NO HISTORY, so
 * the property that matters is not "does it write" but "can it ever write less
 * than it read".
 */
describe('sb_theme', () => {
  const saved = {
    version: 6,
    colors: [
      { id: 'heading', name: 'Heading', value: '#111827' },
      { id: 'primary', name: 'Primary', value: '#171717' },
    ],
    textStyles: [{ slug: 'h1', name: 'H1', base: { fontSize: '40px' } }],
    schemes: [{ id: 'light', name: 'Light' }],
    presets: [{ id: 'heading-default', name: 'Heading', kind: 'heading', base: {} }],
  };

  async function call(args: Record<string, unknown>, themeReply: unknown = saved) {
    const sent: Array<{ url: string; method?: string; body?: unknown }> = [];
    const f = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      sent.push({
        url,
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.includes('/theme')) {
        return new Response(JSON.stringify({ theme: themeReply }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({ fetchImpl: f, session });
    const res = (await client.callTool({
      name: 'sb_theme',
      arguments: { site_id: 's1', ...args },
    })) as { content: Array<{ text?: string }>; isError?: boolean };
    await close();
    const raw = res.content[0].text!;
    // An error comes back as prose, not JSON — that is the MCP error channel.
    const out = res.isError ? { error: raw } : JSON.parse(raw);
    return { out, sent, isError: res.isError };
  }

  it('reads the palette by TOKEN ID, which is what a preset resolves through', async () => {
    const { out, sent } = await call({});
    expect(out.colors).toEqual({ heading: '#111827', primary: '#171717' });
    expect(out.text_styles).toEqual({ h1: { fontSize: '40px' } });
    expect(sent.every((s) => s.method !== 'PUT')).toBe(true);
  });

  it('says when it is showing the STARTER, because a starter value is not this site', async () => {
    // Handing back the starter's #111827 for a site whose heading token is rose
    // is a confident wrong colour — worse than none. A new site answers
    // 200 {"theme": null}, which the platform calls the normal first state.
    const { out } = await call({}, null);
    expect(out.origin).toMatch(/STARTER/);
    expect(Object.keys(out.colors).length).toBe(STARTER_THEME.colors.length);
  });

  it('SENDS BACK EVERYTHING IT READ, changing only what was named', async () => {
    // The property the whole design rests on: a replace-only endpoint with no
    // history means anything dropped here is gone for good.
    const { out, sent } = await call({ colors: { heading: '#2E2A3B' }, dry_run: false });
    const put = sent.find((s) => s.method === 'PUT')!;
    const body = put.body as { theme: typeof saved };
    expect(body.theme.presets).toHaveLength(1);
    expect(body.theme.textStyles).toHaveLength(1);
    expect(body.theme.schemes).toHaveLength(1);
    expect(body.theme.colors.find((c) => c.id === 'heading')!.value).toBe('#2E2A3B');
    expect(body.theme.colors.find((c) => c.id === 'primary')!.value).toBe('#171717');
    expect(out.changed).toEqual([{ what: 'colors.heading', from: '#111827', to: '#2E2A3B' }]);
  });

  it("a first write on a site with no theme stores a COMPLETE one, not one token", async () => {
    const { sent } = await call({ colors: { heading: '#2E2A3B' }, dry_run: false }, null);
    const body = (sent.find((s) => s.method === 'PUT')!.body as { theme: typeof STARTER_THEME });
    expect(body.theme.presets.length).toBe(STARTER_THEME.presets.length);
    expect(body.theme.colors.find((c) => c.id === 'heading')!.value).toBe('#2E2A3B');
  });

  it('dry-runs first, like every other write here', async () => {
    const { out, sent } = await call({ colors: { primary: '#E8557A' } });
    expect(out.dry_run).toBe(true);
    expect(out.would_change).toHaveLength(1);
    expect(sent.every((s) => s.method !== 'PUT')).toBe(true);
  });

  it('REFUSES a token id the site does not have, and names the ones it does', async () => {
    // A token nothing resolves from is a value the platform stores and no
    // renderer reads — the silent-failure family this server exists to close.
    // A typo would land there rather than on the colour the caller meant.
    const { out, isError } = await call({ colors: { headingg: '#000' }, dry_run: false });
    expect(isError).toBe(true);
    expect(JSON.stringify(out)).toMatch(/heading, primary/);
  });

  it('writes nothing when every value already holds that value', async () => {
    const { out, sent } = await call({ colors: { heading: '#111827' }, dry_run: false });
    expect(out.unchanged).toBe(true);
    expect(sent.every((s) => s.method !== 'PUT')).toBe(true);
  });

  // A SITE THEME FROM BEFORE web_builder v1.0.187: its presets carry the literal
  // `fontFamily: "Inter"` a real site was measured carrying (the starter now
  // seeds `var(--wb-ts-<slug>-family, Inter)`, but a saved theme keeps what it
  // was born with), and heading-3 its mobile 24px.
  const PINNED = ['heading-default', 'text-default', 'text-dataset-default', 'button-default'];
  const starter = () => {
    const t = structuredClone(STARTER_THEME);
    for (const p of t.presets) if (PINNED.includes(p.id) && p.base) p.base.fontFamily = 'Inter';
    return t;
  };

  it('the current starter pins no literal family — every preset follows its text style', async () => {
    const { out } = await call({ text_styles: { 'heading-3': { fontFamily: 'Be Vietnam Pro' } } }, structuredClone(STARTER_THEME));
    expect(out.presets_pin_font).toBeUndefined();
  });
  const putTheme = (sent: Array<{ method?: string; body?: unknown }>) =>
    (sent.find((s) => s.method === 'PUT')!.body as { theme: typeof STARTER_THEME }).theme;

  it('presets: patches a preset base and its responsive layer, keeping everything else', async () => {
    const { out, sent } = await call(
      {
        presets: { 'heading-default': { fontFamily: 'Space Grotesk', mobile: { fontSize: '28px' } } },
        dry_run: false,
      },
      starter(),
    );
    const p = putTheme(sent).presets.find((x) => x.id === 'heading-default')!;
    expect(p.base.fontFamily).toBe('Space Grotesk');
    expect(p.base.color).toBe(STARTER_THEME.presets.find((x) => x.id === 'heading-default')!.base.color);
    expect(p.responsive!.mobile.fontSize).toBe('28px');
    expect(p.responsive!.tablet.fontSize).toBe('40px');
    expect(putTheme(sent).presets).toHaveLength(STARTER_THEME.presets.length);
    expect(out.changed).toEqual([
      { what: 'presets.heading-default.fontFamily', from: 'Inter', to: 'Space Grotesk' },
      { what: 'presets.heading-default.mobile.fontSize', from: '30px', to: '28px' },
    ]);
  });

  it('presets: refuses an id the site does not have', async () => {
    const { out, isError } = await call({ presets: { 'heading-defualt': { fontSize: '1px' } } }, starter());
    expect(isError).toBe(true);
    expect(out.error).toMatch(/heading-default/);
  });

  it('text_styles fontFamily: names the presets still pinning another family', async () => {
    const { out } = await call({ text_styles: { 'heading-3': { fontFamily: 'Be Vietnam Pro' } } }, starter());
    const ids = out.presets_pin_font.map((p: { preset: string }) => p.preset);
    expect(ids).toEqual(expect.arrayContaining(['heading-default', 'text-default', 'text-dataset-default', 'button-default']));
    expect(out.presets_pin_font.find((p: { preset: string }) => p.preset === 'heading-default').fontFamily).toBe('Inter');
  });

  it('text_styles fontFamily: a preset patched in the same call is not reported', async () => {
    const { out } = await call(
      {
        text_styles: { 'heading-3': { fontFamily: 'Be Vietnam Pro' } },
        presets: { 'heading-default': { fontFamily: 'Be Vietnam Pro' } },
      },
      starter(),
    );
    const ids = out.presets_pin_font.map((p: { preset: string }) => p.preset);
    expect(ids).not.toContain('heading-default');
  });

  it('text_styles: writes mobile/tablet/laptop overrides into responsive', async () => {
    const { out, sent } = await call(
      { text_styles: { 'heading-3': { fontSize: '20px', mobile: { fontSize: '18px' } } }, dry_run: false },
      starter(),
    );
    const s = putTheme(sent).textStyles.find((t) => t.slug === 'heading-3')!;
    expect(s.base!.fontSize).toBe('20px');
    expect(s.responsive!.mobile.fontSize).toBe('18px');
    expect(out.changed).toContainEqual({ what: 'textStyles.heading-3.mobile.fontSize', from: '24px', to: '18px' });
    expect(out.responsive_larger).toBeUndefined();
  });

  it('text_styles: warns when an untouched responsive fontSize now exceeds the new base', async () => {
    // Measured: heading-3 base set to 20px left the starter's mobile 24px in
    // place, so the phone heading was LARGER than the desktop one.
    const { out } = await call({ text_styles: { 'heading-3': { fontSize: '20px' } } }, starter());
    expect(out.responsive_larger).toEqual([{ style: 'heading-3', breakpoint: 'mobile', fontSize: '24px', base: '20px' }]);
  });

  it('text_styles: refuses a breakpoint override that is not an object, or an unknown breakpoint', async () => {
    const bad = await call({ text_styles: { 'heading-3': { phone: { fontSize: '1px' } } } }, starter());
    expect(bad.isError).toBe(true);
    expect(bad.out.error).toMatch(/mobile, tablet, laptop/);
  });
});
