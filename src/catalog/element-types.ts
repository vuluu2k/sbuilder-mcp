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
  };
  /** Flattened trait keys, whichever shape the platform declared them in. */
  traits: string[];
  description: string;
  useWhen: string[];
  avoidWhen: string[];
  contentTips: string[];
  semantics: string[];
}
