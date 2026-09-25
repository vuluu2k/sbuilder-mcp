/**
 * The one HTTP path to the platform.
 *
 * The platform writes exactly ONE error shape — {"error": "...", "code": "..."} —
 * through httpx.WriteError, and never plain text, and two supersets of it:
 * `details` (WriteErrorCodeDetails) and `fields` (fielderrors.go, beside
 * `code: "validation"`) — carried, never required. So an error is parsed, not
 * stringified: `code` is the branchable half, and reading `res.statusText`
 * instead throws it away. A bare "Conflict" reaching the model is the failure
 * this file exists to prevent; a bare "invalid" with the offending field
 * dropped on the floor is the second.
 */
import { identityHeaders } from './identity.js';
import { canonicalRoot, PAGE_ROOT_ID } from '../domains/site/ids.js';
export interface RequestOpts {
  base: string;
  method: string;
  path: string;
  token?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Extra request headers (`X-WB-Live-Peer`). */
  headers?: Record<string, string>;
  /** Injected in tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Whatever WriteErrorCodeDetails attached — shape is the endpoint's. */
    readonly details?: unknown,
    /** Per-field messages from a validation failure: which field, and why. */
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Keys whose value is a credential wherever it appears.
 *
 * A SUBSTRING MATCH, not an anchored one. It was anchored while the only
 * free-form objects reaching `redact()` were bodies a CALLER supplied, where the
 * key names are the caller's own. `sb_undo` changed that: it echoes a body read
 * back from the PLATFORM, whose vocabulary this repo does not choose, and which
 * spells credentials `clientSecret`, `secretKey`, `checksumKey` and
 * `credentials` — every one of which an anchored `^secret$` lets through.
 *
 * The platform's own credential vocabulary, read off `internal/payments`:
 * `accessKey`, `apiKey`, `checksumKey`, `clientSecret`, `hashSecret`, `secretKey`,
 * `webhookSecret`, `orderToken`, `signature`, `credentials` — and a bare `key`.
 *
 * `key` needs a character in front of it (`[a-z_]key`), so the bare one does NOT
 * match. That is deliberate and it is not a hole: a bare `key` appears inside a
 * `credentials` map, and `credentials` is replaced WHOLE before the recursion
 * reaches its children. Matching it unqualified would instead redact the `key` of
 * every translation row, which is a preview nobody can read.
 *
 * Over-redaction is otherwise the safe direction: a `[redacted]` where none was
 * needed costs a reader one question, and the alternative costs a merchant a
 * gateway key in a transcript.
 */
const SECRET_KEYS = /(authorization|token|password|passphrase|secret|credential|signature|[a-z_]key)/i;

/**
 * Replace credential-shaped values with a marker, recursively.
 *
 * Every preview that can carry a FREE-FORM object goes through this — `sb_api_call`'s
 * body, `sb_page_create`'s `settings`, and `sb_undo`'s `would_restore`, which is
 * the one sourced from the PLATFORM rather than from the caller. The rest of the
 * dry-run previews echo patch counts or bodies built from narrow arguments, which
 * cannot hold a credential.
 *
 * It keys off the FIELD NAME rather than the value's shape on purpose: a token
 * format can change tomorrow, while a field name is stable. The platform masks
 * its own secrets on the way out — a gateway's GET drops every field marked
 * `Secret`, mail settings answer `hasPassword` rather than the password — so this
 * is the second line, not the first. A second line that only fires on names this
 * repo happens to use is not one.
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

/** A write that carries a PAGE document: create, source save, the partner PATCH. */
const PAGE_WRITE = /\/pages(\/[^/]+(\/source)?)?$/;

/**
 * EVERY PAGE DOCUMENT LEAVES THIS PROCESS ROOTED AT `ROOT`.
 *
 * The one place all of them pass — `saveSource`, `sb_page_create`'s seed, the
 * checkout and app-scaffold creates, and a raw `sb_api_call` — so a minted root
 * (`sppro_1`, `rt_<hex>`) is renamed here whichever door it came through. The Go
 * renderer draws either; an editor before web_builder `7322af49a` paints the
 * minted one white and may autosave the page blank.
 */
export function withPageRoot(opts: Pick<RequestOpts, 'method' | 'path' | 'body'>): unknown {
  const body = opts.body as { document?: { root_node_id?: string; nodes?: Record<string, unknown> } } | undefined;
  const doc = body?.document;
  if (opts.method === 'GET' || !doc?.nodes || !PAGE_WRITE.test(opts.path)) return opts.body;
  const healed = canonicalRoot(doc as { root_node_id?: string; nodes: Record<string, unknown> });
  if (!healed) return opts.body;
  console.error(`sbuilder: healed page root ${doc.root_node_id} → ${PAGE_ROOT_ID} on ${opts.method} ${opts.path}`);
  return { ...body, document: healed };
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

type DocShape = { root_node_id?: string; nodes: Record<string, unknown> };

/**
 * Whoever shows a page's document live — the PageSession in a live room — and
 * must hear of a write that replaced it.
 *
 * `watching` answers whether anyone is on that page AND the write is not one
 * already put on the wire (the session's own save publishes its patch batch).
 */
export interface PageWriteWatcher {
  watching(siteId: string, pageId: string, doc: unknown): boolean;
  /** `before`/`after` are undefined when that read failed. */
  written(siteId: string, pageId: string, before: DocShape | undefined, after: DocShape | undefined): void;
}

let watcher: PageWriteWatcher | null = null;

/** One watcher per process — one live room at a time. Returns the unsubscribe. */
export function watchPageWrites(w: PageWriteWatcher): () => void {
  watcher = w;
  return () => {
    if (watcher === w) watcher = null;
  };
}

/**
 * THE STALE HALF, registered for the whole process rather than only while in a
 * live room. A raw write (`sb_api_call` PUT, `sb_page_repair`, a store flow) to
 * the page a session holds replaces what that copy was read from; the next save
 * of the copy would overwrite it. That is data loss with or without anybody
 * watching, so it cannot hang off the room — which needs SB_EMAIL/SB_PASSWORD
 * and was, until this hook, the only thing that told the session.
 */
type SourceWritten = (siteId: string, pageId: string, doc: unknown) => void;
const sourceWritten = new Set<SourceWritten>();

/** Every listener hears every write; returns the unsubscribe. */
export function onPageSourceWrite(fn: SourceWritten): () => void {
  sourceWritten.add(fn);
  return () => {
    sourceWritten.delete(fn);
  };
}

/**
 * A SHARED MASTER'S WRITE IS A WRITE TO EVERY PAGE COMPOSING IT. A non-GET to
 * `/global-sections/{id}` or `/global-sections/{id}/document` replaces what an
 * open copy's header or footer was composed from, and that copy's next save
 * decomposes the OLD composition back over the master. The room announces it
 * (`global` frame) only to a session that is in one.
 */
type GlobalWritten = (siteId: string, globalId: string) => void;
const globalWritten = new Set<GlobalWritten>();

export function onGlobalWrite(fn: GlobalWritten): () => void {
  globalWritten.add(fn);
  return () => {
    globalWritten.delete(fn);
  };
}

const GLOBAL_WRITE = /^\/api\/sites\/([^/]+)\/global-sections\/([^/]+)(?:\/document)?$/;

const SOURCE_WRITE = /^\/api\/sites\/([^/]+)\/pages\/([^/]+)\/source$/;
/**
 * A restore replaces the draft ON THE PLATFORM with no document in the body —
 * page.ts tells agents to use exactly these — so the open copy is stale the
 * same way, and the next save would overwrite the restore.
 */
const SOURCE_RESTORE = /^\/api\/sites\/([^/]+)\/pages\/([^/]+)\/(?:versions|history)\/[^/]+\/restore$/;

/**
 * EVERY PAGE-DOCUMENT WRITE REACHES THE LIVE ROOM, whichever door it came
 * through — a tool's own batch, `sb_api_call`, `sb_page_repair`, an `sb_store`
 * flow. The platform announces a shared section's or an overlay's save itself
 * (`global` / `overlay` frames); a PAGE save it announces to nobody, and an
 * editor re-hydrates only from ops. So a replace of a page somebody is looking
 * at is diffed (composed before vs composed after — two reads, paid only when a
 * peer is on that page) and published as node-level ops.
 */
export async function request(opts: RequestOpts): Promise<unknown> {
  const global = opts.method !== 'GET' ? GLOBAL_WRITE.exec(opts.path) : null;
  if (global) {
    const out = await send(opts);
    for (const fn of globalWritten) fn(decodeURIComponent(global[1]), decodeURIComponent(global[2]));
    return out;
  }
  const restore = opts.method === 'POST' ? SOURCE_RESTORE.exec(opts.path) : null;
  if (restore) {
    const out = await send(opts);
    for (const fn of sourceWritten) fn(decodeURIComponent(restore[1]), decodeURIComponent(restore[2]), undefined);
    return out;
  }
  const m = opts.method !== 'GET' ? SOURCE_WRITE.exec(opts.path) : null;
  const doc = (opts.body as { document?: unknown } | undefined)?.document;
  if (!m || !doc) return send(opts);
  const [siteId, pageId] = [decodeURIComponent(m[1]), decodeURIComponent(m[2])];
  const out = await announced(opts, siteId, pageId, doc);
  for (const fn of sourceWritten) fn(siteId, pageId, doc);
  return out;
}

async function announced(opts: RequestOpts, siteId: string, pageId: string, doc: unknown): Promise<unknown> {
  const w = watcher;
  if (!w || !w.watching(siteId, pageId, doc)) return send(opts);
  const read = async (): Promise<DocShape | undefined> =>
    ((await send({ ...opts, method: 'GET', body: undefined, query: undefined })) as { source?: { document?: DocShape } })
      .source?.document;
  const before = await read().catch(() => undefined);
  const out = await send(opts);
  const after = await read().catch(() => undefined);
  // The write already succeeded; an announce that throws must not report it failed.
  try {
    w.written(siteId, pageId, before, after);
  } catch (e) {
    console.error(`sbuilder: page ${pageId} was written; announcing it failed: ${(e as Error).message}`);
  }
  return out;
}

async function send(opts: RequestOpts): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? fetch;
  // Identity rides on EVERY call rather than on a handshake of its own. There is
  // no "connect" request to hang it off — the first thing this server does is
  // whatever the agent asked for — and a separate announcement call would be one
  // more thing that can fail while the real work succeeds, leaving a working
  // install invisible on the operator's screen.
  const headers: Record<string, string> = { Accept: 'application/json', ...identityHeaders(), ...opts.headers };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const body = withPageRoot(opts);

  const res = await doFetch(buildUrl(opts.base, opts.path, opts.query), {
    method: opts.method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const raw = await res.text();
  let parsed: unknown = undefined;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A non-JSON body from this platform means something UPSTREAM of the app
      // answered — a proxy, a 502 page. Say exactly that rather than guessing a
      // code the platform never wrote.
      if (!res.ok) {
        throw new ApiError(
          res.status,
          'non_json_response',
          `${raw.slice(0, 400)} [code: non_json_response, http ${res.status}]`,
        );
      }
      return raw;
    }
  }

  if (!res.ok) {
    const env = (parsed ?? {}) as {
      error?: string;
      code?: string;
      details?: unknown;
      fields?: Record<string, string>;
    };
    // The field errors ride in the MESSAGE too, not only on the object: a 400
    // reaching the model as "invalid" sends it guessing which field, when the
    // platform already said.
    const fieldText = env.fields
      ? ' — ' + Object.entries(env.fields).map(([k, v]) => `${k}: ${v}`).join('; ')
      : '';
    // THE CODE RIDES IN THE MESSAGE, because nothing else survives the MCP
    // boundary. `ApiError.code` has been the branchable half since this
    // transport was written — the platform writes exactly one error shape,
    // `{"error","code"}`, and the code is the part an agent can act on — and a
    // tool that throws hands the SDK an Error, of which only `message`
    // reaches the client. So the object kept the code and every caller saw
    // prose: "band order" with no `band_order` to match on, and no status to
    // tell a 409 from a 500.
    //
    // A SUFFIX rather than a prefix, so the platform's own sentence still
    // leads and every existing `toContain` on it still holds.
    const code = env.code ?? 'unknown';
    throw new ApiError(
      res.status,
      code,
      `${env.error ?? `HTTP ${res.status}`}${fieldText} [code: ${code}, http ${res.status}]`,
      env.details,
      env.fields,
    );
  }
  return parsed;
}
