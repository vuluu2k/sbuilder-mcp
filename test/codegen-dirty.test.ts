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

  it('honours --dirty, and says so rather than going quiet', () => {
    writeFileSync(join(repo, 'schema/src/a.ts'), 'export const a = 3;\n');
    const r = run(['--check', '--dirty']);
    expect(r.stderr).toMatch(/--dirty/);
    expect(r.stderr).not.toMatch(/uncommitted changes in/);
  });
});
