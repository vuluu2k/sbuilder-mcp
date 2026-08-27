import { ELEMENTS } from '../../catalog/elements.generated.js';
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
}

/** Structured clone via JSON — the defaults are plain data, and this is what
 *  stops two nodes of the same type sharing one nested object. */
function copy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
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
    config: { ...copy(d.config ?? {}), ...(opts.config ?? {}) },
    specials: { ...copy(d.specials ?? {}), ...(opts.specials ?? {}) },
    responsive: copy(d.responsive ?? {}) as BuilderNode['responsive'],
    ...(states ? { states: copy(states) } : {}),
    events: [],
    bindings: [],
  };
}
