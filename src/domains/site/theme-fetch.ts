import { request } from '../../transport/http.js';
import { siteToken } from '../../tools/credentialpick.js';
import type { ToolContext } from '../../tools/context.js';
import type { StarterTheme } from '../../catalog/theme-types.js';
import { STARTER_THEME, type ThemeOrigin } from './theme.js';

/**
 * The SITE's theme, or the starter with the origin said out loud.
 *
 * CACHED FOR THE PROCESS, because `sb_node_read` is a read an agent makes
 * constantly and a theme changes about as often as a brand does. The cache is
 * keyed by site so a session spanning two of them cannot serve one's palette for
 * the other — the same reason `siteFor()` takes an explicit argument at all.
 *
 * A FAILURE IS NOT AN ERROR HERE, and it is not silent either. Every other
 * fetch-and-tolerate in this server (gatherReadiness) goes quiet on a refused
 * endpoint because a missing input means one rule cannot be asked. This one
 * cannot go quiet: falling back to the starter and presenting its `#111827` as
 * the site's heading colour is a confident wrong answer, which is the failure
 * this whole module exists to prevent. So the origin travels with the value and
 * every caller reports it.
 */
const cache = new Map<string, { theme: StarterTheme; from: ThemeOrigin }>();

export async function siteTheme(
  ctx: ToolContext,
  siteId: string,
): Promise<{ theme: StarterTheme; from: ThemeOrigin }> {
  const hit = cache.get(siteId);
  if (hit) return hit;

  let out: { theme: StarterTheme; from: ThemeOrigin } = {
    theme: STARTER_THEME,
    from: 'starter',
  };
  try {
    const res = (await request({
      base: ctx.base,
      method: 'GET',
      path: `/api/sites/${encodeURIComponent(siteId)}/theme`,
      token: siteToken(ctx),
      fetchImpl: ctx.fetchImpl,
    })) as { theme?: Partial<StarterTheme> } | Partial<StarterTheme> | null;

    // The platform answers `{"theme": …}`; accept a bare document too rather
    // than depend on an envelope this client does not own.
    const raw = (res && 'theme' in (res as object) ? (res as { theme?: unknown }).theme : res) as
      | Partial<StarterTheme>
      | null
      | undefined;

    // A site that has never customised answers with no presets at all, which is
    // not a failure — it means the starter IS its theme. Saying 'site' there
    // would be true and useless; saying 'starter' is both.
    if (raw && Array.isArray(raw.presets) && raw.presets.length) {
      out = {
        theme: {
          version: raw.version ?? STARTER_THEME.version,
          colors: raw.colors ?? STARTER_THEME.colors,
          textStyles: raw.textStyles ?? STARTER_THEME.textStyles,
          schemes: raw.schemes ?? STARTER_THEME.schemes,
          lightSchemeId: raw.lightSchemeId ?? STARTER_THEME.lightSchemeId,
          darkSchemeId: raw.darkSchemeId ?? STARTER_THEME.darkSchemeId,
          presets: raw.presets,
        },
        from: 'site',
      };
    }
  } catch {
    // Keep the starter, keep the origin honest.
  }
  cache.set(siteId, out);
  return out;
}

/** Testing seam — the cache is process-wide and would leak between cases. */
export function clearThemeCache(): void {
  cache.clear();
}
