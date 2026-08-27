---
name: sbuilder-mcp-tools
description: The tool-authoring contract for @sbuilder/mcp — where a tool lives, how it answers, the dry_run default, credential routing, and the three places a new tool must be registered. Triggers when adding, changing, or reviewing an MCP tool in this repo, touching src/tools/**, src/server.ts, or src/catalog/**.
---

# Authoring a tool in `@sbuilder/mcp`

## The gate

`npm run build && npm test && npm run smoke` — smoke must end `ALL GOOD`. Run it before
claiming anything works. `prepublishOnly` runs build + smoke, so a red smoke blocks release.

## Where a tool lives

One group per file under `src/tools/*.ts`, exporting `registerXTools(server, ctx)`.
`src/server.ts` calls each group. A tool never reaches past `ToolContext`
(`src/tools/context.ts`) into an adapter.

## The five rules

1. **Answer through `text()`** from `src/mcp/response.ts` — or `image()`/`images()` when
   returning screenshots. Never hand-build a `content` array: the shape belongs in one place.
2. **`console.error` only.** stdout is the MCP channel; a `console.log` corrupts it for
   every client, and the symptom is a client that fails to parse rather than an error here.
3. **A writing tool takes `dry_run` and defaults it to `true`**, returning
   `{ dry_run: true, would_send: redact(...) }`. `redact()` keys off field NAMES, not value
   shapes — a token format can change, a field name is ours.
4. **Relative imports end in `.js`.** ESM / Node16. This applies inside `.ts` sources.
5. **Never hand-edit `src/catalog/api.generated.ts`.** Regenerate:
   `WB_REPO=/path/to/web_builder npm run codegen`.

## Credentials

`credentialFor(path)` in `src/transport/credential.ts` decides, by path prefix:
`/api/v1/…` → `SB_TOKEN` (`wbk_`), `/api/auth/…` → none, everything else → the session JWT.

This is **not** derivable from the OpenAPI document — it declares a single `BearerAuth`
scheme for both credentials. And it is not a soft preference: `/api/v1` answers
`401 api_key_required` to a session token. If you add a route family that breaks the
prefix rule, change that one function and its test, not the call site.

Read the session token as `ctx.session.token()` **per use**. Never capture it: it lives
~15 minutes and rotates, and a captured string replays an expired token silently.

## Under-described bodies

`describeOperation` reports three distinct verdicts, and they must stay distinct:

- a `$ref` resolves → `body_schema`
- a body is declared with no `$ref` (58 operations) → `body_warning`
- a write operation declares no body at all (60 operations) → `body_note`

The third is the dangerous one. It mixes genuine action endpoints with missing annotations
— `PUT /pages/{id}/source` takes an entire page document and is documented as taking
nothing. Reporting it as "no body" would have a model send an empty PUT and wipe a page.

## A writing tool publishes

Never call `doc.apply(patches)` from a tool. Go through `PageSession.applyAndPublish`, which
applies locally AND puts the batch on the live-edit wire when the agent has joined a room.
Skipping it fails invisibly: the document is right, the save is right, and only the humans
watching the editor see nothing happen.

The live client never answers `snapreq` and never publishes a `ckpt`. That is the yield
rule, and it is what keeps `src/live/session.ts` small. See `CLAUDE.md`.

## Registering

A new tool is not done until it appears in **three** places beyond its own file:
`src/server.ts`, `docs/tools.md` **and** `docs/tools.vi.md`, and the tool table in both
READMEs. Plus a test under `test/`.
