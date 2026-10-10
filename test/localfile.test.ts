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
  const ctxOf = (f: typeof fetch) => ({ base: 'http://x', session: new Session('http://x', f), apiKey: 'wbk_k', siteId: 's1', fetchImpl: f, notices: new Notices(), undo: new UndoLog() });

  it.each([
    'http://169.254.169.254/latest/meta-data/iam/x',
    'http://localhost:3000/a.png',
    'http://127.0.0.1/a.png',
    'http://192.168.1.10/a.png',
    'http://10.0.0.5/a.png',
    'http://[::1]/a.png',
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
});
