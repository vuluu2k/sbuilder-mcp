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

/** Keys whose value is a credential wherever it appears. */
const SECRET_KEYS = /^(authorization|token|access_?token|refresh_?token|password|secret|api_?key)$/i;

/**
 * Replace credential-shaped values with a marker, recursively.
 *
 * Every dry-run preview goes through this, so it is the only thing standing
 * between a `dry_run` result and a bearer token sitting in a transcript. It keys
 * off the FIELD NAME rather than the value's shape on purpose: a token format
 * can change tomorrow, while the field name is what this repo controls.
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
