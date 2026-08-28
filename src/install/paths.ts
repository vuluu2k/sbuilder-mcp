import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const PLAT = platform();

/**
 * Where each agent client keeps the MCP servers it knows about.
 *
 * Per client and per platform, because there is no convention — Claude Desktop
 * uses an Application Support folder on macOS and APPDATA on Windows, Cursor and
 * Windsurf use dotfolders in $HOME, Codex uses TOML rather than JSON. Getting one
 * wrong writes a valid file nobody reads, which looks exactly like success.
 *
 * `format` decides how the file is merged. `key` is the object that holds the
 * servers: the ecosystem settled on `mcpServers`, and VS Code chose `servers`.
 */
export type ConfigFormat = 'json' | 'toml';

export interface ClientTarget {
  id: string;
  label: string;
  format: ConfigFormat;
  /** Absolute path to the config file this client reads. */
  path: string;
  /** The object inside that file which holds the servers. */
  key: string;
  /** Shown after writing — most clients only re-read on restart. */
  note?: string;
}

/**
 * `home` is a PARAMETER, not a constant read at import time.
 *
 * It exists because a test of a config writer must not be able to reach the real
 * one, and a module-level `homedir()` makes that impossible to guarantee: a
 * `HOME=` prefix does not reliably reach `os.homedir()`, which I proved the
 * expensive way — a "sandboxed" run wrote an entry into this machine's actual
 * Cursor config. Passing the directory in removes the possibility rather than
 * relying on an env var behaving.
 */
export function targets(home: string = homedir()): ClientTarget[] {
  const HOME = home;
  const APPDATA = process.env.APPDATA || join(HOME, 'AppData', 'Roaming');
  const claudeDesktopDir =
    PLAT === 'win32'
      ? join(APPDATA, 'Claude')
      : existsSync(join(HOME, 'Library', 'Application Support', 'Claude'))
        ? join(HOME, 'Library', 'Application Support', 'Claude')
        : join(HOME, '.config', 'Claude');

  const vscodeUserDir =
    PLAT === 'win32'
      ? join(APPDATA, 'Code', 'User')
      : existsSync(join(HOME, 'Library', 'Application Support', 'Code', 'User'))
        ? join(HOME, 'Library', 'Application Support', 'Code', 'User')
        : join(HOME, '.config', 'Code', 'User');

  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      format: 'json',
      path: join(HOME, '.claude.json'),
      key: 'mcpServers',
      note: 'Open a new session to pick it up.',
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      format: 'json',
      path: join(claudeDesktopDir, 'claude_desktop_config.json'),
      key: 'mcpServers',
      note: 'Quit and reopen Claude Desktop.',
    },
    {
      id: 'cursor',
      label: 'Cursor',
      format: 'json',
      path: join(HOME, '.cursor', 'mcp.json'),
      key: 'mcpServers',
      note: 'Restart Cursor.',
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      format: 'json',
      path: join(HOME, '.codeium', 'windsurf', 'mcp_config.json'),
      key: 'mcpServers',
      note: 'Restart Windsurf.',
    },
    {
      id: 'vscode',
      label: 'VS Code',
      format: 'json',
      path: join(vscodeUserDir, 'mcp.json'),
      // VS Code is the one that did not follow `mcpServers`.
      key: 'servers',
      note: 'Reload the window.',
    },
    {
      id: 'codex',
      label: 'Codex',
      format: 'toml',
      path: join(HOME, '.codex', 'config.toml'),
      key: 'mcp_servers',
      note: 'Restart Codex.',
    },
  ];
}

/** The clients this machine appears to have — a config file or its folder exists. */
export function detected(all = targets()): ClientTarget[] {
  return all.filter((t) => existsSync(t.path) || existsSync(join(t.path, '..')));
}
