import { identityHeaders } from './identity.js';
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
    // Content-Type stays ABSENT — fetch writes it with the boundary it just
    // built — but the identity headers belong here as much as on any other call:
    // an install whose only traffic is image uploads is still an install.
    headers: {
      Authorization: `Bearer ${siteToken(ctx)}`,
      Accept: 'application/json',
      ...identityHeaders(),
    },
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
    // THE UPLOAD SURFACE TAKES A SESSION ONLY.
    //
    // `/api/media/{siteId}` is mounted behind `RequireAuth` — not the
    // `RequireAuthOrDefer` that lets a `wbk_` key open `/api/sites`
    // (server/internal/server/router.go). So a key-only install, which is the
    // one the store's Agent app hands out and the one the README recommends,
    // gets a bare "unauthorized" from the ONE tool that cannot be replaced by
    // sb_api_call, because the body is multipart. Found on a live run.
    if ((res.status === 401 || res.status === 403) && ctx.apiKey && !ctx.session.loggedIn()) {
      throw new ApiError(
        res.status,
        'media_needs_session',
        'sbuilder: the media upload endpoint takes a session token only — an API key cannot ' +
          'upload. Set SB_EMAIL and SB_PASSWORD and call sb_connect, then retry. Every other ' +
          'tool works with the key alone.',
      );
    }
    const env = (parsed ?? {}) as {
      error?: string;
      code?: string;
      details?: unknown;
      fields?: Record<string, string>;
    };
    const fieldText = env.fields
      ? ' — ' + Object.entries(env.fields).map(([k, v]) => `${k}: ${v}`).join('; ')
      : '';
    throw new ApiError(
      res.status,
      env.code ?? 'unknown',
      (env.error ?? `HTTP ${res.status}`) + fieldText,
      env.details,
      env.fields,
    );
  }
  const body = parsed as { asset?: UploadedAsset };
  return body.asset ?? (parsed as UploadedAsset);
}
