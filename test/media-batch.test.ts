import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/transport/auth.js';
import { connectedClient } from './harness.js';

/**
 * sb_media_upload `paths` — stocking a catalogue was 31 calls of one path each.
 * The asset is shaped off media.Asset's json tags plus the library's `url`.
 */
describe('sb_media_upload paths', () => {
  function files() {
    const d = mkdtempSync(join(tmpdir(), 'sb-batch-'));
    const a = join(d, 'laptop-a.png');
    const b = join(d, 'laptop-b.jpg');
    const secret = join(d, 'id_rsa');
    writeFileSync(a, Buffer.from([1]));
    writeFileSync(b, Buffer.from([2]));
    writeFileSync(secret, 'SECRET');
    return { a, b, secret };
  }

  async function call(args: Record<string, unknown>) {
    const posts: string[] = [];
    let n = 0;
    const f = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/api/media/s1')) {
        posts.push(url);
        n++;
        return new Response(
          JSON.stringify({
            asset: {
              id: `mda_${n}`, siteId: 's1', objectKey: `s1/${n}.png`, name: `laptop-${n}`,
              contentType: 'image/png', mediaType: 'image', sizeBytes: 1, width: 1200, height: 900,
              state: 'ready', createdAt: '2026-10-28T00:00:00Z', updatedAt: '2026-10-28T00:00:00Z',
              url: `https://cdn/s1/${n}.png`,
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({ fetchImpl: f, session });
    const res = (await client.callTool({ name: 'sb_media_upload', arguments: { site_id: 's1', ...args } })) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    await close();
    return { out: JSON.parse(res.content[0].text), posts };
  }

  it('dry-runs by default and sends nothing', async () => {
    const { a, b } = files();
    const { out, posts } = await call({ paths: [a, b] });
    expect(out.dry_run).toBe(true);
    expect(out.would_upload).toEqual([a, b]);
    expect(posts).toEqual([]);
  });

  it('uploads each, answers a compact list, and a refused file does not abort the batch', async () => {
    const { a, b, secret } = files();
    const { out, posts } = await call({ paths: [a, secret, b], dry_run: false });
    expect(posts).toHaveLength(2);
    expect(out.uploaded).toEqual([
      { name: 'laptop-1', url: 'https://cdn/s1/1.png', width: 1200, height: 900 },
      { name: 'laptop-2', url: 'https://cdn/s1/2.png', width: 1200, height: 900 },
    ]);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].path).toBe(secret);
    expect(out.failed[0].why).toMatch(/must be one of/);
  });
});
