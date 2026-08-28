import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { ApiError } from './http.js';
import { siteToken } from '../tools/credentialpick.js';
import type { ToolContext } from '../tools/context.js';

export interface UploadedAsset {
  id?: string;
  url?: string;
  name?: string;
  [k: string]: unknown;
}

/**
 * Put an image into the site's media library.
 *
 * MULTIPART, which is why this does not go through `request()`. That helper
 * JSON-encodes every body, and `POST /api/media/{siteId}` takes
 * `file:formData/file` — so an agent reaching this endpoint through sb_api_call
 * sent JSON to a multipart handler and got a rejection it could not act on. A
 * page with no images is not a designed page, so this was the gap between
 * "the agent can lay out a page" and "the agent can finish one".
 *
 * Node ≥22 has FormData, Blob and fetch as globals, so this needs no dependency.
 */
export async function uploadMedia(
  ctx: ToolContext,
  siteId: string,
  source: { path?: string; url?: string; name?: string; folderId?: string },
): Promise<UploadedAsset> {
  const doFetch = ctx.fetchImpl ?? fetch;

  let bytes: Uint8Array;
  let filename: string;
  if (source.path) {
    bytes = await readFile(source.path);
    filename = source.name ?? basename(source.path);
  } else if (source.url) {
    const res = await doFetch(source.url);
    if (!res.ok) {
      throw new ApiError(res.status, 'source_unreachable', `could not fetch ${source.url}`);
    }
    bytes = new Uint8Array(await res.arrayBuffer());
    // A URL's last segment is usually the filename; when it is not (a query-only
    // CDN link), name it rather than uploading something called "".
    filename = source.name ?? (new URL(source.url).pathname.split('/').pop() || 'image');
  } else {
    throw new Error('sbuilder: give sb_media_upload either a local path or a url');
  }

  const form = new FormData();
  form.set('file', new Blob([bytes]), filename);
  if (source.name) form.set('name', source.name);
  if (source.folderId) form.set('folderId', source.folderId);

  // No Content-Type header: fetch must set it itself so the multipart boundary
  // matches the body it just built. Setting it by hand is the classic way to
  // make a valid upload unparseable at the other end.
  const res = await doFetch(`${ctx.base.replace(/\/$/, '')}/api/media/${encodeURIComponent(siteId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${siteToken(ctx)}`, Accept: 'application/json' },
    body: form,
  });

  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    throw new ApiError(res.status, 'non_json_response', raw.slice(0, 400));
  }
  if (!res.ok) {
    const env = (parsed ?? {}) as { error?: string; code?: string };
    throw new ApiError(res.status, env.code ?? 'unknown', env.error ?? `HTTP ${res.status}`);
  }
  const body = parsed as { asset?: UploadedAsset };
  return body.asset ?? (parsed as UploadedAsset);
}
