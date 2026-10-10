import { realpath } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';

/**
 * EVERY DOOR FROM A TOOL ARGUMENT TO THE LOCAL DISK GOES THROUGH HERE.
 *
 * The agent driving these tools can be prompt-injected by content it reads — a
 * page, a product, an order note — so a `path` argument is attacker-chosen. Read,
 * it exfiltrates (`~/.ssh/id_rsa` uploaded under `name:"x.png"` gets a public CDN
 * URL); written, it plants code (`.claude/settings.local.json`, `.mcp.json`,
 * `.vscode/tasks.json` all run something, and `wx` stops only an overwrite).
 *
 * So: the extension is checked on the REAL file (symlinks resolved, never the
 * caller's `name`), and the returned path is the resolved one, so what was
 * checked is what is opened. `confine` additionally keeps the file under the
 * working directory or the OS temp directory — not the working directory when it
 * IS the home directory — with no dot-file or dot-folder below that root.
 *
 * ponytail: a local attacker racing a symlink swap between this check and the
 * open is outside the threat model; O_NOFOLLOW on the open is the upgrade.
 */
export async function guardLocal(
  path: string,
  exts: ReadonlySet<string>,
  opts: { write?: boolean; confine?: boolean } = {},
): Promise<string> {
  const abs = resolve(path);
  const shown = [...exts].join(', ');
  let real: string;
  try {
    // A write names a file that does not exist yet: resolve its folder instead.
    real = opts.write ? join(await realpath(dirname(abs)), basename(abs)) : await realpath(abs);
  } catch {
    throw new Error(`sbuilder: ${opts.write ? `the folder for ${abs}` : abs} does not exist.`);
  }
  if (!exts.has(extname(real).toLowerCase())) {
    throw new Error(`sbuilder: the file must be one of ${shown} — ${basename(real)} is not.`);
  }
  if (opts.confine) {
    const home = await realpath(homedir()).catch(() => homedir());
    const cwd = await realpath(process.cwd()).catch(() => process.cwd());
    // Not cwd when it IS home, or holds it (`/Users`): that root would reach all of home.
    const holdsHome = cwd === home || home.startsWith(cwd.endsWith(sep) ? cwd : cwd + sep);
    const roots = [...(holdsHome ? [] : [cwd]), await realpath(tmpdir()).catch(() => tmpdir())];
    const root = roots.find((r) => real.startsWith(r + sep));
    if (!root) {
      throw new Error(`sbuilder: this file must be under the working directory or ${tmpdir()} — not ${real}.`);
    }
    if (relative(root, real).split(sep).some((s) => s.startsWith('.'))) {
      throw new Error('sbuilder: never a dot-file or a file in a dot-folder.');
    }
  }
  return real;
}
