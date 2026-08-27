# Configuration

Every value is read from the environment. Nothing is read from a file, and no secret is
ever written to one — this repository is public.

| Variable | Required | Default | What it is |
| --- | --- | --- | --- |
| `SB_API` | no | `http://localhost:8080` | Base URL of the platform API |
| `SB_TOKEN` | for `/api/v1` | — | A `wbk_` API key minted in the app. Also accepts a `wba_` app access token |
| `SB_EMAIL` | for the private API | — | A platform account |
| `SB_PASSWORD` | for the private API | — | That account's password |
| `WB_REPO` | codegen only | — | Path to a `web_builder` checkout. Never needed at runtime |

## Why two credentials

The platform declares one `BearerAuth` scheme in its OpenAPI document but enforces two
different credentials behind it, and refuses each on the other's surface. `/api/v1` answers
`401 api_key_required` to a session token; the private site API does not accept a `wbk_`
key. So `src/transport/credential.ts` routes by path prefix, and that rule is tested rather
than inferred per call site.

You can run with only one. `sb_connect` reports which half is reachable, and a missing
`SB_TOKEN` is named explicitly the first time an `/api/v1` operation is attempted, rather
than surfacing as a permissions error from the platform.

## Session lifetime

The session access token lives about fifteen minutes and rotates on refresh. It is read
through a getter on every use, never captured — a client holding the string it was built
with replays an expired token forever, and that failure is silent.
