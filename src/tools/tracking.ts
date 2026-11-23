/**
 * `sb_store action:"tracking"` — A STORE'S MEASUREMENT, IN ONE CALL.
 *
 * Without it an agent had to find four routes (integrations list, detect,
 * POST/PUT, channels) and know that a pasted snippet must be reduced to an id,
 * that one row exists per provider, and that a stored row may carry a `problem`.
 * web_builder answers all of that server-side; this only sequences it:
 *
 * - no `text`, no `provider` → STATUS: every tracker (connected or not, its id,
 *   on/off, and `problem` when a stored id installs no tag) plus where visitors
 *   came from over the last 30 days (GET /forms/submissions/channels). Read-only.
 * - `text` → INSTALL whatever the text sets up: the server's detect names each
 *   provider and cleans its id; an existing row is UPDATED (its other config
 *   kept, switched on), a new one CREATED. Dry run by default: the plan.
 * - `provider` + `enabled` → switch one tracker on or off.
 *
 * A failure on one provider does not stop the others; each reports its own
 * result, and the server's own sentence (e.g. invalid_tracking_id naming the
 * expected shape) is passed through untouched.
 */
import { request } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import type { ToolContext } from './context.js';

interface Integration {
  id?: string;
  provider: string;
  enabled: boolean;
  config: Record<string, string>;
  problem?: string;
  /** A Meta/TikTok server-events token is stored (the token itself is never returned). */
  tokenSet?: boolean;
}

/** web_builder's providers and the one config field each reads (integrations/providers.go). */
export const TRACKING_FIELDS: Record<string, string> = {
  google_analytics: 'measurementId',
  google_tag_manager: 'containerId',
  facebook_pixel: 'pixelId',
  tiktok_pixel: 'pixelId',
  openai_pixel: 'pixelId',
  google_ads: 'conversionId',
  microsoft_clarity: 'projectId',
};

export interface TrackingArgs {
  text?: string;
  provider?: string;
  enabled?: boolean;
  /** Extra fields of one tracker (labels, testEventCode, accessToken…); "" clears one. */
  config?: Record<string, string>;
  /** Send one test event for `provider` through the platform's "Gửi thử". */
  test?: boolean;
  dryRun: boolean;
}

/** Config keys that are secrets: never echoed back in a plan or a result. */
const SECRET_KEYS = new Set(['accessToken']);
/** Keys the platform owns (delivery status): never sent back on a write. */
const isServerKey = (k: string) => k.startsWith('server');
const masked = (config: Record<string, string>) =>
  Object.fromEntries(Object.entries(config).map(([k, v]) => [k, SECRET_KEYS.has(k) && v ? '***' : v]));

export async function trackingFlow(ctx: ToolContext, siteId: string, args: TrackingArgs): Promise<unknown> {
  const site = encodeURIComponent(siteId);
  const base = `/api/sites/${site}/integrations`;
  const send = async <T>(method: string, path: string, body?: unknown): Promise<T> =>
    (await request({
      base: ctx.base,
      method,
      path,
      token: siteToken(ctx),
      body,
      fetchImpl: ctx.fetchImpl,
    })) as T;
  const current = async () => (await send<{ integrations?: Integration[] }>('GET', base)).integrations ?? [];
  const idOf = (i: Integration) => i.config?.[TRACKING_FIELDS[i.provider] ?? ''] ?? '';

  if (args.test) {
    if (!args.provider || !(args.provider in TRACKING_FIELDS)) {
      throw new Error(`sbuilder: test needs provider, one of ${Object.keys(TRACKING_FIELDS).join(', ')}.`);
    }
    const row = (await current()).find((i) => i.provider === args.provider);
    if (!row?.id) throw new Error(`sbuilder: ${args.provider} is not connected.`);
    const path = `${base}/${encodeURIComponent(row.id)}/test`;
    if (args.dryRun) return { dryRun: true, plan: [{ method: 'POST', path }] };
    return (await send<{ test: unknown }>('POST', path)).test;
  }

  if (args.config !== undefined) {
    if (!args.provider || !(args.provider in TRACKING_FIELDS)) {
      throw new Error(`sbuilder: config needs provider, one of ${Object.keys(TRACKING_FIELDS).join(', ')}.`);
    }
    const row = (await current()).find((i) => i.provider === args.provider);
    // The stored config never carries the token (the platform masks it); an absent
    // accessToken key KEEPS the stored one, "" clears it. Server-owned status keys
    // are dropped rather than written back.
    const kept = Object.fromEntries(Object.entries(row?.config ?? {}).filter(([k]) => !isServerKey(k)));
    const body = {
      provider: args.provider,
      enabled: args.enabled ?? row?.enabled ?? true,
      config: { ...kept, ...args.config },
    };
    const step = row?.id
      ? { method: 'PUT', path: `${base}/${encodeURIComponent(row.id)}` }
      : { method: 'POST', path: base };
    if (args.dryRun) return { dryRun: true, plan: [{ ...step, body: { ...body, config: masked(body.config) } }] };
    const saved = await send<{ integration: Integration }>(step.method, step.path, body);
    return {
      provider: args.provider,
      id: idOf(saved.integration),
      enabled: saved.integration.enabled,
      config: saved.integration.config,
      tokenSet: !!saved.integration.tokenSet,
    };
  }

  if (args.provider !== undefined || args.enabled !== undefined) {
    if (!args.provider || args.enabled === undefined) {
      throw new Error('sbuilder: action:"tracking" switches a tracker with BOTH provider and enabled.');
    }
    if (!(args.provider in TRACKING_FIELDS)) {
      throw new Error(`sbuilder: provider must be one of ${Object.keys(TRACKING_FIELDS).join(', ')}.`);
    }
    const row = (await current()).find((i) => i.provider === args.provider);
    if (!row?.id) {
      throw new Error(`sbuilder: ${args.provider} is not connected — pass its snippet or id as text to install it.`);
    }
    const body = {
      provider: row.provider,
      enabled: args.enabled,
      config: row.config,
    };
    if (args.dryRun) {
      return {
        dryRun: true,
        plan: [
          {
            method: 'PUT',
            path: `${base}/${encodeURIComponent(row.id)}`,
            body,
          },
        ],
      };
    }
    const saved = await send<{ integration: Integration }>('PUT', `${base}/${encodeURIComponent(row.id)}`, body);
    return {
      provider: row.provider,
      id: idOf(saved.integration),
      enabled: saved.integration.enabled,
    };
  }

  if (args.text !== undefined) {
    if (!args.text.trim()) throw new Error('sbuilder: text is empty — paste the vendor snippet or the id.');
    const found =
      (
        await send<{ integrations?: Integration[] }>('POST', `${base}/detect`, {
          text: args.text,
        })
      ).integrations ?? [];
    if (!found.length) {
      return {
        recognised: [],
        note:
          'No tracker recognised. A bare TikTok or ChatGPT Ads id says nothing about whose it is: ' +
          "paste the vendor's whole snippet, or POST /integrations with the provider named.",
      };
    }
    const rows = await current();
    const plan = found.map((d) => {
      const existing = rows.find((r) => r.provider === d.provider);
      const body = {
        provider: d.provider,
        enabled: true,
        config: { ...existing?.config, ...d.config },
      };
      return existing?.id
        ? {
            provider: d.provider,
            id: idOf(d),
            replaces: idOf(existing),
            method: 'PUT',
            path: `${base}/${encodeURIComponent(existing.id)}`,
            body,
          }
        : {
            provider: d.provider,
            id: idOf(d),
            method: 'POST',
            path: base,
            body,
          };
    });
    if (args.dryRun) return { dry_run: true, plan };
    const results = [];
    for (const p of plan) {
      try {
        await send(p.method, p.path, p.body);
        results.push({ provider: p.provider, id: p.id, ok: true });
      } catch (e) {
        results.push({
          provider: p.provider,
          id: p.id,
          ok: false,
          error: (e as Error).message,
        });
      }
    }
    return {
      results,
      note: 'Tags are served at request time: live on the storefront now, no republish.',
    };
  }

  const rows = await current();
  // What the platform says is missing or broken (one rule set for the screen, the
  // assistant and this tool). An older platform has no /health: say so, don't fail.
  let advice: unknown = [];
  try {
    advice = (await send<{ advice?: unknown[] }>('GET', `${base}/health`)).advice ?? [];
  } catch (e) {
    advice = { unavailable: (e as Error).message };
  }
  let channels: unknown = null;
  try {
    channels =
      (await send<{ channels?: unknown[] }>('GET', `/api/sites/${site}/forms/submissions/channels`)).channels ?? [];
  } catch (e) {
    channels = { unavailable: (e as Error).message };
  }
  return {
    trackers: Object.keys(TRACKING_FIELDS).map((provider) => {
      const r = rows.find((x) => x.provider === provider);
      if (!r) return { provider, connected: false };
      return {
        provider,
        id: idOf(r),
        enabled: r.enabled,
        ...(r.problem ? { problem: r.problem } : {}),
        // Server-side events (Meta CAPI / TikTok Events API): the token is set
        // on the Integrations screen; this reports whether sending works.
        ...(r.tokenSet
          ? {
              serverEvents: {
                status: r.config?.serverStatus || 'waiting',
                ...(r.config?.serverError ? { error: r.config.serverError } : {}),
                ...(r.config?.serverAt ? { at: r.config.serverAt } : {}),
              },
            }
          : {}),
      };
    }),
    channelsLast30Days: channels,
    advice,
  };
}
