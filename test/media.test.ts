import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadMedia } from '../src/transport/media.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

function ctxWith(f: typeof fetch, apiKey = 'wbk_k') {
  return { base: 'http://x', session: new Session('http://x', f), apiKey, fetchImpl: f };
}

/**
 * A server that answers everything 200 — EXCEPT the server-side fetch door.
 *
 * `uploadMedia` asks `/from-url` first now, so a mock that says yes to it never
 * reaches the multipart path these tests are about. 404 is not a dodge: it is
 * what a deployment older than that route really answers, and it is the case
 * this fallback exists for.
 */
function ok(body: unknown = { asset: { id: 'as_1', url: 'http://cdn/x.png' } }) {
  return vi.fn(async (input: string | URL) => {
    if (String(input).endsWith('/from-url')) {
      return new Response('{"error":"not found"}', {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

/**
 * The server-side fetch door, ABSENT — which is what a deployment older than
 * `POST /api/media/{siteId}/from-url` really answers, and the case these tests
 * are about: everything below that door is the path that still has to work.
 */
const absent = (u: unknown) => String(u).endsWith('/from-url');
const notFound = () =>
  new Response('{"error":"not found"}', {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });

function calls(f: typeof fetch) {
  return (f as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}

/**
 * The multipart POST, found by its BODY rather than by its position.
 *
 * A url upload now makes three calls — ask the server to fetch it, fetch it
 * here when that route is absent, then post the bytes — and an index would have
 * to be renumbered by whoever adds the fourth. The multipart one is the only
 * one carrying a FormData.
 */
function formCall(f: typeof fetch): RequestInit {
  for (const [, init] of calls(f) as Array<[unknown, RequestInit]>) {
    if (init?.body instanceof FormData) return init;
  }
  throw new Error('no multipart call was made');
}

describe('uploadMedia()', () => {
  it('sends MULTIPART, which is the whole reason this bypasses request()', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-media-'));
    const file = join(dir, 'hero.png');
    writeFileSync(file, Buffer.from([137, 80, 78, 71]));
    try {
      const f = ok();
      await uploadMedia(ctxWith(f), 's1', { path: file });

      const [url, init] = calls(f).find(([, i]) => (i as RequestInit)?.body instanceof FormData) as [string, RequestInit];
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
      if (absent(u)) return notFound();
      if (String(u).startsWith('http://src/')) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }
      return new Response(JSON.stringify({ asset: { url: 'http://cdn/y.png' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await uploadMedia(ctxWith(f), 's1', { url: 'http://src/photos/banner.jpg' });
    const form = formCall(f).body as FormData;
    expect((form.get('file') as File).name).toBe('banner.jpg');
  });

  /**
   * THE BLOB'S TYPE IS THE UPLOAD'S CONTENT TYPE, and omitting it broke every
   * upload this function ever made.
   *
   * A typeless Blob is sent as `application/octet-stream`. The platform accepts
   * a file whose DECLARED type starts with `image/` or `video/`, or whose
   * extension is a known font or document — and octet-stream is none of those.
   * So a PNG fetched from a URL came back "only image, video, or font uploads
   * are supported", a message that reads as a policy about the file and was
   * really one missing argument.
   *
   * It cost a wrong conclusion as well as a broken tool: the same refusal on an
   * SVG was written up as "the platform deliberately refuses SVG". It does not.
   *
   * The tests above pinned the file NAME and never the type, which is how it
   * survived.
   */
  it("sends the source's own content type", async () => {
    const f = vi.fn(async (u: unknown) => {
      if (absent(u)) return notFound();
      if (String(u).startsWith('http://src/')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/webp' },
        });
      }
      return new Response(JSON.stringify({ asset: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await uploadMedia(ctxWith(f), 's1', { url: 'http://src/a.webp' });
    const form = formCall(f).body as FormData;
    expect((form.get('file') as File).type).toBe('image/webp');
  });

  it('falls back to the extension when the server declares nothing useful', async () => {
    const f = vi.fn(async (u: unknown) => {
      if (absent(u)) return notFound();
      if (String(u).startsWith('http://src/')) {
        return new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      }
      return new Response(JSON.stringify({ asset: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    // A CDN that answers octet-stream for a PNG is common, and the platform
    // refuses exactly that.
    await uploadMedia(ctxWith(f), 's1', { url: 'http://src/photo.png' });
    const form = formCall(f).body as FormData;
    expect((form.get('file') as File).type).toBe('image/png');
  });

  it('types an SVG as an image, which the platform accepts', async () => {
    const f = vi.fn(async (u: unknown) => {
      if (absent(u)) return notFound();
      if (String(u).startsWith('http://src/')) return new Response(new Uint8Array([1]), { status: 200 });
      return new Response(JSON.stringify({ asset: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await uploadMedia(ctxWith(f), 's1', { url: 'http://src/logo.svg' });
    const form = formCall(f).body as FormData;
    // `image/svg+xml` starts with `image/`, which is the platform's whole test.
    expect((form.get('file') as File).type).toBe('image/svg+xml');
  });

  it('names a URL that carries no filename rather than uploading an empty name', async () => {
    const f = vi.fn(async (u: unknown) => {
      if (absent(u)) return notFound();
      if (String(u).startsWith('http://cdn2/')) return new Response(new Uint8Array([1]), { status: 200 });
      return new Response(JSON.stringify({ asset: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await uploadMedia(ctxWith(f), 's1', { url: 'http://cdn2/?id=9' });
    const form = formCall(f).body as FormData;
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
  const jpeg = () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-media-'));
    const file = join(dir, 'a.jpg');
    writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff]));
    return { dir, file };
  };
  const keyCtx = (f: typeof fetch) => ({
    base: 'http://x',
    session: new Session('http://x', f),
    apiKey: 'wbk_k',
    fetchImpl: f,
    notices: new Notices(), undo: new UndoLog(),
  });

  it('falls back to the partner surface when /api/media refuses the key', async () => {
    // A deployment older than "feat(media): a wbk_ API key may upload" answers
    // 401 to a perfectly valid key. /api/v1/media is multipart too and takes
    // nothing BUT a key, so it is the second door — measured against a real
    // server binary 26 minutes older than the fix.
    const seen: string[] = [];
    const f = (async (url: string) => {
      seen.push(String(url));
      if (String(url).includes('/api/v1/media')) {
        return new Response(JSON.stringify({ asset: { id: 'mda_1', url: 'http://cdn/a.jpg' } }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'unauthorized', code: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const { dir, file } = jpeg();
    try {
      const asset = await uploadMedia(keyCtx(f), 's1', { path: file });
      expect(asset.url).toBe('http://cdn/a.jpg');
      expect(seen[0]).toContain('/api/media/s1');
      expect(seen[1]).toContain('/api/v1/media');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blames the key AND the deployment only when both doors refuse', async () => {
    const f = (async () =>
      new Response(JSON.stringify({ error: 'unauthorized', code: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const { dir, file } = jpeg();
    try {
      // A 401 no longer means "get a session": a key CAN upload. It means this
      // key lacks media.write, belongs to another site, or the server predates
      // the change — and naming one cause alone sends the caller to fix the
      // wrong thing, which is exactly what happened.
      await expect(uploadMedia(keyCtx(f), 's1', { path: file })).rejects.toThrow(
        /media\.write|another one|DEPLOYMENT/i,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * THE SERVER'S OWN DOOR.
 *
 * `POST /api/media/{siteId}/from-url` fetches the image where the platform
 * already guards outbound requests, so the bytes make ONE hop instead of two.
 * These pin the three answers that matter: it is asked first, an absent route
 * falls through to the older path, and a REFUSED ADDRESS IS TERMINAL.
 */
describe('uploadMedia() — the server-side fetch', () => {
  it('asks the platform first, and does not download the file itself', async () => {
    const f = vi.fn(async (u: unknown) =>
      String(u).endsWith('/from-url')
        ? new Response(JSON.stringify({ asset: { url: 'http://cdn/z.png' } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('should not be reached', { status: 500 }),
    ) as unknown as typeof fetch;

    const asset = await uploadMedia(ctxWith(f), 's1', { url: 'https://cdn.example/z.png' });
    expect(asset.url).toBe('http://cdn/z.png');
    expect(calls(f)).toHaveLength(1);
    const [url, init] = calls(f)[0] as [string, RequestInit];
    expect(url).toBe('http://x/api/media/s1/from-url');
    expect(JSON.parse(String(init.body))).toMatchObject({ url: 'https://cdn.example/z.png' });
  });

  it('carries the name and folder the caller gave, under the same names the form uses', async () => {
    const f = vi.fn(async () =>
      new Response(JSON.stringify({ asset: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;
    await uploadMedia(ctxWith(f), 's1', { url: 'https://x/a.png', name: 'Ảnh bìa', folderId: 'fd_1' });
    expect(JSON.parse(String((calls(f)[0][1] as RequestInit).body))).toEqual({
      url: 'https://x/a.png',
      name: 'Ảnh bìa',
      folderId: 'fd_1',
    });
  });

  it('REFUSES TO WALK AROUND A BLOCKED ADDRESS', async () => {
    // The server refuses an address that is not on the public internet. A client
    // that answered by fetching that same URL from its OWN machine and uploading
    // the bytes would walk straight around the guard — which is the bypass the
    // check exists to prevent, so this raises rather than falls back.
    const f = vi.fn(async (u: unknown) =>
      String(u).endsWith('/from-url')
        ? new Response(JSON.stringify({ error: 'that address may not be fetched', code: 'remote_blocked' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          })
        : new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(
      uploadMedia(ctxWith(f), 's1', { url: 'http://169.254.169.254/latest/meta-data/' }),
    ).rejects.toThrow(/not an address on the public internet/);
    // And it never fetched it here either.
    expect(calls(f)).toHaveLength(1);
  });

  it('falls through when the ROUTE is absent, which is an older deployment', async () => {
    const f = ok();
    await uploadMedia(ctxWith(f), 's1', { url: 'http://src/a.png' });
    expect(formCall(f).body).toBeInstanceOf(FormData);
  });

  it('a local path never asks — there is no URL for the server to fetch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-media-'));
    const file = join(dir, 'a.png');
    writeFileSync(file, Buffer.from([1]));
    try {
      const f = ok();
      await uploadMedia(ctxWith(f), 's1', { path: file });
      expect(calls(f).some(([u]) => String(u).endsWith('/from-url'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
