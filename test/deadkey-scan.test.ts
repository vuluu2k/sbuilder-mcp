import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  deadKeys,
  deadKeysModule,
  reportDeadKeys,
  seededKeys,
  type DeadKeyScan,
} from '../scripts/deadkey-scan.js';
import { DEAD_KEYS, DEAD_KEY_SOURCE } from '../src/catalog/deadkeys.generated.js';
import { ELEMENTS } from '../src/catalog/elements.generated.js';
import { deadKeyFor, deadKeyNote } from '../src/domains/site/vocabulary.js';
import { Session } from '../src/transport/auth.js';
import { connectedClient } from './harness.js';

/**
 * THE FOURTH STALENESS QUESTION: a key an element SEEDS that nothing reads.
 *
 * These pin the PROPERTY rather than today's one entry. The scan itself needs a
 * platform checkout, so the reader index is passed in as a set here — which is
 * the reason `deadKeys` takes one rather than building its own.
 */
describe('the dead-key scan', () => {
  const el = (config: Record<string, unknown>, specials: Record<string, unknown> = {}) => ({
    defaults: { config, specials },
  });

  it('reports a seeded key that appears in no file the platform ships', () => {
    const elements = { widget: el({ liveKey: 1, deadKey: 'horizontal' }) };
    expect(deadKeys(elements, new Set(['liveKey']))).toEqual([
      { key: 'deadKey', namespaces: ['config'], seededBy: ['widget'] },
    ]);
  });

  // THE EXEMPTION THAT MAKES THIS USABLE. `config.textGlobalStyle` records which
  // text style the author picked while the rendering travels as a var() in
  // `style`, so the editor is its only reader and that is CORRECT. The index is
  // one flat set over Go, the editor and the runtime alike, so an editor-only
  // key is simply a key that is read — there is nothing to special-case, and a
  // check that separated the two would report a working key as dead.
  it('says nothing about a key only the editor reads', () => {
    const elements = { widget: el({ textGlobalStyle: '' }) };
    expect(deadKeys(elements, new Set(['textGlobalStyle']))).toEqual([]);
  });

  // A key read from a TABLE rather than through a cfg* helper is still read.
  // `config.panelBg` is the live case: absent from the platform's own config-key
  // census and read for real at chat-widget/css.go:115, which is exactly why
  // that census cannot answer this question and a raw identifier index can.
  it('says nothing about a key read from a table rather than a helper', () => {
    const elements = { 'chat-widget': el({ panelBg: '#fff' }) };
    expect(deadKeys(elements, new Set(['panelBg']))).toEqual([]);
  });

  it('collects both namespaces and every element that seeds the key', () => {
    const elements = {
      a: el({ ghost: 1 }),
      b: el({}, { ghost: 2 }),
    };
    expect(deadKeys(elements, new Set())).toEqual([
      { key: 'ghost', namespaces: ['config', 'specials'], seededBy: ['a', 'b'] },
    ]);
  });

  // `style` is CSS, resolved by the cascade rather than looked up by name, so an
  // identifier index has nothing to say about one and it is never scanned.
  it('never asks the question of a style key', () => {
    const elements = { widget: { defaults: { style: { widthOfNothing: '1px' } } } };
    expect(seededKeys(elements).size).toBe(0);
    expect(deadKeys(elements, new Set())).toEqual([]);
  });

  // It WARNS and never exits: regenerating cannot close this, so the message has
  // to name the seed site and the two upstream fixes instead.
  it('warns through stderr, naming the seed site and the upstream fix', () => {
    const lines: string[] = [];
    const real = console.error;
    console.error = (...a: unknown[]) => void lines.push(a.join(' '));
    try {
      reportDeadKeys({
        files: 1,
        identifiers: 2,
        seededKeys: 3,
        dead: [{ key: 'ghostKey', namespaces: ['config'], seededBy: ['widget'] }],
      });
    } finally {
      console.error = real;
    }
    const out = lines.join('\n');
    expect(out).toMatch(/ghostKey/);
    expect(out).toMatch(/schema\/src\/elements\/widget\/meta\.ts/);
    expect(out).toMatch(/not fixable by regenerating/);
    expect(out).toMatch(/floor, not a proof/);
  });

  it('says nothing at all when every seeded key is read', () => {
    const lines: string[] = [];
    const real = console.error;
    console.error = (...a: unknown[]) => void lines.push(a.join(' '));
    try {
      reportDeadKeys({ files: 1, identifiers: 2, seededKeys: 3, dead: [] });
    } finally {
      console.error = real;
    }
    expect(lines).toEqual([]);
  });
});

describe('the generated table', () => {
  const path = resolve(process.cwd(), 'src/catalog/deadkeys.generated.ts');

  // GENERATED, NEVER HAND-KEPT — which is what separates this from INERT_ON_ADD,
  // its hand-kept neighbour. Rebuilding the module from the committed table must
  // reproduce the committed file byte for byte, so any hand edit goes red here
  // rather than surviving until somebody re-runs codegen.
  it('is exactly what deadKeysModule emits for the numbers it records', () => {
    const scan: DeadKeyScan = {
      files: DEAD_KEY_SOURCE.files,
      identifiers: DEAD_KEY_SOURCE.identifiers,
      seededKeys: DEAD_KEY_SOURCE.seededKeys,
      dead: Object.values(DEAD_KEYS),
    };
    expect(deadKeysModule(scan)).toBe(readFileSync(path, 'utf8'));
    expect(readFileSync(path, 'utf8')).toMatch(/^\/\/ GENERATED by scripts\/gen-catalog\.ts/);
    expect(DEAD_KEY_SOURCE.dead).toBe(Object.keys(DEAD_KEYS).length);
  });

  // The table and the element catalog are generated from the same run, so a key
  // here that no element seeds means one of the two is stale.
  it('names only keys the committed catalog actually seeds', () => {
    for (const entry of Object.values(DEAD_KEYS)) {
      expect(entry.seededBy.length).toBeGreaterThan(0);
      for (const type of entry.seededBy) {
        const defaults = (
          ELEMENTS[type] as unknown as { defaults?: Record<string, Record<string, unknown>> }
        )?.defaults;
        expect(defaults, `${type} is not in the element catalog`).toBeDefined();
        expect(entry.namespaces.some((ns) => entry.key in (defaults?.[ns] ?? {}))).toBe(true);
      }
    }
    expect(seededKeys(ELEMENTS as never).size).toBe(DEAD_KEY_SOURCE.seededKeys);
  });

  // The two near-misses this scan is built to NOT report, asserted against the
  // committed catalog: one read only by the editor, one read from a Go table.
  // Either appearing here would mean the check had started telling an agent a
  // working key is dead, which is worse than saying nothing.
  it('leaves an editor-only key and a table-read key out', () => {
    expect(DEAD_KEYS['textGlobalStyle']).toBeUndefined();
    expect(DEAD_KEYS['panelBg']).toBeUndefined();
    // `splitPosition` is the live sibling of the one dead key — the renderer
    // reads it, so the element draws a split at a direction nothing can change.
    expect(DEAD_KEYS['splitPosition']).toBeUndefined();
  });
});

describe('the sb_set warning', () => {
  const dead = Object.keys(DEAD_KEYS)[0];

  it('fires for a dead key in either authored namespace', () => {
    if (!dead) return; // nothing dead today is a legitimate state for this table
    expect(deadKeyFor('config', dead)).not.toBeNull();
    expect(deadKeyFor('specials', dead)).not.toBeNull();
  });

  // `style` is CSS and the index has nothing to say about it.
  it('never fires for a style key', () => {
    if (!dead) return;
    expect(deadKeyFor('style', dead)).toBeNull();
    expect(deadKeyNote('style', dead)).toBeNull();
  });

  it('says what happens rather than that the key is unknown', () => {
    if (!dead) return;
    const note = deadKeyNote('config', dead)!;
    expect(note).toMatch(/read by NOTHING/);
    expect(note).toMatch(/stores, saves and publishes with no error/);
    // The fix is upstream and the note has to say so, or the caller retries with
    // a different spelling — and there is no spelling that works.
    expect(note).toMatch(/schema\/src\/elements\/.+\/meta\.ts/);
  });

  it('says nothing about a key the renderer reads', () => {
    expect(deadKeyNote('config', 'splitPosition')).toBeNull();
    expect(deadKeyNote('config', 'textGlobalStyle')).toBeNull();
  });
});

/**
 * THE HALF THAT REACHES AN AGENT, proved through the registered tool rather than
 * through the pure function above.
 *
 * The note is computed in `sb_set`'s own handler, so a correct `deadKeyNote` and
 * a missing call site look identical to every test that stops at the function —
 * which is exactly how the compose `warnings` this repo already records sat
 * typed on a response and read by nothing for three phases.
 */
describe('sb_set through the server', () => {
  const dead = Object.values(DEAD_KEYS)[0];

  it('says so when the write names a key nothing reads', async () => {
    if (!dead) return;
    const type = dead.seededBy[0];
    const document = {
      schema_version: 2,
      root_node_id: 'ROOT',
      nodes: {
        ROOT: {
          id: 'ROOT',
          data: { type: 'root', parent: null, nodes: ['n1'], isCanvas: true, hidden: false, custom: {} },
          style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [],
        },
        n1: {
          id: 'n1',
          data: { type, parent: 'ROOT', nodes: [], isCanvas: false, hidden: false, custom: {} },
          style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [],
        },
      },
    };
    const f = (async () =>
      new Response(
        JSON.stringify({
          source: { pageId: 'pg_1', siteId: 's1', document, schemaVersion: 2, updatedAt: 'now' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({ fetchImpl: f, session });
    try {
      await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
      const res = (await client.callTool({
        name: 'sb_set',
        arguments: { id: 'n1', namespace: 'config', keys: { [dead.key]: 'vertical' } },
      })) as { content: Array<{ text?: string }> };
      const raw = res.content[0].text ?? '';
      expect(raw, raw).not.toMatch(/^sbuilder:/);
      const out = JSON.parse(raw) as { value?: string };
      expect(out.value).toMatch(/read by NOTHING/);
      expect(out.value).toMatch(new RegExp(dead.key));
    } finally {
      await close();
    }
  });
});
