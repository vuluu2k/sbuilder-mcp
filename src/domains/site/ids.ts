import { randomBytes } from 'node:crypto';

/**
 * Id prefixes, mirrored from schema/src/node.ts.
 *
 * Purely cosmetic — an id only has to be unique — but a document this server
 * builds should be indistinguishable from one a human built, and the prefix is
 * the first thing anyone reading a document sees. The tab family is listed
 * explicitly because the generic two-letter fallback collapses all three to 'ta'.
 */
const PREFIXES: Record<string, string> = {
  root: 'rt',
  'flex-section': 'fs',
  'flex-block': 'fb',
  heading: 'he',
  text: 'tx',
  button: 'bt',
  image: 'im',
  icon: 'ic',
  spacer: 'sp',
  tab: 'tb',
  'tab-content': 'tc',
  'tab-item': 'ti',
};

/**
 * Every id this process has issued, so it can never issue one twice.
 *
 * FOUR RANDOM BYTES IS 32 BITS, AND THAT IS THIN FOR THE JOB. The birthday
 * bound puts a collision at roughly 1 in 34,000 across 500 draws — which
 * sounds like never until you notice that one `sb_import_site` run mints
 * thousands, and that the suite's own uniqueness test HIT IT: 499 unique out of
 * 500, once, in an ordinary run.
 *
 * The consequence is not a warning. Two nodes sharing an id means one
 * overwrites the other in `doc.nodes` — content silently gone, a parent's child
 * list pointing at the survivor, and a document that validates, saves and
 * publishes. It is the same family as every other entry in this repo's file:
 * the failure has no error attached to it.
 *
 * The width stays FOUR BYTES because the platform's own ids are eight hex
 * characters and a document this server builds should be indistinguishable
 * from one a human built. Uniqueness comes from remembering instead — which is
 * the scope that actually matters, since one process builds one document.
 */
const issued = new Set<string>();

export function genId(type: string): string {
  const prefix = PREFIXES[type] ?? (type.replace(/[^a-z]/g, '').slice(0, 2) || 'nd');
  for (;;) {
    const id = `${prefix}_${randomBytes(4).toString('hex')}`;
    if (issued.has(id)) continue;
    issued.add(id);
    return id;
  }
}

/** The id every page document's root carries — the editor's seeds spell it literally. */
export const PAGE_ROOT_ID = 'ROOT';

type IdDoc = { root_node_id?: string; nodes: Record<string, unknown> };

/**
 * Rename a document's node ids STRUCTURALLY: the `nodes` keys, a node's `id`,
 * every string in its `data` (`parent`, `nodes[]`) and its `config` (the
 * satellite references — `emptyStateId`, `accordionItemId`, …) that equals an
 * old id exactly, plus `root_node_id`.
 *
 * Never a substitution over the serialised JSON: that rewrote an id wherever it
 * appeared INSIDE a string, so a heading or an href quoting one was corrupted.
 * And never an exact match over the WHOLE node either: a heading whose text IS
 * an id (`spcom_3`) is still text. `specials` and `style` carry content, never a
 * node reference — every generated seed was scanned for where ids live.
 */
export function remapIds<T extends IdDoc>(doc: T, idFor: (id: string, node: unknown) => string): T {
  const map = new Map<string, string>();
  for (const [id, node] of Object.entries(doc.nodes)) map.set(id, idFor(id, node));
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return map.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  const REF_FIELDS = new Set(['id', 'data', 'config']);
  const nodes: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(doc.nodes)) {
    nodes[map.get(id)!] =
      node && typeof node === 'object'
        ? Object.fromEntries(Object.entries(node).map(([k, x]) => [k, REF_FIELDS.has(k) ? walk(x) : x]))
        : node;
  }
  const out = { ...doc, nodes };
  if (typeof doc.root_node_id === 'string') out.root_node_id = map.get(doc.root_node_id) ?? doc.root_node_id;
  return out;
}

/**
 * Fresh node ids for a seeded document.
 *
 * The generated documents carry STABLE placeholder ids (`spcat_3`, `ckf_1`) so
 * that re-running codegen produces no diff. Placeholders are not values: the
 * editor mints an id per node at drop time, and two pages built from one seed
 * must be as unrelated as two built by hand. A page's `ROOT` is the one id that
 * is NOT re-minted: it is the editor's literal, and a minted root (`rt_<hex>`)
 * paints white in any editor before web_builder `7322af49a`.
 */
export function withFreshIds<T extends IdDoc>(doc: T): T {
  return remapIds(doc, (id, node) =>
    id === PAGE_ROOT_ID ? id : genId((node as { data?: { type?: string } })?.data?.type ?? 'node'),
  );
}

/**
 * A PAGE document whose root is not `ROOT`, renamed so it is — or null when it
 * already is, or cannot safely be (no root node, or `ROOT` taken by another node).
 *
 * The Go renderer follows `root_node_id` wherever it points, so a minted root
 * (`sppro_1`, `rt_<hex>`) publishes fine. The EDITOR is what breaks: builds before
 * web_builder `7322af49a` render a hard-coded `node-id="ROOT"`, draw a white canvas,
 * and may re-seed — and autosave — an empty document over the page.
 */
export function canonicalRoot<T extends IdDoc>(doc: T): T | null {
  const root = doc.root_node_id;
  if (!root || root === PAGE_ROOT_ID || !doc.nodes[root] || doc.nodes[PAGE_ROOT_ID]) return null;
  return remapIds(doc, (id) => (id === root ? PAGE_ROOT_ID : id));
}
