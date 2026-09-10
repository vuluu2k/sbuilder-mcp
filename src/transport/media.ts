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
/**
 * A content type from the file NAME, for the local-path case and as the fallback
 * when a server answers with nothing useful.
 *
 * Deliberately small: the platform decides what it accepts, and duplicating its
 * whole table here would be a second place for that policy to drift. These are
 * the types a page actually carries.
 */
const TYPE_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

function typeForName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : (TYPE_BY_EXT[name.slice(dot).toLowerCase()] ?? '');
}

/**
 * Ask the platform to fetch the URL itself.
 *
 * Returns the asset when the server took it, or null when the ROUTE is not
 * there — an older deployment — which is the one case the caller may answer by
 * downloading the bytes and posting them the old way.
 *
 * A REFUSAL IS TERMINAL, and that is a security rule rather than tidiness. The
 * server refuses an address that is not on the public internet (`remote_blocked`
 * — loopback, private ranges, the cloud metadata endpoint), and a client that
 * answered by fetching that same URL from its OWN machine and uploading the
 * bytes would walk straight around the guard. The agent's network is not the
 * server's, but "the caller does it instead" is exactly the bypass the check
 * exists to prevent, so the error is raised rather than worked around.
 */
async function fromUrl(
  ctx: ToolContext,
  siteId: string,
  url: string,
  source: { name?: string; folderId?: string },
): Promise<UploadedAsset | null> {
  const doFetch = ctx.fetchImpl ?? fetch;
  const res = await doFetch(`${ctx.base.replace(/\/$/, '')}/api/media/${encodeURIComponent(siteId)}/from-url`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${siteToken(ctx)}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...identityHeaders(),
    },
    body: JSON.stringify({
      url,
      ...(source.name ? { name: source.name } : {}),
      ...(source.folderId ? { folderId: source.folderId } : {}),
    }),
  });
  // 404/405 is "this build has no such route". Anything else is an answer.
  if (res.status === 404 || res.status === 405) return null;

  const raw = await res.text();
  let parsed: unknown = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    // A build that routes this path to something else entirely. Fall back rather
    // than reporting a parse error the caller cannot act on.
    return null;
  }
  if (!res.ok) {
    const env = (parsed ?? {}) as { error?: string; code?: string; details?: unknown };
    if (env.code === 'remote_blocked') {
      throw new ApiError(
        res.status,
        'remote_blocked',
        `sbuilder: the platform refuses to fetch ${url} — it is not an address on the public ` +
          'internet. This server will not fetch it on the platform\'s behalf either: that would ' +
          'walk around the check rather than satisfy it. Give a public URL, or upload the file ' +
          'with a local path.',
      );
    }
    if (env.code === 'remote_unreachable') {
      throw new ApiError(res.status, 'remote_unreachable', `sbuilder: the platform could not read ${url}.`);
    }
    // Any OTHER refusal — 401, 403, 413, an unsupported type — is one the older
    // path answers with its own, better-worded diagnosis. Let it try.
    return null;
  }
  const body = (parsed ?? {}) as { asset?: UploadedAsset };
  return body.asset ?? (parsed as UploadedAsset);
}

export async function uploadMedia(
  ctx: ToolContext,
  siteId: string,
  source: { path?: string; url?: string; name?: string; folderId?: string },
): Promise<UploadedAsset> {
  const doFetch = ctx.fetchImpl ?? fetch;

  // THE SERVER'S OWN DOOR FIRST, when the source is a URL.
  //
  // `POST /api/media/{siteId}/from-url` fetches it where the platform already
  // guards outbound requests, so the bytes make ONE hop instead of two and the
  // content type is decided by the origin's own answer rather than reconstructed
  // here. Everything below this is the older path, kept because a deployment
  // without that route must still be able to upload — the same shape the partner
  // -surface retry below has, and for the same reason.
  if (source.url) {
    const viaServer = await fromUrl(ctx, siteId, source.url, source);
    if (viaServer) return viaServer;
  }

  let bytes: Uint8Array;
  let filename: string;
  let declared = '';
  if (source.path) {
    bytes = await readFile(source.path);
    filename = source.name ?? basename(source.path);
  } else if (source.url) {
    const res = await doFetch(source.url);
    if (!res.ok) {
      throw new ApiError(res.status, 'source_unreachable', `could not fetch ${source.url}`);
    }
    bytes = new Uint8Array(await res.arrayBuffer());
    // The SOURCE'S OWN answer first — it is the only party that actually knows.
    declared = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    // A URL's last segment is usually the filename; when it is not (a query-only
    // CDN link), name it rather than uploading something called "".
    filename = source.name ?? (new URL(source.url).pathname.split('/').pop() || 'image');
  } else {
    throw new Error('sbuilder: give sb_media_upload either a local path or a url');
  }

  // THE HEADER ONLY WINS WHEN IT SAYS SOMETHING. A CDN answering
  // `application/octet-stream` for a PNG is ordinary, and it is exactly the
  // value the platform refuses — so "the server declared a type" is not the
  // question; "the server declared a type that identifies the file" is.
  const usable = declared.startsWith('image/') || declared.startsWith('video/');
  const type = (usable ? declared : '') || typeForName(filename) || declared;

  const form = new FormData();
  // THE BLOB'S TYPE IS THE UPLOAD'S CONTENT TYPE, and omitting it broke every
  // upload this function ever made from a URL. A typeless Blob is sent as
  // `application/octet-stream`, the platform accepts a file whose declared type
  // starts with `image/` or `video/` (or whose EXTENSION is a known font or
  // document), and octet-stream is none of those — so a PNG fetched from a URL
  // was refused with "only image, video, or font uploads are supported", which
  // reads as a policy about the FILE and is really a bug in this line.
  //
  // It cost a wrong conclusion too: the same refusal on an SVG was written up
  // here as "the platform deliberately refuses SVG". It does not — it accepts
  // any `image/*`, and `image/svg+xml` is one.
  form.set('file', new Blob([bytes], type ? { type } : undefined), filename);
  if (source.name) form.set('name', source.name);
  if (source.folderId) form.set('folderId', source.folderId);

  // No Content-Type header: fetch must set it itself so the multipart boundary
  // matches the body it just built. Setting it by hand is the classic way to
  // make a valid upload unparseable at the other end.
  const post = (path: string) =>
    doFetch(`${ctx.base.replace(/\/$/, '')}${path}`, {
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

  let res = await post(`/api/media/${encodeURIComponent(siteId)}`);

  // THE PARTNER SURFACE IS A SECOND DOOR, and it is the key's own.
  //
  // `/api/media` takes a key only since `feat(media): a wbk_ API key may upload`
  // — so against a deployment older than that commit it answers 401 to a key
  // that is perfectly valid, and the message below then blamed the key's scopes.
  // Measured: a key holding media.read + media.write, on its own site, refused
  // by a server binary 26 minutes older than the fix, while `POST /api/v1/media`
  // — multipart too, and keyed BY DEFINITION, since /api/v1 accepts nothing else
  // — answered 201 for the same bytes.
  //
  // So a refusal here is not the end of the road, and retrying costs one request
  // on a path that was failing anyway. Only when BOTH doors refuse is the key
  // itself the suspect.
  if ((res.status === 401 || res.status === 403) && ctx.apiKey) {
    const viaPartner = await post('/api/v1/media');
    if (viaPartner.ok) res = viaPartner;
  }

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
        'sbuilder: both upload doors refused this API key — /api/media and the partner surface ' +
          '/api/v1/media. Two causes fit. The key: it needs media.write and must belong to THIS ' +
          'site, since a key minted for another one is refused before the upload is read. Or the ' +
          'DEPLOYMENT: /api/media took keys only from "feat(media): a wbk_ API key may upload", ' +
          'so a server older than that refuses a perfectly good key — check the running build ' +
          "before changing the key. Failing both, set SB_EMAIL / SB_PASSWORD to upload as a person.",
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
