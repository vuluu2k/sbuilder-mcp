/**
 * A SEEDED KEY THAT NOTHING READS — the fourth staleness question.
 *
 * An element's `meta.defaults.config` seeds a key. `sb_node_read` returns it
 * with a plausible value, so an agent following design rule 0 reads it off the
 * node and writes a different one. It stores, saves, publishes and renders
 * EXACTLY AS BEFORE, because no renderer anywhere reads that key — not Go, not
 * the editor, not the runtime. There is no error at any step and nothing on the
 * page looks broken.
 *
 * Same family as a binding outside the `specials` namespace, a `stuck` override
 * with no host, and `payCard*` written on a `form` — all of which this repo
 * already closes. And the same asymmetry CLAUDE.md records for
 * `BASE_ONLY_CONFIG`: IT PROTECTS THE HUMAN AND NOT THE AGENT. A merchant cannot
 * reach the key at all, because the inspector draws no row for it; an agent
 * reads it off the node and can reach it on every call.
 *
 * THE PLATFORM'S OWN CENSUS CANNOT ANSWER THIS, and reaching for it is the first
 * thing that looks right. `server/render/tests/testdata/config_keys.json` is a
 * list of the config keys the Go renderer reads, and it is INCOMPLETE:
 * `config.panelBg` is read for real at `server/render/nodes/chat-widget/css.go:115`
 * — from a table rather than through a `cfg*` helper — and is absent from it.
 * Its own header comment records ten keys having left it silently once before. A
 * check built on that census would tell an agent a working key is dead, which is
 * strictly worse than saying nothing.
 *
 * So the index is RAW: every identifier in every file the platform ships, with
 * one load-bearing exclusion — an element's own `meta.ts`, because a SEED IS NOT
 * A READER and every key would otherwise find itself.
 *
 * READ ONLY BY THE EDITOR IS NOT A DEFECT AND IS NOT REPORTED.
 * `config.textGlobalStyle` records which text style the author picked while the
 * rendering travels as a `var(--wb-ts-…)` in `style`; `customImageRatio{Width,
 * Height}` are the same shape. Those are correct. The question this asks is
 * narrower and it is the only one worth asking: read by NOTHING, ANYWHERE.
 *
 * MEASURED against origin/main of 2026-09-14 (`3b9ade0c`) and the 113-element
 * catalog:
 *
 *   3,966 files, 76,235 distinct identifiers, 0.86 seconds.
 *   385 seeded (namespace, key) pairs over 384 distinct names.
 *   EXACTLY ONE key is read nowhere: `config.splitDirection` on
 *   `image-comparison`, seeded 'horizontal' at that element's meta.ts:24 and
 *   appearing in no other file in the platform. ZERO false positives.
 *
 * That one is confirmed by the platform's own comment three lines above the
 * seed: the inspector editor that would write it "is still an inert
 * placeholder". Its sibling `splitPosition` IS read, so the element renders a
 * split — at a direction no document can change.
 *
 * THIS IS A FLOOR, NOT A PROOF, and the limits are stated rather than chased:
 *
 *   - An identifier index cannot see a key assembled at runtime
 *     (`cfg['split' + 'Direction']`), which would read as dead. None exists
 *     today.
 *   - It counts a MENTION as a read. An element's `ai.ts` prose naming a key it
 *     no longer renders would keep that key out of this table. Excluding prose
 *     was measured and rejected: the configuration above already reports the one
 *     real defect with no false positives, and widening a scan until it can
 *     prove a negative is what this repo has paid for before — a grep for
 *     `node.States` "found only four files" and produced a conclusion a probe
 *     then disproved.
 *
 * It WARNS and does not fail `--check`, for the same reason
 * `reportUndocumentedRoutes` does: the drift is not fixable by regenerating
 * anything here. Either the platform wires the key up or it drops the seed, and
 * the message names that instead.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Everything the platform ships that a key could be read from. */
export const READER_ROOTS = ['schema/src', 'editor/src', 'server', 'runtime'] as const;

/** The file kinds a reader lives in. */
const READER_EXT = /\.(ts|vue|go|js|json)$/;

/** Directories that hold a COPY of something already indexed, never a reader. */
const SKIP_DIR = new Set(['node_modules', 'dist', 'golden']);

/** An element's own seed. See the header — a seed is not a reader. */
const SEED_FILE = /\/elements\/[^/]+\/meta\.ts$/;

/** The identifier shape a config or specials key takes. */
const IDENTIFIER = /[A-Za-z][A-Za-z0-9_]{2,}/g;

/** One key seeded by at least one element and read by nothing. */
export interface DeadKeyEntry {
  key: string;
  /** The namespaces it is seeded in — `config`, `specials`, or both. */
  namespaces: string[];
  /** Every element whose `meta.defaults` seeds it. */
  seededBy: string[];
}

/** What the scan measured, so a reader can tell a thin index from a real one. */
export interface DeadKeyScan {
  files: number;
  identifiers: number;
  seededKeys: number;
  dead: DeadKeyEntry[];
}

/**
 * Every identifier the platform mentions outside an element's own seed.
 *
 * A flat set of NAMES, which is why deadness is a property of the name rather
 * than of the (namespace, key) pair: the index cannot tell `config.foo` from
 * `specials.foo`, and a key read anywhere is read.
 */
export function buildReaderIndex(repo: string): { readers: Set<string>; files: number } {
  const readers = new Set<string>();
  let files = 0;
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // a root this checkout does not carry
    }
    for (const e of entries) {
      const full = resolve(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIR.has(e.name)) walk(full);
        continue;
      }
      if (!READER_EXT.test(e.name) || e.name.includes('.min.')) continue;
      if (SEED_FILE.test(full)) continue;
      files++;
      for (const m of readFileSync(full, 'utf8').matchAll(IDENTIFIER)) readers.add(m[0]);
    }
  };
  for (const root of READER_ROOTS) walk(resolve(repo, root));
  return { readers, files };
}

/** Structurally typed so this module needs no import from the catalog. */
export interface SeedingElement {
  defaults?: {
    config?: Record<string, unknown>;
    specials?: Record<string, unknown>;
    /** Carried so a caller may pass a whole element; deliberately never read. */
    [namespace: string]: unknown;
  };
}

/**
 * Every key any element seeds, with the namespaces and elements that seed it.
 *
 * `style` is deliberately absent: a style key is CSS, resolved by the cascade
 * rather than looked up by name in a renderer, so an identifier index has
 * nothing to say about one.
 */
export function seededKeys(
  elements: Record<string, SeedingElement>,
): Map<string, { namespaces: Set<string>; seededBy: string[] }> {
  const seeds = new Map<string, { namespaces: Set<string>; seededBy: string[] }>();
  for (const [type, el] of Object.entries(elements)) {
    for (const ns of ['config', 'specials'] as const) {
      for (const key of Object.keys(el.defaults?.[ns] ?? {})) {
        let entry = seeds.get(key);
        if (!entry) seeds.set(key, (entry = { namespaces: new Set(), seededBy: [] }));
        entry.namespaces.add(ns);
        if (!entry.seededBy.includes(type)) entry.seededBy.push(type);
      }
    }
  }
  return seeds;
}

/** The seeded keys no file in the reader index mentions. Pure, so it is testable. */
export function deadKeys(
  elements: Record<string, SeedingElement>,
  readers: ReadonlySet<string>,
): DeadKeyEntry[] {
  return [...seededKeys(elements)]
    .filter(([key]) => !readers.has(key))
    .map(([key, e]) => ({
      key,
      namespaces: [...e.namespaces].sort(),
      seededBy: [...e.seededBy].sort(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Run the whole scan against a platform checkout. */
export function scanDeadKeys(repo: string, elements: Record<string, SeedingElement>): DeadKeyScan {
  const { readers, files } = buildReaderIndex(repo);
  return {
    files,
    identifiers: readers.size,
    seededKeys: seededKeys(elements).size,
    dead: deadKeys(elements, readers),
  };
}

/** The generated module, built here so codegen and its tests emit one thing. */
export function deadKeysModule(scan: DeadKeyScan): string {
  const table: Record<string, DeadKeyEntry> = {};
  for (const d of scan.dead) table[d.key] = d;
  return `// GENERATED by scripts/gen-catalog.ts — do not edit by hand.
// Source: every identifier in <WB_REPO>/{${READER_ROOTS.join(',')}}, excluding each
// element's own meta.ts (a seed is not a reader). See scripts/deadkey-scan.ts.
import type { DeadKey } from './element-types.js';

export const DEAD_KEY_SOURCE = ${JSON.stringify(
    {
      files: scan.files,
      identifiers: scan.identifiers,
      seededKeys: scan.seededKeys,
      dead: scan.dead.length,
    },
    null,
    2,
  )} as const;

/**
 * Keys an element SEEDS and no renderer anywhere reads.
 *
 * Keyed by the key NAME, not by \`namespace.key\`: the index is a flat set of
 * identifiers, so it cannot tell one namespace from the other and a key read
 * anywhere is read in both.
 *
 * A write to one of these stores, saves, publishes and renders exactly as
 * before. \`sb_set\` says so at the moment of the write; nothing refuses it,
 * because the platform accepts the value and a refusal here would invent a rule
 * it does not have.
 */
export const DEAD_KEYS: Record<string, DeadKey> = ${JSON.stringify(table, null, 2)};
`;
}

/**
 * Warn — never fail — naming the seed site and the two upstream fixes.
 *
 * The caller cannot close this from here: regenerating the catalog reproduces
 * the same table, because the table is an honest reading of the platform.
 */
export function reportDeadKeys(scan: DeadKeyScan): void {
  if (scan.dead.length === 0) return;

  console.error(
    `warning: ${scan.dead.length} seeded key(s) are read by NOTHING in the platform — not Go, ` +
      'not the editor, not the runtime. An agent reads one off the node, writes a different ' +
      'value, and it stores, saves, publishes and renders exactly as before, with no error at ' +
      `any step (${scan.seededKeys} seeded keys tested against ${scan.identifiers} identifiers ` +
      `in ${scan.files} files):`,
  );
  for (const d of scan.dead.slice(0, 12)) {
    console.error(
      `  ${d.namespaces.join('|')}.${d.key} — seeded by ${d.seededBy.join(', ')} ` +
        `(schema/src/elements/${d.seededBy[0]}/meta.ts)`,
    );
  }
  if (scan.dead.length > 12) console.error(`  …and ${scan.dead.length - 12} more`);
  console.error(
    'This is not fixable by regenerating — the table is an honest reading of the platform. ' +
      'Fix it UPSTREAM: either wire the key up in the renderer that should read it, or drop ' +
      'the seed from that element\'s meta.ts so nothing offers a control that does nothing. ' +
      'An identifier index cannot see a key assembled at runtime, so this is a floor, not a ' +
      'proof — see scripts/deadkey-scan.ts.',
  );
}
