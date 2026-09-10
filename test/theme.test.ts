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
});
