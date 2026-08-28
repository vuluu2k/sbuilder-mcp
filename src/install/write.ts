import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ClientTarget } from './paths.js';

export interface ServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Add or replace ONE server inside a client's config, leaving everything else
 * exactly as it was.
 *
 * MERGE, never write: these are the user's own files and they hold other
 * people's servers. A whole-file write is the difference between installing a
 * server and deleting somebody's setup — and they would only find out the next
 * time they reached for a tool that had quietly gone.
 *
 * A malformed existing file is REFUSED rather than replaced. It is far more
 * likely to be a config with a trailing comma than one worth discarding, and
 * overwriting it destroys the very thing the user would need to fix it.
 */
export function mergeJson(
  target: ClientTarget,
  name: string,
  entry: ServerEntry,
): { wrote: boolean; backup?: string; reason?: string } {
  let doc: Record<string, unknown> = {};
  if (existsSync(target.path)) {
    const raw = readFileSync(target.path, 'utf8').trim();
    if (raw) {
      try {
        doc = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return {
          wrote: false,
          reason: `${target.path} is not valid JSON. Refusing to overwrite it — fix or move it, then run this again.`,
        };
      }
    }
  }

  const servers = (doc[target.key] ?? {}) as Record<string, unknown>;
  const before = JSON.stringify(servers[name] ?? null);
  servers[name] = entry;
  doc[target.key] = servers;

  // Idempotent: an identical entry is not a write, so re-running the installer
  // does not churn a file or leave a pointless backup behind.
  if (before === JSON.stringify(entry)) return { wrote: false, reason: 'already configured' };

  let backup: string | undefined;
  if (existsSync(target.path)) {
    backup = `${target.path}.sbuilder-backup`;
    copyFileSync(target.path, backup);
  }
  mkdirSync(dirname(target.path), { recursive: true });
  writeFileSync(target.path, JSON.stringify(doc, null, 2) + '\n');
  return { wrote: true, backup };
}

/**
 * The same job for Codex, which uses TOML.
 *
 * Hand-written rather than pulling in a TOML library: the block this writes is
 * three known keys, and the file is edited by REPLACING the `[mcp_servers.<name>]`
 * table if it is there and appending it if it is not. A parser would let us
 * rewrite the whole document, which is exactly what the merge rule above forbids
 * — a reformatted file is a diff the user did not ask for, across settings this
 * tool has no business touching.
 */
export function mergeToml(
  target: ClientTarget,
  name: string,
  entry: ServerEntry,
): { wrote: boolean; backup?: string; reason?: string } {
  const header = `[${target.key}.${name}]`;
  const env = Object.entries(entry.env)
    .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
    .join(', ');
  const block =
    `${header}\n` +
    `command = ${JSON.stringify(entry.command)}\n` +
    `args = [${entry.args.map((a) => JSON.stringify(a)).join(', ')}]\n` +
    (env ? `env = { ${env} }\n` : '');

  let existing = '';
  if (existsSync(target.path)) existing = readFileSync(target.path, 'utf8');

  // Replace from our header up to the next table header, or to the end.
  const start = existing.indexOf(header);
  let next: string;
  if (start === -1) {
    next = existing.trimEnd() ? `${existing.trimEnd()}\n\n${block}` : block;
  } else {
    const after = existing.indexOf('\n[', start + 1);
    const tail = after === -1 ? '' : existing.slice(after + 1);
    next = existing.slice(0, start) + block + (tail ? `\n${tail}` : '');
  }
  if (next === existing) return { wrote: false, reason: 'already configured' };

  let backup: string | undefined;
  if (existsSync(target.path)) {
    backup = `${target.path}.sbuilder-backup`;
    copyFileSync(target.path, backup);
  }
  mkdirSync(dirname(target.path), { recursive: true });
  writeFileSync(target.path, next);
  return { wrote: true, backup };
}

export function mergeInto(
  target: ClientTarget,
  name: string,
  entry: ServerEntry,
): { wrote: boolean; backup?: string; reason?: string } {
  return target.format === 'toml'
    ? mergeToml(target, name, entry)
    : mergeJson(target, name, entry);
}
