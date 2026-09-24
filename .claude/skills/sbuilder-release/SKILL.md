---
name: sbuilder-release
description: How sbuilder-mcp releases to npm and the MCP Registry — the auto-release workflow, how the bump is chosen, the offline `npm run release` path, and the four ways the first live release went wrong. Triggers when pushing to main with src/** changes, dispatching or cancelling a release run, rotating NPM_ACCESS_TOKEN, editing .github/workflows/auto-release.yml or scripts/release.mjs, or when a release failed.
---

# Releasing `sbuilder-mcp`

**Triggers:** `.github/workflows/auto-release.yml`, `scripts/release.mjs`, `CHANGELOG.md`, `server.json`, a push to `main` touching `src/**`.



Each entry below is a fact that cost real investigation, kept verbatim from the era when
`CLAUDE.md` carried all of them. Do not re-derive them, and do not "fix" the code that accounts
for them. Counts inside an entry are what was measured THAT day — trust the generator or the
repo over a number here, and fix the line when you catch one stale.

## The pipeline

A push to `main` that touches `src/**` releases on its own through
`.github/workflows/auto-release.yml`: the gate (build, test, smoke), a bump read off the
commit subject (`feat` → minor, `BREAKING CHANGE` or `!` → major, else patch; a
`workflow_dispatch` run picks its own), a bilingual changelog entry written by Claude,
`server.json` synced, a `chore(release): vX.Y.Z` commit plus tag, then npm publish, a GitHub
Release, and the MCP Registry through GitHub OIDC. Secrets, in the `prod` environment:
`NPM_ACCESS_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN`; the registry step needs none. The
workflow skips a head commit whose subject contains `chore(release):` or `release: v`, so a
release never triggers a second one. `npm run release` (`scripts/release.mjs`) is the
offline path — no CI, or a secret mid-rotation — and it MUST keep writing the same
`## [x.y.z] - date` heading and the same commit subject, because the workflow prepends above
the first `## [` line and matches the subject as its skip guard.

Three things the first live release cost, so nobody pays them twice:

- **`gh workflow run` starts TWO runs**, observed both times it was used here. The second
  queues behind the `auto-release` concurrency group and would release again after the
  first. Cancel it — and read each run's dispatch inputs before cancelling either, because
  they are not interchangeable: choosing by status alone released a patch when the run
  carrying `bump=minor` was the one cancelled.
- **`NPM_ACCESS_TOKEN` must be an npm AUTOMATION token** (or a granular token with read and
  write). A classic "publish" token still demands an OTP, and CI answers `EOTP` after the
  tag is already pushed.
- **The bump is read from the HEAD COMMIT ALONE**, not from the range being pushed:
  `github.event.head_commit.message`. So a ten-commit push carrying two `feat(` commits
  released as a PATCH because the last commit was a `fix(`. Nothing was wrong with the
  release — the changelog described the features correctly — but the version understated
  them. If a push is meant to land a minor, either make the LAST commit the `feat`, or
  dispatch the run with `bump=minor` instead of relying on the push trigger.
- **Never re-run a failed release run.** It replays the OLD commit, whose `package.json`
  predates the release commit, so it bumps again. Dispatch a fresh run on `main` instead:
  resume mode sees the pushed tag and the missing npm version and publishes that version.
