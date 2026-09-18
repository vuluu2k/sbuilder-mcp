# Unlock 3 — Forcible guards with a hard core: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A guard that asserts what a renderer does can be overridden per call with `force:true` and is then reported instead of thrown; a guard that protects the platform's own invariants ignores `force` entirely.

**Architecture:** One helper, `soft(guard, check)`, wraps every soft guard CALL SITE in `src/domains/site/builder.ts` and `src/tools/live.ts`. The guard functions themselves do not change. Each builder function takes an optional `GuardOpts` (`{ force?: boolean; forced?: string[] }`); the CALLER owns the `forced` array and reads it after the call, so no return type changes. Without `force`, a soft guard throws its own message plus a fixed suffix; with `force`, the message is pushed and the write proceeds. Each tool adds `force?: boolean` and reports `forced: string[]` when non-empty, in the dry run and the real run.

**Tech Stack:** TypeScript (ESM / Node16), zod, vitest.

**Spec:** `docs/superpowers/specs/2026-09-19-unlock-platform-reach-design.md`, section 5.

## Global Constraints

- The gate for every change is `npm run build && npm test && npm run smoke`; smoke MUST print `ALL GOOD`.
- Default behaviour (no `force`) must stay byte-identical except for the added suffix on soft-guard messages. Every existing test stays green untouched; a test that has to change is a sign the split is wrong.
- Hard guards NEVER read `force`: band order (`validateForSave`), `refuseComposedStamp`, ROOT remove/duplicate, unknown element type, `refuseOverlay`, the cycle check in `moveNode`, "contains an app block" in `duplicateNode`, `specials` with a state, `requireContainer`.
- A tool that writes must go through `PageSession.applyAndSave`.
- `test/token-budget.test.ts` holds a 24,500-character ceiling on `tools/list`. Raise it only with the reason written in the test.
- Every relative import ends in `.js`. No prettier.
- End commit messages with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: The `soft` helper and `GuardOpts`

**Files:**
- Create: `src/domains/site/guard.ts`
- Test: `test/guard.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GuardOpts { force?: boolean; forced?: string[] }
  export const FORCE_HINT = ' Pass force:true to write anyway.';
  export function soft(g: GuardOpts | undefined, check: () => void): void;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// test/guard.test.ts
import { describe, it, expect } from 'vitest';
import { soft, FORCE_HINT, type GuardOpts } from '../src/domains/site/guard.js';

const refuse = () => {
  throw new Error('sbuilder: nope');
};

describe('soft()', () => {
  it('rethrows with the force hint when not forced', () => {
    expect(() => soft(undefined, refuse)).toThrow('sbuilder: nope' + FORCE_HINT);
    expect(() => soft({ force: false }, refuse)).toThrow(FORCE_HINT);
  });

  it('records instead of throwing when forced', () => {
    const g: GuardOpts = { force: true, forced: [] };
    expect(() => soft(g, refuse)).not.toThrow();
    expect(g.forced).toEqual(['sbuilder: nope']);
  });

  it('is silent when the check passes', () => {
    const g: GuardOpts = { force: true, forced: [] };
    soft(g, () => {});
    expect(g.forced).toEqual([]);
  });

  it('does not add the hint twice', () => {
    const inner = () => {
      throw new Error('x' + FORCE_HINT);
    };
    expect(() => soft(undefined, inner)).toThrow('x' + FORCE_HINT);
    expect((() => { try { soft(undefined, inner); } catch (e) { return (e as Error).message; } })()).not.toMatch(new RegExp(FORCE_HINT.trim() + '.*' + FORCE_HINT.trim()));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/guard.test.ts`
Expected: FAIL — cannot find module `../src/domains/site/guard.js`.

- [ ] **Step 3: Implement**

```ts
// src/domains/site/guard.ts
/**
 * A SOFT guard is one that asserts what a renderer does — "this key compiles
 * to nothing", "this element takes no such child" — against the catalog's
 * copy of the platform, which can be older than the deployment. A caller who
 * knows better can override it per call; the write goes through and the
 * message is reported instead of thrown.
 *
 * A HARD guard protects an invariant the platform itself enforces or a write
 * that destroys data with no way back (band order, a composed stamp, ROOT).
 * Those are called directly, never through here, so `force` cannot reach them.
 */
export interface GuardOpts {
  force?: boolean;
  /** The messages force overrode, for the tool to report. Owned by the caller. */
  forced?: string[];
}

export const FORCE_HINT = ' Pass force:true to write anyway.';

export function soft(g: GuardOpts | undefined, check: () => void): void {
  try {
    check();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (g?.force) {
      g.forced?.push(msg);
      return;
    }
    throw new Error(msg.endsWith(FORCE_HINT) ? msg : msg + FORCE_HINT);
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domains/site/guard.ts test/guard.test.ts
git commit -m "feat(guard): a soft guard records under force and names the override otherwise

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Thread `GuardOpts` through the builder functions

**Files:**
- Modify: `src/domains/site/builder.ts` — `requireAllowed` (59-75), `addSubtree` (133-145), `setKeys` (238-380), `duplicateNode` (566-595), `moveNode` (658-685), `removeNode` (693-700), `SetEdit` + `setMany` (733-760)
- Modify: `src/tools/live.ts` — `bindNode` (67-80), `setEvent` (≈165-180)
- Test: `test/traps.test.ts` (append), `test/force.test.ts` (create)

**Interfaces:**
- Consumes: `soft`, `GuardOpts` from Task 1.
- Produces (every `guard` parameter optional, last):
  ```ts
  addSubtree(doc, parentId, spec, index?, guard?: GuardOpts): { patches; ids }
  setKeys(doc, id, keys, opts & { force?: boolean; forced?: string[] }): Patch[]
  setMany(doc, edits, guard?: GuardOpts): { patches; touched }
  duplicateNode(doc, id, guard?: GuardOpts): { patches; ids }
  moveNode(doc, id, newParentId, index, guard?: GuardOpts): Patch[]
  removeNode(doc, id, guard?: GuardOpts): Patch[]
  bindNode(doc, id, source, field, action?, guard?: GuardOpts): Patch[]
  setEvent(doc, id, trigger, action, payload?, guard?: GuardOpts): Patch[]
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// test/force.test.ts
import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree, setKeys, setMany, removeNode, moveNode, duplicateNode } from '../src/domains/site/builder.js';
import { bindNode, setEvent } from '../src/tools/live.js';
import { SPEC_APP_BLOCK_ID } from '../src/core/tree.js';
import { FORCE_HINT, type GuardOpts } from '../src/domains/site/guard.js';

function withAppBlock() {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const first = addSubtree(d, 'ROOT', {
    type: 'flex-section',
    children: [{ type: 'flex-block', children: [{ type: 'heading' }] }],
  });
  d.apply(first.patches);
  d.apply([{ op: 'set', path: ['nodes', first.ids[1], 'specials', SPEC_APP_BLOCK_ID], value: 'inst_1/hero' }]);
  d.apply(addSubtree(d, 'ROOT', { type: 'flex-section' }).patches);
  const [section, block, inner] = first.ids;
  return { d, section, block, inner };
}

const forced = (): GuardOpts => ({ force: true, forced: [] });

describe('soft guards under force', () => {
  it('app-block interior: every write goes through and is reported', () => {
    const { d, inner, block } = withAppBlock();
    const other = d.outline()[1].id;
    const cases: Array<[string, (g: GuardOpts) => unknown]> = [
      ['set', (g) => setKeys(d, inner, { text: 'x' }, { namespace: 'specials', base: true, ...g })],
      ['add under root', (g) => addSubtree(d, block, { type: 'heading' }, undefined, g)],
      ['add under inner', (g) => addSubtree(d, inner, { type: 'heading' }, undefined, g)],
      ['remove', (g) => removeNode(d, inner, g)],
      ['duplicate', (g) => duplicateNode(d, inner, g)],
      ['bind', (g) => bindNode(d, inner, 'product.title', 'specials.text', undefined, g)],
      ['event', (g) => setEvent(d, inner, 'click', 'open_cart', undefined, g)],
      ['move into', (g) => moveNode(d, other, block, 0, g)],
      ['move out', (g) => moveNode(d, inner, other, 0, g)],
    ];
    for (const [name, run] of cases) {
      expect(() => run({}), name).toThrow(FORCE_HINT);
      const g = forced();
      expect(() => run(g), name).not.toThrow();
      expect(g.forced.join(' '), name).toMatch(/app block/i);
    }
  });

  it('childAllows and root-only: forced through, unknown type still refused', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'flex-block' }] });
    d.apply(sec.patches);
    const block = sec.ids[1];
    // flex-section is root-only; under a flex-block it is refused, softly.
    expect(() => addSubtree(d, block, { type: 'flex-section' })).toThrow(/root-only.*force:true/s);
    const g = forced();
    expect(() => addSubtree(d, block, { type: 'flex-section' }, undefined, g)).not.toThrow();
    expect(g.forced[0]).toMatch(/root-only/);
    // Unknown type is hard: force changes nothing.
    expect(() => addSubtree(d, block, { type: 'no-such-element' }, undefined, forced())).toThrow(/unknown element/);
  });

  it('second template under list-dataset: forced through', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', {
      type: 'flex-section',
      children: [{ type: 'list-dataset', children: [{ type: 'dataset-block' }] }],
    });
    d.apply(sec.patches);
    const list = sec.ids[1];
    expect(() => addSubtree(d, list, { type: 'dataset-block' })).toThrow(/FIRST child.*force:true/s);
    const g = forced();
    expect(() => addSubtree(d, list, { type: 'dataset-block' }, undefined, g)).not.toThrow();
    expect(g.forced[0]).toMatch(/FIRST child/);
  });

  it('stuck-after on a node that cannot pin: forced through', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'heading' }] });
    d.apply(sec.patches);
    const h = sec.ids[1];
    expect(() => setKeys(d, h, { stuckAfter: 40 }, { namespace: 'config' })).toThrow(/cannot pin.*force:true/s);
    const g = forced();
    expect(() => setKeys(d, h, { stuckAfter: 40 }, { namespace: 'config', ...g })).not.toThrow();
    expect(g.forced[0]).toMatch(/cannot pin/);
  });

  it('stuck state with no host, and stuck config beyond hidden: forced through', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'heading' }] });
    d.apply(sec.patches);
    const h = sec.ids[1];
    expect(() => setKeys(d, h, { color: 'red' }, { namespace: 'style', state: 'stuck' })).toThrow(FORCE_HINT);
    const g = forced();
    expect(() => setKeys(d, h, { color: 'red' }, { namespace: 'style', state: 'stuck', ...g })).not.toThrow();
    expect(g.forced.length).toBeGreaterThan(0);
    const g2 = forced();
    expect(() => setKeys(d, h, { foo: 1 }, { namespace: 'config', state: 'stuck', ...g2 })).not.toThrow();
    expect(g2.forced.join(' ')).toMatch(/hidden/);
  });

  it('hover config beyond hidden, and reveal with no host: forced through', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'flex-block', children: [{ type: 'text' }] }] });
    d.apply(sec.patches);
    const section = sec.ids[0];
    const t = sec.ids[2];
    expect(() => setKeys(d, t, { foo: 1 }, { namespace: 'config', state: 'hover' })).toThrow(FORCE_HINT);
    const g = forced();
    expect(() => setKeys(d, t, { foo: 1 }, { namespace: 'config', state: 'hover', ...g })).not.toThrow();
    expect(g.forced.join(' ')).toMatch(/hidden/);
    // A direct child of ROOT has no box around it to hover.
    expect(() => setKeys(d, section, { revealOnHover: true }, { namespace: 'config' })).toThrow(FORCE_HINT);
    const g2 = forced();
    expect(() => setKeys(d, section, { revealOnHover: true }, { namespace: 'config', ...g2 })).not.toThrow();
    expect(g2.forced.join(' ')).toMatch(/hover/i);
  });

  it('setMany carries force to every edit', () => {
    const { d, inner } = withAppBlock();
    const g = forced();
    const out = setMany(d, [{ id: inner, namespace: 'specials', keys: { text: 'a' } }, { id: inner, namespace: 'specials', keys: { text: 'b' } }], g);
    expect(out.patches.length).toBeGreaterThan(0);
    expect(g.forced).toHaveLength(2);
  });
});

describe('hard guards ignore force', () => {
  it('ROOT cannot be removed or duplicated', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    expect(() => removeNode(d, 'ROOT', forced())).toThrow(/cannot remove ROOT/);
    expect(() => duplicateNode(d, 'ROOT', forced())).toThrow(/cannot duplicate ROOT/);
  });

  it('a composed stamp is refused even under force, and carries no hint', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', { type: 'flex-section' });
    d.apply(sec.patches);
    const err = (() => { try { setKeys(d, sec.ids[0], { globalId: 'g1' }, { namespace: 'specials', ...forced() }); } catch (e) { return (e as Error).message; } })();
    expect(err).toMatch(/stamp the SERVER writes/);
    expect(err).not.toContain(FORCE_HINT);
    expect(() => addSubtree(d, 'ROOT', { type: 'flex-section', specials: { appBlockId: 'x' } }, undefined, forced())).toThrow(/stamp the SERVER writes/);
  });

  it('a node moved into its own subtree is refused even under force', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'flex-block' }] });
    d.apply(sec.patches);
    expect(() => moveNode(d, sec.ids[0], sec.ids[1], 0, forced())).toThrow();
  });

  it('specials with a state is refused even under force', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', { type: 'flex-section' });
    d.apply(sec.patches);
    expect(() => setKeys(d, sec.ids[0], { text: 'x' }, { namespace: 'specials', state: 'hover', ...forced() })).toThrow(/takes no interaction state/);
  });
});
```

Notes for the implementer: the exact wording matched above (`root-only`, `FIRST child`, `cannot pin`, `hidden`, `stamp the SERVER writes`, `takes no interaction state`, `cannot remove ROOT`) is copied from the existing guard messages in `builder.ts`, `traps.ts`, `sticky.ts` and `hover.ts`; do not reword those. If `list-dataset`'s `childAllows` does not accept `dataset-block`, read `ELEMENTS['list-dataset'].childAllows` in `src/catalog/elements.generated.ts` and use the first allowed container type instead, in both spec lines of that test. If `revealOnHover` is spelled differently, read `REVEAL_ON_HOVER` in `src/domains/site/hover.ts`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run test/force.test.ts`
Expected: FAIL on the first `expect(...).toThrow(FORCE_HINT)` (no hint yet) and TypeScript errors on the extra arguments.

- [ ] **Step 3: Thread the guard through `builder.ts`**

At the top of `src/domains/site/builder.ts`:

```ts
import { soft, type GuardOpts } from './guard.js';
```

`requireAllowed`: split the hard and soft halves.

```ts
function requireAllowed(parentType: string, childType: string, g?: GuardOpts): void {
  const child = ELEMENTS[childType];
  if (!child) {
    // HARD: there is nothing to write.
    throw new Error(
      `sbuilder: unknown element "${childType}". Use sb_catalog_search to find a real one.`,
    );
  }
  soft(g, () => {
    if (child.isRootOnly && parentType !== 'root') {
      throw new Error(
        `sbuilder: ${childType} is root-only — it may only be a direct child of ROOT, not of a ${parentType}.`,
      );
    }
    const allows = ELEMENTS[parentType]?.childAllows ?? [];
    if (allows.length > 0 && !allows.includes(childType)) {
      throw new Error(`sbuilder: a ${parentType} accepts only [${allows.join(', ')}], not ${childType}.`);
    }
  });
}
```

`addSubtree`: add `guard?: GuardOpts` after `index`, and change the four guard lines to:

```ts
  const parent = doc.node(parentId);
  soft(guard, () => refuseAppBlockParent(doc, parentId, 'adding'));
  requireContainer(parent.data.type, parentId);            // hard
  requireAllowed(parent.data.type, spec.type, guard);
  soft(guard, () => refuseSecondTemplate(doc.doc, parentId, 'Adding'));
```

`addSubtree` recurses for children — find the recursive call(s) inside it (they build nested nodes; grep `requireAllowed(` inside the function body) and pass `guard` through each one. `refuseComposedStamp(s.specials)` stays a direct call.

`setKeys`: add `force?: boolean; forced?: string[];` to the `opts` type, and inside the body `const g: GuardOpts = { force: opts.force, forced: opts.forced };`. Then:

```ts
  soft(g, () => refuseAppBlockInterior(doc, id, 'writing'));
  ...
  if (namespace === 'config') {
    soft(g, () => refuseStuckAfter(doc.doc, id, keys));
    soft(g, () => refuseReveal(doc.doc, id, keys));
  }
  ...
  if (namespace === 'specials') {
    refuseComposedStamp(keys);                               // hard, unchanged
    if (opts.state) { throw ... }                            // hard, unchanged
  ...
    if (opts.state === STUCK_STATE && Object.keys(keys).length) {
      soft(g, () => requireStuckHost(doc.doc, id));
      if (namespace === 'config') soft(g, () => refuseStuckConfig(keys));
    }
    if (opts.state === PARENT_HOVER_STATE && Object.keys(keys).length) {
      soft(g, () => requireHoverHost(doc.doc, id));
    }
    if ((opts.state === HOVER_STATE || opts.state === PARENT_HOVER_STATE) && namespace === 'config' && Object.keys(keys).length) {
      soft(g, () => refuseHoverConfig(keys, opts.state));
    }
```

`SetEdit` gains nothing; `setMany(doc, edits, guard?: GuardOpts)` passes `force: guard?.force, forced: guard?.forced` into each `setKeys` opts.

`duplicateNode(doc, id, guard?)`:

```ts
  if (id === doc.doc.root_node_id) throw new Error('sbuilder: cannot duplicate ROOT');   // hard
  refuseOverlay(doc, id, 'duplicating');                                                 // hard
  soft(guard, () => refuseAppBlockInterior(doc, id, 'duplicating'));
  // blockInside check stays hard, unchanged
  ...
  soft(guard, () => refuseSecondTemplate(doc.doc, parentId, 'Duplicating into'));
```

`moveNode(doc, id, newParentId, index, guard?)`:

```ts
  refuseOverlay(doc, id, 'moving');                                     // hard
  soft(guard, () => refuseAppBlockInterior(doc, id, 'moving'));
  const newParent = doc.node(newParentId);
  soft(guard, () => refuseAppBlockParent(doc, newParentId, 'moving'));
  // the cycle check stays hard, unchanged
  // the type rules: requireContainer stays hard; requireAllowed(newParent.data.type, n.data.type, guard)
  if (n.data.parent !== newParentId) soft(guard, () => refuseSecondTemplate(doc.doc, newParentId, 'Moving'));
```

`removeNode(doc, id, guard?)`:

```ts
  if (id === doc.doc.root_node_id) throw new Error('sbuilder: cannot remove ROOT');      // hard
  refuseOverlay(doc, id, 'removing');                                                    // hard
  soft(guard, () => refuseAppBlockInterior(doc, id, 'removing'));
```

- [ ] **Step 4: Thread it through `live.ts`**

```ts
import { soft, type GuardOpts } from '../domains/site/guard.js';

export function bindNode(doc, id, source, field, action?, guard?: GuardOpts): Patch[] {
  const node = ...;
  soft(guard, () => refuseAppBlockInterior(doc, id, 'binding'));
  ...

export function setEvent(doc, id, trigger, action, payload?, guard?: GuardOpts): Patch[] {
  const node = ...;
  soft(guard, () => refuseAppBlockInterior(doc, id, 'setting an event on'));
```

- [ ] **Step 5: Run the new tests and the whole suite**

Run: `npx vitest run test/force.test.ts test/traps.test.ts test/builder.test.ts`
Expected: all pass. The pre-existing `toThrow(/app block/i)` assertions still match because the suffix is appended, not substituted.

Run: `npm test`
Expected: green. If any existing test asserted an EXACT message ending (`toThrow('…children.')`) on a soft guard, that test is asserting a message, not a behaviour: extend its expected string with `FORCE_HINT` and note it in the commit body.

- [ ] **Step 6: Commit**

```bash
git add src/domains/site/builder.ts src/tools/live.ts test/force.test.ts
git commit -m "feat(builder): render-inference guards yield to force; the platform's own invariants do not

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `force` on the seven tools

**Files:**
- Modify: `src/tools/page.ts` — `sb_add` (690-735), `sb_set` (736-1032), `sb_move` (1034-1054), `sb_remove` (1056-1089), `sb_duplicate` (1128-1145)
- Modify: `src/tools/live.ts` — `sb_event` (693-716), `sb_bind` (718-750)
- Test: `test/page-tools.test.ts` (append; it already drives registered tools against a fake fetch — read its top 80 lines for the harness before writing)

**Interfaces:**
- Consumes: Task 2's signatures.
- Produces: every one of the seven tools accepts `force?: boolean` and, when the builder recorded overrides, answers with `forced: string[]` in both the dry run and the real run.

- [ ] **Step 1: Write the failing test**

`test/page-tools.test.ts` already drives registered tools through `connectedClient({ fetchImpl, session })` from `test/harness.ts` and `client.callTool({ name, arguments })`. Add this helper beside its existing `scripted()` / `ctxWith()` helpers — it serves a page whose document already holds a composed app block, built the way `test/traps.test.ts`'s `withAppBlock()` builds one — then the tests:

```ts
import { addSubtree } from '../src/domains/site/builder.js';
import { SPEC_APP_BLOCK_ID } from '../src/core/tree.js';

function appBlockDocument() {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const first = addSubtree(d, 'ROOT', {
    type: 'flex-section',
    children: [{ type: 'flex-block', children: [{ type: 'heading' }] }],
  });
  d.apply(first.patches);
  // The COMPOSED stamp, applied the way the server applies it — by patch.
  d.apply([{ op: 'set', path: ['nodes', first.ids[1], 'specials', SPEC_APP_BLOCK_ID], value: 'inst_1/hero' }]);
  d.apply(addSubtree(d, 'ROOT', { type: 'flex-section' }).patches);
  return { document: d.doc, ids: { section: first.ids[0], block: first.ids[1], inner: first.ids[2] } };
}

async function openPageWithAppBlock() {
  const { document, ids } = appBlockDocument();
  const f = vi.fn(async () =>
    new Response(
      JSON.stringify({ source: { pageId: 'pg_1', siteId: 's1', document, schemaVersion: 2, updatedAt: 'now' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  ) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  (session as unknown as { access: string }).access = 'jwt';
  const { client, close } = await connectedClient({ fetchImpl: f, session });
  await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
  // The MCP SDK reports a thrown tool error as `isError` rather than rejecting,
  // so the wrapper rethrows: the tests below say `rejects.toThrow`.
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{ text?: string }>;
    };
    const textOut = res.content.map((c) => c.text ?? '').join('');
    if (res.isError) throw new Error(textOut);
    return JSON.parse(textOut) as Record<string, any>;
  };
  return { call, ids, close };
}

describe('force on the writing tools', () => {
  it('sb_set inside an app block: refused without force, reported with it, in the dry run and the real run', async () => {
    const { call, ids } = await openPageWithAppBlock();
    await expect(call('sb_set', { id: ids.inner, namespace: 'specials', keys: { text: 'x' } })).rejects.toThrow(/force:true/);
    const dry = await call('sb_set', { id: ids.inner, namespace: 'specials', keys: { text: 'x' }, force: true });
    expect(dry.dry_run).toBe(true);
    expect(dry.forced[0]).toMatch(/app block/i);
    const real = await call('sb_set', { id: ids.inner, namespace: 'specials', keys: { text: 'x' }, force: true, dry_run: false });
    expect(real.set).toEqual(['text']);
    expect(real.forced[0]).toMatch(/app block/i);
  });

  it('sb_remove dry run carries forced beside removing and patches', async () => {
    const { call, ids } = await openPageWithAppBlock();
    const dry = await call('sb_remove', { id: ids.inner, force: true });
    expect(dry).toMatchObject({ dry_run: true, removing: 1 });
    expect(dry.forced[0]).toMatch(/app block/i);
  });

  it('a hard guard is unchanged by force at the tool', async () => {
    const { call } = await openPageWithAppBlock();
    await expect(call('sb_remove', { id: 'ROOT', force: true, dry_run: false })).rejects.toThrow(/cannot remove ROOT/);
  });

  it('no forced field when nothing was overridden', async () => {
    const { call, ids } = await openPageWithAppBlock();
    const dry = await call('sb_set', { id: ids.section, namespace: 'style', keys: { color: 'red' }, force: true });
    expect(dry.forced).toBeUndefined();
  });
});
```

Call `close()` at the end of each test, as the file's other tests do.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/page-tools.test.ts -t "force on the writing tools"`
Expected: FAIL — zod rejects the unknown `force` key, or `forced` is undefined.

- [ ] **Step 3: Implement in `page.ts`**

Every handler follows one shape. `sb_add`:

```ts
      force: z.boolean().optional().describe('Override a render-inference guard; the override is reported as forced'),
    ...
    async ({ parent_id, spec, index, dry_run, force }) => {
      const d = session.current();
      const guard: GuardOpts = { force, forced: [] };
      const { patches, ids } = addSubtree(d, parent_id, spec, index, guard);
      const forced = guard.forced!.length ? { forced: guard.forced } : {};
      ...
      if (dry_run !== false) {
        return text({ dry_run: true, would_add: ids.length, patches: patches.length, ...(inert ? { inert } : {}), ...forced });
      }
      await session.applyAndSave(patches);
      return text({ added: ids, rev: d.rev, ...(inert ? { inert } : {}), ...forced });
```

`sb_set`: add `force` to the schema and the destructured args; `const guard: GuardOpts = { force, forced: [] }; const { patches, touched } = setMany(d, batch, guard); const forced = guard.forced!.length ? { forced: guard.forced } : {};` and spread `...forced` into all three `text({...})` returns (dry run, single, batch).

`sb_move`, `sb_remove`, `sb_duplicate`: same pattern — `force` in the schema, `guard` built, passed as the last argument, `...forced` spread into both returns. For `sb_remove` the dry-run object becomes `{ dry_run: true, removing: nodes, patches: patches.length, ...forced }`.

Import `type GuardOpts` from `'../domains/site/guard.js'` in `page.ts`.

- [ ] **Step 4: Implement in `live.ts`**

`sb_event` and `sb_bind`: add `force: z.boolean().optional()` to each schema, destructure it, build `guard`, pass it as the last argument to `setEvent` / `bindNode`, spread `...forced` into both returns of each.

- [ ] **Step 5: Run the tests and the gate**

Run: `npx vitest run test/page-tools.test.ts && npm run build && npm test && npm run smoke`
Expected: green, `ALL GOOD`.

If `test/token-budget.test.ts` fails on `tools/list` (24,500): seven `force` entries at ~110 characters each is ~800 characters. Raise the ceiling to the measurement plus 1,500 and write in the comment: "raised for `force` on the seven writing tools — <measured> measured on <date>". Shorten the `describe()` string to `'Override a render-inference guard; reported as forced'` first if that alone brings it under.

- [ ] **Step 6: Commit**

```bash
git add src/tools/page.ts src/tools/live.ts test/page-tools.test.ts test/token-budget.test.ts
git commit -m "feat(tools): force on sb_add, sb_set, sb_move, sb_remove, sb_duplicate, sb_bind and sb_event

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Document `force`

**Files:**
- Modify: `docs/tools.md` — `## What every write checks before it saves` (line 310) and the parameter tables under `sb_add` (248), `sb_set` (267), `sb_move` / `sb_remove` (302), `sb_duplicate` (589), `sb_event` (446), `sb_bind` (477)
- Modify: `docs/tools.vi.md` — the same sections (`sb_add` 249, `sb_set` 268, `sb_move` / `sb_remove` 303, `sb_duplicate` 571; find `sb_event`, `sb_bind` and the "what every write checks" heading by grep)

**Interfaces:** none.

- [ ] **Step 1: One table row on each of the seven tools, English**

`| \`force\` | boolean? | Override a soft guard; the message is returned as \`forced[]\` instead of thrown. Hard guards ignore it — see "What every write checks" |`

- [ ] **Step 2: The rule, English**

Under `## What every write checks before it saves`, append:

```markdown
### `force`, and which guards yield to it

A guard here is one of two kinds. A **soft** guard asserts what a renderer does — "this key
compiles to nothing", "this element takes no such child", "this repeater renders only its
first child" — against the catalog's copy of the platform, which can be older than the
deployment you are writing to. Its refusal ends with `Pass force:true to write anyway.`, and
with `force:true` the write goes through and the message comes back as `forced: [...]`, in
the dry run too. Soft: the app-block interior and parent checks, `childAllows` and root-only,
the second template under `list-dataset`, and the stuck / stuck-after / reveal / hover-config
/ hover-host checks.

A **hard** guard protects an invariant the platform itself enforces or a write with no way
back, and `force` never reaches it: band order (the platform refuses the save), a composed
stamp (`globalId` / `appBlockId` empties the master on every page), removing or duplicating
ROOT, an unknown element type, the overlay root (stripped on write, so the forced write would
be a no-op reported as done), a node moved into its own subtree, and `specials` with a state.
A hard refusal carries no `force` hint, which is how you tell them apart without trying.
```

- [ ] **Step 3: Vietnamese**

The same row on each of the seven tools:

`| \`force\` | boolean? | Bỏ qua một guard mềm; thông điệp được trả về trong \`forced[]\` thay vì ném lỗi. Guard cứng bỏ qua tham số này — xem "Mỗi lần ghi kiểm tra gì" |`

And under the Vietnamese equivalent of "What every write checks before it saves":

```markdown
### `force`, và guard nào nhường nó

Guard ở đây có hai loại. Guard **mềm** khẳng định renderer làm gì — "key này biên dịch ra
không gì cả", "phần tử này không nhận con như vậy", "repeater này chỉ render con đầu tiên" —
dựa trên bản sao platform trong catalog, vốn có thể cũ hơn deployment bạn đang ghi vào. Lời
từ chối của nó kết thúc bằng `Pass force:true to write anyway.`, và với `force:true` lệnh
ghi vẫn đi, thông điệp quay về trong `forced: [...]`, cả ở dry run. Mềm: kiểm tra bên trong
và cha của app block, `childAllows` và root-only, template thứ hai dưới `list-dataset`, và
các kiểm tra stuck / stuck-after / reveal / hover-config / hover-host.

Guard **cứng** bảo vệ một bất biến chính platform thực thi hoặc một lệnh ghi không có đường
lùi, và `force` không bao giờ chạm tới: thứ tự band (platform từ chối save), stamp đã compose
(`globalId` / `appBlockId` làm trống master trên mọi trang), xoá hoặc nhân bản ROOT, loại
phần tử không tồn tại, root của overlay (bị bỏ khi ghi, nên lệnh ghi bị ép sẽ là no-op được
báo là xong), node chuyển vào chính cây con của nó, và `specials` kèm state. Lời từ chối cứng
không mang gợi ý `force`, đó là cách phân biệt mà không cần thử.
```

- [ ] **Step 4: Gate and commit**

Run: `npm run build && npm test && npm run smoke`

```bash
git add docs/tools.md docs/tools.vi.md
git commit -m "docs(tools): force, and the soft/hard guard split, in both languages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
