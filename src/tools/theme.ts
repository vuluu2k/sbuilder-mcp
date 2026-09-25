import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { ApiError, request } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { siteFor, type ToolContext } from './context.js';
import { STARTER_THEME } from '../domains/site/theme.js';
import { clearThemeCache } from '../domains/site/theme-fetch.js';
import type { StarterTheme } from '../catalog/theme-types.js';

/**
 * THE SITE'S OWN LOOK — the one design decision that reaches every page.
 *
 * Design rule 0 says read the page's pattern and obey it, and `sb_node_read`
 * already answers what a node PAINTS by flattening its style preset. But the
 * layer underneath those presets — the palette every one of them resolves from
 * — was readable and, in practice, unwritable: `theme.ts` carries only read
 * helpers, and the PUT's body shape is `{theme: object}` because the SERVER
 * genuinely does not know the shape (`sitetheme.Theme.Data` is a
 * `json.RawMessage`; the comment says the editor owns it).
 *
 * So an agent that wanted a rose-and-ink storefront had exactly one move: paint
 * literals on nodes. This file already records what that costs — a literal
 * OUTRANKS the preset beneath it permanently, so the node stops following the
 * theme and the next palette change moves every other node and not that one.
 * The highest-leverage design act was the one thing the tools pushed you away
 * from.
 *
 * WHY A TOOL RATHER THAN A CALL SHEET ENTRY. `sb_api_call` can send this PUT,
 * and that is the problem: the write is a WHOLE-DOCUMENT REPLACE against a
 * surface with no history — no versions, no restore, on either surface. A body
 * missing `colors` used to be stored happily, and the site lost its palette,
 * its text styles and all 58 presets with a 200 and nothing to go back to.
 * (web_builder now refuses a document that is not recognisably a theme at all,
 * which closes the worst of it and does not make a partial write safe.) The
 * operation an author actually wants — "make the heading ink this" — is a
 * PATCH, and the only safe way to spell a patch on a replace-only endpoint is
 * to read the document, change the named fields and send the whole thing back.
 * That is what this does, by construction: there is no argument here that can
 * express "drop everything else".
 */

interface ThemeReply {
  theme: StarterTheme | null;
}

/**
 * The site's theme, or the starter when it has never saved one — READ, NEVER
 * TOLERATED. Unlike `siteTheme` (`domains/site/theme-fetch.ts`), this does not
 * catch: a failed GET propagates, because the only two callers that may reuse
 * this are read-modify-write paths against the replace-only theme PUT, where a
 * swallowed failure would write the starter over a site's own saved theme (see
 * `sb_import_site`'s theme step). `siteTheme`'s tolerance is correct for its own
 * callers — a read for `sb_node_read` — and wrong for a write; this is the
 * non-swallowing alternative, not a stricter version of that one.
 */
export async function readTheme(
  ctx: ToolContext,
  siteId: string,
): Promise<{ theme: StarterTheme; origin: 'site' | 'starter' }> {
  const got = (await request({
    base: ctx.base,
    method: 'GET',
    path: `/api/sites/${encodeURIComponent(siteId)}/theme`,
    token: siteToken(ctx),
    fetchImpl: ctx.fetchImpl,
  })) as ThemeReply;
  // A NEW SITE ANSWERS 200 {"theme": null} — the platform's own comment calls
  // that "the NORMAL first-visit state, not a failure". Starting from the
  // starter rather than from `{}` is what makes the first write store a
  // COMPLETE theme instead of a palette with one token in it.
  if (got?.theme && typeof got.theme === 'object') return { theme: got.theme, origin: 'site' };
  return { theme: structuredClone(STARTER_THEME) as StarterTheme, origin: 'starter' };
}

/**
 * SAVE THE STARTER THEME FOR A SITE THAT HAS NONE, once per site per process.
 *
 * A new site stores no theme. The editor paints against `DEFAULT_THEME` anyway,
 * and it saves that theme the first time a node references a token. Publish
 * compiles only the STORED theme, so a page this server builds on a fresh site
 * references `var(--wb-color-primary)` and the `-default` preset classes with
 * nothing declaring them. The result: buttons with white text on no fill, and
 * headings at body size. The canvas looks right and the published page does not.
 * Measured on a fresh local site, 2026-09-24.
 *
 * This does the save the editor would have done. It never replaces a stored
 * theme (`readTheme` answers 'site' for one), and it never fails the page
 * write it rides on. A failed attempt is simply retried on the next save.
 */
const themeSeeded = new Set<string>();
export async function ensureSiteTheme(ctx: ToolContext, siteId: string): Promise<void> {
  if (themeSeeded.has(siteId)) return;
  try {
    const { theme, origin } = await readTheme(ctx, siteId);
    if (origin === 'starter') {
      await request({
        base: ctx.base,
        method: 'PUT',
        path: `/api/sites/${encodeURIComponent(siteId)}/theme`,
        token: siteToken(ctx),
        body: { theme },
        fetchImpl: ctx.fetchImpl,
      });
      clearThemeCache();
    }
    themeSeeded.add(siteId);
  } catch {
    // The page write already succeeded; the next save retries.
  }
}

/** The platform's own guard (`sitesettings.LocaleTag`): a BCP-47-shaped tag. */
const LOCALE_TAG = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;

/**
 * THE SITE'S LANGUAGE — `settings.locale`, what `<html lang>` is served from.
 *
 * The PUT replaces the whole settings document, so the first door is the one
 * that cannot lose anything: read, change the locale, send the whole thing
 * back. A caller allowed only the language (web_builder 58dbfefb: a key with
 * pages.write) is refused that, and the platform merges a body that is EXACTLY
 * `{locale}` instead — so that is the second door. Never the first: a server
 * older than the merge would store `{locale}` as the WHOLE of settings. Each
 * door is tried with every credential (key, then session) before the next.
 */
async function setLocale(
  ctx: ToolContext,
  siteId: string,
  locale: string,
  dryRun: boolean,
): Promise<{ from: string | null; to: string; unchanged?: true }> {
  if (!LOCALE_TAG.test(locale)) {
    throw new Error(`sbuilder: "${locale}" is not a language tag — use one like "vi", "en" or "en-GB".`);
  }
  const path = `/api/sites/${encodeURIComponent(siteId)}/settings`;
  // Every credential this install holds, the site-scoped pick first.
  const creds = [{ token: siteToken(ctx), name: ctx.apiKey ? 'the API key' : 'the session' }];
  if (ctx.apiKey && ctx.session.loggedIn()) creds.push({ token: ctx.session.token(), name: 'the session' });
  const refused = new Set<string>();
  const is403 = (e: unknown): boolean => e instanceof ApiError && e.status === 403;

  let got: { settings?: Record<string, unknown> | null } | undefined;
  for (const c of creds) {
    try {
      got = (await request({ base: ctx.base, method: 'GET', path, token: c.token, fetchImpl: ctx.fetchImpl })) as typeof got;
      break;
    } catch (e) {
      if (!is403(e)) throw e;
      refused.add(c.name);
    }
  }
  if (!got) throw refusal(siteId, 'read settings', [...refused], ctx);
  const current = got.settings ?? {};
  const from = typeof current.locale === 'string' ? current.locale : null;
  if (from === locale) return { from, to: locale, unchanged: true };
  if (dryRun) return { from, to: locale };

  // The whole body with EVERY credential before the locale-only one: a session
  // that may write settings keeps the safe door open where the key alone would
  // have taken the merge.
  const bodies = [{ settings: { ...current, locale } }, { settings: { locale } }];
  for (const body of bodies) {
    for (const c of creds) {
      try {
        await request({ base: ctx.base, method: 'PUT', path, token: c.token, body, fetchImpl: ctx.fetchImpl });
        return { from, to: locale };
      } catch (e) {
        if (!is403(e)) throw e;
        refused.add(c.name);
      }
    }
  }
  throw refusal(siteId, 'write settings.locale', [...refused], ctx);
}

function refusal(siteId: string, what: string, refused: string[], ctx: ToolContext): Error {
  return new Error(
    `sbuilder: 403 — the platform refused to ${what} on ${siteId} with ${refused.join(' and ')}` +
      (ctx.apiKey && !ctx.session.loggedIn() ? ' (no session to try: set SB_EMAIL/SB_PASSWORD)' : '') +
      '. The whole-settings write needs settings permission; a locale-only write needs ' +
      'pages.write on a platform that has it. Nothing was changed.',
  );
}

export function registerThemeTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'sb_theme',
    {
      description:
        "The site's palette and type scale — the layer every element's style preset resolves " +
        'from, so one token repaints every page at once. Call it with nothing to read what the ' +
        'site actually has. `colors` and `text_styles` PATCH the saved document: what you do not ' +
        'name is kept. `locale` sets the site\'s language (settings.locale, what <html lang> is ' +
        'served from) — site-wide, every other setting kept.',
      inputSchema: {
        site_id: z.string().optional(),
        colors: z
          .record(z.string())
          .optional()
          .describe('Token id -> CSS colour, e.g. { "heading": "#2E2A3B", "primary": "#E8557A" }'),
        text_styles: z
          .record(z.record(z.string()))
          .optional()
          .describe('Text style slug -> base declarations, e.g. { "h1": { "fontSize": "48px" } }'),
        locale: z.string().optional().describe('Site language tag, e.g. "vi" or "en"'),
        dry_run: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ site_id: given, colors, text_styles, locale, dry_run }) => {
      const site_id = siteFor(ctx, given);
      if (locale && !colors && !text_styles) {
        const lang = { locale: await setLocale(ctx, site_id, locale, dry_run !== false) };
        return text({
          ...(dry_run !== false && !lang.locale?.unchanged ? { dry_run: true } : {}),
          ...lang,
          on: site_id,
        });
      }
      const { theme, origin } = await readTheme(ctx, site_id);

      // READ. What the site actually paints from, which is what rule 0 wants
      // before anything is decided.
      if (!colors && !text_styles) {
        return text({
          origin:
            origin === 'site'
              ? 'this site, saved'
              : 'the STARTER theme — this site has never saved one, so this is what it renders ' +
                'with and what a first write would be built from',
          version: theme.version,
          colors: Object.fromEntries((theme.colors ?? []).map((c) => [c.id, c.value])),
          text_styles: Object.fromEntries(
            (theme.textStyles ?? []).map((t) => [t.slug, t.base ?? {}]),
          ),
          schemes: (theme.schemes ?? []).map((s) => s.id),
          presets: (theme.presets ?? []).length,
          note: ctx.notices.once(
            'theme_leverage',
            'A style preset compiles to a class rule BENEATH a node\'s own values, so every node ' +
              'that has not been given a literal follows these tokens. Changing one here is the ' +
              'cheapest way to restyle a whole site — and a literal written with sb_set detaches ' +
              'that node from it permanently.',
          ),
        });
      }

      // PATCH. Unknown ids are REFUSED rather than added: a token nothing
      // resolves from is a value the platform stores and no renderer reads,
      // which is the silent-failure family this server exists to close — and a
      // typo would land there rather than on the colour the caller meant.
      const changes: Array<{ what: string; from: string; to: string }> = [];
      const known = new Set((theme.colors ?? []).map((c) => c.id));
      const unknown = Object.keys(colors ?? {}).filter((id) => !known.has(id));
      if (unknown.length) {
        throw new Error(
          `sbuilder: no colour token named ${unknown.map((u) => JSON.stringify(u)).join(', ')} on ` +
            `this site. Its tokens are: ${[...known].join(', ')}. Every style preset resolves ` +
            'through these ids, so a new one would be stored and read by nothing.',
        );
      }
      for (const [id, value] of Object.entries(colors ?? {})) {
        const token = theme.colors.find((c) => c.id === id)!;
        if (token.value === value) continue;
        changes.push({ what: `colors.${id}`, from: token.value, to: value });
        token.value = value;
      }

      const slugs = new Set((theme.textStyles ?? []).map((t) => t.slug));
      const badSlugs = Object.keys(text_styles ?? {}).filter((s) => !slugs.has(s));
      if (badSlugs.length) {
        throw new Error(
          `sbuilder: no text style named ${badSlugs.map((b) => JSON.stringify(b)).join(', ')} on ` +
            `this site. Its slugs are: ${[...slugs].join(', ')}. A preset names a style by SLUG ` +
            'and the compiled --wb-ts-<slug>-<prop> variables are built from it.',
        );
      }
      for (const [slug, decls] of Object.entries(text_styles ?? {})) {
        const style = theme.textStyles.find((t) => t.slug === slug)!;
        style.base = style.base ?? {};
        for (const [prop, value] of Object.entries(decls)) {
          const before = style.base[prop] ?? '(unset)';
          if (before === value) continue;
          changes.push({ what: `textStyles.${slug}.${prop}`, from: before, to: value });
          style.base[prop] = value;
        }
      }

      // THE LOCALE IS WRITTEN LAST — after every check and after the theme PUT —
      // so a refused token, an empty theme or a failed theme write leaves the
      // site exactly as it was rather than half-changed.
      const writeLocale = async (dry: boolean) =>
        locale ? { locale: await setLocale(ctx, site_id, locale, dry) } : {};
      if (!changes.length) {
        return text({ unchanged: true, ...(await writeLocale(dry_run !== false)), note: 'Every value named already holds that value.' });
      }
      // The document goes back WHOLE, so this can only ever be true — asserted
      // anyway, because the one failure this endpoint cannot take back is a
      // theme with nothing in it.
      if (!theme.colors?.length || !theme.presets?.length) {
        throw new Error('sbuilder: refusing to save a theme with no colours or no presets.');
      }

      if (dry_run !== false) {
        const lang = await writeLocale(true);
        return text({
          dry_run: true,
          would_change: changes,
          ...lang,
          on: site_id,
          built_from: origin === 'site' ? "this site's saved theme" : 'the starter theme',
          note:
            'Nothing was sent. This is SITE-WIDE: every page, and every node that has not been ' +
            'given a literal of its own. Re-call with dry_run:false.',
        });
      }
      await request({
        base: ctx.base,
        method: 'PUT',
        path: `/api/sites/${encodeURIComponent(site_id)}/theme`,
        token: siteToken(ctx),
        body: { theme },
        fetchImpl: ctx.fetchImpl,
      });
      // `siteTheme`'s process-wide cache (`theme-fetch.ts`) would otherwise
      // keep answering with the PRE-patch theme, and `sb_node_read`'s preset
      // resolution reads through it — the next call in this session would
      // report the colour this write just replaced as what a node paints.
      clearThemeCache();
      let lang: Awaited<ReturnType<typeof writeLocale>>;
      try {
        lang = await writeLocale(false);
      } catch (e) {
        throw new Error(`sbuilder: the theme WAS saved; only the locale was not: ${(e as Error).message.replace(/^sbuilder: /, '')}`);
      }
      return text({
        changed: changes,
        ...lang,
        on: site_id,
        next:
          'Republish the pages that should show it — a theme is compiled into each page\'s ' +
          'stylesheet, so a saved page keeps the old palette until it is published again.',
      });
    },
  );
}
