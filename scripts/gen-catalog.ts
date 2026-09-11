/**
 * Emit src/catalog/api.generated.ts from a web_builder checkout's OpenAPI
 * document.
 *
 * WHY A BUILD STEP AND NOT A RUNTIME FETCH: server/docs/swagger.json is itself a
 * generated, committed artifact in that repo (`npm run docs:api` from swaggo
 * annotations). Reading it at build time couples this repo to a maintained DATA
 * FILE rather than to a moving codebase — which is the whole reason a separate
 * repository works here at all.
 *
 * Run: WB_REPO=/path/to/web_builder npm run codegen
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { buildRequestShapes } from './shapes.js';
import { credentialFor } from '../src/transport/credential.js';
import type { ApiOperation, ApiParam } from '../src/catalog/types.js';
import type { CatalogElement, NodeSeed, SatelliteRule, TraitDescription } from '../src/catalog/element-types.js';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface SwaggerParam {
  name?: string;
  in?: string;
  required?: boolean;
  type?: string;
  description?: string;
  schema?: { $ref?: string; items?: { $ref?: string } };
}

function refName(ref: string | undefined): string | null {
  if (!ref) return null;
  const m = /^#\/definitions\/(.+)$/.exec(ref);
  return m ? m[1] : null;
}

/**
 * Read an element's inspector as a human sees it: tabs → groups → controls.
 *
 * `meta.traits` is either a legacy flat `string[]` or the real structure —
 * `{ general: [...], advanced: [...] }`, each entry a GROUP with a `key`, a
 * `label` and an **`attributes`** array whose items are the actual control keys
 * (a bare string, or `{ key, group?, visible? }`).
 *
 * The first version of this function recursed into `items`/`widgets`/`groups`
 * and never touched `attributes`, so it collected GROUP keys and stopped:
 * `heading` reported nine section headers (`size`, `typography`, `seo`, …)
 * instead of its twenty-four controls. The catalog was describing the
 * inspector's headings rather than its inspector, and nothing said so — the
 * output was a plausible list of plausible words.
 */
function readInspector(traits: unknown): {
  tabs: Array<{ tab: string; groups: Array<{ key: string; label: string; controls: string[] }> }>;
  controls: string[];
} {
  const controls = new Set<string>();
  const tabs: Array<{ tab: string; groups: Array<{ key: string; label: string; controls: string[] }> }> = [];

  const readControls = (attributes: unknown): string[] => {
    const out: string[] = [];
    for (const a of Array.isArray(attributes) ? attributes : []) {
      if (typeof a === 'string') out.push(a);
      else if (a && typeof a === 'object' && typeof (a as { key?: unknown }).key === 'string') {
        // `visible: false` controls exist but are not rendered as a row; they are
        // still the element's own keys, so they belong in the list with the flag
        // dropped rather than being hidden from an agent too.
        out.push((a as { key: string }).key);
      }
    }
    for (const c of out) controls.add(c);
    return out;
  };

  // Legacy flat form: a bare list of control keys, no tabs.
  if (Array.isArray(traits)) {
    const flat = readControls(traits);
    return { tabs: flat.length ? [{ tab: 'general', groups: [{ key: 'general', label: 'General', controls: flat }] }] : [], controls: [...controls] };
  }

  const t = (traits ?? {}) as Record<string, unknown>;
  for (const tab of ['general', 'advanced']) {
    const groups = Array.isArray(t[tab]) ? (t[tab] as unknown[]) : [];
    const read = groups
      .map((g) => {
        const o = (g ?? {}) as { key?: string; label?: string; attributes?: unknown };
        return { key: o.key ?? '', label: o.label ?? o.key ?? '', controls: readControls(o.attributes) };
      })
      .filter((g) => g.key);
    if (read.length) tabs.push({ tab, groups: read });
  }
  return { tabs, controls: [...controls] };
}

/**
 * DOC_SCHEMA_VERSION lives in an EDITOR module, not the schema package, so it is
 * read with a regex rather than imported — importing it would drag Vue into a
 * build script for a single integer.
 */
/**
 * WHERE AN ELEMENT'S `hover` STATE HAS TO BE WRITTEN, per type.
 *
 * There is no single home, and assuming there was is the mistake this table
 * closes. Twelve element types declare a Hover variant of their own, and the
 * platform's universal hover state (`schema/src/hoverState.ts`) deliberately
 * stands aside for all of them — so on those twelve, `states.hover` is written
 * by nobody's compiler unless the element's own pipeline reads it.
 *
 * The meta says which, in one field, and it is the field to trust:
 *
 *   storage: 'node'   →  node.states.hover, compiled by the element's own CSS
 *                        (a filter's option skin, a satellite's skin through its
 *                        OWNER). Nothing to route — write the state slot.
 *   (no storage)      →  config.stateHover, a FLAT, BASE-ONLY style map that the
 *                        element's own css.go compiles into its `:hover` rule.
 *                        This is where the editor puts a hover edit for these,
 *                        deliberately: "a hover edit on a button must go on
 *                        being the button's :hover rule" (editor trait/values.ts).
 *
 * MEASURED before this existed, on one publish of one page: `state:"hover"` on a
 * product card's dataset-block emitted `@media (hover:hover){#card:hover{…}}`;
 * the identical write on the BUTTON inside it emitted nothing at all. Writing the
 * same values to `config.stateHover` produced `#btn:hover{background-color:…}`
 * on the next publish. Every hover this server had written onto a button was
 * stored where no compiler looks.
 *
 * Derived from `storage` rather than from grepping the Go renderers, which is
 * the mistake the first draft of this function made: it concluded that no
 * element compiles `states.hover` because none names it directly, and missed
 * that the filters and text-dataset reach it through shared helpers. A probe
 * that rendered one node per type and looked for the value in the bundle is what
 * corrected it — and is why `product-image-list` is flagged below rather than
 * assumed well.
 */
function readHoverHomes(
  types: string[],
  registry: { ELEMENTS: Record<string, { states?: unknown }> },
): Record<string, { home: 'legacy' | 'state' }> {
  const out: Record<string, { home: 'legacy' | 'state' }> = {};
  for (const type of types) {
    const states = registry.ELEMENTS[type]?.states as
      | { variants?: Array<{ value?: string }>; storage?: string }
      | undefined;
    if (!states?.variants?.some((v) => v?.value === 'hover')) continue; // universal state serves it
    out[type] = { home: states.storage === 'node' ? 'state' : 'legacy' };
  }
  // Twelve at the 2026-09-09 regen, five of them on the legacy map. A table that
  // silently empties would route every hover back through the universal state
  // and re-open the defect this closes.
  if (Object.keys(out).length < 8) {
    console.error(`only ${Object.keys(out).length} elements declare a Hover variant — is WB_REPO stale?`);
    process.exit(1);
  }
  return out;
}

function readDocSchemaVersion(repo: string): number {
  const src = readFileSync(resolve(repo, 'editor/src/theme/legacyScopes.ts'), 'utf8');
  const m = /export const DOC_SCHEMA_VERSION\s*=\s*(\d+)/.exec(src);
  if (!m) {
    console.error('DOC_SCHEMA_VERSION not found in editor/src/theme/legacyScopes.ts');
    process.exit(1);
  }
  return Number(m[1]);
}

/**
 * CONFIG KEYS THE PUBLISH PATH READS FROM BASE ONLY.
 *
 * A node's `config` is per-breakpoint only where the renderer reads it through
 * the MERGED namespace. `css.go` does — `cfgPx(cfg, key)` inside the breakpoint
 * loop. `html.go` does NOT: `nodes.ConfigInt` and `ConfigString`
 * (`render/nodes/helpers.go:1421,1433`) index `node.Config[key]` directly. One
 * HTML document serves all three widths, so anything an `html.go` decides can
 * only come from base.
 *
 * WHY THIS MATTERS HERE: `setKeys` writes config per breakpoint unless the
 * caller passes `base`, because a design should respond. For these keys that
 * default is silently wrong — the value updates the editor canvas and vanishes
 * on publish, with no error at any step. The platform's own ledger names the
 * consequence: mobile seeds for `icon` iconSize, `text-dataset`
 * descriptionLines and `media-dataset` layout all shipped and all had to be
 * reverted.
 *
 * The worst of them is the DATA AXIS, which this repo has already fixed once
 * from the other side. `datasetSource`, `kind`, `collectionId` and
 * `collectionType` are all on the list, and `rebindPatch` writes the derived
 * bindings at NODE level. So `sb_set config {datasetSource:"category"}` without
 * `base` used to leave the bindings saying category and the config saying
 * nothing the renderer reads — `dataset-block/html.go` reads base and still says
 * product. Both halves reported success. That is the same defect CLAUDE.md
 * records under "THE DATA AXIS OF A REPEATER WAS UNREACHABLE THROUGH EITHER
 * TOOL", re-entering through the breakpoint layer instead of the kind axis.
 *
 * READ FROM THE PLATFORM, not hand-kept. `schema/test/responsive-defaults.test.ts`
 * maintains `BASE_ONLY_CONFIG` as a deliberate MIGRATION LEDGER — its own comment
 * says the list may SHRINK as each key moves to a per-breakpoint CSS var, and
 * that any addition fails the platform's build. A copy here would drift in the
 * one direction that matters: a key the platform FIXED would keep being forced
 * to base, quietly costing the responsive answer this server exists to write.
 *
 * Read by regex, for the reason `DOC_SCHEMA_VERSION` is: importing a vitest file
 * would drag the platform's test runner into a build script for two string sets.
 *
 * EXCEPTIONS are per `type:key`, not per key, and are load-bearing rather than
 * pedantic. `quantity-button:iconSize` is genuinely responsive — the SATELLITE
 * css compiler emits it as the `--icon-size` var per breakpoint — so forcing it
 * to base would take a working per-breakpoint control away.
 */
function readBaseOnlyConfig(repo: string): { keys: string[]; exceptions: string[] } {
  const path = resolve(repo, 'schema/test/responsive-defaults.test.ts');
  const src = readFileSync(path, 'utf8');
  const setOf = (name: string, shape: RegExp): string[] => {
    const m = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(src);
    if (!m) {
      console.error(`${name} not found in schema/test/responsive-defaults.test.ts`);
      process.exit(1);
    }
    // STRIP THE COMMENTS FIRST. The ledger's reasoning lives in dense per-key
    // prose, and that prose is English: "order-history's row COUNT", "the
    // editor's own AccountRowLimitRow.vue". Matching quoted entries across it
    // pairs one apostrophe with the next and yields whole sentences as keys —
    // which this generator did, and wrote, and a reader had to catch by eye.
    const body = m[1].replace(/\/\/[^\n]*/g, '');
    const found = [...body.matchAll(/'([^'\n]+)'/g)].map((q) => q[1]);
    // A key is an identifier. Anything else means the ledger's format moved, and
    // a generator that shrugs at that writes a table nothing matches — silently,
    // which is the entire class of defect this table exists to prevent.
    const bad = found.filter((k) => !shape.test(k));
    if (bad.length) {
      console.error(
        `${name} in schema/test/responsive-defaults.test.ts parsed ${bad.length} entr(ies) ` +
          'that are not keys — the ledger format moved:',
      );
      for (const b of bad.slice(0, 5)) console.error(`  ${JSON.stringify(b)}`);
      process.exit(1);
    }
    return found;
  };
  const keys = setOf('BASE_ONLY_CONFIG', /^[A-Za-z][A-Za-z0-9_]*$/);
  const exceptions = setOf('EXCEPTIONS', /^[a-z][a-z0-9-]*:[A-Za-z][A-Za-z0-9_]*$/);
  if (keys.length === 0) {
    console.error('BASE_ONLY_CONFIG parsed as empty — the ledger format moved');
    process.exit(1);
  }
  return { keys, exceptions };
}

/**
 * The binding source keys the RENDERER provides, read out of the Go scope
 * builder. A `source` this list does not contain is a binding that resolves to
 * nothing and renders as the element's own placeholder — indistinguishable from
 * "the data has not loaded yet", which is the silent-failure class this repo
 * exists to close.
 */
function readBindingSources(repo: string): string[] {
  // TWO FILES, unioned, because neither is complete on its own.
  //
  // `scope.go` is the Go renderer's context; `schema/src/binding.ts` is the
  // editor's, and the editor's carries keys the Go regex never sees —
  // `product.moneyOverride`, `product.attributes`, `product.variations`. Reading
  // only the Go side made `sb_review` report the platform's OWN seeded
  // pricing binding as dead, on every pricing element of every page. A check
  // that cries wolf about correct output is worse than no check.
  const files = ['server/render/scope/scope.go', 'schema/src/binding.ts'];
  const found = new Set<string>();
  for (const rel of files) {
    let src = '';
    try {
      src = readFileSync(resolve(repo, rel), 'utf8');
    } catch {
      continue;
    }
    // SIX NAMESPACES, not four: `site`, `course` and `review` join the original
    // product/category/article/collection. Missing one made the review call a
    // seeded binding dead — currency-switcher ships `site.moneySwitch`.
    const ns = 'product|category|article|collection|site|course|review|instructor';
    for (const m of src.matchAll(new RegExp(`['"]((?:${ns})\\.[a-zA-Z]+)['"]`, 'g'))) {
      found.add(m[1]);
    }
  }
  if (found.size < 15) {
    console.error(`only ${found.size} binding sources found — have scope.go / binding.ts moved?`);
    process.exit(1);
  }
  return [...found].sort();
}

/**
 * Per element type, the `specials` keys its renderer reads FROM A BINDING.
 *
 * Read straight out of the Go renderers, one directory per element type, because
 * this is the fact that decides whether an element can show a record at all. A
 * `collection-media` reads `specials.boundImage`; a plain `image` reads only
 * `specials.src` and has no bound key anywhere in its renderer — so an `image`
 * dropped into a product repeater shows ONE authored picture in every row and
 * the product's own photo can never appear. That failure is invisible in the
 * document (the tree is perfectly well-formed) and invisible on a catalog
 * listing (both elements say "image"); the only place it is written down is the
 * renderer, so the renderer is what this reads.
 *
 * Hand-keeping the table was the alternative, and it is exactly the drifting
 * mapping the generated catalog exists to prevent.
 */
function readBoundSpecials(repo: string): Record<string, string[]> {
  const dir = resolve(repo, 'server/render/nodes');
  const out: Record<string, string[]> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const keys = new Set<string>();
    for (const f of readdirSync(resolve(dir, entry.name))) {
      if (!f.endsWith('.go') || f.endsWith('_test.go')) continue;
      const src = readFileSync(resolve(dir, entry.name, f), 'utf8');
      for (const m of src.matchAll(/"(bound[A-Za-z0-9]+)"/g)) keys.add(m[1]);
    }
    if (keys.size > 0) out[entry.name] = [...keys].sort();
  }
  if (Object.keys(out).length < 6) {
    console.error(
      `only ${Object.keys(out).length} elements read a bound special — have the renderers moved?`,
    );
    process.exit(1);
  }
  return out;
}

/**
 * The elements whose renderer clones only their FIRST child.
 *
 * `list-dataset` returns `n.Data.Nodes[0]` as the template it repeats per record
 * (`server/render/nodes/list-dataset/html.go:60`), so every sibling after the
 * first is valid, stores fine, and never reaches the published HTML.
 *
 * Read from the renderers rather than named here, for the same reason
 * BOUND_SPECIALS is: `dataset-block` is a dataset container too and renders ALL
 * of its children, so a hand-kept list would have restricted the wrong element
 * the first time someone reached for the obvious `isContainer && category ===
 * 'dataset'` predicate.
 */
function readFirstChildOnly(repo: string): string[] {
  const dir = resolve(repo, 'server/render/nodes');
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const f of readdirSync(resolve(dir, entry.name))) {
      if (!f.endsWith('.go') || f.endsWith('_test.go')) continue;
      const src = readFileSync(resolve(dir, entry.name, f), 'utf8');
      if (/\.Data\.Nodes\[0\]/.test(src)) {
        out.push(entry.name);
        break;
      }
    }
  }
  if (out.length === 0) {
    console.error('no renderer reads Data.Nodes[0] — have the renderers moved?');
    process.exit(1);
  }
  return out.sort();
}

/** A built node as the editor's factory returns it — ids and parents included. */
interface RawNode {
  id: string;
  data: { type: string; parent: string | null; nodes: string[] };
  style?: Record<string, unknown>;
  config?: Record<string, unknown>;
  specials?: Record<string, unknown>;
}

/**
 * The two empty-state owners whose source is fixed at the call site rather than
 * read from the node — `dataset-block` passes 'item', `cart-order` passes 'cart'
 * (each element's own editor/src/nodes entry). `list-dataset` is the one that varies.
 */
const FIXED_EMPTY_SOURCE: Record<string, string> = {
  'dataset-block': 'item',
  'cart-order': 'cart',
};

/**
 * CHECK MODE: does the committed catalog still match the platform?
 *
 * `npm run codegen` is a MANUAL step, so the catalog goes stale in silence. The
 * platform moves fast — 820 commits in the eleven days before 2026-09-07 — and
 * the first sign of a stale catalog is a tool describing an element the platform
 * renamed, or missing one it shipped. Measured in one afternoon: the element
 * count moved 107 → 108 and the operation count 484 → 485 while this repo sat
 * still.
 *
 * `npm run codegen -- --check` writes nothing and exits 1 naming every file that
 * would change, so drift is REPORTED rather than discovered. Two callers want
 * that: a person asking "is my catalog current?", and CI asking the same
 * question of a platform checkout it already has.
 */
const CHECK_ONLY = process.argv.includes('--check');
/** "wrote" is a lie in check mode, where nothing is written. */
const VERB = CHECK_ONLY ? 'checked' : 'wrote';
const drift: string[] = [];

/** Write the generated file, or in check mode record whether it would change. */
function emit(path: string, content: string): void {
  if (!CHECK_ONLY) {
    writeFileSync(path, content, 'utf8');
    return;
  }
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (current !== content) {
    const was = current.split('\n').length;
    const now = content.split('\n').length;
    drift.push(`${path.replace(process.cwd() + '/', '')} (${was} → ${now} lines)`);
  }
}

/** Called once at the end: in check mode, fail loudly and name what moved. */
function reportDrift(): void {
  if (!CHECK_ONLY) return;
  if (drift.length === 0) {
    console.error('catalog is current — no file would change');
    return;
  }
  console.error(
    `catalog is STALE against this web_builder checkout — ${drift.length} file(s) would change:`,
  );
  for (const d of drift) console.error(`  ${d}`);
  console.error('Run: WB_REPO=<checkout> npm run codegen');
  process.exit(1);
}


/**
 * THE SWAGGER DOCUMENT IS GENERATED TOO, AND UPSTREAM FORGETS TO RE-RUN IT.
 *
 * `sb_api_call` is a CLOSED LIST built from this catalog, which is built from
 * `server/docs/swagger.json` — and that file is itself the output of a MANUAL
 * `swag init`. So there are two staleness questions, not one, and `--check`
 * only ever asked the second:
 *
 *   is the catalog current against swagger.json?   ← reportDrift
 *   is swagger.json current against the ROUTES?    ← this
 *
 * The second failure is the worse one, because it is invisible from inside this
 * repo: every count agrees, `--check` says "catalog is current", and the
 * operation is simply absent from a list nobody can see the end of. CLAUDE.md
 * has recorded this happening twice. `swag init` was once un-run for long enough
 * to hide 44 operations, three of them the payment-gateway config a store needs
 * to switch a gateway on — reachable to a browser and to nothing else, for want
 * of a comment. It recorded the gap "closed, measured 2026-09-09: 486 = 486 =
 * 486", and told the reader to re-measure with three shell commands rather than
 * trust the number.
 *
 * Measured 2026-09-10, the day after: 490 annotated, 486 in the document. The
 * four were `GET /api/chat-providers` and `GET/PUT/DELETE
 * /api/sites/{siteId}/chat-settings` — every write that configures the AI chat
 * assistant, mounted and live, describable by nothing. A `chat-widget` element
 * had ALREADY shipped in the catalog, so an agent could add a chat launcher to a
 * page, publish it, and hand a merchant a storefront whose chat answers 404
 * (`chatbot/public/public.go:220` collapses "not configured" and "switched off"
 * into one), with no call anywhere in its reach that could turn it on.
 *
 * A three-command shell recipe in prose is what we had, and it is what a reader
 * skips. This asks the question on every run instead.
 *
 * It WARNS rather than refusing, and does not fail `--check`. The distinction is
 * the point: drift here is not fixable by `npm run codegen`, so failing the
 * check would leave a caller running the one command that cannot help. The fix
 * is upstream — `swag init` in web_builder, and commit `server/docs/` — so the
 * message names that instead.
 *
 * Duplicate annotations are real and must not be counted twice: the platform
 * stacks one doc block over several `@Router` lines, and `courses/rest/rest.go`
 * declares the same two enrollment routes in two blocks. A raw `grep | wc -l`
 * therefore over-counts, which is exactly how the prose recipe reads — take the
 * DISTINCT set instead.
 */
function reportUndocumentedRoutes(repo: string, spec: { paths: Record<string, unknown> }): void {
  const dir = resolve(repo, 'server/internal');
  if (!existsSync(dir)) return;

  // `@Router /api/sites/{siteId}/chat-settings [put]` — the path may carry any
  // number of `{param}` segments, and the method is the bracketed tail.
  const ROUTER = /@Router\s+(\S+)\s+\[([a-z]+)\]/g;
  // Two paths naming the same route differ only in what they call the
  // parameter: `{siteId}` here, `{siteID}` in swagger's own copy of the same
  // route. Compare on shape.
  const shape = (path: string, method: string): string =>
    `${method.toUpperCase()} ${path.replace(/\{[^}]*\}/g, '{}')}`;

  const annotated = new Map<string, string>();
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = resolve(d, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.name.endsWith('.go')) continue;
      const src = readFileSync(full, 'utf8');
      for (const m of src.matchAll(ROUTER)) {
        const key = shape(m[1], m[2]);
        if (!annotated.has(key)) annotated.set(key, `${m[2].toUpperCase()} ${m[1]}`);
      }
    }
  };
  walk(dir);

  const documented = new Set<string>();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of Object.keys(item as Record<string, unknown>)) {
      documented.add(shape(path, method));
    }
  }

  const missing = [...annotated.entries()]
    .filter(([key]) => !documented.has(key))
    .map(([, pretty]) => pretty)
    .sort();
  if (missing.length === 0) return;

  console.error(
    `warning: ${missing.length} route(s) are ANNOTATED in server/internal and absent from ` +
      `server/docs/swagger.json (${annotated.size} annotated, ${documented.size} documented). ` +
      'They are mounted and live, and this catalog cannot describe them — so sb_api_call, ' +
      'which is a closed list, cannot reach them at all:',
  );
  for (const line of missing.slice(0, 12)) console.error(`  ${line}`);
  if (missing.length > 12) console.error(`  …and ${missing.length - 12} more`);
  console.error(
    'Fix it UPSTREAM, not here — re-running codegen cannot recover a route the document ' +
      'does not carry:\n' +
      '  cd <web_builder>/server && swag init -g cmd/server/main.go -o docs \\\n' +
      '      --parseInternal --parseDependency --parseDepth 2\n' +
      '  git add docs && git commit   # then regenerate this catalog against that commit',
  );
}

/**
 * REFUSE A CHECKOUT SOMEBODY IS MID-EDIT IN.
 *
 * The catalog is COMMITTED, so whatever this script reads ships to every
 * install. Pointed at a working tree, it bakes in whatever a concurrent session
 * happens to have half-written — and the result looks exactly like a real
 * platform addition, because it is one, just not one that exists anywhere yet.
 *
 * This has now happened twice in this repo. A `bundle-items` element and its
 * relation-slot operations went in from one session; a `cart-count` element and
 * 193 lines around it went in from another, on the same day CLAUDE.md's warning
 * about it was being read aloud. Prose did not stop it either time, which is the
 * whole argument for a check: the failure is silent, the output is plausible,
 * and the person running codegen is by definition not the person editing.
 *
 * Scoped to the FOUR directories this script actually reads, so an unrelated
 * edit elsewhere in a big monorepo is not a reason to refuse. `--dirty` is the
 * deliberate override, for the one legitimate case: generating against a change
 * you are making yourself, to see what it would produce.
 */
function assertCommitted(repo: string): void {
  if (process.argv.includes('--dirty')) {
    console.error('warning: --dirty — reading a working tree, so half-finished work can ship');
    return;
  }
  const read = ['schema/src', 'editor/src', 'server/render', 'server/docs'];
  let out = '';
  try {
    out = execFileSync('git', ['-C', repo, 'status', '--porcelain', '--', ...read], {
      encoding: 'utf8',
    });
  } catch {
    return; // not a git checkout, or no git — nothing to assert against
  }
  const dirty = out.split('\n').filter(Boolean);
  if (dirty.length) {
    refuse('has uncommitted changes in', dirty);
  }

  // AND AN UNPUSHED COMMIT IS JUST AS ABSENT AS AN UNCOMMITTED EDIT.
  //
  // The first version of this check stopped at the working tree, and the hole
  // was exactly the size of the next thing that happened: a `hoverSwapImage`
  // feature sat COMMITTED on a local main, unpushed, so the tree was clean and
  // the guard waved it through. The catalog is published to npm and read against
  // DEPLOYED platforms — an agent told about a config key no deployment has is
  // in the same position as one told about a half-written element.
  //
  // Only when there IS an upstream to be ahead of. A detached worktree at
  // origin/main has none, and that is the shape this check recommends.
  let ahead: string[] = [];
  try {
    ahead = execFileSync(
      'git',
      ['-C', repo, 'log', '--oneline', '@{u}..HEAD', '--', ...read],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .split('\n')
      .filter(Boolean);
  } catch {
    ahead = []; // detached, or no upstream — see the containment check below
  }
  if (ahead.length) {
    refuse('has commits the platform has not published, touching', ahead);
  }

  // A DETACHED WORKTREE IS NOT A PROOF OF ANYTHING BY ITSELF, and the previous
  // check treated it as one.
  //
  // "A detached worktree has no upstream and is therefore never refused" was
  // written as a feature — it IS the shape this file recommends — but it made
  // the recommendation into the hole: point a worktree at a LOCAL commit and
  // every check above passes. That is not hypothetical. `da5df0f` in this repo
  // regenerated the catalog for a `rating-stars` element from a detached
  // worktree at the platform's local HEAD, and that commit was not on
  // origin/main: the catalog described an element no deployment had, which is
  // the same harm as reading a dirty tree and reaches npm the same way.
  //
  // The honest question is CONTAINMENT, not upstream tracking: is this commit on
  // any remote branch? `git branch -r --contains` answers it for a detached HEAD
  // and for an attached one alike, and a repo with no remotes at all (a fresh
  // clone-less checkout, a fixture) answers "no remotes" rather than "not
  // published" — nothing to be measured against is not the same as failing.
  try {
    const remotes = execFileSync('git', ['-C', repo, 'remote'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!remotes) return;
    const on = execFileSync('git', ['-C', repo, 'branch', '-r', '--contains', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (on.length === 0) {
      const head = execFileSync('git', ['-C', repo, 'log', '-1', '--oneline'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      refuse('is at a commit NO REMOTE BRANCH CONTAINS — unpublished work in', [head]);
    }
  } catch {
    // No git, or a command this git cannot run: say nothing rather than refuse
    // on the strength of a tool failure.
  }
  return;
  return;
}

function refuse(what: string, lines: string[]): never {
  console.error(
    `WB_REPO ${what} the directories this generator reads, and the catalog it writes is ` +
      'committed and published:',
  );
  for (const line of lines.slice(0, 12)) console.error(`  ${line}`);
  if (lines.length > 12) console.error(`  …and ${lines.length - 12} more`);
  console.error(
    'Point WB_REPO at a PUBLISHED ref instead — the cheap way is a detached worktree:\n' +
      '  git -C <web_builder> worktree add --detach /tmp/wb origin/main\n' +
      '  ln -s <web_builder>/node_modules /tmp/wb/node_modules   # and editor/, schema/, runtime/\n' +
      'Pass --dirty to read this checkout on purpose.',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const repo = process.env.WB_REPO;
  if (!repo) {
    console.error('WB_REPO is not set — point it at a web_builder checkout');
    process.exit(1);
  }
  assertCommitted(repo);
  const specPath = resolve(repo, 'server/docs/swagger.json');
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
    definitions?: Record<string, unknown>;
  };
  // Asked BEFORE the catalog is built, so a caller reading a wall of "wrote …"
  // lines sees the one thing those lines cannot tell them first.
  reportUndocumentedRoutes(repo, spec);

  const ops: ApiOperation[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = item[method] as
        | { tags?: string[]; summary?: string; parameters?: SwaggerParam[] }
        | undefined;
      if (!op) continue;

      const params: ApiParam[] = [];
      let bodyRef: string | null = null;
      let bodyDescribed = false;
      for (const p of op.parameters ?? []) {
        if (p.in === 'body') {
          bodyRef = refName(p.schema?.$ref) ?? refName(p.schema?.items?.$ref);
          bodyDescribed = bodyRef !== null;
        }
        params.push({
          name: p.name ?? '',
          in: (p.in as ApiParam['in']) ?? 'query',
          required: p.required === true,
          type: p.type ?? (p.in === 'body' ? 'object' : 'string'),
          description: p.description ?? '',
        });
      }

      ops.push({
        id: `${method}:${path}`,
        method: method.toUpperCase(),
        path,
        tags: op.tags ?? [],
        summary: op.summary ?? '',
        params,
        bodyDescribed,
        bodyRef,
        credential: credentialFor(path),
      });
    }
  }

  // The document has no operationId, so ids are synthesized. A collision would
  // silently drop an operation from the index — assert instead of hoping.
  const ids = new Set(ops.map((o) => o.id));
  if (ids.size !== ops.length) {
    console.error(`duplicate operation ids: ${ops.length - ids.size}`);
    process.exit(1);
  }
  if (ops.length < 300) {
    console.error(`only ${ops.length} operations — expected 300+; is WB_REPO stale?`);
    process.exit(1);
  }
  // Every described body must resolve, or `body_schema` would be undefined at
  // the exact moment the model was told a schema exists.
  const dangling = ops.filter((o) => o.bodyDescribed && !(spec.definitions ?? {})[o.bodyRef!]);
  if (dangling.length > 0) {
    console.error(`dangling body refs: ${dangling.map((o) => o.id).join(', ')}`);
    process.exit(1);
  }

  const withBody = ops.filter((o) => o.params.some((p) => p.in === 'body'));
  const out = `// GENERATED by scripts/gen-catalog.ts — do not edit by hand.
// Source: <WB_REPO>/server/docs/swagger.json
import type { ApiOperation } from './types.js';

export const SWAGGER_SOURCE = ${JSON.stringify(
    {
      operations: ops.length,
      definitions: Object.keys(spec.definitions ?? {}).length,
      bodyCarrying: withBody.length,
      bodyUndescribed: withBody.filter((o) => !o.bodyDescribed).length,
      generatedFrom: 'server/docs/swagger.json',
    },
    null,
    2,
  )} as const;

export const API_OPERATIONS: ApiOperation[] = ${JSON.stringify(ops, null, 2)};

export const API_DEFINITIONS: Record<string, unknown> = ${JSON.stringify(
    spec.definitions ?? {},
    null,
    2,
  )};
`;
  // ---- Element catalog -------------------------------------------------
  //
  // tsx imports the platform's schema TypeScript directly, extensionless
  // relative imports and all — that package is bundled by Vite, not resolved as
  // Node16 ESM, so a plain `import` from a Node16 build would fail. Verified
  // against the real checkout before this was written.
  const traitReg = (await import(resolve(repo, 'schema/src/traits/registry.ts'))) as {
    TRAITS: Record<string, { key: string; label: string; writes?: Array<{ target: string; writeKey: string; schema?: { type?: string; unit?: string } }>; default?: Record<string, unknown> }>;
  };
  const traits: Record<string, TraitDescription> = {};
  for (const [key, d] of Object.entries(traitReg.TRAITS)) {
    traits[key] = {
      key,
      label: d.label ?? key,
      writes: (d.writes ?? []).map((w) => ({
        target: w.target,
        writeKey: w.writeKey,
        type: w.schema?.type ?? 'string',
        ...(w.schema?.unit ? { unit: w.schema.unit } : {}),
      })),
      ...(d.default ? { defaults: d.default } : {}),
    };
  }

  const registry = (await import(resolve(repo, 'schema/src/elements/registry.ts'))) as {
    ELEMENTS: Record<string, Record<string, unknown>>;
    allElementTypes: () => string[];
  };
  const aiMod = (await import(resolve(repo, 'schema/src/elements/ai.ts'))) as {
    getElementAI: (type: string) => Record<string, unknown> | undefined;
  };
  // The BINDINGS an element is born with. They are not in `meta.defaults` — the
  // editor derives them at drop time from `datasetBindings(type, config)` — so a
  // node minted from the defaults alone is inert: it renders its placeholder and
  // nothing says why. Baked in here so `createNode` can seed them offline.
  const bindMod = (await import(resolve(repo, 'schema/src/elements/datasetBindings.ts'))) as {
    datasetBindings: (type: string, config: Record<string, unknown>) => unknown[];
  };

  const types = registry.allElementTypes();
  if (types.length < 80) {
    console.error(`only ${types.length} elements — is WB_REPO stale?`);
    process.exit(1);
  }
  const elements: Record<string, CatalogElement> = {};
  for (const type of types) {
    const em = registry.ELEMENTS[type] as {
      label?: string;
      category?: string;
      isContainer?: boolean;
      rules?: Record<string, unknown>;
      defaults?: Record<string, unknown>;
      traits?: unknown;
    };
    const a = (aiMod.getElementAI(type) ?? {}) as {
      description?: string;
      hints?: { useWhen?: string[]; avoidWhen?: string[]; contentTips?: string[] };
      semantics?: string[];
    };
    // The AI hints are the whole reason this catalog exists — an element without
    // one would be reachable but undescribed, which is worse than absent.
    if (!a.description) {
      console.error(`element "${type}" has no AI description`);
      process.exit(1);
    }
    elements[type] = {
      type,
      label: em.label ?? type,
      category: em.category ?? 'other',
      isContainer: em.isContainer === true,
      isRootOnly: em.rules?.isRootOnly === true,
      locked: em.rules?.locked === true,
      hideInLayer: em.rules?.hideInLayer === true,
      childAllows: (em.rules?.nodeChildAllows as string[] | undefined) ?? [],
      // The click-action allow-lists, verbatim. Baked because nothing else can
      // answer "may this element carry open_cart" — and without the answer no
      // tool could write an event at all, so a site built from scratch had no
      // way to open its own cart drawer.
      ...declaredEvents(em),
      defaults: withBindings(type, (em.defaults ?? {}) as CatalogElement['defaults'], bindMod.datasetBindings),
      ...bindingTable(type, (em.defaults ?? {}) as CatalogElement['defaults'], bindMod.datasetBindings),
      inspector: readInspector(em.traits).tabs,
      controls: readInspector(em.traits).controls,
      description: a.description,
      useWhen: a.hints?.useWhen ?? [],
      avoidWhen: a.hints?.avoidWhen ?? [],
      contentTips: a.hints?.contentTips ?? [],
      semantics: a.semantics ?? [],
    };
  }

  // The bug this replaced was SILENT: a plausible list of plausible words. So
  // the shape is asserted, not trusted. A heading has two dozen controls; if this
  // ever collapses back to section headers the count gives it away here rather
  // than in an agent's guesswork.
  const headingControls = elements.heading?.controls ?? [];
  if (headingControls.length < 15 || !headingControls.includes('font_size')) {
    console.error(
      `heading reports ${headingControls.length} controls (${headingControls.slice(0, 6).join(', ')}) — ` +
        'expected 15+ including font_size. readInspector is reading groups, not attributes.',
    );
    process.exit(1);
  }
  const allControls = new Set(Object.values(elements).flatMap((e) => e.controls));
  if (allControls.size < 300) {
    console.error(`only ${allControls.size} distinct controls — expected 300+`);
    process.exit(1);
  }

  // WHAT AN ELEMENT ARRIVES WITH, beyond its own defaults.
  //
  // Two editor modules, imported rather than transcribed. Both are plain TS
  // whose only import is `@webbuilder/schema` (and a factory importing the
  // same), so neither drags Vue into this script the way `legacyScopes` would
  // have — that one is still read by regex for exactly that reason.
  //
  //  • `ELEMENT_SEEDS` — the children an element "is not USABLE without". A
  //    `dropdown` without its trigger and panel is, in the registry's own words,
  //    "a bare relative box"; a `select` renders INTO those two nodes and draws
  //    an empty box without them.
  //  • `buildEmptyStateTree` — the satellite subtree the three list-empty owners
  //    are born as (they call addDetachedTree, not addDetachedNode). A bare
  //    list-empty is blank space where the editor shows a glyph, a headline and
  //    a line of body.
  const seedsMod = (await import(resolve(repo, 'editor/src/element/seeds.ts'))) as {
    ELEMENT_SEEDS: Record<string, Array<Record<string, unknown>>>;
  };
  const emptyMod = (await import(resolve(repo, 'editor/src/element/emptyState.ts'))) as {
    buildEmptyStateTree: (ownerId: string, source: unknown) => {
      rootId: string;
      nodes: Record<string, RawNode>;
    };
  };
  const factoryMod = (await import(resolve(repo, 'editor/src/element/factory.ts'))) as {
    createElement: (type: string) => RawNode;
  };

  // Only what the seed DECIDED. Every value equal to the element's own default
  // is dropped, so the table says what makes this node a seed rather than
  // restating meta.defaults in a second place that can disagree with the first.
  const decided = (
    type: string,
    ns: 'style' | 'config' | 'specials',
    got: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined => {
    if (!got) return undefined;
    let base: Record<string, unknown> = {};
    try {
      base = ((factoryMod.createElement(type) as unknown as Record<string, Record<string, unknown>>)[ns] ?? {});
    } catch {
      base = {};
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(got)) {
      if (JSON.stringify(base[k]) !== JSON.stringify(v)) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  };

  const toSeed = (node: RawNode, all: Record<string, RawNode>): NodeSeed => {
    const kids = (node.data?.nodes ?? []).map((k) => all[k]).filter(Boolean);
    const style = decided(node.data.type, 'style', node.style);
    const config = decided(node.data.type, 'config', node.config);
    const specials = decided(node.data.type, 'specials', node.specials);
    return {
      type: node.data.type,
      ...(style ? { style } : {}),
      ...(config ? { config } : {}),
      ...(specials ? { specials } : {}),
      ...(kids.length ? { children: kids.map((k) => toSeed(k, all)) } : {}),
    };
  };

  // A palette seed is written as a nested SeedSpec, not as built nodes, so it
  // converts directly.
  const specToSeed = (spec: Record<string, unknown>): NodeSeed => ({
    type: String(spec.type),
    ...(spec.style ? { style: spec.style as Record<string, unknown> } : {}),
    ...(spec.config ? { config: spec.config as Record<string, unknown> } : {}),
    ...(spec.specials ? { specials: spec.specials as Record<string, unknown> } : {}),
    ...(Array.isArray(spec.children) && spec.children.length
      ? { children: (spec.children as Array<Record<string, unknown>>).map(specToSeed) }
      : {}),
  });

  const elementSeeds: Record<string, NodeSeed[]> = {};
  for (const [type, specs] of Object.entries(seedsMod.ELEMENT_SEEDS)) {
    elementSeeds[type] = specs.map(specToSeed);
  }
  if (!Object.keys(elementSeeds).length) {
    console.error('ELEMENT_SEEDS came back empty — is WB_REPO stale?');
    process.exit(1);
  }

  // The dataset sources the empty-state copy is written for. EMPTY_COPY is not
  // exported, so its keys are read from the source the way DOC_SCHEMA_VERSION is
  // — and asserted, because a regex that silently matches nothing would seed
  // every list with the product copy and say nothing.
  const emptySrc = readFileSync(resolve(repo, 'editor/src/element/emptyState.ts'), 'utf8');
  const copyBlock = emptySrc.slice(emptySrc.indexOf('const EMPTY_COPY'));
  const sources = [...copyBlock.matchAll(/^  (\w+): \{$/gm)].map((m) => m[1]);
  if (sources.length < 5) {
    console.error(`only ${sources.length} empty-state sources — has EMPTY_COPY moved?`);
    process.exit(1);
  }
  // FIXED_EMPTY_SOURCE is the one hand-kept map in this file, so it is the one
  // that can go stale silently: change the argument at either call site and
  // codegen would emit the wrong empty-state copy and report success. Checked
  // against the call sites themselves.
  for (const [type, source] of Object.entries(FIXED_EMPTY_SOURCE)) {
    const vue = resolve(repo, `editor/src/nodes/${type}/index.vue`);
    let src = '';
    try {
      src = readFileSync(vue, 'utf8');
    } catch {
      console.error(`cannot read ${vue} to verify its empty-state source`);
      process.exit(1);
    }
    if (!src.includes(`buildEmptyStateTree(props.nodeId, '${source}')`)) {
      console.error(
        `${type} no longer calls buildEmptyStateTree with '${source}' — FIXED_EMPTY_SOURCE is stale`,
      );
      process.exit(1);
    }
  }

  const emptyTrees: Record<string, NodeSeed> = {};
  for (const src of sources) {
    const tree = emptyMod.buildEmptyStateTree('OWNER', src);
    emptyTrees[src] = toSeed(tree.nodes[tree.rootId], tree.nodes);
  }
  // Distinct copy per source is the whole point of the table; identical trees
  // mean the source argument stopped being read.
  if (new Set(Object.values(emptyTrees).map((t) => JSON.stringify(t))).size < 2) {
    console.error('every empty-state source produced the same tree');
    process.exit(1);
  }

  // THE SATELLITES EACH ELEMENT OWNS.
  //
  // A satellite is a real node referenced from `config[configKey]` instead of
  // `data.nodes`, so it is invisible to any walk that follows children only. The
  // platform states the contract at
  // server/render/generated/schema_gen.go:245 — "Anything that asks 'what is
  // inside this node?' (subtree collection, copy, delete) must consult this
  // table as well".
  //
  // Read from the element METAS, never from that Go map, because only the metas
  // carry `optional`. The flag is the whole difference between a list that ships
  // its designed empty state and one that shows ghost cards to a shopper: absent
  // (the normal case) means the owner MINTS the satellite at create time, while
  // `list-loading` is opt-in on purpose — a list with no loading design shows a
  // silhouette of its own cards, which is the better answer for almost every
  // site. Go's SatelliteConfigKeys flattens both cases into one map.
  const satellites: Record<string, SatelliteRule[]> = {};
  for (const type of types) {
    const rules = (registry.ELEMENTS[type] as { satellite?: SatelliteRule[] }).satellite;
    if (!rules?.length) continue;
    satellites[type] = rules.map((r) => {
      // The three list-empty owners are born as a SUBTREE. cart-order and
      // dataset-block pass a fixed source at the call site; list-dataset passes
      // its own `config.datasetSource`, so it carries the whole table.
      const fixed = FIXED_EMPTY_SOURCE[type];
      const seeded =
        r.type !== 'list-empty'
          ? {}
          : fixed
            ? { seed: emptyTrees[fixed] }
            : { seedBySource: emptyTrees };
      return {
        type: r.type,
        configKey: r.configKey,
        ...(r.optional ? { optional: true as const } : {}),
        ...seeded,
      };
    });
    // A satellite whose type is not an element cannot be minted, and a silent
    // skip here would put the owner back in the degrade path this table exists
    // to close.
    for (const r of rules) {
      if (!elements[r.type]) {
        console.error(`satellite ${type}.${r.configKey} names unknown element "${r.type}"`);
        process.exit(1);
      }
    }
  }
  // Eight owners today. Asserted so the table cannot silently empty the way the
  // trait `attributes` walk did in Phase 6 — a generated table that quietly goes
  // to zero reads exactly like an element that owns nothing.
  if (Object.keys(satellites).length < 8) {
    console.error(`only ${Object.keys(satellites).length} satellite owners — is WB_REPO stale?`);
    process.exit(1);
  }

  const hoverHomes = readHoverHomes(types, registry as never);

  const docVersion = readDocSchemaVersion(repo);
  const bindingSources = readBindingSources(repo);
  const boundSpecials = readBoundSpecials(repo);
  const firstChildOnly = readFirstChildOnly(repo);
  const baseOnly = readBaseOnlyConfig(repo);

  // ---- The ENTRANCE ANIMATION, and its three silent misses --------------
  //
  // `animation` is offered by 73 of the 111 element types — a first-class
  // design control on nearly everything a visitor sees — and NOTHING in this
  // catalog said what to write into it. Every miss is silent in exactly the way
  // CONFIG_VALUES above exists to close, and there are three of them:
  //
  //   - it is an OBJECT, not the string the name invites:
  //     `{active, type, easing, delay, duration}` (readAnimConfig). A string
  //     fails the `map[string]interface{}` assertion and reads as the zero
  //     value.
  //   - `active: true` is REQUIRED, and a stored `type` is not consent. The
  //     platform says why: the panel keeps `type` when the switch goes off (so
  //     switching back restores the choice), "so treating a stored type as
  //     consent would animate a node the author had explicitly turned off".
  //   - `type` must be one of the four KEYFRAME KEYS, spelled with UNDERSCORES.
  //     `AnimKeyframes`'s own comment flags the trap: "keyed by the STORED
  //     value (`fade_in`, not `fade-in`)".
  //
  // AnimationTypeOf returns "" for every one of them: no keyframes, no rule, no
  // error, through save, publish and render. `easing` is the mild case — an
  // unrecognised value falls back to `ease` rather than killing the animation.
  //
  // Read from the GO for the same reason CONFIG_VALUES is: the Go is what
  // renders. Its own comment says the table is byte-identical to the canvas's,
  // and a parity test holds them together, so reading either is reading both.
  const readAnimation = (): {
    types: string[];
    easings: string[];
    easingFallback: string;
    durationDefault: number;
    readBy: string;
  } => {
    // THE KEYFRAME TABLE MOVES, AND THE READER MUST NOT CARE WHICH FILE IT IS IN.
    // It began beside the compiler in `animation.go`; once four effects became
    // forty-six the platform generated it into `keyframes_gen.go` from the
    // editor's own table. Both are `render/style`, both declare the same
    // `AnimKeyframes` map, and a reader pinned to one filename fails the next
    // regen for a reason that has nothing to do with the catalog.
    const src = ['server/render/style/animation.go', 'server/render/style/keyframes_gen.go']
      .map((rel) => {
        try {
          return readFileSync(resolve(repo, rel), 'utf8');
        } catch {
          return '';
        }
      })
      .join('\n');
    const block = (name: string): string => {
      const from = src.indexOf(`var ${name} =`);
      if (from < 0) {
        console.error(`${name} is gone from server/render/style/animation.go`);
        process.exit(1);
      }
      const end = src.indexOf('\n}', from);
      return src.slice(from, end < 0 ? src.indexOf('\n\n', from) : end);
    };
    // `"fade_in": "@keyframes …"` — the KEY is the stored value. Matched at the
    // start of a line so the keyframe bodies (which quote plenty of their own
    // strings, across continuation lines) cannot contribute one.
    const types = [...block('AnimKeyframes').matchAll(/^\s*"([a-z_]+)":/gm)].map((m) => m[1]);
    const easings = [...(/var AnimEasings = \[\]string\{([^}]*)\}/.exec(src)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(
      (m) => m[1],
    );
    // The `|| 0.5` the compiler applies to a stored 0, mirrored from the canvas
    // so the two agree — a 0s animation would leave the node on its `from`
    // keyframe for a frame and read as a flash.
    //
    // OPTIONAL, deliberately. It is the one INFORMATIONAL field here: the types
    // and the easings decide whether a write does anything at all, and this only
    // says what a caller gets for leaving a number out. It moved into a helper
    // the moment intensity arrived (`animDuration`), and failing the whole
    // catalog over a default nobody has to know is the brittleness this reader
    // exists to avoid — the LOAD-BEARING halves still exit 1 when they move.
    const dur = /dur == 0 \{\s*dur = ([0-9.]+)/.exec(src);
    if (types.length < 2 || easings.length < 2) {
      console.error(
        'AnimKeyframes / AnimEasings no longer read as a vocabulary in server/render/style — ' +
          'the shape moved, and the animation table would be wrong rather than missing',
      );
      process.exit(1);
    }
    return {
      types: types.sort(),
      easings,
      easingFallback: 'ease',
      durationDefault: dur ? Number(dur[1]) : 0.5,
      readBy: 'AnimationTypeOf + CompileEntranceAnimationCSS',
    };
  };
  const animation = readAnimation();

  // ---- THE SITE'S TYPE SCALE, which every generated page was ignoring ------
  //
  // The theme ships `heading-1` (48px) through `heading-6` (16px) and `text-1`
  // through `text-3`. MEASURED on a page built entirely by these tools: every
  // heading rendered at 48px whatever its level, because the mapper wrote only
  // `htmlTag` and the element's `heading-default` preset pins `fontSize: 48px`
  // flat. A section title and the three item titles under it came out the same
  // size — "about four type sizes rather than a fifth that differs by 2px" is
  // the checklist item, and the page had ONE.
  //
  // A node wears a style by REFERENCE, never by literal: the editor stamps
  // `var(--wb-ts-<slug>-<prop>)` into the style namespace and records the pick
  // in `config.textGlobalStyle`. A literal would outrank the preset beneath it
  // permanently and stop the node following the theme — the detachment this
  // repo already records for imported icons.
  //
  // Read from the editor's own table by regex rather than imported, for the
  // reason `legacyScopes.ts` is: the module reaches `../trait/values`, which
  // would drag Vue into a build script for eight pairs.
  const readTextStyleKeys = (): Array<[string, string]> => {
    const at = resolve(repo, 'editor/src/theme/textStyle.ts');
    const src = readFileSync(at, 'utf8');
    const from = src.indexOf('TEXT_STYLE_KEYS');
    const end = src.indexOf('] as const', from);
    if (from < 0 || end < 0) {
      console.error('TEXT_STYLE_KEYS is gone from editor/src/theme/textStyle.ts');
      process.exit(1);
    }
    const pairs = [...src.slice(from, end).matchAll(/\[\s*'([A-Za-z]+)'\s*,\s*'([a-z-]+)'\s*\]/g)].map(
      (m) => [m[1], m[2]] as [string, string],
    );
    if (pairs.length < 6) {
      console.error(`TEXT_STYLE_KEYS parsed ${pairs.length} pairs — the table's shape moved`);
      process.exit(1);
    }
    return pairs;
  };
  const textStyleKeys = readTextStyleKeys();

  // ---- What a config key is ALLOWED to hold ----------------------------
  //
  // `sb_traits_for` names 138 controls with a declared write target, and NOT ONE
  // of them says what values that target accepts — every trait in the registry
  // declares `schema: { type: 'string' }`, because the vocabulary lives in the
  // Vue component that renders the picker, which is a place no agent can read.
  //
  // So an agent could be told "this control writes `config.collectionType`" and
  // had to guess the word. The guess FAILS SILENTLY, and the platform's own test
  // says so: `EffectiveCollectionType("bestseller")` returns `all_products`
  // (render/tests/collection_test.go:227). A repeater set to a plausible word —
  // `bestseller`, `featured_products`, `newest` — stores, saves, publishes and
  // renders THE WHOLE CATALOGUE, under whatever heading the author wrote above
  // it. Same shape for the other two: an unknown `articleSourceType` reads as
  // `category`, an unknown `collectionListType` as every collection.
  //
  // READ FROM THE GO, not from the editor's frozen objects, because the Go is
  // what RENDERS — `EffectiveX(stored)` IS the answer to "what will this do".
  // Each function is a run of `if stored == Const { return Const }` arms over a
  // trailing `return Fallback`, which is exactly enough to recover the whole
  // vocabulary AND the value an unrecognised one collapses to.
  //
  // ALIASES ARE PART OF THE ANSWER: `EffectiveCollectionType` accepts "category"
  // for "collection", a compatibility spelling that works and is not what the
  // picker writes. An agent told only the canonical list would read a document
  // holding the alias as broken.
  //
  // NO NEW TOOL. This lands inside `sb_traits_for`'s result, on the control that
  // writes the key — the tool list does not grow by a byte.
  const readConfigValues = (): Record<
    string,
    { values: string[]; fallback: string; aliases: Record<string, string>; readBy: string }
  > => {
    const src = readFileSync(resolve(repo, 'server/render/nodes/collection.go'), 'utf8');
    // The const block: `CollectionTypeSlot   = "slot"`.
    const consts = new Map<string, string>();
    for (const m of src.matchAll(/^\s*([A-Z][A-Za-z0-9]*)\s*=\s*"([^"]*)"/gm)) {
      consts.set(m[1], m[2]);
    }
    // Which CONFIG KEY each normalizer is applied to, read from its call sites
    // rather than guessed from the function name — `EffectiveCollectionType` is
    // applied to a variable called `kind`, and only the call site says the key.
    const KEY_FOR: Record<string, string> = {
      EffectiveCollectionType: 'collectionType',
      EffectiveArticleSourceType: 'articleSourceType',
      EffectiveCollectionListType: 'collectionListType',
    };
    const out: Record<
      string,
      { values: string[]; fallback: string; aliases: Record<string, string>; readBy: string }
    > = {};
    for (const [fn, key] of Object.entries(KEY_FOR)) {
      const at = src.indexOf(`func ${fn}(`);
      if (at < 0) {
        console.error(`${fn} is gone from server/render/nodes/collection.go`);
        process.exit(1);
      }
      const end = src.indexOf('\n}', at);
      const body = src.slice(at, end);
      const values: string[] = [];
      const aliases: Record<string, string> = {};
      // `if stored == A || stored == "category" { return B }` — every literal or
      // named constant on the left is accepted; the RETURN is what it becomes,
      // so a left-hand value that differs from the return is an alias.
      for (const arm of body.matchAll(/if\s+stored\s*==\s*([^{]+)\{\s*return\s+([A-Za-z0-9_]+)/g)) {
        const becomes = consts.get(arm[2]) ?? arm[2];
        for (const t of arm[1].split('||')) {
          const lit = /"([^"]*)"/.exec(t);
          const named = /([A-Za-z][A-Za-z0-9]*)/.exec(t.trim());
          const v = lit ? lit[1] : consts.get(named?.[1] ?? '');
          if (v === undefined) continue;
          if (v === becomes) values.push(v);
          else aliases[v] = becomes;
        }
      }
      const tail = /return\s+([A-Za-z0-9_]+)\s*$/.exec(body.trimEnd());
      const fallback = tail ? (consts.get(tail[1]) ?? tail[1]) : '';
      if (!values.length || !fallback) {
        console.error(`${fn} no longer reads as a vocabulary — the normalizer shape moved`);
        process.exit(1);
      }
      // The fallback is a legal value too, and the arms never name it: it is the
      // `else` of the whole function.
      if (!values.includes(fallback)) values.unshift(fallback);
      out[key] = { values: values.sort(), fallback, aliases, readBy: fn };
    }
    return out;
  };
  const configValues = readConfigValues();
  // The vocabulary this whole table exists for. A regression here is a repeater
  // that lists the wrong things with no error, so it is asserted rather than
  // trusted.
  for (const [key, expect] of Object.entries({
    collectionType: 'slot',
    articleSourceType: 'slot',
    collectionListType: 'custom_collections',
  })) {
    if (!configValues[key]?.values.includes(expect)) {
      console.error(`config.${key} no longer offers "${expect}" — check collection.go`);
      process.exit(1);
    }
  }

  const elementsOut = `// GENERATED by scripts/gen-catalog.ts — do not edit by hand.
// Source: <WB_REPO>/schema/src/elements/** and editor/src/theme/legacyScopes.ts
import type { CatalogElement, NodeSeed, SatelliteRule, TraitDescription } from './element-types.js';

export const ELEMENT_SOURCE = ${JSON.stringify({ count: types.length, docSchemaVersion: docVersion }, null, 2)} as const;

export const ELEMENTS: Record<string, CatalogElement> = ${JSON.stringify(elements, null, 2)};

export const BINDING_SOURCES: string[] = ${JSON.stringify(bindingSources, null, 2)};

export const BOUND_SPECIALS: Record<string, string[]> = ${JSON.stringify(boundSpecials, null, 2)};

export const TRAIT_WRITES: Record<string, TraitDescription> = ${JSON.stringify(traits, null, 2)};

export const SATELLITE_RULES: Record<string, SatelliteRule[]> = ${JSON.stringify(satellites, null, 2)};

export const ELEMENT_SEEDS: Record<string, NodeSeed[]> = ${JSON.stringify(elementSeeds, null, 2)};

export const FIRST_CHILD_ONLY: string[] = ${JSON.stringify(firstChildOnly, null, 2)};

export const HOVER_HOMES: Record<string, { home: 'legacy' | 'state' }> = ${JSON.stringify(hoverHomes, null, 2)};

/**
 * What a config key is ALLOWED to hold, and what an unrecognised value becomes.
 *
 * Every trait in the platform's registry declares schema type "string", so the
 * vocabulary lives in the Vue picker — a place no agent can read. The guess
 * fails SILENTLY: the platform's own test pins
 * EffectiveCollectionType("bestseller") == "all_products", so a repeater set to
 * a plausible word renders the whole catalogue under whatever heading is above
 * it.
 *
 * Read from the GO normalizers, because those are what render. "aliases" are
 * spellings that work but are not what the picker writes.
 */
export const CONFIG_VALUES: Record<
  string,
  { values: string[]; fallback: string; aliases: Record<string, string>; readBy: string }
> = ${JSON.stringify(configValues, null, 2)};

/**
 * Config keys the PUBLISH path reads from base only — html.go indexes
 * node.Config[key] with no responsive merge, and one HTML document serves all
 * three widths. Written per breakpoint they update the editor canvas and vanish
 * on publish, with no error anywhere.
 *
 * The platform's own migration ledger (schema/test/responsive-defaults.test.ts),
 * read rather than copied: it may SHRINK as each key moves to a per-breakpoint
 * CSS var, and a stale copy here would keep forcing a fixed key to base.
 */
export const BASE_ONLY_CONFIG: string[] = ${JSON.stringify(baseOnly.keys, null, 2)};

/**
 * "type:key" pairs that are responsive DESPITE the shared key name, so the rule
 * above must not touch them. quantity-button:iconSize is compiled per
 * breakpoint by the satellite CSS compiler as the --icon-size var.
 */
export const BASE_ONLY_EXCEPTIONS: string[] = ${JSON.stringify(baseOnly.exceptions, null, 2)};

/**
 * The ENTRANCE ANIMATION's vocabulary — config.animation, offered by 73 of the
 * 111 element types and describable by nothing until now.
 *
 * Three ways to miss, all silent (AnimationTypeOf answers "" and no keyframes,
 * no rule and no error are emitted, through save, publish and render):
 *   - it is an OBJECT, not a string: {active, type, easing, delay, duration}
 *   - active:true is REQUIRED; a stored type is deliberately NOT consent,
 *     because the panel keeps the type when the switch goes off
 *   - type is a keyframe key spelled with UNDERSCORES: fade_in, never fade-in
 *
 * easing is the mild one: an unrecognised value falls back to "ease".
 *
 * It is also BASE-ONLY (see BASE_ONLY_CONFIG) — render/css.go emits it into the
 * base lane because the config object is read with no responsive merge.
 */
/**
 * The eight node-style keys a THEME TEXT STYLE controls, and the var prop each
 * compiles to: a node wears a style by setting these to
 * var(--wb-ts-<slug>-<prop>), never by writing the value.
 *
 * The theme ships heading-1 (48px) through heading-6, and text-1..3 — a real
 * type scale that every page built by these tools was ignoring, because the
 * mapper wrote only htmlTag and the heading-default preset pins 48px flat.
 *
 * BY REFERENCE, NEVER BY LITERAL. A literal outranks the preset beneath it
 * permanently and stops the node following the theme.
 */
export const TEXT_STYLE_KEYS: ReadonlyArray<readonly [string, string]> = ${JSON.stringify(textStyleKeys)};

export const ANIMATION: {
  types: string[];
  easings: string[];
  easingFallback: string;
  durationDefault: number;
  readBy: string;
} = ${JSON.stringify(animation, null, 2)};
`;
  emit(resolve(process.cwd(), 'src/catalog/elements.generated.ts'), elementsOut);
  console.error(
    `${VERB} elements.generated.ts: ${types.length} elements, ${allControls.size} controls ` +
      `(${Object.keys(traits).length} with a declared write target), ` +
      `${bindingSources.length} binding sources, ${Object.keys(boundSpecials).length} bound-special elements, ` +
      `${Object.keys(satellites).length} satellite owners, ${firstChildOnly.length} first-child-only, ` +
      `${baseOnly.keys.length} base-only config keys, ${Object.keys(configValues).length} config vocabularies, ` +
      `animation ${animation.types.length} types / ${animation.easings.length} easings, ` +
      `${textStyleKeys.length} text-style keys, ` +
      `doc schema v${docVersion}`,
  );

  // ---- Request shapes --------------------------------------------------
  //
  // What a write operation's BODY looks like, read off the handlers rather than
  // off swagger.json — which describes 46 of 211 and attaches one doc comment's
  // `@Param body` to every @Router line under it, GET included. See
  // scripts/shapes.ts for why the decode site is both broader and stricter.
  const shapeResult = buildRequestShapes(repo, ids);
  const writeOps = ops.filter((o) => ['POST', 'PUT', 'PATCH'].includes(o.method));
  const swaggerBodied = new Set(
    writeOps.filter((o) => o.bodyDescribed && o.bodyRef).map((o) => o.id),
  );
  const shaped = writeOps.filter((o) => shapeResult.shapes[o.id] || swaggerBodied.has(o.id));
  if (shapeResult.stats.unresolved.length > 0) {
    // A decode site that named a type nobody could find means the parser has
    // fallen behind the platform's spelling. Emitting the rest would ship a
    // table that is quietly missing the operations somebody is about to call.
    console.error(
      `unresolved decode targets:\n  ${shapeResult.stats.unresolved.join('\n  ')}`,
    );
    process.exit(1);
  }
  if (shaped.length < writeOps.length * 0.6) {
    console.error(
      `only ${shaped.length}/${writeOps.length} write operations have a body shape — ` +
        'the handler scan has probably stopped matching; expected 60%+',
    );
    process.exit(1);
  }
  const shapesOut = `// GENERATED by scripts/gen-catalog.ts — do not edit by hand.
// Source: <WB_REPO>/server/internal/**/*.go (decode sites) and
//         <WB_REPO>/editor/src/features/*/types.ts (what the platform owns).
import type { RequestShape } from './types.js';

export const SHAPE_SOURCE = ${JSON.stringify(
    {
      writeOperations: writeOps.length,
      shaped: shaped.length,
      fromHandlers: Object.keys(shapeResult.shapes).length,
      fromSwaggerOnly: [...swaggerBodied].filter((id) => !shapeResult.shapes[id]).length,
      withReadOnly: shapeResult.stats.withReadOnly,
      structsRead: shapeResult.stats.structs,
    },
    null,
    2,
  )} as const;

export const REQUEST_SHAPES: Record<string, RequestShape> = ${JSON.stringify(
    shapeResult.shapes,
    null,
    2,
  )};
`;
  emit(resolve(process.cwd(), 'src/catalog/shapes.generated.ts'), shapesOut);
  console.error(
    `${VERB} shapes.generated.ts: ${shaped.length}/${writeOps.length} write operations shaped ` +
      `(${Object.keys(shapeResult.shapes).length} from handlers, ` +
      `${shapeResult.stats.withReadOnly} with a read-only list), ` +
      `${shapeResult.stats.structs} structs read`,
  );

  // ---- The checkout flow ------------------------------------------------
  //
  // THE ONE FLOW THAT MUST BE ORDERED, and the editor is the only place it is
  // written down (editor/src/features/pages/checkoutPage.ts). Its two documents
  // are GENERATED rather than hand-copied, on the same reasoning as
  // ELEMENT_SEEDS: a copy of the platform's own seed rots the next time the
  // platform edits it, silently, and the first person to notice is a shopper.
  //
  // `buildCheckoutPageDocument` takes the form id, which exists only at runtime,
  // so it is called here with a sentinel the tool substitutes. Codegen asserts
  // the sentinel appears exactly once — a substitution that silently matched
  // nothing would produce a checkout page bound to no form, which renders and
  // takes no orders.
  const formTpl = (await import(resolve(repo, 'editor/src/element/formTemplates.ts'))) as {
    FORM_TEMPLATES: Array<{ key: string; type: string; settings?: Record<string, unknown> }>;
    buildTemplateDocument: (tpl: unknown) => { nodes: Record<string, { specials?: Record<string, unknown> }> };
  };
  const pageSeed = (await import(resolve(repo, 'editor/src/element/checkoutPageSeed.ts'))) as {
    buildCheckoutPageDocument: (formId: string, headline: string) => unknown;
  };
  const tpl = formTpl.FORM_TEMPLATES.find((t) => t.key === 'checkout');
  if (!tpl) {
    console.error('no checkout form template — has editor/src/element/formTemplates.ts moved?');
    process.exit(1);
  }
  const checkoutFormDoc = stableIds(formTpl.buildTemplateDocument(tpl), 'ckf');
  const seeded = Object.values(checkoutFormDoc.nodes).map((n) => n.specials?.name);
  for (const required of ['payment_method', 'shipping_method']) {
    if (!seeded.includes(required)) {
      console.error(`checkout form template no longer carries a ${required} field`);
      process.exit(1);
    }
  }
  const FORM_ID_SENTINEL = '__SB_CHECKOUT_FORM_ID__';
  const checkoutPageDoc = stableIds(
    pageSeed.buildCheckoutPageDocument(FORM_ID_SENTINEL, '__SB_HEADLINE__') as {
      nodes: Record<string, unknown>;
    },
    'ckp',
  );
  const pageJson = JSON.stringify(checkoutPageDoc);
  if (pageJson.split(FORM_ID_SENTINEL).length - 1 !== 1) {
    console.error('the checkout page seed no longer carries exactly one form id');
    process.exit(1);
  }

  const locale = (lang: string): Record<string, unknown> => {
    const raw = JSON.parse(
      readFileSync(resolve(repo, `editor/src/i18n/locales/${lang}/editorPanel.json`), 'utf8'),
    ) as Record<string, unknown>;
    return (raw.editorPanel as Record<string, unknown>) ?? raw;
  };
  const checkoutText: Record<string, unknown> = {};
  for (const lang of ['vi', 'en']) {
    const m = locale(lang);
    const desc = (m.paymentMethodDesc ?? {}) as Record<string, string>;
    const text = {
      formName: m.formTplCheckoutName,
      pageName: m.checkoutPageName,
      headline: m.checkoutPageHeadline,
      codLabel: m.paymentMethodCod,
      paymentDesc: desc,
    };
    for (const [k, v] of Object.entries(text)) {
      if (v === undefined) {
        console.error(`${lang}/editorPanel.json is missing the checkout key "${k}"`);
        process.exit(1);
      }
    }
    checkoutText[lang] = text;
  }

  // EVERY template, keyed by the editor's own key. `blank` is skipped: it seeds
  // an empty document, so it is the one entry that teaches nothing and would
  // read as a usable choice.
  const formTemplates: Record<string, unknown> = {};
  for (const t of formTpl.FORM_TEMPLATES) {
    if (t.key === 'blank') continue;
    const doc = stableIds(formTpl.buildTemplateDocument(t), `f${t.key.slice(0, 3)}`);
    formTemplates[t.key] = {
      key: t.key,
      type: t.type,
      settings: t.settings ?? {},
      document: doc,
    };
  }
  const templateCount = Object.keys(formTemplates).length;
  // The five auth templates are the reason this exists — assert they arrived,
  // because a rename upstream would otherwise drop them silently.
  for (const required of ['login', 'register', 'forgot', 'reset', 'verify', 'contact']) {
    if (!formTemplates[required]) {
      console.error(`form template "${required}" is missing — has formTemplates.ts been renamed?`);
      process.exit(1);
    }
  }

  const checkoutOut = `// GENERATED by scripts/gen-catalog.ts — do not edit by hand.
// Source: <WB_REPO>/editor/src/element/{formTemplates,checkoutPageSeed}.ts and
//         <WB_REPO>/editor/src/i18n/locales/*/editorPanel.json

/** The placeholder \`sb_store\` replaces with the form it just created. */
export const FORM_ID_SENTINEL = ${JSON.stringify(FORM_ID_SENTINEL)};
export const HEADLINE_SENTINEL = '__SB_HEADLINE__';

export const CHECKOUT_FORM = ${JSON.stringify({ type: tpl.type, settings: tpl.settings ?? {} }, null, 2)} as const;

export const CHECKOUT_FORM_DOCUMENT = ${JSON.stringify(checkoutFormDoc, null, 2)};

export const CHECKOUT_PAGE_DOCUMENT = ${JSON.stringify(checkoutPageDoc, null, 2)};

/** The editor's own words, so a store built by an agent reads like one built by hand. */
export const CHECKOUT_TEXT = ${JSON.stringify(checkoutText, null, 2)} as const;

/**
 * EVERY form the platform can seed, not just the checkout.
 *
 * The editor ships ${templateCount} templates and this file used to carry ONE, so a
 * store built through these tools could have a checkout and nothing else — no
 * contact form, no newsletter, and none of the five auth forms, even though
 * \`forms.Type\` declares them and \`customerauth\` serves them. Authoring one by
 * hand means writing a field document whose \`mapTo\` values are a vocabulary the
 * server validates, which is exactly the guess this catalog exists to remove.
 *
 * Each entry carries what \`sb_store\` needs to make the form real: the type the
 * platform validates, the settings the template chose, and the field document
 * itself with stable placeholder ids (fresh ones are minted per run).
 */
export const FORM_TEMPLATES = ${JSON.stringify(formTemplates, null, 2)} as const;

export type FormTemplateKey = keyof typeof FORM_TEMPLATES;
`;
  emit(resolve(process.cwd(), 'src/catalog/checkout.generated.ts'), checkoutOut);
  console.error(
    `${VERB} checkout.generated.ts: form type ${tpl.type}, ` +
      `${Object.keys(checkoutFormDoc.nodes).length} form nodes, ` +
      `${Object.keys((checkoutPageDoc as { nodes: object }).nodes).length} page nodes, ` +
      `${Object.keys(checkoutText).length} locales, ` +
      `${templateCount} form templates`,
  );

  // THE COMPLETION PAGE SEED EMITS `rootId`, AND THAT IS THE BUG THIS REPO
  // ALREADY RECORDED THE SYMPTOM OF.
  //
  // CLAUDE.md has carried this for phases: "`rootId` is the app-block key for
  // the same idea `root_node_id` names in a page. A page document carrying it
  // renders an EMPTY <body> with a 200 — the order-complete page of a real store
  // did exactly that." What it never named was WHERE the alias came from.
  //
  // `editor/src/element/completionPage.ts:91` is where: `return { rootId:
  // 'ROOT', nodes }` — no `root_node_id` and no `schema_version` either. So the
  // real store whose order-complete page rendered blank got that document from
  // the platform's own seed, and every merchant who creates a completion page
  // through the editor gets the same one. It is invisible in the editor because
  // the canvas reads the alias; only the RENDERER disagrees.
  //
  // Normalised here rather than passed through, because this seed is about to be
  // PUT to a real page: shipping the alias would make `sb_page_create` mint the
  // very blank page `sb_page_open` has a repair path for. The other five seeds
  // come out correct and are asserted so, which is what keeps this from becoming
  // a blanket coercion that hides the next one.
  const normalizeSeed = (
    type: string,
    doc: Record<string, unknown>,
  ): { schema_version: number; root_node_id: string; nodes: Record<string, unknown> } => {
    const nodes = doc.nodes as Record<string, unknown>;
    const alias = doc.rootId;
    const root = doc.root_node_id ?? alias;
    if (typeof root !== 'string' || !root || !nodes?.[root]) {
      console.error(`the ${type} page seed names no usable root (root_node_id/rootId)`);
      process.exit(1);
    }
    if (alias !== undefined && type !== 'complete') {
      // A NEW seed growing the alias must be seen, not absorbed.
      console.error(
        `the ${type} page seed now emits rootId — the alias renders an empty <body>. ` +
          'Fix it in editor/src/element/, not here.',
      );
      process.exit(1);
    }
    return {
      schema_version: (doc.schema_version as number) ?? docVersion,
      root_node_id: root,
      nodes,
    };
  };

  // ---- What a store page opens with ------------------------------------
  //
  // EVERY STORE PAGE TYPE OPENS PRE-BUILT FOR A HUMAN AND BLANK FOR AN AGENT,
  // and `sb_page_create` said so in its own description: "It arrives empty."
  // For a merchant it has not been empty since `storePageSeeds.ts` landed — a
  // product page opens with the whole buy box, "gallery, title, price, variant
  // picker, description, quantity stepper, Add to cart and Buy it now — already
  // arranged and already bound".
  //
  // That file's opening comment is the argument for taking it: "the blank was
  // not the problem — what the author had to already know was", listing the
  // seven pieces, in which order, inside which container, with a button whose
  // BINDING rather than click action is add_to_cart. An agent was in exactly the
  // position the merchant was rescued from, and worse: it cannot see the palette
  // card it is failing to reproduce.
  //
  // IDS ARE RESTAMPED, for the reason the checkout seed is: `createElement`
  // mints a random id per node, so a straight capture would rewrite this file on
  // every run and `--check` would report drift that is not drift.
  //
  // The completion page takes a HEADLINE, which exists only at runtime — the
  // same sentinel shape the checkout page uses, asserted to appear exactly once
  // so a substitution that silently matched nothing cannot ship a page whose
  // thank-you line is a placeholder.
  const storeSeedMod = (await import(
    resolve(repo, 'editor/src/element/storePageSeeds.ts')
  )) as {
    buildStorePageDocument: (type: string, headline: string) => { nodes: Record<string, unknown> } | undefined;
    hasStorePageSeed: (type: string) => boolean;
  };
  const HEADLINE_SENTINEL = '__SB_COMPLETION_HEADLINE__';
  const STORE_TYPES = ['product', 'category', 'search', 'blog', 'post', 'complete'] as const;
  const storeSeeds: Record<string, unknown> = {};
  for (const type of STORE_TYPES) {
    const doc = storeSeedMod.buildStorePageDocument(type, HEADLINE_SENTINEL);
    // A seed the platform RETIRED must vanish from here rather than linger as a
    // stale copy — the whole point of reading the palette's own cards is that
    // the day a card gains a piece it arrives at both doors.
    if (!doc) continue;
    storeSeeds[type] = normalizeSeed(
      type,
      stableIds(doc as { nodes: Record<string, unknown> }, `sp${type.slice(0, 3)}`),
    );
  }
  if (!storeSeeds.product) {
    console.error('no product page seed — has editor/src/element/storePageSeeds.ts moved?');
    process.exit(1);
  }
  const completeJson = JSON.stringify(storeSeeds.complete ?? {});
  if (completeJson.split(HEADLINE_SENTINEL).length - 1 !== 1) {
    console.error('the completion page seed no longer carries exactly one headline');
    process.exit(1);
  }
  // THE THANK-YOU LINE IN THE MERCHANT'S OWN LANGUAGE, read from the editor's
  // i18n rather than defaulted here. Defaulting would hardcode English into a
  // seeded page and ship the exact defect `default_seed_copy` exists to report —
  // and the platform already ships the sentence in both languages.
  const completionHeadline: Record<string, string> = {};
  for (const lang of ['vi', 'en']) {
    const raw = JSON.parse(
      readFileSync(resolve(repo, `editor/src/i18n/locales/${lang}/payments.json`), 'utf8'),
    ) as Record<string, unknown>;
    const payments = (raw.payments as Record<string, unknown>) ?? raw;
    const h = payments.completionPageHeadline;
    if (typeof h !== 'string' || !h) {
      console.error(`${lang}/payments.json is missing completionPageHeadline`);
      process.exit(1);
    }
    completionHeadline[lang] = h;
  }
  // The buy box is the seed that matters, and "it has nodes" is not proof it
  // still buys anything: the button's BINDING is what makes it add to cart, and
  // a card that lost it would still look like a product page here.
  const productJson = JSON.stringify(storeSeeds.product);
  for (const required of ['add_to_cart', 'bind-product-action']) {
    if (!productJson.includes(required)) {
      console.error(`the product page seed no longer carries ${required} — the buy box is broken`);
      process.exit(1);
    }
  }

  const storeOut = `// GENERATED by scripts/gen-catalog.ts — do not edit by hand.
// Source: <WB_REPO>/editor/src/element/storePageSeeds.ts (the palette's own cards).

export const STORE_SEED_SOURCE = ${JSON.stringify(
    {
      types: Object.keys(storeSeeds),
      nodes: Object.fromEntries(
        Object.entries(storeSeeds).map(([t, d]) => [
          t,
          Object.keys((d as { nodes: Record<string, unknown> }).nodes).length,
        ]),
      ),
    },
    null,
    2,
  )} as const;

/** The token the completion page's thank-you headline is substituted into. */
export const COMPLETION_HEADLINE_SENTINEL = ${JSON.stringify(HEADLINE_SENTINEL)};

/**
 * The thank-you sentence, per locale, as the editor ships it.
 *
 * Read from the platform rather than defaulted, so a Vietnamese store does not
 * get an English seeded page — the defect \`default_seed_copy\` reports.
 */
export const COMPLETION_HEADLINE: Record<string, string> = ${JSON.stringify(completionHeadline, null, 2)};

/**
 * The document a new page of each type opens with in the EDITOR.
 *
 * Not a copy of the palette — built by calling the palette's own cards, so an
 * agent that creates a product page and a merchant who drags the Product card
 * end up looking at the same thing. A type absent here starts blank, which is
 * the right default for \`page\` itself.
 */
export const STORE_PAGE_SEEDS: Record<string, { schema_version: number; root_node_id: string; nodes: Record<string, unknown> }> = ${JSON.stringify(
    storeSeeds,
    null,
    2,
  )};
`;
  emit(resolve(process.cwd(), 'src/catalog/storepages.generated.ts'), storeOut);
  console.error(
    `${VERB} storepages.generated.ts: ${Object.keys(storeSeeds).length} seeded page types (` +
      Object.entries(storeSeeds)
        .map(([t, d]) => `${t} ${Object.keys((d as { nodes: object }).nodes).length}`)
        .join(', ') +
      ' nodes)',
  );

  // ---- Which form node reads which skin knob ---------------------------
  //
  // A FORM'S FIELDS ARE STYLED BY CONFIG KEYS, AND THE WRONG LEVEL IS SILENT.
  // CLAUDE.md has carried the rule in PROSE — "form/css.go emits only
  // FieldKnobs, so payCard* written on the form is stored and rendered nowhere"
  // — and a hand-kept list of a table this size is the thing this generator
  // exists to replace. `fieldSkin.ts`'s own comment makes the argument against
  // hand mirrors for exactly this table.
  //
  // THE GROUPS COME FROM TS AND THE MAPPING FROM GO, because each side owns its
  // half: `fieldSkin.ts` is the pure-data vocabulary, and which node emits which
  // group is a fact about the RENDERER, read off the `fieldskin.<Group>`
  // identifier in each `css.go`.
  //
  // The composition for radio/checkbox/timeslot/file lives only in Go
  // (`withChrome(append(...))`), so it is rebuilt here from the TS groups AND
  // THEN ASSERTED against the Go group's own `Key:` literals. That assertion is
  // what makes this a verified mirror rather than a second copy: if either side
  // moves, codegen fails naming the group.
  const skinMod = (await import(resolve(repo, 'schema/src/elements/fieldSkin.ts'))) as Record<
    string,
    ReadonlyArray<{ key: string }>
  >;
  const grp = (name: string): string[] => {
    const g = skinMod[name];
    if (!Array.isArray(g)) {
      console.error(`fieldSkin.ts no longer exports ${name}`);
      process.exit(1);
    }
    return g.map((k) => k.key);
  };
  // Group name in Go -> the key list, composed from the TS tables.
  const GO_GROUPS: Record<string, string[]> = {
    // `Rules` is the default path: FieldKnobs = ChromeKnobs + Knobs, mirrored by
    // FIELD_NODE_SKIN_KNOBS. This is what the FORM itself emits.
    Rules: grp('FIELD_NODE_SKIN_KNOBS'),
    RadioFieldKnobs: [...grp('FIELD_CHROME_KNOBS'), ...grp('CHOICE_SKIN_KNOBS'), ...grp('RADIO_ONLY_SKIN_KNOBS')],
    CheckboxFieldKnobs: [...grp('FIELD_CHROME_KNOBS'), ...grp('CHOICE_SKIN_KNOBS'), ...grp('CHECKBOX_ONLY_SKIN_KNOBS')],
    TimeslotFieldKnobs: [...grp('FIELD_CHROME_KNOBS'), ...grp('TIMESLOT_SKIN_KNOBS'), ...grp('TIMESLOT_MARKER_SKIN_KNOBS')],
    FileFieldKnobs: [...grp('FIELD_CHROME_KNOBS'), ...grp('FILE_SKIN_KNOBS')],
    PayFieldKnobs: grp('PAY_FIELD_SKIN_KNOBS'),
  };

  // THE CROSS-CHECK, and it deliberately does NOT parse the Go composition.
  //
  // A first version resolved each Go group by walking `withChrome(append(...))`
  // and comparing key-for-key. It was wrong twice in a row — a name pattern that
  // could not match the group literally called `Knobs`, then a body slice that
  // ran past a one-line var inside a `var (...)` block and swept in half the
  // file. A parser that fragile asserting a lockstep mirror is worse than no
  // assertion: it fails on its own bugs, and an assertion that cries wolf
  // teaches the next reader to bypass it.
  //
  // What actually drifts here is the VOCABULARY — the platform adds a knob or
  // renames one — and that is checkable without parsing structure at all: every
  // `Key:` literal in the Go file must appear in the TS tables, and every TS key
  // must appear in Go. The COMPOSITION comes from the TS groups, which are pure
  // data and the side that owns the vocabulary, and the node MAPPING from each
  // `css.go`'s `fieldskin.<Group>` identifier, which is a plain read.
  const goSrc = readFileSync(resolve(repo, 'server/render/nodes/fieldskin/fieldskin.go'), 'utf8');
  const goKeyLiterals = new Set([...goSrc.matchAll(/Key:\s*"([^"]+)"/g)].map((m) => m[1]));
  const tsKeyUnion = new Set(Object.values(GO_GROUPS).flat());
  const missingInTs = [...goKeyLiterals].filter((k) => !tsKeyUnion.has(k));
  const missingInGo = [...tsKeyUnion].filter((k) => !goKeyLiterals.has(k));
  if (missingInTs.length || missingInGo.length) {
    console.error(
      'the field-skin vocabulary has drifted between schema/src/elements/fieldSkin.ts and ' +
        'server/render/nodes/fieldskin/fieldskin.go:',
    );
    if (missingInTs.length) console.error(`  in Go, absent from the TS tables: ${missingInTs.join(', ')}`);
    if (missingInGo.length) console.error(`  in the TS tables, absent from Go: ${missingInGo.join(', ')}`);
    process.exit(1);
  }

  // WHICH NODE EMITS WHICH, from the identifier each css.go names.
  const skinByNode: Record<string, string[]> = {};
  const nodesDir = resolve(repo, 'server/render/nodes');
  for (const entry of readdirSync(nodesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('form')) continue;
    const css = resolve(nodesDir, entry.name, 'css.go');
    if (!existsSync(css)) continue;
    const src = readFileSync(css, 'utf8');
    const named = new Set([...src.matchAll(/fieldskin\.([A-Z][A-Za-z]*)/g)].map((m) => m[1]));
    const keys = new Set<string>();
    for (const n of named) {
      // `RulesFor` is the generic emitter a node passes its own group to; the
      // group is named beside it, so it carries no keys of its own.
      if (n === 'RulesFor') continue;
      for (const k of GO_GROUPS[n] ?? []) keys.add(k);
    }
    if (keys.size) skinByNode[entry.name] = [...keys];
  }
  if (!skinByNode.form?.includes('fieldBg') || skinByNode.form.includes('payCardBg')) {
    console.error('the FORM node no longer emits the input vocabulary, or now emits payCard* — check fieldskin');
    process.exit(1);
  }

  const skinOut = `// GENERATED by scripts/gen-catalog.ts — do not edit by hand.
// Source: <WB_REPO>/schema/src/elements/fieldSkin.ts (the vocabulary) and each
// server/render/nodes/form*/css.go (which node emits which group).

export const FIELD_SKIN_SOURCE = ${JSON.stringify(
    {
      nodes: Object.keys(skinByNode).length,
      keys: [...new Set(Object.values(skinByNode).flat())].length,
    },
    null,
    2,
  )} as const;

/**
 * The field-skin config keys each form node's renderer actually reads.
 *
 * A knob written on a node that is not in its list is stored, saved, published
 * and rendered NOWHERE — the documented case being payCard* on the FORM, which
 * emits only the input vocabulary. Composed from the TS groups and asserted
 * against the Go's own key literals at codegen.
 */
export const FIELD_SKIN_BY_NODE: Record<string, string[]> = ${JSON.stringify(skinByNode, null, 2)};
`;
  emit(resolve(process.cwd(), 'src/catalog/fieldskin.generated.ts'), skinOut);
  console.error(
    `${VERB} fieldskin.generated.ts: ${Object.keys(skinByNode).length} form nodes, ` +
      `${[...new Set(Object.values(skinByNode).flat())].length} distinct skin keys`,
  );

  // ---- What a translation may rewrite ----------------------------------
  //
  // A MULTI-LANGUAGE STORE WAS REACHABLE AND UNSAFE. Every translations route is
  // in the catalog — read, write, auto-fill, the review queue — so an agent can
  // call them and had NO WAY to know which fields are content.
  //
  // The platform's own registry says why that matters, in its opening comment:
  // the element registry declares 117 `(element, special)` pairs across 66 keys
  // and they are INTERLEAVED in one object —
  //
  //   text · label · alt · emptyText · searchPlaceholder            ← content
  //   htmlTag · videoId · filterSource · contentType · src · name   ← NOT
  //
  // — and translating one of the second group does not degrade the page, it
  // BREAKS the render: `name` is a lucide icon id, `src` is a URL,
  // `filterSource` is a registry id the Go predicate switches on. An agent
  // machine-translating a page's specials would hit all three.
  //
  // 156 keys are classified NEVER, and the registry's tripwire asserts every
  // special is classified — translatable, deferred, or never — rather than
  // asserting the translatable ones are listed, because "a positive-only test
  // stays green forever while new elements quietly add strings". Taking the
  // whole classification rather than the allow-list keeps that property here.
  //
  // PURE DATA with no imports (the element registry pulls it in, so reaching
  // back would close a cycle), which is what makes it safe to import directly.
  const trMod = (await import(
    resolve(repo, 'schema/src/elements/translatableFields.ts')
  )) as {
    TRANSLATABLE_SPECIALS: Record<string, ReadonlyArray<{ key: string }>>;
    NEVER_TRANSLATED: readonly string[];
    TRANSLATION_ENTITY_TYPES: readonly string[];
    translatableEntityFieldsFor: (
      entityId: string,
    ) => ReadonlyArray<{ key: string; html?: boolean; list?: string; multiline?: boolean }>;
    isTranslatableSpecial: (elementType: string, key: string) => boolean;
  };

  // The KEYS only. `labelKey` is an i18n key for the merchant's panel — it names
  // a string in the editor's locale files and answers nothing an agent can act
  // on, so carrying it would be weight without reach.
  const trSpecials: Record<string, string[]> = {};
  for (const [type, fields] of Object.entries(trMod.TRANSLATABLE_SPECIALS)) {
    const keys = fields.map((f) => f.key);
    if (keys.length) trSpecials[type] = keys;
  }
  const trEntities: Record<string, unknown[]> = {};
  for (const t of trMod.TRANSLATION_ENTITY_TYPES) {
    const fields = trMod.translatableEntityFieldsFor(t);
    // `node` is in the type list and has no entity fields on purpose: a node
    // translation is keyed by (node id, special), which TRANSLATABLE_SPECIALS
    // is. Recording the empty answer would read as "nothing is translatable".
    if (!fields.length) continue;
    trEntities[t] = fields.map((f) => ({
      key: f.key,
      ...(f.html ? { html: true } : {}),
      ...(f.multiline ? { multiline: true } : {}),
      ...(f.list ? { list: f.list } : {}),
    }));
  }

  // THE TRAP THIS TABLE EXISTS FOR, asserted rather than trusted: an icon's
  // `name` is a lucide id and must never be translated, and a heading's `text`
  // must be. If either flips, the table is describing a different platform.
  if (trMod.isTranslatableSpecial('icon', 'name')) {
    console.error('icon.name is now translatable — it is a lucide icon id; check the registry');
    process.exit(1);
  }
  if (!trMod.isTranslatableSpecial('heading', 'text')) {
    console.error('heading.text is no longer translatable — the registry shape moved');
    process.exit(1);
  }

  const trOut = `// GENERATED by scripts/gen-catalog.ts — do not edit by hand.
// Source: <WB_REPO>/schema/src/elements/translatableFields.ts

export const TRANSLATION_SOURCE = ${JSON.stringify(
    {
      elements: Object.keys(trSpecials).length,
      pairs: Object.values(trSpecials).reduce((n, v) => n + v.length, 0),
      neverKeys: trMod.NEVER_TRANSLATED.length,
      entityTypes: Object.keys(trEntities).length,
    },
    null,
    2,
  )} as const;

/** Every entity type a translation record can name, including "node". */
export const TRANSLATION_ENTITY_TYPES: string[] = ${JSON.stringify([...trMod.TRANSLATION_ENTITY_TYPES], null, 2)};

/**
 * The specials a translation MAY rewrite, per element type.
 *
 * An element absent here has none. That is not an oversight: an icon's only
 * string is a lucide id.
 */
export const TRANSLATABLE_SPECIALS: Record<string, string[]> = ${JSON.stringify(trSpecials, null, 2)};

/**
 * Specials keys that must NEVER be translated, across every element.
 *
 * Translating one of these does not degrade the page — it BREAKS the render.
 * Kept as the platform's whole classification rather than an allow-list,
 * because a positive-only list goes stale silently as elements ship new strings.
 */
export const NEVER_TRANSLATED: string[] = ${JSON.stringify([...trMod.NEVER_TRANSLATED].sort(), null, 2)};

/** The columns a translation may rewrite on each entity, SEO fields included. */
export const TRANSLATABLE_ENTITY_FIELDS: Record<
  string,
  Array<{ key: string; html?: boolean; multiline?: boolean; list?: string }>
> = ${JSON.stringify(trEntities, null, 2)};
`;
  emit(resolve(process.cwd(), 'src/catalog/translations.generated.ts'), trOut);
  console.error(
    `${VERB} translations.generated.ts: ${Object.keys(trSpecials).length} elements / ` +
      `${Object.values(trSpecials).reduce((n, v) => n + v.length, 0)} translatable specials, ` +
      `${trMod.NEVER_TRANSLATED.length} never-translated keys, ` +
      `${Object.keys(trEntities).length} entity types`,
  );

  // ---- The theme -------------------------------------------------------
  //
  // DESIGN RULE 0 FAILS BY CONSTRUCTION ON NINE ELEMENTS, and this is the half
  // that makes it fail. "Read the page's pattern off what is there" assumes a
  // node's style HOLDS what it paints. Since THEME_VERSION 6 that is no longer
  // true: element defaults are moving OUT of `meta.defaults.style` and into
  // theme PRESETS the element wears, and `icon/meta.ts` says so outright — "The
  // COLOUR lives in the `icon-default` style preset, not here: a node's own slot
  // outranks its preset, so seeding it made every other icon preset unable to
  // repaint it."
  //
  // So `sb_node_read` on an icon returns a style with no colour in it, on a page
  // that is visibly painting one. An agent following rule 0 reads nothing and
  // invents — and the literal it then writes OUTRANKS the preset permanently,
  // detaching that node from the theme for every future palette change.
  //
  // A preset compiles to a CLASS rule beneath the node's own values
  // (`compilePresetCSS`), so the node keeps overriding it the ordinary way. The
  // layer is real, ordered, and was invisible here.
  //
  // WHAT IS GENERATED IS THE STARTER THEME, AND IT IS NOT THE SITE'S. A site
  // stores its own, and `GET /api/sites/{siteId}/theme` is the authority — which
  // is why `src/domains/site/theme.ts` resolves against a FETCHED theme and
  // falls back to this one only for a site that has never customised. Shipping
  // the starter as if it were the answer would hand an agent a confident wrong
  // colour, which is worse than none.
  const themeMod = (await import(resolve(repo, 'schema/src/theme.ts'))) as {
    THEME_VERSION: number;
    DEFAULT_THEME: {
      colors: Array<{ id: string; name: string; value: string }>;
      textStyles: Array<{ id: string; name: string; slug?: string }>;
      schemes?: Array<{ id: string; name: string; roles?: Record<string, string> }>;
      presets?: Array<{
        id: string;
        name: string;
        kind: string;
        draft?: boolean;
        base: Record<string, string>;
        responsive?: Record<string, Record<string, string>>;
        states?: { hover?: Record<string, string> };
      }>;
      lightSchemeId?: string;
      darkSchemeId?: string;
    };
    PRESET_KINDS: readonly string[];
  };
  const dt = themeMod.DEFAULT_THEME;
  // Drafts are a LISTING rule, never a rendering one — a draft still resolves
  // for a node that already references it — so they are kept, with the flag.
  const starterPresets = (dt.presets ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    ...(p.draft ? { draft: true } : {}),
    base: p.base,
    ...(p.responsive ? { responsive: p.responsive } : {}),
    ...(p.states?.hover ? { states: { hover: p.states.hover } } : {}),
  }));

  // WHICH ELEMENT WEARS WHICH PRESET, read off `meta.defaults.specials`. That is
  // where the platform stores it, so `createNode` already seeds it correctly —
  // the gap was never minting, it was READING BACK.
  const elementPresets: Record<string, string> = {};
  for (const [type, meta] of Object.entries(registry.ELEMENTS)) {
    const preset = (meta as { defaults?: { specials?: Record<string, unknown> } }).defaults?.specials
      ?.stylePreset;
    if (typeof preset === 'string' && preset) elementPresets[type] = preset;
  }
  // A default naming a preset the starter theme does not hold resolves to
  // nothing and renders unstyled — the exact failure THEME_VERSION 6 was bumped
  // for. Refuse rather than ship a table with a dangling reference in it.
  const presetIds = new Set(starterPresets.map((p) => p.id));
  const danglingPresets = Object.entries(elementPresets).filter(([, id]) => !presetIds.has(id));
  if (danglingPresets.length) {
    console.error('element defaults name a preset the starter theme does not hold:');
    for (const [t, id] of danglingPresets) console.error(`  ${t} → ${id}`);
    process.exit(1);
  }

  const themeOut = `// GENERATED by scripts/gen-catalog.ts — do not edit by hand.
// Source: <WB_REPO>/schema/src/theme.ts (DEFAULT_THEME) and the element metas.
import type { StarterTheme } from './theme-types.js';

export const THEME_SOURCE = ${JSON.stringify(
    {
      themeVersion: themeMod.THEME_VERSION,
      presets: starterPresets.length,
      colors: dt.colors.length,
      textStyles: dt.textStyles.length,
      schemes: (dt.schemes ?? []).length,
      elementsWearingOne: Object.keys(elementPresets).length,
    },
    null,
    2,
  )} as const;

export const PRESET_KINDS: string[] = ${JSON.stringify([...themeMod.PRESET_KINDS], null, 2)};

/**
 * The element type -> style preset its meta.defaults.specials names.
 *
 * createNode already seeds this, so a node minted here wears the right preset.
 * The table exists for the READ side: it says which elements have a style layer
 * their own "style" object does not contain.
 */
export const ELEMENT_PRESETS: Record<string, string> = ${JSON.stringify(elementPresets, null, 2)};

/**
 * The STARTER theme — what a site that has never customised its theme resolves
 * against. NOT the authority for a live site: GET /api/sites/{siteId}/theme is,
 * and domains/site/theme.ts prefers it whenever it can be fetched.
 */
export const STARTER_THEME: StarterTheme = ${JSON.stringify(
    {
      version: themeMod.THEME_VERSION,
      colors: dt.colors,
      textStyles: dt.textStyles,
      schemes: dt.schemes ?? [],
      lightSchemeId: dt.lightSchemeId,
      darkSchemeId: dt.darkSchemeId,
      presets: starterPresets,
    },
    null,
    2,
  )};
`;
  emit(resolve(process.cwd(), 'src/catalog/theme.generated.ts'), themeOut);
  console.error(
    `${VERB} theme.generated.ts: theme v${themeMod.THEME_VERSION}, ${starterPresets.length} presets, ` +
      `${dt.colors.length} colors, ${dt.textStyles.length} text styles, ` +
      `${(dt.schemes ?? []).length} schemes, ${Object.keys(elementPresets).length} elements wearing one`,
  );

  // THE ICON VOCABULARY, so an importer can LOOK A NAME UP rather than guess one.
  //
  // `specials.name` on an `icon` is a PascalCase RemixIcon id and the catalog
  // holds 3,227 of them (`schema/src/iconManifest.json`, the same JSON the
  // editor's picker and the Go renderer share). Nothing in this catalog carried
  // them, so `sb_import` could not turn a source page's `<svg>` into an `icon`
  // at all — a guessed name renders nothing, and inventing one is the failure
  // this table exists to prevent. Read as JSON rather than imported: the module
  // beside it pulls in the icon BODIES too, which is a megabyte of SVG this
  // repo has no use for.
  const iconManifestPath = join(repo, 'schema/src/iconManifest.json');
  if (!existsSync(iconManifestPath)) {
    console.error(`schema/src/iconManifest.json is missing from ${repo} — is WB_REPO stale?`);
    process.exit(1);
  }
  const iconManifest = JSON.parse(readFileSync(iconManifestPath, 'utf8')) as Array<{ name: string }>;
  const iconNames = iconManifest.map((e) => e.name).filter(Boolean).sort();
  if (iconNames.length < 1000) {
    console.error(`only ${iconNames.length} icon names — is WB_REPO stale?`);
    process.exit(1);
  }
  // The two poles: the platform's own default, and a name its element hint
  // offers as an example. If either stops existing the manifest is a different
  // icon set and every mapping built on it is wrong.
  for (const must of ['StarFill', 'ArrowRightFill']) {
    if (!iconNames.includes(must)) {
      console.error(`the icon manifest no longer holds ${must} — is this still RemixIcon?`);
      process.exit(1);
    }
  }
  const iconsOut = `// GENERATED by scripts/gen-catalog.ts — do not edit by hand.
// Source: <WB_REPO>/schema/src/iconManifest.json (the RemixIcon catalog the
// editor's picker and the Go renderer share).
export const ICON_SOURCE = ${JSON.stringify({ names: iconNames.length, default: 'StarFill' }, null, 2)} as const;

/**
 * Every icon name this platform can render.
 *
 * A LOOKUP, not a suggestion list. \`sb_import\` reads a name off a source page's
 * \`<svg>\` — an aria-label, a \`<use href="#icon-search">\`, a \`ri-search-line\`
 * class — and may only emit an \`icon\` when the name it derived is IN here. A
 * name that is not renders nothing, which is worse than the \`<svg>\` being
 * skipped, because the page then carries an empty box nobody put there.
 */
export const ICON_NAMES: ReadonlySet<string> = new Set(${JSON.stringify(iconNames)});
`;
  emit(resolve(process.cwd(), 'src/catalog/icons.generated.ts'), iconsOut);
  console.error(`${VERB} icons.generated.ts: ${iconNames.length} icon names`);

  const dest = resolve(process.cwd(), 'src/catalog/api.generated.ts');
  emit(dest, out);
  console.error(
    `${VERB} ${dest}: ${ops.length} operations, ` +
      `${Object.keys(spec.definitions ?? {}).length} definitions, ` +
      `${withBody.filter((o) => !o.bodyDescribed).length}/${withBody.length} with an undescribed body`,
  );
}

/**
 * Rewrite a seeded document's node ids to stable ones.
 *
 * `createNode` mints a random id per node, so re-running codegen produced a file
 * that differed in every id and nothing else — 82 lines of diff on a generator
 * whose input had not changed, which trains a reader to skip the diff. The order
 * of `nodes` is creation order and is deterministic, so numbering by it is too.
 *
 * These ids are a placeholder, not a value: `sb_store` mints fresh ones on every
 * run, exactly as the editor does, so two checkouts never share a node id.
 */
function stableIds<T extends { nodes: Record<string, unknown> }>(doc: T, prefix: string): T {
  const map = new Map<string, string>();
  let n = 0;
  for (const id of Object.keys(doc.nodes)) map.set(id, `${prefix}_${++n}`);
  let json = JSON.stringify(doc);
  // Longest first, so one id is never rewritten inside another.
  for (const [from, to] of [...map].sort((a, b) => b[0].length - a[0].length)) {
    json = json.split(from).join(to);
  }
  return JSON.parse(json) as T;
}

await main();
reportDrift();

/**
 * An element's defaults plus the bindings its default config implies.
 *
 * `datasetBindings` is the platform's own factory and is pure in (type, config),
 * so calling it here bakes the same answer the editor would produce at drop
 * time. Elements it has nothing to say about keep their defaults untouched, so
 * the generated file grows only where a binding actually exists.
 */
/**
 * The two click-action allow-lists an element meta may declare.
 *
 * Copied rather than normalised: a trigger listed with a MISSING array means
 * "every action this trigger offers", and flattening that to `[]` would turn
 * "unrestricted" into "nothing allowed" — the direction that silently refuses a
 * legitimate write. A meta that declares neither key contributes neither.
 */
function declaredEvents(em: {
  events?: Record<string, string[] | undefined>;
  bindingEvents?: Record<string, string[] | undefined>;
}): Partial<Pick<CatalogElement, 'events' | 'bindingEvents'>> {
  const take = (t?: Record<string, string[] | undefined>) => {
    if (!t) return undefined;
    const out: Record<string, string[]> = {};
    for (const [trigger, actions] of Object.entries(t)) {
      if (Array.isArray(actions)) out[trigger] = [...actions];
    }
    return Object.keys(out).length ? out : undefined;
  };
  const events = take(em.events);
  const bindingEvents = take(em.bindingEvents);
  return { ...(events ? { events } : {}), ...(bindingEvents ? { bindingEvents } : {}) };
}

function withBindings(
  type: string,
  defaults: CatalogElement['defaults'],
  factory: (type: string, config: Record<string, unknown>) => unknown[],
): CatalogElement['defaults'] {
  let bindings: unknown[] = [];
  try {
    bindings = factory(type, (defaults.config ?? {}) as Record<string, unknown>) ?? [];
  } catch {
    bindings = [];
  }
  return bindings.length > 0 ? { ...defaults, bindings } : defaults;
}

/**
 * Every binding set an element can need, keyed `"<datasetSource>|<kind>"`.
 *
 * The factory is pure in (type, config) and reads exactly two keys off it, so
 * the whole answer space is a cross product this can enumerate offline. The
 * candidates are the entity axes and field kinds the platform's own dataset
 * elements offer; a combination the factory does not recognise simply repeats
 * an answer already in the table and is dropped, which is what keeps it small.
 *
 * `sb_set` reads this when a caller rewrites `kind` or `datasetSource`. Without
 * it the node keeps the OLD entity's bindings and renders the wrong field, or
 * nothing, in silence.
 */
function bindingTable(
  type: string,
  defaults: CatalogElement['defaults'],
  factory: (type: string, config: Record<string, unknown>) => unknown[],
): { bindingsFor?: Record<string, unknown[]> } {
  // Declared HERE, not at module scope: this file runs `main()` at the top
  // level, so a const below that call is still in its temporal dead zone.
  const BIND_SOURCES = ['product', 'category', 'article', 'course', 'instructor', 'blogCategory'];
  const BIND_KINDS = [
    'title', 'vendor', 'description', 'summary', 'content', 'author', 'date',
    'image', 'price', 'prices', 'url', 'name',
  ];
  const base = (defaults.config ?? {}) as Record<string, unknown>;
  const table: Record<string, unknown[]> = {};
  const seen = new Set<string>();
  for (const datasetSource of BIND_SOURCES) {
    for (const kind of BIND_KINDS) {
      let got: unknown[] = [];
      try {
        got = factory(type, { ...base, datasetSource, kind }) ?? [];
      } catch {
        continue;
      }
      if (got.length === 0) continue;
      const fingerprint = JSON.stringify(got);
      // One entry per DISTINCT answer: an element that ignores `kind` would
      // otherwise store the same array seventy-two times.
      if (seen.has(fingerprint)) {
        const already = Object.entries(table).find(([, v]) => JSON.stringify(v) === fingerprint);
        if (already) table[`${datasetSource}|${kind}`] = already[1];
        continue;
      }
      seen.add(fingerprint);
      table[`${datasetSource}|${kind}`] = got;
    }
  }
  return Object.keys(table).length > 0 ? { bindingsFor: table } : {};
}
