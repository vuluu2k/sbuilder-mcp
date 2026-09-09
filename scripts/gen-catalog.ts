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
import { resolve } from 'node:path';
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
`;
  emit(resolve(process.cwd(), 'src/catalog/elements.generated.ts'), elementsOut);
  console.error(
    `${VERB} elements.generated.ts: ${types.length} elements, ${allControls.size} controls ` +
      `(${Object.keys(traits).length} with a declared write target), ` +
      `${bindingSources.length} binding sources, ${Object.keys(boundSpecials).length} bound-special elements, ` +
      `${Object.keys(satellites).length} satellite owners, ${firstChildOnly.length} first-child-only, doc schema v${docVersion}`,
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
