import type { Patch } from '../../core/patch.js';
import { ELEMENTS } from '../../catalog/elements.generated.js';

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

/**
 * The actions a SOLE click projects onto `specials.href` — the platform's
 * `projectsHref` (`schema/src/actions/engine.ts`). `scroll_to` degrades to a
 * fragment link (`#<targetId>`), because publish stamps every node's id as
 * its DOM id; until the catalog carries it, `sb_event` refuses it as an
 * action no element offers, so this branch is inert rather than a guess.
 */
const PROJECTABLE = new Set(['go_to_url', 'open_page', 'scroll_to']);

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
  if (ev.action === 'scroll_to') {
    const id = (ev.payload ?? {}).targetId;
    return typeof id === 'string' && id !== '' ? `#${id}` : undefined;
  }
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
  // A scroll still runs with no href — publish emits its ScrollControl call
  // beside the fragment link — so only the no-JS fallback is missing, not the click.
  if (!sole || sole.action === 'scroll_to') return null;
  const url = eventHref(sole);
  if (url === undefined) return null;
  const href = (node.specials ?? {}).href;
  return typeof href === 'string' && href !== '' ? null : { url };
}

/**
 * The payload key each action cannot work without, read off
 * `schema/src/actions/actions/{goToUrl,openPage,openPopup}.ts` and the Go that
 * consumes them (`navhref.ts`'s `eventHref`, `popupTargetProps` in
 * `render/nodes/helpers.go`). `open_page` asks for `url` rather than the `id`
 * the platform validates, because the url is what renders.
 */
export const PAYLOAD_NEEDS: Record<string, { key: string; why: string; shape: string }> = {
  go_to_url: {
    key: 'url',
    why: 'publishes with no href and goes nowhere',
    shape: '{ "url": "/path or https://…", "openInNewTab": false }',
  },
  open_page: {
    key: 'url',
    why: 'publishes with no href — neither renderer can resolve a page id, only a url',
    shape: '{ "linkType": "page", "id": "<page id>", "label": "<page name>", "url": "/<page path>" }',
  },
  popup: {
    key: 'id',
    why: 'publishes a PopupControl call with no target, which opens nothing',
    shape: '{ "id": "<the pop-up\'s overlay id, from sb_store popup>", "label": "<name>" }',
  },
  scroll_to: {
    key: 'targetId',
    why: 'publishes a ScrollControl call with no target, which scrolls nowhere',
    shape: '{ "targetId": "<the section or block node id>", "label": "<name>" }',
  },
};

/**
 * The click-action allow-list that is LIVE for this node — the one table
 * `sb_event` refuses by and `sb_review` reports by, so the two cannot drift.
 *
 * `activeEvents` in the platform (`return action ? binding_events : events`):
 * a purchase-bound control swaps to `meta.bindingEvents`.
 *
 * PLUS ONE CONTEXT RULE THE META CANNOT STATE: `close_popup` inside a pop-up.
 * The action declares the click trigger and is wired for ANY node
 * (`islandCallForAction`, render/nodes/helpers.go — EventAttrs never consults
 * the meta), and it resolves its panel by proximity (`closest('.wb-popup')`).
 * No element meta lists it, yet the platform's own pop-up seed
 * (`editor/src/features/overlays/seed.ts`) ships a button carrying it, and the
 * editor keeps it selectable through `withCurrent`. So inside a `popup` it is
 * live; outside one it has no panel to close.
 */
export function liveEventTable(
  nodes: Record<string, { data?: { type?: string; parent?: string | null }; bindings?: Array<{ id?: string }> } | undefined>,
  id: string,
): Record<string, string[]> | undefined {
  const node = nodes[id];
  const meta = ELEMENTS[node?.data?.type ?? ''];
  if (!meta?.events) return undefined;
  const table = (hasPurchaseBinding(node?.bindings) && meta.bindingEvents) || meta.events;
  if (!table.click || table.click.includes('close_popup')) return table;
  const seen = new Set<string>();
  for (let p = node?.data?.parent; p && !seen.has(p); p = nodes[p]?.data?.parent) {
    seen.add(p);
    if (nodes[p]?.data?.type === 'popup') return { ...table, click: [...table.click, 'close_popup'] };
  }
  return table;
}
