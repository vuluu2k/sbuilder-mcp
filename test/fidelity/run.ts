/**
 * THE RULER. Reads real pages, builds each one, photographs both, scores.
 *
 * Not part of the gate: it needs the network, a browser and (in FULL mode) a
 * live site. Run it on demand — `SB_FIDELITY=1 npx tsx test/fidelity/run.ts`,
 * or `SB_FIDELITY_OFFLINE=1` for the mode below — and commit the baseline it
 * writes.
 *
 * Every line of output is `console.error`. This file is not the MCP server, but
 * the rule is the repo's and a script that breaks it teaches the next reader
 * that the rule is soft.
 *
 * TWO OF THE THREE SCORES NEED NO SITE. `content` comes straight off
 * `capture()`; `structure` needs `capture()` plus the pure mapper (`toSpecs`).
 * Only `visual` needs a rendered page to diff against, and that render is what
 * needs a live storefront to create a scratch page on. `SB_FIDELITY_OFFLINE=1`
 * runs the first two and skips everything downstream of the create — no page,
 * no save, no shoot, no diff, no cleanup — so a baseline can exist in an
 * environment where writing to a live site is refused. `visual` is left
 * ABSENT on those rows rather than reported as some placeholder number:
 * `scoreboard.ts`'s `compareBaseline` already knows to skip a metric neither
 * side has, and a 0 would read as a perfect pixel match that was never
 * measured.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildContext } from '../../src/server.js';
import { callOperation } from '../../src/tools/api.js';
import { capture } from '../../src/vision/capture.js';
import { toSpecs, tokensFromPage } from '../../src/domains/site/importmap.js';
import { addSubtree } from '../../src/domains/site/builder.js';
import { middleEnd } from '../../src/domains/site/traps.js';
import { PageSession } from '../../src/tools/page.js';
import { shoot, closeBrowser } from '../../src/vision/shoot.js';
import { previewUrl } from '../../src/vision/preview.js';
import { diffImages, closeDiffBrowser } from '../../src/vision/imagediff.js';
import { shapeOf, shapeDistance } from '../../src/domains/site/shape.js';
import { compareBaseline, type Baseline, type PageScore } from '../../src/domains/site/scoreboard.js';
import type { Patch } from '../../src/core/patch.js';
import type { DocLike } from '../../src/core/tree.js';

/**
 * There is no scratch page to read tokens off in offline mode — nothing was
 * created. An empty document is the documented fallback for "no target page":
 * `tokensFromPage` finds no heading, text, button or section to read and
 * answers `{}`, the same as opening this tool against a genuinely blank page.
 */
const EMPTY_DOC: DocLike = { schema_version: 2, root_node_id: 'root', nodes: {} };

const HERE = resolve(import.meta.dirname);
const BASELINE = resolve(HERE, 'baseline.json');

interface Fixture {
  url: string;
  note: string;
}

const slugFor = (url: string): string =>
  `zz-fidelity-${url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '').slice(0, 40).toLowerCase()}`;

async function main(): Promise<void> {
  const offline = process.env.SB_FIDELITY_OFFLINE === '1';
  if (!offline && process.env.SB_FIDELITY !== '1') {
    console.error(
      'refusing to run: this writes pages to a live site. Set SB_FIDELITY=1 to mean it, ' +
        'or SB_FIDELITY_OFFLINE=1 to score content and structure only, touching no site.',
    );
    process.exit(2);
  }
  const { widths, pages } = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8')) as {
    widths: number[];
    pages: Fixture[];
  };
  const ctx = buildContext();
  // Declared as a definite `string`, never read in offline mode, so the guard
  // below is the only place it is narrowed — the online-only code further
  // down can rely on it without TypeScript losing that narrowing across the
  // loop boundary in between.
  let siteId = '';
  // Both guards below are for the FULL path alone — offline mode creates no
  // page and deletes nothing, so it needs neither credential.
  if (!offline) {
    if (!ctx.siteId) {
      console.error('refusing to run: SB_SITE names no site.');
      process.exit(2);
    }
    siteId = ctx.siteId;
    // BEFORE THE FIRST CREATE, not near cleanup — the point is nothing exists to
    // leak. Create is siteScoped (session or key); the only page delete this
    // platform has is on /api/v1, gated on an API key alone (credentialFor in
    // src/transport/credential.ts). A session-only install would create every
    // scratch page fine and then fail every delete — logged by the `.catch`
    // below, not thrown — leaving them on the live storefront.
    if (!ctx.apiKey) {
      console.error('refusing to run: cleanup deletes through /api/v1, which needs SB_TOKEN set to an API key.');
      process.exit(2);
    }
  }

  const scores: PageScore[] = [];
  // EVERY id this run created, so cleanup deletes what it made and nothing
  // else. Never a slug scan. Stays empty in offline mode — nothing is ever
  // created — so the cleanup loop in the `finally` below is a correct no-op.
  const created: string[] = [];
  try {
    for (const fx of pages) {
      try {
        const shotSource = await capture(fx.url);
        if (offline) {
          const specs = toSpecs(shotSource.sections, tokensFromPage(EMPTY_DOC));
          const structure = shapeDistance(shapeOf(shotSource.sections), shapeOf(specs));
          for (const width of widths) {
            scores.push({ url: fx.url, width, content: shotSource.coverage, structure, mode: 'offline' });
            console.error(
              `${fx.url} @${width}  content ${shotSource.coverage}%  structure ${structure}  ` +
                '(visual not measured — offline mode never rendered a page to diff)',
            );
          }
          continue;
        }
        const made = (await callOperation(ctx, {
          id: 'post:/api/sites/{siteId}/pages',
          body: { name: slugFor(fx.url), slug: slugFor(fx.url), type: 'page' },
          dry_run: false,
        })) as { page?: { id?: string }; id?: string };
        const pageId = made.page?.id ?? made.id;
        if (!pageId) {
          // The POST answered 200 and named no id to clean up by — `created` never
          // gets it, so the `finally` below cannot delete it either. Unlikely
          // (`src/tools/page.ts`'s create answers `{ page: { id, slug } }` and no
          // projection layer here can strip it) but not impossible, so the message
          // is the fix: it names the slug this run asked for, because that is the
          // only handle left to find the page by on the live site.
          throw new Error(
            `the create answered but named no page id — a page may exist as ${slugFor(fx.url)} ` +
              'on the live site; find it and delete it by hand',
          );
        }
        created.push(pageId);

        const session = new PageSession(ctx);
        await session.open(siteId, pageId);
        const doc = session.current();
        const specs = toSpecs(shotSource.sections, tokensFromPage(doc.doc));
        const all: Patch[] = [];
        const staged = doc.preview([]);
        for (const spec of specs) {
          const { patches } = addSubtree(staged, staged.doc.root_node_id, spec, middleEnd(staged.doc));
          staged.apply(patches);
          all.push(...patches);
        }
        await session.applyAndSave(all);

        const preview = await previewUrl(ctx, siteId, pageId);
        const [srcShots, builtShots] = await Promise.all([
          shoot(fx.url, { widths, format: 'png' }),
          shoot(preview, { widths, format: 'png' }),
        ]);

        const built = shapeOf(specs);
        const source = shapeOf(shotSource.sections);
        for (let i = 0; i < widths.length; i += 1) {
          const diff = await diffImages(srcShots[i], builtShots[i]);
          scores.push({
            url: fx.url,
            width: widths[i],
            visual: diff.differing,
            content: shotSource.coverage,
            structure: shapeDistance(source, built),
            mode: 'full',
          });
          console.error(
            `${fx.url} @${widths[i]}  visual ${diff.differing}%  content ${shotSource.coverage}%  ` +
              `structure ${shapeDistance(source, built)}`,
          );
        }
      } catch (e) {
        console.error(`${fx.url} FAILED: ${(e as Error).message}`);
      }
    }
  } finally {
    // ONLY what this run made, and in a finally so a thrown page does not leave
    // scratch pages on a live site.
    //
    // The site-scoped surface has NO page delete at all — the catalog's only
    // one is `delete:/api/v1/pages/{id}`, the PARTNER surface, gated on
    // `apiKey` alone (credentialFor in src/transport/credential.ts). The guard
    // above already refused to run without SB_TOKEN, so this loop is not the
    // caller's only defence — but the `.catch` stays: one failed delete must
    // never stop the rest.
    for (const id of created) {
      await callOperation(ctx, {
        id: 'delete:/api/v1/pages/{id}',
        path_params: { id },
        dry_run: false,
      }).catch((e: Error) => console.error(`could not delete ${id}: ${e.message}`));
    }
    // `capture()` opens and closes its own browser per call (see
    // src/vision/capture.ts's withBrowser) — there is no closeCaptureBrowser to
    // call here, unlike shoot.ts's pooled browser and imagediff.ts's shared one.
    await Promise.all([closeDiffBrowser(), closeBrowser()]);
  }

  // A run where every fixture failed still reaches here — the per-fixture
  // `catch` above is what lets ONE bad fixture cost one row instead of the
  // whole run, and that is correct. But writing THIS out would overwrite a
  // good baseline with an empty one and still exit 0, so the next person sees
  // a fresh timestamp, a blank scoreboard and success. A PARTIAL run (some
  // fixtures failed, not all) is not this case and must stay allowed:
  // `compareBaseline` already reports a missing row as `removed`, by design.
  if (scores.length === 0) {
    console.error('\nevery fixture failed — refusing to write an empty baseline over a real one');
    process.exit(1);
  }

  if (offline) {
    console.error(
      '\noffline run: visual was NOT measured. It needs a rendered page to diff against, and building ' +
        'one needs a live site — set SB_FIDELITY=1 (with SB_SITE and SB_TOKEN) for a full run.',
    );
  }

  const next: Baseline = { generated: new Date().toISOString(), scores };
  if (existsSync(BASELINE)) {
    const prev = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
    const cmp = compareBaseline(prev, next);
    console.error(`\nagainst the baseline: ${cmp.improvements.length} better, ${cmp.regressions.length} worse`);
    for (const m of cmp.regressions) {
      console.error(`  WORSE  ${m.url} @${m.width} ${m.metric}: ${m.was} -> ${m.now}`);
    }
    for (const m of cmp.improvements) {
      console.error(`  better ${m.url} @${m.width} ${m.metric}: ${m.was} -> ${m.now}`);
    }
    for (const k of cmp.added) console.error(`  new    ${k}`);
    for (const k of cmp.removed) console.error(`  gone   ${k}`);
  }
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
  console.error(`\nwrote ${BASELINE}`);
}

await main();
