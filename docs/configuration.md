# Configuration

Every value is read from the environment. Nothing is read from a file, and no secret is
ever written to one — this repository is public.

| Variable | Required | Default | What it is |
| --- | --- | --- | --- |
| `SB_API` | no | `http://localhost:8080` | Base URL of the platform API |
| `SB_TOKEN` | recommended | — | A `wbk_` API key from the site's Agent app. Opens BOTH surfaces on its own — this is the one-variable setup |
| `SB_EMAIL` | optional | — | A platform account, for account-level calls a key cannot make (listing sites, members, roles) |
| `SB_PASSWORD` | optional | — | That account's password |
| `WB_REPO` | codegen only | — | Path to a `web_builder` checkout. Never needed at runtime |

## One variable is enough

`SB_TOKEN` alone opens everything this server does day to day. An API key from the site's
**Agent** app reaches both the partner surface (`/api/v1`) and the private site API's
resource surface, including the page document and the live-edit socket.

It is bounded three ways, all enforced per request: the key's own scopes, the live role of
the member who minted it, and the single site it belongs to. Demote that member and every
key they minted narrows immediately; revoke the key and it stops working everywhere at once.

`SB_EMAIL` / `SB_PASSWORD` remain supported for a human running this against their own
account. They buy exactly one thing a key deliberately cannot do: **account-level** calls —
listing your sites, managing members and roles — because those mean "this person's account"
and a key has no person behind it.

`/api/v1` still refuses a session token with `401 api_key_required`, and that refusal is
deliberate on the platform's side: accepting one would make the partner surface as powerful
as whoever pasted it. So `src/transport/credential.ts` marks v1 as key-only, marks
everything else site-scoped, and `tokenFor` prefers the key — the narrower of the two.

## Session lifetime

The session access token lives about fifteen minutes and rotates on refresh. It is read
through a getter on every use, never captured — a client holding the string it was built
with replays an expired token forever, and that failure is silent.
