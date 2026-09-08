import { ELEMENTS, SATELLITE_RULES } from '../../catalog/elements.generated.js';
import type { NodeSeed } from '../../catalog/element-types.js';
import { genId } from './ids.js';

export interface BuilderNode {
  id: string;
  data: {
    type: string;
    name?: string;
    parent: string | null;
    nodes: string[];
    isCanvas: boolean;
    hidden: boolean;
    custom: Record<string, unknown>;
  };
  style: Record<string, unknown>;
  config: Record<string, unknown>;
  specials: Record<string, unknown>;
  responsive: Record<string, { style?: Record<string, unknown>; config?: Record<string, unknown> }>;
  states?: Record<string, unknown>;
  events: unknown[];
  bindings: unknown[];
}

export interface CreateOpts {
  name?: string;
  parent?: string | null;
  style?: Record<string, unknown>;
  config?: Record<string, unknown>;
  specials?: Record<string, unknown>;
  /**
   * Per-breakpoint overrides, MERGED OVER the element's own seeded ones.
   *
   * Absent until now, and its absence was a real hole: the design skill's rules
   * 1-3 are all about writing a responsive answer, and nothing could author one
   * at CREATION — every node arrived base-only and needed a second `sb_set` that
   * a caller had to remember. The importer is the case that made it undeniable:
   * a row it recreates from a source page MUST carry a mobile stack, or the
   * columns shrink to slivers with no box overflowing and nothing to measure.
   *
   * Merged per breakpoint rather than replacing the slot, so seeding
   * `mobile.style` does not silently drop an element's own `mobile.config`.
   */
  responsive?: Record<string, { style?: Record<string, unknown>; config?: Record<string, unknown> }>;
}

/**
 * The element's own per-breakpoint defaults with the caller's laid over them.
 *
 * Per NAMESPACE, not per slot: an element that seeds `mobile.config.iconSize`
 * and a caller who asks for `mobile.style.flexDirection` must end with both.
 * Replacing the slot would drop the one nobody mentioned, which is the quiet
 * kind of loss this repo keeps finding.
 */
function mergeResponsive(
  base: Record<string, { style?: Record<string, unknown>; config?: Record<string, unknown> }>,
  over: CreateOpts['responsive'],
): Record<string, unknown> {
  if (!over) return base;
  const out: Record<string, { style?: Record<string, unknown>; config?: Record<string, unknown> }> = { ...base };
  for (const [bp, slot] of Object.entries(over)) {
    out[bp] = {
      ...(out[bp] ?? {}),
      ...(slot.style ? { style: { ...(out[bp]?.style ?? {}), ...slot.style } } : {}),
      ...(slot.config ? { config: { ...(out[bp]?.config ?? {}), ...slot.config } } : {}),
    };
  }
  return out;
}

/** Structured clone via JSON — the defaults are plain data, and this is what
 *  stops two nodes of the same type sharing one nested object. */
function copy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * The bindings an element carries for a given config, or null when its data
 * axis says nothing about this pair.
 *
 * Reads the generated `bindingsFor` table — the platform's own
 * `datasetBindings(type, config)` answers, enumerated at codegen.
 *
 * THE KIND FALLBACK IS THE POINT. The table is keyed `${datasetSource}|${kind}`,
 * but TEN elements with a table declare no default `config.kind` at all —
 * `list-dataset`, `dataset-block`, `media-dataset`, `collection-media`,
 * `product-variants`, `quantity-dataset` and friends, which is most of what a
 * store is built from. For those the key came out `category|`, matched nothing,
 * and the lookup returned null: a `list-dataset` switched to collections kept
 * `bind-target` → `product_list` and repeated PRODUCTS under a heading that said
 * collections. Every `<source>|*` row of such an element is identical (they have
 * no kind axis to vary on), so the first row for the source IS the answer, and
 * falling back to it is what makes the axis reachable at all.
 */
export function bindingsForConfig(
  type: string,
  config: Record<string, unknown> | undefined,
): unknown[] | null {
  const table = ELEMENTS[type]?.bindingsFor as Record<string, unknown[]> | undefined;
  if (!table) return null;
  const source = String(config?.datasetSource ?? '');
  if (!source) return null;
  const kind = String(config?.kind ?? '');
  const exact = table[`${source}|${kind}`];
  if (exact) return copy(exact) as unknown[];
  // No kind axis on this element: any row for the source carries the same answer.
  const prefix = `${source}|`;
  for (const [key, value] of Object.entries(table)) {
    if (key.startsWith(prefix)) return copy(value) as unknown[];
  }
  return null;
}

/**
 * Mint a node seeded from its element's catalog defaults.
 *
 * `states` is spread in ONLY when the element declares defaults for it. A node
 * that declares none must not carry the key at all: the platform's Go side marks
 * it `omitempty`, so an empty object here would change the stored bytes of every
 * document this server touches — and the render contract is byte-identical.
 */
export function createNode(type: string, opts: CreateOpts = {}): BuilderNode {
  const meta = ELEMENTS[type];
  if (!meta) {
    throw new Error(
      `sbuilder: unknown element "${type}". Use sb_catalog_search to find a real one — ` +
        'guessing a type produces a node nothing can render.',
    );
  }
  const d = meta.defaults;
  const states = d.states;
  const config = { ...copy(d.config ?? {}), ...(opts.config ?? {}) };
  return {
    id: genId(type),
    data: {
      type,
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      parent: opts.parent ?? null,
      nodes: [],
      isCanvas: meta.isContainer,
      hidden: false,
      custom: {},
    },
    style: { ...copy(d.style ?? {}), ...(opts.style ?? {}) },
    config,
    specials: { ...copy(d.specials ?? {}), ...(opts.specials ?? {}) },
    responsive: mergeResponsive(
      copy(d.responsive ?? {}) as Parameters<typeof mergeResponsive>[0],
      opts.responsive,
    ) as BuilderNode['responsive'],
    ...(states ? { states: copy(states) } : {}),
    events: [],
    // SEED THE ELEMENT'S OWN BINDINGS.
    //
    // A dataset element is INERT without them. `text-dataset` reads a product
    // title through `bind-text` → `specials.boundText`; `pricing-dataset` needs
    // six; `list-dataset` needs `bind-target` to be a product repeater at all.
    // The editor derives them at drop time from the platform's
    // `datasetBindings(type, config)`, so nothing in `meta.defaults` carried
    // them and every node this server minted saved, published and rendered its
    // placeholder forever. Found on a live page: four product cards reading
    // "$0.00" with no titles, on a catalogue that had four products.
    //
    // Codegen bakes the factory's answer for EVERY config pair, not just the
    // default one, so a caller who overrides `config.kind` or
    // `config.datasetSource` in the same call is answered here rather than left
    // holding the default entity's bindings. It used to be left: `sb_add` with
    // `datasetSource: "category"` minted a repeater still bound to
    // `product_list`, saved, published, and repeated products under a heading
    // that said collections — with no warning on any of the four steps, because
    // a wrong binding renders exactly like a right one until you read the data.
    // `sb_set` re-derives on the same table for the same reason; the two paths
    // must not disagree about what a config means.
    bindings: bindingsForConfig(type, config) ?? (copy(d.bindings ?? []) as unknown[]),
  };
}

/**
 * Mint the SATELLITES a freshly created node owns, and point it at them.
 *
 * A satellite is a real node in the document's node map referenced from
 * `config[configKey]` instead of `data.nodes` — a style-holder like the tab's
 * shared button skin. The editor's node store mints them the moment an element
 * is added (`editor/src/element/seeds.ts:5-7`, `stores/node.ts` addDetachedNode)
 * and this server did not, so an accordion it created carried no
 * `accordionItemId` at all. A missing satellite "simply resolves to nothing at
 * assemble time and the renderer takes its degrade path"
 * (`server/render/scope/capture.go:98-105`) — for a repeater that means ghost
 * cards shown to a shopper, which the platform's own meta calls a lie.
 *
 * MUTATES `owner.config`, so call it before the owner is handed to a patch, and
 * only on a node this process just created.
 *
 * An `optional` rule is skipped deliberately: `list-loading` is the one opt-in
 * satellite in the platform, because a list with no loading design shows a
 * silhouette of its own cards, which is the better answer for almost every site.
 * A `configKey` the caller already filled is left alone — an explicit id beats a
 * minted one.
 */
export function mintSatellites(owner: BuilderNode, seen: Set<string> = new Set()): BuilderNode[] {
  // A type is expanded once per call chain. No element owns itself today, and a
  // future one that did would otherwise mint until the stack ran out.
  if (seen.has(owner.data.type)) return [];
  seen.add(owner.data.type);
  const out: BuilderNode[] = [];
  for (const rule of SATELLITE_RULES[owner.data.type] ?? []) {
    if (rule.optional) continue;
    const existing = owner.config[rule.configKey];
    if (typeof existing === 'string' && existing) continue;
    // A satellite is usually one bare skin node, but the three list-empty
    // owners are born as a SUBTREE — the editor calls addDetachedTree for them,
    // and a bare list-empty is blank space where it shows a glyph, a headline
    // and a line of body.
    const seed = seedFor(rule, owner);
    const born = seed
      ? buildFromSeed(seed, owner.id, seen)
      : [createNode(rule.type, { parent: owner.id })];
    owner.config[rule.configKey] = born[0].id;
    out.push(...born, ...(seed ? [] : mintSatellites(born[0], seen)));
  }
  return out;
}

/**
 * Which seed subtree this satellite is born as, if any.
 *
 * A repeater's empty state says "No products yet" or "No posts yet" depending on
 * what it lists, so the table is keyed by the owner's `config.datasetSource`.
 * An unknown source falls back to `product`, exactly as the editor's `copyFor`
 * does — a list whose source this build does not know still gets a designed
 * empty state rather than a blank one.
 */
function seedFor(
  rule: { seed?: NodeSeed; seedBySource?: Record<string, NodeSeed> },
  owner: BuilderNode,
): NodeSeed | undefined {
  if (rule.seed) return rule.seed;
  if (!rule.seedBySource) return undefined;
  const src = owner.config.datasetSource;
  const key = typeof src === 'string' ? src : 'product';
  return rule.seedBySource[key] ?? rule.seedBySource.product;
}

/**
 * Mint a whole seeded subtree, ROOT FIRST.
 *
 * Root-first matters to every caller: the owner points `config[configKey]` at
 * `[0]`, and `addSubtree` links a child by the same index. Each node is created
 * through `createNode`, so it still gets its element's own defaults and
 * bindings; the seed carries only what the seed decided.
 */
export function buildFromSeed(seed: NodeSeed, parent: string | null, seen?: Set<string>): BuilderNode[] {
  const n = createNode(seed.type, {
    parent,
    style: seed.style,
    config: seed.config,
    specials: seed.specials,
  });
  const out: BuilderNode[] = [n, ...mintSatellites(n, seen ? new Set(seen) : undefined)];
  for (const child of seed.children ?? []) {
    const kids = buildFromSeed(child, n.id, seen);
    n.data.nodes.push(kids[0].id);
    out.push(...kids);
  }
  return out;
}
