#!/usr/bin/env node
/**
 * `npm run fidelity`'s actual launcher. Compiles `test/fidelity/run.ts` (and
 * everything under `src/**` it reaches) with plain `tsc`, into a scratch
 * output directory, and runs the result with plain `node` — never `tsx`.
 *
 * WHY NOT JUST `tsx test/fidelity/run.ts`, THE OBVIOUS THING. `tsx` rewrites
 * every function body to call an injected `__name` helper (esbuild's
 * `keepNames`, hardcoded `true` in tsx's own transform options — not a
 * tsconfig setting, not an env var, nothing a caller can turn off). That is
 * invisible for ordinary code, because the helper lives in the same module
 * `tsx` transformed. It is NOT invisible for `capturePage`
 * (`src/vision/capture.ts`), because `page.evaluate(capturePage, ...)` takes
 * that function's SOURCE TEXT via `.toString()` and re-evaluates it inside
 * Playwright's isolated browser context — a context that never had the
 * module `__name` was injected into. So every fixture failed, in every mode,
 * before ever reaching a site, with `ReferenceError: __name is not defined`.
 * This is the same serialization trap `CLAUDE.md` already records for a
 * function closing over a module-scope constant — reached this time from the
 * opposite direction: not an author's closure, the TRANSPILER's own
 * injection. Plain `tsc` adds no such wrapper, so compiling and running the
 * output sidesteps the whole class of bug rather than working around one
 * instance of it.
 *
 * The scratch directory is REBUILT every run — deleted first, recompiled,
 * deleted again after — so this can never measure against a stale compile
 * the way a checked-in `dist/` could if a caller forgot to rebuild first.
 *
 * `test/fidelity/fixtures.json` and the `baseline.json` this writes both live
 * next to `run.ts`'s SOURCE, not its compiled copy — `run.ts` resolves both
 * relative to its own `import.meta.dirname`, which after compilation is the
 * scratch directory, not `test/fidelity/`. So this copies the fixtures in
 * before running and the baseline back out after, rather than teaching
 * `run.ts` about a build layout it should not need to know about.
 */
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = resolve(ROOT, '.fidelity-run');
const REAL_FIDELITY_DIR = resolve(ROOT, 'test/fidelity');
const SCRATCH_FIDELITY_DIR = resolve(SCRATCH, 'test/fidelity');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

// A clean slate every run — no leftover from an interrupted previous one, and
// no way for this to measure against anything but a fresh compile.
rmSync(SCRATCH, { recursive: true, force: true });

const tscStatus = run(resolve(ROOT, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.fidelity.run.json']);
if (tscStatus !== 0) {
  console.error('fidelity: tsc failed, see above');
  process.exit(tscStatus);
}

mkdirSync(SCRATCH_FIDELITY_DIR, { recursive: true });
copyFileSync(resolve(REAL_FIDELITY_DIR, 'fixtures.json'), resolve(SCRATCH_FIDELITY_DIR, 'fixtures.json'));

const runStatus = run(process.execPath, [resolve(SCRATCH_FIDELITY_DIR, 'run.js')]);

// Copy back whatever baseline the run produced, REGARDLESS of its exit code —
// `run.ts` itself already refuses to write one when every fixture failed, so
// a baseline existing here means it is real and worth keeping even if this
// process's own exit code says something else went wrong on the way out.
const scratchBaseline = resolve(SCRATCH_FIDELITY_DIR, 'baseline.json');
if (existsSync(scratchBaseline)) {
  copyFileSync(scratchBaseline, resolve(REAL_FIDELITY_DIR, 'baseline.json'));
}

rmSync(SCRATCH, { recursive: true, force: true });
process.exit(runStatus);
