import { targets, detected, type ClientTarget } from './paths.js';
import { mergeInto, type ServerEntry } from './write.js';

/** The name the server appears under in every client. */
export const SERVER_NAME = 'sbuilder';

export interface InstallOpts {
  token?: string;
  api?: string;
  email?: string;
  password?: string;
  /** The one site this install works on, written as SB_SITE. */
  site?: string;
  /** That site's display name, written as SB_SITE_NAME. */
  siteName?: string;
  /** Client ids; empty means every client detected on this machine. */
  clients?: string[];
  dryRun?: boolean;
  /** The home directory to write into. Tests pass a temp one; the CLI never sets it. */
  home?: string;
}

/**
 * Every flag the CLI understands.
 *
 * NAMED, so an unknown one can be refused. `--site` and `--site-name` were typed
 * at a real install, read by nothing, and reported as success — the caller then
 * spent the session wondering why the site was not selected. A flag that is
 * silently dropped is worse than one that does not exist.
 *
 * BUT REFUSING ONE THE PLATFORM ITSELF EMITS IS WORSE STILL, and that is what
 * `--site-name` became. The editor's Agent app builds the whole install line for
 * the merchant to paste — `AgentAppPanel.vue`, which appends
 * `--site-name "<store>"` whenever it knows the name, with a test pinning it —
 * so the ONE documented install path exited 1 and installed nothing. The flag
 * was never noise; it was added on the platform side after this list was
 * written. It is a label, not a credential: it rides in as SB_SITE_NAME so the
 * agent can say "Áo Thun" instead of reading back site_14675b5a570b248d.
 */
const FLAGS = [
  '--token',
  '--api',
  '--site',
  '--site-name',
  '--email',
  '--password',
  '--client',
  '--dry-run',
] as const;

export function buildEntry(opts: InstallOpts, pkg = 'sbuilder-mcp'): ServerEntry {
  const env: Record<string, string> = {};
  if (opts.api) env.SB_API = opts.api;
  if (opts.token) env.SB_TOKEN = opts.token;
  // The site the agent works on. A key belongs to exactly one, so writing it
  // here spares every tool call an id the install already knew — and spares the
  // model the guess it otherwise makes from a page list.
  if (opts.site) env.SB_SITE = opts.site;
  // The name the merchant calls the store, so the agent can too. Carried only
  // alongside an id — a name with nothing to resolve to is decoration, and a
  // second install would file it under a site it does not name.
  if (opts.site && opts.siteName) env.SB_SITE_NAME = opts.siteName;
  // Only when a key is absent: a key opens everything the agent does day to day,
  // and writing an account password into six config files to buy the handful of
  // account-level calls it adds is a bad trade the installer should not make for
  // someone.
  if (!opts.token && opts.email) env.SB_EMAIL = opts.email;
  if (!opts.token && opts.password) env.SB_PASSWORD = opts.password;
  return { command: 'npx', args: ['-y', pkg], env };
}

export function chooseTargets(opts: InstallOpts): ClientTarget[] {
  const all = targets(opts.home);
  if (opts.clients && opts.clients.length > 0) {
    const wanted = new Set(opts.clients.map((c) => c.trim().toLowerCase()));
    const picked = all.filter((t) => wanted.has(t.id));
    const unknown = [...wanted].filter((w) => !all.some((t) => t.id === w));
    if (unknown.length) {
      throw new Error(
        `sbuilder: unknown client(s) ${unknown.join(', ')}. Known: ${all.map((t) => t.id).join(', ')}.`,
      );
    }
    return picked;
  }
  return detected(all);
}

export interface InstallResult {
  client: string;
  path: string;
  status: 'installed' | 'unchanged' | 'skipped';
  reason?: string;
  /** Where the previous file was copied, when one was replaced. */
  backup?: string;
  note?: string;
}

/**
 * Write the server into every chosen client.
 *
 * One client failing never stops the others: a broken Cursor config is no reason
 * to leave Claude Code unconfigured, and the report says which is which. The
 * token is never echoed — the result names files, not secrets.
 */
export function install(opts: InstallOpts): InstallResult[] {
  const entry = buildEntry(opts);
  return chooseTargets(opts).map((t) => {
    if (opts.dryRun) {
      return { client: t.label, path: t.path, status: 'skipped', reason: 'dry run', note: t.note };
    }
    try {
      const out = mergeInto(t, SERVER_NAME, entry);
      return {
        client: t.label,
        path: t.path,
        status: out.wrote ? 'installed' : 'unchanged',
        ...(out.reason ? { reason: out.reason } : {}),
        ...(out.backup ? { backup: out.backup } : {}),
        ...(out.wrote && t.note ? { note: t.note } : {}),
      };
    } catch (err) {
      return { client: t.label, path: t.path, status: 'skipped', reason: String(err) };
    }
  });
}

/** `sbuilder-mcp install --token wbk_… --api https://…` */
export function runInstallCli(argv: string[]): number {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  // REFUSE what we cannot act on. Anything that looks like a flag and is not one
  // is a typo or a flag from another version, and either way the caller believes
  // it took effect.
  const taken = new Set<number>();
  for (const f of FLAGS) {
    const i = argv.indexOf(f);
    if (i >= 0) {
      taken.add(i);
      if (f !== '--dry-run') taken.add(i + 1);
    }
  }
  const unknown = argv.filter((a, i) => a.startsWith('--') && !taken.has(i));
  if (unknown.length) {
    console.error(
      `sbuilder: unknown option(s) ${unknown.join(', ')}. Known: ${FLAGS.join(', ')}.`,
    );
    return 1;
  }

  const opts: InstallOpts = {
    token: get('--token') ?? process.env.SB_TOKEN,
    api: get('--api') ?? process.env.SB_API,
    site: get('--site') ?? process.env.SB_SITE,
    siteName: get('--site-name') ?? process.env.SB_SITE_NAME,
    email: get('--email') ?? process.env.SB_EMAIL,
    password: get('--password') ?? process.env.SB_PASSWORD,
    clients: get('--client')?.split(','),
    dryRun: argv.includes('--dry-run'),
  };

  if (!opts.token && !(opts.email && opts.password)) {
    console.error(
      'sbuilder: nothing to install with.\n' +
        '  Get a key from your store: Apps → AI agent → Create key, then\n' +
        '    npx -y sbuilder-mcp install --token wbk_… --api https://your-host\n',
    );
    return 1;
  }

  let results: InstallResult[];
  try {
    results = install(opts);
  } catch (err) {
    console.error(`sbuilder: ${(err as Error).message}`);
    return 1;
  }

  if (results.length === 0) {
    console.error(
      'sbuilder: no agent client found on this machine.\n' +
        `  Name one explicitly: --client ${targets().map((t) => t.id).join(',')}`,
    );
    return 1;
  }

  for (const r of results) {
    // A DRY RUN THAT WROTE NOTHING DID ITS JOB. Every line used to be marked
    // `✖` and the command exited 1, so the one way to inspect an install before
    // making it reported total failure — and a CI step wrapping it would stop
    // there. The preview gets its own mark and its own exit code.
    const mark = opts.dryRun
      ? '→'
      : r.status === 'installed'
        ? '✔'
        : r.status === 'unchanged'
          ? '·'
          : '✖';
    console.error(`${mark} ${r.client} — ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
    console.error(`    ${r.path}`);
    // The undo, named. A config writer that changes a file without saying where
    // the old one went leaves the user with nothing to reach for.
    if (r.backup) console.error(`    previous file saved as ${r.backup}`);
    if (r.note) console.error(`    ${r.note}`);
  }
  if (opts.dryRun) return 0;
  return results.some((r) => r.status === 'installed' || r.status === 'unchanged') ? 0 : 1;
}
