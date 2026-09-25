---
name: sbuilder-platform-api
description: What the Store Builder platform's HTTP and socket surfaces actually do — credential routing, token rotation, the one error shape, frame caps, publish/slug quirks, the /api/v1 partner surface, media upload doors, page versions and history, apps and OAuth installs, the theme write, and the reach/capability history of the catalog. Triggers when touching src/transport/**, src/live/**, src/tools/api.ts, undo.ts, theme.ts, app.ts, session.ts, or when sb_api_call / sb_media_upload / sb_theme / sb_live_join / sb_publish gets a refusal, a 200 that did nothing, or an unexpected body.
---

# The platform's API and socket surfaces

**Triggers:** `src/transport/**`, `src/live/**`, `src/tools/{api,undo,theme,app,session,live}.ts`, a 401/403/404/409 from the platform, a 200 that changed nothing.

The non-negotiable half of this lives in `CLAUDE.md` (credential routing by path prefix,
secrets from env, `Session.token()` per use). The live-edit client's yield rule is there too.
This skill is the evidence behind those rules and everything that is not dangerous enough to
load on every session.

Each entry below is a fact that cost real investigation, kept verbatim from the era when
`CLAUDE.md` carried all of them. Do not re-derive them, and do not "fix" the code that accounts
for them. Counts inside an entry are what was measured THAT day — trust the generator or the
repo over a number here, and fix the line when you catch one stale.

- **The session access token lives ~15 minutes and rotates.** `Session.token()` is a
  GETTER and every consumer must call it per use. A client that captures the string
  replays an expired token forever, and the failure is silent — a rejected socket auth
  still fires `onopen`.

- **The platform writes exactly one error shape**, `{"error", "code"}`, never plain text.
  `code` is the branchable half; reading `statusText` throws it away. Two documented
  supersets exist — `details` (`WriteErrorCodeDetails`) and `fields` (`fielderrors.go`, with
  `code: "validation"`) — and `ApiError` carries both when present.

- **`PUT /pages/{id}/source` takes `{ document, schemaVersion }`**, not `{ document }`. The
  OpenAPI document declares no body for it at all, so the shape was read off the editor's
  own `saveSource` (`editor/src/features/pages/api.ts:115`), including its
  `schema_version ?? 1` fallback. Copy the working client; never guess a body.

- **The wire caps frames by KIND.** `ops` and `snap` may reach 4 MiB; EVERY other kind is
  capped at 64 KiB, and exceeding it CLOSES the socket (`StatusMessageTooBig`) rather than
  rejecting one frame. Split a large batch.

- **An `ops` frame with an empty `pageId` or empty `ops[]` is dropped SILENTLY** by the
  server (a bare `continue`), so sending one is indistinguishable from success. `publish`
  guards both.

- **Publish SKIPS a page with no saved draft and still answers 200** (`service.go:650`, a bare
  `continue`), and a published row carries the whole rendered page — `document`, `html`, `css`
  — for every page the cascade touched. So `sb_publish` asserts the page came back, and
  projects the rows.

- **A colliding page slug is RENAMED, not refused.** `uniqueSlug` suffixes `-1`, `-2`, … and
  its own comment says it "never errors" (`service.go:877`). `ErrSlugConflict` exists and maps
  to 409; this path never reaches it. The create answers 200 carrying a slug the caller never
  asked for, and every link authored to the requested one is dead.

- **An AGENT KEY now opens media upload AND the live-edit socket. Both of this repo's
  "session only" rules are DEAD, and the corrections are recorded because the old ones read
  as settled facts.** `/api/media` is mounted behind `RequireAuthOrDefer`
  (`server/internal/server/router.go:2821`), the same gate as `/api/sites`, pinned by
  `media/rest/upload_agentkey_test.go`; the platform's own comment gives the reason — the
  media LIBRARY already took a key while the UPLOAD refused one, so a merchant could hand an
  agent a key that manages every image the store has and cannot add one. And
  `server/internal/server/realtime.go:44` gives a `wbk_` bearer "the same door as a session"
  on the socket, gated on `member.read` through the key's delegated principal.

  So the client's two refusals were both wrong, and both have been removed. The lesson worth
  keeping: a credential rule verified once is not a constant. The platform is actively
  WIDENING what a key opens, and a stale "only a session can do this" guard turns away a
  setup that works — which is worse than no guard, because it sends the caller to fix
  something that was never broken.

- **On the canvas the agent's avatar is the KEY, not a person — AND SINCE `8e40bbab` it also
  says so.** `realtime.go` returns `key.ID` and `key.Name` rather than the minter's name,
  deliberately: an avatar borrowing a human's name would tell the room a person is editing when
  a machine is. But it stopped there, so the only thing separating an agent from a colleague was
  the WORDING the merchant happened to choose for the key — a key named "Trang" put a convincing
  person in the room, moving a cursor around the page, and the editor had no signal it could
  draw a badge from.

  `realtime.Peer.Kind` carries it now (`PeerKindAgent`), and A PERSON IS THE ZERO VALUE: with
  `omitempty` a human peer serializes byte-identically to the one before the field existed, so
  the addition could not break a client that has not been taught it. The editor draws a GLYPH
  rather than a word — no i18n key, same in every language — on the avatar and on the CURSOR,
  which is the surface a merchant actually watches.

  What this server sends is unchanged: `sb_live_join` still publishes `ops`, and `cursor` /
  `select` still only move when a real `sb_look` measurement exists (`PageSession.noteBoxes`),
  because presence with an invented coordinate is theatre. The read path is still HTTP — the
  socket BROADCASTS edits, it does not fetch or save them.

- **THE PLATFORM ANNOUNCES A SHARED SECTION'S OR AN OVERLAY'S SAVE, NEVER A PAGE'S.**
  `announceGlobal` / `OverlayChanged` fan out `global` / `overlay` frames and the editor
  re-fetches the master; a `PUT …/pages/{id}/source` is announced to nobody, and the editor
  has no "page saved, reload" frame — it changes only through `ops` (and a `snap` it asked
  for). So `request()` (`src/transport/http.ts`) is the one door: a page-source write while a
  peer is on that page is diffed composed-before vs composed-after (`documentPatches`) and
  published for THAT page (`LiveSession.publish(patches, pageId)`). The session's own save is
  skipped by identity — its patch batch is already on the wire. A root rename cannot be
  expressed as ops (`root_node_id` is not synced); the editor must reload.
  The OTHER half — marking the session's own open copy stale — is `onPageSourceWrite`,
  registered in `PageSession`'s constructor, never only while in a room: without
  SB_EMAIL/SB_PASSWORD there is no room, and a raw `sb_api_call` PUT to the open page was
  overwritten by the next edit. A `versions/{v}/restore` or `history/{h}/restore` POST
  replaces the draft with NO document in the body, so `SOURCE_RESTORE` matches those paths
  too — page.ts tells agents to restore that way, and the next `sb_set` saved over it. The
  listeners are a Set: a single slot let the last `PageSession` constructed silence the rest.

  **AND "WHICH MACHINE" HAD NO FIELD, so every agent in the room was the same robot.** `Kind`
  answered person-or-machine and stopped there; the editor paints one glyph (`&#129302;`) for
  every agent peer (`PresenceBar.vue:51`, `PeerCursors.vue:111`), so a merchant with Claude
  Code, Cursor and a cron job installed watches their page move and cannot tell which of the
  three is doing it. The answer already existed and could not get there: `identityHeaders`
  puts `X-Agent-Client` on every HTTP call, and a browser cannot set a header on a WebSocket —
  which is the very reason auth is a FRAME here. So the frame carries it:
  `{t:'auth', token, client, clientVersion}`.

  ADDITIVE AGAINST EVERY DEPLOYED SERVER, and that is a measured property rather than a hope:
  `realtime.Decode` is a plain `json.Unmarshal` with no `DisallowUnknownFields`, so today's
  servers ignore both fields. A client that identified nothing produces a frame BYTE-IDENTICAL
  to the old one, so this is not a wire change for an install that never identified — the same
  zero-value additivity `Peer.Kind` shipped on. Empty is omitted, never sent blank, because
  `identityHeaders` draws that distinction on the HTTP side and two places must not disagree.

  The names are not a choice: `site/rest/rest.go`'s `AgentIdentity` already reads those exact
  headers into `Client` / `ClientVersion`, so the socket is catching up to a concept the
  platform has, not minting a second vocabulary for one string.

  **AND THE PLATFORM RULED THAT THE EDITOR MUST NOT DRAW A PRODUCT MARK FROM IT — text beside
  the robot, never a vendor logo.** `client` is CALLER-ASSERTED (`kind` is trustworthy because
  `auth.Authorize` derives it from the credential; anything can claim to be Claude Code), and
  `agentIdentity`'s own comment says it outright: "Never trusted, only displayed." A logo drawn
  from it would tell a merchant AT A GLANCE that a named vendor's tool is editing their page on
  the strength of a field anything can send — which is the identity-borrowing `Kind` exists to
  prevent, one level up, and a tooltip caveat does not repair it because a mark is read at a
  glance and a tooltip is read on purpose. Text also degrades correctly: an unknown or absent
  name falls back to the robot alone, which is exactly today's rendering, so there is no
  allow-list of blessed harnesses and no "unrecognised vendor looks broken" state.

  **IT MUST NEVER GATE ANYTHING.** Rate limits, permissions, feature flags, audit decisions —
  none may read `client`. Written down because it is the line that comes under pressure the
  first time somebody wants per-harness behaviour.

- **THE PLATFORM CAN NOW FETCH THE IMAGE ITSELF, and the client asks it to first.**
  `POST /api/media/{siteId}/from-url` takes `{ url, folderId?, name? }` and runs the same
  `media.Ingest` the multipart door does — added upstream (web_builder `46b4d8b1`) because an
  agent bringing a page over from elsewhere has the image as a URL and never as bytes. Two hops
  became one, and the content type is decided by the origin's own answer rather than
  reconstructed here from a header and an extension.

  **A REFUSED ADDRESS IS TERMINAL, and that is a security rule rather than tidiness.** The
  platform refuses anything that is not on the public internet — loopback, private ranges, the
  cloud metadata endpoint — checked at CONNECT time so a name that resolves inward is caught
  too. A client that answered `remote_blocked` by fetching that same URL from its OWN machine
  and uploading the bytes would walk straight around the guard, so `uploadMedia` raises instead.
  Only a MISSING ROUTE (404/405) falls through to the old download-and-post path, which is the
  same deployment-age shape the `/api/v1/media` retry below already has.

- **`POST /api/v1/media` is a SECOND upload door, and it is the key's own.** `/api/media`
  takes a `wbk_` key only since `feat(media): a wbk_ API key may upload`, so a deployment
  older than that commit refuses a valid key — measured against a server binary 26 minutes
  older than the fix, with a key holding `media.write` on its own site. `uploadMedia` now
  retries on the partner surface before blaming the key, and its refusal names the
  deployment as a suspect alongside the scopes.

- **`sb_api_call` DEMANDED `{siteId}` ON ALL 289 OPERATIONS THAT NAME IT**, while `siteFor()`
  defaulted it for every other tool. On a key-only install that is a 32-character constant
  the environment already holds. It now falls back to `SB_SITE` for `{siteId}`/`{siteID}`
  only — `{productId}` and `{id}` name a record the caller chose — and an explicit argument
  still wins.

- **`sb_media_upload` FROM A URL WAS BROKEN FOR EVERY IMAGE TYPE, and the error blamed the
  file.** `uploadMedia` built `new Blob([bytes])` with no `type`, so the multipart part went
  out as `application/octet-stream`. The platform accepts a file whose DECLARED type starts
  with `image/` or `video/`, or whose EXTENSION is a known font or document — octet-stream is
  none of those, so a PNG fetched from a URL came back "only image, video, or font
  (woff2/woff/ttf/otf) uploads are supported". A message about the file, caused by a missing
  argument.

  IT ALSO PRODUCED A WRONG FACT IN THIS FILE. The same refusal on an SVG was recorded as "the
  platform deliberately refuses SVG". It does not — `ResolveUploadContentType` takes any
  `image/*`, and `image/svg+xml` is one. The lesson is the one this file already keeps for
  stale hints: a refusal quoted verbatim is evidence, but the READING of it is a guess until
  something else confirms it, and here the confirming step (upload a PNG) took one call.

  The header wins only when it says something: a CDN answering `application/octet-stream` for
  a PNG is ordinary, and it is exactly the value the platform refuses, so the extension is
  consulted whenever the declared type does not identify the file. The old tests pinned the
  file NAME and never the type, which is how this survived.

- **THE SITE'S THEME WAS READABLE AND, IN PRACTICE, UNWRITABLE — the highest-leverage design act
  was the one thing the tools pushed an agent away from.** `src/domains/site/theme.ts` carried
  read helpers only, and `PUT /api/sites/{siteId}/theme` has the body shape `{theme: object}`
  because the SERVER genuinely does not know the shape (`sitetheme.Theme.Data` is a
  `json.RawMessage`; its comment says the editor owns it). So an agent wanting a rose-and-ink
  storefront had exactly one move — paint literals on nodes — which this file already records as
  detaching each node from its preset PERMANENTLY.

  `sb_theme` is a tool rather than a call-sheet entry for one reason: the write is a
  WHOLE-DOCUMENT REPLACE against a surface with NO HISTORY, and the operation an author actually
  wants is a PATCH. The only safe way to spell a patch on a replace-only endpoint is to read the
  document, change the named fields and send the whole thing back — so there is deliberately no
  argument here that can express "drop everything else". A token id or style slug the site does
  not have is REFUSED with the real ones named, because every preset resolves through those ids
  and an invented one would be stored and read by nothing.

  A site that has never saved a theme answers `200 {"theme": null}` — the platform calls that
  "the NORMAL first-visit state" — so the first write is built from `STARTER_THEME` and stores a
  COMPLETE theme rather than a palette with one token in it.

  **AND THE PLATFORM USED TO ACCEPT `{}`.** `validTheme` asked only "is this a JSON object", so a
  body missing `colors` was stored: the site lost every colour token, every text style and all 58
  presets, with a 200 and nothing to restore from. Fixed upstream — the gate is deliberately WEAK
  (one recognised top-level key, not a required set), because requiring `colors` would refuse a
  shape the editor has not shipped yet, and the colour/text-style shape stays the editor's to own.

- **AN APP'S BLOCKS WERE REACHABLE AND UNUSABLE, and a marketplace app cannot be installed from
  here at all.** Trap 5 already records what an app block IS; what nothing recorded is how to
  make one. `page/appblocks.go` holds the format — `specials.appBlockRef` is
  `"<installId>/<blockKey>"` — and both halves come back on every row of
  `GET /api/sites/{siteId}/apps/blocks`. So an agent had the list, the route, and no way to turn
  a row into a node. It rides on the `/apps` and `/builtin-apps` call sheets now, with the two
  silent traps beside it (never author the composed stamp; an edit inside a composed block is
  stored nowhere), because placing one is `sb_add` and no tool needed adding.

  The install half splits cleanly and the split is the platform's, not this client's.
  `POST /api/sites/{siteId}/builtin-apps/{key}` is reachable and takes one of EIGHT keys — mail,
  multilingual, agent, chat, booking, loyalty, payments, courses.

  **AND "A MARKETPLACE APP NEEDS A HUMAN" WAS TOO COARSE, WHICH IS THE SECOND TIME THIS FILE
  HAS RECORDED A CREDENTIAL RULE MORE STRICTLY THAN THE PLATFORM HOLDS IT.** Two of the five
  `/oauth` routes are the MERCHANT's rather than the app's, and reading them says exactly who
  may do what:
  - `GET /oauth/authorize-info` answers the app, its publisher, its privacy policy, the SCOPES
    it would hold, and the money half — `paid` is always present, so "free" is an answer rather
    than a missing key. SUGGESTING an app is therefore always available, on any credential.
  - `POST /oauth/authorize` records the grant, and `Authenticate` parses an ACCESS TOKEN — so a
    SESSION reaches it and a `wbk_` agent key does not. That is a deliberate line, not an
    oversight: an installed app holds scopes against the store, so the decision belongs to
    whoever owns the account. With `SB_EMAIL`/`SB_PASSWORD` this server can complete one.
  - `acceptedPrice` is a POINTER. Omitting it means a FREE app; omitting it for a PAID one is
    REFUSED rather than having a price assumed on the merchant's behalf. Nothing automated can
    commit anybody to a subscription.

  So the answer is neither "ask a human" nor "just install it": always be able to SUGGEST, show
  the scopes, and install only what the credential in hand is allowed to install. Both routes
  carried no `@Router` line until `831801fa`, so the flow was findable only by reading Go.

  **AND THE ONE PLACE THE INSTALLABLE SET EXISTS ON THE WIRE NAMED TWO OF THE EIGHT.**
  `GET /builtin-apps` answers what is INSTALLED, so the `key` parameter's own description is the
  whole answer to "what can I install" — and it read `"App key (mail | multilingual)"`, written
  when those were the only two. swag copies that string into `swagger.json`, this catalog copies
  it out, and it reached the call sheet verbatim. Fixed upstream and pinned there against
  `builtinapps.Keys` rather than a retyped list. The lesson is the one this file keeps for stale
  hints: a description is not a comment when a generator reads it.

- **THE RECOVERY LISTING WAS TOO BIG TO READ.** `GET .../versions` and `.../history` answer with
  the DOCUMENTS — right, since a restore has to have something to restore from, and useless to
  read. MEASURED against a live server: one version of a TWO-NODE page is 1,690 bytes, so a
  realistic 120-node page runs about 70 KB per version and a listing of twenty is **1.4 MB in one
  answer**. An agent choosing which version to restore would be handed a truncated blob and no
  reliable way to pick.

  `sb_publish` had this exact problem and the same answer — a published row carries `document`,
  `html` and `css` for every page the cascade touched, so it PROJECTS the rows. `LIST_PROJECTIONS`
  in `src/tools/api.ts` is that, applied where the caller cannot know to ask: id, versionNo,
  label, createdBy, createdAt, isLive. 392 bytes for two versions instead of kilobytes each. A
  DEFAULT rather than a rule — an explicit `pick` still wins, so `pick: ["document"]` reads one.

  And the projected listing shows something worth knowing: the platform writes a `__pre_restore`
  version of its own before restoring, so a RESTORE is itself undoable.

- **`settings.locale` IS WRITTEN WHOLE-FIRST, LOCALE-ONLY SECOND — never the other way.**
  `PUT /api/sites/{siteId}/settings` replaces the whole document; web_builder `58dbfefb` made a
  body that is EXACTLY `{settings:{locale}}` MERGE instead, and lets a `pages.write` key send it
  (that PUT answered 403 to a key before). A server older than the merge stores `{locale}` as
  the WHOLE of settings, so `sb_theme locale` reads, sends the merged document, and only on a 403
  tries the narrow body — a 403 there is the same gate on either server, so it cannot wipe. Then
  the session, when a key was refused and one exists; a 403 on every door is reported as a 403.

## Phases — how reach and capability grew

All three phases are shipped, and their plans live in `docs/superpowers/plans/`:
auth and full API reach; the element catalog, patch core, four traps, document, builder,
validation and page tools; the live-edit socket, the yield rule, the vision loop and
`sb_bind`. Twenty-eight tools reach 484 API operations. The 2026-09-07 token diet plan in
`docs/superpowers/plans/` (compact results, once-per-process notices, the `sb_api_find`
call sheet, trap 5, auto-release) is shipped too, and `test/token-budget.test.ts` holds its
ceilings.

Phase 8 (2026-09-08) made the agent an OPERATOR rather than only a designer, and its spec is
`docs/superpowers/specs/2026-09-08-phase-8-operating-a-store-design.md`. The measurement that
framed it: 46 of 212 write operations carried a body schema, so every merchant operation
through `sb_api_call` was a guess, while the editor exposes 58 feature areas and this server
covered about six. It shipped `REQUEST_SHAPES` (46 → 158, read off the handlers), `sb_store`
(the four ordered writes that make a checkout) and `sb_undo` (a PUT reads before it writes,
because a PUT is not a patch). It did NOT add a tool per surface: the finishing
surfaces — theme, fonts, menus, translations, settings, blog, orders, customers, shipping,
discounts — became reachable the moment the shapes landed, and what is still unshaped there
is action endpoints that take no JSON body.

`SB_BROWSER_TEST=1 npm test` adds the one test that launches Chrome. Run it after touching
`src/vision/**` — the default suite skips it, and a skip that reads as green is the failure
this repo keeps closing.

Phase 7 (2026-09-07) closed ten silent failures reachable through this server's OWN tools —
the drop-time contract (satellites and seeded content), the satellite-aware walk and the two
`sb_duplicate` defects it exposed, the compose warnings / publish skip / slug rename this
client received and discarded, and three render rules a valid document can break. It added no
tools. Its spec also records the two axes it deliberately did NOT take, so the measurements
are not re-derived. BOTH HAVE MOVED, and the Phase 7 numbers are kept only as the before:
REACH was 75 operations unreachable and is now zero for the annotated surface (see the OpenAPI
bullet above); CAPABILITY was 45 of 180 write operations declaring a body, and measured
2026-09-09 is **276 write operations, 162 shaped, 114 not** — of which 64 are DELETEs that
take no body and 14 are action endpoints with a verb tail. The genuinely risky remainder is
**5 PUTs with no shape**, down from 8 once the parser learned three readings it was
getting wrong — and NOT all of them are guesses: `…/pages/{pageId}/default-template` decodes
nothing at all, so "no shape" is the correct answer there rather than a gap. The three that
came back are the ones that mattered — `roles/{roleId}`, `products/{productId}/categories`
(filing a product under a collection) and `sites/{siteId}/org`. The three readings, each
pinned by `test/shapes.test.ts` against the real catalog:
  - **a case arm may list SEVERAL methods.** `case http.MethodPatch, http.MethodPut:` is how
    this platform spells "the same body either way", and matching only the first name left the
    arm unrecognised entirely — the trailing `:` never followed it.
  - **A DOC BLOCK IS NOT ALWAYS ABOVE ITS FUNCTION.** `products/rest/rest.go` stacks
    handleProductLinks's block and handleProductBundles's together and then declares the two
    functions in the OPPOSITE order, so walking up from a function reaches the block
    documenting the other one. That is worse than a miss: a route takes the wrong handler's
    body. Blocks are now attributed by the name they OPEN with — Go's own convention — and
    only fall back to "the function below" when the block names nothing.
  - a dispatcher that routes by PATH rather than by method has no arm to read at all; the
    route's own trailing literal segment picks the callee, which is exact rather than a guess. `sb_undo` cannot prepare an undo for
any of them either, because it needs the shape to know which fields to carry back. The 33
unshaped POSTs left over are almost entirely the SHOPPER's surface (`/_wb/account/*`,
`/_wb/checkout/*`), webhooks and multipart uploads — not an agent's to call.

Deferred with the seam left open: `expand`/`compact` sparse authoring (`createNode` already
seeds from `meta.defaults`, so the write-path win is banked; the read-path inverse waits for
a measured need) and `sb_bind`, which belongs with Phase 3's binding work.

- **`ApiError.code` NEVER REACHED THE CALLER.** The platform writes exactly one error shape,
  `{"error","code"}`, and this file has recorded since the transport was written that `code` is
  the branchable half. It was kept on the object and dropped at the MCP boundary: a tool that
  throws hands the SDK an `Error`, of which only `message` survives. So an agent met "band
  order" with no `band_order` to match on, and no status to tell a 409 from a 500. The code and
  the status now ride in the message as a SUFFIX — `… [code: band_order, http 409]` — so the
  platform's own sentence still leads and every existing assertion on it still holds.
