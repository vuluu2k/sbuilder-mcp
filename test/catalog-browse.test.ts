import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { catalogBrowse, catalogMatches } from '../src/catalog/element-search.js';
import { ELEMENTS } from '../src/catalog/elements.generated.js';
import { connectedClient } from './harness.js';

const all = () => Object.values(catalogBrowse()).flat();
const types = () => all().map((row) => row.split(' — ')[0]);

describe('catalogBrowse — a search cannot introduce you to anything', () => {
  it('returns every element the platform has, and loses none to grouping', () => {
    expect(types().sort()).toEqual(Object.values(ELEMENTS).map((e) => e.type).sort());
  });

  // THE MEASURED MISSES. A store built with these tools used 17 element types
  // and hand-assembled the rest; every type below was sitting in the catalogue
  // and is unreachable by an agent that does not know the word to search for.
  it('carries the types a hand-built page reached past', () => {
    for (const t of [
      'menu',
      'menu-drawer',
      'hamburger-menu',
      'rating-stars',
      'carousel',
      'tab',
      'google-map',
      'image-comparison',
      'text-marquee',
      'video',
      'quickview',
      'currency-switcher',
      'popup',
    ]) {
      expect(types()).toContain(t);
    }
  });

  it('groups under the categories the palette uses, each one non-empty', () => {
    const groups = catalogBrowse();
    expect(Object.keys(groups)).toContain('basic');
    expect(Object.keys(groups)).toContain('form');
    for (const [name, rows] of Object.entries(groups)) {
      expect(rows.length, name).toBeGreaterThan(0);
    }
  });

  // TYPE AND LABEL ONLY. A description per element would pay for the whole
  // catalogue to answer a question about one of them.
  it('carries no descriptions, so browsing stays cheap', () => {
    const json = JSON.stringify(catalogBrowse());
    expect(json.length).toBeLessThan(6000);
    const withDesc = Object.values(ELEMENTS).find((e) => e.description.length > 40)!;
    expect(json).not.toContain(withDesc.description);
  });
});

describe('sb_catalog_search browses when no query is given', () => {
  // ONE SERVER FOR THE BLOCK, not one per test. Each connectedClient() stands up
  // a full MCP server over an in-memory transport, and three of them running
  // beside the rest of the suite was enough to start tipping unrelated,
  // process-heavy tests (codegen-dirty shells out to git) into failures that
  // moved around between runs. Measured: two clean full runs without this file,
  // three failures across four runs with it at one server per test.
  let client: Awaited<ReturnType<typeof connectedClient>>['client'];
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ client, close } = await connectedClient());
  });
  afterAll(async () => {
    await close();
  });

  async function call(args: Record<string, unknown>) {
    const res = (await client.callTool({
      name: 'sb_catalog_search',
      arguments: args,
    })) as { content: Array<{ text: string }> };
    return JSON.parse(res.content[0].text) as Record<string, unknown>;
  }

  // PROVING THE WIRING. catalogBrowse's own tests above pass whether or not the
  // tool ever calls it — the lesson this repo keeps relearning.
  it('answers the whole catalogue when query is omitted', async () => {
    const body = await call({});
    const groups = body.elements as Record<string, string[]>;
    expect(Object.values(groups).flat().length).toBe(Object.keys(ELEMENTS).length);
  });

  it('answers the whole catalogue for a blank query too', async () => {
    const body = await call({ query: '   ' });
    expect(body.elements).toBeTruthy();
  });

  // THE LIVENESS ANCHOR: searching still searches, and still narrows.
  it('still searches when a query is given', async () => {
    const body = (await call({ query: 'star rating' })) as unknown as Array<{ type: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeLessThan(Object.keys(ELEMENTS).length);
    expect(body.map((m) => m.type)).toEqual(catalogMatches('star rating').map((m) => m.type));
  });
});
