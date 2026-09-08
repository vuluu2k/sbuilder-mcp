import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeJson, mergeToml } from '../src/install/write.js';
import { buildEntry, chooseTargets, install, runInstallCli } from '../src/install/index.js';
import type { ClientTarget } from '../src/install/paths.js';

/**
 * The installer writes into the USER'S OWN config files, which hold other
 * people's servers. Every test here is about not destroying something.
 */

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sb-install-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function jsonTarget(name = 'cfg.json', key = 'mcpServers'): ClientTarget {
  return { id: 't', label: 'Test', format: 'json', path: join(dir, name), key };
}

const entry = { command: 'npx', args: ['-y', 'sbuilder-mcp'], env: { SB_TOKEN: 'wbk_x' } };

describe('mergeJson()', () => {
  it('adds the server to a file that does not exist yet', () => {
    const t = jsonTarget();
    expect(mergeJson(t, 'sbuilder', entry).wrote).toBe(true);
    const doc = JSON.parse(readFileSync(t.path, 'utf8'));
    expect(doc.mcpServers.sbuilder).toEqual(entry);
  });

  it('KEEPS every other server that was already there', () => {
    const t = jsonTarget();
    writeFileSync(
      t.path,
      JSON.stringify({
        mcpServers: { somebody_else: { command: 'node', args: ['x.js'] } },
        unrelatedSetting: 42,
      }),
    );
    mergeJson(t, 'sbuilder', entry);
    const doc = JSON.parse(readFileSync(t.path, 'utf8'));
    expect(doc.mcpServers.somebody_else).toEqual({ command: 'node', args: ['x.js'] });
    expect(doc.mcpServers.sbuilder).toEqual(entry);
    // A key outside the servers object must survive untouched.
    expect(doc.unrelatedSetting).toBe(42);
  });

  it('is idempotent — a second identical run writes nothing', () => {
    const t = jsonTarget();
    mergeJson(t, 'sbuilder', entry);
    const second = mergeJson(t, 'sbuilder', entry);
    expect(second.wrote).toBe(false);
    expect(second.reason).toMatch(/already/i);
    expect(existsSync(`${t.path}.sbuilder-backup`)).toBe(false);
  });

  it('backs the file up before changing one that existed', () => {
    const t = jsonTarget();
    writeFileSync(t.path, JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } }));
    const out = mergeJson(t, 'sbuilder', entry);
    expect(out.backup).toBe(`${t.path}.sbuilder-backup`);
    expect(JSON.parse(readFileSync(out.backup!, 'utf8')).mcpServers.other).toBeDefined();
  });

  it('REFUSES a malformed file rather than replacing it', () => {
    const t = jsonTarget();
    writeFileSync(t.path, '{ "mcpServers": { trailing, }');
    const out = mergeJson(t, 'sbuilder', entry);
    expect(out.wrote).toBe(false);
    expect(out.reason).toMatch(/not valid JSON/i);
    // Still exactly what the user had — a config with a typo is far likelier
    // than one worth discarding, and it is what they need to fix it.
    expect(readFileSync(t.path, 'utf8')).toContain('trailing');
  });

  it("honours VS Code's different servers key", () => {
    const t = jsonTarget('vscode.json', 'servers');
    mergeJson(t, 'sbuilder', entry);
    const doc = JSON.parse(readFileSync(t.path, 'utf8'));
    expect(doc.servers.sbuilder).toEqual(entry);
    expect(doc.mcpServers).toBeUndefined();
  });
});

describe('mergeToml()', () => {
  function tomlTarget(): ClientTarget {
    return { id: 'codex', label: 'Codex', format: 'toml', path: join(dir, 'config.toml'), key: 'mcp_servers' };
  }

  it('appends the table to a file with other settings', () => {
    const t = tomlTarget();
    writeFileSync(t.path, 'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "node"\n');
    expect(mergeToml(t, 'sbuilder', entry).wrote).toBe(true);
    const out = readFileSync(t.path, 'utf8');
    expect(out).toContain('model = "gpt-5"');
    expect(out).toContain('[mcp_servers.other]');
    expect(out).toContain('[mcp_servers.sbuilder]');
    expect(out).toContain('args = ["-y", "sbuilder-mcp"]');
  });

  it('REPLACES its own table instead of appending a second one', () => {
    const t = tomlTarget();
    mergeToml(t, 'sbuilder', entry);
    mergeToml(t, 'sbuilder', { ...entry, env: { SB_TOKEN: 'wbk_new' } });
    const out = readFileSync(t.path, 'utf8');
    expect(out.split('[mcp_servers.sbuilder]').length - 1).toBe(1);
    expect(out).toContain('wbk_new');
    expect(out).not.toContain('wbk_x');
  });

  it('keeps a table that follows ours', () => {
    const t = tomlTarget();
    writeFileSync(t.path, '[mcp_servers.sbuilder]\ncommand = "old"\n\n[mcp_servers.after]\ncommand = "keep"\n');
    mergeToml(t, 'sbuilder', entry);
    const out = readFileSync(t.path, 'utf8');
    expect(out).toContain('[mcp_servers.after]');
    expect(out).toContain('command = "keep"');
    expect(out).not.toContain('"old"');
  });

  it('is idempotent', () => {
    const t = tomlTarget();
    mergeToml(t, 'sbuilder', entry);
    expect(mergeToml(t, 'sbuilder', entry).wrote).toBe(false);
  });
});

describe('buildEntry()', () => {
  it('writes the key alone when there is one', () => {
    const e = buildEntry({ token: 'wbk_x', api: 'http://x', email: 'e@x', password: 'p' });
    expect(e.env).toEqual({ SB_API: 'http://x', SB_TOKEN: 'wbk_x' });
    // A key opens everything the agent does day to day. Writing an account
    // password into six config files to buy a few account-level calls is a bad
    // trade to make on someone's behalf.
    expect(e.env.SB_PASSWORD).toBeUndefined();
  });

  it('falls back to an account only when no key is given', () => {
    const e = buildEntry({ api: 'http://x', email: 'e@x', password: 'p' });
    expect(e.env.SB_EMAIL).toBe('e@x');
    expect(e.env.SB_PASSWORD).toBe('p');
  });

  it('launches through npx so the config is path-independent', () => {
    const e = buildEntry({ token: 'wbk_x' });
    expect(e.command).toBe('npx');
    expect(e.args).toEqual(['-y', 'sbuilder-mcp']);
  });

  it('carries the store name beside its id', () => {
    const e = buildEntry({ token: 'wbk_x', site: 'site_1', siteName: 'Áo Thun' });
    expect(e.env.SB_SITE).toBe('site_1');
    expect(e.env.SB_SITE_NAME).toBe('Áo Thun');
  });

  it('drops a name with no id to attach it to', () => {
    // A label that resolves to nothing is decoration, and a second install
    // would file it under a site it does not name.
    expect(buildEntry({ token: 'wbk_x', siteName: 'Áo Thun' }).env.SB_SITE_NAME).toBeUndefined();
  });
});

describe('runInstallCli() takes what the platform emits', () => {
  // The editor's Agent app builds the whole install line and appends
  // `--site-name "<store>"` whenever it knows the name
  // (editor/src/views/manage/apps/components/AgentAppPanel.vue). Refusing it
  // made the ONE documented install path exit 1 and install nothing.
  let said: string[] = [];
  let restore: (() => void) | undefined;
  beforeEach(() => {
    said = [];
    const real = console.error;
    console.error = (...a: unknown[]) => void said.push(a.join(' '));
    restore = () => void (console.error = real);
  });
  afterEach(() => restore?.());

  it('accepts --site-name rather than refusing the platform its own flag', () => {
    const code = runInstallCli([
      '--token', 'wbk_x',
      '--api', 'http://localhost:8080',
      '--site', 'site_1',
      '--site-name', 'Bản sao của Test',
      '--dry-run',
    ]);
    expect(said.join('\n')).not.toMatch(/unknown option/i);
    expect(code).toBe(0);
  });

  it('still refuses a flag nobody reads', () => {
    expect(runInstallCli(['--token', 'wbk_x', '--nonesuch', 'v'])).toBe(1);
    expect(said.join('\n')).toMatch(/unknown option\(s\) --nonesuch/);
  });

  // A preview that wrote nothing succeeded. Marking every line ✖ and exiting 1
  // made the only way to inspect an install read as total failure.
  it('reports a dry run as the preview it is, not as a failure', () => {
    expect(runInstallCli(['--token', 'wbk_x', '--api', 'http://x', '--dry-run'])).toBe(0);
    expect(said.join('\n')).not.toContain('✖');
  });

  it('never echoes the key it was handed', () => {
    runInstallCli(['--token', 'wbk_supersecret', '--api', 'http://x', '--dry-run']);
    expect(said.join('\n')).not.toContain('wbk_supersecret');
  });
});

describe('chooseTargets()', () => {
  it('names the unknown client rather than silently installing nothing', () => {
    expect(() => chooseTargets({ clients: ['nonesuch'] })).toThrow(/nonesuch/);
  });

  it('picks exactly the clients asked for', () => {
    const picked = chooseTargets({ clients: ['cursor', 'codex'] });
    expect(picked.map((t) => t.id).sort()).toEqual(['codex', 'cursor']);
  });
});

describe('install() writes only where it is told', () => {
  it('installs into an injected home, and touches nothing outside it', () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-home-'));
    try {
      writeFileSync(
        join(home, '.cursor.seed'),
        '', // placeholder so the dir exists check is exercised below
      );
      const results = install({ token: 'wbk_x', api: 'http://x', clients: ['cursor'], home });
      expect(results.length).toBe(1);
      expect(results[0].status).toBe('installed');
      // The path must be inside the injected home — never the real one.
      expect(results[0].path.startsWith(home)).toBe(true);
      const doc = JSON.parse(readFileSync(results[0].path, 'utf8'));
      expect(doc.mcpServers.sbuilder.env).toEqual({ SB_API: 'http://x', SB_TOKEN: 'wbk_x' });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('a dry run reports the files and writes none of them', () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-home-'));
    try {
      const results = install({ token: 'wbk_x', clients: ['cursor', 'codex'], home, dryRun: true });
      expect(results.map((r) => r.status)).toEqual(['skipped', 'skipped']);
      for (const r of results) expect(existsSync(r.path)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('one broken client does not stop the others', () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-home-'));
    try {
      const cursorPath = join(home, '.cursor', 'mcp.json');
      require('node:fs').mkdirSync(join(home, '.cursor'), { recursive: true });
      writeFileSync(cursorPath, '{ not json');
      const results = install({ token: 'wbk_x', clients: ['cursor', 'codex'], home });
      const byId = Object.fromEntries(results.map((r) => [r.client, r]));
      expect(byId.Cursor.status).toBe('unchanged');
      expect(byId.Cursor.reason).toMatch(/not valid JSON/i);
      expect(byId.Codex.status).toBe('installed');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
