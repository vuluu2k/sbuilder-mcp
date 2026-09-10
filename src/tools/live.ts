import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text, images } from '../mcp/response.js';
import { BINDING_SOURCES, ELEMENTS } from '../catalog/elements.generated.js';
import { previewUrl } from '../vision/preview.js';
import { uploadMedia } from '../transport/media.js';
import { request } from '../transport/http.js';
import { shoot, DEFAULT_WIDTHS } from '../vision/shoot.js';
import { measure, MEASURE_NOTICE } from '../vision/measure.js';
import { isPinnedNode } from '../domains/site/sticky.js';
import { compactFindings } from '../domains/site/findings.js';
import { reviewField } from './page.js';
import { boxesForResponse, BOXES_FORMAT } from '../vision/boxes.js';

/** Element types whose content comes from the store, not from the document. */
const DATASET_TYPES = new Set([
  'list-dataset',
  'dataset-block',
  'text-dataset',
  'pricing-dataset',
  'media-dataset',
  'collection-media',
  'quantity-dataset',
  'product-variants',
]);
import { RealtimeSocket } from '../transport/socket.js';
import { LiveSession } from '../live/session.js';
import type { Patch } from '../core/patch.js';
import type { PageDoc } from '../domains/site/document.js';
import { refuseAppBlockInterior } from '../domains/site/builder.js';
import { childrenOf, isOverlay, overlayRoot, subtreeIds } from '../core/tree.js';
import { siteToken } from './credentialpick.js';
import { searchStock } from '../transport/stock.js';
import { siteFor, type ToolContext } from './context.js';
import { projectList, MEDIA_FIELDS } from './project.js';
import type { PageSession } from './page.js';

/**
 * The reserved binding id a PURCHASE control carries, and the vocabulary its
 * target speaks — `schema/src/elements/datasetBindings.ts:845-852`.
 *
 * The id is reserved so authoring and the editor's own healing never collide,
 * and `buy_now` is stored as builderx's `dynamic_checkout`: the picker's word
 * and the document's word are deliberately different, and hand-mapping either
 * one is how the two drift.
 */
const PRODUCT_ACTION_BINDING_ID = 'bind-product-action';
const PURCHASE_TARGETS: Record<string, string> = {
  add_to_cart: 'add_to_cart',
  buy_now: 'dynamic_checkout',
};

/**
 * Bind a node's content to real store data.
 *
 * Two validations, and both close a SILENT no-op:
 *
 *  - the `source` must be one the renderer's scope actually provides. An unknown
 *    one resolves to nothing and the element renders its own placeholder, which
 *    looks exactly like "the data has not loaded yet".
 *  - the `field` must live under `specials`. `applyBindings` (schema/src/binding.ts)
 *    reads the namespace off the field and `continue`s on anything else — so a
 *    `style.color` binding is stored, saved, published, and ignored forever.
 */

export function bindNode(
  doc: PageDoc,
  id: string,
  source: string,
  field: string,
  action?: string,
): Patch[] {
  const node = doc.node(id) as unknown as { bindings: Array<{ id?: string }> };
  refuseAppBlockInterior(doc, id, 'binding');
  if (!BINDING_SOURCES.includes(source)) {
    throw new Error(
      `sbuilder: "${source}" is not a binding source the renderer provides, so the binding ` +
        `would render as a placeholder forever. Valid sources: ${BINDING_SOURCES.join(', ')}.`,
    );
  }
  const dot = field.indexOf('.');
  if (dot < 0 || field.slice(0, dot) !== 'specials' || !field.slice(dot + 1)) {
    throw new Error(
      `sbuilder: a binding field must be "specials.<key>", not "${field}". The renderer ignores ` +
        'every other namespace, so the binding would be stored and never applied.',
    );
  }
  // A PURCHASE BINDING, which is what makes a button add to the cart.
  //
  // It is not an ordinary binding and cannot be written as one: the renderer
  // reads `target.action` (`server/render/nodes/helpers.go:1166`) and nothing
  // else, `sb_set` writes only style/config/specials, and this tool's plain path
  // writes no target at all — so before this branch a store built entirely
  // through these tools had no way to author an Add-to-cart button, while
  // `sb_review` reported the gap and named no fix that worked. The one control
  // a shop cannot do without was the one the tools could not make.
  if (action !== undefined) {
    const mapped = PURCHASE_TARGETS[action];
    if (!mapped) {
      throw new Error(
        `sbuilder: "${action}" is not a purchase action. Use "add_to_cart" or "buy_now" — ` +
          'those are the two the renderer draws a purchase control for.',
      );
    }
    const value = {
      id: PRODUCT_ACTION_BINDING_ID,
      source,
      field,
      target: { type: 'product', id: '', action: mapped },
    };
    // RESERVED ID, so a second call re-points the control instead of leaving two
    // purchase bindings on one button for the runtime to choose between.
    const at = node.bindings.findIndex((b) => b?.id === PRODUCT_ACTION_BINDING_ID);
    if (at >= 0) return [{ op: 'set', path: ['nodes', id, 'bindings', String(at)], value }];
    return [
      { op: 'insert', path: ['nodes', id, 'bindings'], index: node.bindings.length, value },
    ];
  }

  return [
    {
      op: 'insert',
      path: ['nodes', id, 'bindings'],
      index: node.bindings.length,
      value: { id: randomBytes(6).toString('hex'), source, field },
    },
  ];
}

/**
 * The click-action allow-list that is LIVE for this node.
 *
 * `activeEvents` in the platform, whose whole rule is one line in
 * `ActionTrait.vue`: `return action ? def.binding_events : def.events`. A
 * purchase control is a different kind of control — an unbound button navigates,
 * a bound one hands off to the cart or the checkout — and the two sets are
 * mutually exclusive, because "add this product, then go to an arbitrary URL" is
 * not a thing the cart runtime can express.
 */
function liveEventTable(type: string, node: { bindings?: Array<{ id?: string }> }): Record<string, string[]> | undefined {
  const meta = ELEMENTS[type];
  if (!meta?.events) return undefined;
  const bound = (node.bindings ?? []).some((b) => b?.id === PRODUCT_ACTION_BINDING_ID);
  return (bound && meta.bindingEvents) || meta.events;
}

/**
 * Put a click action on a node, or take one off.
 *
 * THE ONE THING NO TOOL COULD DO. `NodeSpec` carries no `events`, `sb_set`
 * writes only style/config/specials, and `createNode` always minted `events: []`
 * — so `open_cart` could not be authored, and a site built from scratch had no
 * way to open its own cart drawer. `sb_review` reported that gap
 * (`cartTrigger`) and named a fix nothing could apply, which is the same shape
 * the purchase binding had before `sb_bind` grew `action`.
 *
 * A purchase is NOT here. `add_to_cart` and `buy_now` are absent from every
 * element's allow-list, and the button meta says why in as many words: neither
 * is a click action. The intent is the BINDING — `sb_bind` with `action` — and
 * the event is what happens alongside it.
 *
 * ONE ACTION PER TRIGGER, replaced in place. The platform stores a list, but a
 * second `click` on one node is two answers to one question, and picking between
 * them at runtime is the platform's business rather than an authoring choice.
 */
export function setEvent(
  doc: PageDoc,
  id: string,
  trigger: string,
  action: string,
  payload?: Record<string, unknown>,
): Patch[] {
  const node = doc.node(id) as unknown as {
    data: { type: string };
    events?: Array<{ id?: string; name?: string }>;
    bindings?: Array<{ id?: string }>;
  };
  refuseAppBlockInterior(doc, id, 'setting an event on');
  const events = node.events ?? [];
  const at = events.findIndex((e) => e?.name === trigger);

  if (action === 'none') {
    if (at < 0) return [];
    return [{ op: 'remove', path: ['nodes', id, 'events'], index: at }];
  }

  const table = liveEventTable(node.data.type, node);
  if (!table) {
    throw new Error(
      `sbuilder: a ${node.data.type} declares no click actions, so an event on it would be ` +
        'stored and never fired. Elements that do: ' +
        Object.keys(ELEMENTS).filter((t) => ELEMENTS[t]?.events).join(', ') + '.',
    );
  }
  const allowed = table[trigger];
  if (!allowed) {
    throw new Error(
      `sbuilder: a ${node.data.type} offers no "${trigger}" trigger. It offers: ` +
        `${Object.keys(table).join(', ')}.`,
    );
  }
  if (!allowed.includes(action)) {
    const purchase = action === 'add_to_cart' || action === 'buy_now';
    throw new Error(
      `sbuilder: "${action}" is not an action a ${node.data.type} offers on ${trigger}. ` +
        (purchase
          ? 'A purchase is a BINDING, not a click action — use sb_bind with action:"' +
            action + '". '
          : '') +
        `Allowed: ${allowed.join(', ')}.`,
    );
  }

  const value = { id: `ev_${action}`, name: trigger, action, payload: payload ?? {} };
  if (at >= 0) return [{ op: 'set', path: ['nodes', id, 'events', String(at)], value }];
  return [{ op: 'insert', path: ['nodes', id, 'events'], index: events.length, value }];
}

/**
 * The credential that opens the live-edit room.
 *
 * AN AGENT KEY NOW WORKS. `server/internal/server/realtime.go:44` gives a `wbk_`
 * bearer "the same door as a session", decided from the token's own shape, and
 * gates it on member.read through the key's DELEGATED principal — so the key
 * sees the room only if the member who minted it may, and only on the site the
 * key belongs to. This function used to refuse a key-only context outright,
 * which was true before agent keys landed and now turns away a working setup.
 *
 * The peer that appears on the canvas is then the KEY, not a person: the
 * platform returns `key.ID` and `key.Name` rather than the minter's name,
 * deliberately — an avatar borrowing a human's name would tell the room a person
 * is editing when a machine is. So the merchant sees the label they chose for
 * the key moving around the page.
 *
 * Still a GETTER, read per attempt: a session access token lives ~15 minutes and
 * rotates, and a captured string replays an expired token forever on every
 * reconnect — silently, because a rejected socket auth still fires `onopen`.
 */
export function liveTokenFor(ctx: ToolContext): () => string {
  if (!ctx.session.loggedIn() && !ctx.apiKey) {
    throw new Error(
      'sbuilder: the live-edit room needs a credential. Set SB_TOKEN, or SB_EMAIL and ' +
        'SB_PASSWORD, and call sb_connect before sb_live_join.',
    );
  }
  // Prefer the key, for the reason `tokenFor` prefers it everywhere: a key is
  // narrower — one site, its own scopes, revocable on its own — while a session
  // carries the whole account.
  return () => (ctx.apiKey ? ctx.apiKey : ctx.session.token());
}

export function registerLiveTools(
  server: McpServer,
  ctx: ToolContext,
  session: PageSession,
): void {
  server.registerTool(
    'sb_live_join',
    {
      description:
        "Join the site's live-edit room as a visible peer: every write then appears in any open " +
          'editor as it happens, with the agent shown by the API key\'s own name rather than a ' +
          "person's. Always yields, so it is safe beside a human. Works with SB_TOKEN or with " +
          'SB_EMAIL / SB_PASSWORD.',
      inputSchema: { site_id: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ site_id: given }) => {
      const site_id = siteFor(ctx, given);
      const tokenFn = liveTokenFor(ctx);
      const wsBase = ctx.base.replace(/^http/, 'ws').replace(/\/$/, '');
      const socket = new RealtimeSocket(
        `${wsBase}/api/realtime/ws?site=${encodeURIComponent(site_id)}`,
        tokenFn,
      );
      const live = new LiveSession(socket, {
        onRemote: (patches) => session.applyRemote(patches),
        onDesync: (reason) => session.markStale(reason),
      });
      socket.connect();
      session.attachLive(live);
      return text({
        joined: site_id,
        note: 'Edits now publish to the room as they are made. Call sb_page_open next.',
      });
    },
  );

  server.registerTool(
    'sb_look',
    {
      description:
        "Save, render through the platform's own renderer, and return screenshots at desktop, " +
          'tablet and mobile widths, measured boxes for the bands and their children, and any ' +
          'layout defect measured on the render (overflow, overlap, unreadable text). node_id ' +
          'frames one element. Judge your work from these, not from memory.',
      inputSchema: {
      widths: z.array(z.number().int().min(320).max(2560)).optional(),
      with_boxes: z.boolean().optional(),
      box_depth: z
        .number()
        .int()
        .min(1)
        .max(8)
        .optional()
        .describe('Boxes down to this depth in the tree (default 2: bands and their children)'),
      node_id: z
        .string()
        .optional()
        .describe('Frame just this node instead of the whole page — how a designer looks at one card'),
      url: z
        .string()
        .optional()
        .describe('Shoot this address instead of the draft preview — use the PUBLISHED storefront URL to see real store data'),
      format: z
        .enum(['jpeg', 'png'])
        .optional()
        .describe('jpeg (default) is smaller and faster; png for pixel-exact colour'),
    },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ widths, with_boxes, box_depth, node_id, format, url }) => {
      await session.save();
      const { siteId, pageId } = session.location();
      // THE DRAFT PREVIEW THREADS NO STORE DATA. `/_wb/preview` renders the
      // document with an empty scope, so every repeater falls back to its empty
      // state — a product grid looks broken there and is not. Judging a
      // data-driven page by a preview screenshot is how an agent spends an hour
      // fixing a page that was already right. Pass the PUBLISHED storefront
      // address as `url` to see the real thing; it is also the escape hatch when
      // the minted preview origin is unreachable, which a dev host with
      // STOREFRONT_BASE_DOMAIN set and no TLS is.
      const target = url ?? (await previewUrl(ctx, siteId, pageId));
      // The widths are shot in parallel inside one Chrome that stays open for
      // the process; `shoot` keeps them in `widths` order. The format changes
      // bytes and latency only — the client prices an image by its pixel size,
      // so jpeg and png cost the agent the same tokens.
      // FRAMING A NODE IN THE CART DRAWER MEANS OPENING THE DRAWER. A closed
      // overlay is translated off-screen, so the clip lands outside the image
      // and the shot fails with a Playwright error naming neither the overlay
      // nor the reason. `overlayRoot` answers for a node ANYWHERE inside one,
      // which is the case that matters: the caller frames the stepper or the
      // empty state, not the drawer root.
      const openOverlay = node_id
        ? (overlayRoot(session.current().doc, node_id) ?? undefined)
        : undefined;
      const shots = await shoot(target, {
        widths: widths ?? DEFAULT_WIDTHS,
        node: node_id,
        format,
        ...(openOverlay ? { open: openOverlay } : {}),
      });
      // The boxes feed the presence cursor as well as the agent's own reading.
      session.noteBoxes(shots[0]?.boxes ?? []);
      // The findings ride WITH the picture. Judging a page by eye and judging it
      // by rule are the same act, and separating them is how the second one gets
      // skipped.
      const review = reviewField(ctx, session.current());
      // Measured on the render, not read off the document — a card that spills
      // at 390px is invisible to every check that only reads the tree.
      // The overlay subtree, read off the OPEN DOCUMENT — the boxes come from
      // the render and carry no idea which node is a drawer.
      const doc = session.current().doc;
      const skip = new Set<string>();
      for (const id of childrenOf(doc, doc.root_node_id)) {
        if (isOverlay(doc, id)) for (const n of subtreeIds(doc, id)) skip.add(n);
      }
      const visual = node_id ? [] : measure(shots, skip);
      const layout = compactFindings(visual);
      const layoutNotice = visual.length > 0 ? ctx.notices.once('measure', MEASURE_NOTICE) : undefined;
      // The legend rides with the first look only; the shape does not change after.
      const fmt = with_boxes === false ? undefined : ctx.notices.once('boxes', BOXES_FORMAT);
      // Say it ONCE, and only when it can actually mislead: a page with no
      // store-driven element has nothing to be missing from the preview.
      const dataDriven = Object.values(session.current().doc.nodes).some((n) =>
        DATASET_TYPES.has((n as { data: { type: string } }).data.type),
      );
      // THIS NOTE USED TO SAY THE OPPOSITE, and it sent readers to fix a page
      // that was right. It claimed the draft preview "threads no store data:
      // every repeater renders its empty state there" — measured false: a home
      // page previewed four real products at their real prices, matching the
      // catalogue exactly. `ServePreview` runs RenderDraft → gather → assemble,
      // the SAME path as a published page, and the platform's own comment on it
      // says the result is "byte-identical to what publishing this source would
      // serve" (storefront.go:1260). The shoot path's own comment had already
      // recorded the observation — "identical content on screen (images, prices,
      // no empty states)" — while this note contradicted it.
      //
      // What the preview genuinely cannot do is resolve ONE RECORD from the URL:
      // ServePreview never runs entity routing (that lives in ServeHost), so an
      // entity TEMPLATE previews with nothing bound. That is the real caveat,
      // and it is the opposite population of pages from the one the old note
      // warned about.
      const previewNote =
        !url && dataDriven
          ? ctx.notices.once(
              'preview-scope',
              'This is the DRAFT PREVIEW. It renders through the same path as a published page, ' +
                'so repeaters DO show real store records — judge a list page from it. What it ' +
                'cannot do is resolve a single record from the address: on an ENTITY TEMPLATE ' +
                '(the product or category detail page) nothing is bound, so the title is blank, ' +
                'the price reads zero and a variant picker shows the element\'s seed options ' +
                '("Color / Size", "Red / S") rather than the product\'s own. That is the preview, ' +
                'not the page. Pass a published storefront URL as `url` to judge a template.',
            )
          : undefined;
      // A STILL PICTURE CANNOT SHOW A PINNED ELEMENT ENGAGING, and this is the
      // one tool a caller would expect to. `position: sticky` looks identical at
      // rest and while stuck — that is the whole reason the platform needs a
      // runtime class for it — so a page carrying a pinned node has a look this
      // tool is structurally unable to photograph, however many widths it shoots.
      //
      // Gated on the document actually carrying one, and said once, for the same
      // reason `preview_note` is: a directive that fires on pages it cannot
      // apply to is noise, and noise is what makes the real notes unread.
      const pinned = Object.values(session.current().doc.nodes).some((n) =>
        isPinnedNode(n as never),
      );
      const stuckNote = pinned
        ? ctx.notices.once(
            'stuck-scroll',
            'This page pins something (position sticky/fixed). A screenshot is ONE scroll ' +
              'position, so nothing here can show whether it engages or what it looks like ' +
              'once it does — the platform styles that moment through a class a runtime island ' +
              'toggles, "wb-stuck", and CSS alone cannot express it. To check: open the ' +
              'PUBLISHED page in a browser server (Playwright or Chrome DevTools MCP), scroll, ' +
              'and read classList for "wb-stuck". If it never appears, every stuck override on ' +
              'the page is stored and never painted.',
          )
        : undefined;
      return images(shots.map((s) => ({ dataBase64: s.imageBase64, mimeType: s.mimeType })), {
        widths: shots.map((s) => s.width),
        ...(url ? { shot: url } : {}),
        ...(previewNote ? { preview_note: previewNote } : {}),
        ...(stuckNote ? { stuck_note: stuckNote } : {}),
        ...(node_id ? { framed: node_id } : {}),
        ...(with_boxes === false
          ? {}
          : {
              boxes: boxesForResponse(session.current().doc, shots[0]?.boxes ?? [], box_depth ?? 2, node_id),
              ...(fmt ? { boxes_format: fmt } : {}),
            }),
        ...review,
        ...(visual.length > 0
          ? {
              layout: layout.findings,
              layout_fixes: layout.fixes,
              ...(layoutNotice ? { layout_notice: layoutNotice } : {}),
            }
          : {}),
      });
    },
  );

  server.registerTool(
    'sb_media_list',
    {
      description:
        "The site's media library. Reuse an image before adding another; search by name, filter " +
          'by type, page with limit/offset.',
      inputSchema: {
      site_id: z.string().optional(),
      search: z.string().optional(),
      media_type: z.string().optional().describe('e.g. "image"'),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
      annotations: { readOnlyHint: true },
    },
    async ({ site_id: given, search, media_type, limit, offset }) =>
      text(
        projectList(
          await request({
          base: ctx.base,
          method: 'GET',
          path: `/api/sites/${encodeURIComponent(siteFor(ctx, given))}/media`,
          token: siteToken(ctx),
          query: { search, mediaType: media_type, limit, offset },
          fetchImpl: ctx.fetchImpl,
        }),
          'assets',
          MEDIA_FIELDS,
        ),
      ),
  );

  server.registerTool(
    'sb_media_upload',
    {
      description:
        'Put an image into the media library and get its URL back, ready for sb_set. Takes a ' +
          'local path, a URL, or a SEARCH — `query` returns real photographs with their own ' +
          'descriptions, and `pick` uploads the one you chose. The only way to add an image.',
      inputSchema: {
      site_id: z.string().optional(),
      path: z.string().optional().describe('A file on this machine'),
      url: z.string().optional().describe('Fetched, then uploaded'),
      query: z.string().optional().describe('Search real photographs; read the descriptions, then pick'),
      orientation: z.enum(['landscape', 'portrait', 'square']).optional(),
      pick: z.number().int().optional().describe('The id of the search result to upload'),
      name: z.string().optional(),
      folder_id: z.string().optional(),
      dry_run: z.boolean().optional(),
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ site_id: given, path, url, name, folder_id, query, orientation, pick, dry_run }) => {
      const site_id = siteFor(ctx, given);

      // A SEARCH IS NOT A GUESS, and the difference is the whole reason this is
      // two steps. Rule 7 records what a keyword glued into a URL returns —
      // `loremflickr` answered "kids,clothing" with a cat statue — and the fault
      // was never stock photography, it was that nobody looked. Every result
      // here carries what it actually SHOWS, so the caller reads the
      // descriptions and CHOOSES; uploading the first hit unread would rebuild
      // the cat statue with better plumbing.
      if (query) {
        const found = await searchStock(ctx.fetchImpl ?? fetch, query, {
          perPage: 8,
          orientation,
        });
        const chosen = pick !== undefined ? found.photos.find((p) => p.id === pick) : undefined;
        if (!chosen) {
          return text({
            ...(pick !== undefined ? { no_such_pick: pick } : {}),
            found: found.photos.map((p) => ({
              pick: p.id,
              shows: p.alt || '(the photographer left no description)',
              size: `${p.width}x${p.height}`,
              by: p.photographer,
            })),
            via: found.via,
            next:
              'Read what each one SHOWS, then re-call with pick:<id> and dry_run:false. The photo ' +
              "is uploaded into this site's own library, never hotlinked.",
            ...(found.via === 'proxy'
              ? {
                  key:
                    'No PEXELS_API_KEY, so this used the shared proxy — a courtesy, not a ' +
                    'guarantee. A free key at https://www.pexels.com/api/ calls Pexels directly.',
                }
              : {}),
            licence:
              ctx.notices.once(
                'stock_licence',
                'Pexels photographs are free for commercial use and attribution is appreciated ' +
                  'rather than required, so a storefront can carry one without printing a credit ' +
                  'line. The photographer and the photo page come back with each result if you ' +
                  'want to credit anyway.',
              ),
          });
        }
        if (dry_run !== false) {
          return text({
            dry_run: true,
            would_upload: chosen.url,
            shows: chosen.alt,
            by: chosen.photographer,
            into: site_id,
            note: 'Nothing was sent. Re-call with dry_run:false to upload.',
          });
        }
        const asset = await uploadMedia(ctx, site_id, {
          url: chosen.url,
          // THE DESCRIPTION BECOMES THE NAME, so the library is searchable by
          // what the photographs show and the alt on the page means something.
          name: name ?? chosen.alt ?? undefined,
          folderId: folder_id,
        });
        return text({
          asset,
          shows: chosen.alt,
          credit: { by: chosen.photographer, profile: chosen.photographer_url, photo: chosen.page_url },
          next: asset.url
            ? `Use it: sb_set id "<node>", namespace specials, keys { "src": ${JSON.stringify(asset.url)} }`
            : 'Uploaded, but the server returned no url — read it back with sb_media_list.',
        });
      }

      if (!path && !url) {
        throw new Error('sbuilder: give sb_media_upload a path, a url, or a query to search');
      }
      if (dry_run !== false) {
        return text({
          dry_run: true,
          would_upload: path ?? url,
          into: site_id,
          note: 'Nothing was sent. Re-call with dry_run:false to upload.',
        });
      }
      const asset = await uploadMedia(ctx, site_id, { path, url, name, folderId: folder_id });
      return text({
        asset,
        next: asset.url
          ? `Use it: sb_set id "<node>", namespace specials, keys { "src": ${JSON.stringify(asset.url)} }`
          : 'Uploaded, but the server returned no url — read it back with sb_media_list.',
      });
    },
  );

  server.registerTool(
    'sb_event',
    {
      description:
        'Give a node a click action — open the cart, go to a page, open a pop-up. A purchase ' +
        'is not one: use sb_bind action.',
      inputSchema: {
        id: z.string(),
        action: z
          .string()
          .describe('An action this element allows, or "none" to clear. A wrong one is refused with the list'),
        trigger: z.string().optional().describe('Default "click"'),
        payload: z.record(z.unknown()).optional(),
        dry_run: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, action, trigger, payload, dry_run }) => {
      const d = session.current();
      const patches = setEvent(d, id, trigger ?? 'click', action, payload);
      if (dry_run !== false) return text({ dry_run: true, patches });
      await session.applyAndSave(patches);
      return text({ node: id, trigger: trigger ?? 'click', action, rev: d.rev });
    },
  );

  server.registerTool(
    'sb_bind',
    {
      description:
        'Bind a node to real store data so the page shows actual products, not placeholder ' +
          'text. action makes a button a purchase control.',
      inputSchema: {
      id: z.string(),
      source: z
        .string()
        .describe(
          // The full list GROWS with the platform and would push the tool list
          // over its budget on its own; the refusal carries every source, so an
          // unknown one costs one round trip and the schema stays small.
          `e.g. ${BINDING_SOURCES.slice(0, 4).join(', ')}; ${BINDING_SOURCES.length} in all, and a wrong one is refused with the list`,
        ),
      field: z.string().describe('Where the value lands, always "specials.<key>"'),
      action: z
        .enum(['add_to_cart', 'buy_now'])
        .optional()
        .describe('Pass product.id + specials.boundProductId'),
      dry_run: z.boolean().optional(),
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, source, field, action, dry_run }) => {
      const d = session.current();
      const patches = bindNode(d, id, source, field, action);
      if (dry_run !== false) return text({ dry_run: true, patches });
      await session.applyAndSave(patches);
      return text({ bound: id, source, field, ...(action ? { action } : {}), rev: d.rev });
    },
  );
}
