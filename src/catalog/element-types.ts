export interface CatalogElement {
  type: string;
  label: string;
  category: string;
  isContainer: boolean;
  isRootOnly: boolean;
  locked: boolean;
  hideInLayer: boolean;
  /** Parent→child containment whitelist. Empty means unrestricted. */
  childAllows: string[];
  /**
   * WHICH CLICK ACTIONS THIS ELEMENT OFFERS, per trigger — the platform's own
   * `meta.events`, and `meta.bindingEvents` for the list that SWAPS IN once the
   * node carries a purchase binding (`activeEvents`, one line in
   * `ActionTrait.vue`: `return action ? def.binding_events : def.events`).
   *
   * NEITHER list contains `add_to_cart` or `buy_now`, and the button meta says
   * why in as many words: neither is a click action. A purchase is the BINDING —
   * `sb_bind` with `action` — and the event is what happens alongside it.
   *
   * An element that offers no action omits both keys, which is most of them: an
   * events array on a heading would be a dropdown that paints nothing.
   */
  events?: Record<string, string[]>;
  bindingEvents?: Record<string, string[]>;
  defaults: {
    style?: Record<string, unknown>;
    config?: Record<string, unknown>;
    specials?: Record<string, unknown>;
    responsive?: Record<string, unknown>;
    states?: Record<string, unknown>;
    /**
     * The bindings this element is born with, derived from its DEFAULT config by
     * the platform's own `datasetBindings(type, config)` factory.
     *
     * A dataset element without them is INERT: it saves, publishes and renders
     * its placeholder forever, because nothing tells the renderer which product
     * field to read. The editor seeds them at drop time; nothing seeded them
     * here until a live page came back showing four cards of "$0.00".
     */
    bindings?: unknown[];
  };
  /**
   * The bindings this element needs for each `datasetSource|kind` pair, so a
   * caller who CHANGES either key does not keep the bindings of the old one.
   *
   * `sb_set` re-derives from this table. Without it, switching a text-dataset
   * from a product title to a collection title left it bound to `product.title`
   * — the node renders the wrong entity's field, or nothing, and says neither.
   * Keyed `"<datasetSource>|<kind>"`; absent for elements with no data axis.
   */
  bindingsFor?: Record<string, unknown[]>;
  /** The inspector as a human sees it: tabs → groups → controls. */
  inspector: Array<{
    tab: string;
    groups: Array<{ key: string; label: string; controls: string[] }>;
  }>;
  /** Every control key on this element, flat — the union of `inspector`. */
  controls: string[];
  description: string;
  useWhen: string[];
  avoidWhen: string[];
  contentTips: string[];
  semantics: string[];
}

/**
 * What one inspector control writes, when the platform declares it.
 *
 * `schema/src/traits/registry.ts` describes 54 of the 373 control keys this way.
 * The rest live inside a Vue widget's prop closure and are not machine-readable,
 * so an agent learns them from the element's seeded `defaults` and from reading a
 * node — see the note `sb_traits_for` returns.
 */
export interface TraitWrite {
  /** Which namespace the value lands in. */
  target: string;
  /** The key inside that namespace. */
  writeKey: string;
  type: string;
  unit?: string;
}

export interface TraitDescription {
  key: string;
  label: string;
  writes: TraitWrite[];
  /** Per-breakpoint (or `base`) seeded values, when the platform declares them. */
  defaults?: Record<string, unknown>;
}

/**
 * A satellite an element OWNS: a real node in the document's node map whose id
 * lives in `config[configKey]` rather than in the owner's `data.nodes`.
 *
 * `optional` is the field that makes this table worth generating. Absent — the
 * normal case — the owner mints the satellite when it is created. `list-loading`
 * is the one opt-in satellite in the platform, because a list with no loading
 * design shows a silhouette of its own cards, and seeding one would replace that
 * with a design nobody asked for.
 */
export interface SatelliteRule {
  type: string;
  configKey: string;
  optional?: true;
  /** The subtree this satellite is born as, when it is more than a bare node. */
  seed?: NodeSeed;
  /**
   * The same, chosen by the owner's `config.datasetSource` — a repeater's empty
   * state says "No products yet" or "No posts yet" depending on what it lists.
   * Falls back to `product`, exactly as the editor's `copyFor` does.
   */
  seedBySource?: Record<string, NodeSeed>;
}

/**
 * Content an element arrives with: the children a palette drop seeds, or the
 * subtree a satellite is born as. Ids and parents are deliberately absent — the
 * table describes a SHAPE, and the ids are minted per document.
 *
 * Only what differs from the element's own `meta.defaults` is carried, so the
 * table stays small and says what the seed actually decided.
 */
export interface NodeSeed {
  type: string;
  style?: Record<string, unknown>;
  config?: Record<string, unknown>;
  specials?: Record<string, unknown>;
  children?: NodeSeed[];
}
