import { applyPatches, type Patch } from '../../core/patch.js';
import { childrenOf, isOverlay, type DocLike, type NodeLike } from '../../core/tree.js';
import { bandOf, isGlobal, type Band } from './traps.js';

export interface OutlineNode {
  id: string;
  type: string;
  name?: string;
  children: number;
  band?: Band;
  global?: boolean;
  overlay?: boolean;
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

    if (!d.root_node_id || !d.nodes[d.root_node_id]) {
      throw new Error(
        `sbuilder: document is damaged — root_node_id=${JSON.stringify(d.root_node_id)} names no ` +
          `node, but ${Object.keys(d.nodes).length} nodes are present. Open the page in the ` +
          'editor once; its hydrate path repairs this.',
      );
    }
    return new PageDoc(d);
  }

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
      if (level + 1 < depth && kidIds.length > 0) {
        out.kids = kidIds.map((k) => line(k, level + 1));
      }
      return out;
    };
    return childrenOf(this.doc, this.doc.root_node_id).map((id) => line(id, 0));
  }
}
