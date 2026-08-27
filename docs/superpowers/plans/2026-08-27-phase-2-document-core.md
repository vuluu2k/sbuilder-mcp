# `@sbuilder/mcp` Phase 2 — The Page Document

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent build pages — hold a page's node document, mutate it through the editor's own patch protocol, and save it — with the platform's four silent-failure traps encoded as code rather than advice.

**Architecture:** A second codegen output turns the platform's 85 element metas plus their AI hints into a typed catalog. A domain-agnostic `core/` holds the patch primitive and tree walking; `domains/site/` holds the document, the builder that compiles design intent into admissible patches, the traps, and validation. Eleven Tier-1 tools sit on top.

**Tech Stack:** As Phase 1 — TypeScript ESM/Node16, `@modelcontextprotocol/sdk` ^1.30, `zod` ^3, `vitest` ^3.2, `tsx` for build scripts.

**Spec:** `docs/superpowers/specs/2026-08-27-sbuilder-mcp-design.md`

## What Phase 1 established

`src/transport/{http,auth,credential}.ts`, `src/catalog/{types,search,api.generated}.ts`,
`src/tools/{context,api,session}.ts`, `src/mcp/response.ts`. The gate is
`npm run build && npm test && npm run smoke`, and smoke must end `ALL GOOD`.

## Global Constraints

Every Phase 1 constraint still holds — see that plan's Global Constraints, and `CLAUDE.md`.
The ones this phase adds:

- **The document is the platform's, not ours.** `PageDocument` is
  `{ schema_version, root_node_id, nodes: Record<string, BuilderNode> }`. Never invent a
  field; never reorder keys gratuitously — `DecomposeOverlays` has a byte-for-byte fast path
  that a needless re-marshal would defeat.
- **Only admissible patches go out.** `isSyncablePatch` is a security boundary, not a lint.
- **`sb_set` writes per-breakpoint by default.** Base-only writes require an explicit flag.
- **No tool dumps a document.** `sb_outline` returns a compressed tree.
- **The four traps are code with tests**, in `domains/site/traps.ts`. A trap encoded as a
  README sentence is an unproven guard, which this platform treats as an absent one.

## The four traps — measured facts

Each was read out of the platform's own source. Do not re-derive, do not "simplify".

1. **Overlays** (`server/internal/page/overlay.go`). A site overlay — the cart drawer, a
   pop-up — is composed onto ROOT **on read** and stripped **on write**. Its subtree root is
   a direct child of ROOT carrying `specials.overlayId` (plus `overlayKind`, `overlayRev`).
   Only a direct child of ROOT may be one. Any walk over ROOT's children must exclude them.
2. **Global sections** (`server/internal/page/compose.go`, `decompose.go`). Stamped with
   `specials.globalId` / `globalKind` / `globalRev`; a page stores a reference node
   (`specials.globalRef`). They are shared masters — editing one changes every page carrying
   it, and publish cascades to those pages.
3. **Band order** (`checkBands`, `server/internal/page/decompose.go`). ROOT's children must
   read `[header*][middle*][footer*]`. The band comes from `specials.globalKind` on a
   stamped child; an unstamped child is middle. Violating it fails **every save** with
   `ErrBandOrder`. Overlays are stripped before this check runs, which is why they need no
   exception — and why our own check must strip them too.
4. **The responsive mandate** (`web_builder/CLAUDE.md`). If a key *can* be responsive it
   *must* be. A visual quantity written base-only renders on the canvas and **vanishes on
   publish**. Style and config live per breakpoint in `responsive[bp]`; only identity and
   content (`specials`, `htmlTag`, `kind`) belong at base.

---

### Task 1: Generate the element catalog

**Files:**
- Modify: `scripts/gen-catalog.ts`
- Create: `src/catalog/element-types.ts`
- Create (generated, committed): `src/catalog/elements.generated.ts`
- Test: `test/element-catalog.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `interface CatalogElement { type: string; label: string; category: string; isContainer: boolean; isRootOnly: boolean; locked: boolean; hideInLayer: boolean; childAllows: string[]; defaults: { style?: Record<string, unknown>; config?: Record<string, unknown>; specials?: Record<string, unknown>; responsive?: Record<string, unknown> }; traits: string[]; description: string; useWhen: string[]; avoidWhen: string[]; contentTips: string[]; semantics: string[] }`; `const ELEMENTS: Record<string, CatalogElement>`; `const ELEMENT_SOURCE: { count: number; docSchemaVersion: number }`.

`tsx` imports the platform's `schema/src/elements/registry.ts` directly, extensionless
imports and all — verified before this plan was written. `allElementTypes()` returns **85**
types and `getElementAI` covers **85/85**, so the generator asserts both.

`DOC_SCHEMA_VERSION` is **2**, and it lives in `editor/src/theme/legacyScopes.ts`, not in
the schema package. The generator reads it with a regex over that one file rather than
importing it — importing an editor module would drag Vue into a build script for a single
integer.

- [x] **Step 1: Write `src/catalog/element-types.ts`**

```ts
export interface CatalogElement {
  type: string;
  label: string;
  category: string;
  isContainer: boolean;
  isRootOnly: boolean;
  locked: boolean;
  hideInLayer: boolean;
  /** Parent→child containment whitelist. Empty means unrestricted. */
  childAllows: string[];
  defaults: {
    style?: Record<string, unknown>;
    config?: Record<string, unknown>;
    specials?: Record<string, unknown>;
    responsive?: Record<string, unknown>;
  };
  /** Flattened trait keys, whichever shape the platform declared them in. */
  traits: string[];
  description: string;
  useWhen: string[];
  avoidWhen: string[];
  contentTips: string[];
  semantics: string[];
}
```

- [x] **Step 2: Write the failing test**

```ts
// test/element-catalog.test.ts
import { describe, it, expect } from 'vitest';
import { ELEMENTS, ELEMENT_SOURCE } from '../src/catalog/elements.generated.js';

describe('generated element catalog', () => {
  it('carries every registered element', () => {
    expect(Object.keys(ELEMENTS).length).toBe(ELEMENT_SOURCE.count);
    expect(Object.keys(ELEMENTS).length).toBeGreaterThan(80);
  });

  it('records the document schema version the platform writes', () => {
    expect(ELEMENT_SOURCE.docSchemaVersion).toBe(2);
  });

  it('gives every element its AI hints — the reason this catalog exists', () => {
    for (const el of Object.values(ELEMENTS)) {
      expect(el.description.length).toBeGreaterThan(0);
    }
  });

  it('knows flex-section is a root-only container', () => {
    const fs = ELEMENTS['flex-section'];
    expect(fs.isContainer).toBe(true);
    expect(fs.isRootOnly).toBe(true);
    expect(fs.category).toBe('layout');
  });

  it('flattens traits to a string list whichever shape the platform used', () => {
    for (const el of Object.values(ELEMENTS)) {
      expect(Array.isArray(el.traits)).toBe(true);
      expect(el.traits.every((t) => typeof t === 'string')).toBe(true);
    }
  });

  it('has at least one element declaring a containment whitelist', () => {
    expect(Object.values(ELEMENTS).some((e) => e.childAllows.length > 0)).toBe(true);
  });
});
```

- [x] **Step 3: Run it and watch it fail**

Run: `npx vitest run test/element-catalog.test.ts`
Expected: FAIL — `Cannot find module '../src/catalog/elements.generated.js'`.

- [x] **Step 4: Extend `scripts/gen-catalog.ts`**

Add above `main()`:

```ts
/**
 * Flatten the platform's two accepted trait shapes into one key list.
 *
 * `meta.traits` is either a legacy flat `string[]` or a structured
 * `{ general, advanced }` of tabs → groups → ordered widget attributes. The
 * agent only ever needs "which keys does this element accept", so both collapse
 * to the same list here rather than every consumer learning both shapes.
 */
function flattenTraits(traits: unknown): string[] {
  if (Array.isArray(traits)) return traits.filter((t): t is string => typeof t === 'string');
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      out.add(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      // A widget entry names its key in `attr` (or `key`); a group names its
      // members in `items`/`widgets`. Anything else is layout metadata.
      if (typeof o.attr === 'string') out.add(o.attr);
      else if (typeof o.key === 'string') out.add(o.key);
      for (const k of ['items', 'widgets', 'groups', 'general', 'advanced']) {
        if (k in o) walk(o[k]);
      }
    }
  };
  walk(traits);
  return [...out];
}

function readDocSchemaVersion(repo: string): number {
  const src = readFileSync(resolve(repo, 'editor/src/theme/legacyScopes.ts'), 'utf8');
  const m = /export const DOC_SCHEMA_VERSION\s*=\s*(\d+)/.exec(src);
  if (!m) {
    console.error('DOC_SCHEMA_VERSION not found in editor/src/theme/legacyScopes.ts');
    process.exit(1);
  }
  return Number(m[1]);
}
```

Add to the top of the file:

```ts
import { ELEMENTS as PLATFORM_ELEMENTS, allElementTypes } from '../../web_builder/schema/src/elements/registry.js';
```

That relative import is wrong for a configurable `WB_REPO`, so use a dynamic import inside
`main()` instead:

```ts
  const registry = (await import(
    resolve(repo, 'schema/src/elements/registry.ts')
  )) as {
    ELEMENTS: Record<string, Record<string, unknown>>;
    allElementTypes: () => string[];
  };
  const aiMod = (await import(resolve(repo, 'schema/src/elements/ai.ts'))) as {
    getElementAI: (type: string) => Record<string, unknown> | undefined;
  };

  const types = registry.allElementTypes();
  const elements: Record<string, CatalogElement> = {};
  for (const type of types) {
    const m = registry.ELEMENTS[type] as {
      label?: string;
      category?: string;
      isContainer?: boolean;
      rules?: Record<string, unknown>;
      defaults?: Record<string, unknown>;
      traits?: unknown;
    };
    const a = (aiMod.getElementAI(type) ?? {}) as {
      description?: string;
      hints?: { useWhen?: string[]; avoidWhen?: string[]; contentTips?: string[] };
      semantics?: string[];
    };
    if (!a.description) {
      console.error(`element "${type}" has no AI description — the catalog exists for these`);
      process.exit(1);
    }
    elements[type] = {
      type,
      label: m.label ?? type,
      category: m.category ?? 'other',
      isContainer: m.isContainer === true,
      isRootOnly: m.rules?.isRootOnly === true,
      locked: m.rules?.locked === true,
      hideInLayer: m.rules?.hideInLayer === true,
      childAllows: (m.rules?.nodeChildAllows as string[]) ?? [],
      defaults: (m.defaults ?? {}) as CatalogElement['defaults'],
      traits: flattenTraits(m.traits),
      description: a.description,
      useWhen: a.hints?.useWhen ?? [],
      avoidWhen: a.hints?.avoidWhen ?? [],
      contentTips: a.hints?.contentTips ?? [],
      semantics: a.semantics ?? [],
    };
  }
  if (types.length < 80) {
    console.error(`only ${types.length} elements — is WB_REPO stale?`);
    process.exit(1);
  }
```

`main()` becomes `async`, and the file ends `main();` → `await main();` (top-level await is
fine: the script runs under `tsx` as ESM).

Write the second output alongside the first:

```ts
  const elementsOut = `// GENERATED by scripts/gen-catalog.ts — do not edit by hand.
// Source: <WB_REPO>/schema/src/elements/** and editor/src/theme/legacyScopes.ts
import type { CatalogElement } from './element-types.js';

export const ELEMENT_SOURCE = ${JSON.stringify(
    { count: types.length, docSchemaVersion: readDocSchemaVersion(repo) },
    null,
    2,
  )} as const;

export const ELEMENTS: Record<string, CatalogElement> = ${JSON.stringify(elements, null, 2)};
`;
  writeFileSync(resolve(process.cwd(), 'src/catalog/elements.generated.ts'), elementsOut, 'utf8');
  console.error(`wrote elements.generated.ts: ${types.length} elements, doc schema v${readDocSchemaVersion(repo)}`);
```

- [x] **Step 5: Run the generator**

Run: `WB_REPO=/Volumes/workspace/webcake/web_builder npm run codegen`
Expected: stderr reports `310 operations…` as before **and** `85 elements, doc schema v2`.

- [x] **Step 6: Run the test**

Run: `npx vitest run test/element-catalog.test.ts`
Expected: PASS, 6 tests.

- [x] **Step 7: Commit**

```bash
git add scripts/gen-catalog.ts src/catalog/element-types.ts src/catalog/elements.generated.ts test/element-catalog.test.ts
git commit -m "feat(catalog): generate the 85-element catalog with its AI hints"
```

---

### Task 2: The patch primitive and its admission rules

**Files:**
- Create: `src/core/patch.ts`
- Test: `test/patch.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Path = (string | number)[]`; `type Patch = {op:'set';path:Path;value:unknown} | {op:'unset';path:Path} | {op:'insert';path:Path;index:number;value:unknown} | {op:'remove';path:Path;index:number}`; `isSyncablePath(path: Path): boolean`; `isSyncablePatch(p: Patch): boolean`; `applyPatches(state: object, patches: Patch[]): void`; `invert(state: object, patches: Patch[]): Patch[]`.

The three admission rules are a **security boundary** mirrored from
`editor/src/features/liveedit/ops.ts`. Each closes a real door.

- [x] **Step 1: Write the failing test**

```ts
// test/patch.test.ts
import { describe, it, expect } from 'vitest';
import { isSyncablePath, isSyncablePatch, applyPatches } from '../src/core/patch.js';

describe('isSyncablePath()', () => {
  it('accepts a real node path', () => {
    expect(isSyncablePath(['nodes', 'fs_1', 'style', 'gap'])).toBe(true);
  });

  it('rejects the bare nodes path — one frame would replace the whole document', () => {
    expect(isSyncablePath(['nodes'])).toBe(false);
  });

  it('rejects anything not rooted at nodes', () => {
    expect(isSyncablePath(['selectedId'])).toBe(false);
    expect(isSyncablePath(['root_node_id'])).toBe(false);
  });

  it('rejects prototype-polluting segments', () => {
    expect(isSyncablePath(['nodes', '__proto__'])).toBe(false);
    expect(isSyncablePath(['nodes', 'fs_1', 'constructor'])).toBe(false);
    expect(isSyncablePath(['nodes', 'fs_1', 'prototype'])).toBe(false);
  });

  it('rejects a segment that only STRINGIFIES to __proto__', () => {
    // A one-element array stringifies to its single element, and lodash's toKey
    // coerces the same way — so a typeof check would let this through.
    expect(isSyncablePath(['nodes', ['__proto__'] as unknown as string])).toBe(false);
  });
});

describe('isSyncablePatch()', () => {
  it('accepts a set on a good path', () => {
    expect(isSyncablePatch({ op: 'set', path: ['nodes', 'a', 'style'], value: 1 })).toBe(true);
  });

  it('rejects a negative splice index — it addresses from the END', () => {
    expect(
      isSyncablePatch({ op: 'remove', path: ['nodes', 'a', 'data', 'nodes'], index: -1 }),
    ).toBe(false);
  });

  it('rejects a fractional splice index — splice would truncate it', () => {
    expect(
      isSyncablePatch({ op: 'insert', path: ['nodes', 'a', 'data', 'nodes'], index: 1.5, value: 'x' }),
    ).toBe(false);
  });

  it('allows an index past the end — splice clamps, and an append is legitimate', () => {
    expect(
      isSyncablePatch({ op: 'insert', path: ['nodes', 'a', 'data', 'nodes'], index: 99, value: 'x' }),
    ).toBe(true);
  });
});

describe('applyPatches()', () => {
  it('sets a nested value, creating intermediate objects', () => {
    const s: Record<string, unknown> = { nodes: { a: {} } };
    applyPatches(s, [{ op: 'set', path: ['nodes', 'a', 'style', 'gap'], value: '8px' }]);
    expect(s).toEqual({ nodes: { a: { style: { gap: '8px' } } } });
  });

  it('unsets', () => {
    const s = { nodes: { a: { style: { gap: '8px' } } } };
    applyPatches(s, [{ op: 'unset', path: ['nodes', 'a', 'style', 'gap'] }]);
    expect(s.nodes.a.style).toEqual({});
  });

  it('inserts and removes in an array', () => {
    const s = { nodes: { a: { data: { nodes: ['x', 'z'] } } } };
    applyPatches(s, [{ op: 'insert', path: ['nodes', 'a', 'data', 'nodes'], index: 1, value: 'y' }]);
    expect(s.nodes.a.data.nodes).toEqual(['x', 'y', 'z']);
    applyPatches(s, [{ op: 'remove', path: ['nodes', 'a', 'data', 'nodes'], index: 0 }]);
    expect(s.nodes.a.data.nodes).toEqual(['y', 'z']);
  });

  it('refuses to apply an inadmissible patch rather than applying it quietly', () => {
    const s = { nodes: {} };
    expect(() => applyPatches(s, [{ op: 'set', path: ['nodes'], value: {} }])).toThrow(
      /inadmissible/i,
    );
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/patch.test.ts`
Expected: FAIL — `Cannot find module '../src/core/patch.js'`.

- [x] **Step 3: Write `src/core/patch.ts`**

```ts
/**
 * The document patch primitive, mirrored from the editor's live-edit channel
 * (editor/src/history/patchRecorder.ts + features/liveedit/ops.ts).
 *
 * The shape has to match exactly: these patches go on the wire to peers running
 * the editor's own code, and a shape it does not recognise is dropped silently.
 */
export type Path = (string | number)[];

export type Patch =
  | { op: 'set'; path: Path; value: unknown }
  | { op: 'unset'; path: Path }
  | { op: 'insert'; path: Path; index: number; value: unknown }
  | { op: 'remove'; path: Path; index: number };

/** Segments that must never appear in a path we apply or send. */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Is this path part of the shared DOCUMENT?
 *
 * An allowlist, not a denylist, and three rules rather than one — each closing a
 * real door:
 *
 *  - `path.length < 2` also rejects the bare `['nodes']`. A write there does not
 *    touch one node, it REPLACES THE ENTIRE MAP. No legitimate edit produces it
 *    (every real one is `nodes.<id>.…`, at least three segments), so refusing it
 *    costs nothing and closes a one-frame whole-document takeover.
 *  - The path must start at `nodes`. Everything else in a store is per-viewer
 *    state or local bookkeeping.
 *  - Segments are compared AFTER stringifying. A segment shaped `['__proto__']`
 *    stringifies to `'__proto__'` — a one-element array becomes its single
 *    element — so a `typeof seg === 'string'` guard lets it through and it lands
 *    on Object.prototype anyway.
 */
export function isSyncablePath(path: Path): boolean {
  if (!Array.isArray(path) || path.length < 2 || path[0] !== 'nodes') return false;
  return path.every((seg) => !FORBIDDEN.has(`${seg}`));
}

/**
 * Is this whole patch admissible — path and, for a splice, its index?
 *
 * The index rule exists because a NEGATIVE index splices from the END: `remove`
 * at -1 deletes the last child of an array the sender never named, and `insert`
 * at -1 lands one slot in from the end of somebody else's parent. A fractional
 * index is the same class — splice truncates it, so the write addresses a
 * different element than the one described.
 *
 * An index PAST the end is deliberately allowed: splice clamps it, an append is
 * a legitimate thing to describe, and a remove past the end removes nothing.
 */
export function isSyncablePatch(p: Patch): boolean {
  if (!isSyncablePath(p.path)) return false;
  if (p.op !== 'insert' && p.op !== 'remove') return true;
  return Number.isInteger(p.index) && p.index >= 0;
}

/** Keep only the patches that belong on the wire. */
export function syncable(patches: Patch[]): Patch[] {
  return patches.filter(isSyncablePatch);
}

function parentOf(state: object, path: Path): { holder: Record<string, unknown>; key: string } {
  let cur = state as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const k = `${path[i]}`;
    if (FORBIDDEN.has(k)) throw new Error(`patch: inadmissible segment "${k}"`);
    const next = cur[k];
    if (next === undefined || next === null || typeof next !== 'object') {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  return { holder: cur, key: `${path[path.length - 1]}` };
}

/**
 * Apply patches left to right, in place.
 *
 * An inadmissible patch THROWS rather than being skipped. Skipping is what the
 * wire does — a peer must not be able to halt this process — but locally a patch
 * we built ourselves that fails admission is a bug in the builder, and a silent
 * skip would leave the document half-edited with nothing to say so.
 */
export function applyPatches(state: object, patches: Patch[]): void {
  for (const p of patches) {
    if (!isSyncablePatch(p)) {
      throw new Error(`patch: inadmissible patch ${JSON.stringify(p)}`);
    }
    const { holder, key } = parentOf(state, p.path);
    switch (p.op) {
      case 'set':
        holder[key] = p.value;
        break;
      case 'unset':
        delete holder[key];
        break;
      case 'insert': {
        const arr = holder[key];
        if (!Array.isArray(arr)) break;
        arr.splice(p.index, 0, p.value);
        break;
      }
      case 'remove': {
        const arr = holder[key];
        if (!Array.isArray(arr)) break;
        arr.splice(p.index, 1);
        break;
      }
    }
  }
}
```

- [x] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/patch.test.ts`
Expected: PASS, 13 tests.

- [x] **Step 5: Commit**

```bash
git add src/core/patch.ts test/patch.test.ts
git commit -m "feat(core): the document patch primitive and its three admission rules"
```

---

### Task 3: Tree walking, overlay-aware

**Files:**
- Create: `src/core/tree.ts`
- Test: `test/tree.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface NodeLike { id: string; data: { type: string; name?: string; parent: string | null; nodes: string[] }; specials: Record<string, unknown> }`; `interface DocLike { schema_version: number; root_node_id: string; nodes: Record<string, NodeLike> }`; `childrenOf(doc, id): string[]`; `isOverlay(doc, id): boolean`; `pageChildren(doc): string[]`; `walk(doc, id, visit): void`; `subtreeIds(doc, id): string[]`; `ancestors(doc, id): string[]`.

`pageChildren` is the one every ROOT walk must use. It is separate from `childrenOf` so the
overlay rule cannot be forgotten by writing the obvious thing.

- [x] **Step 1: Write the failing test**

```ts
// test/tree.test.ts
import { describe, it, expect } from 'vitest';
import { childrenOf, isOverlay, pageChildren, subtreeIds, ancestors } from '../src/core/tree.js';
import type { DocLike } from '../src/core/tree.js';

function node(id: string, kids: string[] = [], specials: Record<string, unknown> = {}) {
  return { id, data: { type: 'flex-section', parent: null, nodes: kids }, specials };
}

const doc: DocLike = {
  schema_version: 2,
  root_node_id: 'rt',
  nodes: {
    rt: node('rt', ['fs_1', 'fs_2', 'cart']),
    fs_1: node('fs_1', ['tx_1']),
    fs_2: node('fs_2'),
    tx_1: node('tx_1'),
    cart: node('cart', ['tx_2'], { overlayId: 'ov_1', overlayKind: 'cart' }),
    tx_2: node('tx_2'),
  },
};

describe('tree', () => {
  it('childrenOf returns every child, overlays included', () => {
    expect(childrenOf(doc, 'rt')).toEqual(['fs_1', 'fs_2', 'cart']);
  });

  it('isOverlay is true only for a stamped DIRECT child of ROOT', () => {
    expect(isOverlay(doc, 'cart')).toBe(true);
    expect(isOverlay(doc, 'fs_1')).toBe(false);
    // A stamp deeper in the tree is not an overlay — only ROOT's own children
    // may be, which is what keeps overlays out of repeater rows and globals.
    const nested: DocLike = {
      ...doc,
      nodes: { ...doc.nodes, tx_1: node('tx_1', [], { overlayId: 'ov_2' }) },
    };
    expect(isOverlay(nested, 'tx_1')).toBe(false);
  });

  it('pageChildren excludes overlays — this is the walk every ROOT rule must use', () => {
    expect(pageChildren(doc)).toEqual(['fs_1', 'fs_2']);
  });

  it('subtreeIds collects a node and its descendants', () => {
    expect(subtreeIds(doc, 'fs_1').sort()).toEqual(['fs_1', 'tx_1']);
  });

  it('subtreeIds survives a malformed cycle rather than hanging', () => {
    const cyc: DocLike = {
      schema_version: 2,
      root_node_id: 'a',
      nodes: {
        a: node('a', ['b']),
        b: node('b', ['a']),
      },
    };
    expect(subtreeIds(cyc, 'a').sort()).toEqual(['a', 'b']);
  });

  it('ancestors walks up to ROOT', () => {
    const d: DocLike = {
      schema_version: 2,
      root_node_id: 'rt',
      nodes: {
        rt: { id: 'rt', data: { type: 'root', parent: null, nodes: ['fs_1'] }, specials: {} },
        fs_1: { id: 'fs_1', data: { type: 'flex-section', parent: 'rt', nodes: ['tx_1'] }, specials: {} },
        tx_1: { id: 'tx_1', data: { type: 'text', parent: 'fs_1', nodes: [] }, specials: {} },
      },
    };
    expect(ancestors(d, 'tx_1')).toEqual(['fs_1', 'rt']);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/tree.test.ts`
Expected: FAIL — `Cannot find module '../src/core/tree.js'`.

- [x] **Step 3: Write `src/core/tree.ts`**

```ts
export interface NodeLike {
  id: string;
  data: { type: string; name?: string; parent: string | null; nodes: string[] };
  specials: Record<string, unknown>;
}

export interface DocLike {
  schema_version: number;
  root_node_id: string;
  nodes: Record<string, NodeLike>;
}

/** The specials stamp a composed site overlay carries. */
export const SPEC_OVERLAY_ID = 'overlayId';
/** The specials stamps a composed global section carries. */
export const SPEC_GLOBAL_ID = 'globalId';
export const SPEC_GLOBAL_KIND = 'globalKind';
export const SPEC_GLOBAL_REF = 'globalRef';

export function childrenOf(doc: DocLike, id: string): string[] {
  return doc.nodes[id]?.data.nodes ?? [];
}

/**
 * Is this node a composed SITE OVERLAY — the cart drawer, a pop-up?
 *
 * Two conditions, and the second is load-bearing: the node must carry the
 * `overlayId` stamp AND be a DIRECT child of ROOT. The platform enforces exactly
 * that on write, and it is what keeps overlays out of repeater rows, out of
 * global sections, and out of each other. A stamp found deeper in the tree would
 * otherwise be stored inside whatever contains it.
 */
export function isOverlay(doc: DocLike, id: string): boolean {
  const n = doc.nodes[id];
  if (!n || n.specials?.[SPEC_OVERLAY_ID] === undefined) return false;
  return childrenOf(doc, doc.root_node_id).includes(id);
}

/**
 * ROOT's children WITHOUT the overlays — the walk every ROOT-level rule must use.
 *
 * A separate function from `childrenOf` on purpose. An overlay is composed onto
 * ROOT on read and stripped on write, so it is not part of the page document at
 * all; the band rule, drag clamping and the save check all have to skip it. A
 * caller who writes the obvious `childrenOf(doc, doc.root_node_id)` gets that
 * wrong silently, so the correct walk is the one with the shorter name.
 */
export function pageChildren(doc: DocLike): string[] {
  return childrenOf(doc, doc.root_node_id).filter((id) => !isOverlay(doc, id));
}

/** Depth-first walk. Cycle-safe: a malformed document must not hang a save. */
export function walk(doc: DocLike, id: string, visit: (n: NodeLike) => void): void {
  const seen = new Set<string>();
  const go = (cur: string): void => {
    if (seen.has(cur)) return;
    seen.add(cur);
    const n = doc.nodes[cur];
    if (!n) return;
    visit(n);
    for (const k of n.data.nodes) go(k);
  };
  go(id);
}

export function subtreeIds(doc: DocLike, id: string): string[] {
  const out: string[] = [];
  walk(doc, id, (n) => out.push(n.id));
  return out;
}

/** Ids from this node's parent up to ROOT. Cycle-safe. */
export function ancestors(doc: DocLike, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = doc.nodes[id]?.data.parent ?? null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = doc.nodes[cur]?.data.parent ?? null;
  }
  return out;
}
```

- [x] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/tree.test.ts`
Expected: PASS, 6 tests.

- [x] **Step 5: Commit**

```bash
git add src/core/tree.ts test/tree.test.ts
git commit -m "feat(core): overlay-aware tree walking, with pageChildren as the safe default"
```

---

### Task 4: The four traps

**Files:**
- Create: `src/domains/site/traps.ts`
- Test: `test/traps.test.ts`

**Interfaces:**
- Consumes: `DocLike`, `pageChildren`, `isOverlay`, `SPEC_GLOBAL_ID`, `SPEC_GLOBAL_KIND` from `src/core/tree.js`.
- Produces: `type Band = 'header' | 'middle' | 'footer'`; `bandOf(doc, id): Band`; `checkBandOrder(doc): string | null`; `isGlobal(doc, id): boolean`; `globalWarning(doc, id): string | null`; `RESPONSIVE_NOTICE: string`; `isIdentityKey(key: string): boolean`.

- [x] **Step 1: Write the failing test**

```ts
// test/traps.test.ts
import { describe, it, expect } from 'vitest';
import { bandOf, checkBandOrder, isGlobal, globalWarning, isIdentityKey } from '../src/domains/site/traps.js';
import type { DocLike } from '../src/core/tree.js';

function n(id: string, kids: string[] = [], specials: Record<string, unknown> = {}) {
  return { id, data: { type: 'flex-section', parent: null, nodes: kids }, specials };
}

function docWith(rootKids: string[], nodes: Record<string, ReturnType<typeof n>>): DocLike {
  return { schema_version: 2, root_node_id: 'rt', nodes: { rt: n('rt', rootKids), ...nodes } };
}

describe('bandOf()', () => {
  it('puts an unstamped section in the middle', () => {
    const d = docWith(['a'], { a: n('a') });
    expect(bandOf(d, 'a')).toBe('middle');
  });

  it('reads the band off a global stamp', () => {
    const d = docWith(['h', 'f'], {
      h: n('h', [], { globalId: 'g1', globalKind: 'header' }),
      f: n('f', [], { globalId: 'g2', globalKind: 'footer' }),
    });
    expect(bandOf(d, 'h')).toBe('header');
    expect(bandOf(d, 'f')).toBe('footer');
  });

  it('treats an unknown global kind as middle rather than throwing', () => {
    const d = docWith(['x'], { x: n('x', [], { globalId: 'g', globalKind: 'nonsense' }) });
    expect(bandOf(d, 'x')).toBe('middle');
  });
});

describe('checkBandOrder()', () => {
  it('accepts header, middle, footer', () => {
    const d = docWith(['h', 'm', 'f'], {
      h: n('h', [], { globalId: 'g1', globalKind: 'header' }),
      m: n('m'),
      f: n('f', [], { globalId: 'g2', globalKind: 'footer' }),
    });
    expect(checkBandOrder(d)).toBeNull();
  });

  it('rejects a section above the header — that header is no longer a header', () => {
    const d = docWith(['m', 'h'], {
      m: n('m'),
      h: n('h', [], { globalId: 'g1', globalKind: 'header' }),
    });
    expect(checkBandOrder(d)).toMatch(/header/i);
  });

  it('rejects a section below the footer', () => {
    const d = docWith(['f', 'm'], {
      f: n('f', [], { globalId: 'g2', globalKind: 'footer' }),
      m: n('m'),
    });
    expect(checkBandOrder(d)).toMatch(/footer/i);
  });

  it('ignores overlays — the platform strips them before it checks', () => {
    const d = docWith(['h', 'm', 'f', 'cart'], {
      h: n('h', [], { globalId: 'g1', globalKind: 'header' }),
      m: n('m'),
      f: n('f', [], { globalId: 'g2', globalKind: 'footer' }),
      cart: n('cart', [], { overlayId: 'ov_1' }),
    });
    expect(checkBandOrder(d)).toBeNull();
  });
});

describe('isGlobal() / globalWarning()', () => {
  it('detects a stamped master and warns that edits cascade', () => {
    const d = docWith(['h'], { h: n('h', [], { globalId: 'g1', globalKind: 'header' }) });
    expect(isGlobal(d, 'h')).toBe(true);
    expect(globalWarning(d, 'h')).toMatch(/every page/i);
  });

  it('says nothing about an ordinary section', () => {
    const d = docWith(['a'], { a: n('a') });
    expect(isGlobal(d, 'a')).toBe(false);
    expect(globalWarning(d, 'a')).toBeNull();
  });
});

describe('isIdentityKey()', () => {
  it('names the keys that legitimately live at base', () => {
    expect(isIdentityKey('htmlTag')).toBe(true);
    expect(isIdentityKey('kind')).toBe(true);
  });

  it('refuses a visual quantity', () => {
    expect(isIdentityKey('gap')).toBe(false);
    expect(isIdentityKey('width')).toBe(false);
    expect(isIdentityKey('backgroundColor')).toBe(false);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/traps.test.ts`
Expected: FAIL — `Cannot find module '../src/domains/site/traps.js'`.

- [x] **Step 3: Write `src/domains/site/traps.ts`**

```ts
import {
  pageChildren,
  isOverlay,
  SPEC_GLOBAL_ID,
  SPEC_GLOBAL_KIND,
  type DocLike,
} from '../../core/tree.js';

export type Band = 'header' | 'middle' | 'footer';

/**
 * Which band a direct child of ROOT belongs to.
 *
 * An unstamped section lives in the middle; a global's band comes from its
 * `globalKind`. An UNRECOGNISED kind is middle rather than an error, matching
 * the platform's own `bandOf` — a document that stores a kind we do not know is
 * still a document that must open.
 */
export function bandOf(doc: DocLike, id: string): Band {
  const n = doc.nodes[id];
  if (!n || n.specials?.[SPEC_GLOBAL_ID] === undefined) return 'middle';
  const kind = `${n.specials[SPEC_GLOBAL_KIND] ?? ''}`;
  if (kind === 'header' || kind === 'footer') return kind;
  return 'middle';
}

/**
 * THE BAND RULE: ROOT's children must read [header*][middle*][footer*].
 *
 * The platform enforces this on EVERY save (`checkBands`), so a document that
 * breaks it cannot be stored at all — the author gets `ErrBandOrder` and loses
 * the write. Checking it here means the builder refuses to construct the
 * violation rather than discovering it one autosave later.
 *
 * Ordinary sections are constrained too, not just globals: once a page has a
 * global header, nothing may sit above it, or the "header" stops being one.
 *
 * Overlays are excluded, because the platform strips them BEFORE it checks —
 * that ordering is why the band rule needs no overlay exception, and copying the
 * ordering is why ours needs none either.
 *
 * Returns null when the order is legal, or a sentence naming the offender.
 */
export function checkBandOrder(doc: DocLike): string | null {
  let phase: Band = 'header';
  for (const id of pageChildren(doc)) {
    const band = bandOf(doc, id);
    if (band === 'header') {
      if (phase !== 'header') {
        return `Node ${id} is a global header but sits after ${phase} content. ROOT's children must read header, then middle, then footer — the platform refuses every save otherwise.`;
      }
    } else if (band === 'footer') {
      phase = 'footer';
    } else {
      if (phase === 'footer') {
        return `Node ${id} is ordinary content but sits after a global footer. ROOT's children must read header, then middle, then footer — the platform refuses every save otherwise.`;
      }
      phase = 'middle';
    }
  }
  return null;
}

/** Is this node a composed GLOBAL SECTION master — a shared header or footer? */
export function isGlobal(doc: DocLike, id: string): boolean {
  return doc.nodes[id]?.specials?.[SPEC_GLOBAL_ID] !== undefined;
}

/**
 * The sentence to attach to any result that touched a global.
 *
 * Editing a master is not a page-local act: it changes every page carrying that
 * section, and publishing one cascades to those pages — a header edited once
 * must not go live on one page and stay stale on the rest. An agent that does
 * not know this will report "updated the header" having changed the whole site.
 */
export function globalWarning(doc: DocLike, id: string): string | null {
  if (!isGlobal(doc, id)) return null;
  const gid = doc.nodes[id].specials[SPEC_GLOBAL_ID];
  return `Node ${id} is the shared global section ${JSON.stringify(gid)}. Editing it changes EVERY page that carries it, and publishing cascades to all of them. Say so when reporting this change.`;
}

/**
 * Keys that legitimately live at base rather than per breakpoint.
 *
 * The platform's rule is: if a key CAN be responsive it MUST be. A visual
 * quantity written base-only renders correctly on the canvas and then VANISHES
 * on publish, because the published cascade has no base layer to fall back to.
 * Only identity and content are exempt — everything else is a quantity.
 */
const IDENTITY_KEYS = new Set(['htmlTag', 'kind', 'name', 'id', 'type', 'href', 'src', 'alt']);

export function isIdentityKey(key: string): boolean {
  return IDENTITY_KEYS.has(key);
}

export const RESPONSIVE_NOTICE =
  'Written per breakpoint. A visual quantity written at base only renders on the canvas and ' +
  'then vanishes on publish — the published cascade has no base layer to fall back to. Pass ' +
  'base:true only for identity or content.';

export { isOverlay };
```

- [x] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/traps.test.ts`
Expected: PASS, 10 tests.

- [x] **Step 5: Commit**

```bash
git add src/domains/site/traps.ts test/traps.test.ts
git commit -m "feat(site): encode the four silent-failure traps as tested code"
```

---

### Task 5: Node ids and node construction

**Files:**
- Create: `src/domains/site/ids.ts`
- Create: `src/domains/site/node.ts`
- Test: `test/node.test.ts`

**Interfaces:**
- Consumes: `ELEMENTS` from `src/catalog/elements.generated.js`.
- Produces: `genId(type: string): string`; `createNode(type: string, opts?: { name?: string; parent?: string | null; specials?: Record<string, unknown>; style?: Record<string, unknown>; config?: Record<string, unknown> }): BuilderNode`; `interface BuilderNode`.

The id prefix table is mirrored from `schema/src/node.ts`. It is cosmetic — ids only need
to be unique — but matching it keeps a document the agent built indistinguishable from one a
human built, which is the whole point of this server.

- [x] **Step 1: Write the failing test**

```ts
// test/node.test.ts
import { describe, it, expect } from 'vitest';
import { genId } from '../src/domains/site/ids.js';
import { createNode } from '../src/domains/site/node.js';

describe('genId()', () => {
  it('uses the platform prefix for a known type', () => {
    expect(genId('flex-section')).toMatch(/^fs_[0-9a-f]{8}$/);
    expect(genId('heading')).toMatch(/^he_[0-9a-f]{8}$/);
    expect(genId('tab-item')).toMatch(/^ti_[0-9a-f]{8}$/);
  });

  it('falls back to the first two letters for an unlisted type', () => {
    expect(genId('carousel')).toMatch(/^ca_[0-9a-f]{8}$/);
  });

  it('is unique across many calls', () => {
    const ids = new Set(Array.from({ length: 500 }, () => genId('text')));
    expect(ids.size).toBe(500);
  });
});

describe('createNode()', () => {
  it('seeds an element from its catalog defaults', () => {
    const n = createNode('flex-section');
    expect(n.data.type).toBe('flex-section');
    expect(n.data.nodes).toEqual([]);
    expect(n.data.isCanvas).toBe(true); // a container is a canvas
    expect(n.events).toEqual([]);
    expect(n.bindings).toEqual([]);
  });

  it('omits the states key entirely when the element declares none', () => {
    const n = createNode('text');
    expect('states' in n).toBe(false);
  });

  it('refuses an unknown type rather than minting a node nothing can render', () => {
    expect(() => createNode('not-an-element')).toThrow(/unknown element/i);
  });

  it('carries the caller overrides on top of the defaults', () => {
    const n = createNode('heading', { name: 'Title', parent: 'rt' });
    expect(n.data.name).toBe('Title');
    expect(n.data.parent).toBe('rt');
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/node.test.ts`
Expected: FAIL — `Cannot find module '../src/domains/site/ids.js'`.

- [x] **Step 3: Write `src/domains/site/ids.ts`**

```ts
import { randomBytes } from 'node:crypto';

/**
 * Id prefixes, mirrored from schema/src/node.ts.
 *
 * Purely cosmetic — an id only has to be unique — but a document this server
 * builds should be indistinguishable from one a human built, and the prefix is
 * the first thing anyone reading a document sees. The tab family is listed
 * explicitly because the generic two-letter fallback collapses all three to 'ta'.
 */
const PREFIXES: Record<string, string> = {
  root: 'rt',
  'flex-section': 'fs',
  'flex-block': 'fb',
  heading: 'he',
  text: 'tx',
  button: 'bt',
  image: 'im',
  icon: 'ic',
  spacer: 'sp',
  tab: 'tb',
  'tab-content': 'tc',
  'tab-item': 'ti',
};

export function genId(type: string): string {
  const prefix = PREFIXES[type] ?? (type.replace(/[^a-z]/g, '').slice(0, 2) || 'nd');
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}
```

- [x] **Step 4: Write `src/domains/site/node.ts`**

```ts
import { ELEMENTS } from '../../catalog/elements.generated.js';
import { genId } from './ids.js';

export interface BuilderNode {
  id: string;
  data: {
    type: string;
    name?: string;
    parent: string | null;
    nodes: string[];
    isCanvas: boolean;
    hidden: boolean;
    custom: Record<string, unknown>;
  };
  style: Record<string, unknown>;
  config: Record<string, unknown>;
  specials: Record<string, unknown>;
  responsive: Record<string, { style?: Record<string, unknown>; config?: Record<string, unknown> }>;
  states?: Record<string, unknown>;
  events: unknown[];
  bindings: unknown[];
}

export interface CreateOpts {
  name?: string;
  parent?: string | null;
  style?: Record<string, unknown>;
  config?: Record<string, unknown>;
  specials?: Record<string, unknown>;
}

/**
 * Mint a node seeded from its element's catalog defaults.
 *
 * `states` is spread in ONLY when the element declares defaults for it. A node
 * that declares none must not carry the key at all: the platform's Go side marks
 * it `omitempty`, so an empty object here would change the stored bytes of every
 * document this server touches.
 */
export function createNode(type: string, opts: CreateOpts = {}): BuilderNode {
  const meta = ELEMENTS[type];
  if (!meta) {
    throw new Error(
      `sbuilder: unknown element "${type}". Use sb_catalog_search to find a real one — ` +
        'guessing a type produces a node nothing can render.',
    );
  }
  const d = meta.defaults;
  const states = (d as { states?: Record<string, unknown> }).states;
  return {
    id: genId(type),
    data: {
      type,
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      parent: opts.parent ?? null,
      nodes: [],
      isCanvas: meta.isContainer,
      hidden: false,
      custom: {},
    },
    style: { ...(d.style ?? {}), ...(opts.style ?? {}) },
    config: { ...(d.config ?? {}), ...(opts.config ?? {}) },
    specials: { ...(d.specials ?? {}), ...(opts.specials ?? {}) },
    responsive: JSON.parse(JSON.stringify(d.responsive ?? {})),
    ...(states ? { states: JSON.parse(JSON.stringify(states)) } : {}),
    events: [],
    bindings: [],
  };
}
```

- [x] **Step 5: Run the test and watch it pass**

Run: `npx vitest run test/node.test.ts`
Expected: PASS, 7 tests.

- [x] **Step 6: Commit**

```bash
git add src/domains/site/ids.ts src/domains/site/node.ts test/node.test.ts
git commit -m "feat(site): node ids and catalog-seeded node construction"
```

---

### Task 6: The document — load, mutate, describe

**Files:**
- Create: `src/domains/site/document.ts`
- Test: `test/document.test.ts`

**Interfaces:**
- Consumes: `Patch`, `applyPatches` from `src/core/patch.js`; `DocLike`, `pageChildren`, `isOverlay`, `subtreeIds` from `src/core/tree.js`; `isGlobal`, `bandOf` from `./traps.js`.
- Produces: `class PageDoc { static from(raw: unknown): PageDoc; readonly doc: DocLike; apply(patches: Patch[]): void; outline(opts?: { depth?: number }): OutlineNode[]; node(id: string): NodeLike; has(id: string): boolean; rev: number }`; `interface OutlineNode { id: string; type: string; name?: string; children: number; band?: Band; global?: boolean; overlay?: boolean; kids?: OutlineNode[] }`.

`outline()` is what keeps a page affordable to read. A real page is hundreds of KB of JSON;
this returns one short line per node.

- [x] **Step 1: Write the failing test**

```ts
// test/document.test.ts
import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';

const raw = {
  schema_version: 2,
  root_node_id: 'rt',
  nodes: {
    rt: { id: 'rt', data: { type: 'root', parent: null, nodes: ['h', 'fs_1', 'cart'], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
    h: { id: 'h', data: { type: 'flex-section', name: 'Header', parent: 'rt', nodes: [], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: { globalId: 'g1', globalKind: 'header' }, responsive: {}, events: [], bindings: [] },
    fs_1: { id: 'fs_1', data: { type: 'flex-section', parent: 'rt', nodes: ['tx_1'], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
    tx_1: { id: 'tx_1', data: { type: 'text', parent: 'fs_1', nodes: [], isCanvas: false, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
    cart: { id: 'cart', data: { type: 'flex-section', parent: 'rt', nodes: [], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: { overlayId: 'ov_1' }, responsive: {}, events: [], bindings: [] },
  },
};

describe('PageDoc', () => {
  it('loads a document and reports its root', () => {
    const d = PageDoc.from(raw);
    expect(d.doc.root_node_id).toBe('rt');
    expect(d.has('tx_1')).toBe(true);
  });

  it('refuses a document with no root node rather than healing it', () => {
    expect(() => PageDoc.from({ schema_version: 2, root_node_id: 'nope', nodes: {} })).toThrow(
      /root/i,
    );
  });

  it('applies a patch and bumps the revision', () => {
    const d = PageDoc.from(raw);
    const before = d.rev;
    d.apply([{ op: 'set', path: ['nodes', 'tx_1', 'specials', 'text'], value: 'Hi' }]);
    expect(d.node('tx_1').specials.text).toBe('Hi');
    expect(d.rev).toBe(before + 1);
  });

  it('does not mutate the object it was given', () => {
    const copy = JSON.parse(JSON.stringify(raw));
    const d = PageDoc.from(copy);
    d.apply([{ op: 'set', path: ['nodes', 'tx_1', 'specials', 'text'], value: 'Hi' }]);
    expect(copy.nodes.tx_1.specials).toEqual({});
  });

  it('outlines one short line per node, marking band, global and overlay', () => {
    const d = PageDoc.from(raw);
    const out = d.outline();
    expect(out).toEqual([
      { id: 'h', type: 'flex-section', name: 'Header', children: 0, band: 'header', global: true },
      { id: 'fs_1', type: 'flex-section', children: 1, band: 'middle' },
      { id: 'cart', type: 'flex-section', children: 0, overlay: true },
    ]);
  });

  it('nests to the requested depth', () => {
    const d = PageDoc.from(raw);
    const out = d.outline({ depth: 2 });
    const section = out.find((o) => o.id === 'fs_1')!;
    expect(section.kids).toEqual([{ id: 'tx_1', type: 'text', children: 0 }]);
  });

  it('names the missing node when asked for one that is not there', () => {
    const d = PageDoc.from(raw);
    expect(() => d.node('nope')).toThrow(/nope/);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/document.test.ts`
Expected: FAIL — `Cannot find module '../src/domains/site/document.js'`.

- [x] **Step 3: Write `src/domains/site/document.ts`**

```ts
import { applyPatches, type Patch } from '../../core/patch.js';
import { childrenOf, isOverlay, pageChildren, type DocLike, type NodeLike } from '../../core/tree.js';
import { bandOf, isGlobal, type Band } from './traps.js';

export interface OutlineNode {
  id: string;
  type: string;
  name?: string;
  children: number;
  band?: Band;
  global?: boolean;
  overlay?: boolean;
  kids?: OutlineNode[];
}

/**
 * One page's document, in memory.
 *
 * Owns a DEEP COPY of what it was handed. The caller's object is very often a
 * parsed HTTP response that something else still holds a reference to, and an
 * in-place mutation there is the kind of bug that only shows up as "the second
 * save wrote the first save's tree".
 */
export class PageDoc {
  private constructor(
    readonly doc: DocLike,
    private revision = 0,
  ) {}

  static from(raw: unknown): PageDoc {
    const d = JSON.parse(JSON.stringify(raw)) as DocLike;
    if (!d || typeof d !== 'object' || !d.nodes) {
      throw new Error('sbuilder: not a page document — expected { schema_version, root_node_id, nodes }');
    }
    if (!d.root_node_id || !d.nodes[d.root_node_id]) {
      // Deliberately NOT healed. The editor heals rootless documents on its own
      // hydrate path, and inventing a root here would fight that — two different
      // repairs racing to define the same tree.
      throw new Error(
        `sbuilder: document has no root node (root_node_id=${JSON.stringify(d.root_node_id)}). ` +
          'Open the page in the editor once; its hydrate path repairs this.',
      );
    }
    return new PageDoc(d);
  }

  get rev(): number {
    return this.revision;
  }

  has(id: string): boolean {
    return this.doc.nodes[id] !== undefined;
  }

  node(id: string): NodeLike {
    const n = this.doc.nodes[id];
    if (!n) throw new Error(`sbuilder: no node "${id}" in this page`);
    return n;
  }

  apply(patches: Patch[]): void {
    applyPatches(this.doc as unknown as object, patches);
    this.revision += 1;
  }

  /**
   * A compressed tree — id, type, name, child count, and the flags that change
   * what a caller may safely do with a node.
   *
   * Never the document itself. A real page is hundreds of KB of JSON, and a tool
   * that returns it burns the context the agent needs for the actual design work.
   * Depth 1 (the default) is ROOT's children; deeper levels nest under `kids`.
   */
  outline(opts: { depth?: number } = {}): OutlineNode[] {
    const depth = opts.depth ?? 1;
    const line = (id: string, level: number): OutlineNode => {
      const n = this.node(id);
      const kidIds = childrenOf(this.doc, id);
      const out: OutlineNode = { id, type: n.data.type, children: kidIds.length };
      if (n.data.name) out.name = n.data.name;
      if (level === 0) {
        if (isOverlay(this.doc, id)) out.overlay = true;
        else out.band = bandOf(this.doc, id);
      }
      if (isGlobal(this.doc, id)) out.global = true;
      if (level + 1 < depth && kidIds.length > 0) {
        out.kids = kidIds.map((k) => line(k, level + 1));
      }
      return out;
    };
    // ROOT's children INCLUDING overlays: the agent needs to see the cart drawer
    // exists. `pageChildren` is for the RULES; this is for the reader.
    const rootKids = childrenOf(this.doc, this.doc.root_node_id);
    void pageChildren;
    return rootKids.map((id) => line(id, 0));
  }
}
```

Note the `void pageChildren` line is a placeholder for an unused import — delete the import
instead if the implementation does not need it, rather than shipping the `void`.

- [x] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/document.test.ts`
Expected: PASS, 7 tests.

- [x] **Step 5: Commit**

```bash
git add src/domains/site/document.ts test/document.test.ts
git commit -m "feat(site): the in-memory page document with a compressed outline"
```

---

### Task 7: The builder — design intent to admissible patches

**Files:**
- Create: `src/domains/site/builder.ts`
- Test: `test/builder.test.ts`

**Interfaces:**
- Consumes: `PageDoc`; `createNode`; `Patch`; `checkBandOrder`, `isIdentityKey`; `ELEMENTS`.
- Produces: `addSubtree(doc: PageDoc, parentId: string, spec: NodeSpec, index?: number): { patches: Patch[]; ids: string[] }`; `setKeys(doc: PageDoc, id: string, keys: Record<string, unknown>, opts: { namespace: 'style'|'config'|'specials'; breakpoint?: Breakpoint; base?: boolean }): Patch[]`; `moveNode(doc, id, newParent, index): Patch[]`; `removeNode(doc, id): Patch[]`; `interface NodeSpec { type: string; name?: string; style?: Record<string, unknown>; config?: Record<string, unknown>; specials?: Record<string, unknown>; children?: NodeSpec[] }`; `type Breakpoint = 'desktop'|'laptop'|'tablet'|'mobile'`.

`addSubtree` takes a **nested** spec so a whole hero section is one call rather than forty.

- [x] **Step 1: Write the failing test**

```ts
// test/builder.test.ts
import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree, setKeys, moveNode, removeNode } from '../src/domains/site/builder.js';

function emptyDoc() {
  return PageDoc.from({
    schema_version: 2,
    root_node_id: 'rt',
    nodes: {
      rt: { id: 'rt', data: { type: 'root', parent: null, nodes: [], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
    },
  });
}

describe('addSubtree()', () => {
  it('adds one element and links it to its parent', () => {
    const d = emptyDoc();
    const { patches, ids } = addSubtree(d, 'rt', { type: 'flex-section' });
    d.apply(patches);
    expect(ids.length).toBe(1);
    expect(d.node('rt').data.nodes).toEqual(ids);
    expect(d.node(ids[0]).data.parent).toBe('rt');
  });

  it('adds a whole nested subtree in one call', () => {
    const d = emptyDoc();
    const { patches, ids } = addSubtree(d, 'rt', {
      type: 'flex-section',
      children: [{ type: 'heading' }, { type: 'text' }],
    });
    d.apply(patches);
    expect(ids.length).toBe(3);
    const section = d.node(ids[0]);
    expect(section.data.nodes.length).toBe(2);
    expect(d.node(section.data.nodes[0]).data.type).toBe('heading');
  });

  it('emits only admissible patches', () => {
    const d = emptyDoc();
    const { patches } = addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'text' }] });
    for (const p of patches) expect(p.path[0]).toBe('nodes');
  });

  it('refuses a child the parent does not allow', () => {
    const d = emptyDoc();
    const { patches } = addSubtree(d, 'rt', { type: 'flex-section' });
    d.apply(patches);
    const sectionId = d.node('rt').data.nodes[0];
    // A root-only element cannot go inside a section.
    expect(() => addSubtree(d, sectionId, { type: 'flex-section' })).toThrow(/root/i);
  });

  it('refuses to add into a node that is not a container', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'text' }] }).patches);
    const sectionId = d.node('rt').data.nodes[0];
    const textId = d.node(sectionId).data.nodes[0];
    expect(() => addSubtree(d, textId, { type: 'heading' })).toThrow(/container/i);
  });
});

describe('setKeys()', () => {
  it('writes per breakpoint by default', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section' }).patches);
    const id = d.node('rt').data.nodes[0];
    d.apply(setKeys(d, id, { gap: '24px' }, { namespace: 'style', breakpoint: 'desktop' }));
    expect(d.node(id).responsive.desktop.style.gap).toBe('24px');
    expect((d.node(id).style as Record<string, unknown>).gap).toBeUndefined();
  });

  it('refuses a base write of a visual quantity', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section' }).patches);
    const id = d.node('rt').data.nodes[0];
    expect(() => setKeys(d, id, { gap: '24px' }, { namespace: 'style', base: true })).toThrow(
      /vanish|responsive/i,
    );
  });

  it('allows a base write of an identity key', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'heading' }).patches);
    const id = d.node('rt').data.nodes[0];
    d.apply(setKeys(d, id, { htmlTag: 'h1' }, { namespace: 'specials', base: true }));
    expect(d.node(id).specials.htmlTag).toBe('h1');
  });

  it('always writes specials at base — content is not a quantity', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'heading' }).patches);
    const id = d.node('rt').data.nodes[0];
    d.apply(setKeys(d, id, { text: 'Hello' }, { namespace: 'specials' }));
    expect(d.node(id).specials.text).toBe('Hello');
  });
});

describe('moveNode() / removeNode()', () => {
  it('moves a node between parents', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'text' }] }).patches);
    d.apply(addSubtree(d, 'rt', { type: 'flex-section' }).patches);
    const [a, b] = d.node('rt').data.nodes;
    const textId = d.node(a).data.nodes[0];
    d.apply(moveNode(d, textId, b, 0));
    expect(d.node(a).data.nodes).toEqual([]);
    expect(d.node(b).data.nodes).toEqual([textId]);
    expect(d.node(textId).data.parent).toBe(b);
  });

  it('refuses to move a node into its own descendant', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'flex-block' }] }).patches);
    const sectionId = d.node('rt').data.nodes[0];
    const blockId = d.node(sectionId).data.nodes[0];
    expect(() => moveNode(d, sectionId, blockId, 0)).toThrow(/descendant/i);
  });

  it('removes a node and its whole subtree', () => {
    const d = emptyDoc();
    d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'text' }] }).patches);
    const sectionId = d.node('rt').data.nodes[0];
    const textId = d.node(sectionId).data.nodes[0];
    d.apply(removeNode(d, sectionId));
    expect(d.has(sectionId)).toBe(false);
    expect(d.has(textId)).toBe(false);
    expect(d.node('rt').data.nodes).toEqual([]);
  });

  it('refuses to remove an overlay through this path', () => {
    const d = PageDoc.from({
      schema_version: 2,
      root_node_id: 'rt',
      nodes: {
        rt: { id: 'rt', data: { type: 'root', parent: null, nodes: ['cart'], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
        cart: { id: 'cart', data: { type: 'flex-section', parent: 'rt', nodes: [], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: { overlayId: 'ov_1' }, responsive: {}, events: [], bindings: [] },
      },
    });
    expect(() => removeNode(d, 'cart')).toThrow(/overlay/i);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/builder.test.ts`
Expected: FAIL — `Cannot find module '../src/domains/site/builder.js'`.

- [x] **Step 3: Write `src/domains/site/builder.ts`**

```ts
import type { Patch } from '../../core/patch.js';
import { isOverlay, subtreeIds, ancestors } from '../../core/tree.js';
import { ELEMENTS } from '../../catalog/elements.generated.js';
import { createNode } from './node.js';
import { isIdentityKey } from './traps.js';
import type { PageDoc } from './document.js';

export type Breakpoint = 'desktop' | 'laptop' | 'tablet' | 'mobile';

export interface NodeSpec {
  type: string;
  name?: string;
  style?: Record<string, unknown>;
  config?: Record<string, unknown>;
  specials?: Record<string, unknown>;
  children?: NodeSpec[];
}

function requireContainer(parentType: string, parentId: string): void {
  const meta = ELEMENTS[parentType];
  if (!meta?.isContainer) {
    throw new Error(
      `sbuilder: ${parentId} is a ${parentType}, which is not a container — it cannot hold children.`,
    );
  }
}

function requireAllowed(parentType: string, childType: string): void {
  const child = ELEMENTS[childType];
  if (!child) throw new Error(`sbuilder: unknown element "${childType}"`);
  if (child.isRootOnly && parentType !== 'root') {
    throw new Error(
      `sbuilder: ${childType} is root-only — it may only be a direct child of ROOT, not of a ${parentType}.`,
    );
  }
  const allows = ELEMENTS[parentType]?.childAllows ?? [];
  if (allows.length > 0 && !allows.includes(childType)) {
    throw new Error(
      `sbuilder: a ${parentType} accepts only [${allows.join(', ')}], not ${childType}.`,
    );
  }
}

/**
 * Add a whole subtree under `parentId`, as ONE batch of patches.
 *
 * Nested rather than one-node-per-call because a hero section is a section, a
 * heading, a paragraph and a button — four round trips to describe one idea, and
 * four separate op batches for anyone watching the room. The spec is a tree; the
 * patches come out flat and in creation order, so a peer applying them left to
 * right never sees a child referenced before it exists.
 */
export function addSubtree(
  doc: PageDoc,
  parentId: string,
  spec: NodeSpec,
  index?: number,
): { patches: Patch[]; ids: string[] } {
  const parent = doc.node(parentId);
  requireContainer(parent.data.type, parentId);
  requireAllowed(parent.data.type, spec.type);

  const patches: Patch[] = [];
  const ids: string[] = [];

  const build = (s: NodeSpec, parentNodeId: string): string => {
    const n = createNode(s.type, {
      name: s.name,
      parent: parentNodeId,
      style: s.style,
      config: s.config,
      specials: s.specials,
    });
    patches.push({ op: 'set', path: ['nodes', n.id], value: n });
    ids.push(n.id);
    for (const child of s.children ?? []) {
      requireContainer(s.type, n.id);
      requireAllowed(s.type, child.type);
      const childId = build(child, n.id);
      patches.push({ op: 'insert', path: ['nodes', n.id, 'data', 'nodes'], index: 1e9, value: childId });
    }
    return n.id;
  };

  const rootId = build(spec, parentId);
  const at = index ?? parent.data.nodes.length;
  patches.push({ op: 'insert', path: ['nodes', parentId, 'data', 'nodes'], index: at, value: rootId });
  return { patches, ids };
}

/**
 * Write keys into a namespace.
 *
 * PER BREAKPOINT BY DEFAULT, and that default is the whole point. The platform's
 * rule is that any key which CAN be responsive MUST be: a visual quantity written
 * at base renders correctly on the canvas and then vanishes on publish, because
 * the published cascade has no base layer under it. An agent writing styles
 * would otherwise ship that bug on every element it touches.
 *
 * `specials` is the exception and needs no flag: it is content and identity,
 * base-only by definition.
 */
export function setKeys(
  doc: PageDoc,
  id: string,
  keys: Record<string, unknown>,
  opts: { namespace: 'style' | 'config' | 'specials'; breakpoint?: Breakpoint; base?: boolean },
): Patch[] {
  doc.node(id); // throws with the id if it is not there
  const { namespace } = opts;

  if (namespace === 'specials') {
    return Object.entries(keys).map(([k, v]) => ({
      op: 'set' as const,
      path: ['nodes', id, 'specials', k],
      value: v,
    }));
  }

  if (opts.base) {
    const offenders = Object.keys(keys).filter((k) => !isIdentityKey(k));
    if (offenders.length > 0) {
      throw new Error(
        `sbuilder: refusing a base-only write of [${offenders.join(', ')}]. A visual quantity ` +
          'written at base renders on the canvas and VANISHES on publish. Write it per ' +
          'breakpoint, or pass identity keys only.',
      );
    }
    return Object.entries(keys).map(([k, v]) => ({
      op: 'set' as const,
      path: ['nodes', id, namespace, k],
      value: v,
    }));
  }

  const bp = opts.breakpoint ?? 'desktop';
  return Object.entries(keys).map(([k, v]) => ({
    op: 'set' as const,
    path: ['nodes', id, 'responsive', bp, namespace, k],
    value: v,
  }));
}

export function moveNode(doc: PageDoc, id: string, newParentId: string, index: number): Patch[] {
  const n = doc.node(id);
  const newParent = doc.node(newParentId);
  requireContainer(newParent.data.type, newParentId);
  requireAllowed(newParent.data.type, n.data.type);
  if (isOverlay(doc.doc, id)) {
    throw new Error(
      `sbuilder: ${id} is a site overlay (the cart drawer or a pop-up). It is not part of this ` +
        'page document — it is composed onto ROOT on read and stripped on write. Edit it through ' +
        'the overlays API instead.',
    );
  }
  // A node moved inside its own subtree detaches that subtree from the document
  // with nothing to report it: the nodes still exist in the map, reachable from
  // nobody.
  if (newParentId === id || ancestors(doc.doc, newParentId).includes(id) || subtreeIds(doc.doc, id).includes(newParentId)) {
    throw new Error(`sbuilder: cannot move ${id} into its own descendant ${newParentId}`);
  }

  const oldParentId = n.data.parent;
  const patches: Patch[] = [];
  if (oldParentId) {
    const at = doc.node(oldParentId).data.nodes.indexOf(id);
    if (at >= 0) {
      patches.push({ op: 'remove', path: ['nodes', oldParentId, 'data', 'nodes'], index: at });
    }
  }
  patches.push({ op: 'insert', path: ['nodes', newParentId, 'data', 'nodes'], index, value: id });
  patches.push({ op: 'set', path: ['nodes', id, 'data', 'parent'], value: newParentId });
  return patches;
}

export function removeNode(doc: PageDoc, id: string): Patch[] {
  const n = doc.node(id);
  if (id === doc.doc.root_node_id) throw new Error('sbuilder: cannot remove ROOT');
  if (isOverlay(doc.doc, id)) {
    throw new Error(
      `sbuilder: ${id} is a site overlay and is not part of this page document. Removing it here ` +
        'would do nothing on save — it is stripped out anyway. Use the overlays API.',
    );
  }
  const patches: Patch[] = [];
  const parentId = n.data.parent;
  if (parentId) {
    const at = doc.node(parentId).data.nodes.indexOf(id);
    if (at >= 0) {
      patches.push({ op: 'remove', path: ['nodes', parentId, 'data', 'nodes'], index: at });
    }
  }
  // Unset the whole subtree, deepest last so nothing is orphaned mid-batch.
  for (const sub of subtreeIds(doc.doc, id)) {
    patches.push({ op: 'unset', path: ['nodes', sub] });
  }
  return patches;
}
```

- [x] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/builder.test.ts`
Expected: PASS, 12 tests.

- [x] **Step 5: Commit**

```bash
git add src/domains/site/builder.ts test/builder.test.ts
git commit -m "feat(site): the builder — nested subtrees, per-breakpoint writes, containment rules"
```

---

### Task 8: Save validation

**Files:**
- Create: `src/domains/site/validate.ts`
- Test: `test/validate.test.ts`

**Interfaces:**
- Consumes: `PageDoc`; `checkBandOrder`; `pageChildren`, `childrenOf`, `subtreeIds`.
- Produces: `validateForSave(doc: PageDoc): string[]`.

Every check here mirrors one the platform runs on save. Catching them locally turns "the
autosave silently failed twenty minutes ago" into "this call refused, and said why".

- [x] **Step 1: Write the failing test**

```ts
// test/validate.test.ts
import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { validateForSave } from '../src/domains/site/validate.js';

function doc(rootKids: string[], extra: Record<string, unknown> = {}) {
  return PageDoc.from({
    schema_version: 2,
    root_node_id: 'rt',
    nodes: {
      rt: { id: 'rt', data: { type: 'root', parent: null, nodes: rootKids, isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
      ...extra,
    },
  });
}

function sec(id: string, specials: Record<string, unknown> = {}, kids: string[] = []) {
  return { id, data: { type: 'flex-section', parent: 'rt', nodes: kids, isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials, responsive: {}, events: [], bindings: [] };
}

describe('validateForSave()', () => {
  it('passes a well-formed document', () => {
    expect(validateForSave(doc(['a'], { a: sec('a') }))).toEqual([]);
  });

  it('reports a band-order violation, which the platform refuses on every save', () => {
    const d = doc(['m', 'h'], { m: sec('m'), h: sec('h', { globalId: 'g', globalKind: 'header' }) });
    expect(validateForSave(d).join(' ')).toMatch(/header/i);
  });

  it('reports a child id that names no node', () => {
    const d = doc(['ghost'], {});
    expect(validateForSave(d).join(' ')).toMatch(/ghost/);
  });

  it('reports an orphan — a node no one references', () => {
    const d = doc(['a'], { a: sec('a'), lost: sec('lost') });
    expect(validateForSave(d).join(' ')).toMatch(/lost/);
  });

  it('reports a parent pointer that disagrees with the child list', () => {
    const d = doc(['a'], {
      a: sec('a', {}, ['b']),
      b: { id: 'b', data: { type: 'text', parent: 'rt', nodes: [], isCanvas: false, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
    });
    expect(validateForSave(d).join(' ')).toMatch(/parent/i);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/validate.test.ts`
Expected: FAIL — `Cannot find module '../src/domains/site/validate.js'`.

- [x] **Step 3: Write `src/domains/site/validate.ts`**

```ts
import { childrenOf, subtreeIds, type DocLike } from '../../core/tree.js';
import { checkBandOrder } from './traps.js';
import type { PageDoc } from './document.js';

/**
 * Everything that would make the platform refuse this document on save.
 *
 * Each check mirrors one the server runs. Running them here turns a silent
 * failure — an autosave rejected twenty minutes ago, with the agent still
 * happily editing a tree nobody will ever store — into a refusal at the call
 * that caused it.
 *
 * Returns an empty array when the document is storable.
 */
export function validateForSave(doc: PageDoc): string[] {
  const d: DocLike = doc.doc;
  const problems: string[] = [];

  const band = checkBandOrder(d);
  if (band) problems.push(band);

  // Dangling child ids: a parent naming a node that is not in the map. The
  // renderer walks children by id, so this is a hole in the page.
  for (const [id, n] of Object.entries(d.nodes)) {
    for (const kid of n.data.nodes) {
      if (!d.nodes[kid]) {
        problems.push(`Node ${id} lists child "${kid}", which is not in the document.`);
      }
    }
  }

  // Parent pointers that disagree with the child lists. Both are stored, and the
  // renderer trusts the child list while the editor's own moves trust the
  // pointer — so a disagreement renders one tree and edits another.
  for (const [id, n] of Object.entries(d.nodes)) {
    if (id === d.root_node_id) continue;
    const p = n.data.parent;
    if (p && d.nodes[p] && !childrenOf(d, p).includes(id)) {
      problems.push(`Node ${id} claims parent ${p}, but ${p} does not list it as a child.`);
    }
  }

  // Orphans: reachable from nobody. They bloat every save and never render.
  const reachable = new Set(subtreeIds(d, d.root_node_id));
  for (const id of Object.keys(d.nodes)) {
    if (!reachable.has(id)) {
      problems.push(`Node ${id} is unreachable from ROOT — nothing references it.`);
    }
  }

  return problems;
}
```

- [x] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/validate.test.ts`
Expected: PASS, 5 tests.

- [x] **Step 5: Commit**

```bash
git add src/domains/site/validate.ts test/validate.test.ts
git commit -m "feat(site): pre-save validation mirroring the platform's own refusals"
```

---

### Task 9: Page transport — load and save a document

**Files:**
- Create: `src/transport/pages.ts`
- Test: `test/pages-transport.test.ts`

**Interfaces:**
- Consumes: `request`, `ApiError`; `ToolContext`.
- Produces: `loadSource(ctx, siteId, pageId): Promise<PageSource>`; `saveSource(ctx, siteId, pageId, document): Promise<PageSource>`; `interface PageSource { pageId: string; siteId: string; document: unknown; schemaVersion: number; updatedAt: string; warnings?: unknown[]; globals?: unknown[]; overlays?: unknown[] }`.

The response is enveloped under `source` (`httpx.WriteItem(w, 200, "source", …)`), and
`warnings` / `globals` / `overlays` are **omitted** when empty rather than sent as null.

- [x] **Step 1: Write the failing test**

```ts
// test/pages-transport.test.ts
import { describe, it, expect, vi } from 'vitest';
import { loadSource, saveSource } from '../src/transport/pages.js';
import { Session } from '../src/transport/auth.js';

function ctxWith(f: typeof fetch) {
  const s = new Session('http://x', f);
  (s as unknown as { access: string }).access = 'jwt';
  return { base: 'http://x', session: s, fetchImpl: f };
}

const sourceBody = {
  source: {
    pageId: 'pg_1',
    siteId: 's1',
    document: { schema_version: 2, root_node_id: 'rt', nodes: { rt: {} } },
    schemaVersion: 2,
    updatedAt: '2026-08-27T00:00:00Z',
  },
};

function okFetch() {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(sourceBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

function calls(f: typeof fetch) {
  return (f as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}

describe('loadSource()', () => {
  it('unwraps the source envelope', async () => {
    const f = okFetch();
    const out = await loadSource(ctxWith(f), 's1', 'pg_1');
    expect(out.pageId).toBe('pg_1');
    expect(calls(f)[0][0]).toBe('http://x/api/sites/s1/pages/pg_1/source');
  });

  it('uses the session credential', async () => {
    const f = okFetch();
    await loadSource(ctxWith(f), 's1', 'pg_1');
    const init = calls(f)[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
  });
});

describe('saveSource()', () => {
  it('PUTs the document', async () => {
    const f = okFetch();
    await saveSource(ctxWith(f), 's1', 'pg_1', { schema_version: 2, root_node_id: 'rt', nodes: {} });
    const init = calls(f)[0][1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body)).document.root_node_id).toBe('rt');
  });

  it('surfaces the platform code on a rejected save rather than a bare status', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'band order', code: 'band_order' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;
    await expect(
      saveSource(ctxWith(f), 's1', 'pg_1', { schema_version: 2, root_node_id: 'rt', nodes: {} }),
    ).rejects.toMatchObject({ status: 409, code: 'band_order' });
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/pages-transport.test.ts`
Expected: FAIL — `Cannot find module '../src/transport/pages.js'`.

- [x] **Step 3: Write `src/transport/pages.ts`**

```ts
import { request } from './http.js';
import type { ToolContext } from '../tools/context.js';

export interface PageSource {
  pageId: string;
  siteId: string;
  document: unknown;
  schemaVersion: number;
  updatedAt: string;
  /** Omitted by the server when empty — never null. */
  warnings?: unknown[];
  globals?: unknown[];
  overlays?: unknown[];
}

function sourcePath(siteId: string, pageId: string): string {
  return `/api/sites/${encodeURIComponent(siteId)}/pages/${encodeURIComponent(pageId)}/source`;
}

/**
 * Read a page's DRAFT document.
 *
 * The response is enveloped under `source` (httpx.WriteItem), and `warnings`,
 * `globals` and `overlays` are omitted rather than nulled when empty — so a
 * caller must treat absence as "none", never dereference them.
 *
 * What comes back is COMPOSED: any global sections and site overlays have been
 * merged onto ROOT. That is the tree to edit, and the server strips the overlays
 * back out on write.
 */
export async function loadSource(
  ctx: ToolContext,
  siteId: string,
  pageId: string,
): Promise<PageSource> {
  const out = (await request({
    base: ctx.base,
    method: 'GET',
    path: sourcePath(siteId, pageId),
    token: ctx.session.token(),
    fetchImpl: ctx.fetchImpl,
  })) as { source: PageSource };
  return out.source;
}

/**
 * Save a page's draft document.
 *
 * A rejection here is the platform refusing the TREE, not the transport failing
 * — `band_order` is the common one — and `ApiError.code` carries which. That is
 * why this does not swallow the error: the code is the only thing that tells an
 * agent what to fix.
 */
export async function saveSource(
  ctx: ToolContext,
  siteId: string,
  pageId: string,
  document: unknown,
): Promise<PageSource> {
  const out = (await request({
    base: ctx.base,
    method: 'PUT',
    path: sourcePath(siteId, pageId),
    token: ctx.session.token(),
    body: { document },
    fetchImpl: ctx.fetchImpl,
  })) as { source: PageSource };
  return out.source;
}
```

- [x] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/pages-transport.test.ts`
Expected: PASS, 4 tests.

- [x] **Step 5: Verify the save body shape against the real server**

The PUT body is `{ document }` here, but the OpenAPI document describes no body for this
route (that is the `body_note` case from Phase 1), so the shape is inferred from
`editor/src/features/pages/api.ts:114`. Before relying on it, read that call site:

Run: `sed -n '105,125p' /Volumes/workspace/webcake/web_builder/editor/src/features/pages/api.ts`
Expected: confirms the request body key. **If it differs, change `saveSource` and its test to
match the editor** — the editor is the working client, and this repo copies it rather than
guessing.

- [x] **Step 6: Commit**

```bash
git add src/transport/pages.ts test/pages-transport.test.ts
git commit -m "feat(transport): load and save a page's draft document"
```

---

### Task 10: The page tools

**Files:**
- Create: `src/tools/page.ts`
- Modify: `src/server.ts`
- Test: `test/page-tools.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `registerPageTools(server: McpServer, ctx: ToolContext): void`; `class PageSession { open(siteId, pageId): Promise<OutlineNode[]>; current(): PageDoc; save(): Promise<void> }`.

Eleven tools. `PageSession` holds the one open document so the write tools do not each
re-fetch it.

- [x] **Step 1: Write the failing test**

```ts
// test/page-tools.test.ts
import { describe, it, expect, vi } from 'vitest';
import { PageSession } from '../src/tools/page.js';
import { Session } from '../src/transport/auth.js';

const emptyDocument = {
  schema_version: 2,
  root_node_id: 'rt',
  nodes: {
    rt: { id: 'rt', data: { type: 'root', parent: null, nodes: [], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
  },
};

function scripted() {
  const saved: unknown[] = [];
  const f = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT') saved.push(JSON.parse(String(init.body)));
    return new Response(
      JSON.stringify({
        source: {
          pageId: 'pg_1',
          siteId: 's1',
          document: emptyDocument,
          schemaVersion: 2,
          updatedAt: 'now',
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { f, saved };
}

function ctxWith(f: typeof fetch) {
  const s = new Session('http://x', f);
  (s as unknown as { access: string }).access = 'jwt';
  return { base: 'http://x', session: s, fetchImpl: f };
}

describe('PageSession', () => {
  it('opens a page and returns its outline', async () => {
    const { f } = scripted();
    const ps = new PageSession(ctxWith(f));
    const outline = await ps.open('s1', 'pg_1');
    expect(outline).toEqual([]);
    expect(ps.current().doc.root_node_id).toBe('rt');
  });

  it('refuses a write before a page is open, naming the tool to call', () => {
    const { f } = scripted();
    const ps = new PageSession(ctxWith(f));
    expect(() => ps.current()).toThrow(/sb_page_open/);
  });

  it('saves the edited document', async () => {
    const { f, saved } = scripted();
    const ps = new PageSession(ctxWith(f));
    await ps.open('s1', 'pg_1');
    await ps.save();
    expect(saved.length).toBe(1);
  });

  it('refuses to save a document that would be rejected, before sending it', async () => {
    const { f } = scripted();
    const ps = new PageSession(ctxWith(f));
    await ps.open('s1', 'pg_1');
    // Plant an orphan the platform would refuse.
    ps.current().apply([
      { op: 'set', path: ['nodes', 'ghost'], value: { id: 'ghost', data: { type: 'text', parent: null, nodes: [], isCanvas: false, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] } },
    ]);
    await expect(ps.save()).rejects.toThrow(/unreachable/i);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/page-tools.test.ts`
Expected: FAIL — `Cannot find module '../src/tools/page.js'`.

- [x] **Step 3: Write `src/tools/page.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { loadSource, saveSource } from '../transport/pages.js';
import { PageDoc, type OutlineNode } from '../domains/site/document.js';
import { addSubtree, setKeys, moveNode, removeNode, type NodeSpec, type Breakpoint } from '../domains/site/builder.js';
import { validateForSave } from '../domains/site/validate.js';
import { globalWarning, RESPONSIVE_NOTICE } from '../domains/site/traps.js';
import { ELEMENTS } from '../catalog/elements.generated.js';
import type { ToolContext } from './context.js';

/**
 * The one open page.
 *
 * The write tools share it rather than each re-fetching: a fetch per edit would
 * discard local work every call, and would make a hero section forty round trips.
 */
export class PageSession {
  private doc: PageDoc | null = null;
  private siteId = '';
  private pageId = '';

  constructor(private readonly ctx: ToolContext) {}

  async open(siteId: string, pageId: string): Promise<OutlineNode[]> {
    const src = await loadSource(this.ctx, siteId, pageId);
    this.doc = PageDoc.from(src.document);
    this.siteId = siteId;
    this.pageId = pageId;
    return this.doc.outline();
  }

  current(): PageDoc {
    if (!this.doc) throw new Error('sbuilder: no page is open — call sb_page_open first');
    return this.doc;
  }

  /**
   * Validate, then save.
   *
   * The validation is not belt-and-braces: the platform refuses a band-order
   * violation or a broken tree on EVERY save, and discovering that from a 409
   * one autosave later means the agent has kept editing a tree nobody will store.
   */
  async save(): Promise<void> {
    const d = this.current();
    const problems = validateForSave(d);
    if (problems.length > 0) {
      throw new Error(`sbuilder: refusing to save — ${problems.join(' ')}`);
    }
    await saveSource(this.ctx, this.siteId, this.pageId, d.doc);
  }
}
```

Then the tool registrations, in the same file:

```ts
export function registerPageTools(server: McpServer, ctx: ToolContext): void {
  const session = new PageSession(ctx);

  server.tool(
    'sb_page_open',
    'Open a page for editing and return its outline. Call before any sb_add/sb_set/sb_move/sb_remove.',
    { site_id: z.string(), page_id: z.string() },
    async ({ site_id, page_id }) => text(await session.open(site_id, page_id)),
  );

  server.tool(
    'sb_outline',
    'The open page as a compressed tree — id, type, name, child count, band, and whether a node ' +
      'is a shared global or a site overlay. Never the raw document: a real page is hundreds of KB.',
    { depth: z.number().int().min(1).max(6).optional() },
    async ({ depth }) => text(session.current().outline({ depth })),
  );

  server.tool(
    'sb_node_read',
    'One node in full — style, config, specials, per-breakpoint overrides, bindings.',
    { id: z.string() },
    async ({ id }) => {
      const d = session.current();
      const warn = globalWarning(d.doc, id);
      return text({ node: d.node(id), ...(warn ? { warning: warn } : {}) });
    },
  );

  server.tool(
    'sb_catalog_search',
    'Find an element type by what you want it to do. Searches the platform\'s own AI hints — ' +
      'when to use each element, when not to, and what content suits it.',
    { query: z.string(), limit: z.number().int().min(1).max(30).optional() },
    async ({ query, limit }) => {
      const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const scored = Object.values(ELEMENTS)
        .map((el) => {
          const hay = [el.type, el.label, el.category, el.description, ...el.semantics, ...el.useWhen]
            .join(' ')
            .toLowerCase();
          return { el, score: terms.filter((t) => hay.includes(t)).length };
        })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score || a.el.type.localeCompare(b.el.type))
        .slice(0, limit ?? 10);
      return text(
        scored.map(({ el }) => ({
          type: el.type,
          label: el.label,
          category: el.category,
          isContainer: el.isContainer,
          isRootOnly: el.isRootOnly,
          description: el.description,
          useWhen: el.useWhen,
          avoidWhen: el.avoidWhen,
          contentTips: el.contentTips,
        })),
      );
    },
  );

  server.tool(
    'sb_traits_for',
    'Which inspector traits an element accepts, plus its defaults and containment rules.',
    { type: z.string() },
    async ({ type }) => {
      const el = ELEMENTS[type];
      if (!el) throw new Error(`sbuilder: unknown element "${type}" — use sb_catalog_search`);
      return text({
        type: el.type,
        traits: el.traits,
        defaults: el.defaults,
        isContainer: el.isContainer,
        isRootOnly: el.isRootOnly,
        childAllows: el.childAllows,
        contentTips: el.contentTips,
      });
    },
  );

  const specSchema: z.ZodType<NodeSpec> = z.lazy(() =>
    z.object({
      type: z.string(),
      name: z.string().optional(),
      style: z.record(z.unknown()).optional(),
      config: z.record(z.unknown()).optional(),
      specials: z.record(z.unknown()).optional(),
      children: z.array(specSchema).optional(),
    }),
  );

  server.tool(
    'sb_add',
    'Add an element — or a whole nested subtree — under a parent. One call builds a complete ' +
      'section: pass children rather than calling this once per node.',
    {
      parent_id: z.string(),
      spec: specSchema,
      index: z.number().int().min(0).optional(),
      dry_run: z.boolean().optional(),
    },
    async ({ parent_id, spec, index, dry_run }) => {
      const d = session.current();
      const { patches, ids } = addSubtree(d, parent_id, spec, index);
      if (dry_run !== false) return text({ dry_run: true, would_add: ids, patches: patches.length });
      d.apply(patches);
      await session.save();
      return text({ added: ids, rev: d.rev });
    },
  );

  server.tool(
    'sb_set',
    'Write style, config or specials keys on a node. Style and config are written PER ' +
      'BREAKPOINT by default — a visual quantity written at base vanishes on publish.',
    {
      id: z.string(),
      namespace: z.enum(['style', 'config', 'specials']),
      keys: z.record(z.unknown()),
      breakpoint: z.enum(['desktop', 'laptop', 'tablet', 'mobile']).optional(),
      base: z.boolean().optional(),
      dry_run: z.boolean().optional(),
    },
    async ({ id, namespace, keys, breakpoint, base, dry_run }) => {
      const d = session.current();
      const patches = setKeys(d, id, keys, {
        namespace,
        breakpoint: breakpoint as Breakpoint | undefined,
        base,
      });
      if (dry_run !== false) {
        return text({ dry_run: true, patches, note: RESPONSIVE_NOTICE });
      }
      d.apply(patches);
      await session.save();
      const warn = globalWarning(d.doc, id);
      return text({ set: Object.keys(keys), rev: d.rev, ...(warn ? { warning: warn } : {}) });
    },
  );

  server.tool(
    'sb_move',
    'Move a node to another parent at an index.',
    {
      id: z.string(),
      parent_id: z.string(),
      index: z.number().int().min(0),
      dry_run: z.boolean().optional(),
    },
    async ({ id, parent_id, index, dry_run }) => {
      const d = session.current();
      const patches = moveNode(d, id, parent_id, index);
      if (dry_run !== false) return text({ dry_run: true, patches });
      d.apply(patches);
      await session.save();
      return text({ moved: id, rev: d.rev });
    },
  );

  server.tool(
    'sb_remove',
    'Remove a node and its whole subtree.',
    { id: z.string(), dry_run: z.boolean().optional() },
    async ({ id, dry_run }) => {
      const d = session.current();
      const patches = removeNode(d, id);
      if (dry_run !== false) return text({ dry_run: true, removing: patches.length });
      d.apply(patches);
      await session.save();
      return text({ removed: id, rev: d.rev });
    },
  );
}
```

- [x] **Step 4: Register the group in `src/server.ts`**

Add the import and the call:

```ts
import { registerPageTools } from './tools/page.js';
// …inside createServer, after registerApiTools(server, ctx):
  registerPageTools(server, ctx);
```

Extend `INSTRUCTIONS` with a paragraph:

```
- To design a page: sb_page_open, then sb_catalog_search to pick element types, then sb_add
  with a NESTED spec (one call per section, not per node), then sb_set for styling. Writes
  default to dry_run:true. sb_set writes per breakpoint — pass base:true only for identity.
```

- [x] **Step 5: Run the test and the gate**

Run: `npx vitest run test/page-tools.test.ts && npm run build && npm test && npm run smoke`
Expected: page-tools 4 tests PASS; build clean; whole suite green; smoke `ALL GOOD`.

- [x] **Step 6: Verify the tools appear over the real protocol**

Run the stdio probe from Phase 1 (`node /tmp/mcp-probe.mjs`, recreating it if gone).
Expected: 13 tools listed — the four from Phase 1 plus `sb_page_open`, `sb_outline`,
`sb_node_read`, `sb_catalog_search`, `sb_traits_for`, `sb_add`, `sb_set`, `sb_move`,
`sb_remove`.

- [x] **Step 7: Commit**

```bash
git add src/tools/page.ts src/server.ts test/page-tools.test.ts
git commit -m "feat(tools): the page tools — open, outline, catalog search, add, set, move, remove"
```

---

### Task 11: Smoke, docs, and the phase close

**Files:**
- Modify: `src/smoke.ts`, `CLAUDE.md`, `README.md`, `README.vi.md`, `docs/tools.md`, `docs/tools.vi.md`

- [x] **Step 1: Extend the smoke gate**

Add to `runSmoke()`, before `ALL GOOD`:

```ts
  const { ELEMENTS, ELEMENT_SOURCE } = await import('./catalog/elements.generated.js');
  check('element catalog is populated', Object.keys(ELEMENTS).length === ELEMENT_SOURCE.count);
  check(
    'every element carries AI hints',
    Object.values(ELEMENTS).every((e) => e.description.length > 0),
  );

  const { PageDoc } = await import('./domains/site/document.js');
  const { addSubtree } = await import('./domains/site/builder.js');
  const { validateForSave } = await import('./domains/site/validate.js');
  const d = PageDoc.from({
    schema_version: 2,
    root_node_id: 'rt',
    nodes: {
      rt: { id: 'rt', data: { type: 'root', parent: null, nodes: [], isCanvas: true, hidden: false, custom: {} }, style: {}, config: {}, specials: {}, responsive: {}, events: [], bindings: [] },
    },
  });
  d.apply(addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'heading' }] }).patches);
  check('builder produces a storable document', validateForSave(d).length === 0);
  check('builder linked the subtree', d.outline({ depth: 2 })[0].kids?.length === 1);
```

- [x] **Step 2: Update the tool tables**

Add the nine new tools to `docs/tools.md`, `docs/tools.vi.md`, and the at-a-glance tables in
both READMEs. State in each: writes default to `dry_run:true`; `sb_set` writes per
breakpoint; `sb_outline` never returns the raw document.

- [x] **Step 3: Update `CLAUDE.md`**

Move Phase 2 from "next" to "shipped" in the Phases section, and add the four traps to the
platform-facts list with their one-line reasons.

- [x] **Step 4: Run the full gate**

Run: `npm run build && npm test && npm run smoke`
Expected: all green, `ALL GOOD`.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: phase 2 tools, traps, and an end-to-end smoke check"
```

---

## Self-review

**Spec coverage.** Spec §4 `core/` → Tasks 2–3. §4 `domains/site/` → Tasks 4–8. §5.1 patch
protocol and its three admission rules → Task 2. §6 the traps → Task 4, plus enforcement in
Tasks 7–8. §7 Tier-1 read/write tools → Task 10; `sb_bind` is **deliberately deferred** to
Phase 3 with the binding work it belongs to, and `sb_page_list`/`sb_page_create` are already
reachable through `sb_api_find`/`sb_api_call`, so adding hand-written duplicates would be
surface for nothing. §7 conventions (`text()`, `dry_run`, outline compression, batching) →
Tasks 6, 10. §9 anti-drift tripwire 1 (the `schema_version` stamp) → Task 1.

**Spec §5.3 sparse authoring (expand/compact) is NOT in this plan.** `createNode` already
seeds from `meta.defaults`, so a caller writes only what differs — which is the win
expand/compact exists for on the write path. The read-path inverse (`compact`) only pays off
once `sb_node_read` is heavily used, and building it before there is a measured need would
be speculative. Recorded here rather than silently dropped.

**Placeholder scan.** No TBD/TODO. Task 6 Step 3 carries an explicit instruction about the
`void pageChildren` line rather than leaving dead code. Task 9 Step 5 is a verification step
with a named file and line, not "check the shape".

**Type consistency.** `DocLike`/`NodeLike` are defined once (Task 3) and used by Tasks 4, 6,
8. `PageDoc.doc` is `DocLike` everywhere. `Patch` comes from `core/patch.js` in Tasks 6, 7,
9. `Breakpoint` is defined in `builder.ts` (Task 7) and imported by `page.ts` (Task 10).
`CatalogElement` is defined in Task 1 and consumed in Tasks 5, 7, 10. `ToolContext` is
Phase 1's and unchanged.
