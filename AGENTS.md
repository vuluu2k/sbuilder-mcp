# AGENTS.md

This repository's working rules live in **`CLAUDE.md`** — read it first. It covers the
build/test/smoke gate, the invariants (stdout is the MCP channel, ESM `.js` imports,
secrets from env only, `text()` as the single response path, `dry_run` defaults), the
credential-routing rule, and the platform facts the code accounts for.

The design rationale lives in `docs/superpowers/specs/`; the implementation plans in
`docs/superpowers/plans/`.
