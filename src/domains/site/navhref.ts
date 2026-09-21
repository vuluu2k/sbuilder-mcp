import type { Patch } from '../../core/patch.js';

/**
 * THE BRIDGE BETWEEN A CLICK ACTION AND THE THING A RENDERER ACTUALLY READS.
 *
 * `node.events` IS NEVER READ BY A RENDERER. The platform says so in as many
 * words (`editor/src/stores/node.ts`, on `projectHref`) and the Go side proves
 * it: `nodes.EventAttrs` SKIPS a sole navigation click outright —
 *
 *     if ev.Name == "click" && clicks == 1 && purchaseItem == "" &&
 *         (ev.Action == "go_to_url" || ev.Action == "open_page") {
 *         continue // the <a href> form; see above
 *     }
 *
 * — on the stated assumption that the node's `specials.href` has already made
 * it an `<a href>`, because "a call beside an anchor would navigate twice".
 * The editor holds up that assumption by writing the event AND its href in one
 * undo step (`projectHref`). THIS SERVER DID NOT, for as long as `sb_event`
 * has existed.
 *
 * So `sb_event action:"go_to_url"` produced a node with no `href` and no
 * `on:click`: a dead control that renders perfectly, saves, publishes, and does
 * nothing when a shopper clicks it. Silent at every step — `sb_review` reads
 * the tree and the tree is correct, `sb_look` photographs the page and the page
 * looks right.
 *
 * MEASURED ON A LIVE STOREFRONT, which is how it was found rather than an
 * argument for how it could happen. Three images on one home page carried
 * `click: go_to_url {"url":"/bo-suu-tap"}` with no href, and the published
 * markup for each was a bare `<img>` — no anchor, no `on:click` — beside a
 * button that carried the href and rendered `<a href="/bo-suu-tap">`.
 *
 * Pure, and in its own module, because two callers need it for opposite
 * reasons: `setEvent` must WRITE the projection, and `sb_review` must REPORT a
 * document that reached here by another road (an import, a hand-built
 * `sb_api_call`, a page authored before this fix).
 */

/**
 * The RESERVED id of the purchase binding
 * (`schema/src/elements/datasetBindings.ts:852`).
 *
 * It lives here rather than beside `sb_bind` because both sides of this
 * projection need it and a copy in each is how the two drift: the renderer's
 * `purchaseItem` is what decides whether a navigation may be an anchor at all.
 */
export const PRODUCT_ACTION_BINDING_ID = 'bind-product-action';

/** An event as the document stores one. */
export interface NodeEventLike {
  id?: string;
  name?: string;
  action?: string;
  payload?: Record<string, unknown>;
}

/**
 * Actions that leave the page (`schema/src/actions/engine.ts`).
 *
 * `go_to_checkout` is one of them and is deliberately NOT projectable below —
 * a checkout hop is never a plain link, and the platform's own comment says so.
 */
export const NAVIGATION_ACTIONS = ['go_to_url', 'open_page', 'go_to_checkout'] as const;

/** The two that a renderer expects to meet as an `<a href>`. */
const PROJECTABLE = new Set(['go_to_url', 'open_page']);

/**
 * The destination an event projects onto `specials.href`, or undefined.
 *
 * `open_page` reads a `url` the editor's page picker RESOLVED AND CACHED at
 * pick time — neither renderer can resolve a page id — so an `open_page`
 * payload carrying only an id projects nothing, exactly as the editor's own
 * `eventHref` does.
 */
export function eventHref(ev: NodeEventLike | null | undefined): string | undefined {
  if (!ev || !PROJECTABLE.has(ev.action ?? '')) return undefined;
  const url = (ev.payload ?? {}).url;
  return typeof url === 'string' && url !== '' ? url : undefined;
}

/** The `target` an event projects. Only `go_to_url` offers the choice. */
export function eventTarget(ev: NodeEventLike | null | undefined): string | undefined {
  if (!ev || ev.action !== 'go_to_url') return undefined;
  return (ev.payload ?? {}).openInNewTab === true ? '_blank' : undefined;
}

/** Does this node carry the reserved purchase binding? */
export function hasPurchaseBinding(bindings: Array<{ id?: string }> | undefined): boolean {
  return (bindings ?? []).some((b) => b?.id === PRODUCT_ACTION_BINDING_ID);
}

/**
 * The click event this node's `<a href>` projection comes from, or null.
 *
 * EXACTLY the editor's rule, and each clause earns its place:
 *  - exactly ONE click event — the moment anything else joins the list the
 *    renderer emits every one of them as a `Nav#go` call in the chain, and an
 *    href beside that chain would navigate twice;
 *  - a PROJECTABLE navigation action, so `go_to_checkout` keeps its runtime
 *    call;
 *  - no purchase binding — a bound button's navigation always rides chained
 *    after `AddToCart#add`, never as a link.
 */
export function soleNavigationClick(
  events: NodeEventLike[] | undefined,
  purchaseBound: boolean,
): NodeEventLike | null {
  if (purchaseBound) return null;
  const clicks = (events ?? []).filter((e) => e?.name === 'click');
  if (clicks.length !== 1) return null;
  return PROJECTABLE.has(clicks[0].action ?? '') ? clicks[0] : null;
}

/**
 * The patches that put `specials.href`/`specials.target` back in step with a
 * node's click list.
 *
 * `undefined` becomes an `unset`, and a key that is already absent produces NO
 * patch at all — both mirroring the editor's `PatchRecorder.set`, because these
 * go on the wire to peers running that code and an empty write would churn a
 * revision for nothing.
 */
export function hrefPatches(
  id: string,
  events: NodeEventLike[] | undefined,
  purchaseBound: boolean,
  current: Record<string, unknown> | undefined,
): Patch[] {
  const sole = soleNavigationClick(events, purchaseBound);
  const want: Record<string, string | undefined> = {
    href: eventHref(sole),
    target: eventTarget(sole),
  };
  const out: Patch[] = [];
  for (const [key, value] of Object.entries(want)) {
    const had = (current ?? {})[key];
    if (value === undefined) {
      if (had !== undefined) out.push({ op: 'unset', path: ['nodes', id, 'specials', key] });
      continue;
    }
    if (had !== value) out.push({ op: 'set', path: ['nodes', id, 'specials', key], value });
  }
  return out;
}

/**
 * Would this node's navigation reach the shopper?
 *
 * The question `sb_review` asks, and the one no screenshot answers: a dead
 * navigation control is the RIGHT PIXELS with nothing behind them. Returns the
 * destination the author meant when the answer is no, so the finding can name
 * the page the click was supposed to reach.
 */
export function deadNavigation(node: {
  events?: NodeEventLike[];
  bindings?: Array<{ id?: string }>;
  specials?: Record<string, unknown>;
}): { url: string } | null {
  const sole = soleNavigationClick(node.events, hasPurchaseBinding(node.bindings));
  if (!sole) return null;
  const url = eventHref(sole);
  if (url === undefined) return null;
  const href = (node.specials ?? {}).href;
  return typeof href === 'string' && href !== '' ? null : { url };
}
