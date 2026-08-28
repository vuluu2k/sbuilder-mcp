# `sbuilder-mcp` Phase 1 — Foundation & Full API Reach

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working MCP stdio server that authenticates with both platform credentials and can drive all 310 of the platform's API operations through a generated, searchable index.

**Architecture:** A build step reads `server/docs/swagger.json` out of a `web_builder` checkout and emits a typed operation index. Two tools — `sb_api_find` and `sb_api_call` — turn that index into full API reach without a 310-entry tool list. Credentials are chosen by path prefix, because the OpenAPI document declares one scheme for both.

**Tech Stack:** TypeScript (ESM, `module: Node16`), `@modelcontextprotocol/sdk` ^1.30, `zod` ^3, `vitest` ^3.2, `tsx` for build scripts. Node ≥20.

**Spec:** `docs/superpowers/specs/2026-08-27-sbuilder-mcp-design.md`

## Phase map

This plan is Phase 1 of three. Each phase produces working, shippable software on its own.

| Phase | Deliverable |
| --- | --- |
| **1 (this plan)** | Auth + generated API index + `sb_api_find`/`sb_api_call` + session tools. The agent can already operate products, media, menus, theme, forms, blog, translations, discounts, domains, settings and publish — everything except page layout. |
| 2 | Document model, patch core, expand/compact, builder, the three traps, Tier-1 read/write tools, autosave. The agent can build pages. |
| 3 | Live-edit socket, presence, the yield rule, Playwright vision loop. The agent designs visibly and can see its own work. |

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include this section.

- Package `sbuilder-mcp`, bin `sb-mcp`, MCP server name `sbuilder`. **Never** the internal `@webbuilder/*` scope — that scope is private to the platform monorepo and must not appear on a publishable package.
- Env names carry the product's initials: `SB_API`, `SB_TOKEN`, `SB_EMAIL`, `SB_PASSWORD`. Plus `WB_REPO` for codegen only (a path to a `web_builder` checkout, never needed at runtime).
- **Secrets come from env only.** The repo is public. No secret is ever written to a file, a log, or a tool result.
- **stdout is the MCP channel.** Every log line is `console.error`. A stray `console.log` corrupts the protocol.
- **ESM / Node16:** every relative import ends in `.js`, including from `.ts` sources.
- Every tool answers through `text()` (or `image()`/`images()`) from `src/mcp/response.ts`. No tool hand-builds a content array.
- **Mutating tools accept `dry_run` and default it to `true`**, returning a credential-redacted preview of the request they would have made.
- Credential routing is by path prefix and is not negotiable: `/api/v1/…` → `SB_TOKEN` (`wbk_…`); every other path → the session JWT. The OpenAPI document declares one `BearerAuth` scheme for both, so it cannot make this decision.
- Gate for every task: `npm run build && npm test && npm run smoke`. Smoke must end with `ALL GOOD`.

---

### Task 1: Repo skeleton and a green gate

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.npmrc`
- Create: `src/index.ts`, `src/server.ts`, `src/mcp/response.ts`, `src/smoke.ts`
- Test: `test/response.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `text(value: unknown): { content: [{ type: 'text'; text: string }] }`; `createServer(): McpServer`; `runSmoke(): Promise<void>`.

- [x] **Step 1: Write `package.json`**

```json
{
  "name": "sbuilder-mcp",
  "version": "0.1.0",
  "description": "MCP server that designs and operates a Store Builder site — pages, data, theme and publish — through the platform's own API and live-edit protocol.",
  "mcpName": "io.github.vuluu2k/sbuilder-mcp",
  "type": "module",
  "license": "MIT",
  "bin": { "sb-mcp": "dist/index.js" },
  "files": ["dist"],
  "engines": { "node": ">=20" },
  "publishConfig": { "access": "public" },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js",
    "smoke": "node dist/smoke.js",
    "test": "vitest run",
    "codegen": "tsx scripts/gen-catalog.ts",
    "prepublishOnly": "npm run build && npm run smoke"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.30.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^3.2.0"
  }
}
```

`zod` is pinned to v3 deliberately: the sibling `webcake-landing-mcp` runs SDK 1.29 against zod 3 in production. zod 4 changes the raw-shape inference `server.tool()` relies on and has not been verified here.

- [x] **Step 2: Write `tsconfig.json` and `vitest.config.ts`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src/**/*.ts"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
```

`.gitignore`:

```
node_modules/
dist/
*.log
.env
```

- [x] **Step 3: Write the failing test**

```ts
// test/response.test.ts
import { describe, it, expect } from 'vitest';
import { text } from '../src/mcp/response.js';

describe('text()', () => {
  it('passes a string through unchanged', () => {
    expect(text('hello')).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });

  it('pretty-prints a non-string', () => {
    expect(text({ a: 1 })).toEqual({ content: [{ type: 'text', text: '{\n  "a": 1\n}' }] });
  });
});
```

- [x] **Step 4: Run it and watch it fail**

Run: `npm install && npx vitest run test/response.test.ts`
Expected: FAIL — `Cannot find module '../src/mcp/response.js'`.

- [x] **Step 5: Write `src/mcp/response.ts`**

```ts
/**
 * The one way a tool answers. Every tool returns through here so the content
 * shape is decided in a single place — a hand-built content array is the shape
 * that drifts.
 */
export function text(value: unknown) {
  const body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text' as const, text: body }] };
}

/** A base64 image, optionally followed by a note the model should read. */
export function image(dataBase64: string, mimeType = 'image/png', note?: unknown) {
  const content: Array<
    { type: 'image'; data: string; mimeType: string } | { type: 'text'; text: string }
  > = [{ type: 'image' as const, data: dataBase64, mimeType }];
  if (note !== undefined) {
    content.push({
      type: 'text' as const,
      text: typeof note === 'string' ? note : JSON.stringify(note, null, 2),
    });
  }
  return { content };
}

/** Several images (e.g. one per breakpoint), optionally followed by a note. */
export function images(
  items: Array<{ dataBase64: string; mimeType?: string }>,
  note?: unknown,
) {
  const content: Array<
    { type: 'image'; data: string; mimeType: string } | { type: 'text'; text: string }
  > = items.map((it) => ({
    type: 'image' as const,
    data: it.dataBase64,
    mimeType: it.mimeType ?? 'image/png',
  }));
  if (note !== undefined) {
    content.push({
      type: 'text' as const,
      text: typeof note === 'string' ? note : JSON.stringify(note, null, 2),
    });
  }
  return { content };
}
```

- [x] **Step 6: Run the test and watch it pass**

Run: `npx vitest run test/response.test.ts`
Expected: PASS, 2 tests.

- [x] **Step 7: Write the server and entry point**

```ts
// src/server.ts
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * The published version, read from package.json at runtime so serverInfo never
 * drifts from what npm shipped. package.json sits one level above both dist/ and
 * src/, so the same relative URL resolves in a build and in a source checkout.
 */
export function pkgVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function createServer(): McpServer {
  return new McpServer(
    { name: 'sbuilder', version: pkgVersion(), title: 'Store Builder' },
    { instructions: 'Design and operate a Store Builder site.' },
  );
}
```

```ts
// src/index.ts
#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error('[sbuilder-mcp] ready on stdio');
}

main().catch((err) => {
  console.error('[sbuilder-mcp] fatal:', err);
  process.exit(1);
});
```

- [x] **Step 8: Write the smoke gate**

```ts
// src/smoke.ts
/**
 * Offline self-test. No network, no MCP transport — just the pure logic, so a
 * broken build fails before anything is published. Must end with ALL GOOD.
 */
import { text } from './mcp/response.js';
import { createServer, pkgVersion } from './server.js';

function check(label: string, ok: boolean): void {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.error(`ok: ${label}`);
}

export async function runSmoke(): Promise<void> {
  check('text() wraps a string', text('x').content[0].text === 'x');
  check('pkgVersion() is not empty', pkgVersion().length > 0);
  check('createServer() builds', createServer() !== null);
  console.error('ALL GOOD');
}

runSmoke().catch((err) => {
  console.error('smoke threw:', err);
  process.exit(1);
});
```

- [x] **Step 9: Run the full gate**

Run: `npm run build && npm test && npm run smoke`
Expected: tsc emits `dist/` with no errors; vitest passes 2 tests; smoke prints `ALL GOOD`.

- [x] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: repo skeleton, response helpers, and a green build/test/smoke gate"
```

---

### Task 2: HTTP transport with the platform's error envelope

**Files:**
- Create: `src/transport/http.ts`
- Test: `test/http.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class ApiError extends Error { status: number; code: string }`; `request(opts: RequestOpts): Promise<unknown>` where `RequestOpts = { base: string; method: string; path: string; token?: string; query?: Record<string, string|number|undefined>; body?: unknown }`; `redact(value: unknown): unknown`.

The platform writes exactly one error shape — `{"error": "human message", "code": "machine_code"}` — through `httpx.WriteError`, and never plain text. A client that reads `res.statusText` throws away the only branchable half.

- [x] **Step 1: Write the failing test**

```ts
// test/http.test.ts
import { describe, it, expect, vi } from 'vitest';
import { request, ApiError, redact } from '../src/transport/http.js';

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('request()', () => {
  it('returns the parsed body on 200', async () => {
    const f = fakeFetch(200, { menus: [], total: 0 });
    const out = await request({ base: 'http://x', method: 'GET', path: '/api/m', fetchImpl: f });
    expect(out).toEqual({ menus: [], total: 0 });
  });

  it('throws ApiError carrying the platform code, not the status text', async () => {
    const f = fakeFetch(401, { error: 'API key required', code: 'api_key_required' });
    await expect(
      request({ base: 'http://x', method: 'GET', path: '/api/v1/products', fetchImpl: f }),
    ).rejects.toMatchObject({ status: 401, code: 'api_key_required' });
  });

  it('sends the bearer token when given one', async () => {
    const f = fakeFetch(200, {});
    await request({ base: 'http://x', method: 'GET', path: '/a', token: 'tok', fetchImpl: f });
    const init = f.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('drops undefined query values', async () => {
    const f = fakeFetch(200, {});
    await request({
      base: 'http://x', method: 'GET', path: '/a',
      query: { limit: 10, cursor: undefined }, fetchImpl: f,
    });
    expect(f.mock.calls[0][0]).toBe('http://x/a?limit=10');
  });
});

describe('redact()', () => {
  it('masks anything that looks like a credential', () => {
    expect(redact({ Authorization: 'Bearer abc', token: 'wbk_secret', name: 'ok' }))
      .toEqual({ Authorization: '[redacted]', token: '[redacted]', name: 'ok' });
  });

  it('recurses into nested objects and arrays', () => {
    expect(redact({ a: [{ password: 'p' }] })).toEqual({ a: [{ password: '[redacted]' }] });
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/http.test.ts`
Expected: FAIL — `Cannot find module '../src/transport/http.js'`.

- [x] **Step 3: Write `src/transport/http.ts`**

```ts
/**
 * The one HTTP path to the platform.
 *
 * The platform writes exactly one error shape — {"error", "code"} — through
 * httpx.WriteError, and NEVER plain text. So an error is parsed, not
 * stringified: `code` is the branchable half and `status` alone loses it.
 */
export interface RequestOpts {
  base: string;
  method: string;
  path: string;
  token?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Keys whose value is a credential wherever it appears. */
const SECRET_KEYS = /^(authorization|token|access_?token|refresh_?token|password|secret|api_?key)$/i;

/**
 * Replace credential-shaped values with a marker, recursively.
 *
 * Used by every dry-run preview. This is the only thing standing between a
 * `dry_run` result and a bearer token in a transcript, so it errs towards
 * masking: it keys off the FIELD NAME, not the value's shape, because a token
 * format can change and a field name is what the caller controls.
 */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redact(v);
    }
    return out;
  }
  return value;
}

export function buildUrl(base: string, path: string, query?: RequestOpts['query']): string {
  const url = base.replace(/\/$/, '') + path;
  if (!query) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

export async function request(opts: RequestOpts): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await doFetch(buildUrl(opts.base, opts.path, opts.query), {
    method: opts.method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  const raw = await res.text();
  let parsed: unknown = undefined;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A non-JSON body from this platform means something upstream of the app
      // answered (a proxy, a 502 page). Say so rather than guessing a code.
      if (!res.ok) throw new ApiError(res.status, 'non_json_response', raw.slice(0, 400));
      return raw;
    }
  }

  if (!res.ok) {
    const env = (parsed ?? {}) as { error?: string; code?: string };
    throw new ApiError(res.status, env.code ?? 'unknown', env.error ?? `HTTP ${res.status}`);
  }
  return parsed;
}
```

- [x] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/http.test.ts`
Expected: PASS, 6 tests.

- [x] **Step 5: Commit**

```bash
git add src/transport/http.ts test/http.test.ts
git commit -m "feat(transport): shared HTTP client with the platform error envelope and redaction"
```

---

### Task 3: Session auth — login, rotate, and a token GETTER

**Files:**
- Create: `src/transport/auth.ts`
- Test: `test/auth.test.ts`

**Interfaces:**
- Consumes: `request`, `ApiError` from `src/transport/http.js`.
- Produces: `class Session { constructor(base: string, fetchImpl?: typeof fetch); login(email: string, password: string): Promise<void>; token(): string; readonly userName: string }`.

The rule this task exists to enforce: **`token()` is read per use, never captured.** The editor shipped this bug and documented the fix (`editor/src/features/realtime/socket.ts`, MF1) — a client holding the string it was constructed with replays an expired token on every reconnect, and the failure is silent. The socket in Phase 3 will take `() => session.token()`, so the getter has to exist from the start.

- [x] **Step 1: Write the failing test**

```ts
// test/auth.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Session } from '../src/transport/auth.js';

function loginFetch(access: string) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        user: { id: 'u1', name: 'Agent' },
        tokens: { accessToken: access, refreshToken: 'r1', tokenType: 'Bearer', expiresIn: 900 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
}

describe('Session', () => {
  it('stores the access token and the user name after login', async () => {
    const s = new Session('http://x', loginFetch('a1'));
    await s.login('e@x', 'pw');
    expect(s.token()).toBe('a1');
    expect(s.userName).toBe('Agent');
  });

  it('throws when token() is called before login', () => {
    const s = new Session('http://x', loginFetch('a1'));
    expect(() => s.token()).toThrow(/not logged in/i);
  });

  it('returns the NEW token after a refresh — the getter is not a snapshot', async () => {
    const f = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const access = body.refreshToken ? 'a2' : 'a1';
      return new Response(
        JSON.stringify({
          user: { id: 'u1', name: 'Agent' },
          tokens: { accessToken: access, refreshToken: 'r2', tokenType: 'Bearer', expiresIn: 900 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const s = new Session('http://x', f as unknown as typeof fetch);
    await s.login('e@x', 'pw');
    const captured = s.token(); // what a buggy caller would have kept
    await s.refresh();
    expect(s.token()).toBe('a2');
    expect(captured).toBe('a1');
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/auth.test.ts`
Expected: FAIL — `Cannot find module '../src/transport/auth.js'`.

- [x] **Step 3: Write `src/transport/auth.ts`**

```ts
import { request } from './http.js';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

interface LoginResponse {
  user: { id: string; name: string };
  tokens: TokenPair;
}

/**
 * A user session against the platform's private API.
 *
 * `token()` is a GETTER, deliberately, and every consumer must call it per use
 * rather than capture its result. The access token lives ~15 minutes and rotates
 * on refresh; a client holding the string it was built with replays an expired
 * token forever, and the failure is silent — no error event, nothing in the UI.
 * The editor shipped exactly that bug (features/realtime/socket.ts, MF1).
 */
export class Session {
  private access: string | null = null;
  private refreshToken: string | null = null;
  private name = '';

  constructor(
    private readonly base: string,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  get userName(): string {
    return this.name;
  }

  token(): string {
    if (!this.access) throw new Error('sbuilder: not logged in — call sb_connect first');
    return this.access;
  }

  async login(email: string, password: string): Promise<void> {
    const out = (await request({
      base: this.base,
      method: 'POST',
      path: '/api/auth/login',
      body: { email, password },
      fetchImpl: this.fetchImpl,
    })) as LoginResponse;
    this.access = out.tokens.accessToken;
    this.refreshToken = out.tokens.refreshToken;
    this.name = out.user?.name ?? '';
  }

  /** Rotate. The platform issues a NEW refresh token each time; keep it. */
  async refresh(): Promise<void> {
    if (!this.refreshToken) throw new Error('sbuilder: no refresh token');
    const out = (await request({
      base: this.base,
      method: 'POST',
      path: '/api/auth/refresh',
      body: { refreshToken: this.refreshToken },
      fetchImpl: this.fetchImpl,
    })) as { tokens: TokenPair };
    this.access = out.tokens.accessToken;
    this.refreshToken = out.tokens.refreshToken;
  }
}
```

- [x] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/auth.test.ts`
Expected: PASS, 3 tests.

- [x] **Step 5: Commit**

```bash
git add src/transport/auth.ts test/auth.test.ts
git commit -m "feat(transport): session login/refresh with a per-use token getter"
```

---

### Task 4: Credential routing by path prefix

**Files:**
- Create: `src/transport/credential.ts`
- Test: `test/credential.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Credential = 'apiKey' | 'session' | 'none'`; `credentialFor(path: string): Credential`.

The OpenAPI document declares one scheme, `BearerAuth`, for both the API key and the session JWT, so it cannot make this call. Getting it wrong is not a soft failure: `/api/v1` answers `401 api_key_required` to a session token, and the private API rejects an API key.

- [x] **Step 1: Write the failing test**

```ts
// test/credential.test.ts
import { describe, it, expect } from 'vitest';
import { credentialFor } from '../src/transport/credential.js';

describe('credentialFor()', () => {
  it('routes /api/v1 to the API key', () => {
    expect(credentialFor('/api/v1/products')).toBe('apiKey');
    expect(credentialFor('/api/v1/pages/pg_1/publish')).toBe('apiKey');
  });

  it('routes the private site API to the session', () => {
    expect(credentialFor('/api/sites/s1/menus')).toBe('session');
    expect(credentialFor('/api/sites/s1/pages/p1/source')).toBe('session');
  });

  it('routes the auth endpoints to no credential', () => {
    expect(credentialFor('/api/auth/login')).toBe('none');
    expect(credentialFor('/api/auth/refresh')).toBe('none');
  });

  it('defaults an unknown path to the session, not the API key', () => {
    expect(credentialFor('/api/orgs')).toBe('session');
  });

  it('is not fooled by a v1-looking segment further along the path', () => {
    expect(credentialFor('/api/sites/s1/apps/v1/blocks')).toBe('session');
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/credential.test.ts`
Expected: FAIL — `Cannot find module '../src/transport/credential.js'`.

- [x] **Step 3: Write `src/transport/credential.ts`**

```ts
/**
 * Which credential opens a given path.
 *
 * This CANNOT come from the OpenAPI document: it declares a single `BearerAuth`
 * scheme covering both the merchant API key and the user session JWT (212
 * operations carry it, 92 carry none). The platform, meanwhile, refuses each on
 * the other's surface — /api/v1 answers `401 api_key_required` to a session
 * token — so the routing rule lives here, in one tested function.
 *
 * The default is `session`, not `apiKey`, because the private API is the larger
 * surface and a session token is the credential with the narrower blast radius
 * per call (it is scoped by the caller's RBAC role, re-checked per request).
 */
export type Credential = 'apiKey' | 'session' | 'none';

export function credentialFor(path: string): Credential {
  if (path.startsWith('/api/auth/')) return 'none';
  if (path === '/api/v1' || path.startsWith('/api/v1/')) return 'apiKey';
  return 'session';
}
```

- [x] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/credential.test.ts`
Expected: PASS, 5 tests.

- [x] **Step 5: Commit**

```bash
git add src/transport/credential.ts test/credential.test.ts
git commit -m "feat(transport): route credentials by path prefix, which the OpenAPI doc cannot"
```

---

### Task 5: Generate the API operation index from `swagger.json`

**Files:**
- Create: `scripts/gen-catalog.ts`
- Create: `src/catalog/types.ts`
- Create (generated, committed): `src/catalog/api.generated.ts`
- Test: `test/api-index.test.ts`

**Interfaces:**
- Consumes: `credentialFor` from `src/transport/credential.js`.
- Produces: `interface ApiOperation { id: string; method: string; path: string; tags: string[]; summary: string; params: ApiParam[]; bodyDescribed: boolean; bodyRef: string | null; credential: Credential; }`; `interface ApiParam { name: string; in: 'path'|'query'|'body'|'header'; required: boolean; type: string; description: string }`; `const API_OPERATIONS: ApiOperation[]`; `const API_DEFINITIONS: Record<string, unknown>`; `const SWAGGER_SOURCE: { operations: number; generatedFrom: string }`.

Facts measured from the real document, which the generator asserts rather than assumes: 205 paths, 310 operations, 85 definitions, **no `operationId` anywhere**, and **58 of 140 body-carrying operations have an opaque body**.

- [x] **Step 1: Write `src/catalog/types.ts`**

```ts
import type { Credential } from '../transport/credential.js';

export interface ApiParam {
  name: string;
  in: 'path' | 'query' | 'body' | 'header';
  required: boolean;
  type: string;
  description: string;
}

export interface ApiOperation {
  /** Synthesized `method:path` — the document carries no operationId. */
  id: string;
  method: string;
  path: string;
  tags: string[];
  summary: string;
  params: ApiParam[];
  /** False when the body is a loose object with no $ref to resolve. */
  bodyDescribed: boolean;
  /** Definition name (not the full `#/definitions/` ref), or null. */
  bodyRef: string | null;
  credential: Credential;
}
```

- [x] **Step 2: Write the failing test**

```ts
// test/api-index.test.ts
import { describe, it, expect } from 'vitest';
import { API_OPERATIONS, API_DEFINITIONS, SWAGGER_SOURCE } from '../src/catalog/api.generated.js';

describe('generated API index', () => {
  it('carries every operation in the document', () => {
    expect(API_OPERATIONS.length).toBe(SWAGGER_SOURCE.operations);
    expect(API_OPERATIONS.length).toBeGreaterThan(300);
  });

  it('has unique ids — the document has no operationId to fall back on', () => {
    const ids = new Set(API_OPERATIONS.map((o) => o.id));
    expect(ids.size).toBe(API_OPERATIONS.length);
  });

  it('routes /api/v1 operations to the API key and site operations to the session', () => {
    const v1 = API_OPERATIONS.find((o) => o.path.startsWith('/api/v1/'));
    expect(v1?.credential).toBe('apiKey');
    const site = API_OPERATIONS.find((o) => o.path.startsWith('/api/sites/'));
    expect(site?.credential).toBe('session');
  });

  it('knows the page source route and flags its body as undescribed', () => {
    const op = API_OPERATIONS.find(
      (o) => o.method === 'PUT' && o.path === '/api/sites/{siteId}/pages/{pageId}/source',
    );
    expect(op).toBeDefined();
    expect(op!.bodyDescribed).toBe(false);
  });

  it('resolves a body $ref into a real definition when there is one', () => {
    const described = API_OPERATIONS.filter((o) => o.bodyDescribed);
    expect(described.length).toBeGreaterThan(50);
    for (const o of described.slice(0, 20)) {
      expect(API_DEFINITIONS[o.bodyRef!]).toBeDefined();
    }
  });
});
```

- [x] **Step 3: Run it and watch it fail**

Run: `npx vitest run test/api-index.test.ts`
Expected: FAIL — `Cannot find module '../src/catalog/api.generated.js'`.

- [x] **Step 4: Write `scripts/gen-catalog.ts`**

```ts
/**
 * Emit src/catalog/api.generated.ts from a web_builder checkout's OpenAPI
 * document.
 *
 * WHY A BUILD STEP AND NOT A RUNTIME FETCH: server/docs/swagger.json is itself a
 * generated, committed, drift-tested artifact in that repo (`npm run docs:api`).
 * Reading it at build time couples this repo to a maintained data file rather
 * than to a moving codebase — which is the whole reason a separate repository
 * works here.
 *
 * Run: WB_REPO=/path/to/web_builder npm run codegen
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { credentialFor } from '../src/transport/credential.js';
import type { ApiOperation, ApiParam } from '../src/catalog/types.js';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface SwaggerParam {
  name?: string;
  in?: string;
  required?: boolean;
  type?: string;
  description?: string;
  schema?: { $ref?: string; items?: { $ref?: string } };
}

function refName(ref: string | undefined): string | null {
  if (!ref) return null;
  const m = /^#\/definitions\/(.+)$/.exec(ref);
  return m ? m[1] : null;
}

function main(): void {
  const repo = process.env.WB_REPO;
  if (!repo) {
    console.error('WB_REPO is not set — point it at a web_builder checkout');
    process.exit(1);
  }
  const specPath = resolve(repo, 'server/docs/swagger.json');
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
    definitions?: Record<string, unknown>;
  };

  const ops: ApiOperation[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = item[method] as
        | { tags?: string[]; summary?: string; parameters?: SwaggerParam[] }
        | undefined;
      if (!op) continue;

      const params: ApiParam[] = [];
      let bodyRef: string | null = null;
      let bodyDescribed = false;
      for (const p of op.parameters ?? []) {
        if (p.in === 'body') {
          bodyRef = refName(p.schema?.$ref) ?? refName(p.schema?.items?.$ref);
          bodyDescribed = bodyRef !== null;
        }
        params.push({
          name: p.name ?? '',
          in: (p.in as ApiParam['in']) ?? 'query',
          required: p.required === true,
          type: p.type ?? (p.in === 'body' ? 'object' : 'string'),
          description: p.description ?? '',
        });
      }

      ops.push({
        id: `${method}:${path}`,
        method: method.toUpperCase(),
        path,
        tags: op.tags ?? [],
        summary: op.summary ?? '',
        params,
        bodyDescribed,
        bodyRef,
        credential: credentialFor(path),
      });
    }
  }

  // The document has no operationId, so ids are synthesized. If two ever
  // collide the index silently loses an operation — assert instead.
  const ids = new Set(ops.map((o) => o.id));
  if (ids.size !== ops.length) {
    console.error(`duplicate operation ids: ${ops.length - ids.size}`);
    process.exit(1);
  }
  if (ops.length < 300) {
    console.error(`only ${ops.length} operations — expected 300+; is WB_REPO stale?`);
    process.exit(1);
  }

  const out = `// GENERATED by scripts/gen-catalog.ts — do not edit by hand.
// Source: <WB_REPO>/server/docs/swagger.json
import type { ApiOperation } from './types.js';

export const SWAGGER_SOURCE = ${JSON.stringify(
    { operations: ops.length, generatedFrom: 'server/docs/swagger.json' },
    null,
    2,
  )} as const;

export const API_OPERATIONS: ApiOperation[] = ${JSON.stringify(ops, null, 2)};

export const API_DEFINITIONS: Record<string, unknown> = ${JSON.stringify(
    spec.definitions ?? {},
    null,
    2,
  )};
`;
  const dest = resolve(process.cwd(), 'src/catalog/api.generated.ts');
  writeFileSync(dest, out, 'utf8');
  console.error(
    `wrote ${dest}: ${ops.length} operations, ${Object.keys(spec.definitions ?? {}).length} definitions, ` +
      `${ops.filter((o) => o.params.some((p) => p.in === 'body') && !o.bodyDescribed).length} with an undescribed body`,
  );
}

main();
```

- [x] **Step 5: Run the generator**

Run: `WB_REPO=/Volumes/workspace/webcake/web_builder npm run codegen`
Expected: stderr reports `310 operations, 85 definitions, 58 with an undescribed body`.

- [x] **Step 6: Run the test and watch it pass**

Run: `npx vitest run test/api-index.test.ts`
Expected: PASS, 5 tests.

- [x] **Step 7: Commit, including the generated file**

The generated file is committed on purpose: `npm install` of this package must work with no `web_builder` checkout anywhere.

```bash
git add scripts/gen-catalog.ts src/catalog/types.ts src/catalog/api.generated.ts test/api-index.test.ts
git commit -m "feat(catalog): generate the 310-operation API index from the platform OpenAPI doc"
```

---

### Task 6: `sb_api_find` — search 310 operations by intent

**Files:**
- Create: `src/catalog/search.ts`
- Create: `src/tools/api.ts`
- Test: `test/api-search.test.ts`

**Interfaces:**
- Consumes: `API_OPERATIONS`, `API_DEFINITIONS` from `src/catalog/api.generated.js`.
- Produces: `searchOperations(query: string, opts?: { tag?: string; limit?: number }): ApiOperation[]`; `describeOperation(op: ApiOperation): Record<string, unknown>`; `registerApiTools(server: McpServer, ctx: ToolContext): void`.

Scoring is deliberately plain — term hits weighted by field — because the caller is a language model that will re-query with better words when the first list is wrong. A fuzzy ranker would make wrong answers look confident.

- [x] **Step 1: Write the failing test**

```ts
// test/api-search.test.ts
import { describe, it, expect } from 'vitest';
import { searchOperations, describeOperation } from '../src/catalog/search.js';

describe('searchOperations()', () => {
  it('finds menu operations from the word "menu"', () => {
    const hits = searchOperations('menu');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((o) => o.path.includes('menu') || o.tags.includes('menus'))).toBe(true);
  });

  it('ranks a tag match above an incidental path match', () => {
    const hits = searchOperations('products');
    expect(hits[0].tags.includes('products') || hits[0].path.includes('product')).toBe(true);
  });

  it('filters by tag when asked', () => {
    const hits = searchOperations('list', { tag: 'menus' });
    expect(hits.every((o) => o.tags.includes('menus'))).toBe(true);
  });

  it('honours the limit', () => {
    expect(searchOperations('site', { limit: 3 }).length).toBeLessThanOrEqual(3);
  });

  it('returns an empty list rather than everything for nonsense', () => {
    expect(searchOperations('zzzzqqqq')).toEqual([]);
  });
});

describe('describeOperation()', () => {
  it('flags an undescribed body loudly', () => {
    const op = searchOperations('source', { limit: 50 }).find(
      (o) => o.method === 'PUT' && o.path.endsWith('/source'),
    )!;
    const d = describeOperation(op) as Record<string, unknown>;
    expect(String(d.body_warning)).toMatch(/not described/i);
  });

  it('inlines the definition when the body IS described', () => {
    const op = searchOperations('', { limit: 400 }).find((o) => o.bodyDescribed)!;
    const d = describeOperation(op) as Record<string, unknown>;
    expect(d.body_schema).toBeDefined();
    expect(d.body_warning).toBeUndefined();
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/api-search.test.ts`
Expected: FAIL — `Cannot find module '../src/catalog/search.js'`.

- [x] **Step 3: Write `src/catalog/search.ts`**

```ts
import { API_OPERATIONS, API_DEFINITIONS } from './api.generated.js';
import type { ApiOperation } from './types.js';

/**
 * Term-hit scoring, weighted by field, and deliberately not fuzzy.
 *
 * The caller is a language model that can re-query with better words. A fuzzy
 * ranker's failure mode is worse than an empty list: it returns a confident
 * wrong operation, and the model then calls it.
 */
const WEIGHT = { tag: 5, path: 3, summary: 2 } as const;

export function searchOperations(
  query: string,
  opts: { tag?: string; limit?: number } = {},
): ApiOperation[] {
  const limit = opts.limit ?? 12;
  const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let pool = API_OPERATIONS;
  if (opts.tag) pool = pool.filter((o) => o.tags.includes(opts.tag!));
  if (terms.length === 0) return pool.slice(0, limit);

  const scored: Array<{ op: ApiOperation; score: number }> = [];
  for (const op of pool) {
    const tags = op.tags.join(' ').toLowerCase();
    const path = op.path.toLowerCase();
    const summary = op.summary.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (tags.includes(t)) score += WEIGHT.tag;
      if (path.includes(t)) score += WEIGHT.path;
      if (summary.includes(t)) score += WEIGHT.summary;
    }
    if (score > 0) scored.push({ op, score });
  }
  scored.sort((a, b) => b.score - a.score || a.op.id.localeCompare(b.op.id));
  return scored.slice(0, limit).map((s) => s.op);
}

/** The full call sheet for one operation, including what is NOT known about it. */
export function describeOperation(op: ApiOperation): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: op.id,
    method: op.method,
    path: op.path,
    summary: op.summary,
    tags: op.tags,
    credential: op.credential,
    params: op.params.filter((p) => p.in !== 'body'),
  };
  const hasBody = op.params.some((p) => p.in === 'body');
  if (hasBody && op.bodyDescribed && op.bodyRef) {
    out.body_schema = API_DEFINITIONS[op.bodyRef];
  } else if (hasBody) {
    out.body_warning =
      'This operation takes a body but the OpenAPI document does not describe it ' +
      '(no $ref). Do not guess a shape: read an existing item with the matching GET ' +
      'first and send back a modified copy.';
  }
  return out;
}
```

- [x] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/api-search.test.ts`
Expected: PASS, 7 tests.

- [x] **Step 5: Commit**

```bash
git add src/catalog/search.ts test/api-search.test.ts
git commit -m "feat(catalog): intent search over the API index, with an explicit undescribed-body warning"
```

---

### Task 7: `sb_api_call` — execute an indexed operation

**Files:**
- Create: `src/tools/context.ts`
- Modify: `src/tools/api.ts`
- Test: `test/api-call.test.ts`

**Interfaces:**
- Consumes: `request`, `redact`, `ApiError`; `Session`; `credentialFor`; `API_OPERATIONS`.
- Produces: `interface ToolContext { base: string; session: Session; apiKey?: string; fetchImpl?: typeof fetch }`; `callOperation(ctx: ToolContext, args: CallArgs): Promise<unknown>` where `CallArgs = { id: string; path_params?: Record<string,string>; query?: Record<string,string>; body?: unknown; dry_run?: boolean }`.

- [x] **Step 1: Write the failing test**

```ts
// test/api-call.test.ts
import { describe, it, expect, vi } from 'vitest';
import { callOperation } from '../src/tools/api.js';
import { Session } from '../src/transport/auth.js';

function ctxWith(fetchImpl: typeof fetch) {
  const session = new Session('http://x', fetchImpl);
  // Give the session a token without a network round trip.
  (session as unknown as { access: string }).access = 'jwt';
  return { base: 'http://x', session, apiKey: 'wbk_k', fetchImpl };
}

const ok = () =>
  vi.fn(async () =>
    new Response(JSON.stringify({ menus: [], total: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;

describe('callOperation()', () => {
  it('substitutes path params', async () => {
    const f = ok();
    await callOperation(ctxWith(f), {
      id: 'get:/api/sites/{siteID}/menus',
      path_params: { siteID: 's1' },
      dry_run: false,
    });
    expect((f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])
      .toBe('http://x/api/sites/s1/menus');
  });

  it('refuses when a required path param is missing', async () => {
    await expect(
      callOperation(ctxWith(ok()), { id: 'get:/api/sites/{siteID}/menus', dry_run: false }),
    ).rejects.toThrow(/siteID/);
  });

  it('refuses an unknown operation id', async () => {
    await expect(
      callOperation(ctxWith(ok()), { id: 'get:/nope', dry_run: false }),
    ).rejects.toThrow(/unknown operation/i);
  });

  it('sends the session token for a private path', async () => {
    const f = ok();
    await callOperation(ctxWith(f), {
      id: 'get:/api/sites/{siteID}/menus',
      path_params: { siteID: 's1' },
      dry_run: false,
    });
    const init = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
  });

  it('sends the API key for a /api/v1 path', async () => {
    const f = ok();
    await callOperation(ctxWith(f), { id: 'get:/api/v1/products', dry_run: false });
    const init = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer wbk_k');
  });

  it('defaults to a dry run that touches no network and redacts the token', async () => {
    const f = ok();
    const out = (await callOperation(ctxWith(f), {
      id: 'get:/api/sites/{siteID}/menus',
      path_params: { siteID: 's1' },
    })) as Record<string, unknown>;
    expect((f as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);
    expect(out.dry_run).toBe(true);
    expect(JSON.stringify(out)).not.toContain('jwt');
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/api-call.test.ts`
Expected: FAIL — `callOperation` is not exported.

- [x] **Step 3: Write `src/tools/context.ts`**

```ts
import type { Session } from '../transport/auth.js';

/** Everything a tool needs to reach the platform. Built once in index.ts. */
export interface ToolContext {
  base: string;
  session: Session;
  apiKey?: string;
  /** Injected in tests; undefined means global fetch. */
  fetchImpl?: typeof fetch;
}
```

- [x] **Step 4: Write `callOperation` in `src/tools/api.ts`**

```ts
import { API_OPERATIONS } from '../catalog/api.generated.js';
import { request, redact } from '../transport/http.js';
import type { ToolContext } from './context.js';

export interface CallArgs {
  id: string;
  path_params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  dry_run?: boolean;
}

function tokenFor(ctx: ToolContext, credential: string): string | undefined {
  if (credential === 'apiKey') {
    if (!ctx.apiKey) throw new Error('sbuilder: SB_TOKEN is not set — /api/v1 needs an API key');
    return ctx.apiKey;
  }
  if (credential === 'session') return ctx.session.token();
  return undefined;
}

export async function callOperation(ctx: ToolContext, args: CallArgs): Promise<unknown> {
  const op = API_OPERATIONS.find((o) => o.id === args.id);
  if (!op) throw new Error(`sbuilder: unknown operation "${args.id}" — use sb_api_find first`);

  // Substitute {name} placeholders; a missing one would otherwise be sent
  // literally and 404 against a path containing a brace.
  let path = op.path;
  for (const m of op.path.matchAll(/\{([^}]+)\}/g)) {
    const name = m[1];
    const value = args.path_params?.[name];
    if (value === undefined) {
      throw new Error(`sbuilder: operation ${op.id} needs path param "${name}"`);
    }
    path = path.replace(`{${name}}`, encodeURIComponent(value));
  }

  const token = tokenFor(ctx, op.credential);
  const dryRun = args.dry_run !== false;
  if (dryRun) {
    return {
      dry_run: true,
      would_send: redact({
        method: op.method,
        url: ctx.base.replace(/\/$/, '') + path,
        query: args.query,
        Authorization: token ? `Bearer ${token}` : undefined,
        body: args.body,
      }),
      note: 'Nothing was sent. Re-call with dry_run:false to execute.',
    };
  }

  return request({
    base: ctx.base,
    method: op.method,
    path,
    token,
    query: args.query,
    body: args.body,
    fetchImpl: ctx.fetchImpl,
  });
}
```

- [x] **Step 5: Run the test and watch it pass**

Run: `npx vitest run test/api-call.test.ts`
Expected: PASS, 6 tests.

- [x] **Step 6: Register both tools**

Append to `src/tools/api.ts`:

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { searchOperations, describeOperation } from '../catalog/search.js';
import { text } from '../mcp/response.js';

export function registerApiTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'sb_api_find',
    'Find platform API operations by intent. Returns each match with its real parameter ' +
      'schema and which credential it needs. Use this before sb_api_call — the tool list ' +
      'holds 18 tools, but this index reaches all 310 operations.',
    {
      query: z.string().describe('What you want to do, in words: "create a menu", "list orders"'),
      tag: z.string().optional().describe('Narrow to one tag, e.g. "menus", "products"'),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async ({ query, tag, limit }) =>
      text(searchOperations(query, { tag, limit }).map(describeOperation)),
  );

  server.tool(
    'sb_api_call',
    'Execute one operation found by sb_api_find. Defaults to a dry run that sends nothing.',
    {
      id: z.string().describe('Operation id from sb_api_find, e.g. "get:/api/sites/{siteID}/menus"'),
      path_params: z.record(z.string()).optional(),
      query: z.record(z.string()).optional(),
      body: z.unknown().optional(),
      dry_run: z.boolean().optional().describe('Defaults to true. Pass false to actually send.'),
    },
    async (args) => text(await callOperation(ctx, args as CallArgs)),
  );
}
```

- [x] **Step 7: Run the gate**

Run: `npm run build && npm test && npm run smoke`
Expected: all green; smoke prints `ALL GOOD`.

- [x] **Step 8: Commit**

```bash
git add src/tools/context.ts src/tools/api.ts test/api-call.test.ts
git commit -m "feat(tools): sb_api_find and sb_api_call — full 310-operation reach in two tools"
```

---

### Task 8: `sb_connect` and `sb_site_list`, with the version stamp check

**Files:**
- Create: `src/tools/session.ts`
- Modify: `src/server.ts`, `src/index.ts`, `src/smoke.ts`
- Test: `test/connect.test.ts`

**Interfaces:**
- Consumes: `Session`, `callOperation`, `ToolContext`, `text`.
- Produces: `registerSessionTools(server: McpServer, ctx: ToolContext): void`; `connect(ctx: ToolContext, args: { email?: string; password?: string }): Promise<ConnectResult>` where `ConnectResult = { user: string; sites: Array<{id: string; name: string}>; api_key: 'present'|'missing'; operations: number }`.

`sb_connect` is the only tool that may read `SB_EMAIL`/`SB_PASSWORD`, and it never echoes them.

- [x] **Step 1: Write the failing test**

```ts
// test/connect.test.ts
import { describe, it, expect, vi } from 'vitest';
import { connect } from '../src/tools/session.js';
import { Session } from '../src/transport/auth.js';

function scriptedFetch() {
  return vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.endsWith('/api/auth/login')) {
      return new Response(
        JSON.stringify({
          user: { id: 'u1', name: 'Agent' },
          tokens: { accessToken: 'a1', refreshToken: 'r1', tokenType: 'Bearer', expiresIn: 900 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ sites: [{ id: 's1', name: 'Shop' }], total: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('connect()', () => {
  it('logs in and lists the sites', async () => {
    const f = scriptedFetch();
    const ctx = { base: 'http://x', session: new Session('http://x', f), apiKey: 'wbk_k', fetchImpl: f };
    const out = await connect(ctx, { email: 'e@x', password: 'pw' });
    expect(out.user).toBe('Agent');
    expect(out.sites).toEqual([{ id: 's1', name: 'Shop' }]);
    expect(out.api_key).toBe('present');
    expect(out.operations).toBeGreaterThan(300);
  });

  it('reports a missing API key without failing — half the surface still works', async () => {
    const f = scriptedFetch();
    const ctx = { base: 'http://x', session: new Session('http://x', f), fetchImpl: f };
    const out = await connect(ctx, { email: 'e@x', password: 'pw' });
    expect(out.api_key).toBe('missing');
  });

  it('never echoes the password', async () => {
    const f = scriptedFetch();
    const ctx = { base: 'http://x', session: new Session('http://x', f), fetchImpl: f };
    const out = await connect(ctx, { email: 'e@x', password: 'hunter2' });
    expect(JSON.stringify(out)).not.toContain('hunter2');
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/connect.test.ts`
Expected: FAIL — `Cannot find module '../src/tools/session.js'`.

- [x] **Step 3: Write `src/tools/session.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { request } from '../transport/http.js';
import { text } from '../mcp/response.js';
import { API_OPERATIONS } from '../catalog/api.generated.js';
import type { ToolContext } from './context.js';

export interface ConnectResult {
  user: string;
  sites: Array<{ id: string; name: string }>;
  api_key: 'present' | 'missing';
  operations: number;
  note?: string;
}

/**
 * Log in and report what this server can reach.
 *
 * A missing API key is REPORTED, not thrown: the session half of the surface —
 * pages, menus, theme, overlays, settings — works without one, and failing the
 * whole connect over it would hide that.
 */
export async function connect(
  ctx: ToolContext,
  args: { email?: string; password?: string },
): Promise<ConnectResult> {
  const email = args.email ?? process.env.SB_EMAIL;
  const password = args.password ?? process.env.SB_PASSWORD;
  if (!email || !password) {
    throw new Error('sbuilder: set SB_EMAIL and SB_PASSWORD, or pass email and password');
  }
  await ctx.session.login(email, password);

  const listed = (await request({
    base: ctx.base,
    method: 'GET',
    path: '/api/sites',
    token: ctx.session.token(),
    fetchImpl: ctx.fetchImpl,
  })) as { sites?: Array<{ id: string; name: string }> };

  const result: ConnectResult = {
    user: ctx.session.userName,
    sites: (listed.sites ?? []).map((s) => ({ id: s.id, name: s.name })),
    api_key: ctx.apiKey ? 'present' : 'missing',
    operations: API_OPERATIONS.length,
  };
  if (!ctx.apiKey) {
    result.note =
      'SB_TOKEN is not set, so /api/v1 operations (products, orders, customers, media, ' +
      'blog, webhooks) will be refused with api_key_required. The private site API is unaffected.';
  }
  return result;
}

export function registerSessionTools(server: McpServer, ctx: ToolContext): void {
  server.tool(
    'sb_connect',
    'Log in and list the sites this account can operate. Call this first. Reads SB_EMAIL ' +
      'and SB_PASSWORD from the environment unless you pass them.',
    {
      email: z.string().optional(),
      password: z.string().optional(),
    },
    async (args) => text(await connect(ctx, args)),
  );

  server.tool(
    'sb_site_list',
    'List the sites this account can operate.',
    {},
    async () =>
      text(
        await request({
          base: ctx.base,
          method: 'GET',
          path: '/api/sites',
          token: ctx.session.token(),
          fetchImpl: ctx.fetchImpl,
        }),
      ),
  );
}
```

- [x] **Step 4: Run the test and watch it pass**

Run: `npx vitest run test/connect.test.ts`
Expected: PASS, 3 tests.

- [x] **Step 5: Wire it all together in `src/server.ts` and `src/index.ts`**

Replace `createServer` in `src/server.ts`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Session } from './transport/auth.js';
import { registerApiTools } from './tools/api.js';
import { registerSessionTools } from './tools/session.js';
import type { ToolContext } from './tools/context.js';

const INSTRUCTIONS = `Design and operate a Store Builder site.

Call sb_connect first. Then:
- sb_api_find describes what the platform can do; sb_api_call executes it. Between
  them they reach all 310 API operations, so most merchant work needs no other tool.
- Mutating calls default to dry_run:true and send nothing. Pass dry_run:false to act.
- /api/v1 paths need SB_TOKEN; every other path uses the session from sb_connect.`;

export function buildContext(): ToolContext {
  const base = process.env.SB_API ?? 'http://localhost:8080';
  return { base, session: new Session(base), apiKey: process.env.SB_TOKEN };
}

export function createServer(ctx: ToolContext = buildContext()): McpServer {
  const server = new McpServer(
    { name: 'sbuilder', version: pkgVersion(), title: 'Store Builder' },
    { instructions: INSTRUCTIONS },
  );
  registerSessionTools(server, ctx);
  registerApiTools(server, ctx);
  return server;
}
```

(`pkgVersion` stays as written in Task 1.)

- [x] **Step 6: Extend the smoke gate**

Add to `runSmoke()` in `src/smoke.ts`, before the `ALL GOOD` line:

```ts
  const { API_OPERATIONS } = await import('./catalog/api.generated.js');
  check('API index has 300+ operations', API_OPERATIONS.length > 300);
  check(
    'every operation has a credential',
    API_OPERATIONS.every((o) => ['apiKey', 'session', 'none'].includes(o.credential)),
  );
  const { searchOperations } = await import('./catalog/search.js');
  check('search finds menu operations', searchOperations('menu').length > 0);
```

- [x] **Step 7: Run the full gate**

Run: `npm run build && npm test && npm run smoke`
Expected: all green; smoke prints `ALL GOOD`.

- [x] **Step 8: Verify the server actually starts and lists its tools**

Run: `npx -y @modelcontextprotocol/inspector node dist/index.js`
Expected: the inspector connects and shows 4 tools — `sb_connect`, `sb_site_list`, `sb_api_find`, `sb_api_call`. Close it when confirmed.

- [x] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(tools): sb_connect and sb_site_list; wire the server end to end"
```

---

### Task 9: The repo's own kit and docs

**Files:**
- Create: `CLAUDE.md`, `AGENTS.md`, `README.md`, `README.vi.md`, `LICENSE`
- Create: `docs/tools.md`, `docs/tools.vi.md`, `docs/configuration.md`, `docs/configuration.vi.md`
- Create: `.claude/skills/sbuilder-mcp-tools/SKILL.md`
- Create: `.claude/agents/mcp-tool-author.md`, `.claude/agents/mcp-verifier.md`

**Interfaces:**
- Consumes: everything built above (documents it).
- Produces: no code.

Docs are bilingual (`*.md` + `*.vi.md`), matching `webcake-landing-mcp` and `@sbuilder/cli`.

- [x] **Step 1: Write `CLAUDE.md`**

It must state, at minimum: what the server is; the gate (`npm run build && npm test && npm run smoke`, ending `ALL GOOD`); the Global Constraints from this plan verbatim; the credential routing rule; where a new tool goes (`src/tools/*.ts`, registered in `server.ts`, documented in `docs/tools.md` + `.vi`, listed in the README table); and the codegen command with `WB_REPO`.

- [x] **Step 2: Write `AGENTS.md`**

One paragraph pointing non-Claude agents at `CLAUDE.md`, matching how `web_builder` does it.

- [x] **Step 3: Write the READMEs**

Both carry an at-a-glance tool table, the four env vars, an install snippet, and the two-credential explanation.

- [x] **Step 4: Write the skill**

`.claude/skills/sbuilder-mcp-tools/SKILL.md` — frontmatter `name` + `description` with trigger words ("add a tool", "change a tool", "the MCP surface"), then the tool-authoring rules: `text()` only, `dry_run` default true, `console.error` only, register in three places, add a test.

- [x] **Step 5: Write the two agents**

`mcp-tool-author` (adds or modifies a tool, enforces the rules above) and `mcp-verifier` (runs the gate, checks conventions, never edits). Model the frontmatter on `web_builder`'s `.claude/agents/`.

- [x] **Step 6: Verify the kit loads**

Run: `ls .claude/skills .claude/agents && npm run build && npm test && npm run smoke`
Expected: files present; gate green.

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: repo kit, bilingual docs, and the tool-authoring skill"
```

---

## Self-review

**Spec coverage.** §2 codegen → Task 5. §3 credentials → Tasks 3, 4, 7. §4 layout → Tasks 1–8 create `core/`-free foundations; `domains/site/`, `live/`, `vision/` are Phase 2–3 by the phase map. §7 Tier 2 → Tasks 6–7. §7 conventions (`text()`, `dry_run`, outline compression, batching) → Tasks 1, 7; outline/batching land in Phase 2 with the tools they govern. §9 anti-drift tripwire 1 (version stamp) is **partially** covered: Task 5 asserts operation count and id uniqueness, but the `schema_version` comparison needs the element catalog, which is Phase 2 — recorded there rather than left implicit. §10 gates → Tasks 1, 8. §5, §6, §8 are Phase 2–3 by design.

**Placeholder scan.** No TBD/TODO. Every code step carries real code. Task 9's steps describe documents rather than showing them in full, which is correct for prose deliverables — but each names its required contents explicitly rather than saying "write docs".

**Type consistency.** `ToolContext` is defined once (Task 7) and consumed by Tasks 7–8 with the same field names (`base`, `session`, `apiKey`, `fetchImpl`). `ApiOperation.credential` is the `Credential` union from Task 4 throughout. `text()` has one signature everywhere. `Session.token()` is a method, not a property, in every call site.
