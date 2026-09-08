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
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

async function main(): Promise<void> {
  const repo = process.env.WB_REPO;
  if (!repo) {
    console.error('WB_REPO is not set — point it at a web_builder checkout');
    process.exit(1);
  }
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
`;
  writeFileSync(resolve(process.cwd(), 'src/catalog/elements.generated.ts'), elementsOut, 'utf8');
  console.error(
    `wrote elements.generated.ts: ${types.length} elements, ${allControls.size} controls ` +
      `(${Object.keys(traits).length} with a declared write target), ` +
      `${bindingSources.length} binding sources, ${Object.keys(boundSpecials).length} bound-special elements, ` +
      `${Object.keys(satellites).length} satellite owners, ${firstChildOnly.length} first-child-only, doc schema v${docVersion}`,
  );

  const dest = resolve(process.cwd(), 'src/catalog/api.generated.ts');
  writeFileSync(dest, out, 'utf8');
  console.error(
    `wrote ${dest}: ${ops.length} operations, ` +
      `${Object.keys(spec.definitions ?? {}).length} definitions, ` +
      `${withBody.filter((o) => !o.bodyDescribed).length}/${withBody.length} with an undescribed body`,
  );
}

await main();

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
