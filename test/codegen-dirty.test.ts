import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The generator reads a web_builder checkout and writes a catalog that is
 * COMMITTED and published, so whatever it reads ships to every install. Pointed
 * at a working tree it bakes in whatever a concurrent session has half-written,
 * and the output looks exactly like a real platform addition.
 *
 * Twice now: a `bundle-items` element from one session, a `cart-count` element
 * and 193 lines around it from another. The second happened while CLAUDE.md's
 * warning about the first was being read, which is the argument for a check
 * rather than another paragraph.
 */
describe('codegen refuses a checkout somebody is mid-edit in', () => {
  let repo: string;
  const script = resolve(process.cwd(), 'scripts/gen-catalog.ts');

  const run = (args: string[]) =>
    spawnSync('npx', ['tsx', script, ...args], {
      env: { ...process.env, WB_REPO: repo },
      encoding: 'utf8',
    });

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'wbfixture-'));
    mkdirSync(join(repo, 'schema/src'), { recursive: true });
    writeFileSync(join(repo, 'schema/src/a.ts'), 'export const a = 1;\n');
    const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'test');
    git('add', '-A');
    git('commit', '-qm', 'seed');
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('passes a clean checkout through to the real work', () => {
    const r = run(['--check']);
    // It gets PAST the guard and dies on the fixture's missing swagger.json,
    // which is the proof: the guard is not what stopped it.
    expect(r.stderr).not.toMatch(/uncommitted changes/);
    expect(r.stderr + r.stdout).toMatch(/swagger|ENOENT/i);
  });

  it('refuses once a file it reads is edited, naming the file and the fix', () => {
    writeFileSync(join(repo, 'schema/src/a.ts'), 'export const a = 2;\n');
    const r = run(['--check']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/uncommitted changes/);
    expect(r.stderr).toMatch(/schema\/src\/a\.ts/);
    expect(r.stderr).toMatch(/worktree add --detach/);
  });

  it('ignores an edit outside the directories it reads', () => {
    writeFileSync(join(repo, 'README.md'), 'unrelated\n');
    execFileSync('git', ['-C', repo, 'checkout', '--', 'schema/src/a.ts']);
    const r = run(['--check']);
    expect(r.stderr).not.toMatch(/uncommitted changes/);
  });

  // AN UNPUSHED COMMIT IS JUST AS ABSENT AS AN UNCOMMITTED EDIT, and the first
  // version of this guard had a hole exactly the size of the next thing that
  // happened: a `hoverSwapImage` feature sat committed on a local main, so the
  // tree was clean and the check waved it through. The catalog is read against
  // DEPLOYED platforms.
  it('refuses a commit the platform has not published', () => {
    const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
    execFileSync('git', ['-C', repo, 'checkout', '--', '.']);
    // Give the fixture an upstream to be ahead of.
    const remote = mkdtempSync(join(tmpdir(), 'wbremote-'));
    execFileSync('git', ['init', '--bare', '-q', remote]);
    git('remote', 'add', 'origin', remote);
    git('push', '-q', '-u', 'origin', 'HEAD');
    expect(run(['--check']).stderr).not.toMatch(/not published/);

    writeFileSync(join(repo, 'schema/src/a.ts'), 'export const a = 9;\n');
    git('commit', '-qam', 'feat: a thing nobody has deployed');
    const r = run(['--check']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not published/);
    expect(r.stderr).toMatch(/a thing nobody has deployed/);
    rmSync(remote, { recursive: true, force: true });
  });

  // A DETACHED WORKTREE IS NOT A PROOF BY ITSELF. "It has no upstream and is
  // therefore never refused" was written as a feature — it IS the shape this
  // check recommends — and that made the recommendation into the hole: point a
  // worktree at a LOCAL commit and every other check passes. It happened:
  // `da5df0f` regenerated this catalog for a `rating-stars` element from a
  // detached worktree at the platform's local HEAD, and that commit was on no
  // remote branch.
  it('refuses a detached HEAD no remote branch contains', () => {
    const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
    execFileSync('git', ['-C', repo, 'checkout', '--', '.']);
    // The commit the REMOTE has, not whatever HEAD happens to be: an earlier
    // case in this file leaves a local-only commit behind, and taking HEAD here
    // would make the "published" half of this test assert on an unpublished one.
    const remoteRef = git('branch', '-r', '--format=%(refname:short)').trim().split('\n')[0];
    const published = git('rev-parse', remoteRef).trim();

    writeFileSync(join(repo, 'schema/src/a.ts'), 'export const a = 42;\n');
    git('commit', '-qam', 'feat: local only');
    const local = git('rev-parse', 'HEAD').trim();
    git('checkout', '-q', '--detach', local);
    const r = run(['--check']);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NO REMOTE BRANCH CONTAINS/);

    // …and a detached worktree at a PUBLISHED commit is exactly what this check
    // recommends, so it must pass.
    git('checkout', '-q', '--detach', published);
    expect(run(['--check']).stderr).not.toMatch(/NO REMOTE BRANCH CONTAINS/);
  });

  it('honours --dirty, and says so rather than going quiet', () => {
    writeFileSync(join(repo, 'schema/src/a.ts'), 'export const a = 3;\n');
    const r = run(['--check', '--dirty']);
    expect(r.stderr).toMatch(/--dirty/);
    expect(r.stderr).not.toMatch(/uncommitted changes in/);
  });
});
