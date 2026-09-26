/**
 * THE STORE FLOWS THAT MUST BE ORDERED.
 *
 * `sb_review` names its readiness gaps (`ReadinessGapId`). Most are one
 * call each — a delivery option, a payment gateway, a product, a page of the
 * right type — because `REQUEST_SHAPES` tells the caller what those calls take.
 * The ones that are not are the flows in this file: each is several writes in
 * an order that is written down in exactly one place, the editor, and is not
 * guessable from the API surface.
 *
 * A CHECKOUT IS FOUR WRITES IN A FIXED ORDER, and the editor is the only place
 * they are written down (`editor/src/features/pages/checkoutPage.ts`):
 *
 *   1. create an order form
 *   2. PUT it back WHOLE with the cart as its source — name and type ride along,
 *      or `Normalize()` renames it "Form" and turns it `custom`, after which the
 *      document in step 3 is refused as "mappings do not fit this form type"
 *   3. save the field document, with the payment methods and delivery options
 *      filled in at that one moment, because a pure template cannot read a store
 *   4. create the page of TYPE `checkout` and PUBLISH it — /checkout resolves to
 *      the PUBLISHED page of the type, so a draft is the same as no page at all
 *
 * Miss any one and the Checkout button every cart drawer ships with answers 404.
 *
 * The editor's own recovery is copied rather than reinvented: if any step after
 * the create fails, the form is deleted again — a form nobody can see is the
 * orphan the retry would then duplicate. The editor shipped that bug first.
 *
 * ONE TOOL WITH AN `action`, not one tool per surface: the `tools/list` ceiling
 * is 27,864 characters and 31 tools already sit under it. There are SIX flows
 * here today — checkout, form, chrome, menu, overlay_attach, app — and the enum
 * is how each arrived without a seventh, eighth and ninth entry in that list.
 * Four of them live in their own modules (`chrome.ts`, `menu.ts`, `overlay.ts`,
 * `app.ts`) and are dispatched from here; the checkout and `form` are written
 * out below, because they came first.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { request, redact } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { siteFor, type ToolContext } from './context.js';
import { withFreshIds } from '../domains/site/ids.js';
import { siteChrome, wearChrome, type PageSession } from './page.js';
import { addSubtree } from '../domains/site/builder.js';
import { attachGlobal, buildChrome, detachGlobal } from './chrome.js';
import { bindMenu } from './menu.js';
import { attachOverlay, ensureCartDrawer, relocalizeCartDrawer } from './overlay.js';
import { installApp } from './app.js';
import { BUILTIN_APP_KEYS } from '../catalog/appscaffolds.generated.js';
import { ELEMENTS } from '../catalog/elements.generated.js';
import { PAGE_TYPES } from '../catalog/storepages.generated.js';
import {
  CHECKOUT_FORM,
  CHECKOUT_FORM_DOCUMENT,
  CHECKOUT_PAGE_DOCUMENT,
  CHECKOUT_TEXT,
  FORM_ID_SENTINEL,
  HEADLINE_SENTINEL,
  FORM_TEMPLATES,
} from '../catalog/checkout.generated.js';

type Language = keyof typeof CHECKOUT_TEXT;

interface Gateway {
  provider: string;
  label?: string;
  providerLabel?: string;
  enabled?: boolean;
  configured?: boolean;
}

interface Step {
  step: number;
  what: string;
  method: string;
  path: string;
  body?: unknown;
}

/**
 * The store's live gateways and delivery options.
 *
 * TOLERANT, like `gatherReadiness`: a list that cannot be read leaves that half
 * of the form empty rather than failing the flow. A store with no gateways gets
 * cash on delivery alone, which is the honest list — it is the only method that
 * store can take.
 *
 * `strict` is for REWRITING a form that already works: there a failed read is
 * not "the store has none", and treating it so would empty a live checkout.
 */
async function readStore(
  ctx: ToolContext,
  siteId: string,
  strict = false,
): Promise<{ gateways: Gateway[]; shipping: string[] }> {
  const get = async <T>(path: string): Promise<T | null> => {
    try {
      return (await request({
        base: ctx.base,
        method: 'GET',
        path,
        token: siteToken(ctx),
        fetchImpl: ctx.fetchImpl,
      })) as T;
    } catch (e) {
      if (strict) throw e;
      return null;
    }
  };
  const site = encodeURIComponent(siteId);
  const [pay, ship] = await Promise.all([
    get<{ paymentGateways?: Gateway[] }>(`/api/sites/${site}/payment-gateways`),
    get<{ shippingMethods?: Array<{ name?: string }>; methods?: Array<{ name?: string }> }>(
      `/api/sites/${site}/shipping-methods`,
    ),
  ]);
  const methods = ship?.shippingMethods ?? ship?.methods ?? [];
  return {
    gateways: (pay?.paymentGateways ?? []).filter((g) => g.enabled && g.configured),
    shipping: methods.map((m) => m?.name).filter((n): n is string => Boolean(n)),
  };
}

type PaymentMethod = { value: string; label: string; description: string };

function paymentMethods(gateways: Gateway[], lang: Language): PaymentMethod[] {
  const t = CHECKOUT_TEXT[lang];
  const desc = (provider: string): string =>
    t.paymentDesc[provider.toLowerCase() as keyof typeof t.paymentDesc] ??
    t.paymentDesc.gateway ??
    '';
  // Cash on delivery leads, under a stable id rather than its label, so the
  // label can be reworded or translated without the stored value moving.
  return [
    { value: 'cod', label: t.codLabel, description: t.paymentDesc.cod ?? '' },
    ...gateways.map((g) => ({
      value: g.provider,
      label: g.label || g.providerLabel || g.provider,
      description: desc(g.provider),
    })),
  ];
}

type FormNode = { specials?: Record<string, unknown> };

/**
 * Rewrite an order form's payment and delivery answers to the store's CURRENT
 * ones, in place. The options are baked in when the document is saved and read
 * by nothing at render time, so a delivery method added after the checkout was
 * made leaves its select empty — measured: an E2E store whose only shipping
 * method arrived second could not take an order. A method the merchant already
 * has keeps its own label and description; only the set moves.
 */
export function syncOrderDocument(
  doc: { nodes?: Record<string, FormNode> },
  fresh: PaymentMethod[],
  shipping: string[],
): { changed: boolean; payment_methods?: string[]; delivery_options?: string[] } {
  const out: { changed: boolean; payment_methods?: string[]; delivery_options?: string[] } = { changed: false };
  for (const node of Object.values(doc.nodes ?? {})) {
    const sp = node.specials;
    if (sp?.name === 'payment_method') {
      const had = new Map(
        ((sp.methods as PaymentMethod[] | undefined) ?? []).map((m) => [m.value, m] as const),
      );
      const next = fresh.map((m) => had.get(m.value) ?? m);
      if (JSON.stringify(next) !== JSON.stringify(sp.methods ?? [])) {
        sp.methods = next;
        if (!next.some((m) => m.value === sp.defaultValue)) sp.defaultValue = next[0]?.value ?? '';
        out.changed = true;
      }
      out.payment_methods = next.map((m) => m.value);
    }
    if (sp?.name === 'shipping_method') {
      if (JSON.stringify(sp.options ?? []) !== JSON.stringify(shipping)) {
        sp.options = [...shipping];
        out.changed = true;
      }
      out.delivery_options = [...shipping];
    }
  }
  return out;
}

/**
 * `action:"checkout_sync"` — every order form on the site brought up to date,
 * then the checkout pages republished, because a form-document edit reaches the
 * storefront only through a page publish.
 */
async function syncCheckout(ctx: ToolContext, siteId: string, lang: Language, dryRun: boolean) {
  const site = encodeURIComponent(siteId);
  const send = async <T>(method: string, path: string, body?: unknown): Promise<T> =>
    (await request({ base: ctx.base, method, path, token: siteToken(ctx), body, fetchImpl: ctx.fetchImpl })) as T;
  const { gateways, shipping } = await readStore(ctx, siteId, true);
  const fresh = paymentMethods(gateways, lang);
  const forms = ((await send<{ forms?: Array<{ id: string; name?: string; type?: string }> }>(
    'GET',
    `/api/sites/${site}/forms`,
  )).forms ?? []).filter((f) => f.type === CHECKOUT_FORM.type);

  const results: Array<Record<string, unknown>> = [];
  for (const f of forms) {
    const path = `/api/sites/${site}/forms/${encodeURIComponent(f.id)}/document`;
    const doc = (await send<{ document?: { nodes?: Record<string, FormNode> } }>('GET', path)).document;
    if (!doc) continue;
    const r = syncOrderDocument(doc, fresh, shipping);
    if (r.changed && !dryRun) await send('PUT', path, { document: doc });
    results.push({ form_id: f.id, name: f.name, ...r });
  }
  // Listed and republished even when no form changed, so a run whose publish
  // failed last time is repaired by simply running again.
  const pages = forms.length
    ? ((await send<{ pages?: Array<{ id: string; type?: string }> }>('GET', `/api/sites/${site}/pages`)).pages ?? [])
        .filter((p) => p.type === 'checkout')
        .map((p) => p.id)
    : [];
  let republished: string[] = [];
  if (!dryRun && pages.length) {
    const pub = await send<{ published?: Array<{ pageId: string }> }>('POST', `/api/sites/${site}/publish`, { pageIds: pages });
    republished = (pub.published ?? []).map((p) => p.pageId);
  }
  return {
    ...(dryRun ? { dry_run: true } : {}),
    forms: results,
    ...(dryRun ? { would_republish: pages } : { republished }),
    ...(forms.length === 0 ? { note: 'No order form on this site — run action:"checkout" to make one.' } : {}),
    ...(shipping.length === 0
      ? { delivery_gap: 'The store has no delivery method, so the select stays empty. Create one with POST /api/sites/{siteId}/shipping-methods, then run this again.' }
      : {}),
    ...(!dryRun && pages.some((p) => !republished.includes(p))
      ? { not_published: 'The publish answered and skipped some checkout pages, so they still show the old options. Publish them with sb_publish.' }
      : {}),
    ...(results.some((r) => r.changed) && !dryRun ? { hint: 'An order form placed on a page that is not a checkout page shows the new options after sb_publish of that page.' } : {}),
  };
}

/**
 * The form document with this store's real answers in it.
 *
 * THE OPTION STRING IS THE VALUE. The server matches a payment answer,
 * lower-cased, against the ids of the gateways the store has switched on, and it
 * resolves a delivery answer to a fee by the method's NAME. A template's
 * hand-typed label therefore collects an answer worth nothing — a field that
 * looks filled in and opens no payment, with nothing on screen to say why.
 */
function fillDocument(
  gateways: Gateway[],
  shipping: string[],
  lang: Language,
): { document: unknown; methods: Array<{ value: string; label: string }>; shipping: string[] } {
  const methods = paymentMethods(gateways, lang);
  const doc = withFreshIds(
    JSON.parse(JSON.stringify(CHECKOUT_FORM_DOCUMENT)) as {
      nodes: Record<string, { data?: { type?: string }; specials?: Record<string, unknown> }>;
    },
  );
  for (const node of Object.values(doc.nodes)) {
    if (node.specials?.name === 'payment_method') {
      node.specials.methods = methods;
      node.specials.defaultValue = methods[0]?.value ?? '';
    }
    if (node.specials?.name === 'shipping_method') {
      // A store with no methods gets an empty select rather than an invented
      // option, exactly as the editor does.
      node.specials.options = shipping;
    }
  }
  return { document: doc, methods, shipping };
}

function pageDocumentFor(formId: string, headline: string): unknown {
  const json = JSON.stringify(
    withFreshIds(CHECKOUT_PAGE_DOCUMENT as { nodes: Record<string, { data?: { type?: string } }> }),
  )
    .split(JSON.stringify(FORM_ID_SENTINEL).slice(1, -1))
    .join(formId)
    .split(HEADLINE_SENTINEL)
    .join(headline);
  const doc = JSON.parse(json) as {
    nodes: Record<string, { data?: { type?: string }; events?: unknown[] }>;
  };
  sendTheShopperOn(doc);
  return doc;
}

/**
 * WHERE THE SHOPPER GOES AFTER THE ORDER, which nothing else supplies.
 *
 * Measured on a store built entirely with these tools: press "Đặt hàng" and the
 * order is created — and the shopper stays on the checkout page, looking at a
 * receipt-shaped list of totals that all read 0 ₫ because the cart it was
 * summing has just been emptied, under an inline confirmation whose default
 * wording runs the order number into the total ("Đơn hàng #1003129.000 ₫").
 * Nothing is broken; nothing sent them anywhere.
 *
 * The form record HAS a setting for this and it does not work:
 * `settings.afterSubmit.action = "redirect"` is accepted by the API, stored, and
 * carried nowhere — `forms/pagesource.go` says so outright ("Only the MESSAGE
 * behaviour is carried today"), and `page.FormRef.RedirectPath` is assigned by
 * nothing in the platform. Writing `specials.sentRedirect` on the node does not
 * survive either: the composer overwrites that special from the same empty
 * field on every render. So the platform's seed cannot carry this, and neither
 * can any setting an agent can reach.
 *
 * What does work is the form's own success chain, which the island runs BEFORE
 * afterSubmit and which `form`'s meta declares `go_to_url` on. `/checkout/complete`
 * is the right destination unconditionally: it resolves by page TYPE, and it
 * backstops itself with a built-in receipt when the store has no completion page
 * of its own, so this is never a link to a 404.
 */
function sendTheShopperOn(doc: { nodes: Record<string, { data?: { type?: string }; events?: unknown[] }> }): void {
  for (const node of Object.values(doc.nodes)) {
    if (node.data?.type !== 'form') continue;
    const events = (node.events ?? []) as Array<{ name?: string }>;
    if (events.some((e) => e.name === 'form:success')) continue;
    events.unshift({
      id: 'ev_go_to_url',
      name: 'form:success',
      action: 'go_to_url',
      payload: { url: COMPLETE_PATH },
    } as never);
    node.events = events;
  }
}

/** The path a completed order lands on. Resolves by page TYPE, and serves a
 * built-in receipt when the store has authored no completion page. */
const COMPLETE_PATH = '/checkout/complete';

/**
 * THE FORM TEMPLATES, as a tuple zod can turn into an enum.
 *
 * Sorted so the list a caller reads is stable across codegen runs, and derived
 * from the generated table rather than typed out — the platform ships 17 and
 * this repo carried ONE, so a store built with these tools could have a checkout
 * and nothing else: no contact form, no newsletter, and none of the five auth
 * forms, even though `forms.Type` declares them and `customerauth` serves them.
 */
const FORM_TEMPLATE_KEYS = Object.keys(FORM_TEMPLATES).sort() as unknown as [string, ...string[]];

/**
 * Seed one form from the platform's own template.
 *
 * THE SAME THREE WRITES THE CHECKOUT MAKES, minus the page: create, PUT the form
 * back WHOLE (name and type ride along, or `Normalize()` renames it "Form" and
 * turns it `custom`, after which the document is refused as "mappings do not fit
 * this form type"), then save the field document. The document is the half that
 * cannot be guessed: its `mapTo` values are a vocabulary the server validates,
 * and an auth form's are checked harder still.
 *
 * No page is made. Where a login form belongs is a design decision — the
 * caller places it with `sb_add` and points `specials.formId` at the id this
 * returns — and `/account` is the one page that is not a free choice, because
 * `membersOnlyRedirectTarget` sends every gated visitor there.
 */
/**
 * The page a seeded form goes on, built and saved in the same call.
 *
 * WHY THIS EXISTS. seedForm made a form and stopped, and said so: "No page is
 * made. Where a login form belongs is a design decision." True, and it left the
 * caller three steps — create a page, sb_add a form element, sb_set its formId —
 * with nothing insisting they belong together. Measured: a store built with
 * these tools had no login page, no register page and no forgot page, and its
 * own header had nothing to link to. The design decision was never the
 * obstacle; the three steps were.
 *
 * A BLANK PAGE FIRST, THEN THE SUBTREE, rather than a document posted with the
 * create. The checkout path can post one because it has a whole seeded document
 * to post; here the document is one element, and going through the session is
 * how every other builder in this server writes a page — band rules, id
 * minting and the save contract all come with it instead of being re-derived.
 */
/**
 * A login, register or contact form's page is of that PURPOSE type — its own icon,
 * its own purpose. Slug-routed types only: `checkout` is a form template AND a
 * fixed-path type, and a page made here must never claim /checkout.
 */
function pageTypeFor(template: string): string {
  return PAGE_TYPES.some((t) => t.type === template && t.ownSlug) ? template : 'page';
}

async function placeFormOnPage(
  ctx: ToolContext,
  session: PageSession,
  siteId: string,
  formId: string,
  pageName: string,
  headline: string | undefined,
  type: string,
): Promise<{ id: string; name: string; chrome?: Record<string, unknown> }> {
  const made = (await request({
    base: ctx.base,
    method: 'POST',
    path: `/api/sites/${encodeURIComponent(siteId)}/pages`,
    token: siteToken(ctx),
    body: { name: pageName, type },
    fetchImpl: ctx.fetchImpl,
  })) as { page?: { id?: unknown; name?: unknown } };
  const id = made.page?.id;
  if (typeof id !== 'string' || !id) {
    throw new Error('sbuilder: the platform accepted the page create and returned no page');
  }
  await session.open(siteId, id);
  const doc = session.current();
  const { patches } = addSubtree(doc, doc.doc.root_node_id, {
    type: 'flex-section',
    children: [
      {
        type: 'flex-block',
        children: [
          ...(headline ? [{ type: 'heading', specials: { text: headline } }] : []),
          { type: 'form', specials: { formId } },
        ],
      },
    ],
  });
  await session.applyAndSave(patches);
  // The site's header and footer, the way sb_page_create dresses a page —
  // AFTER the form, so the footer lands last in ROOT's band order.
  const chrome = await wearChrome(session, siteId, id, await siteChrome(ctx, siteId));
  return { id, name: typeof made.page?.name === 'string' ? made.page.name : pageName, ...(chrome ? { chrome } : {}) };
}

async function seedForm(
  ctx: ToolContext,
  session: PageSession,
  siteId: string,
  key: string,
  formName: string | undefined,
  pageName: string | undefined,
  headline: string | undefined,
  dryRun: boolean,
): Promise<unknown> {
  const tpl = FORM_TEMPLATES[key as keyof typeof FORM_TEMPLATES] as {
    key: string;
    type: string;
    settings: Record<string, unknown>;
    document: { nodes: Record<string, { data?: { type?: string } }> };
  };
  const site = encodeURIComponent(siteId);
  const name = formName ?? tpl.key;
  const document = withFreshIds(tpl.document);
  const fields = Object.values(document.nodes)
    .map((n) => (n as { specials?: { name?: string } }).specials?.name)
    .filter((n): n is string => typeof n === 'string' && n !== '');

  if (dryRun) {
    return {
      dry_run: true,
      template: tpl.key,
      form_type: tpl.type,
      fields,
      plan: [
        { step: 1, what: 'create the form', method: 'POST', path: `/api/sites/${site}/forms` },
        {
          step: 2,
          what: 'PUT it back WHOLE — name and type must ride along or Normalize() turns it custom',
          method: 'PUT',
          path: `/api/sites/${site}/forms/{formId}`,
        },
        {
          step: 3,
          what: "save the template's field document",
          method: 'PUT',
          path: `/api/sites/${site}/forms/{formId}/document`,
        },
      ],
      ...(pageName
        ? {
            would_also: `create a page named ${JSON.stringify(pageName)} of type "${pageTypeFor(key)}" and put ` +
              'the form on it, so the form has an address a header can link to — wearing the ' +
              "header and footer the site's home page wears",
          }
        : {
            no_page: 'Only the form. Pass page_name to have the page made and the form placed ' +
              'on it in this same call — the three steps that otherwise get skipped.',
          }),
      preview: redact({ name, type: tpl.type }),
    };
  }

  const send = async <T>(method: string, path: string, body?: unknown): Promise<T> =>
    (await request({
      base: ctx.base,
      method,
      path,
      token: siteToken(ctx),
      body,
      fetchImpl: ctx.fetchImpl,
    })) as T;

  const created = await send<{
    form?: { id: string; name: string; type: string; settings?: Record<string, unknown> };
  }>('POST', `/api/sites/${site}/forms`, { name, type: tpl.type });
  const form = created.form;
  if (!form?.id) {
    throw new Error('sbuilder: the platform accepted the form create and returned no form');
  }
  // The same guard the checkout uses: a form nobody can see is the orphan the
  // obvious retry then duplicates.
  try {
    await send('PUT', `/api/sites/${site}/forms/${encodeURIComponent(form.id)}`, {
      name: form.name,
      type: form.type,
      settings: { ...(form.settings ?? {}), ...tpl.settings },
    });
    await send('PUT', `/api/sites/${site}/forms/${encodeURIComponent(form.id)}/document`, {
      document,
    });
  } catch (e) {
    await send('DELETE', `/api/sites/${site}/forms/${encodeURIComponent(form.id)}`).catch(
      () => undefined,
    );
    throw e;
  }

  // THE PAGE IS A SECOND WRITE AND MUST NOT UNDO THE FIRST. The form EXISTS the
  // moment its three calls land; a refused page create leaves a form the caller
  // can still place by hand, which is exactly what they had before this
  // argument existed. Reporting the failure beats deleting a form they asked
  // for — the same rule the seed follows in sb_page_create.
  let page: Awaited<ReturnType<typeof placeFormOnPage>> | undefined;
  let page_failed: string | undefined;
  if (pageName) {
    try {
      page = await placeFormOnPage(ctx, session, siteId, form.id, pageName, headline, pageTypeFor(key));
    } catch (e) {
      page_failed = (e as Error).message.replace(/^sbuilder:\s*/, '').slice(0, 160);
    }
  }

  return {
    form: { id: form.id, type: form.type, name: form.name },
    fields,
    ...(page ? { page } : {}),
    ...(page_failed ? { page_failed } : {}),
    next: page
      ? `The form is on page ${page.id}. Publish it with sb_publish, and link to it from the ` +
        'header. The submit button lives in the FORM DOCUMENT, not on the page, and a page ' +
        'republish is what makes a form-document edit visible.'
      : `Place it: sb_add a "form" element, then sb_set its specials.formId to "${form.id}" — ` +
        'or pass page_name to have that page made for you. The submit button lives in the FORM ' +
        'DOCUMENT, not on the page, and a page republish is what makes a form-document edit ' +
        'visible.',
  };
}

export function registerStoreTools(server: McpServer, ctx: ToolContext, session: PageSession): void {
  server.registerTool(
    'sb_store',
    {
      description:
        'Run a store flow that must happen in a fixed order. action:"checkout" makes the order ' +
        'form, configures it, saves its fields with this store\'s real payment and delivery ' +
        'options, then creates and PUBLISHES the checkout page — /checkout 404s without all ' +
        'four. action:"checkout_sync" re-reads the store\'s payment and delivery methods into ' +
        'every existing order form and republishes the checkout page — run it after adding a ' +
        'shipping method or switching on a gateway, since the form keeps the options it was ' +
        'saved with. action:"form" seeds any of the platform\'s other form templates (login, ' +
        'register, forgot, reset, verify, contact, subscribe, booking, review and more) with ' +
        'its own field document, which is the part that cannot be guessed. action:"chrome" ' +
        'gives every page ONE shared header (footer:true — footer) built on a real site menu of ' +
        'page/category/product references: a desktop menu, a mobile drawer, cart and account ' +
        'icons — the gap sb_review reports as siteChrome. action:"menu" binds a menu node on the open page ' +
        'to the site\'s menu and resolves its links, the way the editor does. ' +
        'action:"overlay_attach" puts a pop-up on the open page (kind:"popup") or points a ' +
        'list-dataset at a quick-view panel (kind:"quickview", list_id), creating either from ' +
        'the platform\'s own seed when overlay_id is omitted, and re-reads the page afterwards ' +
        'as the editor must. action:"cart" creates the site\'s cart drawer from the editor\'s ' +
        'seed when it has none — without it every open_cart control opens nothing. action:"app" installs one of the platform\'s built-in apps ' +
        '(app_key) and creates the pages it needs that installing it does not — today only ' +
        '"courses" has any, from the platform\'s own scaffold; every other key installs with ' +
        'nothing further to build. action:"global_attach" puts an EXISTING shared section ' +
        '(global_id) on the open page and action:"global_detach" takes it off, writing the ' +
        'reference the platform reads and placing it in the band ROOT\'s child order demands — ' +
        'the answer for a page that is missing the site\'s header, where action:"chrome" would ' +
        'wrongly build a second one. Dry run returns the plan.',
      inputSchema: {
        action: z.enum([
          'checkout',
          'checkout_sync',
          'form',
          'chrome',
          'menu',
          'overlay_attach',
          'cart',
          'app',
          'global_attach',
          'global_detach',
        ]),
        site_id: z.string().optional(),
        language: z.enum(['vi', 'en']).optional().describe('Copy language, default vi'),
        page_name: z.string().optional(),
        headline: z.string().optional(),
        template: z
          .enum(FORM_TEMPLATE_KEYS)
          .optional()
          .describe('action:"form" — which of the platform\'s own form templates to seed'),
        name: z
          .string()
          .optional()
          .describe(
            'action:"form" — the form\'s name in the merchant\'s list. action:"overlay_attach" ' +
              'with no overlay_id — the new pop-up/quick-view\'s name.',
          ),
        footer: z
          .boolean()
          .optional()
          .describe('action:"chrome" — build a shared FOOTER instead of a header'),
        node_id: z.string().optional().describe('action:"menu" — the menu node on the open page'),
        menu_id: z.string().optional(),
        kind: z
          .enum(['popup', 'quickview'])
          .optional()
          .describe('action:"overlay_attach" — which kind of overlay to attach'),
        overlay_id: z
          .string()
          .optional()
          .describe('action:"overlay_attach" — an existing overlay; omit to create one from the seed'),
        list_id: z
          .string()
          .optional()
          .describe('action:"overlay_attach" kind:"quickview" — the list-dataset node on the open page'),
        app_key: z
          .enum(BUILTIN_APP_KEYS)
          .optional()
          .describe('action:"app" — which built-in app to install'),
        global_id: z
          .string()
          .optional()
          .describe(
            'action:"global_attach"/"global_detach" — the shared section; omitted on attach it ' +
              'lists the site\'s own',
          ),
        relocalize: z
          .boolean()
          .optional()
          .describe(
            'action:"cart" — rewrite an EXISTING drawer\'s seed words that are in another language ' +
              'to the site locale\'s (edited text untouched), and turn a gallery line thumbnail into a ' +
              'single image; needs a page of the site open',
          ),
        dry_run: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({
      action,
      site_id: given,
      language,
      page_name,
      headline,
      template,
      name,
      footer,
      node_id,
      menu_id,
      kind,
      overlay_id,
      list_id,
      app_key,
      global_id,
      relocalize,
      dry_run,
    }) => {
      const siteId = siteFor(ctx, given);
      if (action === 'global_attach' || action === 'global_detach') {
        // THE COMPOSED STAMP IS NEVER THE CALLER'S TO WRITE. A page references
        // a master with `specials.globalRef`; the server composes it in on read
        // and stamps the result `globalId`. Authoring the composed stamp makes
        // the next save DECOMPOSE that node OVER the master and empty it for
        // every page carrying it — four pages went blank here before `sb_add`
        // and `sb_set` learned to refuse it, and hand-writing the reference was
        // the only way to attach one until this action existed.
        const run = action === 'global_attach' ? attachGlobal : detachGlobal;
        return text(await run(ctx, session, siteId, global_id, { dryRun: dry_run !== false }));
      }
      if (action === 'app') {
        if (!app_key) {
          throw new Error(
            `sbuilder: action:"app" needs app_key. One of: ${BUILTIN_APP_KEYS.join(', ')}.`,
          );
        }
        return text(
          await installApp(ctx, session, siteId, app_key, {
            language: (language ?? 'vi') as Language,
            dryRun: dry_run !== false,
          }),
        );
      }
      if (action === 'menu') {
        if (!node_id) {
          throw new Error('sbuilder: action:"menu" needs node_id — the menu node on the open page.');
        }
        const node = session.current().node(node_id);
        const type = node.data.type;
        const seeds = ELEMENTS[type]?.defaults?.specials;
        if (!seeds || !('menuItems' in seeds)) {
          throw new Error(
            `sbuilder: node "${node_id}" is a "${type}", which does not seed specials.menuItems — ` +
              'only a menu node can be bound to a site menu.',
          );
        }
        return text(await bindMenu(ctx, session, siteId, node_id, { menuId: menu_id, dryRun: dry_run !== false }));
      }
      if (action === 'overlay_attach') {
        if (!kind) {
          throw new Error('sbuilder: action:"overlay_attach" needs kind — "popup" or "quickview".');
        }
        // A LIST IS THE QUICK VIEW'S WHOLE ATTACHMENT and means nothing to a
        // pop-up, which reaches a page through an edge. Unchecked, a caller who
        // meant "quickview" and typed "popup" gets a pop-up created, attached
        // and the page saved, with `list_id` read by nothing and nothing said —
        // a wrong write that answers success, which is the shape this file
        // spends every other paragraph closing.
        if (kind === 'popup' && list_id) {
          throw new Error(
            'sbuilder: action:"overlay_attach" kind:"popup" takes no list_id — a pop-up reaches ' +
              'a page through an edge, not through a list. A list-dataset pointing at a panel is ' +
              'kind:"quickview"; that is almost certainly what this call meant.',
          );
        }
        return text(
          await attachOverlay(ctx, session, siteId, {
            kind,
            overlayId: overlay_id,
            name,
            listId: list_id,
            dryRun: dry_run !== false,
          }),
        );
      }
      if (action === 'cart') {
        const run = relocalize === true ? relocalizeCartDrawer : ensureCartDrawer;
        return text(await run(ctx, session, siteId, dry_run !== false));
      }
      if (action === 'chrome') {
        return text(
          await buildChrome(ctx, session, siteId, footer === true ? 'footer' : 'header', {
            dryRun: dry_run !== false,
            language: (language ?? 'vi') as 'vi' | 'en',
          }),
        );
      }
      if (action === 'form') {
        if (!template) {
          throw new Error(
            `sbuilder: action:"form" needs a template. One of: ${FORM_TEMPLATE_KEYS.join(', ')}.`,
          );
        }
        return text(
          await seedForm(ctx, session, siteId, template, name, page_name, headline, dry_run !== false),
        );
      }
      const lang = (language ?? 'vi') as Language;
      if (action === 'checkout_sync') return text(await syncCheckout(ctx, siteId, lang, dry_run !== false));
      const t = CHECKOUT_TEXT[lang];
      const site = encodeURIComponent(siteId);

      const { gateways, shipping } = await readStore(ctx, siteId);
      const filled = fillDocument(gateways, shipping, lang);
      const formName = t.formName;
      const pageName = page_name ?? t.pageName;
      const pageHeadline = headline ?? t.headline;

      const plan: Step[] = [
        {
          step: 1,
          what: 'create the order form',
          method: 'POST',
          path: `/api/sites/${site}/forms`,
          body: { name: formName, type: CHECKOUT_FORM.type },
        },
        {
          step: 2,
          what: 'PUT the form back WHOLE with the cart as its source — name and type must ride ' +
            'along or Normalize() turns it back into a custom form',
          method: 'PUT',
          path: `/api/sites/${site}/forms/{formId}`,
          body: { name: formName, type: CHECKOUT_FORM.type, settings: CHECKOUT_FORM.settings },
        },
        {
          step: 3,
          what: `save the field document with ${filled.methods.length} payment method(s) and ` +
            `${shipping.length} delivery option(s) filled in`,
          method: 'PUT',
          path: `/api/sites/${site}/forms/{formId}/document`,
          body: { document: '<the checkout field document>' },
        },
        {
          step: 4,
          what: 'create the page of TYPE checkout and publish it — /checkout resolves to the ' +
            'PUBLISHED page of the type',
          method: 'POST',
          path: `/api/sites/${site}/pages`,
          body: { name: pageName, type: 'checkout', document: '<the checkout page document>' },
        },
      ];

      if (dry_run !== false) {
        return text({
          dry_run: true,
          plan: redact(plan),
          payment_methods: filled.methods.map((m) => m.value),
          delivery_options: shipping,
          ...(gateways.length === 0
            ? {
                warning:
                  'No live payment gateway, so the form offers cash on delivery alone. That is ' +
                  'the honest list — switch one on with PUT /api/sites/{siteId}/payment-gateways/' +
                  '{provider} and re-run to offer more.',
              }
            : {}),
          ...(shipping.length === 0
            ? {
                warning_delivery:
                  'No delivery option, so the form ships an EMPTY delivery select and a shopper ' +
                  'cannot complete the order. Create one with POST /api/sites/{siteId}/' +
                  'shipping-methods first.',
              }
            : {}),
          note: 'Nothing was sent. Re-call with dry_run:false to run all four steps.',
        });
      }

      const send = async <T>(method: string, path: string, body?: unknown): Promise<T> =>
        (await request({
          base: ctx.base,
          method,
          path,
          token: siteToken(ctx),
          body,
          fetchImpl: ctx.fetchImpl,
        })) as T;

      const created = await send<{ form?: { id: string; name: string; type: string; settings?: Record<string, unknown> } }>(
        'POST',
        `/api/sites/${site}/forms`,
        { name: formName, type: CHECKOUT_FORM.type },
      );
      const form = created.form;
      if (!form?.id) {
        throw new Error('sbuilder: the platform accepted the form create and returned no form');
      }

      // EVERY STEP AFTER THE CREATE RUNS UNDER ONE GUARD. A form that exists but
      // no page binds shows in the merchant's list as an empty "Form", and the
      // obvious retry makes a second one. The editor deletes it; so does this.
      try {
        // THE SETTINGS ARE A SECOND WRITE, merged over what the server just
        // returned: `settings` is a whole object on the wire, so posting the
        // template's one key would blank the defaults the server fills in
        // (afterSubmit, notify) — a form that takes an order and tells nobody.
        await send('PUT', `/api/sites/${site}/forms/${encodeURIComponent(form.id)}`, {
          name: form.name,
          type: form.type,
          settings: { ...(form.settings ?? {}), ...CHECKOUT_FORM.settings },
        });
        await send('PUT', `/api/sites/${site}/forms/${encodeURIComponent(form.id)}/document`, {
          document: filled.document,
        });
      } catch (e) {
        await send('DELETE', `/api/sites/${site}/forms/${encodeURIComponent(form.id)}`).catch(
          () => undefined,
        );
        throw e;
      }

      const madePage = await send<{ page?: { id: string; slug?: string } }>(
        'POST',
        `/api/sites/${site}/pages`,
        { name: pageName, type: 'checkout', document: pageDocumentFor(form.id, pageHeadline) },
      );
      const page = madePage.page;
      if (!page?.id) {
        throw new Error(
          'sbuilder: the checkout page create returned no page. The form was made and kept — ' +
            'it is in the Forms list under its name; re-run and it will be duplicated, so delete ' +
            'one afterwards.',
        );
      }

      // PUBLISH SKIPS A PAGE WITH NO SAVED DRAFT AND STILL ANSWERS 200
      // (service.go:650, a bare `continue`), so the page coming back is the only
      // proof. Without it a checkout that 404s reports success.
      const pub = await send<{ published?: Array<{ pageId: string }> }>(
        'POST',
        `/api/sites/${site}/publish`,
        { pageIds: [page.id] },
      );
      const landed = (pub.published ?? []).some((p) => p.pageId === page.id);

      return text({
        form_id: form.id,
        page_id: page.id,
        ...(page.slug ? { slug: page.slug } : {}),
        published: landed,
        payment_methods: filled.methods.map((m) => m.value),
        delivery_options: shipping,
        ...(landed
          ? {}
          : {
              not_published:
                'The publish answered 200 and did not include this page, so /checkout still ' +
                'resolves to nothing. Publish it again with sb_publish.',
            }),
        ...(shipping.length === 0
          ? {
              delivery_gap:
                'The delivery select is EMPTY, so a shopper cannot complete the order. Create a ' +
                'method with POST /api/sites/{siteId}/shipping-methods, then run ' +
                'sb_store action:"checkout_sync" — the options are baked in at save time, not ' +
                'read at render time.',
            }
          : {}),
      });
    },
  );
}
