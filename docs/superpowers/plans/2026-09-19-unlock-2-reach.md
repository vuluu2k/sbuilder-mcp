# Unlock 2 — Reach: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every operation the deployed platform documents is reachable with its shape, and any route it does not document is reachable by method and path through the same tool, under the same credential and dry-run rules.

**Architecture:** Regenerate the committed catalog against a clean origin/main worktree of the platform (531 → 560 operations). Then let `sb_api_call` take `method` + `path` when `id` is absent: the call resolves to a synthetic operation whose credential comes from `credentialFor(path)`, and everything downstream (site-id substitution, dry run, redaction, shaping) runs unchanged. `sb_api_find` names the raw form and the three routes registered directly on the router when a search matches nothing.

**Tech Stack:** TypeScript (ESM / Node16), zod, vitest, `scripts/gen-catalog.ts` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-19-unlock-platform-reach-design.md`, section 4.

## Global Constraints

- The gate for every change is `npm run build && npm test && npm run smoke`; smoke MUST print `ALL GOOD`.
- `src/catalog/*.generated.ts` is generated and committed. Never hand-edit it.
- Codegen refuses an unpublished checkout. Point `WB_REPO` at a DETACHED WORKTREE of `origin/main`, never at the working checkout.
- Credential routing is by path prefix in `src/transport/credential.ts` and is not negotiable.
- Mutating tools take `dry_run` and default it to `true`, returning a request preview passed through `redact()`.
- Every tool answers through `text()`. Directives are said once per process through `ctx.notices.once`.
- `test/token-budget.test.ts` holds a 24,500-character ceiling on `tools/list`. Raise it only with the reason written in the test.
- Every relative import ends in `.js`. No prettier.
- End commit messages with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Regenerate the catalog against origin/main

**Files:**
- Modify (generated): `src/catalog/api.generated.ts`, `src/catalog/shapes.generated.ts`, `src/catalog/deadkeys.generated.ts`, `src/catalog/source.generated.ts`, and any other `src/catalog/*.generated.ts` codegen rewrites
- Possibly modify: `test/token-budget.test.ts` (a ceiling, with its reason)

**Interfaces:**
- Consumes: a platform worktree. This session created one at `/private/tmp/claude-501/-Volumes-workspace-webcake-sbuilder-mcp/d10cb3d3-a76a-441b-9cf6-6c5d49687db0/scratchpad/wb` (detached at `origin/main`, `node_modules` symlinked in). If it is gone, recreate it:
  ```bash
  WT=/private/tmp/claude-501/-Volumes-workspace-webcake-sbuilder-mcp/d10cb3d3-a76a-441b-9cf6-6c5d49687db0/scratchpad/wb
  git -C /Volumes/workspace/webcake/web_builder fetch -q origin
  git -C /Volumes/workspace/webcake/web_builder worktree add --detach "$WT" origin/main
  for d in node_modules schema/node_modules editor/node_modules runtime/node_modules; do
    [ -e /Volumes/workspace/webcake/web_builder/$d ] && [ ! -e "$WT/$d" ] && ln -s "/Volumes/workspace/webcake/web_builder/$d" "$WT/$d"
  done
  ```
- Produces: `SWAGGER_SOURCE.operations === 560` in `src/catalog/api.generated.ts`, which Task 2's test asserts against.

- [ ] **Step 1: Measure the staleness**

Run: `WB_REPO=$WT npm run codegen:check; echo "exit $?"`
Expected: exit 1, `catalog is STALE ... 4 file(s) would change`, `api.generated.ts (19556 → 20206 lines)`. A warning about two `ai-credits` routes annotated but absent from swagger is expected and is NOT fixed by this task.

- [ ] **Step 2: Regenerate**

Run: `WB_REPO=$WT npm run codegen`
Expected: ends with the `checked …` lines and no `STALE`. `git status --short` shows only files under `src/catalog/`.

- [ ] **Step 3: Confirm the stamp**

Run: `grep -nE '"operations": [0-9]+' src/catalog/api.generated.ts`
Expected: `"operations": 560`.

- [ ] **Step 4: Run the gate**

Run: `npm run build && npm test && npm run smoke`
Expected: build clean, tests green, `ALL GOOD`.

If `test/token-budget.test.ts` fails on a call-sheet ceiling (`orders`, `products`, `traits`), read the failing number, raise that ceiling by at least 15% headroom, and write the reason in the existing comment style: which regen, which count moved, what grew. Do not raise the `tools/list` ceiling here; nothing in this task touches `tools/list`.

- [ ] **Step 5: Commit**

```bash
git add src/catalog test/token-budget.test.ts
git commit -m "chore(catalog): regenerate against web_builder origin/main — 531 → 560 operations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

(Drop `test/token-budget.test.ts` from `git add` if it did not change.)

---

### Task 2: `sb_api_call` takes `method` + `path` when `id` is absent

**Files:**
- Modify: `src/tools/api.ts` — `CallArgs` (line 14-26), `callOperation` (line 260-266), the dry-run and result blocks (line 302-370), the `sb_api_call` registration (line 435-470)
- Test: `test/api-call.test.ts`

**Interfaces:**
- Consumes: `credentialFor(path)` from `src/transport/credential.ts`; `Notices.once(key, body)` from `src/mcp/notices.ts`; `CallArgs.item_offset` from Plan 1 Task 2.
- Produces:
  ```ts
  export interface CallArgs {
    id?: string;
    method?: string;   // with path, when id is absent
    path?: string;
    path_params?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
    dry_run?: boolean;
    pick?: string[];
    max_items?: number;
    item_offset?: number;
  }
  export const RAW_CALL_NOTICE: string;
  export function resolveOperation(args: CallArgs): ApiOperation & { raw?: true };
  ```
  A raw call's non-dry-run result is `{ uncatalogued: true, note?: string, data: unknown }` where `data` is what the catalogued form would have returned. A raw dry run is the usual preview plus `uncatalogued: true`.

- [ ] **Step 1: Write the failing tests**

Append to `test/api-call.test.ts`, inside a new `describe`:

```ts
import { Notices } from '../src/mcp/notices.js';

describe('callOperation() — the raw form', () => {
  const rawCtx = async (f: typeof fetch) => ({ ...(await ctxWith(f, 'wbk_k')), notices: new Notices(), siteId: 'site_env' });

  it('sends a route the catalog does not carry, on the site-scoped credential', async () => {
    const f = ok();
    const out = (await callOperation(await rawCtx(f), {
      method: 'get',
      path: '/api/permissions',
      dry_run: false,
    })) as { uncatalogued: boolean; data: unknown; note?: string };
    expect(calls(f)[0][0]).toBe('http://x/api/permissions');
    expect((calls(f)[0][1] as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer wbk_k');
    expect(out.uncatalogued).toBe(true);
    expect(out.data).toEqual({ menus: [], total: 0 });
    expect(out.note).toMatch(/no call sheet/i);
  });

  it('says the directive once per process', async () => {
    const f = ok();
    const ctx = await rawCtx(f);
    await callOperation(ctx, { method: 'GET', path: '/api/locales', dry_run: false });
    const second = (await callOperation(ctx, { method: 'GET', path: '/api/locales', dry_run: false })) as { note?: string };
    expect(second.note).toBeUndefined();
  });

  it('defaults {siteId} to SB_SITE in a raw path too', async () => {
    const f = ok();
    await callOperation(await rawCtx(f), { method: 'GET', path: '/api/sites/{siteId}/published', dry_run: false });
    expect(calls(f)[0][0]).toBe('http://x/api/sites/site_env/published');
  });

  it('routes /api/v1 to the key and refuses without one', async () => {
    const f = ok();
    const ctx = { ...(await ctxWith(f)), notices: new Notices() };
    await expect(
      callOperation(ctx, { method: 'GET', path: '/api/v1/anything', dry_run: false }),
    ).rejects.toThrow(/SB_TOKEN/);
  });

  it('refuses a path that is not a bare platform path', async () => {
    const ctx = await rawCtx(ok());
    await expect(callOperation(ctx, { method: 'GET', path: 'https://evil.example/x', dry_run: false })).rejects.toThrow(/bare platform path/i);
    await expect(callOperation(ctx, { method: 'GET', path: '//evil.example/x', dry_run: false })).rejects.toThrow(/bare platform path/i);
    await expect(callOperation(ctx, { method: 'GET', path: 'api/permissions', dry_run: false })).rejects.toThrow(/bare platform path/i);
  });

  it('refuses an unknown method, and id together with method/path', async () => {
    const ctx = await rawCtx(ok());
    await expect(callOperation(ctx, { method: 'FETCH', path: '/api/x', dry_run: false })).rejects.toThrow(/method/i);
    await expect(
      callOperation(ctx, { id: 'get:/api/sites/{siteID}/menus', method: 'GET', path: '/api/x' }),
    ).rejects.toThrow(/either id or method\+path/i);
    await expect(callOperation(ctx, {})).rejects.toThrow(/either id or method\+path/i);
  });

  it('dry-runs a raw call by default and marks it uncatalogued', async () => {
    const f = ok();
    const out = (await callOperation(await rawCtx(f), { method: 'POST', path: '/api/site-imports', body: { url: 'u' } })) as Record<string, unknown>;
    expect(calls(f)).toHaveLength(0);
    expect(out.dry_run).toBe(true);
    expect(out.uncatalogued).toBe(true);
    expect((out.would_send as { method: string }).method).toBe('POST');
  });

  it('prepares no undo for a raw PUT', async () => {
    const f = ok();
    const record = vi.fn();
    const ctx = { ...(await rawCtx(f)), undo: { record } };
    await callOperation(ctx, { method: 'PUT', path: '/api/sites/{siteId}/settings', body: { a: 1 }, dry_run: false });
    expect(record).not.toHaveBeenCalled();
    // One request only: the PUT itself, no GET before it.
    expect(calls(f)).toHaveLength(1);
  });
});
```

If `ctxWith`'s return type makes the spread objects fail typechecking against `ToolContext`, cast the ctx `as unknown as ToolContext` where `callOperation` is called (the existing tests in this file already pass partial contexts).

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run test/api-call.test.ts -t "raw form"`
Expected: FAIL — `unknown operation "undefined"` and similar.

- [ ] **Step 3: Implement `resolveOperation` and thread it through `callOperation`**

In `src/tools/api.ts`:

Change `CallArgs`:

```ts
export interface CallArgs {
  /** Operation id from sb_api_find. Omit it to call by method + path. */
  id?: string;
  /** With `path`, when `id` is absent: a route the catalog does not carry. */
  method?: string;
  path?: string;
  path_params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  dry_run?: boolean;
  pick?: string[];
  max_items?: number;
  item_offset?: number;
}
```

Add near `SITE_PARAMS`:

```ts
import { credentialFor } from '../transport/credential.js';

const RAW_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Said once per process on the first raw call. A raw route has no call sheet,
 * no shape and no undo, and the durable fix is upstream — the same fix
 * reportUndocumentedRoutes names.
 */
export const RAW_CALL_NOTICE =
  'This route is not in the catalog, so it has no call sheet, no body shape, no body ' +
  'warnings and no sb_undo. The credential still follows the path prefix and dry_run still ' +
  'defaults to true. The durable fix is an @Router annotation upstream and a catalog regen.';

/**
 * The operation a call names — from the catalog by id, or synthesised from
 * method + path for a route the catalog does not carry.
 *
 * The raw form exists because the catalog is a CLOSED LIST read off one
 * swagger document, and the platform serves routes that document does not
 * describe: 20 the platform never annotated, three registered directly on the
 * router, and anything newer than the last regen. Refusing them made the
 * catalog's staleness the caller's ceiling.
 *
 * It changes no rule. The credential comes from the path prefix exactly as it
 * does for a catalogued route, and a path that is not a bare platform path is
 * refused: `request()` prefixes `ctx.base`, so a path carrying a host would
 * send this install's credential to another server.
 */
export function resolveOperation(args: CallArgs): ApiOperation & { raw?: true } {
  const hasRaw = args.method !== undefined || args.path !== undefined;
  if (args.id && hasRaw) {
    throw new Error('sbuilder: sb_api_call takes either id or method+path, not both.');
  }
  if (!args.id && !(args.method && args.path)) {
    throw new Error(
      'sbuilder: sb_api_call takes either id (from sb_api_find) or method+path for a route ' +
        'the catalog does not carry.',
    );
  }
  if (args.id) {
    const op = API_OPERATIONS.find((o) => o.id === args.id);
    if (!op) throw new Error(`sbuilder: unknown operation "${args.id}" — use sb_api_find first`);
    return op;
  }
  const method = args.method!.toUpperCase();
  if (!RAW_METHODS.has(method)) {
    throw new Error(`sbuilder: method "${args.method}" is not one of ${[...RAW_METHODS].join(', ')}.`);
  }
  const path = args.path!;
  if (!path.startsWith('/') || path.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new Error(
      `sbuilder: path must be a bare platform path starting with "/" (got ${JSON.stringify(path)}). ` +
        'The base URL is this install\'s SB_API; a path carrying a host would send the credential elsewhere.',
    );
  }
  return {
    id: `${method.toLowerCase()}:${path}`,
    method,
    path,
    tags: [],
    summary: '',
    params: [],
    bodyDescribed: false,
    bodyRef: null,
    credential: credentialFor(path),
    raw: true,
  };
}
```

Check `ApiOperation` in `src/catalog/types.ts` for any required field the literal above misses and add it with its empty value; the compiler will name it.

In `callOperation`, replace the first two lines of the body:

```ts
  const op = resolveOperation(args);
```

After the dry-run object is built (the `return { dry_run: true, … }` block), add `...(op.raw ? { uncatalogued: true } : {})` as a property of that returned object.

Wrap the two non-dry-run returns. Replace:

```ts
  if (raw === null || raw === undefined) {
    return { ok: true, method: op.method, path, note: 'The platform answered with no content.' };
  }
  const projection = args.pick ?? LIST_PROJECTIONS[op.id];
  return shapeResponse(raw, { pick: projection, max_items: args.max_items, item_offset: args.item_offset });
```

with:

```ts
  const answer =
    raw === null || raw === undefined
      ? { ok: true, method: op.method, path, note: 'The platform answered with no content.' }
      : shapeResponse(raw, {
          pick: args.pick ?? LIST_PROJECTIONS[op.id],
          max_items: args.max_items,
          item_offset: args.item_offset,
        });
  if (!op.raw) return answer;
  const note = ctx.notices.once('raw_call', RAW_CALL_NOTICE);
  return { uncatalogued: true, ...(note ? { note } : {}), data: answer };
```

The undo block is gated on `REQUEST_SHAPES[op.id]`, which is never set for a synthetic id, so a raw PUT prepares no undo without any new branch.

Update the registration:

```ts
      description:
        'Call an operation from sb_api_find (id), or a route the catalog lacks (method+path); ' +
          'dry run by default. pick selects fields, max_items caps lists, item_offset skips items.',
      inputSchema: {
      id: z.string().optional().describe('Operation id from sb_api_find, e.g. "get:/api/sites/{siteID}/menus"'),
      method: z.string().optional().describe('With path, when id is absent: GET|HEAD|POST|PUT|PATCH|DELETE'),
      path: z.string().optional().describe('Bare platform path, e.g. "/api/sites/{siteId}/published"; {siteId} defaults to SB_SITE'),
      ...
```

Keep the rest of the schema as it is.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/api-call.test.ts`
Expected: every test passes, including the pre-existing ones (their ctx objects have no `notices`; only the raw path reads it).

- [ ] **Step 5: Run the gate**

Run: `npm run build && npm test && npm run smoke`
Expected: green and `ALL GOOD`. If `test/token-budget.test.ts` fails on `tools/list` (24,500), read the measured length; if the overrun is under 600 characters raise the ceiling to the measurement plus 1,500 and write in the comment: "raised for the raw form of sb_api_call (method, path) — <measured> measured on <date>". Otherwise shorten the two new `describe()` strings first.

- [ ] **Step 6: Commit**

```bash
git add src/tools/api.ts test/api-call.test.ts test/token-budget.test.ts
git commit -m "feat(api): sb_api_call reaches a route the catalog does not carry, by method and path

The catalog is a closed list read off one swagger document, and the platform serves
routes it does not describe. The raw form changes no rule — credential by path
prefix, dry run by default, {siteId} from SB_SITE — and says once that it carries no
sheet, no shape and no undo.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `sb_api_find` names the way out when nothing matches

**Files:**
- Modify: `src/tools/api.ts` — the `sb_api_find` handler's no-match branch (line 425-430)
- Test: `test/api-search.test.ts` (append; it already covers `searchOperations`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const OUTSIDE_CATALOG: ReadonlyArray<{ method: string; path: string; why: string }>` in `src/tools/api.ts`.

- [ ] **Step 1: Write the failing test**

The cheapest seam is the exported constant; append to `test/api-search.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OUTSIDE_CATALOG } from '../src/tools/api.js';
import { API_OPERATIONS } from '../src/catalog/api.generated.js';

describe('the routes the catalog cannot carry by construction', () => {
  it('names the three router-registered routes, none of which the catalog holds', () => {
    const paths = OUTSIDE_CATALOG.map((r) => `${r.method.toLowerCase()}:${r.path}`);
    expect(paths).toEqual(['get:/api/permissions', 'get:/api/plans', 'get:/api/locales']);
    for (const p of paths) expect(API_OPERATIONS.some((o) => o.id === p)).toBe(false);
  });
});
```

The second assertion is the tripwire: the day a regen carries one of these, the entry must leave the list rather than mislead.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/api-search.test.ts`
Expected: FAIL — `OUTSIDE_CATALOG` is not exported.

- [ ] **Step 3: Implement**

In `src/tools/api.ts`, next to `RAW_CALL_NOTICE`:

```ts
/**
 * Routes registered DIRECTLY on the gin router, outside every annotated
 * dispatcher, so no `swag init` and no regen can ever carry them. Hand-kept
 * and three entries long on purpose: the generated answer for UNANNOTATED
 * routes is an @Router line upstream, not a table here.
 */
export const OUTSIDE_CATALOG = [
  { method: 'GET', path: '/api/permissions', why: 'the RBAC matrix, content domains and delegation scopes' },
  { method: 'GET', path: '/api/plans', why: 'the public plan catalogue' },
  { method: 'GET', path: '/api/locales', why: 'the language list with each locale\'s currency' },
] as const;
```

Change the no-match branch of the `sb_api_find` handler:

```ts
      const matches = searchOperations(query, { tag, limit }).map(summarizeOperation);
      return text({
        matches,
        next: matches.length
          ? 'Pass one id back to sb_api_find for its call sheet before calling it.'
          : 'No match — try other words, or a tag. A route the catalog does not carry can still be called: sb_api_call with method + path.',
        ...(matches.length ? {} : { outside_catalog: OUTSIDE_CATALOG }),
      });
```

- [ ] **Step 4: Run the test and the gate**

Run: `npx vitest run test/api-search.test.ts && npm run build && npm test && npm run smoke`
Expected: green, `ALL GOOD`.

- [ ] **Step 5: Commit**

```bash
git add src/tools/api.ts test/api-search.test.ts
git commit -m "feat(api): a search that matches nothing names the raw form and the three router-only routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Document the raw form

**Files:**
- Modify: `docs/tools.md` (`## \`sb_api_call\`` at line 114; the parameter table right below it)
- Modify: `docs/tools.vi.md` (`## \`sb_api_call\`` at line 118)
- Modify: `README.md:86` and `README.vi.md` (the `sb_api_call` table row)

**Interfaces:** none.

- [ ] **Step 1: English**

In `docs/tools.md`, add to the parameter table under `sb_api_call`, above the `dry_run` row:

```markdown
| `method` | string? | With `path`, when `id` is absent: `GET`, `HEAD`, `POST`, `PUT`, `PATCH` or `DELETE` |
| `path` | string? | A bare platform path starting with `/`, e.g. `/api/sites/{siteId}/published`; `{siteId}` defaults to `SB_SITE` |
```

Change the `id` row's type to `string?` and its text to `Operation id from \`sb_api_find\`. Omit it to call by \`method\` + \`path\``.

After the paragraph that begins "Credentials are chosen from the path", add:

```markdown
**A route the catalog does not carry is still callable.** The catalog is a closed list read
off one swagger document, and the platform serves routes it does not describe — 20 the
platform never annotated, three registered directly on the router (`/api/permissions`,
`/api/plans`, `/api/locales`), and anything newer than the last regen. `method` + `path`
reaches them under exactly the same rules: the credential follows the path prefix, `dry_run`
defaults to `true`, `{siteId}` defaults to `SB_SITE`, and `pick` / `max_items` /
`item_offset` apply. What a raw call does NOT have is said once per process in `note`: no
call sheet, no body shape, no body warnings and no `sb_undo`. The answer is wrapped as
`{ uncatalogued: true, data }` so it cannot be mistaken for a catalogued one. A path that
is not a bare platform path is refused, because the base URL is this install's `SB_API` and
a path carrying a host would send the credential elsewhere. When `sb_api_find` matches
nothing, its answer lists the three router-only routes under `outside_catalog`.
```

- [ ] **Step 2: Vietnamese**

In `docs/tools.vi.md`, the same two table rows (translate the descriptions) and this paragraph in the same position:

```markdown
**Route không có trong catalog vẫn gọi được.** Catalog là một danh sách đóng đọc từ một tài
liệu swagger, còn platform phục vụ cả những route tài liệu đó không mô tả — 20 route chưa
từng được annotate, ba route đăng ký thẳng trên router (`/api/permissions`, `/api/plans`,
`/api/locales`), và mọi thứ mới hơn lần regen gần nhất. `method` + `path` gọi tới chúng theo
đúng các quy tắc cũ: credential theo tiền tố path, `dry_run` mặc định `true`, `{siteId}` lấy
từ `SB_SITE`, và `pick` / `max_items` / `item_offset` vẫn áp dụng. Thứ một raw call KHÔNG có
được nói một lần mỗi process trong `note`: không call sheet, không body shape, không cảnh
báo body và không `sb_undo`. Kết quả được bọc thành `{ uncatalogued: true, data }` để không
nhầm với kết quả có trong catalog. Một path không phải path trần của platform bị từ chối, vì
base URL là `SB_API` của bản cài này và một path mang host sẽ gửi credential đi nơi khác. Khi
`sb_api_find` không khớp gì, câu trả lời liệt kê ba route chỉ-có-trên-router dưới
`outside_catalog`.
```

- [ ] **Step 3: READMEs**

`README.md` row: `| \`sb_api_call\` | Execute an operation, or any route by method+path; dry run by default. Field selection and local result pagination |`. `README.vi.md`: the matching row, translated to the same effect.

- [ ] **Step 4: Gate and commit**

Run: `npm run build && npm test && npm run smoke`

```bash
git add docs/tools.md docs/tools.vi.md README.md README.vi.md
git commit -m "docs(api): the raw form of sb_api_call, in both languages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
