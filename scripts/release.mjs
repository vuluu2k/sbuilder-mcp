#!/usr/bin/env node
/**
 * One command to cut a release: gate, bump, write the changelog, publish, tag,
 * announce.
 *
 * `npm run release` (or release:patch / :minor / :major), `--dry` to rehearse.
 *
 * WHY A SCRIPT AND NOT A CI WORKFLOW. Publishing needs an npm OTP, which a
 * human types. A workflow would need a long-lived automation token in repo
 * secrets — a credential that can publish this package forever, sitting where
 * more people can read it than can currently publish. CI runs the gate on every
 * push; the irreversible step stays on a person's machine.
 *
 * THE ORDER IS THE DESIGN: everything that can REFUSE runs before anything that
 * cannot be undone. A dirty tree, a wrong branch, an unpushed main and a red
 * gate all stop the release while stopping is still free. The version bump,
 * changelog and commit are local and reversible with one named command; only
 * `npm publish` is not, and it is the last thing that happens before the push.
 */
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const bump = args.find((a) => ['patch', 'minor', 'major'].includes(a)) ?? 'patch';
/**
 * A 2FA one-time password, for running this without a terminal to type into.
 *
 * With a TTY npm prompts for it and this is unnecessary. Without one — CI, or an
 * agent driving the release — npm fails with EOTP before uploading anything,
 * which is the safe direction but leaves the release half-done. Passing it
 * through makes the script finishable either way.
 */
const otp = args.find((a) => a.startsWith('--otp='))?.slice('--otp='.length);

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const say = (m) => console.log(`\n\x1b[1m▸ ${m}\x1b[0m`);
const die = (m) => {
  console.error(`\n\x1b[31m✖ ${m}\x1b[0m`);
  process.exit(1);
};
const pkg = () => JSON.parse(readFileSync('package.json', 'utf8'));

/**
 * Is this npm failure a missing one-time password?
 *
 * Matched on the ERROR CODE npm prints, not on prose: the wording of the message
 * has changed between npm versions and would drift, while `EOTP` is the
 * documented code.
 */
export function needsOtp(text) {
  return /\bEOTP\b/.test(text) || /one-time password/i.test(text);
}

/**
 * Publish, and ASK for the one-time password rather than dying on it.
 *
 * With a TTY npm usually prompts for itself, and this never fires. When it does
 * not — some configurations fail straight to EOTP — the release would otherwise
 * die at the one irreversible step with the version bump already committed and
 * tagged, leaving the user a cleanup they did not ask for. A forgotten OTP
 * should cost one prompt, not a failed release.
 *
 * stderr is PIPED so the code can be read, and echoed afterwards so nothing is
 * hidden; stdout stays inherited so npm's own progress is live.
 *
 * Three attempts, because a mistyped six-digit code is the ordinary case and a
 * code that expires mid-typing is the next one.
 */
export async function publishWithOtp(initial, deps = {}) {
  // `run` and `ask` are INJECTED so this can be tested without a real npm and
  // without a terminal. The first attempt to verify it went through PATH games
  // and a pty and proved nothing — the real npm ran instead of the fake and the
  // test passed vacuously. Passing the two effects in removes the possibility.
  const run =
    deps.run ??
    ((args) => {
      const r = spawnSync('npm', args, { stdio: ['inherit', 'inherit', 'pipe'] });
      return { status: r.status, stderr: (r.stderr ?? '').toString() };
    });
  const ask =
    deps.ask ??
    (async (prompt) => {
      if (!stdin.isTTY) return '';
      const rl = createInterface({ input: stdin, output: stdout });
      try {
        return (await rl.question(prompt)).trim();
      } finally {
        rl.close();
      }
    });
  const log = deps.log ?? ((t) => process.stderr.write(t));

  // Bounded by the number of ASKS, not attempts, so the last code typed is
  // always the one tried. An earlier version capped attempts instead: it asked
  // three times and used only the first two, so a user who got it right on the
  // third try watched the release fail anyway. Never ask for something you will
  // not use.
  let code = initial;
  for (let asks = 0; ; asks++) {
    const res = run(['publish', '--access', 'public', ...(code ? [`--otp=${code}`] : [])]);
    if (res.status === 0) return true;
    log(res.stderr);
    if (!needsOtp(res.stderr) || asks >= 3) return false;
    code = await ask('\n  npm wants a one-time password. Enter it: ');
    if (!code) return false;
  }
}

/**
 * Only RUN when invoked directly.
 *
 * Without this, importing the file to test its helpers executes the whole
 * release — the first test run called `die` from the dirty-tree check and
 * reported "process.exit unexpectedly called". A script whose helpers are worth
 * testing has to be importable without doing anything.
 */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {

  // ---- refusals, cheapest first ------------------------------------------
  say('checking the tree');
  if (out('git status --porcelain')) die('working tree is dirty — commit or stash first');
  const branch = out('git rev-parse --abbrev-ref HEAD');
  if (branch !== 'main') die(`on "${branch}" — release from main`);

  // No origin is a legitimate state — a fresh repo, a fork not yet pushed — and
  // crashing on it with a stack trace is the unreadable failure this script exists
  // to avoid. There is simply nothing to be behind.
  let hasOrigin = true;
  try {
    execSync('git remote get-url origin', { stdio: 'ignore' });
  } catch {
    hasOrigin = false;
    console.log('  no origin remote — skipping the up-to-date check');
  }
  if (hasOrigin) {
    try {
      run('git fetch --quiet origin main');
      if (out('git rev-list --count HEAD..origin/main') !== '0') {
        die('origin/main is ahead — pull first');
      }
    } catch (err) {
      if (String(err).includes('origin/main is ahead')) throw err;
      console.log('  could not reach origin — continuing on the local tree');
    }
  }

  say('running the gate');
  run('npm run build');
  run('npm test');
  run('npm run smoke');

  // ---- what changed, as a starting draft ---------------------------------
  // Read BEFORE the bump so the tag range is the previous release's, and offered
  // as a draft rather than written blind: a generated changelog is a commit log
  // with a new name, and nobody reads those. It is here to save typing, not to
  // replace the sentence a human would write.
  let lastTag = '';
  try {
    lastTag = out('git describe --tags --abbrev=0');
  } catch {
    /* first release — there is no previous tag */
  }
  const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
  const commits = out(`git log ${range} --no-merges --pretty=format:%s`)
    .split('\n')
    .filter(Boolean)
    // Housekeeping is real work and still not news to whoever reads a changelog.
    .filter((s) => !/^(chore|ci|build|style|test)(\(|:)/.test(s));

  // ---- the bump, local and reversible ------------------------------------
  const before = pkg().version;
  say(`bumping ${bump}`);
  run(`npm version ${bump} --no-git-tag-version`);
  const version = pkg().version;
  console.log(`  ${before} → ${version}`);

  /**
   * Put the bump back.
   *
   * From here until the release commit exists, an abort leaves a MODIFIED
   * package.json — and the very first thing the next run does is refuse a dirty
   * tree, for a reason that has nothing to do with the user's own work. Ctrl-C at
   * the changelog prompt is the ordinary way to reach this, so it cannot be left
   * as an exercise.
   */
  let committed = false;
  const restore = () => {
    if (committed) return;
    try {
      execSync('git checkout -- package.json package-lock.json', { stdio: 'ignore' });
    } catch {
      try {
        execSync('git checkout -- package.json', { stdio: 'ignore' });
      } catch {
        /* nothing to restore */
      }
    }
  };
  // SIGINT is the one a user sends; SIGHUP and SIGTERM are the ones a closing
  // terminal and a killed shell send, and all three land in the same place — a
  // bumped package.json nobody asked for. Found by killing the process from a
  // test harness and watching the tree stay dirty.
  for (const sig of ['SIGINT', 'SIGHUP', 'SIGTERM']) {
    process.on(sig, () => {
      restore();
      console.error(`\n\x1b[31m✖ ${sig} — the version bump was rolled back\x1b[0m`);
      process.exit(sig === 'SIGINT' ? 130 : 1);
    });
  }
  process.on('uncaughtException', (err) => {
    restore();
    console.error(`\n\x1b[31m✖ ${err?.message ?? err}\x1b[0m`);
    console.error('  the version bump was rolled back');
    process.exit(1);
  });

  // ---- the changelog entry: typed, with the draft to hand ----------------
  async function askEntry() {
    const draft = commits.map((c) => `- ${c}`).join('\n');

    if (!stdin.isTTY) {
      // Piped or CI: no one is there to type. Use the draft rather than blocking
      // forever on a prompt nobody will answer.
      console.log('  not a terminal — using the generated draft');
      return draft || '- (no user-facing changes recorded)';
    }

    console.log(`\n  ${commits.length} commit(s) since ${lastTag || 'the beginning'}:\n`);
    console.log(draft ? draft.replace(/^/gm, '    ') : '    (none)');
    console.log(
      '\n  Write the changelog entry for this release.\n' +
        '  Finish with a blank line. Press Enter on the FIRST line to accept the draft above.\n',
    );

    const rl = createInterface({ input: stdin, output: stdout });
    const lines = [];
    try {
      for (;;) {
        let line;
        try {
          line = await rl.question(lines.length === 0 ? '  > ' : '  | ');
        } catch (err) {
          // Ctrl-D / EOF. readline rejects with ABORT_ERR, and letting that
          // escape printed a stack trace over a half-bumped package.json. At a
          // line prompt that a blank line already ends, Ctrl-D means "that is all
          // I have to say" — so it finishes the entry rather than killing the run.
          if (err?.code === 'ABORT_ERR' || err?.code === 'ERR_USE_AFTER_CLOSE') break;
          throw err;
        }
        if (line.trim() === '') break;
        lines.push(line);
      }
    } finally {
      rl.close();
    }
    return lines.length > 0 ? lines.join('\n') : draft || '- (no user-facing changes recorded)';
  }

  const entry = await askEntry();
  const date = out('git log -1 --format=%cs'); // the commit's own date, not the clock
  const heading = `## ${version} — ${date}\n\n${entry.trim()}\n`;

  if (dry) {
    console.log('\n\x1b[1m▸ DRY RUN — nothing was changed\x1b[0m\n');
    console.log('CHANGELOG.md would gain:\n');
    console.log(heading.replace(/^/gm, '  '));
    console.log('  then: npm publish --access public');
    console.log(`  then: git tag v${version} && git push --follow-tags`);
    console.log(`  then: gh release create v${version}`);
    restore();
    process.exit(0);
  }

  say('writing CHANGELOG.md');
  const CL = 'CHANGELOG.md';
  const existing = existsSync(CL) ? readFileSync(CL, 'utf8') : '# Changelog\n';
  // Newest first, under the title. Splitting on the first blank line after the
  // heading keeps a hand-written preamble if one is ever added.
  const nl = existing.indexOf('\n');
  const title = nl === -1 ? existing : existing.slice(0, nl + 1);
  const rest = nl === -1 ? '' : existing.slice(nl + 1).replace(/^\n+/, '');
  writeFileSync(CL, `${title}\n${heading}\n${rest}`);

  // server.json carries the version twice (the manifest and its package entry),
  // and a registry entry pointing at a version npm does not have is worse than a
  // stale one — it 404s for whoever trusts it.
  if (existsSync('server.json')) {
    say('syncing server.json');
    const sj = JSON.parse(readFileSync('server.json', 'utf8'));
    sj.version = version;
    for (const p of sj.packages ?? []) p.version = version;
    writeFileSync('server.json', JSON.stringify(sj, null, 2) + '\n');
  }

  say('committing');
  run('git add -A');
  run(`git commit -q -m "release: v${version}"`);
  run(`git tag v${version}`);
  committed = true; // past here, `undo` below is the way back, not `restore`

  const undo = `git tag -d v${version} && git reset --hard HEAD~1`;

  say('publishing to npm');
  const ok = await publishWithOtp(otp);
  if (!ok) {
    die(`npm publish failed. Nothing was pushed. To undo the local release commit:\n  ${undo}`);
  }

  say('pushing');
  run('git push --follow-tags');

  say('drafting the GitHub release');
  const gh = spawnSync('gh', ['release', 'create', `v${version}`, '--notes', entry.trim()], {
    stdio: 'inherit',
  });
  if (gh.status !== 0) console.log('  (gh release failed — the npm publish already succeeded)');

  say(`done — ${pkg().name}@${version}`);
  console.log(`  npx -y ${pkg().name}`);

}
