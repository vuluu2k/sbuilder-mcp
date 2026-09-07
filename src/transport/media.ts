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
    // AN API KEY CAN UPLOAD — THE PLATFORM WIDENED THIS.
    //
    // `/api/media` is now mounted behind `RequireAuthOrDefer`
    // (server/internal/server/router.go:2821), the same gate `/api/sites` uses,
    // and `upload_agentkey_test.go` pins the three answers that make it safe:
    // the key's own site only, the same permission the session path checks, and
    // no key at all still meaning 401. The platform's own comment gives the
    // reason it changed — the media LIBRARY already took a key while the UPLOAD
    // refused one, so a merchant could hand an agent a key that manages every
    // image the store has and cannot add one.
    //
    // This message used to say "an API key cannot upload" and send the caller to
    // set SB_EMAIL. That is now the wrong instruction: with a key present, a 401
    // here means the KEY is wrong for this call, not that the wrong KIND of
    // credential was used, and the old text sent people to fix something that
    // was never broken.
    if ((res.status === 401 || res.status === 403) && ctx.apiKey && !ctx.session.loggedIn()) {
      throw new ApiError(
        res.status,
        'media_key_refused',
        'sbuilder: the platform refused this API key for the upload. It accepts a key, so the ' +
          'cause is the key itself: it needs the media permission, and it must belong to THIS ' +
          'site — a key minted for another site is refused before the upload is read. Check the ' +
          "key's scopes and its site, or set SB_EMAIL / SB_PASSWORD to upload as a person.",
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
