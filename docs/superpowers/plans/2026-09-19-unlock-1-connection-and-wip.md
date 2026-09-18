# Unlock 1 — Connection and work in progress: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The server connects from this repo again, the in-progress `item_offset` change lands as one commit, and the two codegen test files stop timing out under load.

**Architecture:** No design change. Three small, independent tasks: restore the dogfood symlink CLAUDE.md records; run the gate over the existing uncommitted diff and commit it; give two test files a per-file timeout that matches what they measure.

**Tech Stack:** Node ≥22, TypeScript (ESM / Node16), vitest.

**Spec:** `docs/superpowers/specs/2026-09-19-unlock-platform-reach-design.md`, section 3.

## Global Constraints

- The gate for every change is `npm run build && npm test && npm run smoke`; smoke MUST print `ALL GOOD`.
- Every relative import ends in `.js`. Every log line is `console.error`; stdout is the MCP channel.
- No prettier; never reformat a file you did not otherwise change.
- Commit subjects decide the release bump: `feat` → minor, `fix`/`chore` → patch.
- End commit messages with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Restore the dogfood link

**Files:**
- Create: `node_modules/.bin/sb-mcp` (a symlink; `node_modules/` is untracked)
- Modify: exec bit on `dist/index.js`

**Interfaces:**
- Consumes: nothing.
- Produces: an `sb-mcp` binary on `node_modules/.bin` that runs this repo's LOCAL build, so `npx -y sbuilder-mcp` connects from this cwd.

- [ ] **Step 1: Confirm the failure shape**

Run: `ls -la node_modules/.bin/sb-mcp`
Expected: `No such file or directory`. (If it exists and points at `../../dist/index.js`, skip to Step 4.)

- [ ] **Step 2: Create the link and the exec bit**

```bash
cd /Volumes/workspace/webcake/sbuilder-mcp
npm run build
ln -sf ../../dist/index.js node_modules/.bin/sb-mcp && chmod +x dist/index.js
```

- [ ] **Step 3: Prove the binary starts**

Run: `printf '' | timeout 5 node_modules/.bin/sb-mcp; echo "exit $?"`
Expected: no `command not found`; the process exits (0 or 124) after printing at most `console.error` lines. Anything on stdout other than JSON-RPC is a defect.

- [ ] **Step 4: Tell the user to reconnect**

Nothing to commit. In the final report say: the MCP client does not re-read a running server, so reconnect `sbuilder` in the client.

---

### Task 2: Land `item_offset`

**Files:**
- Modify (already modified, uncommitted): `src/tools/api.ts`, `test/api-call.test.ts`, `docs/tools.md`, `docs/tools.vi.md`, `README.md`, `README.vi.md`

**Interfaces:**
- Consumes: the existing diff (`git diff`), which adds `item_offset?: number` to `CallArgs`, slices a list answer after the platform's paging, refuses a positive offset on any method but GET/HEAD, keeps original fields when `pick` matches nothing on every item, and reports `offset` / `next_item_offset` in the truncation block.
- Produces: `CallArgs.item_offset` and `shapeResponse(raw, { pick?, max_items?, item_offset? })` — Plan 2 builds on this signature.

- [ ] **Step 1: Read the whole diff once**

Run: `git diff -- src/tools/api.ts test/api-call.test.ts docs/tools.md docs/tools.vi.md README.md README.vi.md`
Check: every hunk is about `item_offset` or the wording it changed. If any hunk is unrelated, stop and report it rather than committing it.

- [ ] **Step 2: Run the focused test file**

Run: `npx vitest run test/api-call.test.ts`
Expected: all tests in the file pass.

- [ ] **Step 3: Run the gate**

Run: `npm run build && npm test && npm run smoke`
Expected: build clean; smoke prints `ALL GOOD`. The two codegen test files may time out on a loaded machine (Task 3 fixes that); if those are the ONLY failures, proceed and note it.

- [ ] **Step 4: Commit**

```bash
git add src/tools/api.ts test/api-call.test.ts docs/tools.md docs/tools.vi.md README.md README.vi.md
git commit -m "feat(api): page within a list answer with item_offset

A list answer that outgrew the result cap could only be narrowed with pick or the
operation's own paging, and many listings have none. item_offset slices the returned
list after the platform's paging, reads only, and never reports a continuation that
does not advance.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Give the codegen tests the time they measure

**Files:**
- Modify: `test/codegen-dirty.test.ts:1-18`
- Modify: `test/codegen-undocumented.test.ts:1-24`

**Interfaces:**
- Consumes: vitest's `vi.setConfig({ testTimeout })`, file-scoped.
- Produces: nothing other tasks use.

- [ ] **Step 1: Reproduce**

Run: `npx vitest run test/codegen-dirty.test.ts test/codegen-undocumented.test.ts`
Expected on a loaded machine: two to five tests fail with `Test timed out in 5000ms`, each measured 6-8 s. On an idle machine they pass; the fix still applies because the measurement is real.

- [ ] **Step 2: Set a file-level timeout in both files**

In `test/codegen-dirty.test.ts`, after the imports (line 5) add:

```ts
import { vi } from 'vitest';

// Every test here spawns `tsx scripts/gen-catalog.ts` against a scratch git
// repo. Measured 6-8 s per test on a loaded machine against vitest's 5 s
// default, so the suite went red on load alone. 20 s is headroom, not a
// measurement.
vi.setConfig({ testTimeout: 20_000 });
```

If `vi` is already imported from `'vitest'` on line 1, add it to that import instead of a second import line.

In `test/codegen-undocumented.test.ts`, do the same after its imports, with the same comment.

- [ ] **Step 3: Run the two files**

Run: `npx vitest run test/codegen-dirty.test.ts test/codegen-undocumented.test.ts`
Expected: all 10 tests pass.

- [ ] **Step 4: Commit**

```bash
git add test/codegen-dirty.test.ts test/codegen-undocumented.test.ts
git commit -m "test(codegen): the spawned-tsx tests measured 6-8 s against a 5 s default

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
