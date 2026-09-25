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
import { reportInertDrift } from './inert-drift.js';
import { deadKeysModule, reportDeadKeys, scanDeadKeys } from './deadkey-scan.js';
import { credentialFor } from '../src/transport/credential.js';
import { PAGE_ROOT_ID, remapIds } from '../src/domains/site/ids.js';
import type { ApiOperation, ApiParam } from '../src/catalog/types.js';
import type {
  CatalogElement,
  NodeSeed,
  SatelliteRule,
  TraitDescription,
  ValueVocabulary,
  WritePrecondition,
} from '../src/catalog/element-types.js';

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

/**
 * THE ELEMENTS A `filterBehavior: "navigate"` CAN ACTUALLY REACH, and the value
 * word itself — both read out of Go.
 *
 * `filterBehavior` is one key with three values, and the third is not a property
 * of the KEY but of the SHAPE that renders it. The four option-list filters draw
 * a row per value and a row can become an `<a href>`; a `select` draws
 * `<option>`, which no href can live on — `dropdown/html.go` reads `"event"` and
 * nothing else, so a select set to navigate publishes an ordinary dropdown and
 * the setting changes nothing.
 *
 * That is the exact defect this table exists to prevent, arriving one level
 * below the one it was built for. The rule it already applies — "a key an
 * element does not SEED is a key it does not have" — is not enough here: the
 * select genuinely seeds `filterBehavior`. The missing half is that a VALUE no
 * renderer reads is a value the element does not have either.
 *
 * READ FROM THE REGISTRATION, not from a list here and not from the config
 * dialog's own `v-if`. Three reasons, in the order they matter:
 *
 *  - The dialog gates the option correctly today, but a picker proves what ONE
 *    consumer offers; the renderer proves what the platform can do. A second
 *    surface that writes this key (this server is one) is outside that gate.
 *  - `filtershared.WriteHTML` is the only navigate branch in the tree, so the
 *    set is exactly its callers — no join to keep in step. A fifth filter
 *    registered through it is covered on the next codegen with no edit here,
 *    and an element that stops routing through it loses the value the same way.
 *  - Mapping through `generated.Element*` rather than the DIRECTORY name is what
 *    keeps it honest for the case that motivated it: `select` lives in
 *    `nodes/dropdown`, so a directory-keyed reader would have been right about
 *    the select by accident and wrong about the next one on purpose.
 *
 * ABSENT IS SILENT, PRESENT-AND-UNREADABLE EXITS 1 — the discipline every reader
 * in this file follows. A tree with no `filtershared` is a tree with no filter
 * elements and yields nothing; a `filtershared` whose behaviour const no longer
 * parses would make this table WRONG rather than short.
 */
function readNavigableFilters(repo: string): { value: string; types: string[] } | null {
  const sharedPath = resolve(repo, 'server/render/nodes/filtershared/filtershared.go');
  if (!existsSync(sharedPath)) return null;
  const behavior = /BehaviorNavigate\s*=\s*"([a-z]+)"/.exec(readFileSync(sharedPath, 'utf8'));
  if (!behavior) {
    console.error(
      'filtershared.BehaviorNavigate no longer reads as a string const — the navigate ' +
        'behaviour moved, and this table would publish it for elements that ignore it',
    );
    process.exit(1);
  }
  const genPath = resolve(repo, 'server/render/generated/schema_gen.go');
  if (!existsSync(genPath)) return null;
  const typeOf = new Map<string, string>();
  const consts = /^\s*(Element[A-Za-z0-9]+)\s+ElementType\s*=\s*"([^"]+)"/gm;
  for (const m of readFileSync(genPath, 'utf8').matchAll(consts)) typeOf.set(m[1], m[2]);
  const registers =
    /nodes\.Register(?:Tree)?\(\s*generated\.(Element[A-Za-z0-9]+)\s*,\s*filtershared\.WriteHTML/g;
  const dir = resolve(repo, 'server/render/nodes');
  const types = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const f of readdirSync(resolve(dir, entry.name))) {
      if (!f.endsWith('.go') || f.endsWith('_test.go')) continue;
      for (const m of readFileSync(resolve(dir, entry.name, f), 'utf8').matchAll(registers)) {
        const t = typeOf.get(m[1]);
        if (t) types.add(t);
      }
    }
  }
  if (types.size === 0) {
    console.error(
      'nothing registers filtershared.WriteHTML — the filter renderers moved, and every ' +
        'element would silently lose the navigate behaviour',
    );
    process.exit(1);
  }
  return { value: behavior[1], types: [...types].sort() };
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
 * Scoped to the FIVE directories this script actually reads, so an unrelated
 * edit elsewhere in a big monorepo is not a reason to refuse. `--dirty` is the
 * deliberate override, for the one legitimate case: generating against a change
 * you are making yourself, to see what it would produce.
 *
 * `runtime/src` is the fifth and arrived last, with the 3D vocabularies read
 * out of the browser island (Source C). It is the same file-for-file exposure
 * the other four have: an agent told a shader id that only exists on somebody's
 * unpushed branch is in exactly the position this check exists to prevent.
 * `runtime/dist` is deliberately NOT covered — it is minified, it is generated,
 * and nothing here reads it.
 */
function assertCommitted(repo: string): void {
  if (process.argv.includes('--dirty')) {
    console.error('warning: --dirty — reading a working tree, so half-finished work can ship');
    return;
  }
  const read = ['schema/src', 'editor/src', 'server/render', 'server/docs', 'runtime/src'];
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

  // WHAT A SETTING NEEDS FROM ITS NEIGHBOURS, read from the platform's own
  // declaration rather than inferred.
  //
  // Every vocabulary above publishes ONE key's legal values, which is all an
  // agent could learn — so a filter written with `filterValueMode: "auto"` and
  // `filterSource: "blog_category"` passed every check this catalog had and
  // published a filter that renders NOTHING. Both values are legal; the pair is
  // not. That is this repo's worst outcome reaching the one surface with no way
  // to see it coming, and a per-key table cannot express it by construction.
  //
  // IMPORTED, not parsed: the module is pure data and the generator already
  // imports the registry beside it, so there is no text to get wrong. The
  // declaration itself is pinned to both Go renderers by
  // `schema/test/filter-preconditions.test.ts`, which is what makes it worth
  // republishing here rather than re-deriving.
  //
  // ABSENT IS SILENT, the rule every reader in this file follows: a checkout
  // whose schema has no such module publishes no preconditions and says so by
  // the count, rather than this table being WRONG.
  const preMod = (await import(
    resolve(repo, 'schema/src/filters/preconditions.ts')
  ).catch(() => ({}))) as { FILTER_PRECONDITIONS?: unknown[] };
  const preconditions = (preMod.FILTER_PRECONDITIONS ?? []) as unknown[];
  console.error(`  write preconditions the schema declares: ${preconditions.length}`);

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
      // The click-action allow-lists `declaredEvents` reads. They were MISSING
      // from this annotation, which made that call a type error nothing ever
      // saw: `scripts/**` is outside both tsconfigs, so `npm run build` never
      // typechecks this file. It worked only because the cast is a lie the
      // runtime object does not share — and the obvious way to silence the
      // error would have been to drop the call, which would have emptied
      // `events` for every element and taken `open_cart` with it.
      events?: Record<string, string[] | undefined>;
      bindingEvents?: Record<string, string[] | undefined>;
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
    intensities: string[];
    intensityDurations: Record<string, number>;
    triggers: string[];
    rangeDefault: number;
    repeatMax: number;
    alternateNeedsInfinite: boolean;
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
    // ---- THE FIVE FIELDS THE OBJECT GREW ON 2026-09-11 --------------------
    //
    // `config.animation` went from five keys to ten, and the catalog describing
    // five of them is worse than describing none: an agent reads the table,
    // sees the shape it names, and concludes the rest does not exist. That is
    // the stale-hint cost this repo keeps paying — "a hint that says you cannot
    // outlives the thing that made it true" — and here it would hide the
    // headline feature, a reveal-on-scroll that the platform can finally do.
    //
    // EACH IS READ UNDER ONE RULE: a name that is ABSENT from the source means
    // this deployment does not have the field, and the catalog says nothing
    // about it; a name that is PRESENT but no longer parses means the shape
    // moved, and the table would be WRONG rather than missing, so that exits 1.
    // The same split the duration default already makes, applied per field.
    const optional = <T>(name: string, parse: (src: string) => T | null, absent: T): T => {
      if (!src.includes(name)) return absent;
      const got = parse(src);
      if (got === null) {
        console.error(
          `${name} is still in server/render/style but no longer reads as a vocabulary — ` +
            'the animation table would be wrong rather than missing',
        );
        process.exit(1);
      }
      return got;
    };

    // AnimIntensityVars keys the three intensities. ABSENCE IS NOT `medium`:
    // the platform's own comment says a document with no intensity keeps the
    // old 0.5s fallback, which is why the duration table is read beside it.
    const intensities = optional<string[]>(
      'AnimIntensityVars',
      (s) => {
        const from = s.indexOf('var AnimIntensityVars =');
        if (from < 0) return null;
        const body = s.slice(from, s.indexOf('\n}', from));
        const keys = [...body.matchAll(/^\s*"([a-z]+)":\s*\{/gm)].map((m) => m[1]);
        return keys.length ? keys : null;
      },
      [],
    );
    // What each intensity implies when no duration is stored — `strong` travels
    // 64px, and the 0.5s meant for 30px would make it look wrong rather than
    // strong.
    const intensityDurations = optional<Record<string, number>>(
      'AnimIntensityDuration',
      (s) => {
        const m = /var AnimIntensityDuration = map\[string\]float64\{([^}]*)\}/.exec(s);
        if (!m) return null;
        const out: Record<string, number> = {};
        for (const p of m[1].matchAll(/"([a-z]+)":\s*([0-9.]+)/g)) out[p[1]] = Number(p[2]);
        return Object.keys(out).length ? out : null;
      },
      {},
    );
    // THE SCROLL TRIGGER, which this repo's own notes said had no answer at all.
    // Read off the COMPILER's comparison rather than a table, because there is
    // no table — one value is special-cased into an `@supports` override, and
    // the file's header says a second ("play once on entry") will arrive as a
    // third value rather than by redefining this one.
    const triggers = optional<string[]>(
      'a.trigger ==',
      (s) => {
        const vals = [...s.matchAll(/a\.trigger == "([a-z_]+)"/g)].map((m) => m[1]);
        return vals.length ? [...new Set(vals)] : null;
      },
      [],
    );
    const rangeDefault = optional<number>(
      'AnimRangeDefault',
      (s) => {
        const m = /AnimRangeDefault = ([0-9]+)/.exec(s);
        return m ? Number(m[1]) : null;
      },
      60,
    );
    const repeatMax = optional<number>(
      'AnimRepeatMax',
      (s) => {
        const m = /AnimRepeatMax = ([0-9]+)/.exec(s);
        return m ? Number(m[1]) : null;
      },
      0,
    );
    // THE GUARD WORTH CARRYING, because it is the one new field whose obvious
    // use ends with the node INVISIBLE. `alternate` with an EVEN finite count
    // finishes on the `from` keyframe, and every entrance keyframe starts at
    // opacity:0 — so "fade in, twice, reversing" publishes a node the author
    // can see on the canvas and cannot see on the page. animRepeat enforces
    // `alternate` only alongside `infinite`; a caller who does not know that
    // writes a reverse that is silently dropped.
    const alternateNeedsInfinite = /if a\.alternate \{\s*return "infinite", "alternate"/.test(src);

    return {
      types: types.sort(),
      easings,
      easingFallback: 'ease',
      durationDefault: dur ? Number(dur[1]) : 0.5,
      intensities,
      intensityDurations,
      triggers,
      rangeDefault,
      repeatMax,
      alternateNeedsInfinite,
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

  // ---- The same question for the other 75 string keys -------------------
  //
  // `CONFIG_VALUES` answered three keys, because three `Effective*` normalizers
  // are the only place the platform spells a vocabulary in the ONE shape that
  // reader knows. 150 config keys are seeded across the catalog and 78 of them
  // are string-valued, so 75 had no legal-value list anywhere an agent can read
  // — and a guess fails silently, which is the entire reason that table exists.
  //
  // TWO MORE SOURCES, and the rule that decides between them is the whole of
  // this block: PUBLISH A VOCABULARY ONLY WHEN ITS SOURCE PROVES COMPLETENESS.
  // A partial list is worse than none — it tells an agent that a value which
  // works is invalid, and an agent that believes it will "fix" a working page.
  //
  //   A. A Go `switch` over a config key. The `default:` arm is the proof: it
  //      catches everything the cases do not, so the cases ARE the vocabulary
  //      and the default says what an unrecognised value becomes. A switch with
  //      no `default:` is accepted only when every arm RETURNS A STRING and a
  //      `return` follows the switch — that is a normaliser, and the trailing
  //      return is its else. Nothing else qualifies, and the rejections matter
  //      more than the acceptances (see `rejected` below).
  //
  //   B. The editor's own picker. `schema/src/traits/registry.ts` declares each
  //      trait's exact write target and `editor/src/trait/widgets.ts` carries the
  //      inline `options` array the author picks from — the COMPLETE list by
  //      construction, since it is what the control renders.
  //
  // KEYED BY ELEMENT, which is the correction that makes the table safe at all.
  // A write-key-keyed table is what `CONFIG_VALUES` is, and it only works
  // because its three keys happen to be globally unique. MEASURED, these are
  // not: `config.layout` is seeded by BOTH `media-dataset` ("bottom") and
  // `list-dataset` ("grid") and the two renderers read different words;
  // `specials.source` is written by `breadcrumb_source` (auto|manual) AND
  // `qr_source` (text|page); `config.placement` is read by three renderers with
  // three different case sets. Any of those handed to the wrong element is a
  // confident wrong answer. An element scope has none of that ambiguity, and it
  // is what both callers already have — `sb_traits_for` answers for one element
  // and `sb_set` knows the node's type.
  //
  // NEVER DERIVE THE WRITE KEY FROM THE CONTROL NAME. The obvious
  // snake_case→camelCase guess was tested against all 13 joined controls and was
  // wrong for 11: `divider_orientation` writes `config.orientation`,
  // `dropdown_align` writes `config.panelAlign`, `cart_total_part` writes
  // `specials.part`. The registry's own `writes[0]` is the only source.
  // A brace-matched body for `<key>: {`, skipping strings AND comments. The
  // comments are not a nicety: `widgets.ts` writes `// TRANSFORM_OPTIONS' text
  // cells`, and a scanner that reads that apostrophe as a string opener runs
  // past the entry and gives one control another control's options — measured,
  // it handed `text_transform` the member-field vocabulary (name|email|phone).
  const braceBody = (src: string, open: number): string | null => {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      const n = src[i + 1];
      if (c === '/' && n === '/') {
        i = src.indexOf('\n', i);
        if (i < 0) return null;
        continue;
      }
      if (c === '/' && n === '*') {
        i = src.indexOf('*/', i);
        if (i < 0) return null;
        i += 1;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return src.slice(open + 1, i);
      }
    }
    return null;
  };
  const topLevelEntries = (src: string): Map<string, string> => {
    const out = new Map<string, string>();
    for (const m of src.matchAll(/^ {2}([A-Za-z0-9_]+):\s*\{/gm)) {
      const b = braceBody(src, m.index + m[0].length - 1);
      if (b !== null) out.set(m[1], b);
    }
    return out;
  };

  // ---- Source A: the Go switch --------------------------------------------
  const goVocab = (): Array<{ scope: string; vocab: ValueVocabulary }> => {
    const root = resolve(repo, 'server/render');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.go') && !e.name.endsWith('_test.go')) files.push(p);
      }
    };
    walk(root);
    // Every candidate site, keyed by config key, so a key read by SEVERAL
    // renderers with different case sets can be detected and dropped rather
    // than resolved by whichever file the walk reached first.
    const sites: Array<{ key: string; scope: string; vocab: ValueVocabulary }> = [];
    const rejected: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const rel = file.slice(root.length + 1);
      // `nodes/<element>/…` names the element outright; anything else is a
      // shared helper, which scopes to '*' and is offered to any element that
      // actually carries the key.
      const dir = /^nodes\/([a-z0-9-]+)\//.exec(rel);
      const scope = dir ? dir[1] : '*';
      const fn = (at: number): string => {
        const f = src.lastIndexOf('\nfunc ', at);
        const m = f < 0 ? null : /^\nfunc\s+(?:\([^)]*\)\s*)?([A-Za-z0-9_]+)/.exec(src.slice(f, f + 120));
        return m ? `${rel}:${m[1]}` : rel;
      };
      const read = (key: string, subject: string | null, open: number, at: number) => {
        const body = braceBody(src, open);
        if (body === null) return;
        // Arms, split at top-level `case`/`default` labels.
        const arms: Array<{ labels: string | null; lines: string[] }> = [];
        let depth = 0;
        let cur: { labels: string | null; lines: string[] } | null = null;
        for (const line of body.split('\n')) {
          const t = line.trim();
          const label = depth === 0 ? /^(?:case\s+(.*)|default)\s*:$/.exec(t) : null;
          if (label) {
            if (cur) arms.push(cur);
            cur = { labels: label[1] ?? null, lines: [] };
          } else if (cur && t && !t.startsWith('//')) cur.lines.push(t);
          for (const ch of line) {
            if (ch === '{' || ch === '(') depth++;
            else if (ch === '}' || ch === ')') depth--;
          }
        }
        if (cur) arms.push(cur);
        const values: string[] = [];
        for (const a of arms) {
          if (a.labels === null) continue;
          for (const lit of a.labels.matchAll(/"((?:[^"\\]|\\.)*)"/g)) values.push(lit[1]);
        }
        if (!values.length) {
          rejected.push(`${fn(at)} ${key}: no string case labels`);
          return;
        }
        // A GUARD IS NOT A VOCABULARY, AND THE `default:` ARM DOES NOT TELL
        // THEM APART. The ruling above — a switch with a `default:` proves
        // completeness — is FALSE for a switch used as a FILTER, and this
        // reader shipped a wrong list on npm because of it.
        //
        //   switch ConfigString(node, "backgroundSceneSource", "") {
        //   case "effect", "gallery":   // ← EMPTY. no return, no value.
        //   default:
        //       return ""               // ← an early exit; "" is a CSS string
        //   }                           //   here, not a value of the key.
        //
        // `bgSceneColorRule` asks "does this source support custom colours",
        // which is a different question from "what may this key hold" — the
        // answer to that one is five words (`nodes/helpers.go:bgSceneProps`
        // switches on four of them, and `''` means OFF), so the reader
        // published two of five and called the other three invalid.
        //
        // THE DISCRIMINATOR IS MECHANICAL: a normaliser's case arms RETURN; a
        // guard's matching arm is EMPTY, because its whole purpose is to fall
        // through to the code after the switch. Go has no implicit
        // fallthrough, so an empty arm can mean nothing else. Checked against
        // all seven sites this reader keeps — `popup/html.go:triggerType`,
        // both `position` readers, `media-dataset`'s `layout` and
        // `mediaRatioCss`, `product-image-feature`'s two — every one returns
        // from every arm, and `bgSceneColorRule` was the only guard.
        const empty = arms.find((a) => a.labels !== null && !a.lines.length);
        if (empty) {
          rejected.push(`${fn(at)} ${key}: a guard, not a normaliser — case "${empty.labels}" is empty`);
          return;
        }
        const one = (lines: string[]): string | null =>
          lines.length === 1 ? (/^return\s+(.+)$/.exec(lines[0])?.[1] ?? null) : null;
        const asString = (expr: string | null): { v: string } | { subject: true } | null => {
          if (expr === null) return null;
          const lit = /^"((?:[^"\\]|\\.)*)"$/.exec(expr.trim());
          if (lit) return { v: lit[1] };
          if (subject && expr.trim() === subject) return { subject: true };
          return null;
        };
        const dflt = arms.find((a) => a.labels === null);
        let fallback: string | undefined;
        let open_: true | undefined;
        if (dflt) {
          // A `default:` arm PROVES completeness whatever the other arms do,
          // so the cases are taken as-is — but the default's own value must be
          // readable. `product-image-list`'s is a guarded lookup against a
          // preset list the switch never names, and its own comment warns that
          // such a switch "looks like a closed enumeration and is not one": the
          // vocabulary really does include seven ratio strings that are absent
          // here, so it is rejected rather than half-published.
          const d = asString(one(dflt.lines));
          if (!d) {
            rejected.push(`${fn(at)} ${key}: default arm is not a plain return`);
            return;
          }
          if ('subject' in d) open_ = true;
          else fallback = d.v;
        } else {
          // No default: this is only a vocabulary if it is a NORMALISER — every
          // arm returns a string and a `return` follows the switch as its else.
          // `dataset-block`'s `case "product", "category": return true` is the
          // shape this rejects, and must: `datasetSource` has many more legal
          // values and a two-word list would call the rest invalid.
          for (const a of arms) {
            if (a.labels === null) continue;
            if (!asString(one(a.lines))) {
              rejected.push(`${fn(at)} ${key}: no default arm and an arm does not return a string`);
              return;
            }
          }
          const after = src.slice(open + body.length + 2);
          const tail = /^\s*return\s+("(?:[^"\\]|\\.)*")\s*$/m.exec(after.split('\n').slice(0, 2).join('\n'));
          if (!tail) {
            rejected.push(`${fn(at)} ${key}: no default arm and no trailing return`);
            return;
          }
          fallback = tail[1].slice(1, -1);
        }
        if (fallback !== undefined && !values.includes(fallback)) values.unshift(fallback);
        sites.push({
          key,
          scope,
          vocab: {
            target: 'config',
            writeKey: key,
            values: [...new Set(values)].sort(),
            ...(fallback !== undefined ? { fallback } : {}),
            ...(open_ ? { open: true as const } : {}),
            readBy: fn(at),
          },
        });
      };
      // A1 — `switch [x := ]nodes.ConfigString(n, "key", "d") [; x] {`
      for (const m of src.matchAll(
        /switch\s+(?:([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*)?(?:[A-Za-z]+\.)?ConfigString\(\s*[A-Za-z_][A-Za-z0-9_]*\s*,\s*"([^"]+)"\s*,\s*"([^"]*)"\s*\)\s*(?:;\s*([A-Za-z_][A-Za-z0-9_]*)\s*)?\{/g,
      )) {
        read(m[2], m[4] ?? m[1] ?? null, m.index + m[0].length - 1, m.index);
      }
      // A2 — the assign-then-switch the ratio helpers use:
      // `mode, _ := cfg["mediaImageRatio"].(string)` … `switch mode {`.
      // The assignment is looked for inside the ENCLOSING FUNCTION only: a
      // 1500-character lookback attributed `PanelDown(align string)`'s switch to
      // its caller's `cfg["panelAlign"]`, which was right by luck and would not
      // be next time.
      for (const m of src.matchAll(/switch\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g)) {
        const subject = m[1];
        const from = src.lastIndexOf('\nfunc ', m.index);
        const before = src.slice(from < 0 ? 0 : from, m.index);
        const a = [
          ...before.matchAll(
            new RegExp(`${subject}\\s*,\\s*_\\s*:=\\s*[A-Za-z_][A-Za-z0-9_]*\\["([^"]+)"\\]\\.\\(string\\)`, 'g'),
          ),
        ].pop();
        const b = [
          ...before.matchAll(
            new RegExp(
              `${subject}\\s*:=\\s*(?:[A-Za-z]+\\.)?ConfigString\\(\\s*[A-Za-z_][A-Za-z0-9_]*\\s*,\\s*"([^"]+)"\\s*,\\s*"[^"]*"\\s*\\)`,
              'g',
            ),
          ),
        ].pop();
        const key = a?.[1] ?? b?.[1];
        if (!key) continue;
        read(key, subject, m.index + m[0].length - 1, m.index);
      }
    }
    // A KEY READ BY SEVERAL RENDERERS IS NOT ONE VOCABULARY. `config.placement`
    // is read by `dropdown` (top|left|right), `popover` (bottom|left|right) and
    // `overlayplace` (top|bottom) — each complete for its own element and none
    // of them the answer for the others. Element-scoped they would each be
    // right, but a disagreement that large says the renderers are reading
    // different things, so the key is left to the editor's picker, which names
    // all four. Kept per element only when every site agrees.
    const byKey = new Map<string, typeof sites>();
    for (const s of sites) byKey.set(s.key, [...(byKey.get(s.key) ?? []), s]);
    const out: Array<{ scope: string; vocab: ValueVocabulary }> = [];
    for (const [key, group] of byKey) {
      if (new Set(group.map((s) => JSON.stringify(s.vocab.values))).size > 1) {
        rejected.push(`config.${key}: ${group.length} renderers disagree on the case set`);
        continue;
      }
      for (const s of group) out.push({ scope: s.scope, vocab: s.vocab });
    }
    console.error(
      `  config vocabularies from server/render: ${out.length} kept, ${rejected.length} sites declined`,
    );
    return out;
  };

  // ---- Source B: registry ⋈ the editor's picker ----------------------------
  const editorVocab = (): Map<string, { target: 'config' | 'specials'; writeKey: string; values: string[] }> => {
    const reg = topLevelEntries(readFileSync(resolve(repo, 'schema/src/traits/registry.ts'), 'utf8'));
    const wid = topLevelEntries(readFileSync(resolve(repo, 'editor/src/trait/widgets.ts'), 'utf8'));
    if (reg.size < 100 || wid.size < 100) {
      console.error(
        `traits registry / widgets no longer parse as entries (${reg.size} / ${wid.size}) — the file shape moved`,
      );
      process.exit(1);
    }
    const out = new Map<string, { target: 'config' | 'specials'; writeKey: string; values: string[] }>();
    for (const [key, body] of wid) {
      // ONLY AN INLINE ARRAY. `text_transform` and `html_tag` name a shared
      // const (`TRANSFORM_OPTIONS`, `htmlTagOptions()`), which this cannot read
      // — and a source that is absent means say nothing, never guess.
      const opts = /options:\s*\[([\s\S]*?)\n\s*\]/.exec(body);
      if (!opts) continue;
      const values = [...opts[1].matchAll(/\{\s*value:\s*'([^']*)'/g)].map((m) => m[1]);
      if (!values.length) continue;
      const w = /writes:\s*\[\s*\{\s*target:\s*'([a-z]+)'\s*,\s*writeKey:\s*'([^']+)'/.exec(reg.get(key) ?? '');
      // `style` is OPEN CSS and needs no vocabulary; a control with no declared
      // write has no target to attach one to.
      if (!w || (w[1] !== 'config' && w[1] !== 'specials')) continue;
      out.set(key, { target: w[1] as 'config' | 'specials', writeKey: w[2], values });
    }
    console.error(`  control vocabularies from the editor's pickers: ${out.size}`);
    return out;
  };

  // ---- Source C, GENERALISED: every vocabulary the schema DECLARES ---------
  //
  // The two readers below are HAND-WRITTEN, one per feature — `sceneVocab` for
  // the 3D surfaces, `filterVocab` for the storefront filters — and the platform
  // declares faster than this repo writes readers. MEASURED at this commit:
  // `schema/src` holds 57 exported array declarations and those two readers name
  // FOUR of them. `form-calendar` alone declares three, seeds a key against each
  // (`defaultMode`, `acceptedDates`, `picker`), and `sb_traits_for form-calendar`
  // said nothing about any of them.
  //
  // TWO DECLARATION SHAPES, AND THE SECOND IS THE COMMON ONE:
  //
  //   export const DATE_PICKERS = ['native', 'grid'] as const;
  //
  //   export const OPTION_SOURCES: OptionSource[] = [
  //     OPTION_SOURCE.MANUAL, OPTION_SOURCE.PRODUCT, …   // ← members of an
  //   ];                                                 //   `as const` object
  //
  // Reading only the first missed `optionSource`, which `form-select`,
  // `form-radio` and `form-checkbox` all seed and the platform has declared all
  // along. A member reference is resolved against the `as const` OBJECT it names;
  // ONE THAT CANNOT BE RESOLVED DROPS THE WHOLE LIST rather than shortening it,
  // because a vocabulary missing a value is the defect this table exists to
  // prevent — it tells an agent that a working word is invalid.
  //
  // WHAT MAKES A TYPED ARRAY A VOCABULARY AT ALL. `as const` is the platform's
  // own mark that the members ARE the set. A typed array proves less, so it is
  // taken only when its element type is NAMED (`OptionSource[]`,
  // `Breakpoint[]`): that is the platform saying "these are the members of this
  // closed type", where `readonly string[]` says only "some strings"
  // (`WALKER_ONLY_SPECIALS`, `RAW_SINK_BINDING_FIELDS`) and is refused. An array
  // of OBJECTS resolves to no literals at all, which is what turns away
  // `FIELD_SKIN_KNOBS`, `STARTER_PRESETS` and the `*_TARGET_FIELDS` set without
  // a single name being special-cased. And where every member comes from one
  // `as const` object, the list must name EVERY member of it — otherwise it is a
  // curated SUBSET (`CONDITION_OPS_WITH_VALUE` is literally that), and a subset
  // published as a vocabulary is a partial list wearing a declaration's clothes.
  //
  // THE JOIN IS THE WHOLE DIFFICULTY, AND THE NAME IS NOT THE JOIN. `DATE_PICKERS`
  // governs `picker`; nothing mechanical turns one into the other, and this repo
  // already measured what name-DERIVATION costs — the snake_case→camelCase guess
  // was wrong for 11 of the 13 controls Source B joins (`divider_orientation`
  // writes `config.orientation`). So a key is never derived from a name, and the
  // join needs TWO INDEPENDENT PIECES OF EVIDENCE, one of which is always the
  // seeded value:
  //
  //   1. THE SEED IS IN THE LIST. `form-calendar` seeds `picker: 'native'` and
  //      `DATE_PICKERS` contains `native`. The same reasoning that put `''` in
  //      `backgroundSceneSource` and kept it out of `filterSource`.
  //
  //   2a. LOCALITY, for a declaration under `schema/src/elements/<type>/` — it is
  //      a candidate for `<type>`'s own seeded keys and for nothing else.
  //
  //   2b. THE DECLARATION'S OWN NAME NAMES THE KEY, for a SHARED declaration,
  //      and this one was forced by measurement. Letting a shared list join on
  //      the seed value ALONE was tried first, on the brief's reasoning that
  //      rule 1 would carry it: MEASURED, IT CANNOT — that produced 17 joins on
  //      this tree and every single one was wrong. `filterBehavior: "filter"`
  //      joined `HOVER_PRESET_STYLE_KEYS`, a list of CSS PROPERTY NAMES that
  //      happens to contain the word `filter`; `qr-code`'s `source: "text"`
  //      joined `SCHEME_ROLES`; `datasetSource: "product"` and `filterSource:
  //      "category"` both joined `TRANSLATION_ENTITY_TYPES`. An ordinary English
  //      word sitting in an unrelated subsystem's list is indistinguishable from
  //      a governing vocabulary, and four of those joins would have OVERWRITTEN
  //      correct entries `filterVocab` and Source B already publish.
  //
  //      So a shared list must also be NAMED for the key — `OPTION_SOURCES` for
  //      `optionSource`, ignoring case, underscores and a plural. This is a
  //      REFUSAL and never a derivation: it can only reject a value match the
  //      name contradicts, never invent a key. MEASURED, it admits
  //      `optionSource` on all three elements that seed it and turns away all 27
  //      shared value-matches on this tree, the original 17 among them. What it
  //      costs is real and known: `FIELD_PATTERN_VALUES`' own doc comment says
  //      "Every value `specials.patternPreset` may hold", `form-text` seeds
  //      exactly that key, and the name does not correspond, so this reader
  //      stays silent about it. That answer lives in the inspector row that
  //      WRITES the key (`FieldPatternRow.vue` → `setNodeValue(…,
  //      'patternPreset', v)`), which is Source B's kind of evidence.
  //
  //   3. EXACTLY ONE CANDIDATE, IN BOTH DIRECTIONS. Two lists containing one
  //      seed is a coin flip: `spline-scene` seeds `speed: 'normal'` AND
  //      `intensity: 'normal'`, and `SCENE_SPEEDS` and `SCENE_INTENSITIES` both
  //      carry `normal`, so neither key is joined here (`sceneVocab` answers both
  //      from the key mapping the editor declares). The MIRROR matters as much:
  //      one list matching two keys on the same element is equally unresolvable,
  //      so all of its matches are dropped rather than the first one taken.
  //
  //   4. A SEED OF `''` IS NOT EVIDENCE. 119 elements seed some key as the empty
  //      string, so `''` discriminates nothing — and `BACKGROUND_SCENE_SOURCES`
  //      carries `''` as a real value, which is exactly the shape that would
  //      attach a scene vocabulary to every empty URL and label an element seeds.
  //
  // A LIST OF KEY NAMES IS NOT A VOCABULARY, AND NOTHING FILTERS ONE BY NAME.
  // `BACKGROUND_SCENE_RESPONSIVE_KEYS`, `BACKGROUND_SCENE_BASE_ONLY_KEYS` and
  // `HOVER_PRESET_STYLE_KEYS` list KEYS, and `TRANSLATION_ENTITY_TYPES` /
  // `SCHEME_ROLES` belong to other subsystems entirely; all five are read by the
  // scan, offered to the join like any other list, and rejected by the rules
  // above on their own. That is the property that lets the scan be WIDE and the
  // join NARROW — a name-based exclusion would hide the day one of them starts
  // surviving. So the five are ASSERTED instead: each must still be FOUND, and
  // each must have joined NOTHING. The first half catches the scan breaking, the
  // second catches the join loosening, and both were checked by breaking them.
  const declaredVocab = (): Array<{ scope: string; vocab: ValueVocabulary }> => {
    const root = resolve(repo, 'schema/src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) files.push(p);
      }
    };
    walk(root);
    // Bracket- or brace-matched, COMMENTS SKIPPED BEFORE STRINGS — the same trap
    // `filterVocab` records one delimiter over, and `theme.ts` springs it:
    // `PRESET_KINDS` carries a paragraph of prose inside the array ("a node",
    // "it alone has"), and a scanner that reads one of those apostrophes as a
    // string opener runs past the closing bracket and returns the rest of the
    // file as members.
    const closes = (src: string, open: number, o: string, c: string): number | null => {
      let depth = 0;
      for (let i = open; i < src.length; i++) {
        const ch = src[i];
        const n = src[i + 1];
        if (ch === '/' && n === '/') {
          i = src.indexOf('\n', i);
          if (i < 0) return null;
          continue;
        }
        if (ch === '/' && n === '*') {
          i = src.indexOf('*/', i);
          if (i < 0) return null;
          i += 1;
          continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') {
          for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++;
          continue;
        }
        if (ch === o) depth++;
        else if (ch === c && --depth === 0) return i;
      }
      return null;
    };
    const commentless = (body: string): string =>
      body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    // `export const OPTION_SOURCE = { MANUAL: 'manual', … } as const` — the
    // enum a typed array's members are spelled through. Only a body that is
    // ENTIRELY `NAME: 'literal'` pairs is kept: anything else (a nested object,
    // a computed key, a number) means a member could resolve to something that
    // is not a string, and half an enum is the partial list this refuses.
    const objects = new Map<string, Record<string, string>>();
    type Raw = { name: string; rel: string; body: string; asConst: boolean; elem: string | null };
    const raw: Raw[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const rel = f.slice(root.length + 1);
      for (const m of src.matchAll(/(?:^|\n)export const ([A-Za-z0-9_]+)\s*=\s*\{/g)) {
        const open = m.index + m[0].length - 1;
        const end = closes(src, open, '{', '}');
        if (end === null || !/^\s*as const\b/.test(src.slice(end + 1, end + 20))) continue;
        const body = commentless(src.slice(open + 1, end));
        const pairs = [...body.matchAll(/([A-Za-z0-9_]+)\s*:\s*'([^']*)'/g)];
        const rest = body.replace(/[A-Za-z0-9_]+\s*:\s*'[^']*'/g, '').replace(/[\s,]/g, '');
        if (rest.length || !pairs.length) continue;
        objects.set(m[1], Object.fromEntries(pairs.map((p) => [p[1], p[2]])));
      }
      for (const m of src.matchAll(/(?:^|\n)export const ([A-Za-z0-9_]+)\s*(:\s*[^=\n]*)?=\s*\[/g)) {
        const open = m.index + m[0].length - 1;
        const end = closes(src, open, '[', ']');
        if (end === null) continue;
        // The ELEMENT type of `T[]`, `readonly T[]`, `ReadonlyArray<T>` — null
        // when there is no annotation at all.
        let ann = (m[2] ?? '').replace(/^:\s*/, '').replace(/^readonly\s+/, '').trim();
        const wrap = /^(?:ReadonlyArray|Array)<(.+)>$/.exec(ann);
        if (wrap) ann = wrap[1].trim();
        else if (ann.endsWith('[]')) ann = ann.slice(0, -2).trim();
        else ann = '';
        raw.push({
          name: m[1],
          rel,
          body: commentless(src.slice(open + 1, end)),
          asConst: /^\s*as const\b/.test(src.slice(end + 1, end + 20)),
          elem: ann || null,
        });
      }
    }
    const byName = new Map(raw.map((d) => [d.name, d]));
    const cache = new Map<string, string[] | null>();
    const membersOf = (name: string, seen: Set<string>): string[] | null => {
      const hit = cache.get(name);
      if (hit !== undefined) return hit;
      const d = byName.get(name);
      if (!d || seen.has(name)) return null;
      seen.add(name);
      const named = d.elem !== null && !/^(?:string|any|unknown)$/.test(d.elem);
      if (!d.asConst && !named) {
        cache.set(name, null);
        return null;
      }
      // Anything left after the literals, the `...spreads`, the `OBJ.MEMBER`
      // references and the punctuation means a member this reader cannot read —
      // `WEEKDAYS` is ISO day NUMBERS, `FIELD_SKIN_KNOBS` is objects — and the
      // list is dropped rather than truncated.
      const rest = d.body
        .replace(/'[^']*'/g, '')
        .replace(/\.\.\.\s*[A-Za-z0-9_]+/g, '')
        .replace(/[A-Za-z0-9_]+\.[A-Za-z0-9_]+/g, '')
        .replace(/[\s,]/g, '');
      const acc: string[] = [];
      const from = new Set<string>();
      let ok = rest.length === 0;
      if (ok) {
        // `FIELD_PATTERN_VALUES` is literally `['', ...FIELD_PATTERN_PRESETS,
        // 'custom']`, so a reader taking the quoted words alone would publish a
        // TWO-value list for a seven-value key.
        for (const s of d.body.matchAll(/\.\.\.\s*([A-Za-z0-9_]+)/g)) {
          const v = membersOf(s[1], seen);
          if (!v) {
            ok = false;
            break;
          }
          acc.push(...v);
        }
      }
      if (ok) {
        for (const r of d.body.matchAll(/([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/g)) {
          const v = objects.get(r[1])?.[r[2]];
          if (v === undefined) {
            ok = false;
            break;
          }
          from.add(r[1]);
          acc.push(v);
        }
      }
      if (ok) acc.push(...[...d.body.matchAll(/'([^']*)'/g)].map((x) => x[1]));
      // A list drawing on one enum must name ALL of it, or it is a curated
      // subset. Drawing on two is not an enumeration of either.
      if (ok && from.size === 1) {
        const all = objects.get([...from][0]) as Record<string, string>;
        ok = Object.values(all).every((v) => acc.includes(v));
      }
      if (ok && from.size > 1) ok = false;
      const uniq = [...new Set(acc)];
      const r = ok && uniq.length > 1 ? uniq : null;
      cache.set(name, r);
      return r;
    };
    type Decl = { name: string; rel: string; scope: string | null; values: string[] };
    const usable: Decl[] = [];
    for (const d of raw) {
      const local = /^elements\/([a-z0-9-]+)\//.exec(d.rel);
      const scope = local && elements[local[1]] ? local[1] : null;
      // A declaration under an element directory that names no element in the
      // registry belongs to nothing this catalog describes.
      if (local && !scope) continue;
      const values = membersOf(d.name, new Set());
      if (values) usable.push({ name: d.name, rel: d.rel, scope, values });
    }
    // `OPTION_SOURCES` for `optionSource`: case, underscores and a plural are
    // spelling, not meaning. Nothing else is normalised — a rule that reached
    // further would start deriving rather than corroborating.
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const namesTheKey = (decl: string, key: string) => {
      const d = norm(decl);
      const k = norm(key);
      return d === k || d === `${k}s` || d === `${k}es`;
    };
    const out: Array<{ scope: string; vocab: ValueVocabulary }> = [];
    const joined = new Set<string>();
    let ambiguous = 0;
    let contradicted = 0;
    for (const [type, el] of Object.entries(elements)) {
      const hits: Array<{ target: 'config' | 'specials'; key: string; decl: Decl }> = [];
      for (const target of ['config', 'specials'] as const) {
        const seeded = (el.defaults?.[target] ?? {}) as Record<string, unknown>;
        for (const [key, seed] of Object.entries(seeded)) {
          if (typeof seed !== 'string' || seed === '') continue;
          const match = usable.filter(
            (d) =>
              (d.scope === null || d.scope === type) &&
              d.values.includes(seed) &&
              (d.scope === type || namesTheKey(d.name, key)),
          );
          contradicted += usable.filter(
            (d) =>
              d.scope === null && d.values.includes(seed) && !namesTheKey(d.name, key),
          ).length;
          if (match.length === 1) hits.push({ target, key, decl: match[0] });
          else if (match.length > 1) ambiguous++;
        }
      }
      for (const h of hits) {
        if (hits.filter((o) => o.decl.name === h.decl.name).length > 1) {
          ambiguous++;
          continue;
        }
        joined.add(h.decl.name);
        out.push({
          scope: type,
          vocab: {
            target: h.target,
            writeKey: h.key,
            values: [...h.decl.values].sort(),
            readBy: `${h.decl.name} (schema/src/${h.decl.rel})`,
          },
        });
      }
    }
    // A list of KEY NAMES published as the legal VALUES of a key is the one
    // outcome this reader must never produce. Nothing filters these by name, so
    // the assertion is what stands between them and the table — and each must
    // still be FOUND, because a scan that stopped parsing would satisfy "joined
    // nothing" while having read nothing at all.
    for (const name of [
      'BACKGROUND_SCENE_RESPONSIVE_KEYS',
      'BACKGROUND_SCENE_BASE_ONLY_KEYS',
      'HOVER_PRESET_STYLE_KEYS',
      'TRANSLATION_ENTITY_TYPES',
      'SCHEME_ROLES',
    ]) {
      if (!byName.has(name)) {
        console.error(`${name} is gone from schema/src — the declaration scan drifted`);
        process.exit(1);
      }
      if (joined.has(name)) {
        console.error(`${name} is a list of key names and was joined to a key — the join loosened`);
        process.exit(1);
      }
    }
    if (!out.length) {
      console.error('no declared vocabulary joined to any key — the declaration scan drifted');
      process.exit(1);
    }
    console.error(
      `  declared vocabularies from the schema's own lists: ${out.length} joined, ` +
        `${usable.length - joined.size} of ${usable.length} readable declarations matched nothing ` +
        `(${raw.length} scanned, ${ambiguous} declined as ambiguous, ${contradicted} shared ` +
        `value-matches the name contradicts)`,
    );
    return out;
  };

  // ---- Source C: a DECLARED list, and the 3D feature that needed one ------
  //
  // A and B both read an IMPLEMENTATION — a renderer's switch, a picker's
  // inline options — so each can only answer for a key whose implementation
  // happens to enumerate it. The platform's 3D feature enumerates nothing
  // either of them can see: the four shader ids live in the browser ISLAND
  // (`runtime/`, a workspace this script had never read), the six built-in
  // scenes are derived from a catalogue of builder functions, and the two word
  // scales are `as const` arrays in the schema. Twelve keys across two
  // surfaces, every one of them a NAME an agent cannot author without the list
  // — the same argument that put 46 animation type names in this catalog.
  //
  // WHY A DECLARATION IS SAFE WHERE A GUARD IS NOT (see the rejection in
  // `goVocab`): it is the platform's own statement of the COMPLETE set,
  // written to be the one place the value is spelled. `BACKGROUND_SCENE_SOURCES`
  // is the case that proves the difference in both directions — it carries
  // FIVE values where `bgSceneProps` switches on four, because `''` means OFF
  // and its own header calls that "the load-bearing state" that every carrier
  // seeds. A reader that recovered `bgSceneProps`' four would have published a
  // list calling the seeded default invalid, which is the same defect as the
  // guard, one value smaller.
  //
  // THE KEY MAPPING IS READ, NEVER GUESSED. `editor/src/trait/sceneKeys.ts`
  // declares both surfaces as `SceneVocabulary` objects whose every slot names
  // its own namespace and key — `effect: cfg('effect')` on the inline element,
  // `effect: cfg('backgroundSceneEffect')` behind a section, `source:
  // special('source')` against `cfg('backgroundSceneSource')` — so one idea's
  // two spellings come from the file that owns them. That is `KEY_FOR`'s rule
  // one level up: a slot name is not a write key, and a surface that declares
  // `null` for a slot (the background layer has no grain, the inline element
  // no scrim) says so rather than being probed for a key it lacks.
  //
  // ABSENT IS SILENT, PRESENT-AND-UNPARSEABLE EXITS 1. `runtime/` is a
  // standalone workspace; a checkout without it lacks the island, which is a
  // deployment fact rather than a reason to publish a guess. A file that IS
  // there and no longer yields its list means the table would be WRONG rather
  // than missing, and this reader's whole defect history is wrong-not-missing.
  const sceneVocab = (): Array<{ scope: string; vocab: ValueVocabulary }> => {
    const file = (rel: string): string | null => {
      const p = resolve(repo, rel);
      return existsSync(p) ? readFileSync(p, 'utf8') : null;
    };
    // A flat `[...]` of single-quoted literals, by declaration name. `export`
    // is OPTIONAL, and that latitude is now unused rather than wrong: the one
    // slot that needed it read `COLOR_MODES` out of `ScenePaletteRows.vue`,
    // where it was private to a single inspector component. The platform moved
    // that list into the schema beside the two word scales it belongs with
    // (`SCENE_COLOR_MODES`, web_builder `a401a1c5`), leaving the component with
    // `const COLOR_MODES = SCENE_COLOR_MODES` — an alias, not a list — so this
    // reader exited 1 naming the slot, which is wrong-not-missing working.
    // Keeping the latitude costs nothing and the next private list will want it.
    const listOf = (src: string, name: string): string[] | null => {
      const m = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\b[^=\\n]*=\\s*\\[([^\\]]*)\\]`).exec(src);
      if (!m) return null;
      const v = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
      return v.length ? v : null;
    };
    // The ids out of an array of OBJECTS. `GALLERY_SCENE_IDS` is derived
    // (`GALLERY_CATALOGUE.map((s) => s.id)`) on purpose — its own comment says
    // a seventh scene must be "one entry rather than an entry plus an id in a
    // parallel list that nothing holds in step" — so the catalogue is what
    // there is to read.
    const idsOf = (src: string, name: string): string[] | null => {
      const m = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\b[^=\\n]*=\\s*\\[`).exec(src);
      if (!m) return null;
      // The regex's own last character IS the opening bracket. Searching for
      // the first `[` after the declaration instead finds the one inside the
      // TYPE — `: readonly GalleryScene[]` — which matches and closes at once,
      // and the catalogue reads as empty.
      const open = m.index + m[0].length - 1;
      // Bracket-matched rather than `braceBody`, which counts braces and would
      // stop at the first `{ id: … }` — one scene of six.
      let depth = 0;
      for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (c === "'" || c === '"' || c === '`') {
          for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
          continue;
        }
        if (c === '[') depth++;
        else if (c === ']' && --depth === 0) {
          const v = [...src.slice(open + 1, i).matchAll(/\bid:\s*'([^']*)'/g)].map((x) => x[1]);
          return v.length ? v : null;
        }
      }
      return null;
    };
    // THE ASSERTIONS LIVE HERE RATHER THAN IN THE TABLE-LEVEL BLOCK BELOW, and
    // that placement is the whole of "absent is silent". An assertion outside
    // this reader cannot tell a vocabulary that DRIFTED from one this
    // deployment simply does not have, so it fires on both — and a checkout
    // without `runtime/` would then be refused rather than described honestly.
    // Measured: with `runtime/` absent the reader correctly falls to eight
    // vocabularies, and an outer `gradient-mesh` assertion turned that into an
    // exit 1. In here the file is in hand, so the question is answerable.
    const named = (rel: string, name: string, how: 'list' | 'ids', must: string): string[] | null => {
      const src = file(rel);
      if (src === null) return null;
      const v = how === 'ids' ? idsOf(src, name) : listOf(src, name);
      if (!v) {
        console.error(`${name} no longer reads as a list in ${rel} — a 3D vocabulary source moved`);
        process.exit(1);
      }
      if (!v.includes(must)) {
        console.error(`${name} in ${rel} no longer offers "${must}" — a 3D vocabulary source moved`);
        process.exit(1);
      }
      return v;
    };
    // Each list in the file that OWNS it. The two word scales are read from
    // the schema rather than from the island's own `SPEED`/`INTENSITY` tables:
    // those are private, numeric, and hand-mirrored, while `SCENE_SPEEDS`'
    // header records that they moved to the schema precisely so a second
    // surface could share one declaration.
    // `must` is one value that has to survive, so a shape change is caught by
    // the RUN rather than by a reader noticing a short list months later.
    const SLOTS: Record<string, { rel: string; name: string; how: 'list' | 'ids'; must: string }> = {
      effect: { rel: 'runtime/src/services/effect-shaders.ts', name: 'EFFECT_IDS', how: 'list', must: 'gradient-mesh' },
      gallery: { rel: 'runtime/src/services/gallery-scenes.ts', name: 'GALLERY_CATALOGUE', how: 'ids', must: 'podium' },
      speed: { rel: 'schema/src/elements/spline-scene/meta.ts', name: 'SCENE_SPEEDS', how: 'list', must: 'slow' },
      intensity: { rel: 'schema/src/elements/spline-scene/meta.ts', name: 'SCENE_INTENSITIES', how: 'list', must: 'soft' },
      colors: { rel: 'schema/src/elements/spline-scene/meta.ts', name: 'SCENE_COLOR_MODES', how: 'list', must: 'custom' },
    };
    // Which file each surface's `sources:` identifier lives in, the write key
    // that surface must still produce, and one value that must still be in it.
    // This is the slot the defect was in, and the only one whose list differs
    // between the two surfaces: `''` is OFF on the layer and is absent from the
    // inline element, where an unset `source` means Spline instead.
    const SOURCE_LISTS: Record<string, { rel: string; must: string }> = {
      SCENE_SOURCES: { rel: 'schema/src/elements/spline-scene/meta.ts', must: 'model' },
      BACKGROUND_SCENE_SOURCES: { rel: 'schema/src/elements/backgroundScene.ts', must: '' },
    };
    const SOURCE_KEY: Record<string, string> = {
      INLINE_SCENE_KEYS: 'source',
      BACKGROUND_SCENE_KEYS: 'backgroundSceneSource',
    };
    const keysRel = 'editor/src/trait/sceneKeys.ts';
    const keys = file(keysRel);
    if (keys === null) return [];
    const out: Array<{ scope: string; vocab: ValueVocabulary }> = [];
    for (const [object, scope] of [
      ['INLINE_SCENE_KEYS', 'spline-scene'],
      ['BACKGROUND_SCENE_KEYS', '*'],
    ] as const) {
      const at = keys.indexOf(`export const ${object}`);
      if (at < 0) {
        console.error(`${object} is gone from ${keysRel} — the 3D key mapping moved`);
        process.exit(1);
      }
      const body = braceBody(keys, keys.indexOf('{', at));
      if (body === null) {
        console.error(`${object} no longer reads as an object in ${keysRel}`);
        process.exit(1);
      }
      const slot = (name: string): { target: 'config' | 'specials'; key: string } | null => {
        const m = new RegExp(`\\n\\s*${name}:\\s*(cfg|special)\\('([^']+)'\\)`).exec(body);
        return m ? { target: m[1] === 'cfg' ? 'config' : 'specials', key: m[2] } : null;
      };
      const add = (name: string, rel: string, list: string[] | null, from: string): string | null => {
        const s = slot(name);
        if (!s || !list) return null;
        out.push({
          scope,
          vocab: {
            target: s.target,
            writeKey: s.key,
            values: [...new Set(list)].sort(),
            readBy: `${from} (${rel})`,
          },
        });
        return s.key;
      };
      const sourcesName = /\n\s*sources:\s*([A-Z_]+)/.exec(body)?.[1];
      if (!sourcesName || !SOURCE_LISTS[sourcesName]) {
        console.error(`${object} no longer names a source list in ${keysRel}`);
        process.exit(1);
      }
      const { rel, must } = SOURCE_LISTS[sourcesName];
      const wrote = add('source', rel, named(rel, sourcesName, 'list', must), sourcesName);
      // The source slot is the one every other slot hangs off, and it is the
      // key `sb_set` warns on, so a rename that silently dropped it — or moved
      // it to another key — would take the whole surface with it. Skipped only
      // when the LIST's own file is absent, which is the deployment case.
      if (wrote === null && file(rel) !== null) {
        console.error(`${object} no longer declares its source slot in ${keysRel}`);
        process.exit(1);
      }
      if (wrote !== null && wrote !== SOURCE_KEY[object]) {
        console.error(`${object}'s source slot now writes "${wrote}", not "${SOURCE_KEY[object]}"`);
        process.exit(1);
      }
      for (const [name, s] of Object.entries(SLOTS)) {
        add(name, s.rel, named(s.rel, s.name, s.how, s.must), s.name);
      }
    }
    console.error(`  3D vocabularies from the platform's own declarations: ${out.length}`);
    return out;
  };

  // ---- Source C again: the STOREFRONT FILTER surface ----------------------
  //
  // `specials.filterSource` decides WHAT a filter control is pointed at, six
  // elements seed it, and THIRTEEN values are legal — and the catalog carried
  // none of them. Measured against each element's own prose (`contentTips` +
  // `useWhen` + `avoidWhen` + `description`), the six named between 0 and 5 of
  // the 13 and not one named the full set: filter-checkbox 5, filter-color 3,
  // filter-radio 2, filter-slider 1, select 1, filter-tag 0.
  //
  // THE MISS IS SILENT, and worse than the normaliser cases this table was
  // built for. `getFilterSource(id)` returns `undefined` for an unknown id —
  // no throw — and `filtershared.go` writes `data-filter-source="<whatever was
  // stored>"` verbatim into the published markup. The island then hydrates
  // owning a query parameter the server answers for nobody, so the shopper gets
  // a filter control that narrows NOTHING. Stored, saved, published, rendered.
  //
  // WHY THIS IS SOURCE C AND NOT A GO SWITCH OR A PICKER. `filters/sources.ts`
  // opens by declaring itself "PURE DATA — no imports, and nothing here may
  // import element meta", it is the one place a source is spelled, and it
  // exports its own accessors. That is the same proof-of-completeness the 3D
  // reader above relies on, and the opposite of the guard that produced this
  // repo's `backgroundSceneSource` defect: a `switch` proves what one consumer
  // BRANCHES on, a registry proves what the platform HAS.
  //
  // THE SORT IS THE THIRTEENTH AND IT IS DELIBERATELY NOT IN THE TABLE.
  // `SORT_SOURCE` sits beside `FILTER_SOURCES` with a header explaining that
  // every consumer of the table would be wrong about it — the facet endpoint
  // would derive values from the catalogue, the query parsers would write
  // `f.sort=` — while a sort actually writes `s=` / `s.<node>=`. It is still a
  // value `specials.filterSource` legally holds: the config dialog's Sort |
  // Filter tab writes exactly that word (`setKind`), and `select` SEEDS it. A
  // twelve-value list would declare an element's own default invalid, which is
  // the `backgroundSceneSource` defect arriving from the other direction.
  //
  // FOUR SIBLING KEYS RIDE ALONG, and they are NOT hand-listed. Every key the
  // config dialog writes into `specials` from a draft field whose type in
  // `FilterConfig` is a closed union of string literals is published with that
  // union: `filterValueMode` (all | manual), `filterMatch` (any | all),
  // `filterArity` ('' | single | multi) and `filterBehavior` (filter | event).
  // The draft field is NOT derivable from the node key — `matchMode` writes
  // `filterMatch`, `behavior` writes `filterBehavior`, `label` writes
  // `customName` — so the mapping is read off the dialog's own `setNodeValue`
  // calls, which is `KEY_FOR`'s rule one level up: a slot name is not a write
  // key. A field typed `string` (source, axis, label) or `T[]` (targets,
  // values) yields nothing and is silent rather than guessed at.
  //
  // AND THE NAME COLLISION IS THE TRAP THIS ARRANGEMENT AVOIDS. `sources.ts`
  // exports a type called `FilterValueMode` whose members are
  // `catalog | fixed | range | authored | text` — a property of the SOURCE, not
  // the value of `specials.filterValueMode`, which is `all | manual` and lives
  // under the same name in `editor/src/features/filters/types.ts`. A reader
  // that matched on the type NAME would publish five words for a key whose
  // seeded default is not one of them.
  //
  // THE SEEDED VALUE IS UNIONED IN, and that is `backgroundSceneSource`'s
  // lesson stated as code rather than as a comment. `filterArity` seeds `''`
  // on all four option-list filters and `''` is load-bearing — it means "follow
  // the SHAPE", a radio holding one and everything else many — while the
  // dialog RESOLVES it away and its union therefore names only the two the
  // author picks. A value the platform itself seeds is legal by construction,
  // so it can never be missing from a list this catalog publishes.
  // ---- Source D: THE META'S OWN `VOCAB` -----------------------------------
  //
  // THE PLATFORM NOW DECLARES WHAT THIS REPO HAD TO INFER, AND THE INFERENCE
  // CANNOT REACH EVERYTHING.
  //
  // `declaredVocab` above scans for `as const` lists and then does the hard
  // part — deciding WHICH KEY each one governs — from the seeded value, the
  // declaration's own name and its locality. Its comment is honest about the
  // cost: a shared list whose name does not correspond to the key is refused
  // outright, and two lists that both contain one element's seed are both
  // dropped. Neither is hypothetical. MEASURED on this tree, three vocabularies
  // are unreachable by any amount of inference:
  //
  //   - `cart-drawer` and `hamburger-menu` write `config.direct` from the
  //     SHARED `DRAWER_EDGES`, and no name-based rule turns `DRAWER_EDGES` into
  //     `direct`, so rule 2b refuses it. Which edge the cart drawer slides in
  //     from is not an exotic key.
  //   - `tab` seeds `tabAlign: 'left'` while carrying BOTH `TAB_ALIGNS` and
  //     `TAB_POSITIONS`, which intersect at `left` — so rule 3 drops both
  //     candidates. The platform's own guard names that exact pair as why it
  //     added an identity check ("`tab` now carries two lists that intersect at
  //     each other's seeds").
  //
  // `VOCAB` ends the guessing by stating the mapping: a meta exports
  // `{ '<namespace>.<key>': LIST } satisfies ElementVocabulary`, attached to
  // that meta's own `meta.type`. There is no join left to get wrong.
  //
  // AND IT IS GUARDED UPSTREAM, which is what makes it worth more than the
  // scan. `schema/test/element-vocabularies.test.ts` asks four things of every
  // entry — is the seed a member (at base AND at every breakpoint), does the
  // inspector row RENDER from the list rather than merely import it, is every
  // member reachable, and is it the RIGHT list, checked by array IDENTITY
  // against a second independent table because so many of these lists are
  // near-neighbours. A scan on this side can prove none of that.
  //
  // THIS IS A MIGRATION IN PROGRESS, which is the real argument for reading the
  // declaration rather than patching the join. The platform audited its
  // inspector and found 42 rows holding a value list privately against 15 that
  // imported one; 18 elements have moved so far. A reader keyed on the
  // declaration takes each of the rest on the next codegen with no edit here,
  // where every one would otherwise arrive as another hole in the table or
  // another special case in the join.
  //
  // ABSENT IS SILENT, PRESENT-AND-MALFORMED EXITS 1, the rule every reader here
  // follows. A checkout whose metas declare no `VOCAB` yields nothing and says
  // so; a `VOCAB` that no longer parses into `<namespace>.<key>` pairs, or that
  // hangs off a meta with no `type`, means this table would be WRONG rather
  // than short.
  //
  // A NAMESPACE OUTSIDE config/specials IS A REFUSAL AND NOT A SKIP.
  // `ElementVocabulary` is typed `Record<string, readonly string[]>`, so nothing
  // upstream stops a `style.*` entry — and `vocabularyForWrite` answers for
  // those two namespaces only, so one would be read by nothing here. A skip
  // would under-report exactly the way the holes above do; the exit makes
  // teaching this reader a new namespace a deliberate act.
  const metaVocab = async (): Promise<Array<{ scope: string; vocab: ValueVocabulary }>> => {
    const dir = resolve(repo, 'schema/src/elements');
    if (!existsSync(dir)) return [];
    const out: Array<{ scope: string; vocab: ValueVocabulary }> = [];
    let metas = 0;
    const dirs = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const e of dirs) {
      const rel = `schema/src/elements/${e.name}/meta.ts`;
      const abs = resolve(repo, rel);
      if (!existsSync(abs)) continue;
      const mod = (await import(abs)) as {
        meta?: { type?: string };
        VOCAB?: Record<string, readonly string[]>;
      };
      if (!mod.VOCAB) continue;
      metas++;
      const type = mod.meta?.type;
      if (!type) {
        console.error(`${rel} exports VOCAB but no meta.type to attach it to`);
        process.exit(1);
      }
      // The IDENTIFIER the entry points at, for `readBy` — `DRAWER_EDGES` is
      // what a reader greps for and `VOCAB['config.direct']` is not. Read off
      // the source because the imported object carries values and no names. A
      // spread (`{ ...BACKGROUND_SCENE_VOCAB }`) names nothing per key and falls
      // back to the path, which is still exact about where it came from.
      const src = readFileSync(abs, 'utf8');
      for (const [path, values] of Object.entries(mod.VOCAB)) {
        const dot = path.indexOf('.');
        const target = path.slice(0, dot);
        const writeKey = path.slice(dot + 1);
        if ((target !== 'config' && target !== 'specials') || !writeKey) {
          console.error(
            `${rel}: VOCAB key "${path}" is not a config/specials path — teach metaVocab the new namespace`,
          );
          process.exit(1);
        }
        if (!values.length) {
          console.error(`${rel}: VOCAB["${path}"] is empty — a vocabulary source moved`);
          process.exit(1);
        }
        const quoted = path.replace(/\./g, '\\.');
        const named = new RegExp(`['"\`]${quoted}['"\`]\\s*:\\s*([A-Z][A-Z0-9_]*)`).exec(src)?.[1];
        out.push({
          scope: type,
          vocab: {
            target,
            writeKey,
            values: [...new Set(values)].sort(),
            readBy: named ? `${named} (VOCAB in ${rel})` : `VOCAB["${path}"] (${rel})`,
          },
        });
      }
    }
    console.error(
      `  element vocabularies the metas declare outright: ${out.length} across ${metas} metas`,
    );
    return out;
  };

  const filterVocab = (): Array<{ scope: string; vocab: ValueVocabulary }> => {
    const SOURCES_REL = 'schema/src/filters/sources.ts';
    const GROUPS_REL = 'schema/src/elements/filterGroups.ts';
    const TYPES_REL = 'editor/src/features/filters/types.ts';
    const DIALOG_REL = 'editor/src/components/filters/FilterConfigDialog.vue';
    const file = (rel: string): string | null => {
      const p = resolve(repo, rel);
      return existsSync(p) ? readFileSync(p, 'utf8') : null;
    };
    const die = (why: string): never => {
      console.error(`${why} — a storefront filter vocabulary source moved`);
      process.exit(1);
    };
    // ABSENT IS SILENT, PRESENT-AND-UNPARSEABLE EXITS 1, the same discipline as
    // above — with the honest caveat that this surface has no `runtime/`. That
    // workspace is genuinely optional and a checkout really does arrive without
    // it; `filters/sources.ts` is pulled in by the element registry itself (the
    // filter elements seed a `filterSource` default), so a checkout missing it
    // would fail long before this reader ran. The gate is kept anyway, because
    // the alternative is a reader whose first line assumes a file exists, and
    // every file BEHIND it exits 1: once the registry is in hand, a missing
    // join partner means the table would be WRONG rather than missing, and
    // wrong-not-missing is this reader's whole defect history.
    const sourcesSrc = file(SOURCES_REL);
    if (sourcesSrc === null) return [];

    // The body of `= [` or `= Object.freeze([`, bracket-matched.
    //
    // COMMENTS ARE SKIPPED BEFORE STRINGS and that ordering is load-bearing
    // rather than tidy: `FILTER_SOURCES` carries a dozen paragraphs of prose
    // inside the array ("The BLOG's taxonomy", "the shopper's own words"), and
    // a scanner that reads one of those apostrophes as a string opener runs
    // past the closing bracket and returns the rest of the file. It is the same
    // trap `braceBody` already records for `widgets.ts`, one delimiter over.
    const arrayBody = (src: string, name: string, rel: string): string => {
      const m = new RegExp(
        `(?:^|\\n)\\s*(?:export\\s+)?const\\s+${name}\\b[^=\\n]*=\\s*(?:Object\\.freeze\\()?\\[`,
      ).exec(src);
      if (!m) return die(`${name} is gone from ${rel}`);
      const open = m.index + m[0].length - 1;
      let depth = 0;
      for (let i = open; i < src.length; i++) {
        const c = src[i];
        const n = src[i + 1];
        if (c === '/' && n === '/') {
          i = src.indexOf('\n', i);
          if (i < 0) break;
          continue;
        }
        if (c === '/' && n === '*') {
          i = src.indexOf('*/', i);
          if (i < 0) break;
          i += 1;
          continue;
        }
        if (c === "'" || c === '"' || c === '`') {
          for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
          continue;
        }
        if (c === '[') depth++;
        else if (c === ']' && --depth === 0) return src.slice(open + 1, i);
      }
      return die(`${name} no longer closes as an array in ${rel}`);
    };
    // The top-level `{ … }` objects of an array body, comments and strings
    // skipped for the same reason.
    const objectsIn = (body: string): string[] => {
      const out: string[] = [];
      for (let i = 0; i < body.length; i++) {
        const c = body[i];
        const n = body[i + 1];
        if (c === '/' && n === '/') {
          i = body.indexOf('\n', i);
          if (i < 0) break;
          continue;
        }
        if (c === '/' && n === '*') {
          i = body.indexOf('*/', i);
          if (i < 0) break;
          i += 1;
          continue;
        }
        if (c === "'" || c === '"' || c === '`') {
          for (i++; i < body.length && body[i] !== c; i++) if (body[i] === '\\') i++;
          continue;
        }
        if (c === '{') {
          const b = braceBody(body, i);
          if (b === null) break;
          out.push(b);
          i += b.length + 1;
        }
      }
      return out;
    };
    const commentless = (body: string): string =>
      body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    // A frozen array of literals, with `...OTHER` spreads resolved against the
    // lists already read. `FILTER_CONFIG_TYPES` is literally
    // `[...FILTER_ELEMENT_TYPES, 'select']`, so a reader that took only the
    // quoted words would report the select as the entire family.
    const frozen = (src: string, name: string, rel: string, known: Map<string, string[]>): string[] => {
      const body = commentless(arrayBody(src, name, rel));
      const out: string[] = [];
      for (const s of body.matchAll(/\.\.\.\s*([A-Za-z0-9_]+)/g)) {
        const v = known.get(s[1]);
        if (!v) return die(`${name} in ${rel} spreads ${s[1]}, which this reader has not read`);
        out.push(...v);
      }
      out.push(...[...body.matchAll(/'([^']*)'/g)].map((x) => x[1]));
      const uniq = [...new Set(out)];
      if (!uniq.length) return die(`${name} in ${rel} reads as empty`);
      return uniq;
    };

    // ---- the sources themselves ----
    const rows = objectsIn(arrayBody(sourcesSrc, 'FILTER_SOURCES', SOURCES_REL)).map((o) => ({
      id: /\bid:\s*'([^']*)'/.exec(o)?.[1],
      valueMode: /\bvalueMode:\s*'([^']*)'/.exec(o)?.[1],
    }));
    if (!rows.length) die('FILTER_SOURCES reads as empty');
    for (const r of rows) {
      if (!r.id || !r.valueMode) die(`a FILTER_SOURCES row no longer declares id + valueMode`);
    }
    const facetIds = rows.map((r) => r.id as string);
    const sortMatch = /\bexport const SORT_SOURCE\s*=\s*'([^']*)'/.exec(sourcesSrc);
    const sortSource: string = sortMatch ? sortMatch[1] : die(`SORT_SOURCE is gone from ${SOURCES_REL}`);
    // One value per shape that has to survive, so the run catches a drift
    // rather than a reader noticing a short list months later. `category` is
    // the seeded default of every option-list filter, `price` is the range
    // source the slider is, and `search` is the one whose values a shopper
    // rather than an author supplies.
    for (const must of ['category', 'price', 'search']) {
      if (!facetIds.includes(must)) die(`FILTER_SOURCES no longer offers "${must}"`);
    }

    // ---- who may hold one ----
    const groupsSrc = file(GROUPS_REL);
    if (groupsSrc === null) return die(`${GROUPS_REL} is gone`);
    const known = new Map<string, string[]>();
    const elementTypes = frozen(groupsSrc, 'FILTER_ELEMENT_TYPES', GROUPS_REL, known);
    known.set('FILTER_ELEMENT_TYPES', elementTypes);
    const configTypes = frozen(groupsSrc, 'FILTER_CONFIG_TYPES', GROUPS_REL, known);
    if (!configTypes.includes('select')) die('FILTER_CONFIG_TYPES no longer holds the select');

    // THE SLIDER IS THE ONE FILTER THAT CANNOT SORT, and its own meta says so
    // outright: "Its SOURCE is fixed to `price`, and that is identity rather
    // than a setting … AND THEREFORE IT IS THE ONE FILTER THAT CANNOT SORT.
    // Since 2026-09-04 the other four plus the select open their config dialog
    // on a Sort | Filter choice; this one has no dialog to put that choice in."
    // A two-handle continuous control can only express a numeric range, so its
    // vocabulary is DERIVED — the ids whose `valueMode` is `range` — rather
    // than the literal `['price']` the meta names, because a second range
    // source would reach this table on the next codegen and a copied literal
    // would not. It renders `nodes.SpecialString(n, "filterSource", "price")`,
    // so a slider pointed at `category` publishes a numeric range against a
    // categorical facet and matches nothing, silently.
    const RANGE_ONLY = 'filter-slider';
    if (configTypes.includes(RANGE_ONLY)) {
      die(`${RANGE_ONLY} now opens the config dialog, so its source is no longer identity`);
    }
    const rangeIds = rows.filter((r) => r.valueMode === 'range').map((r) => r.id as string);
    if (!rangeIds.length) die('no FILTER_SOURCES row declares valueMode "range"');

    // ---- the sibling keys, and the mapping that joins them ----
    const typesSrc = file(TYPES_REL);
    const dialogSrc = file(DIALOG_REL);
    if (typesSrc === null) return die(`${TYPES_REL} is gone`);
    if (dialogSrc === null) return die(`${DIALOG_REL} is gone`);
    const cfgAt = typesSrc.indexOf('interface FilterConfig');
    if (cfgAt < 0) die(`FilterConfig is gone from ${TYPES_REL}`);
    const cfgBody = braceBody(typesSrc, typesSrc.indexOf('{', cfgAt));
    if (cfgBody === null) die(`FilterConfig no longer reads as an interface in ${TYPES_REL}`);
    // A closed union of single-quoted literals, or nothing. A right-hand side
    // that is anything else — `string`, `T[]`, a union with a non-literal
    // member — yields null, because publishing a "closed" list for a key that
    // also takes free text is the confident wrong answer this table exists to
    // remove.
    const literalUnion = (rhs: string): string[] | null => {
      const values = [...rhs.matchAll(/'([^']*)'/g)].map((x) => x[1]);
      if (!values.length) return null;
      return rhs.replace(/'[^']*'/g, '').replace(/[|\s]/g, '') === '' ? values : null;
    };
    const unionOf = (field: string): string[] | null => {
      const m = new RegExp(`\\n\\s*${field}\\??:\\s*([^;\\n]+);`).exec(cfgBody as string);
      if (!m) return null;
      const rhs = m[1].trim();
      const direct = literalUnion(rhs);
      if (direct) return direct;
      if (!/^[A-Za-z0-9_]+$/.test(rhs)) return null;
      const alias = new RegExp(`\\n\\s*export type ${rhs}\\s*=\\s*([^;]+);`).exec(typesSrc);
      return alias ? literalUnion(alias[1]) : null;
    };
    // `store.setNodeValue(id, 'specials', '<key>', <expression>)` — the
    // platform's own statement of which draft field lands on which node key,
    // taken from the WRITE rather than from the name, because no name-mangling
    // produces `matchMode` from `filterMatch` or `label` from `customName`.
    //
    // THE VALUE EXPRESSION IS PAREN-MATCHED AND MUST NAME EXACTLY ONE FIELD,
    // and both halves of that are a defect this reader already had. A fixed
    // window instead of the real call is not merely imprecise: `matchAll`
    // CONSUMES the window, so four of the thirteen calls fell inside an earlier
    // one's tail and were never seen at all. And "the first `draft.value.X` in
    // the call" is wrong on the one call that reads two — `filterTargets` is
    // `draft.value.behavior === 'event' ? [] : draft.value.targets.slice()` —
    // which joined the targets key to the BEHAVIOUR's union and would have
    // published `filter | event` as the legal values of a list of node ids.
    // Two fields is ambiguous, so it says nothing; one field inside a ternary
    // (`filterMatch`) is not ambiguous and is kept.
    const callTail = (src: string, from: number): string => {
      let depth = 1;
      for (let i = from; i < src.length; i++) {
        const c = src[i];
        const n = src[i + 1];
        if (c === '/' && n === '/') {
          i = src.indexOf('\n', i);
          if (i < 0) break;
          continue;
        }
        if (c === '/' && n === '*') {
          i = src.indexOf('*/', i);
          if (i < 0) break;
          i += 1;
          continue;
        }
        if (c === "'" || c === '"' || c === '`') {
          for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
          continue;
        }
        if (c === '(') depth++;
        else if (c === ')' && --depth === 0) return src.slice(from, i);
      }
      return '';
    };
    const writes = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const m of dialogSrc.matchAll(/setNodeValue\(\s*id,\s*'specials',\s*'([A-Za-z0-9_]+)',/g)) {
      const tail = callTail(dialogSrc, m.index + m[0].length);
      const fields = new Set([...tail.matchAll(/draft\.value\.([A-Za-z0-9_]+)/g)].map((f) => f[1]));
      if (fields.size !== 1) {
        ambiguous.add(m[1]);
        continue;
      }
      const field = [...fields][0];
      // A key written twice from two different fields is the same ambiguity
      // arriving across calls rather than within one.
      if (writes.get(m[1]) !== undefined && writes.get(m[1]) !== field) ambiguous.add(m[1]);
      writes.set(m[1], field);
    }
    for (const k of ambiguous) writes.delete(k);
    if (!writes.size) die(`${DIALOG_REL} no longer writes specials through setNodeValue`);
    const siblings = new Map<string, string[]>();
    for (const [key, field] of writes) {
      if (key === 'filterSource') continue;
      const v = unionOf(field);
      if (v) siblings.set(key, v);
    }
    // One assertion per key the dialog is known to carry, on a value that would
    // be wrong if either half of the join drifted. `filterMatch` is the shape
    // that proves the join itself: nothing about the name `filterMatch` would
    // produce the draft field `matchMode`.
    for (const [key, must] of [
      ['filterValueMode', 'manual'],
      ['filterMatch', 'any'],
      ['filterArity', 'single'],
      ['filterBehavior', 'event'],
    ] as const) {
      if (!siblings.get(key)?.includes(must)) {
        die(`specials.${key} no longer joins to a union offering "${must}"`);
      }
    }

    const out: Array<{ scope: string; vocab: ValueVocabulary }> = [];
    const emit = (scope: string, writeKey: string, values: string[], readBy: string) => {
      // A key an element does not SEED is a key it does not have — the rule
      // `sharedVocabularies` already applies to the `*` scope, applied here so
      // the slider never hears about a match mode it has no control for and the
      // select never hears about an arity its island ignores by construction.
      const seeded = elements[scope]?.defaults?.specials as Record<string, unknown> | undefined;
      if (!seeded || !(writeKey in seeded)) return;
      const seed = seeded[writeKey];
      const all = [...new Set(typeof seed === 'string' ? [...values, seed] : values)];
      out.push({ scope, vocab: { target: 'specials', writeKey, values: all.sort(), readBy } });
    };
    const sourceReadBy = `FILTER_SOURCES + SORT_SOURCE (${SOURCES_REL})`;
    for (const type of configTypes) emit(type, 'filterSource', [...facetIds, sortSource], sourceReadBy);
    emit(RANGE_ONLY, 'filterSource', rangeIds, `FILTER_SOURCES valueMode:"range" (${SOURCES_REL})`);
    // The navigate behaviour is the one value in this block that belongs to the
    // SHAPE rather than to the key — see readNavigableFilters. Subtracted per
    // type rather than dropped from the union, because for the four option-list
    // filters it is entirely real.
    const nav = readNavigableFilters(repo);
    for (const [key, values] of siblings) {
      const field = writes.get(key) as string;
      for (const type of new Set([...configTypes, ...elementTypes, RANGE_ONLY])) {
        const own =
          nav && values.includes(nav.value) && !nav.types.includes(type)
            ? values.filter((v) => v !== nav.value)
            : values;
        emit(type, key, own, `FilterConfig.${field} (${TYPES_REL})`);
      }
    }
    console.error(`  storefront filter vocabularies from the platform's own declarations: ${out.length}`);
    return out;
  };

  // A DECLARATION OUTRANKS A RENDERER, AND THE ORDER BELOW IS THAT RULE.
  //
  // `put` overwrites, so the LAST source to speak for a `scope + key` wins, and
  // the sequence is deliberately Source A (Go) → Source C (declarations) →
  // Source B (editor pickers). Reordering these loops would silently invert it.
  //
  // The platform states the reason, in the words of the person who owns that
  // repo: "the schema is the vocabulary and `server/render` is only ever an
  // emitter of it. Anything in `render/nodes/*.go` that looks like it enumerates
  // a vocabulary is enumerating what it can DRAW, which is a SUBSET and drifts
  // ON PURPOSE — `gallery` and `model` each spent a wave as declared-but-not-
  // drawable." So a Go list is a floor, never a ceiling, and preferring it over
  // a declaration under-reports by exactly the values the platform has declared
  // and not yet drawn.
  //
  // That is not hypothetical: `backgroundSceneSource` shipped in 0.42.0 reading
  // three values off a Go GUARD. Source C running after Source A is what
  // replaced it with the declared five.
  //
  // NO CHECK GUARDS THIS, AND ONE CANNOT BE BUILT — which is why the rule is
  // pinned by `test/config-vocabulary.test.ts` instead. Where a declaration
  // exists this precedence already resolves it; where none exists there is
  // nothing to compare a Go list against, so an under-report is undetectable by
  // construction. Measured at this commit: all six remaining Source A entries
  // have no competing declaration, and on the four whose element prose also
  // names values, the prose names a SUBSET every time — no under-report today.
  const elementValues: Record<string, Record<string, ValueVocabulary>> = {};
  // A DECLARATION OUTRANKS A RENDERER ON THE VALUES AND ON NOTHING ELSE.
  //
  // `values` and `fallback`/`open` answer two different questions. A schema list
  // says WHICH WORDS MEAN SOMETHING, and the precedence above is right that it
  // outranks a Go list for that — a renderer enumerates what it can DRAW, a
  // subset that drifts on purpose. But only the renderer can answer WHAT HAPPENS
  // TO A WORD OUTSIDE THE LIST: `fallback` is the normaliser's trailing
  // `return Fallback`, `open` is its `default: return mode` passthrough, and a
  // declaration is silent on both. So a plain overwrite threw away a fact the
  // superseding source never had.
  //
  // MEASURED, NOT ANTICIPATED. `tab.tabPosition` carried `fallback: "top"` from
  // `nodes/tab/html.go` until the platform moved the list into `TAB_POSITIONS`
  // (web_builder `a401a1c5`); the declaration won the key and `sb_set` stopped
  // being able to say what `tabPosition: "start"` renders as. Nothing went red —
  // the entry is still correct, only less informative — which is how this
  // accumulates while the platform keeps migrating vocabularies out of its
  // renderers.
  //
  // `open` IS THE HALF THAT WOULD COST MORE. Dropping a `fallback` costs a
  // sentence; dropping `open` makes `unknownWriteNote` report a CORRECT value as
  // a mistake — `mediaImageRatio: "4 / 5"` really is handed straight to CSS —
  // and sends a caller to "fix" a working page, which this repo already records
  // as worse than saying nothing. Nothing declares that key today, so the guard
  // is in place before the first declaration that would spring it.
  //
  // THE FALLBACK IS DROPPED WHERE THE DECLARATION CONTRADICTS IT. One the
  // declared list no longer contains means the Go reading went stale, and
  // carrying it would name a value the platform says is not one.
  //
  // The prior entry is found by target+writeKey rather than by `key`, because
  // the sources name their entries differently — a picker uses the CONTROL name
  // (`divider_orientation`), the declaration readers use the write key — and
  // what is being superseded is the key that gets written, not the label. It is
  // deliberately NOT deleted under its old name: the duplicate guard below is
  // what catches two controls writing one key with different words, and removing
  // the loser here would make that check unreachable. Both copies end up
  // carrying the renderer's facts, so whichever `vocabularyForWrite` reaches
  // first answers the same.
  const put = (scope: string, key: string, v: ValueVocabulary) => {
    const table = (elementValues[scope] ??= {});
    const prev = Object.values(table).find(
      (p) => p.target === v.target && p.writeKey === v.writeKey,
    );
    if (prev) {
      // The ATTRIBUTION rides with the value. `readBy` names the declaration
      // that won the values, and a note reading "TAB_POSITIONS normalises
      // anything unrecognised to top" would credit an `as const` list with
      // behaviour only `nodes/tab/html.go` has.
      if (
        v.fallback === undefined &&
        prev.fallback !== undefined &&
        v.values.includes(prev.fallback)
      ) {
        v = { ...v, fallback: prev.fallback, fallbackReadBy: prev.fallbackReadBy ?? prev.readBy };
      }
      if (!v.open && prev.open) v = { ...v, open: prev.open };
    }
    table[key] = v;
  };
  for (const { scope, vocab } of goVocab()) {
    if (scope === '*') put('*', vocab.writeKey, vocab);
    else if (elements[scope]) put(scope, vocab.writeKey, vocab);
    // A renderer directory with no element of that name is a shared subtree
    // (`overlayplace`), not an element — it scopes to nothing and says nothing.
  }
  // The general declaration reader runs FIRST among the Source C readers, so
  // the two hand-written ones keep the last word wherever they overlap: they
  // read the platform's own KEY MAPPING (`sceneKeys.ts`, the filter dialog's
  // `setNodeValue` calls) where this one infers the key from the seed, and a
  // read mapping outranks an inferred one. Measured, the only overlap is
  // `spline-scene.source`, where both reach `SCENE_SOURCES` and the entries are
  // byte-identical.
  for (const { scope, vocab } of declaredVocab()) {
    if (elements[scope]) put(scope, vocab.writeKey, vocab);
  }
  for (const { scope, vocab } of sceneVocab()) {
    if (scope === '*') put('*', vocab.writeKey, vocab);
    else if (elements[scope]) put(scope, vocab.writeKey, vocab);
  }
  // Element-scoped by construction — a filter key belongs to the elements that
  // SEED it and to nothing else, so there is no `*` case to answer for.
  for (const { scope, vocab } of filterVocab()) {
    if (elements[scope]) put(scope, vocab.writeKey, vocab);
  }
  for (const [control, v] of editorVocab()) {
    for (const el of Object.values(elements)) {
      if (el.controls.includes(control)) put(el.type, control, { ...v, readBy: `${control} (editor picker)` });
    }
  }
  // Source D runs LAST because it is the only source that READS the mapping off
  // the element itself. Every reader above either infers the key (the scan) or
  // reads it from a surface that WRITES the key (the scene key table, the filter
  // dialog, a picker's `setNodeValue`) — all exact, all narrower. Where D
  // overlaps any of them the two agree today by construction, because the
  // platform's guard forces the inspector row to render the meta's own list.
  //
  // A DUPLICATE OF THE `*` ANSWER IS NOT AN ADDITION. The three carriers of the
  // background-scene layer declare its four keys in their own `VOCAB`, and
  // `sceneVocab` already publishes those at `*`, which `vocabularyForWrite`
  // falls through to for EVERY element. An element-scoped copy of an identical
  // list answers nothing the table did not already answer and costs twelve
  // entries, so it is skipped — and only where the values MATCH, because a
  // carrier that narrowed its own layer would be real news.
  let starDup = 0;
  for (const { scope, vocab } of await metaVocab()) {
    if (!elements[scope]) continue;
    const star = Object.values(elementValues['*'] ?? {}).find(
      (v) => v.target === vocab.target && v.writeKey === vocab.writeKey,
    );
    if (star && JSON.stringify(star.values) === JSON.stringify(vocab.values)) {
      starDup++;
      continue;
    }
    put(scope, vocab.writeKey, vocab);
  }
  if (starDup) console.error(`  (${starDup} of them already answered for every element at "*")`);
  // TWO CONTROLS ON ONE ELEMENT WRITING ONE KEY WITH DIFFERENT WORDS would make
  // `sb_set`'s warning a coin flip — it sees a namespace and a key, never a
  // control. It does not happen today (`specials.source`'s two controls sit on
  // different elements), and if it ever does the writes must stay unreported
  // rather than reported wrongly.
  for (const [type, table] of Object.entries(elementValues)) {
    const seen = new Map<string, string>();
    for (const [k, v] of Object.entries(table)) {
      const at = `${v.target}.${v.writeKey}`;
      const prev = seen.get(at);
      if (prev && JSON.stringify(table[prev].values) !== JSON.stringify(v.values)) {
        console.error(`${type}: controls "${prev}" and "${k}" both write ${at} with different values`);
        process.exit(1);
      }
      seen.set(at, k);
    }
  }
  // The same discipline the three `Effective*` keys get: a shape change upstream
  // must fail the next codegen rather than quietly shrink the table. One
  // assertion per SOURCE, each on a fact that would be wrong if the reader drifted.
  for (const [type, key, expect] of [
    // Source B, and the finding it exists for: the control is `divider_orientation`
    // and the key it writes is `orientation`, which no name-mangling would produce.
    ['divider', 'divider_orientation', 'horizontal'],
    // Source A, the `default: return mode` passthrough — `auto` is a value, and
    // the OPEN flag is what keeps "4 / 5" from being reported as a mistake.
    ['media-dataset', 'mediaImageRatio', 'auto'],
    // Source A, the ordinary closed normaliser, including its own fallback.
    ['tab', 'tabPosition', 'top'],
    // Source C is asserted INSIDE `sceneVocab`, not here. Every list it reads
    // may legitimately be absent — `runtime/` is a standalone workspace — and
    // an assertion at this level cannot tell "the reader drifted" from "this
    // deployment lacks the feature", so it would refuse the second. Measured:
    // a checkout without `runtime/` falls to eight vocabularies correctly, and
    // a `gradient-mesh` assertion placed here turned that into an exit 1.
  ] as const) {
    const v = elementValues[type]?.[key];
    if (!v?.values.includes(expect)) {
      console.error(`${type}.${key} no longer offers "${expect}" — the vocabulary readers drifted`);
      process.exit(1);
    }
  }
  if (!elementValues['divider']?.divider_orientation?.writeKey.match(/^orientation$/)) {
    console.error('divider_orientation no longer writes config.orientation — check the registry join');
    process.exit(1);
  }
  if (!elementValues['media-dataset']?.mediaImageRatio?.open) {
    console.error('mediaImageRatio is no longer a passthrough — check mediaRatioCss');
    process.exit(1);
  }
  console.error(
    `  element vocabularies: ${Object.values(elementValues).reduce((n, t) => n + Object.keys(t).length, 0)} across ${Object.keys(elementValues).length} scopes`,
  );

  const elementsOut = `// GENERATED by scripts/gen-catalog.ts — do not edit by hand.
// Source: <WB_REPO>/schema/src/elements/** and editor/src/theme/legacyScopes.ts
import type { CatalogElement, NodeSeed, SatelliteRule, TraitDescription, ValueVocabulary, WritePrecondition } from './element-types.js';

export const ELEMENT_SOURCE = ${JSON.stringify({ count: types.length, docSchemaVersion: docVersion }, null, 2)} as const;

export const ELEMENTS: Record<string, CatalogElement> = ${JSON.stringify(elements, null, 2)};

export const BINDING_SOURCES: string[] = ${JSON.stringify(bindingSources, null, 2)};

export const BOUND_SPECIALS: Record<string, string[]> = ${JSON.stringify(boundSpecials, null, 2)};

export const TRAIT_WRITES: Record<string, TraitDescription> = ${JSON.stringify(traits, null, 2)};

export const SATELLITE_RULES: Record<string, SatelliteRule[]> = ${JSON.stringify(satellites, null, 2)};

export const ELEMENT_SEEDS: Record<string, NodeSeed[]> = ${JSON.stringify(elementSeeds, null, 2)};

export const FIRST_CHILD_ONLY: string[] = ${JSON.stringify(firstChildOnly, null, 2)};

/**
 * What a setting needs from its NEIGHBOURS before it does anything.
 *
 * Every other table here publishes one key's legal values, which cannot express
 * "these two are legal apart and meaningless together" — and that is a real
 * write: filterValueMode "auto" with filterSource "blog_category" stores,
 * saves, publishes and renders an empty filter.
 *
 * Declared by the platform (schema/src/filters/preconditions.ts) and pinned
 * there against both Go renderers.
 */
export const WRITE_PRECONDITIONS: WritePrecondition[] = ${JSON.stringify(preconditions, null, 2)};

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
 * The same question for the rest of the catalog, KEYED BY ELEMENT.
 *
 * CONFIG_VALUES above answers three keys and is keyed by the config key, which
 * works only because those three names are globally unique. They are the
 * exception: \`config.layout\` is seeded by media-dataset ("bottom") AND
 * list-dataset ("grid") and the renderers read different words, \`specials.source\`
 * is written by two controls with different vocabularies, and \`config.placement\`
 * is read by three renderers with three case sets. Handed to the wrong element
 * any of those is a confident wrong answer — so the scope is the element, which
 * is what both callers already have.
 *
 * Two sources, one rule: PUBLISH ONLY WHAT THE SOURCE PROVES COMPLETE.
 *   - a Go \`switch\` whose \`default:\` arm catches everything the cases do not
 *     (or a normaliser whose arms all return a string over a trailing return)
 *   - the editor picker's own inline \`options\` list, joined to the trait
 *     registry's declared write target
 * An equality test (\`ConfigString(n, "x", "a") == "b"\`) proves neither and is
 * not read: it yields \`mainImageSource = first_variant\` where the picker offers
 * \`first_variant|product_image\`, and a half-list calls a working value invalid.
 *
 * \`open\` marks a passthrough — \`default: return mode\` hands an unrecognised
 * value straight to CSS, so \`mediaImageRatio\` really does take "4 / 5" and the
 * listed values are the ones with SPECIAL meaning rather than the only legal
 * ones. \`fallback\` is absent where the source does not say: the editor's picker
 * proves what an author may choose and is silent on what the renderer does with
 * anything else, and inventing that answer is the mistake this table prevents.
 *
 * \`*\` is the scope for a key read by a SHARED helper rather than by one
 * element's renderer, and it applies only to an element that actually carries
 * the key.
 */
export const ELEMENT_VALUES: Record<string, Record<string, ValueVocabulary>> = ${JSON.stringify(elementValues, null, 2)};

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
 * The ENTRANCE ANIMATION's vocabulary — config.animation, offered by most of
 * the element library and describable by nothing until this table existed.
 *
 * Three ways to miss, all silent (AnimationTypeOf answers "" and no keyframes,
 * no rule and no error are emitted, through save, publish and render):
 *   - it is an OBJECT, not a string
 *   - active:true is REQUIRED; a stored type is deliberately NOT consent,
 *     because the panel keeps the type when the switch goes off
 *   - type is a keyframe key spelled with UNDERSCORES: fade_in, never fade-in
 *
 * easing is the mild one: an unrecognised value falls back to "ease".
 *
 * TWO THINGS THIS TABLE USED TO SAY THAT ARE NO LONGER TRUE, kept as a
 * correction because both were recorded here as settled facts:
 *
 *   - IT IS NOT BASE-ONLY ANY MORE. The compiler reads config through
 *     MergeNamespace and emits per lane, so the key left the platform's
 *     base-only ledger — and the side effect is the thing merchants ask for
 *     most, an animation that is off on mobile. A caller still writing it to
 *     base gets the cascade's fallback layer, which is correct but cannot vary.
 *   - REVEAL-ON-SCROLL HAS AN ANSWER. trigger:"view" compiles to
 *     animation-timeline: view() inside an @supports override, so it costs no
 *     JavaScript and the engines without it keep animating at first paint.
 *
 * The object now carries ten keys. intensity travels as CSS variables (a
 * distance is a quantity, so it reaches the page per breakpoint) and ABSENCE IS
 * NOT medium — a document with no intensity keeps the old 0.5s fallback.
 *
 * alternateNeedsInfinite is the guard worth reading before using repeat:
 * alternate with an EVEN finite count finishes on the from keyframe, and every
 * entrance keyframe starts at opacity:0 — so the node publishes INVISIBLE. The
 * compiler honours alternate only alongside an infinite repeat.
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
  intensities: string[];
  intensityDurations: Record<string, number>;
  triggers: string[];
  rangeDefault: number;
  repeatMax: number;
  alternateNeedsInfinite: boolean;
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
      `${Object.values(elementValues).reduce((n, t) => n + Object.keys(t).length, 0)} element vocabularies, ` +
      `animation ${animation.types.length} types / ${animation.easings.length} easings / ` +
      `${animation.intensities.length} intensities / ${animation.triggers.length} triggers, ` +
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
  assertPageRoot('checkout page', checkoutPageDoc);
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
    const out = {
      schema_version: (doc.schema_version as number) ?? docVersion,
      root_node_id: root,
      nodes,
    };
    assertPageRoot(`${type} page`, out);
    return out;
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
    buildPageLayoutDocument: (layout: string) => { nodes: Record<string, unknown> } | undefined;
    PAGE_LAYOUT_IDS: readonly string[];
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
  // THE LAYOUTS, read from the same module and the same palette cards.
  //
  // Keyed by PURPOSE rather than by type, because every content page is type
  // `page` and a type-keyed table cannot tell an About page from a policy. The
  // list is read from the editor rather than repeated here, so a layout added
  // there arrives at this door without anyone remembering to copy it — which is
  // the whole reason the store seeds are read the same way.
  const layoutSeeds: Record<string, unknown> = {};
  for (const layout of storeSeedMod.PAGE_LAYOUT_IDS) {
    const doc = storeSeedMod.buildPageLayoutDocument(layout);
    if (!doc) continue;
    layoutSeeds[layout] = normalizeSeed(
      layout,
      stableIds(doc as { nodes: Record<string, unknown> }, `pl${layout.slice(0, 3)}`),
    );
  }
  if (Object.keys(layoutSeeds).length !== storeSeedMod.PAGE_LAYOUT_IDS.length) {
    console.error('a declared page layout built no document — check storePageSeeds.ts');
    process.exit(1);
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
  // EVERY PAGE TYPE THE PLATFORM HAS, and what each one is FOR.
  //
  // `sb_page_create` used to describe its `type` argument with a hand-typed
  // string — "page (default), checkout, product, category, post, course" — six
  // of the platform's twelve. An agent reading it could not create a search
  // page, an account page, a blog listing, an order-complete page, a 404 body
  // or a maintenance page, and had no way to learn they exist. Those are
  // TEMPLATES: without one, a whole family of storefront URLs serves nothing.
  //
  // Read from `PAGE_TYPE_META`, which already carries every field the answer
  // needs — the group it files under, whether the author names its slug, the
  // address it is served at, and the app that provides it. A hand list drifted
  // 6/12; a generated one cannot.
  const pageTypes: {
    type: string;
    group: string;
    ownSlug: boolean;
    routePattern?: string;
    servedRole?: string;
    app?: string;
  }[] = [];
  {
    const src = readFileSync(
      resolve(repo, 'editor/src/features/pages/pageTypes.ts'),
      'utf8',
    );
    const block = /export const PAGE_TYPE_META[\s\S]*?\n\];/.exec(src);
    if (!block) {
      console.error('PAGE_TYPE_META is gone from editor/src/features/pages/pageTypes.ts');
      process.exit(1);
    }
    // meta(type, icon, group, ownSlug, routePattern?, servedRole?, app?)
    const call = /meta\(\s*'([a-zA-Z]+)'\s*,\s*[A-Za-z0-9_]+\s*,\s*'([a-zA-Z]+)'\s*,\s*(true|false)\s*(?:,\s*([^,)]+))?\s*(?:,\s*([^,)]+))?\s*(?:,\s*([^,)]+))?\s*\)/g;
    const lit = (raw?: string): string | undefined => {
      const t = raw?.trim();
      if (!t || t === 'undefined') return undefined;
      const m = /^'([^']*)'$/.exec(t);
      return m ? m[1] : undefined;
    };
    for (const m of block[0].matchAll(call)) {
      pageTypes.push({
        type: m[1],
        group: m[2],
        ownSlug: m[3] === 'true',
        routePattern: lit(m[4]),
        servedRole: lit(m[5]),
        app: lit(m[6]),
      });
    }
    // The declared union is the authority on COUNT; the meta list is the
    // authority on detail. A mismatch means the regex fell behind the file's
    // spelling, and shipping the subset is how this drifted in the first place.
    const union = /export const PAGE_TYPES = \[([\s\S]*?)\] as const;/.exec(src);
    const declared = union ? [...union[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]) : [];
    const missing = declared.filter((t) => !pageTypes.some((p) => p.type === t));
    if (!declared.length || missing.length) {
      console.error(
        `PAGE_TYPE_META parse recovered ${pageTypes.length} of ${declared.length} page types` +
          (missing.length ? ` — missing ${missing.join(', ')}` : ''),
      );
      process.exit(1);
    }
  }
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
export const PAGE_LAYOUT_SEEDS: Record<string, { schema_version: number; root_node_id: string; nodes: Record<string, unknown> }> = ${JSON.stringify(
    layoutSeeds,
    null,
    2,
  )} as const;

/**
 * EVERY page type the platform has, and what each one is FOR.
 *
 * A storefront is not one page: most of these are TEMPLATES, and a missing one
 * means a whole family of addresses serves nothing. \`routePattern\` is where the
 * type is served (absent = the author names the address), \`ownSlug\` says whether
 * the author names it, \`servedRole\` marks the two that are served by ROLE rather
 * than by address, and \`app\` names the builtin app a type needs installed.
 */
export const PAGE_TYPES: readonly {
  type: string;
  group: string;
  ownSlug: boolean;
  routePattern?: string;
  servedRole?: string;
  app?: string;
}[] = ${JSON.stringify(pageTypes, null, 2)} as const;

/**
 * The document an ordinary page opens with for a chosen LAYOUT.
 *
 * Keyed by purpose, not by type: every content page is type \`page\`, so the
 * table above cannot tell an About page from a policy. Same palette cards, same
 * module, same reason — an author who picks the layout in the editor and an
 * agent that asks for it here must land on the same page.
 */
export const STORE_PAGE_SEEDS: Record<string, { schema_version: number; root_node_id: string; nodes: Record<string, unknown> }> = ${JSON.stringify(
    storeSeeds,
    null,
    2,
  )};
`;
  emit(resolve(process.cwd(), 'src/catalog/storepages.generated.ts'), storeOut);
  console.error(
    `${VERB} storepages.generated.ts: ${pageTypes.length} page types, ${Object.keys(storeSeeds).length} seeded (` +
      Object.entries(storeSeeds)
        .map(([t, d]) => `${t} ${Object.keys((d as { nodes: object }).nodes).length}`)
        .join(', ') +
      ' nodes)',
  );

  // ---- What a fresh pop-up and a fresh quick view arrive holding --------
  //
  // `sb_store action:"overlay_attach"` needs a document to hand the overlays
  // API on the FIRST attach — `CreateOverlayInput.document` is REQUIRED (not
  // optional the way a page's is defaulted), and `usePopupOverlay.createAndOpen`
  // /`useQuickviewOverlay.createAndOpen` are the only place either shape is
  // built. EMPTY IS NOT AN OPTION, the seed module's own words: an empty pop-up
  // is a white rectangle a shopper cannot dismiss, and an empty quick view is a
  // panel with no buy box in it at all.
  //
  // `editor/src/features/overlays/seed.ts` imports only `@webbuilder/schema`,
  // `../../element/factory`, `../../element/pickerPresets` and
  // `../../element/cardTree` — the SAME dependency class `storePageSeeds.ts`
  // already has (it imports `cardTree`'s `presetTreeFor` directly), so this is
  // no new kind of import for this script to carry.
  //
  // IDS ARE RESTAMPED, for the reason the checkout and store-page seeds are:
  // `createElement` mints a random id per node, so a straight capture would
  // rewrite this file on every codegen run and `--check` would report drift
  // that is not drift. These ids are a placeholder, not a value — `sb_store`
  // mints fresh ones on every real run, exactly as the editor does, so two
  // pop-ups built by this tool never share a node id.
  const overlaySeedMod = (await import(
    resolve(repo, 'editor/src/features/overlays/seed.ts')
  )) as {
    cartDrawerSeed: (locale?: string) => { root_node_id: string; nodes: Record<string, unknown> };
    CART_SEED_WORDS: Record<string, unknown>;
    popupSeed: () => { root_node_id: string; nodes: Record<string, unknown> };
    quickviewSeed: () => { root_node_id: string; nodes: Record<string, unknown> };
  };
  // `quickviewSeed` FLATTENS the product card it builds from
  // (`presetTreeFor('product#product-horizontal')`): the card's own root — a
  // `dataset-block` — is discarded and replaced by a plain `flex-block` wearing
  // its style, because the panel must not bind an entity of its own (see the
  // seed module's own comment on why). MEASURED, on every call: that discarded
  // root owned a `list-empty` SATELLITE (its config pointed a `list_empty` key
  // at it), and nothing repoints that satellite when the root is dropped — the
  // panel comes back with the satellite's four nodes (list-empty, icon,
  // heading, text) still carrying `data.parent` set to the discarded root's id,
  // referenced by NO node's config any more. Genuinely orphaned: not reachable
  // via `data.nodes` (satellites never are — see `childrenWithSatellites`), and
  // not reachable via ANY config pointer either, which the legitimate
  // satellites here (`product-variants.config.variantLabelId`,
  // `quantity-dataset.config.quantityButtonId`, …) always are. It would also be
  // INERT even repaired: only a `list-dataset`/`dataset-block` renderer reads a
  // `list_empty` pointer, and nothing here is one any more.
  //
  // The orphan's id is a fresh `createElement` mint on every call, so shipping
  // it verbatim would make this file re-diff on every codegen run for no
  // reason — `--check` measured this directly. Pruned rather than reparented:
  // reparenting would still ship four nodes nothing ever renders.
  const pruneUnreachable = (doc: {
    root_node_id: string;
    nodes: Record<string, unknown>;
  }): { root_node_id: string; nodes: Record<string, unknown> } => {
    const nodes = doc.nodes as Record<
      string,
      { data?: { nodes?: string[] }; config?: Record<string, unknown> }
    >;
    const seen = new Set<string>();
    const stack = [doc.root_node_id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id) || !nodes[id]) continue;
      seen.add(id);
      const n = nodes[id];
      for (const c of n.data?.nodes ?? []) stack.push(c);
      for (const v of Object.values(n.config ?? {})) {
        if (typeof v === 'string' && nodes[v]) stack.push(v);
      }
    }
    const pruned: Record<string, unknown> = {};
    for (const [id, n] of Object.entries(nodes)) if (seen.has(id)) pruned[id] = n;
    return { root_node_id: doc.root_node_id, nodes: pruned };
  };
  const overlaySeeds: Record<string, { root_node_id: string; nodes: Record<string, unknown> }> = {
    // The site's ONE cart drawer, which `sb_store action:"cart"` creates when a
    // site has none — without it every `open_cart` control opens nothing.
    cart: stableIds(pruneUnreachable(overlaySeedMod.cartDrawerSeed()), 'cart'),
    popup: stableIds(pruneUnreachable(overlaySeedMod.popupSeed()), 'pop'),
    quickview: stableIds(pruneUnreachable(overlaySeedMod.quickviewSeed()), 'qv'),
  };
  // THE CART SPEAKS THE SITE'S LANGUAGE. The editor passes `settings.locale` to
  // `cartDrawerSeed`, so one capture per locale it knows — a Vietnamese store
  // must not get "Your cart" / "Checkout" from this tool and "Giỏ hàng" from
  // the editor.
  const cartSeeds: Record<string, { root_node_id: string; nodes: Record<string, unknown> }> = {};
  for (const locale of Object.keys(overlaySeedMod.CART_SEED_WORDS ?? {})) {
    cartSeeds[locale] = stableIds(pruneUnreachable(overlaySeedMod.cartDrawerSeed(locale)), 'cart');
  }
  if (!cartSeeds.en || JSON.stringify(cartSeeds.en) !== JSON.stringify(overlaySeeds.cart)) {
    console.error('CART_SEED_WORDS has no `en`, or cartDrawerSeed("en") is not its default — the fallback moved');
    process.exit(1);
  }
  for (const [kind, doc] of Object.entries(overlaySeeds)) {
    if (!doc.root_node_id || !doc.nodes[doc.root_node_id]) {
      console.error(`the ${kind} overlay seed names no usable root_node_id`);
      process.exit(1);
    }
    if (Object.keys(doc.nodes).length < 1) {
      console.error(`the ${kind} overlay seed has no nodes`);
      process.exit(1);
    }
  }

  const overlaysOut = `// GENERATED by scripts/gen-catalog.ts — do not edit by hand.
// Source: <WB_REPO>/editor/src/features/overlays/seed.ts (the editor's own overlay seeds).

/**
 * The document envelope the overlays API stores — {root_node_id, nodes}, the
 * same two fields a page document carries minus schema_version:
 * \`CreateOverlayInput.document\` is typed \`unknown\` on the platform and held
 * opaque, so there is nothing else for this envelope to declare.
 */
export interface OverlayDocument {
  root_node_id: string;
  nodes: Record<string, unknown>;
}

/**
 * WHAT A FRESH CART DRAWER, POP-UP AND QUICK VIEW ARRIVE HOLDING, read by calling
 * the editor's OWN seed functions rather than copied from their output — the
 * day either card gains a piece it arrives at both doors.
 *
 * A placeholder, not a value: node ids here are stable across codegen runs
 * (so \`--check\` reports real drift only), and \`sb_store\` mints FRESH ids on
 * every real attach, exactly as the editor does on every real drop.
 */
export const OVERLAY_SEEDS: Record<'cart' | 'popup' | 'quickview', OverlayDocument> = ${JSON.stringify(
    overlaySeeds,
    null,
    2,
  )} as const;

/**
 * The cart drawer per site language (\`settings.locale\`'s primary subtag),
 * captured by calling \`cartDrawerSeed(locale)\` for every locale the editor's
 * \`CART_SEED_WORDS\` knows. An unknown language gets \`en\`, as in the editor.
 */
export const CART_SEEDS: Record<string, OverlayDocument> = ${JSON.stringify(cartSeeds, null, 2)} as const;
`;
  emit(resolve(process.cwd(), 'src/catalog/overlays.generated.ts'), overlaysOut);
  console.error(
    `${VERB} overlays.generated.ts: cart ${Object.keys(overlaySeeds.cart.nodes).length} nodes, ` +
      `popup ${Object.keys(overlaySeeds.popup.nodes).length} nodes, ` +
      `quickview ${Object.keys(overlaySeeds.quickview.nodes).length} nodes`,
  );

  // ---- Which built-in apps exist, and what pages each needs -------------
  //
  // `POST /api/sites/{siteId}/builtin-apps/{key}` installs an app and nothing
  // else — it does not create the pages the app needs to actually work.
  // `/courses/{slug}` resolves through the `course` page type's DEFAULT
  // TEMPLATE (server/internal/page.PublishedForEntity), so installing
  // `courses`, writing a curriculum and publishing gets a 404 for the
  // course's own address, with nothing anywhere naming the page that was
  // supposed to be built first.
  //
  // `editor/src/features/builtinapps/pageScaffold.ts` is the platform's own
  // answer — `scaffoldAppPages`, run right after a successful install, and
  // `isPresent`, the rule for "does the site already have this one" — and it
  // cannot be imported directly: it pulls in `@/i18n` (`loadNamespaces`,
  // `currentLocale`), which is Vue. Its one entry, `courses`, is built by
  // `editor/src/features/courses/pageScaffold.ts`, which is safe to import on
  // its own: `@webbuilder/schema`, `../../element/factory`,
  // `../../element/treeFactory`, and a TYPE-ONLY import of `ScaffoldPage` from
  // the Vue-carrying sibling — a type import erases at compile time and pulls
  // in nothing at runtime.
  //
  // `BUILTIN_APP_KEYS` is read off `builtinapps.Keys` in Go rather than typed
  // here — a hand-kept roster is exactly the thing this generator exists to
  // replace — and cross-checked against the `key` path parameter's own
  // description on `POST .../builtin-apps/{key}` ("App key: mail |
  // multilingual | agent | chat | booking | loyalty | payments | courses"),
  // so the two cannot silently drift apart.
  const builtinAppsGo = readFileSync(
    resolve(repo, 'server/internal/builtinapps/builtinapps.go'),
    'utf8',
  );
  const appKeyConsts = new Map<string, string>();
  for (const m of builtinAppsGo.matchAll(/\bKey(\w+)\s*=\s*"([a-z]+)"/g)) {
    appKeyConsts.set(m[1], m[2]);
  }
  const appRosterLine = /var Keys = \[\]string\{([^}]+)\}/.exec(builtinAppsGo);
  if (!appRosterLine) {
    console.error('builtinapps.Keys is gone from server/internal/builtinapps/builtinapps.go');
    process.exit(1);
  }
  const BUILTIN_APP_KEYS = appRosterLine[1].split(',').map((raw) => {
    const ident = raw.trim().replace(/^Key/, '');
    const value = appKeyConsts.get(ident);
    if (!value) {
      console.error(`builtinapps.Keys names Key${ident}, which no const in builtinapps.go declares`);
      process.exit(1);
    }
    return value;
  });
  if (BUILTIN_APP_KEYS.length < 8) {
    console.error(`only ${BUILTIN_APP_KEYS.length} builtin app keys — is WB_REPO stale?`);
    process.exit(1);
  }
  const installAppOp = ops.find((o) => o.id === 'post:/api/sites/{siteId}/builtin-apps/{key}');
  const installAppKeyParam = installAppOp?.params.find((p) => p.name === 'key');
  if (installAppKeyParam?.description) {
    const described = installAppKeyParam.description
      .replace(/^[^:]*:\s*/, '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    if (described.length && described.join('|') !== BUILTIN_APP_KEYS.join('|')) {
      console.error(
        `POST .../builtin-apps/{key}'s own description says "${described.join(' | ')}", ` +
          `builtinapps.Keys says "${BUILTIN_APP_KEYS.join(' | ')}" — one of them moved`,
      );
      process.exit(1);
    }
  }

  const coursesScaffoldMod = (await import(
    resolve(repo, 'editor/src/features/courses/pageScaffold.ts')
  )) as {
    coursesScaffold: () => Array<{
      slug: string;
      type: string;
      nameKey: string;
      build: () => { schema_version?: number; root_node_id: string; nodes: Record<string, unknown> };
    }>;
  };

  // Each i18n locale file wraps its own data under a key matching the
  // filename (`courses.json` → `{ courses: {...} }`), the same shape
  // `payments.json`'s completion headline is already read off above — so a
  // dotted key like `courses.scaffold.detail` walks straight down the parsed
  // JSON with no unwrapping of its own to get wrong.
  const walkI18n = (raw: unknown, key: string): string | undefined => {
    let cur: unknown = raw;
    for (const part of key.split('.')) {
      if (!cur || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return typeof cur === 'string' ? cur : undefined;
  };
  const coursesLocale: Record<'vi' | 'en', unknown> = { vi: undefined, en: undefined };
  for (const lang of ['vi', 'en'] as const) {
    coursesLocale[lang] = JSON.parse(
      readFileSync(resolve(repo, `editor/src/i18n/locales/${lang}/courses.json`), 'utf8'),
    );
  }

  interface AppScaffoldPage {
    slug: string;
    type: string;
    name: { vi: string; en: string };
    document: { schema_version: number; root_node_id: string; nodes: Record<string, unknown> };
  }
  const APP_SCAFFOLDS: Record<string, AppScaffoldPage[]> = {};
  const coursesSpecs = coursesScaffoldMod.coursesScaffold();
  APP_SCAFFOLDS.courses = coursesSpecs.map((spec, i) => {
    const built = stableIds(
      spec.build() as { nodes: Record<string, unknown> },
      `crs${i + 1}`,
    ) as { schema_version?: number; root_node_id: string; nodes: Record<string, unknown> };
    assertPageRoot(`courses scaffold "${spec.slug || spec.type}"`, built);
    const name = { vi: '', en: '' };
    for (const lang of ['vi', 'en'] as const) {
      const h = walkI18n(coursesLocale[lang], spec.nameKey);
      if (!h) {
        console.error(`${lang}/courses.json is missing ${spec.nameKey}`);
        process.exit(1);
      }
      name[lang] = h;
    }
    return {
      slug: spec.slug,
      type: spec.type,
      name,
      document: {
        schema_version: built.schema_version ?? docVersion,
        root_node_id: built.root_node_id,
        nodes: built.nodes,
      },
    };
  });

  // ASSERTED rather than trusted forever: `installApp`'s `isPresent` rule
  // treats a slug-less page as a TEMPLATE (present by TYPE) and every other
  // page as present by SLUG, so a scaffold naming two slug-less pages, or none
  // at all, would silently change which of those two rules a page falls under.
  if (APP_SCAFFOLDS.courses.length !== 4) {
    console.error(`the courses scaffold has ${APP_SCAFFOLDS.courses.length} pages, expected 4`);
    process.exit(1);
  }
  const templatePages = APP_SCAFFOLDS.courses.filter((p) => p.slug === '');
  if (templatePages.length !== 1 || templatePages[0].type !== 'course') {
    console.error(
      'the courses scaffold must name exactly one slug-less page, of type "course" — check ' +
        'editor/src/features/courses/pageScaffold.ts',
    );
    process.exit(1);
  }
  for (const p of APP_SCAFFOLDS.courses) {
    if (!p.document.root_node_id || !p.document.nodes[p.document.root_node_id]) {
      console.error(
        `the courses scaffold page ${JSON.stringify(p.type)}/${JSON.stringify(p.slug)} names no usable root`,
      );
      process.exit(1);
    }
  }

  const appScaffoldsOut = `// GENERATED by scripts/gen-catalog.ts — do not edit by hand.
// Source: <WB_REPO>/editor/src/features/courses/pageScaffold.ts (the platform's
// own course-app page scaffold) and <WB_REPO>/server/internal/builtinapps/
// builtinapps.go (the Keys roster).

/**
 * Every key \`POST /api/sites/{siteId}/builtin-apps/{key}\` accepts, in the
 * platform's own order — read off \`builtinapps.Keys\` rather than typed here,
 * and checked at codegen against that route's own \`key\` parameter description.
 */
export const BUILTIN_APP_KEYS = ${JSON.stringify(BUILTIN_APP_KEYS)} as const;

/**
 * The pages an app needs that installing it does not create.
 *
 * \`editor/src/features/builtinapps/pageScaffold.ts\` runs this right after a
 * successful install (\`scaffoldAppPages\`) and offers it again as a repair.
 * \`isPresent\` is the rule for "does the site already have this one": a page
 * with a non-empty \`slug\` is present if the site has that SLUG (whatever its
 * type); a page with an empty \`slug\` is a TEMPLATE — reached by an entity
 * URL rather than an address of its own — and is present if the site has ANY
 * page of that TYPE, because the entity route resolves through the type's
 * default template and a second one would just sit there unreachable.
 * \`sb_store action:"app"\` follows the same rule.
 *
 * Only \`courses\` has one today; a key absent here installs with nothing
 * further to build.
 */
export const APP_SCAFFOLDS: Record<
  string,
  Array<{
    slug: string;
    type: string;
    name: { vi: string; en: string };
    document: { schema_version: number; root_node_id: string; nodes: Record<string, unknown> };
  }>
> = ${JSON.stringify(APP_SCAFFOLDS, null, 2)};
`;
  emit(resolve(process.cwd(), 'src/catalog/appscaffolds.generated.ts'), appScaffoldsOut);
  console.error(
    `${VERB} appscaffolds.generated.ts: ${Object.keys(APP_SCAFFOLDS).length} app, ` +
      `${APP_SCAFFOLDS.courses.length} pages`,
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
    // The form alone dresses the two lines its island writes after a send.
    FormKnobs: [...grp('FIELD_NODE_SKIN_KNOBS'), ...grp('FORM_MESSAGE_SKIN_KNOBS')],
    // form-text adds the textarea's own knob to the input vocabulary.
    TextFieldKnobs: [...grp('FIELD_NODE_SKIN_KNOBS'), ...grp('FIELD_AREA_SKIN_KNOBS')],
    // search-input's suggestion panel — not a form node, same table shape.
    SearchPanelKnobs: grp('SEARCH_PANEL_SKIN_KNOBS'),
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
    if (!entry.isDirectory() || entry.name === 'fieldskin') continue;
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

  // Asked LAST, and about a table this generator does not write: INERT_ON_ADD is
  // hand-kept, so no file it emits can report that the platform grew another
  // element that renders only through something else. Said after the wall of
  // "wrote …" lines rather than before it, because unlike the undocumented-route
  // warning it is not a reason to distrust what those lines just said.
  reportInertDrift(elements);

  // AND THE FOURTH STALENESS QUESTION, asked last for the same reason: a seeded
  // key nothing reads is a fact about the PLATFORM, not about anything the lines
  // above wrote. Unlike INERT_ON_ADD this one is GENERATABLE, so it is generated
  // — a table read off the platform on every run can never be the stale
  // hand-kept list its neighbour is.
  const scan = scanDeadKeys(repo, elements);
  emit(resolve(process.cwd(), 'src/catalog/deadkeys.generated.ts'), deadKeysModule(scan));
  console.error(
    `${VERB} deadkeys.generated.ts: ${scan.dead.length} of ${scan.seededKeys} seeded keys read ` +
      `by nothing (${scan.identifiers} identifiers, ${scan.files} files)`,
  );
  reportDeadKeys(scan);

  // WHERE THIS CATALOG CAME FROM, and how old that is.
  //
  // Everything above describes a platform AT ONE COMMIT. Nothing in the running
  // system says so, and nothing can compare them: `/healthz` answers "ok" and
  // the API's `info.version` is a static "1.0", so an install whose catalog is
  // three months behind the deployment it is talking to behaves exactly like one
  // generated this morning — it just quietly lacks the elements, keys and
  // preconditions the platform has grown since.
  //
  // The design already degrades safely for that: every note here is a WARNING
  // and never a refusal, precisely so a newer deployment can honour something
  // this catalog was generated before. What it could not do is SAY so. A date a
  // reader can see turns "the agent did not know about that element" from a
  // mystery into a regeneration.
  //
  // A DATE AND NOT A COMPARISON, deliberately: an automatic answer needs the
  // platform to report its own build, which means exposing a commit id on an
  // endpoint — a product decision about information disclosure, not a gap to
  // close from this side. When that exists, it slots in beside this.
  emit(resolve(process.cwd(), 'src/catalog/source.generated.ts'), platformSourceModule(repo));
}

/**
 * The platform commit this catalog was generated from.
 *
 * ABSENT IS SILENT, the rule every reader in this file follows: a checkout with
 * no git (a tarball, a fixture) yields nulls and the connect line says nothing
 * rather than inventing a provenance. `dirty` records a `--dirty` run, which
 * `codegen:check` refuses precisely because such a catalog can describe work no
 * deployment has — shipping one unknowingly is the failure this field makes
 * visible.
 */
function platformSourceModule(repo: string): string {
  const git = (args: string[]): string => {
    try {
      return execFileSync('git', ['-C', repo, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  };
  const commit = git(['rev-parse', 'HEAD']);
  const committedAt = git(['log', '-1', '--format=%cI']);
  // NO "generated at" DATE, and that is not an omission.
  //
  // It shipped with one for five minutes. `codegen:check` regenerates and
  // compares, so a field holding TODAY made the check report the catalog STALE
  // every single day, for a reason that has nothing to do with the platform —
  // the exact cry-wolf failure that trains people to stop reading a guard. The
  // commit's own date is the meaningful age anyway, and it changes only when
  // the thing being described changes, which is what this file is for.
  const source = {
    commit: commit || null,
    committedAt: committedAt || null,
    dirty: process.argv.includes('--dirty'),
  };
  return `// GENERATED by scripts/gen-catalog.ts — do not edit by hand.
// The platform commit every other generated file here describes.

export const PLATFORM_SOURCE: {
  /** web_builder's HEAD when this ran, or null where there is no git to ask. */
  commit: string | null;
  /** That commit's own date (ISO), which is what makes staleness readable. */
  committedAt: string | null;
  /** True when \`--dirty\` read a working tree, so half-finished work can be described here. */
  dirty: boolean;
} = ${JSON.stringify(source, null, 2)};
`;
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
 *
 * A PAGE'S ROOT IS NOT A PLACEHOLDER. Every page seed the editor builds spells it
 * `'ROOT'`, and renaming it (`sppro_1`) shipped pages the Go renderer drew and
 * editors before web_builder `7322af49a` painted white — then autosaved blank. A
 * node of type `root` keeps `ROOT`; an overlay or a form roots at its own element
 * and is numbered like the rest. The rename is structural (`remapIds`), never a
 * substitution over the JSON, which also rewrote any text that quoted an id.
 */
function stableIds<T extends { nodes: Record<string, unknown> }>(doc: T, prefix: string): T {
  let n = 0;
  return remapIds(doc, (_id, node) => {
    n += 1;
    return (node as { data?: { type?: string } })?.data?.type === 'root' ? PAGE_ROOT_ID : `${prefix}_${n}`;
  });
}

/** A page document must root at `ROOT` — see `stableIds`. Exits naming the seed. */
function assertPageRoot(what: string, doc: { root_node_id?: string; nodes: Record<string, unknown> }): void {
  const root = doc.nodes[PAGE_ROOT_ID] as { data?: { type?: string } } | undefined;
  if (doc.root_node_id !== PAGE_ROOT_ID || root?.data?.type !== 'root') {
    console.error(
      `the ${what} seed roots at ${JSON.stringify(doc.root_node_id)}, not a "ROOT" node of type root — ` +
        'an editor before web_builder 7322af49a paints that page white and may autosave it blank.',
    );
    process.exit(1);
  }
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
