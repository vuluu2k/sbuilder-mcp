# AGENTS.md

This repository's working rules live in **`CLAUDE.md`** — read it first. It is short on
purpose: the build/test/smoke gate, the invariants (stdout is the MCP channel, ESM `.js`
imports, secrets from env only, `text()` as the single response path, `dry_run` defaults,
credential routing), the five silent traps, and the live-edit yield rule.

The platform facts the code accounts for live in `.claude/skills/<name>/SKILL.md`, one topic
each. `CLAUDE.md`'s routing table says which one to read for which files — read it BEFORE
changing code in that area; those facts were expensive to find and must not be re-derived.

The design rationale lives in `docs/superpowers/specs/`; the implementation plans in
`docs/superpowers/plans/`.
