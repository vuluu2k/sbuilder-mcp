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
  // Identity rides on EVERY call rather than on a handshake of its own. There is
  // no "connect" request to hang it off — the first thing this server does is
  // whatever the agent asked for — and a separate announcement call would be one
  // more thing that can fail while the real work succeeds, leaving a working
  // install invisible on the operator's screen.
  const headers: Record<string, string> = { Accept: 'application/json', ...identityHeaders() };
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
      // A non-JSON body from this platform means something UPSTREAM of the app
      // answered — a proxy, a 502 page. Say exactly that rather than guessing a
      // code the platform never wrote.
      if (!res.ok) throw new ApiError(res.status, 'non_json_response', raw.slice(0, 400));
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
    throw new ApiError(
      res.status,
      env.code ?? 'unknown',
      (env.error ?? `HTTP ${res.status}`) + fieldText,
      env.details,
      env.fields,
    );
  }
  return parsed;
}
