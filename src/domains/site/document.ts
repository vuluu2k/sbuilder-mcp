import { applyPatches, type Patch } from '../../core/patch.js';
import { childrenOf, isOverlay, appBlockRoot, type DocLike, type NodeLike } from '../../core/tree.js';
import { bandOf, isGlobal, type Band } from './traps.js';
import { SATELLITE_RULES } from '../../catalog/elements.generated.js';

/**
 * The satellite nodes this one owns, as {id, config key} pairs.
 *
 * Read from the GENERATED rules rather than a hand-kept list, so an element the
 * platform gives a satellite is covered the day the catalog is regenerated. A
 * key pointing at an id the document does not hold is skipped rather than
 * reported: a dangling pointer is `validateForSave`'s business, not the map's.
 */
function satellitesOf(doc: DocLike, id: string): Array<{ id: string; key: string }> {
  const node = doc.nodes[id] as NodeLike & { config?: Record<string, unknown> };
  const rules = SATELLITE_RULES[node?.data?.type ?? ''] ?? [];
  const out: Array<{ id: string; key: string }> = [];
  for (const rule of rules) {
    const satId = node?.config?.[rule.configKey];
    if (typeof satId === 'string' && satId && doc.nodes[satId]) {
      out.push({ id: satId, key: rule.configKey });
    }
  }
  return out;
}

export interface OutlineNode {
  id: string;
  type: string;
  name?: string;
  children: number;
  band?: Band;
  global?: boolean;
  overlay?: boolean;
  /** The root of a composed app block: edits under it are lost on save (trap 5). */
  app?: boolean;
  /**
   * A SATELLITE, and the `config` key its owner points at it with.
   *
   * It is a real node holding a real look — the variant option's box, the
   * quantity stepper's buttons, a repeater's empty state — but it hangs off
   * `config[key]` instead of `data.nodes`, so a walk of the child lists misses
   * it entirely. That is how a whole storefront shipped with platform-default
   * grey selects and a grey stepper on a rose-and-ink page: the outline is the
   * map an agent designs from, and these were not on it.
   */
  satellite?: string;
  kids?: OutlineNode[];
}

/**
 * One page's document, in memory.
 *
 * Owns a DEEP COPY of what it was handed. The caller's object is very often a
 * parsed HTTP response that something else still holds a reference to, and an
 * in-place mutation there is the kind of bug that only ever shows up as "the
 * second save wrote the first save's tree".
 */
export class PageDoc {
  private constructor(
    readonly doc: DocLike,
    private revision = 0,
  ) {}

  static from(raw: unknown): PageDoc {
    if (!raw || typeof raw !== 'object' || !(raw as DocLike).nodes) {
      throw new Error(
        'sbuilder: not a page document — expected { schema_version, root_node_id, nodes }',
      );
    }
    const d = JSON.parse(JSON.stringify(raw)) as DocLike;

    // A BRAND-NEW page comes back as {"schema_version":1,"root_node_id":"","nodes":{}}
    // — the server's `emptyDocument`, because it treats the document as opaque
    // JSONB and will not synthesize node shapes. Seed the same ROOT the editor's
    // own `seedRoot` does, id and all.
    //
    // This used to throw, on the reasoning that healing here would race the
    // editor's hydrate path. Running it against a live server showed the cost:
    // an agent that had just CREATED a page could not open it, which is the
    // first thing anyone connecting an agent does. And there is no race to lose
    // — an empty document has nothing to disagree with, and whichever side seeds
    // first is the tree the other then loads.
    //
    // The genuinely broken case is still refused below: a document that HAS
    // nodes but whose root_node_id names none of them is damage, not emptiness,
    // and inventing a root there would strand every existing node as an orphan.
    if (!d.root_node_id && Object.keys(d.nodes).length === 0) {
      d.root_node_id = 'ROOT';
      d.nodes.ROOT = {
        id: 'ROOT',
        data: { type: 'root', parent: null, nodes: [] },
        specials: {},
        // The remaining namespaces the platform's own makeRoot writes. Spread
        // through an index signature because NodeLike models only what the tree
        // walk reads — the document carries more, and a node missing them is a
        // node the renderer cannot draw.
        ...({ style: {}, config: {}, responsive: {}, events: [], bindings: [] } as object),
      } as DocLike['nodes'][string];
      if (!d.schema_version) d.schema_version = 2;
    }

    // A DOCUMENT THAT NAMES ITS ROOT UNDER THE WRONG KEY.
    //
    // `rootId` is the key an APP BLOCK and a section template use for the same
    // idea (server/internal/apps/blocks.go), so a document assembled from that
    // shape and PUT to a page carries it. The page renderer reads only
    // `root_node_id`: it finds no root, walks nothing, and publishes a page that
    // answers 200 with an EMPTY BODY. Found in the wild on a live storefront's
    // order-complete page, where the shopper who had just paid saw a blank
    // screen.
    //
    // Adopted rather than refused, because refusing left the one tool that can
    // SEE the problem unable to open the page, and the repair is a single save:
    // the canonical key is written and the alias dropped from what this holds.
    let adopted: string | undefined;
    if (!d.root_node_id || !d.nodes[d.root_node_id]) {
      const bag = d as unknown as Record<string, unknown>;
      for (const key of ['rootId', 'rootNodeId']) {
        const value = bag[key];
        if (typeof value === 'string' && d.nodes[value]) {
          d.root_node_id = value;
          delete bag[key];
          adopted = key;
          break;
        }
      }
    }

    if (!d.root_node_id || !d.nodes[d.root_node_id]) {
      throw new Error(
        `sbuilder: document is damaged — root_node_id=${JSON.stringify(d.root_node_id)} names no ` +
          `node, but ${Object.keys(d.nodes).length} nodes are present. Open the page in the ` +
          'editor once; its hydrate path repairs this.',
      );
    }
    const out = new PageDoc(d);
    out.adoptedRootKey = adopted;
    return out;
  }

  /**
   * The wrong key this document named its root under, when it did.
   *
   * Set means the page currently PUBLISHES BLANK and the next save fixes it —
   * a fact no other surface reports, so the tool layer says it out loud.
   */
  adoptedRootKey?: string;

  get rev(): number {
    return this.revision;
  }

  has(id: string): boolean {
    return this.doc.nodes[id] !== undefined;
  }

  node(id: string): NodeLike {
    const n = this.doc.nodes[id];
    if (!n) throw new Error(`sbuilder: no node "${id}" in this page`);
    return n;
  }

  apply(patches: Patch[]): void {
    applyPatches(this.doc as unknown as object, patches);
    this.revision += 1;
  }

  /**
   * A compressed tree — id, type, name, child count, and the flags that change
   * what a caller may safely do with a node.
   *
   * Never the document itself. A real page is hundreds of KB of JSON, and a tool
   * that returns it burns the context the agent needs for the actual design
   * work. Depth 1 (the default) is ROOT's children; deeper levels nest in `kids`.
   *
   * Overlays ARE listed, unlike in `pageChildren`: the agent needs to know the
   * cart drawer is there. `pageChildren` is for the RULES; this is for the
   * reader, and the `overlay: true` flag is how the two stay distinguishable.
   */
  outline(opts: { depth?: number } = {}): OutlineNode[] {
    const depth = opts.depth ?? 1;
    const line = (id: string, level: number): OutlineNode => {
      const n = this.node(id);
      const kidIds = childrenOf(this.doc, id);
      const out: OutlineNode = { id, type: n.data.type, children: kidIds.length };
      if (n.data.name) out.name = n.data.name;
      if (level === 0) {
        if (isOverlay(this.doc, id)) out.overlay = true;
        else out.band = bandOf(this.doc, id);
      }
      if (isGlobal(this.doc, id)) out.global = true;
      if (appBlockRoot(this.doc, id) === id) out.app = true;
      if (level + 1 < depth) {
        // Satellites come FIRST, and are counted apart from `children`: they are
        // this node's own chrome, not content in it, and mixing the two would
        // make the child count disagree with `data.nodes` — the number every
        // index-taking call (sb_add, sb_move) is written against.
        const sats = satellitesOf(this.doc, id).map((sat) => {
          const l = line(sat.id, level + 1);
          l.satellite = sat.key;
          return l;
        });
        const kids = kidIds.map((k) => line(k, level + 1));
        if (sats.length || kids.length) out.kids = [...sats, ...kids];
      }
      return out;
    };
    return childrenOf(this.doc, this.doc.root_node_id).map((id) => line(id, 0));
  }
}
