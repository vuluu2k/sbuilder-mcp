import { BASE_ONLY_CONFIG, BASE_ONLY_EXCEPTIONS } from '../../catalog/elements.generated.js';

/**
 * CONFIG THAT ONLY EXISTS AT BASE, AND THE DEFAULT THAT MISSES IT.
 *
 * `setKeys` writes per breakpoint unless the caller says `base`, because a
 * design should respond — trap 4, and it is right for style, which the cascade
 * resolves per breakpoint on both sides.
 *
 * Config is different, and only HALF different. A node's config is
 * per-breakpoint exactly where the renderer reads it through the MERGED
 * namespace: `css.go` does, inside its breakpoint loop. `html.go` does NOT —
 * `nodes.ConfigInt` and `ConfigString` (`render/nodes/helpers.go:1421,1433`)
 * index `node.Config[key]` directly, and one HTML document serves all three
 * widths, so anything an `html.go` decides can only come from base.
 *
 * So for these keys the responsive default is silently wrong. The value lands in
 * `responsive[bp].config`, the editor canvas updates, and publish never reads
 * it: a canvas-versus-published divergence with no error at any step. The
 * platform's ledger names three that shipped and had to be reverted — `icon`
 * iconSize, `text-dataset` descriptionLines, `media-dataset` layout.
 *
 * THE DATA AXIS IS THE WORST OF THEM, and this repo has already paid for it once
 * from the other direction. `datasetSource`, `kind`, `collectionId` and
 * `collectionType` are all on the list, while `rebindPatch` writes the derived
 * bindings at NODE level. So `sb_set config {datasetSource:"category"}` without
 * `base` left the bindings saying category and the config saying nothing any
 * renderer reads — `dataset-block/html.go` reads base and still said product.
 * Both halves reported success, which is exactly the shape CLAUDE.md records
 * under "THE DATA AXIS OF A REPEATER WAS UNREACHABLE THROUGH EITHER TOOL",
 * re-entering through the breakpoint layer instead of the kind axis.
 *
 * ROUTED AND SAID, not refused and not silently done — the hover precedent. A
 * refusal would make the obvious call fail on a caller whose intent is not in
 * doubt; doing it silently would leave someone reading the node back hunting for
 * keys in a slot they never wrote to.
 *
 * The EXCEPTIONS are per `type:key` and are load-bearing:
 * `quantity-button:iconSize` is genuinely responsive, compiled by the satellite
 * CSS compiler as the `--icon-size` var, so forcing it to base would take a
 * working per-breakpoint control away.
 */
const BASE_ONLY = new Set(BASE_ONLY_CONFIG);
const EXCEPTIONS = new Set(BASE_ONLY_EXCEPTIONS);

/** Does this element type keep `key` at base whatever breakpoint is asked for? */
export function isBaseOnlyConfig(type: string, key: string): boolean {
  return BASE_ONLY.has(key) && !EXCEPTIONS.has(`${type}:${key}`);
}

/**
 * Split a config write into the keys that must land at base and the rest.
 *
 * Both halves are returned even when one is empty, so the caller writes the same
 * two patch groups every time rather than branching on which case it is in.
 */
export function splitBaseOnly(
  type: string,
  keys: Record<string, unknown>,
): { base: Record<string, unknown>; responsive: Record<string, unknown> } {
  const base: Record<string, unknown> = {};
  const responsive: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(keys)) {
    if (isBaseOnlyConfig(type, k)) base[k] = v;
    else responsive[k] = v;
  }
  return { base, responsive };
}

/** The same split for `unset`, which shares the slot a write lands in. */
export function splitBaseOnlyKeys(
  type: string,
  keys: readonly string[],
): { base: string[]; responsive: string[] } {
  const base: string[] = [];
  const responsive: string[] = [];
  for (const k of keys) {
    if (isBaseOnlyConfig(type, k)) base.push(k);
    else responsive.push(k);
  }
  return { base, responsive };
}

/**
 * What the caller is told when a config write was moved to base.
 *
 * Named per KEY rather than per element, because the key is the whole content of
 * the answer — a caller who is told "iconSize is base-only" knows it for every
 * icon on the page, and `ctx.notices` keys on that so a batch repairing ten
 * nodes does not carry ten copies.
 */
export function baseOnlyNote(keys: readonly string[], breakpoint: string): string {
  const list = keys.join(', ');
  const plural = keys.length > 1 ? 'these keys' : 'this key';
  return (
    `${list}: the publish renderer reads ${plural} from BASE only — html.go indexes ` +
    'node.Config[key] with no responsive merge, and one HTML document serves every width. ' +
    `Written at "${breakpoint}" the value would show on the editor canvas and vanish on ` +
    'publish, with no error at any step, so it was written at base instead. If you need this ' +
    'to differ by width, the answer is a style key or a different element, not a breakpoint.'
  );
}
