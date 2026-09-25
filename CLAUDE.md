# CLAUDE.md — `sbuilder-mcp`

Primary project-rules file, and deliberately short: it is loaded into **every** session, so it
carries only what is needed to orient, plus the invariants that are dangerous to learn late.
Everything else lives in `.claude/skills/`, which load on demand — see the routing table.
`AGENTS.md` points any non-Claude agent at the same material.

## What this is

An MCP **stdio** server that lets an AI agent operate a Store Builder site end to end —
design its pages, fill them with real data, look at the result, and publish it — with no
human clicking anything.

It is **not** a renderer. Every pixel comes from the platform's Go renderer; this server
only ever holds the document and the screenshots.

Published to npm as `sbuilder-mcp`, binary `sb-mcp`. Runs via `npx -y sbuilder-mcp`.

## Commands

```bash
npm run build     # tsc -> dist/
npm test          # vitest run
npm run smoke     # offline self-test; MUST print "ALL GOOD"
npm run codegen   # WB_REPO=/path/to/web_builder npm run codegen
npm run codegen:check  # same, but writes nothing and exits 1 if the catalog is stale
npm start         # node dist/index.js (stdio server)
```

**The gate for every change is `npm run build && npm test && npm run smoke`.**
`prepublishOnly` runs build + smoke, so a broken smoke blocks publishing.

### Dogfooding this server on this repo

`npx -y sbuilder-mcp` **cannot start when the cwd IS this repo**, and the failure looks like
a broken install rather than a cwd problem:

```
sh: sb-mcp: command not found     → the MCP client reports CONNECTION_CLOSED
```

npx sees a `package.json` whose name is `sbuilder-mcp`, decides the package is the local
project, reads `bin` off it and execs `sb-mcp` — which is not in this repo's
`node_modules/.bin`, because a package is not installed into itself. Nothing is wrong with
the published package: the same command works from any other directory.

Restore it — and get the LOCAL build served to the agent, which is what dogfooding wants:

```bash
ln -sf ../../dist/index.js node_modules/.bin/sb-mcp && chmod +x dist/index.js
```

`node_modules/` is not tracked, so **`npm ci` removes this and the server stops connecting
again**. The exec bit survives `tsc`, so after the first setup a plain `npm run build` is
enough for an edit to reach the agent — followed by a reconnect in the MCP client, which
does not re-read a running server.

### Is the catalog still current?

`npm run codegen` is a MANUAL step, so the catalog goes stale in SILENCE — the platform moves
fast enough that this is the normal state. Check it against a COMMITTED, PUSHED ref (codegen
refuses a dirty or unpublished checkout, and `--dirty` is the deliberate override):

```bash
git -C <web_builder> worktree add --detach <scratch>/wb origin/main   # symlink node_modules in
WB_REPO=<scratch>/wb npm run codegen:check
```

Everything else about the generator — why each refusal exists, every reader and its join
rules, what to do when an assertion exits 1 — is `sbuilder-codegen`.

## Releasing

A push to `main` touching `src/**` releases on its own (`.github/workflows/auto-release.yml`),
and the bump is read from the HEAD COMMIT ALONE. Never re-run a failed release run. Before
pushing a release-bearing change or dispatching a run, load `sbuilder-release`.

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
  repo is public. No secret reaches a file, a log, or a tool result. `SB_SITE` rides in the
  same envelope without being one: a key belongs to exactly ONE site, so the id is a
  constant the install knows, and every `site_id` argument falls back to it through
  `siteFor()`. An explicit argument still wins, so a session spanning two sites works by
  naming each.
- **Every tool answers through `text()`** (or `image()`/`images()`) from `src/mcp/response.ts`.
  A hand-built content array is the shape that drifts.
- **Mutating tools take `dry_run` and default it to `true`**, returning a request preview
  passed through `redact()`.
- **An element's default BINDINGS come from codegen, and `createNode` seeds them.** They are
  a function of `config.datasetSource` + `config.kind`, so `sb_set` re-derives them from the
  generated table when either moves. A dataset element without them renders its placeholder
  forever, saving and publishing all the way.
- **Every result is compact JSON, and every directive is said once per process through
  `ctx.notices`**; a tool that repeats a notice on every call is the shape that drifts.
  `test/token-budget.test.ts` is the scale — a diet without one comes back.
- **Credential routing is by path prefix**, in `src/transport/credential.ts`, and is not
  negotiable: `/api/v1/…` → `SB_TOKEN`; everything else is `siteScoped` — it takes EITHER
  credential and prefers the key, because a key is narrower (revocable on its own, scoped,
  bound to one store) while a session carries the whole account. The OpenAPI
  document declares one `BearerAuth` scheme for both, so it *cannot* make this call, and
  the platform refuses each credential on the other's surface.
- **`src/catalog/api.generated.ts` is generated and committed.** Never hand-edit it;
  regenerate with `npm run codegen`. It is committed so `npm install` needs no
  `web_builder` checkout.

## Where the detail lives — routing table

Load the skill BEFORE starting the work, not after you're stuck.

| Doing this | Load |
| --- | --- |
| Adding or changing a tool, `src/tools/**`, `src/server.ts` | `sbuilder-mcp-tools` (agent: `mcp-tool-author`) |
| Running codegen, a stale catalog, `scripts/**`, `src/catalog/**` | `sbuilder-codegen` |
| Transport, credentials, `sb_api_call`, media upload, versions, apps, theme write, the socket | `sbuilder-platform-api` |
| The page document, `src/core/**`, `sb_add`/`sb_set`/`sb_review`, satellites, overlays, globals, states | `sbuilder-document-model` |
| `sb_store` flows, store page seeds, fixed paths, layout patterns, templates | `sbuilder-store-flows` |
| `src/vision/**`, `sb_look`, `sb_import`, `sb_import_site`, the fidelity harness | `sbuilder-vision-import` |
| DESIGNING or building a site with the `sb_*` tools (not editing this repo) | `sbuilder-site-design` |
| Releasing, the auto-release workflow, npm tokens | `sbuilder-release` |
| Verifying before "done" | agent `mcp-verifier` (read-only) |

Code comments that say "CLAUDE.md records X" predate the split into skills; X now lives in
the skill this table names for that file.

## The five traps — each fails SILENTLY

Encoded in `src/domains/site/traps.ts` (trap 5 in `src/core/tree.ts` / `builder.ts`), each
with its own test. Full text and history: `sbuilder-document-model`.

1. **Site overlays** (cart drawer, pop-ups) are composed onto ROOT on read and stripped on
   write. Walk ROOT with `pageChildren()`, never `childrenOf()`.
2. **Global sections** are shared masters — an edit lands on every page, and publish cascades.
3. **Band order** — ROOT's children must read `[header*][middle*][footer*]` or the platform
   refuses EVERY save.
4. **Responsive by default, not by refusal.** `setKeys` writes per breakpoint; base is the
   cascade's fallback layer and legitimate. But the platform's `BASE_ONLY_CONFIG` keys are
   read from base only — `baseonly.ts` routes them there. The cascade's tail
   (current → wider → BASE → narrower) means a tablet-only key reaches desktop.
5. **App blocks** — an edit inside a composed app block is stored nowhere. Writes refuse the
   interior via `refuseAppBlockInterior`.

## The yield rule

The live-edit client is NEVER the authority on a document. It does not answer `snapreq` for
anyone and publishes no convergence checkpoint of its own. On any evidence of divergence —
a gap in `seq`, a checkpoint at its own seq, a rejected save — it discards its copy,
re-pulls. The next write is then reapplied ONCE onto the fresh tree (patches address nodes by
id) unless the other side changed a node it touches or local edits were unsaved — then it
FAILS LOUDLY so the caller re-reads and reapplies.

This is what lets `src/live/session.ts` be one small class instead of the editor's outbox
deferral plus inbox arbitration plus "who pulls" tie-break — roughly a thousand lines whose
entire purpose is arbitrating between two EQUALLY authoritative editors. Alone in the room
the agent is the sole writer and the rule costs nothing, so it is a mode rather than a
permanent sacrifice. Do not "fix" it by making this client answer snapshots.

A tool that writes must go through `PageSession.applyAndPublish`, never `doc.apply`
directly — otherwise the local document is right, the save is right, and only the humans
watching see nothing happen.

## Adding a tool

`src/tools/*.ts` → `server.registerTool` with MCP annotations → answer through `text()` →
`dry_run` defaulting to `true` if it writes → register in `src/server.ts` → a test under
`test/` → document in `docs/tools.md`, `docs/tools.vi.md` and both READMEs → the gate. The
full contract is `sbuilder-mcp-tools`; `mcp-tool-author` enforces it and `mcp-verifier`
checks it without editing.

## Working accuracy

- Don't fabricate paths, keys, operation ids or counts. Look them up (`sb_api_find`,
  `sb_traits_for`, the generated catalog) or ASK.
- **Verify before claiming done** — `npm run build && npm test && npm run smoke`, plus
  `SB_BROWSER_TEST=1 npm test` after touching `src/vision/**`. Cite the output.
- **Review is a separate pass.** The agent that wrote the change is not the one that signs it
  off; `mcp-verifier` produces the evidence and carries no write tool.
- **A capability recorded as ABSENT is worth re-measuring before building around it.** Three
  times a "you cannot" here (agent keys, customer accounts, reveal-on-scroll) outlived the
  thing that made it true.

## Continuous improvement (user mandate)

When the user corrects a behaviour or a platform fact turns out wrong, fold it in IN THE SAME
SESSION — one rule plus the why — **in the skill that OWNS the topic, not here**. This file is
paid for on every task; a line earns a place here only if it is cross-cutting or dangerous to
learn late. Authoring rules for skills: `.claude/README.md`.

## The `.claude/` kit

`.claude/README.md` documents it: what each directory is, the authoring rules for skills, and
how to add one. It deliberately does not enumerate skills or agents — `ls .claude/skills/`
and `ls .claude/agents/` are the inventory.

Design spec: `docs/superpowers/specs/2026-08-27-sbuilder-mcp-design.md` — read it before
changing anything structural. Per-phase specs and plans: `docs/superpowers/`.
