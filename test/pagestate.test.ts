import { describe, it, expect } from 'vitest';
import { canvasVerdict, driftOf } from '../src/domains/site/pagestate.js';
import { bandIds, maxAgeOf, proveLive } from '../src/domains/site/liveproof.js';

/**
 * A PAGE IS THREE DOCUMENTS, and every silent failure in this area is one of
 * them being asked about while another answers.
 *
 * The canvas gate is the editor's, not this server's, and it is the one no
 * screenshot can report: `hydrate()` discards a document whose root is missing
 * and shows an empty ROOT with nothing in the log, while the Go renderer draws
 * the same document without complaint.
 */
describe('canvasVerdict mirrors the editor hydrate gate', () => {
  it('passes an ordinary document', () => {
    const v = canvasVerdict({ root_node_id: 'ROOT', nodes: { ROOT: {}, a: {} } });
    expect(v).toEqual({ blank: false, nodes: 2 });
  });

  /**
   * The shape `editor/src/element/completionPage.ts:91` shipped before
   * `8e40bbab` — `return { rootId: 'ROOT', nodes }`. A real store's
   * order-complete page rendered an empty <body> with a 200 from it.
   */
  it('names the rootId alias, which is repairable in one save', () => {
    const v = canvasVerdict({ rootId: 'ROOT', nodes: { ROOT: {}, a: {} } });
    expect(v.blank).toBe(true);
    expect(v.nodes).toBe(2);
    expect(v.why).toContain('rootId');
    expect(v.fix).toContain('sb_page_open');
  });

  /**
   * The DANGEROUS one, and the fix has to say the opposite of the usual
   * advice: opening this in the editor is what destroys it, because the
   * editor's next save stores the blank it invented.
   */
  it('warns against opening a document whose root names nothing', () => {
    const v = canvasVerdict({ root_node_id: 'ROOT', nodes: { a: {}, b: {} } });
    expect(v.blank).toBe(true);
    expect(v.fix).toMatch(/Do NOT open/);
  });

  /**
   * The current editor draws a minted root; one before web_builder `7322af49a`
   * hard-codes `ROOT`, paints white and may autosave the page blank. Not blank
   * to the gate, and not fine either.
   */
  it('names a minted root, which the current gate passes and an older editor paints white', () => {
    const v = canvasVerdict({ root_node_id: 'sppro_1', nodes: { sppro_1: {}, a: {} } });
    expect(v.blank).toBe(false);
    expect(v.minted_root).toBe('sppro_1');
    expect(v.fix).toContain('sb_page_repair');
  });

  it('treats an empty document as normal for a new page', () => {
    const v = canvasVerdict({ root_node_id: '', nodes: {} });
    expect(v.blank).toBe(true);
    expect(v.why).toContain('normal');
  });

  it('survives a document that is not one', () => {
    expect(canvasVerdict(undefined).nodes).toBe(0);
    expect(canvasVerdict(null).blank).toBe(true);
  });
});

describe('driftOf says which copy is ahead', () => {
  const t = (s: string) => new Date(s).toISOString();

  it('reports a page that was never published', () => {
    expect(driftOf(t('2026-09-21T08:00:00Z'), undefined).state).toBe('never_published');
  });

  it('reports unpublished draft changes', () => {
    const d = driftOf(t('2026-09-21T09:00:00Z'), t('2026-09-21T08:00:00Z'));
    expect(d.state).toBe('draft_ahead');
  });

  /**
   * A cascaded publish — a shared header edited elsewhere republishes every
   * page carrying it — legitimately puts the live row AHEAD of the draft. It
   * is not a defect and must not be reported as one.
   */
  it('reports a live row ahead of the draft as the cascade it is', () => {
    const d = driftOf(t('2026-09-21T08:00:00Z'), t('2026-09-21T09:00:00Z'));
    expect(d.state).toBe('published_ahead');
    expect(d.note).toContain('cascaded');
  });

  /**
   * Publish writes its row after reading the draft, so an untouched page's two
   * timestamps are microseconds apart. Without slack this would report
   * unpublished changes on every page on every check.
   */
  it('allows a second of slack so an untouched page reads in step', () => {
    expect(driftOf('2026-09-21T08:00:00.100Z', '2026-09-21T08:00:00.900Z').state).toBe('in_step');
  });
});

describe('proving the live page serves what was just published', () => {
  const doc = {
    root_node_id: 'ROOT',
    nodes: { ROOT: { data: { nodes: ['fs_a', 'fs_b'] } }, fs_a: {}, fs_b: {} },
  };

  it('fingerprints a page by its top-level bands', () => {
    expect(bandIds(doc)).toEqual(['fs_a', 'fs_b']);
    expect(bandIds(undefined)).toEqual([]);
  });

  it('reads the stale window out of Cache-Control', () => {
    expect(maxAgeOf('public, max-age=60')).toBe(60);
    expect(maxAgeOf(null)).toBeUndefined();
  });

  it('says the origin is serving it, and how long a stale copy may last', async () => {
    const fake = (async () =>
      new Response('<div id="fs_a"></div><div id="fs_b"></div>', {
        status: 200,
        headers: { 'cache-control': 'public, max-age=60', etag: '"x"' },
      })) as unknown as typeof fetch;
    const p = await proveLive('https://shop.test/', bandIds(doc), fake);
    expect(p.serving).toBe(true);
    expect(p.max_age).toBe(60);
    expect(p.note).toContain('60s');
  });

  it('names the bands the served page does not have', async () => {
    const fake = (async () =>
      new Response('<div id="fs_a"></div>', { status: 200 })) as unknown as typeof fetch;
    const p = await proveLive('https://shop.test/', bandIds(doc), fake);
    expect(p.serving).toBe(false);
    expect(p.missing).toEqual(['fs_b']);
  });

  /**
   * A check that cannot run must not read as a publish that failed — the
   * publish already succeeded by the time this is called.
   */
  it('separates "could not check" from "not serving"', async () => {
    const fake = (async () => {
      throw new Error('ENOTFOUND');
    }) as unknown as typeof fetch;
    const p = await proveLive('https://shop.test/', ['fs_a'], fake);
    expect(p.status).toBe(0);
    expect(p.note).toContain('publish itself succeeded');
  });

  /** A distinct cache key, and NOT under a name the platform already uses. */
  it('busts the cache without colliding with the platform\'s own preview token', async () => {
    let seen = '';
    const fake = (async (u: string) => {
      seen = u;
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    await proveLive('https://shop.test/x', [], fake);
    expect(seen).toContain('_sb=');
    expect(new URL(seen).searchParams.get('t')).toBeNull();
  });
});
