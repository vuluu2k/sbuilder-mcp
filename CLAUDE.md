# CLAUDE.md — `sbuilder-mcp`

Guidance for Claude Code when working in this repository.

## What this is

An MCP **stdio** server that lets an AI agent operate a Store Builder site end to end —
design its pages, fill them with real data, look at the result, and publish it — with no
human clicking anything.

It is **not** a renderer. Every pixel comes from the platform's Go renderer; this server
only ever holds the document and the screenshots.

Published to npm as `sbuilder-mcp`, binary `sb-mcp`. Runs via `npx -y sbuilder-mcp`.

Design spec: `docs/superpowers/specs/2026-08-27-sbuilder-mcp-design.md`. Read it before
changing anything structural — it records *why* each boundary is where it is.

## Commands

```bash
npm run build     # tsc -> dist/
npm test          # vitest run
npm run smoke     # offline self-test; MUST print "ALL GOOD"
npm run codegen   # WB_REPO=/path/to/web_builder npm run codegen
npm start         # node dist/index.js (stdio server)
```

**The gate for every change is `npm run build && npm test && npm run smoke`.**
`prepublishOnly` runs build + smoke, so a broken smoke blocks publishing.

## Invariants — do not wait for a review to be told these

- **Node ≥22**, because this repo uses the GLOBAL `WebSocket`, unflagged from 22. The
  alternative was a `ws` dependency for a runtime the platform's own dev stack already
  exceeds; a stated version floor is the cheaper cost.
- **`playwright-core` + `channel: 'chrome'`** — the system browser, so `npm install`
  downloads nothing. A missing Chrome is reported by name, never degraded to a blank image.
- **Package `sbuilder-mcp`, bin `sb-mcp`, server name `sbuilder`.** Never the internal
  `@webbuilder/*` scope: that scope is private to the platform monorepo and an npm name is
  effectively permanent once taken.
- **stdout is the MCP channel.** Every log line is `console.error`. One stray `console.log`
  corrupts the protocol for every client.
- **ESM / Node16.** Every relative import ends in `.js`, including from a `.ts` source.
- **Secrets come from env only** — `SB_API`, `SB_TOKEN`, `SB_EMAIL`, `SB_PASSWORD`. This
  repo is public. No secret reaches a file, a log, or a tool result.
- **Every tool answers through `text()`** (or `image()`/`images()`) from `src/mcp/response.ts`.
  A hand-built content array is the shape that drifts.
- **Mutating tools take `dry_run` and default it to `true`**, returning a request preview
  passed through `redact()`.
- **Credential routing is by path prefix**, in `src/transport/credential.ts`, and is not
  negotiable: `/api/v1/…` → `SB_TOKEN`; everything else → the session JWT. The OpenAPI
  document declares one `BearerAuth` scheme for both, so it *cannot* make this call, and
  the platform refuses each credential on the other's surface.
- **`src/catalog/api.generated.ts` is generated and committed.** Never hand-edit it;
  regenerate with `npm run codegen`. It is committed so `npm install` needs no
  `web_builder` checkout.

## The platform facts that shaped this code

Each of these cost real investigation. Do not re-derive them, and do not "fix" the code
that accounts for them.

- **The OpenAPI document holds 205 paths / 310 operations / 85 definitions, and no
  `operationId`.** Ids are synthesized as `method:path`; the generator asserts uniqueness.
  (320 is the count of *tag assignments* — an operation with two tags is counted twice.)
- **Bodies are under-described in two different ways.** 58 of 140 body-carrying operations
  declare a body with no `$ref`; 60 of 137 write operations declare no body *at all*, and
  that second group mixes genuine action endpoints (`POST /orgs/{id}/leave`) with missing
  annotations (`PUT /pages/{id}/source` carries a whole page document). `describeOperation`
  gives the two cases different words on purpose — saying "no body" for the second would
  have a model send an empty PUT and wipe a page.
- **The session access token lives ~15 minutes and rotates.** `Session.token()` is a
  GETTER and every consumer must call it per use. A client that captures the string
  replays an expired token forever, and the failure is silent — a rejected socket auth
  still fires `onopen`.
- **The platform writes exactly one error shape**, `{"error", "code"}`, never plain text.
  `code` is the branchable half; reading `statusText` throws it away.
- **`PUT /pages/{id}/source` takes `{ document, schemaVersion }`**, not `{ document }`. The
  OpenAPI document declares no body for it at all, so the shape was read off the editor's
  own `saveSource` (`editor/src/features/pages/api.ts:114`), including its
  `schema_version ?? 1` fallback. Copy the working client; never guess a body.
- **The element registry holds 85 types, and `getElementAI` covers 85/85.** The directory
  has 95 entries because 14 are loose `.ts` files, not elements.
- **The wire caps frames by KIND.** `ops` and `snap` may reach 4 MiB; EVERY other kind is
  capped at 64 KiB, and exceeding it CLOSES the socket (`StatusMessageTooBig`) rather than
  rejecting one frame. Split a large batch.
- **An `ops` frame with an empty `pageId` or empty `ops[]` is dropped SILENTLY** by the
  server (a bare `continue`), so sending one is indistinguishable from success. `publish`
  guards both.
- **`applyBindings` honours only the `specials` namespace.** A binding whose `field` names
  any other namespace is stored, saved, published, and ignored forever.
- **`DOC_SCHEMA_VERSION` is 2** and lives in `editor/src/theme/legacyScopes.ts`, not in the
  schema package. Codegen reads it with a regex — importing an editor module would drag Vue
  into a build script for one integer.

## The four traps

Each fails SILENTLY. Each is encoded in `src/domains/site/traps.ts` with its own test,
because this platform treats an unproven guard as indistinguishable from an absent one.

1. **Site overlays** — the cart drawer and pop-ups are composed onto ROOT on read and
   stripped on write. Stamped `specials.overlayId`, and only a DIRECT child of ROOT may be
   one. `pageChildren()` is the walk every ROOT-level rule must use; `childrenOf()` on the
   root is the mistake that reads correctly and behaves wrongly.
2. **Global sections** — stamped `specials.globalId`/`globalKind`; shared masters. Editing
   one changes every page carrying it, and publish cascades. Results say so.
3. **Band order** — ROOT's children must read `[header*][middle*][footer*]`. The platform
   refuses EVERY save otherwise (`checkBands`, `server/internal/page/decompose.go`). It
   strips overlays before checking, which is why the rule needs no overlay exception — and
   why ours strips them too.
4. **Responsive by default, not by refusal.** `setKeys` writes per breakpoint because a
   design should respond — but base is legitimate and is NOT a trap. This entry used to say
   a base value "vanishes on publish" and `setKeys` threw for one; both were wrong, and the
   correction is worth keeping because the misreading is easy to repeat.

   The platform's mandate ("if a key CAN be responsive it MUST be") is about ELEMENT
   IMPLEMENTATION: an element whose Go renderer reads `n.Config[...]` directly — `nodes.ConfigInt`
   in `html.go`, an SVG `width=` attribute — bypasses the cascade, so a per-breakpoint value the
   author sets renders on the canvas and never reaches publish. Nothing a DOCUMENT stores can
   cause that. `server/render/style/cascade.go`'s MergeNamespace resolves a key
   *current slot → wider slots → BASE → narrower slots*, so base is the fallback layer, and
   every element's `meta.defaults.style` is seeded straight into it.

## The yield rule

The live-edit client is NEVER the authority on a document. It does not answer `snapreq` for
anyone and publishes no convergence checkpoint of its own. On any evidence of divergence —
a gap in `seq`, a checkpoint at its own seq, a rejected save — it discards its copy,
re-pulls, and makes the next save FAIL LOUDLY so the caller re-reads and reapplies.

This is what lets `src/live/session.ts` be one small class instead of the editor's outbox
deferral plus inbox arbitration plus "who pulls" tie-break — roughly a thousand lines whose
entire purpose is arbitrating between two EQUALLY authoritative editors. Alone in the room
the agent is the sole writer and the rule costs nothing, so it is a mode rather than a
permanent sacrifice. Do not "fix" it by making this client answer snapshots.

A tool that writes must go through `PageSession.applyAndPublish`, never `doc.apply`
directly — otherwise the local document is right, the save is right, and only the humans
watching see nothing happen.

## Adding a tool

1. Put it in a group under `src/tools/*.ts`, registered via `server.tool(...)`.
2. Return through `text()`. Take `dry_run` if it writes.
3. Register the group in `src/server.ts`.
4. Add a test under `test/`.
5. Document it in `docs/tools.md` **and** `docs/tools.vi.md`, and in both READMEs' table.
6. Run the gate.

The `sbuilder-mcp-tools` skill in `.claude/skills/` carries the same rules in the form the
agent reads at the moment it starts the work. Specialist subagents in `.claude/agents/`
enforce them: **mcp-tool-author** (add or modify a tool) and **mcp-verifier** (run the gate
and check conventions; never edits).

## Phases

All three phases are shipped, and their plans live in `docs/superpowers/plans/`:
auth and full API reach; the element catalog, patch core, four traps, document, builder,
validation and page tools; the live-edit socket, the yield rule, the vision loop and
`sb_bind`. Sixteen tools reach 310 API operations.

`SB_BROWSER_TEST=1 npm test` adds the one test that launches Chrome. Run it after touching
`src/vision/**` — the default suite skips it, and a skip that reads as green is the failure
this repo keeps closing.

Deferred with the seam left open: `expand`/`compact` sparse authoring (`createNode` already
seeds from `meta.defaults`, so the write-path win is banked; the read-path inverse waits for
a measured need) and `sb_bind`, which belongs with Phase 3's binding work.
