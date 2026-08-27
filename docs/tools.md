# Tools

Four tools reach 310 platform operations. `sb_api_find` is an index, not a tool per
endpoint — see [why](../README.md#tools).

---

## `sb_connect`

Log in and report what this server can reach. **Call this first.**

| Arg | Type | Notes |
| --- | --- | --- |
| `email` | string? | Defaults to `SB_EMAIL` |
| `password` | string? | Defaults to `SB_PASSWORD` |

Returns `{ user, sites: [{id, name}], api_key: "present"|"missing", operations, note? }`.

A missing `SB_TOKEN` is **reported, not thrown**: the session half of the surface works
without one, and failing the whole connect would hide that from a caller who never touches
`/api/v1`. The password is never echoed.

## `sb_site_list`

List the sites this account can operate. No arguments.

## `sb_api_find`

Find operations by intent.

| Arg | Type | Notes |
| --- | --- | --- |
| `query` | string | What you want to do, in words |
| `tag` | string? | Narrow to one tag: `menus`, `products`, `theme`, … |
| `limit` | number? | Default 12, max 50 |

Each match returns its id, method, path, summary, tags, required credential, and
non-body parameters — plus **one** body verdict:

| Field | Meaning |
| --- | --- |
| `body_schema` | The document resolved a `$ref`; this is the real shape |
| `body_warning` | A body is declared but has no schema (58 operations). Read the matching GET and modify a copy |
| `body_note` | A write operation declares **no** body at all (60 operations). Sometimes true — `POST /orgs/{id}/leave` is a pure action — and sometimes a missing annotation: `PUT /pages/{id}/source` carries an entire page document and is documented exactly like this |

Never more than one of the three. The distinction is load-bearing: treating `body_note` as
"takes no body" would send an empty PUT and wipe a page.

Scoring is term hits weighted by field (tag 5, path 3, summary 2), ties broken by id. It is
deliberately not fuzzy — an empty list is cheap to recover from, a confidently wrong
operation is not.

## `sb_api_call`

Execute one operation found by `sb_api_find`.

| Arg | Type | Notes |
| --- | --- | --- |
| `id` | string | From `sb_api_find`, e.g. `get:/api/sites/{siteID}/menus` |
| `path_params` | object? | Every `{name}` in the path; missing one is refused, values are URL-encoded |
| `query` | object? | Query string; `undefined` values are dropped |
| `body` | any? | Request body |
| `dry_run` | boolean? | **Defaults to `true`** — sends nothing, returns a redacted preview |

Credentials are chosen from the path, never from the argument: `/api/v1/…` uses `SB_TOKEN`,
everything else uses the session. A missing `SB_TOKEN` is reported by name rather than
letting the platform answer `401 api_key_required`, which reads like a permissions problem.
