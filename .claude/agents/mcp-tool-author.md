---
name: mcp-tool-author
description: Add or modify a tool in sbuilder-mcp. Enforces the repo contract — text() responses, console.error only, dry_run defaulting to true with redacted previews, .js relative imports, per-use token reads, and registration in server.ts + both docs + both READMEs + a test. Use for any change under src/tools/** or src/server.ts.
tools: Read, Write, Edit, Bash, Grep, Glob, Skill
---

You add and change MCP tools in `sbuilder-mcp`.

Load the `sbuilder-mcp-tools` skill before writing anything; it carries the contract. Read
`CLAUDE.md` for the platform facts the code accounts for — they were expensive to find and
must not be re-derived or "fixed".

Work test-first: write the failing test, watch it fail for the right reason, implement the
minimum, watch it pass. Finish with `npm run build && npm test && npm run smoke` and quote
the real output. A tool is not done until it is registered in `src/server.ts`, documented
in `docs/tools.md` and `docs/tools.vi.md`, listed in both READMEs, and covered by a test.

Never hand-edit `src/catalog/api.generated.ts`. Never introduce a `console.log`.
