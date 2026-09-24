# `.claude/` — the sbuilder-mcp agent kit

`CLAUDE.md` at the repo root is the entry point every session loads; everything in this
folder loads on demand. Modelled on the web_builder kit, at the size this repo needs.

## Layout

| Path | What it is | Loaded when |
| --- | --- | --- |
| `skills/<name>/SKILL.md` | Deep, topic-owned knowledge | Automatically, when the `description` matches the work |
| `agents/*.md` | Project subagents (`mcp-tool-author` writes, `mcp-verifier` only reads) | When delegated to |

The routing table (which skill for which files) lives in `CLAUDE.md`; keep the two in step.
To see what exists, list it — `ls skills/`, `ls agents/`. Deliberately not enumerated here.

Two audiences, kept apart on purpose: `sbuilder-site-design` is for an agent USING the
`sb_*` tools on a real site; every other skill is for an agent CHANGING this repo.

## Authoring rules for skills

A skill is read as fact by an agent that cannot see the code yet, so a wrong line is worse
than a missing one — it produces confident wrong work.

1. **Never hardcode an inventory or a count as current truth.** Element and operation counts
   move with every platform regen. Name what produces the answer (`npm run codegen:check`,
   `SWAGGER_SOURCE`, `ELEMENT_SOURCE`) instead. A count inside a historical entry is fine —
   it records what was measured that day.
2. **State the rule and the why.** The why is what lets a reader tell whether the rule still
   applies after the platform moved.
3. **One topic, one owner.** Two skills that both trigger on the same files cost double and
   eventually disagree. Point at the owner instead.
4. **Keep the `description` trigger-shaped** — it is the only thing read when deciding to
   load the file, so it must say WHEN (files, tools, symptoms), not just what.
5. **When a fact inverts, say so** in a one-line "this used to say X" note, so the next reader
   does not "fix" it back. This platform widens what it allows faster than this kit notices.
6. **Prove any guard you add** — a check that has never fired against a deliberate failure is
   indistinguishable from one that does not work.

When the user corrects a decision or a platform fact turns out wrong, fold the lesson into
the OWNING skill in the same session. Being corrected twice for the same thing is a kit bug.
