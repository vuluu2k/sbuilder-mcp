import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadMedia } from '../src/transport/media.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';

function ctxWith(f: typeof fetch, apiKey = 'wbk_k') {
  return { base: 'http://x', session: new Session('http://x', f), apiKey, fetchImpl: f };
}

function ok(body: unknown = { asset: { id: 'as_1', url: 'http://cdn/x.png' } }) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

function calls(f: typeof fetch) {
  return (f as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}

describe('uploadMedia()', () => {
  it('sends MULTIPART, which is the whole reason this bypasses request()', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-media-'));
    const file = join(dir, 'hero.png');
    writeFileSync(file, Buffer.from([137, 80, 78, 71]));
    try {
      const f = ok();
      await uploadMedia(ctxWith(f), 's1', { path: file });

      const [url, init] = calls(f)[0] as [string, RequestInit];
      expect(url).toBe('http://x/api/media/s1');
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
      const form = init.body as FormData;
      const sent = form.get('file') as File;
      expect(sent).toBeTruthy();
      expect(sent.name).toBe('hero.png');
      // Content-Type must be ABSENT: fetch sets it with the boundary that matches
      // the body it just built, and setting it by hand makes a valid upload
      // unparseable at the other end.
      const headers = init.headers as Record<string, string>;
      expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('content-type');
      expect(headers.Authorization).toBe('Bearer wbk_k');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('unwraps the asset so the URL is ready for sb_set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-media-'));
    const file = join(dir, 'a.png');
    writeFileSync(file, Buffer.from([1]));
    try {
      const asset = await uploadMedia(ctxWith(ok()), 's1', { path: file });
      expect(asset.url).toBe('http://cdn/x.png');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fetches a url and uploads it under a sensible filename', async () => {
    const f = vi.fn(async (u: unknown) => {
      if (String(u).startsWith('http://src/')) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }
      return new Response(JSON.stringify({ asset: { url: 'http://cdn/y.png' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await uploadMedia(ctxWith(f), 's1', { url: 'http://src/photos/banner.jpg' });
    const form = (calls(f)[1][1] as RequestInit).body as FormData;
    expect((form.get('file') as File).name).toBe('banner.jpg');
  });

  it('names a URL that carries no filename rather than uploading an empty name', async () => {
    const f = vi.fn(async (u: unknown) => {
      if (String(u).startsWith('http://cdn2/')) return new Response(new Uint8Array([1]), { status: 200 });
      return new Response(JSON.stringify({ asset: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await uploadMedia(ctxWith(f), 's1', { url: 'http://cdn2/?id=9' });
    const form = (calls(f)[1][1] as RequestInit).body as FormData;
    expect((form.get('file') as File).name).toBe('image');
  });

  it('says the SOURCE was unreachable rather than blaming the upload', async () => {
    const f = vi.fn(async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await expect(uploadMedia(ctxWith(f), 's1', { url: 'http://src/missing.png' })).rejects.toMatchObject({
      code: 'source_unreachable',
    });
  });

  it('surfaces the platform error code on a rejected upload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-media-'));
    const file = join(dir, 'big.png');
    writeFileSync(file, Buffer.from([1]));
    try {
      const f = vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'too large', code: 'file_too_large' }), {
            status: 413,
            headers: { 'content-type': 'application/json' },
          }),
      ) as unknown as typeof fetch;
      await expect(uploadMedia(ctxWith(f), 's1', { path: file })).rejects.toMatchObject({
        status: 413,
        code: 'file_too_large',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses when given neither a path nor a url', async () => {
    await expect(uploadMedia(ctxWith(ok()), 's1', {})).rejects.toThrow(/path or a url/i);
  });
});

describe('uploadMedia() on a key-only install', () => {
  it('names the session requirement instead of repeating a bare unauthorized', async () => {
    const f = (async () =>
      new Response(JSON.stringify({ error: 'unauthorized', code: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const ctx = {
      base: 'http://x',
      session: new Session('http://x', f),
      apiKey: 'wbk_k',
      fetchImpl: f,
      notices: new Notices(),
    };
    const dir = mkdtempSync(join(tmpdir(), 'sb-media-'));
    const file = join(dir, 'a.jpg');
    writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff]));
    try {
      await expect(uploadMedia(ctx, 's1', { path: file })).rejects.toThrow(
        /session token only|SB_EMAIL/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
