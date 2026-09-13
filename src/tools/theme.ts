import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { request } from '../transport/http.js';
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

export function registerThemeTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'sb_theme',
    {
      description:
        "The site's palette and type scale — the layer every element's style preset resolves " +
        'from, so one token repaints every page at once. Call it with nothing to read what the ' +
        'site actually has. `colors` and `text_styles` PATCH the saved document: what you do not ' +
        'name is kept.',
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
        dry_run: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ site_id: given, colors, text_styles, dry_run }) => {
      const site_id = siteFor(ctx, given);
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

      if (!changes.length) {
        return text({ unchanged: true, note: 'Every value named already holds that value.' });
      }
      // The document goes back WHOLE, so this can only ever be true — asserted
      // anyway, because the one failure this endpoint cannot take back is a
      // theme with nothing in it.
      if (!theme.colors?.length || !theme.presets?.length) {
        throw new Error('sbuilder: refusing to save a theme with no colours or no presets.');
      }

      if (dry_run !== false) {
        return text({
          dry_run: true,
          would_change: changes,
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
      return text({
        changed: changes,
        on: site_id,
        next:
          'Republish the pages that should show it — a theme is compiled into each page\'s ' +
          'stylesheet, so a saved page keeps the old palette until it is published again.',
      });
    },
  );
}
