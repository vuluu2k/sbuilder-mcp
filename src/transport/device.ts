import { spawn } from 'node:child_process';
import type { TokenPair } from './stored.js';

/**
 * The platform's browser login (RFC 8628 shape) — the flow `sb login` uses.
 *
 * The person opens the editor's /device page, TYPES the code shown here, checks
 * it matches, and approves. The code is never put in the URL on purpose: a link
 * that pre-fills it is a link a phisher can send.
 */

/** What the approval page shows as the asking app — on the server's allowlist
 *  (web_builder KnownDeviceClients) from v1.0.278; older servers say "unknown app". */
export const DEVICE_CLIENT = 'sbuilder-mcp';

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type Poll =
  | { state: 'approved'; pair: TokenPair }
  | { state: 'pending' }
  | { state: 'slow' }
  | { state: 'denied' }
  | { state: 'expired' };

const trim = (base: string) => base.replace(/\/+$/, '');

async function post(
  base: string,
  path: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetchImpl(`${trim(base)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

export async function startDevice(
  base: string,
  version: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeviceStart> {
  const r = await post(base, '/api/auth/device/start', { client: DEVICE_CLIENT, clientVersion: version }, fetchImpl);
  if (r.status !== 200) {
    throw new Error(
      r.data.code === 'device_login_unavailable'
        ? 'sbuilder: this platform has no browser login configured (device_login_unavailable). ' +
            'Use an API key (SB_TOKEN) instead.'
        : `sbuilder: could not start the browser login: HTTP ${r.status} ${String(r.data.error ?? '')}`,
    );
  }
  return r.data as unknown as DeviceStart;
}

/** One poll. A 429 counts as slow_down, as the CLI treats it. */
export async function pollDevice(
  base: string,
  deviceCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Poll> {
  const r = await post(base, '/api/auth/device/token', { deviceCode }, fetchImpl);
  if (r.status === 200) {
    const t = (r.data.tokens ?? {}) as Partial<TokenPair>;
    if (!t.accessToken || !t.refreshToken) throw new Error('sbuilder: the login answered without tokens');
    return { state: 'approved', pair: { accessToken: t.accessToken, refreshToken: t.refreshToken } };
  }
  const code = r.data.code;
  if (code === 'authorization_pending') return { state: 'pending' };
  if (code === 'slow_down' || r.status === 429) return { state: 'slow' };
  if (code === 'access_denied') return { state: 'denied' };
  if (code === 'expired_token') return { state: 'expired' };
  throw new Error(`sbuilder: the browser login failed: HTTP ${r.status} ${String(r.data.error ?? '')}`);
}

/**
 * Best effort: a machine with no browser (SSH, CI) still has the address,
 * which every caller prints. SB_NO_BROWSER=1 turns it off.
 */
export function openBrowser(url: string): boolean {
  if (process.env.SB_NO_BROWSER) return false;
  // The URL comes from the server: only a web page is opened, never another
  // scheme, and never through a shell (cmd would read `&` in it as a command).
  let href: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    href = u.href;
  } catch {
    return false;
  }
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [href]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', href]]
        : ['xdg-open', [href]];
  try {
    const child = spawn(cmd, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
