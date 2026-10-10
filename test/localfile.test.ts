import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadMedia } from '../src/transport/media.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

/**
 * sb_media_upload's `path` is attacker-chosen under prompt injection: a key
 * uploaded with name:"x.png" got the image type from the NAME and a public URL.
 */
describe('sb_media_upload path guard', () => {
  const f = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
  const ctx = { base: 'http://x', session: new Session('http://x', f), apiKey: 'wbk_k', siteId: 's1', fetchImpl: f, notices: new Notices(), undo: new UndoLog() };

  it('refuses a non-media file even when name says .png', async () => {
    const d = mkdtempSync(join(tmpdir(), 'sbmedia-'));
    const key = join(d, 'id_rsa');
    writeFileSync(key, 'SECRET');
    await expect(uploadMedia(ctx, 's1', { path: key, name: 'x.png' })).rejects.toThrow(/must be one of/);
  });

  it('refuses a .png symlink pointing at a non-media file', async () => {
    const d = mkdtempSync(join(tmpdir(), 'sbmedia-'));
    const key = join(d, 'creds');
    writeFileSync(key, 'SECRET');
    const { symlinkSync } = await import('node:fs');
    symlinkSync(key, join(d, 'a.png'));
    await expect(uploadMedia(ctx, 's1', { path: join(d, 'a.png') })).rejects.toThrow(/must be one of/);
  });
});

describe('sb_media_upload url fallback and pdf', () => {
  // The server's own fetch door is absent, so the fallback fetches on THIS machine.
  const fake = () =>
    (async (input: string | URL) =>
      String(input).endsWith('/from-url')
        ? new Response('{"error":"not found"}', { status: 404, headers: { 'content-type': 'application/json' } })
        : new Response('SECRET', { status: 200 })) as unknown as typeof fetch;
  const DNS: Record<string, string[]> = { localhost: ['127.0.0.1'], 'inward.example': ['10.1.2.3'], 'public.example': ['93.184.216.34'] };
  const ctxOf = (f: typeof fetch) => ({
    base: 'http://x', session: new Session('http://x', f), apiKey: 'wbk_k', siteId: 's1', fetchImpl: f,
    notices: new Notices(), undo: new UndoLog(), lookupHost: async (h: string) => DNS[h] ?? [],
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/iam/x',
    'http://localhost:3000/a.png',
    'http://127.0.0.1/a.png',
    'http://192.168.1.10/a.png',
    'http://10.0.0.5/a.png',
    'http://[::1]/a.png',
    'http://[::ffff:127.0.0.1]/a.png',
    'http://[::127.0.0.1]/a.png',
    'http://[2002:7f00:1::]/a.png',
    'http://2130706433/a.png',
    'http://inward.example/a.png',
    'file:///etc/hosts',
  ])('refuses a private or non-http url on the local fallback: %s', async (url) => {
    await expect(uploadMedia(ctxOf(fake()), 's1', { url, name: 'a.png' })).rejects.toThrow(/public http/);
  });

  it('a pdf comes only from the working or temp directory', async () => {
    const { homedir } = await import('node:os');
    await expect(uploadMedia(ctxOf(fake()), 's1', { path: join(homedir(), 'Documents', 'no-such.pdf') })).rejects.toThrow(
      /does not exist|working directory/,
    );
  });

  it('a redirect to a private address is refused at that hop', async () => {
    const f = (async (input: string | URL) => {
      const u = String(input);
      if (u.endsWith('/from-url')) return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
      if (u.startsWith('http://public.example')) return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/x' } });
      return new Response('SECRET', { status: 200 });
    }) as unknown as typeof fetch;
    await expect(uploadMedia(ctxOf(f), 's1', { url: 'http://public.example/a.png' })).rejects.toThrow(/public http/);
  });
});

describe('the media url check is pinned to the connection (DNS rebinding)', () => {
  it('pinnedLookup refuses a private answer and passes a public one', async () => {
    const { pinnedLookup } = await import('../src/transport/media.js');
    const run = (addrs: Array<{ address: string; family: number }>) =>
      new Promise<unknown>((res) => pinnedLookup(async () => addrs)('h', { all: true }, (e: unknown, a: unknown) => res(e ?? a)));
    expect(await run([{ address: '10.0.0.1', family: 4 }])).toBeInstanceOf(Error);
    expect(await run([{ address: '93.184.216.34', family: 4 }, { address: '::1', family: 6 }])).toBeInstanceOf(Error);
    expect(await run([{ address: '93.184.216.34', family: 4 }])).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('a name that passed the check but connects inward is refused at the socket', async () => {
    const { createServer } = await import('node:http');
    let hit = false;
    const server = createServer((_q, r) => {
      hit = true;
      r.end('SECRET');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const { fetchPublic } = await import('../src/transport/media.js');
    // The pre-check is told "public" (what a rebinding DNS answers first); the
    // connection then resolves localhost for real.
    const ctx = { lookupHost: async () => ['93.184.216.34'] } as never;
    try {
      await expect(fetchPublic(ctx, fetch, `http://localhost:${port}/a.png`)).rejects.toThrow(/public http/);
      expect(hit).toBe(false);
    } finally {
      server.close();
    }
  });
});

describe('the pinned fetch never throws out of a socket callback', () => {
  // A socket-callback throw is an uncaught exception that kills the MCP process.
  async function serve(reply: string) {
    const net = await import('node:net');
    const server = net.createServer((sock) => sock.once('data', () => sock.end(reply)));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return { server, port: (server.address() as { port: number }).port };
  }
  const toLocal = (_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
    opts.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4);

  it('a status Response cannot hold is a rejection', async () => {
    const { pinnedFetch } = await import('../src/transport/media.js');
    const { server, port } = await serve('HTTP/1.1 999 Odd\r\nContent-Length: 2\r\n\r\nok');
    await expect(pinnedFetch(`http://h:${port}/`, toLocal)).rejects.toThrow(/status 999/);
    server.close();
  });

  it('a header fetch would refuse is dropped, the body still arrives', async () => {
    const { pinnedFetch } = await import('../src/transport/media.js');
    const { server, port } = await serve('HTTP/1.1 200 OK\r\nX-Bad: caf\u00e9\u2603\r\nContent-Length: 2\r\n\r\nok');
    const r = await pinnedFetch(`http://h:${port}/`, toLocal);
    expect(await r.text()).toBe('ok');
    server.close();
  });

  it('a server that trickles bytes is cut off by the total deadline', async () => {
    const { pinnedFetch } = await import('../src/transport/media.js');
    const net = await import('node:net');
    const timers: NodeJS.Timeout[] = [];
    const server = net.createServer((sock) =>
      sock.once('data', () => {
        sock.write('HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n');
        timers.push(setInterval(() => sock.write('x'), 50));
      }),
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    await expect(pinnedFetch(`http://h:${port}/`, toLocal, 400)).rejects.toThrow(/too long/);
    timers.forEach(clearInterval);
    server.close();
  });

  it('a 101 Switching Protocols settles as a rejection instead of hanging', async () => {
    const { pinnedFetch } = await import('../src/transport/media.js');
    const { server, port } = await serve('HTTP/1.1 101 Switching Protocols\r\nUpgrade: x\r\nConnection: Upgrade\r\n\r\n');
    await expect(pinnedFetch(`http://h:${port}/`, toLocal, 2000)).rejects.toThrow(/switch protocols|without an answer/);
    server.close();
  });

  it('a content-length over the cap is refused before the body is read', async () => {
    const { pinnedFetch } = await import('../src/transport/media.js');
    const { server, port } = await serve('HTTP/1.1 200 OK\r\nContent-Length: 999999999999\r\n\r\n');
    await expect(pinnedFetch(`http://h:${port}/`, toLocal, 2000)).rejects.toThrow(/larger than/);
    server.close();
  });

  it('pinnedLookup survives a resolver that answers garbage', async () => {
    const { pinnedLookup } = await import('../src/transport/media.js');
    const err = await new Promise((res) => pinnedLookup(async () => [{ address: 'not-an-ip', family: 4 }])('h', {}, (e: unknown) => res(e)));
    expect(err).toBeInstanceOf(Error);
  });
});
