import { hostname } from 'node:os';

/**
 * What this MCP says about itself on every call to the platform.
 *
 * It exists to answer a question the web UI's install button structurally
 * cannot. A merchant clicks "Add to Cursor", the browser hands a config blob to
 * the desktop app, and the app reports success the moment it WRITES THE FILE —
 * it has started no server, contacted no platform, and has no way to know
 * whether the key inside works. Its "installed successfully" is a statement
 * about a file on disk.
 *
 * The only evidence that an install actually works is a request arriving at the
 * platform. This is that request saying where it came from, so a store whose key
 * is installed on a laptop, a desktop and a colleague's machine can be told
 * apart instead of collapsing into one "last used" timestamp.
 *
 * None of it authorizes anything — the key alone does that. These are LABELS an
 * operator reads on their own screen, about their own machines.
 */
export interface AgentIdentity {
  /** What the agent client calls itself, from the MCP handshake. */
  client: string;
  clientVersion: string;
  /** This machine's own name, so "which laptop" is answerable. */
  host: string;
  /** This package's version, so a stale install is visible as itself. */
  server: string;
}

let current: AgentIdentity = { client: '', clientVersion: '', host: '', server: '' };

/**
 * Record who launched this server.
 *
 * Called once, after the MCP handshake, with the `clientInfo` the client sent.
 * Before that — and if a client sends nothing, which is legal — the identity
 * stays empty and the platform records an anonymous connection rather than
 * inventing a name. An invented name would be worse than no name: it would look
 * like a machine somebody could go and check.
 */
export function setAgentClient(
  info: { name?: string; version?: string } | undefined,
  serverVersion: string,
): void {
  current = {
    client: info?.name ?? '',
    clientVersion: info?.version ?? '',
    host: machineName(),
    server: serverVersion ? `sbuilder-mcp/${serverVersion}` : '',
  };
}

/** The current identity, for tests and for the smoke check. */
export function agentIdentity(): AgentIdentity {
  return current;
}

/**
 * The machine's name.
 *
 * `os.hostname()` throws on some locked-down sandboxes rather than returning
 * something useless, and a telemetry label is never worth failing a request
 * over.
 */
function machineName(): string {
  try {
    return hostname();
  } catch {
    return '';
  }
}

/**
 * The headers that carry it.
 *
 * Empty fields are OMITTED rather than sent blank, so the platform's
 * "identified itself / did not" distinction survives the wire. A header set to
 * the empty string and a header that is absent must not mean different things
 * here and there.
 */
export function identityHeaders(id: AgentIdentity = current): Record<string, string> {
  const out: Record<string, string> = {};
  if (id.client) out['X-Agent-Client'] = id.client;
  if (id.clientVersion) out['X-Agent-Client-Version'] = id.clientVersion;
  if (id.host) out['X-Agent-Host'] = id.host;
  if (id.server) out['X-Agent-Server'] = id.server;
  return out;
}
