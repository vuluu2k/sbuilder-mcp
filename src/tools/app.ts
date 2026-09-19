/**
 * `sb_store action:"app"` — INSTALL A BUILT-IN APP, AND BUILD THE PAGES IT
 * NEEDS THAT INSTALLING IT DOES NOT.
 *
 * `POST /api/sites/{siteId}/builtin-apps/{key}` turns an app ON and stops
 * there — it is one fact ("this store turned Courses on"), not a page
 * builder. `/courses/{slug}` resolves through the `course` page type's
 * DEFAULT TEMPLATE (server/internal/page.PublishedForEntity), so a caller
 * that installs `courses`, writes a curriculum and publishes gets a 404 for
 * the course's own address, with nothing anywhere naming the page that was
 * supposed to be built first.
 *
 * `editor/src/features/builtinapps/pageScaffold.ts`'s `scaffoldAppPages` is
 * the platform's own answer, run right after a successful install — and
 * `APP_SCAFFOLDS` (read off it at codegen, `appscaffolds.generated.ts`) is
 * this server's copy of what it builds. `isPresent`'s rule, copied here for
 * write for write: a page with a non-empty `slug` is present if the site
 * has that SLUG (whatever its type); a page with an EMPTY slug is a
 * TEMPLATE — reached by an entity URL rather than an address of its own —
 * and is present if the site has ANY page of that TYPE, because a second one
 * would just sit there unreachable behind the first.
 *
 * PER-PAGE FAILURE IS NON-FATAL, the editor's own rule: the app IS installed
 * by the time page creation runs, so throwing on one failed page would
 * report a failed install that actually succeeded, and a caller who then
 * retries finds the install already there — the second call is a no-op, so
 * nothing is duplicated by trying again.
 *
 * THE LIST IS RE-CHECKED AS IT GROWS: two scaffold pages could otherwise both
 * find "no page of this type yet" true against the SAME stale list and both
 * get created, which is exactly the "a second one just sits there
 * unreachable" shape `isPresent` exists to prevent.
 *
 * `slug` IS SENT ONLY WHEN NON-EMPTY — the editor's own reasoning, named in
 * `ScaffoldPage`'s doc comment: sending `''` would ask the server to claim
 * the empty slug, which is not what an empty slug means here.
 */
import { request, redact } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import type { ToolContext } from './context.js';
import type { PageSession } from './page.js';
import { APP_SCAFFOLDS } from '../catalog/appscaffolds.generated.js';

interface Step {
  step: number;
  what: string;
  method: string;
  path: string;
  body?: unknown;
}

interface AppScaffoldPage {
  slug: string;
  type: string;
  name: { vi: string; en: string };
  document: { schema_version: number; root_node_id: string; nodes: Record<string, unknown> };
}

interface SitePage {
  id: string;
  slug: string;
  type: string;
}

/** `isPresent`, copied from `editor/src/features/builtinapps/pageScaffold.ts`. */
function isPresent(spec: { slug: string; type: string }, pages: SitePage[]): boolean {
  if (spec.slug !== '') return pages.some((p) => p.slug === spec.slug);
  return pages.some((p) => p.type === spec.type);
}

function pageBody(spec: AppScaffoldPage, lang: 'vi' | 'en'): Record<string, unknown> {
  return {
    name: spec.name[lang],
    ...(spec.slug ? { slug: spec.slug } : {}),
    type: spec.type,
    document: spec.document,
  };
}

export async function installApp(
  ctx: ToolContext,
  _session: PageSession,
  siteId: string,
  key: string,
  opts: { language: 'vi' | 'en'; dryRun: boolean },
): Promise<unknown> {
  const site = encodeURIComponent(siteId);
  const send = async <T>(method: string, path: string, body?: unknown): Promise<T> =>
    (await request({
      base: ctx.base,
      method,
      path,
      token: siteToken(ctx),
      body,
      fetchImpl: ctx.fetchImpl,
    })) as T;

  const specs = (APP_SCAFFOLDS[key] ?? []) as AppScaffoldPage[];

  if (opts.dryRun) {
    const steps: Step[] = [
      {
        step: 1,
        what: `install the "${key}" app`,
        method: 'POST',
        path: `/api/sites/${site}/builtin-apps/${encodeURIComponent(key)}`,
      },
    ];
    // A dry run reads the page list too — the same one call `sb_store
    // action:"chrome"` makes before planning its menu — so the plan can say
    // which of the scaffold's pages are already there rather than guess.
    let existing: SitePage[] = [];
    try {
      const got = await send<{ pages?: SitePage[] }>('GET', `/api/sites/${site}/pages`);
      existing = got.pages ?? [];
    } catch {
      existing = [];
    }
    let n = 2;
    const missing = specs.filter((s) => !isPresent(s, existing));
    for (const spec of missing) {
      steps.push({
        step: n++,
        what: `create the ${spec.type} page "${spec.name[opts.language]}"` +
          (spec.slug ? ` at /${spec.slug}` : ' — a TEMPLATE, no slug of its own'),
        method: 'POST',
        path: `/api/sites/${site}/pages`,
        body: pageBody(spec, opts.language),
      });
    }
    return {
      dry_run: true,
      plan: redact(steps),
      present: specs.filter((s) => isPresent(s, existing)).map((s) => s.name[opts.language]),
      note: specs.length
        ? 'Nothing was sent. Re-call with dry_run:false to install and create the missing pages.'
        : `Nothing was sent. "${key}" has no page scaffold — installing it is the whole flow.`,
    };
  }

  const installed = await send<{ builtinApp?: { key?: string } }>(
    'POST',
    `/api/sites/${site}/builtin-apps/${encodeURIComponent(key)}`,
  );
  if (installed.builtinApp?.key !== key) {
    throw new Error(
      `sbuilder: the platform accepted installing "${key}" and returned no matching app`,
    );
  }

  const got = await send<{ pages?: SitePage[] }>('GET', `/api/sites/${site}/pages`);
  const pages: SitePage[] = [...(got.pages ?? [])];

  const created: string[] = [];
  const present: string[] = [];
  const failed: Array<{ page: string; why: string }> = [];

  for (const spec of specs) {
    if (isPresent(spec, pages)) {
      present.push(spec.name[opts.language]);
      continue;
    }
    try {
      const made = await send<{ page?: { id?: string; slug?: string; type?: string } }>(
        'POST',
        `/api/sites/${site}/pages`,
        pageBody(spec, opts.language),
      );
      if (!made.page?.id) {
        throw new Error('the platform accepted the page create and returned no page');
      }
      pages.push({
        id: made.page.id,
        slug: typeof made.page.slug === 'string' ? made.page.slug : spec.slug,
        type: typeof made.page.type === 'string' ? made.page.type : spec.type,
      });
      created.push(spec.name[opts.language]);
    } catch (e) {
      failed.push({
        page: spec.name[opts.language],
        why: (e as Error).message.replace(/^sbuilder:\s*/, '').slice(0, 160),
      });
    }
  }

  return {
    installed: key,
    created,
    present,
    ...(failed.length ? { failed } : {}),
  };
}
