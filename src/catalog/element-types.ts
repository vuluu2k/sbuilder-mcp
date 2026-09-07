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
