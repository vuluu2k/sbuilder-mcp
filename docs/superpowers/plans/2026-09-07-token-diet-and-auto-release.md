# Token diet, platform catch-up, and auto-release — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut what each tool call costs an agent in tokens without removing a capability, ship the current platform (106 elements / 412 operations / app blocks), and make a release a push to `main`.

**Architecture:** Shapes change at three layers. Pure helpers in `src/catalog/`, `src/domains/site/`, `src/vision/` produce the compact shapes and are unit-tested directly; the tool layer in `src/tools/*.ts` spreads them and gains MCP annotations; one new `Notices` object on `ToolContext` says each directive once per process. The release is a GitHub workflow copied from `webcake-landing-mcp` and adapted (Node 22, `npm test` in the gate, `main`).

**Tech Stack:** TypeScript (ESM / Node16 module resolution, `.js` on every relative import), `@modelcontextprotocol/sdk` 1.30, `zod` 3, `vitest` 3, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-07-token-diet-and-auto-release-design.md`

## Global Constraints

- Node ≥ 22. Every relative import ends in `.js`, including from `.ts`.
- Every tool answers through `text()` / `image()` / `images()` from `src/mcp/response.ts`. All logging is `console.error`. Never `console.log`.
- Mutating tools take `dry_run` defaulting to `true`. Nothing in this plan changes that.
- `src/catalog/*.generated.ts` is generated; never hand-edit. It was regenerated and committed in `994f941`.
- Counts in code come from `ELEMENT_SOURCE.count`, `SWAGGER_SOURCE.operations`, `BINDING_SOURCES.length` — never literals.
- The gate for every task: `npm run build && npm test && npm run smoke` must print `ALL GOOD`.
- Commit subjects follow the repo's style: `type(scope): what the change means`, and end with the trailer below.

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Bt8Sxm1wwSZ3xgEEtvTRzW
```

## File map

| File | Change |
| --- | --- |
| `src/mcp/response.ts` | `text()` compact |
| `src/mcp/notices.ts` (new) | `Notices.once(key, text)` |
| `src/tools/context.ts` | `notices: Notices` on `ToolContext` |
| `src/server.ts` | build `Notices`; new `INSTRUCTIONS` |
| `src/domains/site/findings.ts` (new) | `FIX` templates, `fill()`, `compactFindings()` |
| `src/domains/site/review.ts` | findings built from templates; skip app-block interiors |
| `src/vision/measure.ts` | findings built from templates |
| `src/catalog/search.ts` | `summarizeOperation()` |
| `src/catalog/element-search.ts` (new) | `catalogMatches()`, `traitsFor()` (moved out of `page.ts`) |
| `src/vision/boxes.ts` (new) | `boxesForResponse()` → tuples at depth |
| `src/tools/project.ts` (new) | `projectList()` whitelist projection |
| `src/core/tree.ts` | app-block stamps, `appBlockRoot()` |
| `src/domains/site/document.ts` | `app: true` in outline |
| `src/domains/site/builder.ts` | `refuseAppBlockInterior()` on every write |
| `src/transport/http.ts` | `ApiError.details` / `.fields` |
| `src/tools/{session,api,page,live}.ts` | `registerTool` + annotations; new args; compact shapes |
| `test/*.test.ts` | as listed per task; new `notices`, `findings`, `element-search`, `boxes`, `project`, `annotations`, `token-budget` |
| `.github/workflows/auto-release.yml` (new), `CHANGELOG.md`, `CHANGELOG.vi.md` (new), `scripts/release.mjs`, `package.json` | release |
| `docs/tools.md`, `docs/tools.vi.md`, `README.md`, `README.vi.md`, `CLAUDE.md` | docs |

---

### Task 1: `text()` stops pretty-printing

**Files:**
- Modify: `src/mcp/response.ts:9`
- Test: `test/response.test.ts`

**Interfaces:** unchanged signature `text(value: unknown)`.

- [ ] **Step 1: Change the test**

Replace the second test in `test/response.test.ts`:

```ts
  it('serialises a non-string compactly — the reader is a model, and indentation is 15 % of nothing', () => {
    expect(text({ a: 1, b: [1, 2] })).toEqual({ content: [{ type: 'text', text: '{"a":1,"b":[1,2]}' }] });
  });
```

- [ ] **Step 2: Run it, expect FAIL** — `npx vitest run test/response.test.ts`

- [ ] **Step 3: Implement** in `src/mcp/response.ts`: the three `JSON.stringify(x, null, 2)` calls become `JSON.stringify(x)`. Update the header comment: "Compact, not pretty: the reader is a model, and a 2-space indent was measured at 15 % of every structured result."

- [ ] **Step 4: Run the full suite** — `npm test`. Any test that asserted on indented text fails here; fix it to compare parsed JSON (`JSON.parse(res.content[0].text)`) rather than the string.

- [ ] **Step 5: Commit** — `perf(response): compact JSON — the reader is a model`

---

### Task 2: Notices are said once per process

**Files:**
- Create: `src/mcp/notices.ts`
- Modify: `src/tools/context.ts`, `src/server.ts:buildContext`
- Test: `test/notices.test.ts`; every test that builds a `ToolContext` literal (`test/page-tools.test.ts:ctxWith`, `test/connect.test.ts:ctx`, `test/api-call.test.ts`, `test/media.test.ts`, `test/live-tools.test.ts` if it builds one) gains `notices: new Notices()`.

**Interfaces:**
- Produces: `class Notices { once(key: string, body: string): string | undefined; reset(): void }`.
- `ToolContext.notices: Notices` (required).

- [ ] **Step 1: Write the failing test** `test/notices.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { Notices } from '../src/mcp/notices.js';

describe('Notices.once()', () => {
  it('returns the text the first time and undefined after', () => {
    const n = new Notices();
    expect(n.once('review', 'FIX THESE')).toBe('FIX THESE');
    expect(n.once('review', 'FIX THESE')).toBeUndefined();
  });

  it('keys are independent', () => {
    const n = new Notices();
    n.once('a', 'x');
    expect(n.once('b', 'y')).toBe('y');
  });

  it('reset() lets a directive be said again', () => {
    const n = new Notices();
    n.once('a', 'x');
    n.reset();
    expect(n.once('a', 'x')).toBe('x');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (module not found).

- [ ] **Step 3: Implement** `src/mcp/notices.ts`

```ts
/**
 * A directive is said ONCE per process.
 *
 * REVIEW_NOTICE, RESPONSIVE_NOTICE and MEASURE_NOTICE are instructions, not
 * data, and an instruction repeated on every call is skimmed by the third one.
 * Measured: three notices at ~300 chars each rode along on most page results.
 * Each is returned the first time a tool asks for it and never again, so the
 * result field is simply absent afterwards. `reset()` exists for tests.
 */
export class Notices {
  private readonly said = new Set<string>();

  once(key: string, body: string): string | undefined {
    if (this.said.has(key)) return undefined;
    this.said.add(key);
    return body;
  }

  reset(): void {
    this.said.clear();
  }
}
```

- [ ] **Step 4: Thread it.** In `src/tools/context.ts` add `import { Notices } from '../mcp/notices.js';` and the field `notices: Notices;` with the comment "Directives said once per process — see notices.ts." In `src/server.ts:buildContext` return `{ base, session: new Session(base), apiKey: process.env.SB_TOKEN, notices: new Notices() }`. Fix every test context literal (`npm run build` lists them as type errors).

- [ ] **Step 5: Gate, then commit** — `feat(mcp): a directive is said once per process`

---

### Task 3: Findings carry their fix as a legend

**Files:**
- Create: `src/domains/site/findings.ts`
- Modify: `src/domains/site/review.ts`, `src/vision/measure.ts`
- Test: `test/findings.test.ts`; `test/review.test.ts` and `test/measure.test.ts` keep passing unchanged (the per-finding `fix` still exists at the domain layer).

**Interfaces:**
- Produces: `FIX: Record<string, string>` (code → template with `<id>`, `<key>`, `<other>` placeholders); `fill(code: string, vars: Record<string, string>): string`; `compactFindings<T extends { code: string; fix: string }>(items: T[]): { findings: Array<Omit<T, 'fix'>>; fixes: Record<string, string> }`.

- [ ] **Step 1: Write the failing test** `test/findings.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { FIX, fill, compactFindings } from '../src/domains/site/findings.js';

describe('findings', () => {
  it('fill() substitutes every placeholder', () => {
    expect(fill('empty_text', { id: 'tx_1', key: 'text' })).toBe(
      FIX.empty_text.replace('<id>', 'tx_1').replace('<key>', 'text'),
    );
    expect(fill('empty_text', { id: 'tx_1', key: 'text' })).not.toContain('<');
  });

  it('compactFindings() drops fix from each item and emits one template per code present', () => {
    const items = [
      { code: 'empty_text', nodeId: 'a', fix: 'x' },
      { code: 'empty_text', nodeId: 'b', fix: 'y' },
      { code: 'overlap', nodeId: 'c', fix: 'z' },
    ];
    const out = compactFindings(items);
    expect(out.findings.map((f) => 'fix' in f)).toEqual([false, false, false]);
    expect(Object.keys(out.fixes).sort()).toEqual(['empty_text', 'overlap']);
    expect(out.fixes.empty_text).toBe(FIX.empty_text);
  });

  it('every template used by review and measure exists', () => {
    for (const code of [
      'empty_page', 'unknown_element', 'empty_container', 'empty_text', 'missing_media',
      'placeholder_content', 'dead_binding_source', 'dead_binding_field',
      'off_canvas', 'text_too_small', 'overlap',
    ]) expect(FIX[code], code).toBeTypeOf('string');
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/domains/site/findings.ts`

```ts
import { BINDING_SOURCES } from '../../catalog/elements.generated.js';

/**
 * One fix per KIND of finding, as a template.
 *
 * A page with twenty placeholders used to carry twenty copies of the same
 * sentence with a different id in each — ~270 chars a finding, measured. The
 * tool layer now sends each template once, under `fixes`, and every finding
 * keeps only what the template needs: its `nodeId`, and `key` where a key
 * matters. The domain layer still fills the template into `fix` so a caller
 * reading one finding in isolation (a test, a log) sees the whole sentence.
 */
export const FIX: Record<string, string> = {
  empty_page:
    'Add a section with sb_add (parent_id ROOT, type flex-section), or drop a designed one in with sb_template_use.',
  unknown_element:
    'Regenerate the catalog (npm run codegen against a current web_builder checkout). If the element was removed from the platform, delete the node with sb_remove.',
  empty_container: 'Add something inside it (sb_add with parent_id "<id>"), or remove it with sb_remove.',
  empty_text: 'Set it: sb_set id "<id>", namespace specials, keys { "<key>": … }.',
  missing_media: 'Set it: sb_set id "<id>", namespace specials, keys { "<key>": … }.',
  placeholder_content: 'Write the real copy: sb_set id "<id>", namespace specials, keys { "<key>": … }.',
  dead_binding_source: `Rebind with sb_bind using one of: ${BINDING_SOURCES.join(', ')}.`,
  dead_binding_field: 'Rebind with sb_bind and a field of the form "specials.<key>".',
  off_canvas:
    'Give it a width that can shrink — sb_set id "<id>", namespace style, keys { "maxWidth": "100%" } at this breakpoint.',
  text_too_small:
    'Raise it for this breakpoint: sb_set id "<id>", namespace style, keys { "fontSize": "16px" }.',
  overlap:
    'Check the two for a fixed height or a negative margin at this breakpoint; sb_look with node_id on each shows which one is out of place.',
};

export function fill(code: string, vars: Record<string, string>): string {
  let s = FIX[code] ?? '';
  for (const [k, v] of Object.entries(vars)) s = s.split(`<${k}>`).join(v);
  return s;
}

export function compactFindings<T extends { code: string; fix: string }>(
  items: T[],
): { findings: Array<Omit<T, 'fix'>>; fixes: Record<string, string> } {
  const fixes: Record<string, string> = {};
  const findings = items.map((it) => {
    const { fix, ...rest } = it;
    void fix;
    if (FIX[it.code] && !fixes[it.code]) fixes[it.code] = FIX[it.code];
    return rest;
  });
  return { findings, fixes };
}
```

Note `dead_binding_field`'s template keeps the literal `"specials.<key>"` — `fill` is only called with `id`/`key` where a key exists, and this template is never filled with a `key`, so the placeholder reads as documentation. Add that sentence as a comment above it.

- [ ] **Step 4: Rewire `review.ts`.** Import `{ fill }`. Add `key?: string` to `Finding`. Replace each literal `fix:` with `fill(code, { id, key })` and split the two `dead_binding` pushes into codes `dead_binding_source` and `dead_binding_field`. Keep `nodeId`, `type`, `problem`. For `empty_text` / `missing_media` / `placeholder_content` also set `key`.

- [ ] **Step 5: Rewire `measure.ts`.** Import `{ fill } from '../domains/site/findings.js'`. Replace the three `fix:` literals with `fill('off_canvas', { id: b.id })`, `fill('text_too_small', { id: b.id })`, `fill('overlap', { id: a.id })`.

- [ ] **Step 6: Gate** — `review.test.ts` and `measure.test.ts` still pass because `fix` still names the node. Commit — `refactor(findings): one fix template per kind`

(The tool layer starts emitting `fixes` in Task 8.)

---

### Task 4: `sb_api_find` — a list, then one call sheet

**Files:**
- Modify: `src/catalog/search.ts`, `src/tools/api.ts`
- Test: `test/api-search.test.ts`, `test/api-tools.test.ts` (new, exercises the tool callback through `createServer` — see Task 11's harness; until then test the pure helpers)

**Interfaces:**
- Produces: `summarizeOperation(op: ApiOperation): { id, method, path, summary, credential, params: string[], body?: 'described' | 'undescribed' | 'none_declared' }`; `findOperation(id: string): ApiOperation | undefined`; `DEFAULT_FIND_LIMIT = 8`.

- [ ] **Step 1: Failing tests** — append to `test/api-search.test.ts`

```ts
import { summarizeOperation, findOperation } from '../src/catalog/search.js';

describe('summarizeOperation()', () => {
  it('names params with ? on optional ones and never inlines a schema', () => {
    const op = searchOperations('media', { limit: 50 }).find((o) => o.path.endsWith('/media') && o.method === 'GET')!;
    const s = summarizeOperation(op);
    expect(s.params).toContain('siteId');
    expect(s.params.some((p) => p.startsWith('?'))).toBe(true);
    expect('body_schema' in s).toBe(false);
    expect(JSON.stringify(s).length).toBeLessThan(400);
  });

  it('gives the three body verdicts as one word', () => {
    const put = searchOperations('source', { limit: 50 }).find((o) => o.method === 'PUT' && o.path.endsWith('/source'))!;
    expect(summarizeOperation(put).body).toBe('none_declared');
    const described = searchOperations('', { limit: 500 }).find((o) => o.bodyDescribed)!;
    expect(summarizeOperation(described).body).toBe('described');
    const loose = searchOperations('', { limit: 500 }).find((o) => o.params.some((p) => p.in === 'body') && !o.bodyDescribed)!;
    expect(summarizeOperation(loose).body).toBe('undescribed');
  });

  it('omits body on a GET', () => {
    const get = searchOperations('', { limit: 500 }).find((o) => o.method === 'GET')!;
    expect(summarizeOperation(get).body).toBeUndefined();
  });
});

describe('findOperation()', () => {
  it('returns the operation by id, or undefined', () => {
    expect(findOperation('get:/api/sites')?.method).toBe('GET');
    expect(findOperation('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** in `src/catalog/search.ts`

```ts
export const DEFAULT_FIND_LIMIT = 8;
// in searchOperations: const limit = opts.limit ?? DEFAULT_FIND_LIMIT;

export function findOperation(id: string): ApiOperation | undefined {
  return API_OPERATIONS.find((o) => o.id === id);
}

/**
 * One LINE per match — what an agent needs to choose, not to call.
 *
 * `describeOperation` inlined the whole body definition for every hit, so a
 * "list orders" search cost ~44 KB for twelve operations the agent would call
 * one of. The schema now arrives with `sb_api_find id:` once the choice is made.
 * `body` is the three-way verdict as one word; the full wording lives in the
 * call sheet, where it is read at the moment it matters.
 */
export function summarizeOperation(op: ApiOperation): {
  id: string; method: string; path: string; summary: string; credential: string;
  params: string[]; body?: 'described' | 'undescribed' | 'none_declared';
} {
  const hasBody = op.params.some((p) => p.in === 'body');
  const isWrite = op.method === 'POST' || op.method === 'PUT' || op.method === 'PATCH';
  const out = {
    id: op.id, method: op.method, path: op.path, summary: op.summary, credential: op.credential,
    params: op.params.filter((p) => p.in !== 'body').map((p) => (p.required ? p.name : `?${p.name}`)),
  } as ReturnType<typeof summarizeOperation>;
  if (hasBody) out.body = op.bodyDescribed && op.bodyRef ? 'described' : 'undescribed';
  else if (isWrite) out.body = 'none_declared';
  return out;
}
```

- [ ] **Step 4: Rewire the tool** in `src/tools/api.ts`. Description: `'Find platform API operations by intent (query), or read ONE operation\'s full call sheet (id). The list is one line per match; the call sheet carries parameter types, the credential, and either the body schema or an explicit warning that the platform does not describe it. Reaches all ${SWAGGER_SOURCE.operations} operations.'` (import `SWAGGER_SOURCE` from `../catalog/api.generated.js`). Schema: `query: z.string().optional()`, `id: z.string().optional().describe('Operation id from a previous search — returns the full call sheet')`, `tag`, `limit`. Callback:

```ts
async ({ query, id, tag, limit }) => {
  if (id) {
    const op = findOperation(id);
    if (!op) throw new Error(`sbuilder: unknown operation "${id}" — search with query first`);
    return text(describeOperation(op));
  }
  if (!query) throw new Error('sbuilder: sb_api_find needs a query (search) or an id (call sheet)');
  const matches = searchOperations(query, { tag, limit }).map(summarizeOperation);
  return text({
    matches,
    next: matches.length ? 'Pass one id back to sb_api_find for its call sheet before calling it.' : 'No match — try other words, or a tag.',
  });
}
```

- [ ] **Step 5: Gate, commit** — `perf(api): sb_api_find lists one line per match and hands out a call sheet by id`

---

### Task 5: `sb_catalog_search` and `sb_traits_for` get compact defaults

**Files:**
- Create: `src/catalog/element-search.ts`
- Modify: `src/tools/page.ts` (the two tools call the helpers; `describeControl` and `STYLE_NOTE` move to the new file)
- Test: `test/element-search.test.ts`

**Interfaces:**
- Produces: `catalogMatches(query: string, opts?: { limit?: number; detail?: boolean }): CatalogMatch[]`; `traitsFor(type: string, control?: string): Record<string, unknown>`; `DEFAULT_CATALOG_LIMIT = 8`.

- [ ] **Step 1: Failing test** `test/element-search.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { catalogMatches, traitsFor } from '../src/catalog/element-search.js';

describe('catalogMatches()', () => {
  it('returns four fields per match by default, flags only when true', () => {
    const m = catalogMatches('heading');
    expect(m.length).toBeGreaterThan(0);
    for (const x of m) {
      expect(Object.keys(x).filter((k) => !['isContainer', 'isRootOnly'].includes(k)).sort()).toEqual(
        ['category', 'description', 'label', 'type'],
      );
      if ('isContainer' in x) expect(x.isContainer).toBe(true);
    }
    expect(m.length).toBeLessThanOrEqual(8);
  });

  it('detail:true adds the AI hints', () => {
    const [x] = catalogMatches('heading', { detail: true });
    expect(Array.isArray(x.useWhen)).toBe(true);
    expect(Array.isArray(x.contentTips)).toBe(true);
  });
});

describe('traitsFor()', () => {
  it('lists control NAMES and says the undeclared note once', () => {
    const t = traitsFor('list-dataset') as { inspector: Array<{ groups: Array<{ controls: string[] }> }>; declared: Record<string, unknown>; undeclared_note: string; hints: { useWhen: string[] } };
    expect(typeof t.inspector[0].groups[0].controls[0]).toBe('string');
    expect(typeof t.undeclared_note).toBe('string');
    expect(Array.isArray(t.hints.useWhen)).toBe(true);
    expect(JSON.stringify(t).length).toBeLessThan(12_000);
  });

  it('still describes one control in full', () => {
    const t = traitsFor('heading', 'font_size') as { control: string; writes?: unknown };
    expect(t.control).toBe('font_size');
  });

  it('names the tool to use on an unknown type', () => {
    expect(() => traitsFor('nope')).toThrow(/sb_catalog_search/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/catalog/element-search.ts` — move `describeControl` and `STYLE_NOTE` from `page.ts` here verbatim, then:

```ts
import { ELEMENTS, TRAIT_WRITES } from './elements.generated.js';

export const DEFAULT_CATALOG_LIMIT = 8;

export interface CatalogMatch {
  type: string; label: string; category: string; description: string;
  isContainer?: true; isRootOnly?: true;
  useWhen?: string[]; avoidWhen?: string[]; contentTips?: string[];
}

/** Four fields to CHOOSE by; the hints arrive with sb_traits_for once chosen, or with detail:true. */
export function catalogMatches(query: string, opts: { limit?: number; detail?: boolean } = {}): CatalogMatch[] {
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return Object.values(ELEMENTS)
    .map((el) => {
      const hay = [el.type, el.label, el.category, el.description, ...el.semantics, ...el.useWhen].join(' ').toLowerCase();
      return { el, score: terms.filter((t) => hay.includes(t)).length };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.el.type.localeCompare(b.el.type))
    .slice(0, opts.limit ?? DEFAULT_CATALOG_LIMIT)
    .map(({ el }) => ({
      type: el.type, label: el.label, category: el.category, description: el.description,
      ...(el.isContainer ? { isContainer: true as const } : {}),
      ...(el.isRootOnly ? { isRootOnly: true as const } : {}),
      ...(opts.detail ? { useWhen: el.useWhen, avoidWhen: el.avoidWhen, contentTips: el.contentTips } : {}),
    }));
}

const UNDECLARED_NOTE =
  'Controls not listed under `declared` build their write in a Vue widget the platform does not ' +
  'describe. Read a node that already uses one with sb_node_read, or set the CSS property ' +
  'directly — style is open. Pass control:"<name>" to read one control.';

/**
 * The inspector as NAMES, plus the declared writes in full.
 *
 * The old shape repeated a 150-char "undeclared" note under every one of the
 * 317 controls with no declared write target — list-dataset alone was 74 KB.
 * Now the note is said once, and the AI hints ride here because this is the
 * call an agent makes once it has chosen the element.
 */
export function traitsFor(type: string, control?: string): Record<string, unknown> {
  const el = ELEMENTS[type];
  if (!el) throw new Error(`sbuilder: unknown element "${type}" — use sb_catalog_search`);
  if (control) {
    if (!el.controls.includes(control)) {
      throw new Error(`sbuilder: ${type} has no control "${control}". It has: ${el.controls.join(', ')}.`);
    }
    return { type, control, ...describeControl(control) };
  }
  const declared: Record<string, unknown> = {};
  for (const c of el.controls) if (TRAIT_WRITES[c]) declared[c] = describeControl(c);
  return {
    type: el.type,
    hints: { useWhen: el.useWhen, avoidWhen: el.avoidWhen, contentTips: el.contentTips },
    inspector: el.inspector.map((t) => ({ tab: t.tab, groups: t.groups.map((g) => ({ group: g.label, controls: g.controls })) })),
    declared,
    defaults: el.defaults,
    isContainer: el.isContainer,
    isRootOnly: el.isRootOnly,
    childAllows: el.childAllows,
    undeclared_note: UNDECLARED_NOTE,
    style_is_open_css: STYLE_NOTE,
  };
}
```

- [ ] **Step 4: Rewire `page.ts`.** `sb_catalog_search` schema gains `detail: z.boolean().optional().describe('Include useWhen / avoidWhen / contentTips per match')`; callback `text(catalogMatches(query, { limit, detail }))`. Description: `"Find an element type by what you want it to do. Four fields per match; pass detail:true for the platform's AI hints, or read them with sb_traits_for once you have chosen."` `sb_traits_for` callback `text(traitsFor(type, control))`. Delete the moved code from `page.ts`.

- [ ] **Step 5: Gate, commit** — `perf(catalog): compact element search and inspector; hints move to the chosen element`

---

### Task 6: `sb_look` boxes as tuples near the top

**Files:**
- Create: `src/vision/boxes.ts`
- Modify: `src/tools/live.ts` (`sb_look`)
- Test: `test/boxes.test.ts`

**Interfaces:**
- Produces: `boxesForResponse(doc: DocLike, boxes: Box[], depth: number): BoxTuple[]` where `type BoxTuple = [string, string, number, number, number, number]`; `BOXES_FORMAT = 'boxes are [id, type, x, y, w, h] in CSS px at widths[0]; pass box_depth to see deeper nodes'`.

- [ ] **Step 1: Failing test** `test/boxes.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { boxesForResponse } from '../src/vision/boxes.js';

function doc() {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const { ids } = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'flex-box', children: [{ type: 'heading' }] }] });
  return { d, ids }; // ids[0] section (depth 1), ids[1] box (depth 2), ids[2] heading (depth 3)
}

describe('boxesForResponse()', () => {
  it('keeps nodes at depth <= the limit, as tuples', () => {
    const { d, ids } = doc();
    const boxes = ids.map((id, i) => ({ id, type: 't', x: i, y: 0, w: 10, h: 10 }));
    const out = boxesForResponse(d.doc, boxes, 2);
    expect(out.map((t) => t[0])).toEqual([ids[0], ids[1]]);
    expect(out[0]).toEqual([ids[0], 't', 0, 0, 10, 10]);
  });

  it('drops boxes for ids the document does not know (an overlay interior)', () => {
    const { d } = doc();
    expect(boxesForResponse(d.doc, [{ id: 'ghost', type: 't', x: 0, y: 0, w: 1, h: 1 }], 6)).toEqual([]);
  });

  it('keeps ROOT', () => {
    const { d } = doc();
    expect(boxesForResponse(d.doc, [{ id: 'ROOT', type: 'root', x: 0, y: 0, w: 1, h: 1 }], 1)[0][0]).toBe('ROOT');
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/vision/boxes.ts`

```ts
import { ancestors, type DocLike } from '../core/tree.js';
import type { Box } from './shoot.js';

export type BoxTuple = [id: string, type: string, x: number, y: number, w: number, h: number];

export const BOXES_FORMAT =
  'boxes are [id, type, x, y, w, h] in CSS px at widths[0], for nodes down to box_depth (default 2). Pass a larger box_depth or node_id to see deeper.';

/**
 * The boxes an agent READS, as tuples, down to a depth.
 *
 * Every box is still measured and kept in the session — the presence cursor and
 * `measure` want all of them. But 200 pretty-printed objects were ~27 KB per
 * look, and a layout judgement is made on bands and their direct children.
 * Ids the document does not hold (a composed overlay's interior) are dropped:
 * their depth is not this page's to compute.
 */
export function boxesForResponse(doc: DocLike, boxes: Box[], depth: number): BoxTuple[] {
  const out: BoxTuple[] = [];
  for (const b of boxes) {
    if (b.id === doc.root_node_id) { out.push([b.id, b.type, b.x, b.y, b.w, b.h]); continue; }
    if (!doc.nodes[b.id]) continue;
    if (ancestors(doc, b.id).length <= depth) out.push([b.id, b.type, b.x, b.y, b.w, b.h]);
  }
  return out;
}
```

- [ ] **Step 4: Rewire `sb_look`.** Schema gains `box_depth: z.number().int().min(1).max(8).optional().describe('Boxes down to this depth (default 2)')`. Replace the `boxes` spread with:

```ts
...(with_boxes === false ? {} : {
  boxes: boxesForResponse(session.current().doc, shots[0]?.boxes ?? [], box_depth ?? 2),
  ...(fmt ? { boxes_format: fmt } : {}),
}),
```
where `const fmt = with_boxes === false ? undefined : ctx.notices.once('boxes', BOXES_FORMAT);` is computed before the return. Description: replace "plus the measured bounding box of every node" with "plus measured boxes for the bands and their children (box_depth for more)".

- [ ] **Step 5: Gate; then `SB_BROWSER_TEST=1 npm test` (the one Chrome test must still pass). Commit** — `perf(vision): boxes as tuples, down to a depth`

---

### Task 7: Passthrough lists return what the next call needs

**Files:**
- Create: `src/tools/project.ts`
- Modify: `src/tools/page.ts` (`sb_page_list`, `sb_templates`), `src/tools/live.ts` (`sb_media_list`)
- Test: `test/project.test.ts`

**Interfaces:**
- Produces: `projectList(raw: unknown, key: string, fields: string[]): unknown` — if `raw[key]` is an array of objects, returns `{ [key]: items picked to fields, total?: raw.total }`; otherwise returns `raw` untouched. Field lists: `PAGE_FIELDS = ['id','name','slug','path','isHomepage','type','status','updatedAt','publishedAt']`, `TEMPLATE_FIELDS = ['id','name','description','categoryIds','source','listed','updatedAt']`, `MEDIA_FIELDS = ['id','name','url','mediaType','contentType','sizeBytes','width','height','folderId','state']`.

- [ ] **Step 1: Failing test** `test/project.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { projectList, PAGE_FIELDS, TEMPLATE_FIELDS } from '../src/tools/project.js';

describe('projectList()', () => {
  it('keeps only the whitelisted fields and the total', () => {
    const raw = { pages: [{ id: 'p1', name: 'Home', slug: '', settings: { seo: 'x'.repeat(500) }, status: 'published' }], total: 1 };
    expect(projectList(raw, 'pages', PAGE_FIELDS)).toEqual({ pages: [{ id: 'p1', name: 'Home', slug: '', status: 'published' }], total: 1 });
  });

  it('drops a template document — that is the heavy part', () => {
    const raw = { sectionTemplates: [{ id: 't1', name: 'Hero', document: { nodes: {} } }], total: 1 };
    const out = projectList(raw, 'sectionTemplates', TEMPLATE_FIELDS) as { sectionTemplates: Array<Record<string, unknown>> };
    expect('document' in out.sectionTemplates[0]).toBe(false);
  });

  it('returns the response untouched when the shape is not the expected list', () => {
    expect(projectList({ pages: 'nope' }, 'pages', PAGE_FIELDS)).toEqual({ pages: 'nope' });
    expect(projectList({ pages: [1, 2] }, 'pages', PAGE_FIELDS)).toEqual({ pages: [1, 2] });
    expect(projectList(null, 'pages', PAGE_FIELDS)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `src/tools/project.ts`

```ts
/**
 * A whitelist projection over the platform's `{ <key>: [...], total }` lists.
 *
 * `sb_page_list`, `sb_templates` and `sb_media_list` returned the platform's
 * JSON verbatim — a section template carries its whole document, a page its
 * settings blob. The next call needs an id and a name. Unknown keys drop; a
 * response that is not the expected list shape is returned untouched, so a
 * platform change degrades to yesterday's behaviour rather than to an empty
 * list. Field names are the Go structs' json tags (page.go:163, media.go:245 +
 * library.go:339 `url`, sectiontemplate.go:129).
 */
export const PAGE_FIELDS = ['id', 'name', 'slug', 'path', 'isHomepage', 'type', 'status', 'updatedAt', 'publishedAt'];
export const TEMPLATE_FIELDS = ['id', 'name', 'description', 'categoryIds', 'source', 'listed', 'updatedAt'];
export const MEDIA_FIELDS = ['id', 'name', 'url', 'mediaType', 'contentType', 'sizeBytes', 'width', 'height', 'folderId', 'state'];

export function projectList(raw: unknown, key: string, fields: string[]): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const list = (raw as Record<string, unknown>)[key];
  if (!Array.isArray(list) || !list.every((it) => it && typeof it === 'object' && !Array.isArray(it))) return raw;
  const items = (list as Array<Record<string, unknown>>).map((it) => {
    const o: Record<string, unknown> = {};
    for (const f of fields) if (it[f] !== undefined) o[f] = it[f];
    return o;
  });
  const total = (raw as Record<string, unknown>).total;
  return { [key]: items, ...(total !== undefined ? { total } : {}) };
}
```

- [ ] **Step 4: Rewire.** `sb_page_list` → `text(projectList(await request(...), 'pages', PAGE_FIELDS))`; `sb_templates` → key `'sectionTemplates'`, `TEMPLATE_FIELDS`; `sb_media_list` → key `'assets'`, `MEDIA_FIELDS`.

- [ ] **Step 5: Gate, commit** — `perf(tools): list tools return the fields the next call needs`

---

### Task 8: Tool layer emits `fixes`, notices once

**Files:**
- Modify: `src/tools/page.ts` (`reviewField`, `sb_set` dry run, `sb_review`), `src/tools/live.ts` (`sb_look`)
- Test: `test/page-tools.test.ts` (extend with a tool-level check through the harness in Task 11 — until then, assert on `reviewField` exported for test)

- [ ] **Step 1: Rewrite `reviewField`** in `page.ts`, exporting it:

```ts
export function reviewField(ctx: ToolContext, doc: PageDoc): Record<string, unknown> {
  const all = reviewDesign(doc);
  if (all.length === 0) return {};
  const { findings, fixes } = compactFindings(all);
  const notice = ctx.notices.once('review', REVIEW_NOTICE);
  return { findings, fixes, ...(notice ? { findings_notice: notice } : {}) };
}
```
Use it in `sb_page_open`, `sb_review` (`findings.length === 0 ? { findings: [], verdict: ... } : reviewField(ctx, doc)`), and in `sb_look` for the review half. For `sb_look`'s `layout`: `const { findings: layout, fixes: layout_fixes } = compactFindings(measure(shots))` and `layout_notice` via `ctx.notices.once('measure', MEASURE_NOTICE)`. For `sb_set` dry run: `const note = ctx.notices.once('responsive', RESPONSIVE_NOTICE); return text({ dry_run: true, patches, ...(note ? { note } : {}) })`.

- [ ] **Step 2: Test** — add to `test/page-tools.test.ts`:

```ts
import { reviewField } from '../src/tools/page.js';
import { Notices } from '../src/mcp/notices.js';
import { PageDoc } from '../src/domains/site/document.js';

it('reviewField says the notice once and sends fixes as a legend', () => {
  const ctx = { ...ctxWith(scripted().f), notices: new Notices() };
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const first = reviewField(ctx, d) as { findings: Array<Record<string, unknown>>; fixes: Record<string, string>; findings_notice?: string };
  expect(first.findings_notice).toMatch(/FIX THESE/);
  expect('fix' in first.findings[0]).toBe(false);
  expect(first.fixes.empty_page).toMatch(/sb_add/);
  expect((reviewField(ctx, d) as { findings_notice?: string }).findings_notice).toBeUndefined();
});
```

- [ ] **Step 3: Gate, commit** — `perf(tools): fixes as a legend, directives said once`

---

### Task 9: Trap 5 — app blocks

**Files:**
- Modify: `src/core/tree.ts`, `src/domains/site/document.ts` (`OutlineNode.app`, outline), `src/domains/site/builder.ts`, `src/tools/live.ts` (`bindNode`), `src/domains/site/review.ts`
- Test: `test/traps.test.ts`

**Interfaces:**
- Produces: `SPEC_APP_BLOCK_ID = 'appBlockId'`, `SPEC_APP_BLOCK_REF = 'appBlockRef'`, `appBlockRoot(doc: DocLike, id: string): string | null` (nearest self-or-ancestor carrying either stamp), `refuseAppBlockInterior(doc: PageDoc, id: string, verb: string): void` (throws when `appBlockRoot(doc.doc, id)` exists and is not `id` itself).

- [ ] **Step 1: Failing tests** — append to `test/traps.test.ts`

```ts
import { appBlockRoot, SPEC_APP_BLOCK_ID } from '../src/core/tree.js';
import { addSubtree, setKeys, removeNode, moveNode, duplicateNode } from '../src/domains/site/builder.js';
import { bindNode } from '../src/tools/live.js';
import { reviewDesign } from '../src/domains/site/review.js';

function withAppBlock() {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const { ids } = addSubtree(d, 'ROOT', {
    type: 'flex-section',
    children: [{ type: 'flex-box', specials: { [SPEC_APP_BLOCK_ID]: 'inst_1/hero' }, children: [{ type: 'heading' }] }],
  });
  d.apply(addSubtree(d, 'ROOT', { type: 'flex-section' }).patches);
  return { d, section: ids[0], block: ids[1], inner: ids[2] };
}

describe('trap 5: app blocks', () => {
  it('appBlockRoot() finds the composed block from any node inside it', () => {
    const { d, block, inner, section } = withAppBlock();
    expect(appBlockRoot(d.doc, inner)).toBe(block);
    expect(appBlockRoot(d.doc, block)).toBe(block);
    expect(appBlockRoot(d.doc, section)).toBeNull();
  });

  it('the outline flags the block root app:true', () => {
    const { d, block } = withAppBlock();
    const kids = d.outline({ depth: 2 })[0].kids!;
    expect(kids.find((k) => k.id === block)?.app).toBe(true);
  });

  it('refuses every write INSIDE a block — the save reduces it to the reference', () => {
    const { d, inner, block } = withAppBlock();
    expect(() => setKeys(d, inner, { text: 'x' }, { namespace: 'specials', base: true })).toThrow(/app block/i);
    expect(() => addSubtree(d, block, { type: 'heading' })).toThrow(/app block/i);
    expect(() => removeNode(d, inner)).toThrow(/app block/i);
    expect(() => duplicateNode(d, inner)).toThrow(/app block/i);
    expect(() => bindNode(d, inner, 'product.title', 'specials.text')).toThrow(/app block/i);
    const other = d.outline()[1].id;
    expect(() => moveNode(d, other, block, 0)).toThrow(/app block/i);
  });

  it('allows removing or moving the block root itself — that IS the reference', () => {
    const { d, block } = withAppBlock();
    expect(() => removeNode(d, block)).not.toThrow();
  });

  it('review skips a block interior — its placeholders are the app\'s', () => {
    const { d, inner } = withAppBlock();
    expect(reviewDesign(d).some((f) => f.nodeId === inner)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** `src/core/tree.ts`:

```ts
/** The specials stamps a composed APP BLOCK carries (appblocks.go:97-100). */
export const SPEC_APP_BLOCK_ID = 'appBlockId';
export const SPEC_APP_BLOCK_REF = 'appBlockRef';

/**
 * The composed app block this node sits in, or null.
 *
 * A marketplace app contributes a subtree. The document stores ONE reference
 * node (`appBlockRef`); on read the platform materializes the app's markup under
 * it and stamps the root `appBlockId`; on write `DecomposeAppBlocks` reduces the
 * whole subtree back to the reference (globalservice.go:56). An edit inside is
 * therefore stored nowhere and reported nowhere — trap 5. Nearest stamp wins:
 * the block root answers with itself.
 */
export function appBlockRoot(doc: DocLike, id: string): string | null {
  const stamped = (n?: NodeLike) => n && (n.specials?.[SPEC_APP_BLOCK_ID] !== undefined || n.specials?.[SPEC_APP_BLOCK_REF] !== undefined);
  if (stamped(doc.nodes[id])) return id;
  for (const a of ancestors(doc, id)) if (stamped(doc.nodes[a])) return a;
  return null;
}
```

`document.ts`: `app?: boolean` on `OutlineNode`; in `line()`, `if (appBlockRoot(this.doc, id) === id) out.app = true;`.

`builder.ts`:

```ts
export function refuseAppBlockInterior(doc: PageDoc, id: string, verb: string): void {
  const root = appBlockRoot(doc.doc, id);
  if (!root || root === id) return;
  throw new Error(
    `sbuilder: ${id} is inside the app block ${root}. On save the platform reduces the whole block ` +
      `back to its reference, so ${verb} here would be lost silently. Configure the block through ` +
      `its app, or remove the block (sb_remove ${root}).`,
  );
}
```
Call it: `addSubtree` on `parentId` (verb `'adding'`; note the parent may itself be the block root — a child added directly under the root is ALSO inside the block, so use `if (appBlockRoot(doc.doc, parentId)) throw …` there with the same message); `setKeys` on `id` (`'writing'`); `moveNode` on `id` (`'moving'`) and on `newParentId` (same as add: any block, root included); `removeNode` on `id` (`'removing'`); `duplicateNode` on `id` (`'duplicating'`). `bindNode` in `live.ts`: `refuseAppBlockInterior(doc, id, 'binding')`. Note on `setKeys` of the block ROOT: allowed — that node is the reference, and `appBlockValues` on it is exactly where the merchant's settings live.

`review.ts`: in `go()`, `if (seen.has(id) || overlayIds.has(id)) return;` becomes `if (seen.has(id) || overlayIds.has(id)) return;` plus, after pushing `id`, `if (appBlockRoot(d, id) === id) return;` so the root is walked (it can be an empty container the page owns) but nothing under it is.

- [ ] **Step 4: Gate, commit** — `feat(traps): trap 5 — an edit inside an app block is lost on save`

---

### Task 10: Error envelope extensions; live join needs a session

**Files:**
- Modify: `src/transport/http.ts` (`ApiError`), `src/tools/live.ts` (`sb_live_join`)
- Test: `test/http.test.ts`, `test/live-tools.test.ts`

- [ ] **Step 1: Failing tests.** `test/http.test.ts`:

```ts
it('carries details and fields when the platform sends them, and names the field in the message', async () => {
  const f = fakeFetch(400, { error: 'invalid', code: 'validation', fields: { slug: 'taken' }, details: { hint: 'x' } });
  await expect(request({ base: 'http://x', method: 'POST', path: '/a', fetchImpl: f })).rejects.toMatchObject({
    code: 'validation', fields: { slug: 'taken' }, details: { hint: 'x' }, message: expect.stringContaining('slug'),
  });
});
```
`test/live-tools.test.ts`:

```ts
import { requireSessionForLive } from '../src/tools/live.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';

it('sb_live_join refuses an API-key-only context up front — the socket is JWT-only', () => {
  const ctx = { base: 'http://x', session: new Session('http://x'), apiKey: 'wbk_x', notices: new Notices() };
  expect(() => requireSessionForLive(ctx)).toThrow(/SB_EMAIL/);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.** `ApiError` gains `readonly details?: unknown` and `readonly fields?: Record<string, string>` as constructor params after `message`; the throw site becomes:

```ts
const env = (parsed ?? {}) as { error?: string; code?: string; details?: unknown; fields?: Record<string, string> };
const fieldText = env.fields ? ' — ' + Object.entries(env.fields).map(([k, v]) => `${k}: ${v}`).join('; ') : '';
throw new ApiError(res.status, env.code ?? 'unknown', (env.error ?? `HTTP ${res.status}`) + fieldText, env.details, env.fields);
```
Update the header comment: "…and two supersets, `details` (WriteErrorCodeDetails) and `fields` (fielderrors.go) — carried, never required."

`live.ts`:

```ts
/** The live socket refuses API keys (server/internal/server/realtime.go:38); only a session JWT joins. */
export function requireSessionForLive(ctx: ToolContext): () => string {
  if (!ctx.session.loggedIn()) {
    throw new Error(
      'sbuilder: the live-edit room takes a session token only — an API key cannot join. Set ' +
        'SB_EMAIL and SB_PASSWORD and call sb_connect, then sb_live_join. Every other tool works with the key.',
    );
  }
  return () => ctx.session.token();
}
```
and `sb_live_join` uses `const tokenFn = requireSessionForLive(ctx);` in place of `() => siteToken(ctx)`. Description gains the sentence "Needs SB_EMAIL / SB_PASSWORD: the socket refuses API keys."

- [ ] **Step 4: Gate, commit** — `fix(transport): carry the platform's field errors; live join says why a key cannot`

---

### Task 11: Annotations on every tool, and a `tools/list` test

**Files:**
- Modify: `src/tools/session.ts`, `src/tools/api.ts`, `src/tools/page.ts`, `src/tools/live.ts` — every `server.tool(name, description, schema, cb)` becomes `server.registerTool(name, { description, inputSchema: schema, annotations }, cb)`.
- Create: `test/harness.ts` (in-memory client), `test/annotations.test.ts`

**Interfaces:**
- Produces: `test/harness.ts` exporting `async function connectedClient(ctx?: Partial<ToolContext>): Promise<{ client: Client; close: () => Promise<void> }>` using `InMemoryTransport.createLinkedPair()` from `@modelcontextprotocol/sdk/inMemory.js` and `Client` from `@modelcontextprotocol/sdk/client/index.js`, with a `ToolContext` built like `test/page-tools.test.ts:ctxWith` (a scripted fetch that returns `{}`), `notices: new Notices()`.

Annotations table (copy exactly):

| Tool | annotations |
| --- | --- |
| sb_connect, sb_site_list, sb_api_find, sb_page_open, sb_outline, sb_node_read, sb_catalog_search, sb_traits_for, sb_review, sb_templates, sb_page_list, sb_media_list | `{ readOnlyHint: true }` |
| sb_api_call | `{ readOnlyHint: false, destructiveHint: true, openWorldHint: true }` |
| sb_remove | `{ readOnlyHint: false, destructiveHint: true }` |
| sb_publish | `{ readOnlyHint: false, destructiveHint: true, idempotentHint: true }` |
| sb_look | `{ readOnlyHint: false, destructiveHint: false, idempotentHint: true }` |
| sb_live_join | `{ readOnlyHint: false, destructiveHint: false, idempotentHint: true }` |
| sb_add, sb_set, sb_move, sb_duplicate, sb_bind, sb_template_use, sb_page_create, sb_media_upload | `{ readOnlyHint: false, destructiveHint: false }` |

- [ ] **Step 1: Write `test/harness.ts`**

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import type { ToolContext } from '../src/tools/context.js';

export async function connectedClient(over: Partial<ToolContext> = {}) {
  const f = (async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  const ctx: ToolContext = { base: 'http://x', session, fetchImpl: f, notices: new Notices(), ...over };
  const server = createServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
```

- [ ] **Step 2: Failing test** `test/annotations.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';

const READ_ONLY = ['sb_connect','sb_site_list','sb_api_find','sb_page_open','sb_outline','sb_node_read','sb_catalog_search','sb_traits_for','sb_review','sb_templates','sb_page_list','sb_media_list'];

describe('tool annotations', () => {
  it('every tool carries annotations; the read set is readOnlyHint', async () => {
    const { client, close } = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(25);
    for (const t of tools) expect(t.annotations, t.name).toBeDefined();
    for (const name of READ_ONLY) expect(tools.find((t) => t.name === name)!.annotations!.readOnlyHint, name).toBe(true);
    for (const name of ['sb_remove', 'sb_api_call']) expect(tools.find((t) => t.name === name)!.annotations!.destructiveHint, name).toBe(true);
    await close();
  });
});
```

- [ ] **Step 3: Convert every registration** per the table. Mechanical: the schema object passed today becomes `inputSchema`. Keep descriptions.

- [ ] **Step 4: Gate, commit** — `feat(mcp): annotations on all 25 tools — clients stop confirming reads`

---

### Task 12: Instructions rewritten; the budget is a test

**Files:**
- Modify: `src/server.ts` (`INSTRUCTIONS`), `src/tools/api.ts` (description count — done in Task 4)
- Create: `test/token-budget.test.ts`

- [ ] **Step 1: Failing test** `test/token-budget.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';

const chars = (r: { content: Array<{ type: string; text?: string }> }) =>
  r.content.filter((c) => c.type === 'text').reduce((n, c) => n + (c.text?.length ?? 0), 0);

describe('token budget — a diet without a scale comes back', () => {
  it('tools/list and instructions stay small', async () => {
    const { client, close } = await connectedClient();
    const { tools } = await client.listTools();
    expect(JSON.stringify(tools).length).toBeLessThan(15_000);
    expect((client.getInstructions() ?? '').length).toBeLessThan(1_000);
    expect(client.getInstructions()).not.toMatch(/vanishes on publish/);
    await close();
  });

  it('search results are lists, not schemas', async () => {
    const { client, close } = await connectedClient();
    expect(chars(await client.callTool({ name: 'sb_api_find', arguments: { query: 'list orders' } }) as never)).toBeLessThan(3_000);
    expect(chars(await client.callTool({ name: 'sb_catalog_search', arguments: { query: 'hero' } }) as never)).toBeLessThan(2_500);
    expect(chars(await client.callTool({ name: 'sb_traits_for', arguments: { type: 'list-dataset' } }) as never)).toBeLessThan(12_000);
    await close();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** on the instructions length / stale sentence.

- [ ] **Step 3: Rewrite `INSTRUCTIONS`** in `src/server.ts` (import `SWAGGER_SOURCE` from `./catalog/api.generated.js` and `ELEMENT_SOURCE` from `./catalog/elements.generated.js`):

```ts
const INSTRUCTIONS = `Store Builder. Call sb_connect first.

API: sb_api_find query → one line per operation (${SWAGGER_SOURCE.operations} reachable); sb_api_find id → the call sheet; sb_api_call runs it. /api/v1 paths take the API key, every other path the session — the platform refuses each on the other's surface. When the sheet says the body is undescribed, read the matching GET and send back a modified copy.

Design: sb_page_open → sb_catalog_search (${ELEMENT_SOURCE.count} elements) → sb_traits_for the one you chose → sb_add with a NESTED spec (one call per section) → sb_set → sb_look → sb_review.
- Every write and every API call defaults to dry_run:true. Pass dry_run:false to act.
- sb_set writes per breakpoint by default; base is the cascade's fallback layer and is fine for values that should not vary.
- Outline flags: global = shared master, editing it edits every page; overlay = not this page; app = an app block, its interior cannot be edited here.
- sb_live_join makes edits visible in an open editor (needs SB_EMAIL/SB_PASSWORD). sb_bind puts real store data in the page.`;
```

- [ ] **Step 4: Gate, commit** — `perf(server): shorter, corrected instructions; the token budget is a test`

---

### Task 13: Auto-release

**Files:**
- Create: `.github/workflows/auto-release.yml`, `CHANGELOG.vi.md`
- Modify: `CHANGELOG.md`, `package.json` (`files`), `scripts/release.mjs`

- [ ] **Step 1: Write the workflow.** Copy `/Users/mac/Documents/web_cake/webcake-landing-mcp/.github/workflows/auto-release.yml` to `.github/workflows/auto-release.yml`, then apply exactly these edits:
  1. `node-version: "22"`.
  2. The skip condition: `if: "!contains(github.event.head_commit.message, 'chore(release):') && !contains(github.event.head_commit.message, 'release: v')"`.
  3. The gate step becomes:
     ```yaml
     - name: Build + test + smoke gate
       run: |
         npm run build
         npm test
         npm run smoke
     ```
  4. Replace the Claude prompt body between `PROMPT=$(cat <<EOF` and `EOF` with:
     ```
     You are the release manager for sbuilder-mcp, an MCP (Model Context Protocol) stdio
     server that lets an AI agent design and operate a Store Builder site: pages, elements,
     live editing, screenshots, data bindings, and the platform's full REST API.

     Write the CHANGELOG entry for version ${NEW_VERSION} (${REL_DATE}).

     Investigate the changes yourself using the tools available:
     - Run "git log ${RANGE} --stat -- src/" to see commits touching src/.
     - Run "git diff ${RANGE} -- src/" or "git diff ${RANGE} --stat -- src/" when you need more detail.
     - Read CHANGELOG.md and CHANGELOG.vi.md to match the existing tone and section ordering in each language.
     - Read docs/tools.md if you need to map a change to a public tool name.

     Produce the entry in BOTH English and Vietnamese, in strict Keep a Changelog format:

     ## [${NEW_VERSION}] - ${REL_DATE}

     ### Added
     - ...

     ### Changed
     - ...

     ### Fixed
     - ...

     Rules:
     - Only include sections that have entries; omit empty sections.
     - One bullet per user-visible change. Merge duplicate or noisy commits.
     - Skip purely internal commits (CI, formatting, scripts) UNLESS nothing user-visible changed — then use a single "### Internal" section.
     - Refer to MCP tools by their public name (sb_page_open, sb_api_find, sb_look, …) and to arguments by their key (dry_run, box_depth).
     - Each bullet: one sentence, present tense, ends with a period. No commit hashes, no emoji, no links.
     - Keep the section headers in English (### Added / Changed / Fixed / Removed / Internal) in BOTH languages so they parse identically; translate only the bullet text, and keep code identifiers / tool names verbatim.
     - Write the English entry to .release_notes.md and the Vietnamese entry to .release_notes.vi.md, then print both. Do NOT modify CHANGELOG.md or CHANGELOG.vi.md yourself.
     ```
  Everything else (resume mode, reserved-version loop, server.json sync, `npm publish --ignore-scripts`, GitHub Release, `mcp-publisher` OIDC publish, `environment: prod`, `concurrency`) stays verbatim.

- [ ] **Step 2: Convert `CHANGELOG.md`** headings to `## [0.1.2] - 2026-08-29` form. Add the preamble the landing-mcp uses (`**English** · [Tiếng Việt](./CHANGELOG.vi.md)` and the Keep-a-Changelog sentence). Replace the 0.1.2 body with:
  ```
  ### Added
  - The server reports which machine and which client it runs on, so the store's Agent app can show every connected agent.
  - sb_look measures the render: content past the viewport, overlapping siblings, and text too small to read are reported with the width they happen at.
  ```
  Create `CHANGELOG.vi.md` with the same structure, a `**Tiếng Việt** · [English](./CHANGELOG.md)` line, and the 0.1.2 / 0.1.1 / 0.1.0 entries translated (0.1.1 and 0.1.0 may keep their bullets as short Vietnamese summaries: 0.1.1 "Sửa lỗi, thêm tool, và vòng lặp nhìn"; 0.1.0 "Bản phát hành đầu tiên.").

- [ ] **Step 3: `package.json`** — add `"CHANGELOG.vi.md"` to `files`.

- [ ] **Step 4: `scripts/release.mjs`** — rewrite the header comment: CI (`.github/workflows/auto-release.yml`) is the normal path — a push to `main` that touches `src/**` releases; this script is the offline path for a machine with no CI or a rotated secret. Change `const heading = \`## ${version} — ${date}…\`` to `` `## [${version}] - ${date}\n\n${entry.trim()}\n` `` and the commit subject to `chore(release): v${version}`. Also prepend the entry above the first `## [` line rather than after the title line, so the preamble survives: replace the title/rest split with

  ```js
  const at = existing.search(/^## \[/m);
  const next = at === -1 ? `${existing.trimEnd()}\n\n${heading}` : `${existing.slice(0, at)}${heading}\n${existing.slice(at)}`;
  writeFileSync(CL, next);
  ```
  and make the dry run print the same. Run `npm run release:dry` on a clean tree and confirm the printed heading uses the bracket form.

- [ ] **Step 5: Gate (`test/release-otp.test.ts` still passes), commit** — `ci: auto-release on push to main, after the landing-mcp flow`

---

### Task 14: Documentation

**Files:**
- Modify: `docs/tools.md`, `docs/tools.vi.md`, `README.md`, `README.vi.md`, `CLAUDE.md`

- [ ] **Step 1: `docs/tools.md` / `docs/tools.vi.md`.** Update counts (412 operations, 106 elements, 26 sources — lines 3, 98, 197 / 3, 98, 195). `sb_api_find`: document the two modes, the `matches` line shape, `body` one-word verdicts, default limit 8, `id` → call sheet with the three verdict fields as before. `sb_catalog_search`: four fields, `detail`, default 8. `sb_traits_for`: the new shape (`hints`, `inspector` names, `declared`, `undeclared_note`). `sb_look`: `box_depth`, tuple boxes, `boxes_format`. Findings sections: `fixes` legend, `findings_notice` once per process. `sb_set`: `note` once. `sb_page_list` / `sb_templates` / `sb_media_list`: the projected fields. `sb_live_join`: needs a session. Add an "App blocks" paragraph to the traps section. Mirror every change in Vietnamese.

- [ ] **Step 2: READMEs.** Counts at `README.md:90` / `README.vi.md:87`. Add a "Release" section under Development: a push to `main` touching `src/**` publishes to npm and the MCP Registry; `workflow_dispatch` picks the bump; `npm run release` is the offline path; secrets `NPM_ACCESS_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`.

- [ ] **Step 3: CLAUDE.md.** Counts (`64`, `83`, `161`). Add trap 5 after trap 4 (three sentences: the stamps, the strip on save, `appBlockRoot` and where writes refuse). Add "Releasing" after "Commands": the workflow, the secrets, the skip guards, and that `scripts/release.mjs` is the offline path. Add one line under invariants: "Every result is compact JSON and every directive is said once per process through `ctx.notices`; a tool that repeats a notice on every call is the shape that drifts."

- [ ] **Step 4: Gate, commit** — `docs: tools, traps and release for the token diet`

---

## Self-review

- **Spec coverage:** §3.1 → T1; §3.2 → T4; §3.3–3.4 → T5; §3.5 → T2 + T8; §3.6 → T3 + T8; §3.7 → T6; §3.8 → T7; §3.9 → T11; §3.10–3.11 → T12; §4 catalog → committed (`994f941`) + counts in T4/T12/T14; §4 trap 5 → T9; §4 envelope + live → T10; §5 → T13; §6 → T14; §7 browser test → T6 step 5.
- **Placeholders:** none; every step carries code or an exact edit.
- **Type consistency:** `Notices.once(key, body)` used identically in T2/T6/T8; `compactFindings` returns `{ findings, fixes }` in T3 and is spread that way in T8; `appBlockRoot` / `refuseAppBlockInterior` names match between T9 steps; `connectedClient` from `test/harness.ts` is used by T11 and T12; `summarizeOperation` / `findOperation` / `DEFAULT_FIND_LIMIT` match between T4 steps.
