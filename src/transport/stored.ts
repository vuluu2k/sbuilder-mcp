import { readFileSync } from 'node:fs';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * The account login this machine holds — THE SAME FILE `sb login` writes.
 *
 * One browser approval signs in both the `sb` CLI and every MCP process on the
 * machine, and one sign-out ends both. The format and the protocol are the
 * CLI's (web_builder cli/src/auth.ts) and must stay so: two programs sharing a
 * file under different rules is how a session gets ended by accident.
 *
 * # ROTATION IS SHARED STATE, AND THE FILE IS WHERE IT IS SHARED
 *
 * The platform's refresh tokens are single-use: presenting one twice is reuse
 * detection, and the server answers by deleting the whole session. Several
 * agent windows (plus an `sb` in a terminal) can hold this login at once, so
 * every rotation happens under `<file>.lock` and RE-READS the file first: if
 * the stored access token is no longer the one that was refused, somebody
 * already rotated and their pair is adopted with no request at all.
 */

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

type CredentialFile = Record<string, TokenPair>;

/** ${XDG_CONFIG_HOME:-~/.config}/sb/credentials.json — the CLI's path, exactly. */
export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'sb', 'credentials.json');
}

/** The key a pair is stored under: one per API origin, so dev and prod coexist. */
export function originOf(api: string): string {
  return new URL(api).origin;
}

export const RELOGIN =
  'sbuilder: the account login on this machine has expired or was signed out. Call sb_login ' +
  '(or run `sb login`) and approve it in the browser again.';

async function readAll(path: string): Promise<CredentialFile> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as CredentialFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`sbuilder: ${path} is not readable as JSON — delete it and sign in again.`);
  }
}

/** Startup read, synchronous so a context can be built before the transport opens. */
export function readPairSync(api: string, path = credentialsPath()): TokenPair | undefined {
  try {
    const pair = (JSON.parse(readFileSync(path, 'utf8')) as CredentialFile)[originOf(api)];
    return pair?.accessToken && pair?.refreshToken ? pair : undefined;
  } catch {
    // Absent or unreadable: no stored login. An unreadable file is reported
    // when something tries to WRITE it, not at boot.
    return undefined;
  }
}

/** Temp file + rename, owner-only: `mode` applies only to a file being created. */
async function writeAll(path: string, data: CredentialFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(tmp, path);
}

/** Lock timings; exported so a test can shorten them. Same values as the CLI. */
export const LOCK = { retryMs: 50, staleMs: 30_000, giveUpMs: 60_000 };

/** Runs `fn` holding `<path>.lock` (O_EXCL). A lock older than staleMs is a crashed holder. */
export async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const started = Date.now();
  for (;;) {
    try {
      const fh = await open(lock, 'wx', 0o600);
      await fh.close();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const age = await stat(lock).then(
        (s) => Date.now() - s.mtimeMs,
        () => 0,
      );
      if (age > LOCK.staleMs) {
        await unlink(lock).catch(() => {});
        continue;
      }
      if (Date.now() - started > LOCK.giveUpMs) {
        throw new Error(`sbuilder: another process is holding ${lock}. If none is running, delete it.`);
      }
      await new Promise((r) => setTimeout(r, LOCK.retryMs));
    }
  }
  try {
    return await fn();
  } finally {
    await unlink(lock).catch(() => {});
  }
}

/** Stores (or, with undefined, removes) the pair for an API, under the lock. */
export async function savePair(
  api: string,
  pair: TokenPair | undefined,
  path = credentialsPath(),
): Promise<void> {
  await withLock(path, async () => {
    const all = await readAll(path);
    if (pair) all[originOf(api)] = pair;
    else delete all[originOf(api)];
    await writeAll(path, all);
  });
}

/** Removes and returns the pair the FILE holds now (which may not be the one in memory). */
export async function takePair(api: string, path = credentialsPath()): Promise<TokenPair | undefined> {
  return withLock(path, async () => {
    const all = await readAll(path);
    const pair = all[originOf(api)];
    if (pair) {
      delete all[originOf(api)];
      await writeAll(path, all);
    }
    return pair;
  });
}

/**
 * The server refused `rejected`: return the pair to continue with.
 *
 * Adopts a pair another process already rotated to; otherwise rotates once and
 * writes it back. A 400/401 from the refresh means the login is gone — the
 * entry is removed and RELOGIN thrown. An outage keeps the pair.
 */
export function rotate(
  api: string,
  rejected: string,
  fetchImpl: typeof fetch = fetch,
  path = credentialsPath(),
): Promise<TokenPair> {
  const origin = originOf(api);
  return withLock(path, async () => {
    const all = await readAll(path);
    const pair = all[origin];
    if (!pair) throw new Error(RELOGIN);
    if (pair.accessToken !== rejected) return pair;
    let res: Response;
    try {
      res = await fetchImpl(`${api.replace(/\/+$/, '')}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: pair.refreshToken }),
      });
    } catch {
      throw new Error(`sbuilder: could not reach ${origin} to renew the login — try again.`);
    }
    if (res.status === 400 || res.status === 401) {
      delete all[origin];
      await writeAll(path, all);
      throw new Error(RELOGIN);
    }
    if (!res.ok) throw new Error(`sbuilder: could not renew the login: HTTP ${res.status}. Try again.`);
    const { tokens } = (await res.json()) as { tokens: TokenPair };
    const next = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
    all[origin] = next;
    await writeAll(path, all);
    return next;
  });
}
