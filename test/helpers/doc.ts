import { PageDoc } from '../../src/domains/site/document.js';

export interface Bound {
  id: string;
  source: string;
  target: { type: string; kind: string };
}

/** The bindings a node carries, typed for the assertions that read them. */
export const bindings = (n: { bindings: unknown[] }) => n.bindings as unknown as Bound[];

/** A page with nothing on it but ROOT. */
export function emptyDoc(): PageDoc {
  return PageDoc.from({
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: {
      ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: [] }, specials: {} },
    },
  } as never);
}
