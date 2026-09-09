/**
 * THE STORE FLOWS THAT MUST BE ORDERED.
 *
 * `sb_review` names eight readiness gaps. Seven of them are now one call each —
 * a delivery option, a payment gateway, a product, a page of the right type —
 * because `REQUEST_SHAPES` tells the caller what those calls take. One is not.
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
 * is 17,000 characters and 26 tools already sit under it. There is exactly one
 * flow here today, and the enum is how a second arrives without a second tool.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { request, redact } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { siteFor, type ToolContext } from './context.js';
import { genId } from '../domains/site/ids.js';
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
 */
async function readStore(
  ctx: ToolContext,
  siteId: string,
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
    } catch {
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
  const t = CHECKOUT_TEXT[lang];
  const desc = (provider: string): string =>
    t.paymentDesc[provider.toLowerCase() as keyof typeof t.paymentDesc] ??
    t.paymentDesc.gateway ??
    '';
  // Cash on delivery leads, under a stable id rather than its label, so the
  // label can be reworded or translated without the stored value moving.
  const methods = [
    { value: 'cod', label: t.codLabel, description: t.paymentDesc.cod ?? '' },
    ...gateways.map((g) => ({
      value: g.provider,
      label: g.label || g.providerLabel || g.provider,
      description: desc(g.provider),
    })),
  ];

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

/**
 * Fresh node ids for a seeded document.
 *
 * The generated documents carry STABLE placeholder ids (`ckf_1`, `ckp_1`) so
 * that re-running codegen produces no diff. Placeholders are not values: the
 * editor mints an id per node at drop time, and two checkouts built by this tool
 * must be as unrelated as two built by hand. Longest first, so one id is never
 * rewritten inside another.
 */
function withFreshIds<T extends { nodes: Record<string, { data?: { type?: string } }> }>(doc: T): T {
  const map = new Map<string, string>();
  for (const [id, node] of Object.entries(doc.nodes)) {
    map.set(id, genId(node?.data?.type ?? 'node'));
  }
  let json = JSON.stringify(doc);
  for (const [from, to] of [...map].sort((a, b) => b[0].length - a[0].length)) {
    json = json.split(from).join(to);
  }
  return JSON.parse(json) as T;
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
async function seedForm(
  ctx: ToolContext,
  siteId: string,
  key: string,
  formName: string | undefined,
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

  return {
    form: { id: form.id, type: form.type, name: form.name },
    fields,
    next:
      `Place it: sb_add a "form" element, then sb_set its specials.formId to "${form.id}". ` +
      'The submit button lives in the FORM DOCUMENT, not on the page, and a page republish is ' +
      'what makes a form-document edit visible.',
  };
}

export function registerStoreTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'sb_store',
    {
      description:
        'Run a store flow that must happen in a fixed order. action:"checkout" makes the order ' +
        'form, configures it, saves its fields with this store\'s real payment and delivery ' +
        'options, then creates and PUBLISHES the checkout page — /checkout 404s without all ' +
        'four. action:"form" seeds any of the platform\'s other form templates (login, ' +
        'register, forgot, reset, verify, contact, subscribe, booking, review and more) with ' +
        'its own field document, which is the part that cannot be guessed. Dry run returns ' +
        'the plan.',
      inputSchema: {
        action: z.enum(['checkout', 'form']),
        site_id: z.string().optional(),
        language: z.enum(['vi', 'en']).optional().describe('Copy language, default vi'),
        page_name: z.string().optional(),
        headline: z.string().optional(),
        template: z
          .enum(FORM_TEMPLATE_KEYS)
          .optional()
          .describe('action:"form" — which of the platform\'s own form templates to seed'),
        name: z.string().optional().describe('action:"form" — the form\'s name in the merchant\'s list'),
        dry_run: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ action, site_id: given, language, page_name, headline, template, name, dry_run }) => {
      const siteId = siteFor(ctx, given);
      if (action === 'form') {
        if (!template) {
          throw new Error(
            `sbuilder: action:"form" needs a template. One of: ${FORM_TEMPLATE_KEYS.join(', ')}.`,
          );
        }
        return text(await seedForm(ctx, siteId, template, name, dry_run !== false));
      }
      const lang = (language ?? 'vi') as Language;
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
                'method with POST /api/sites/{siteId}/shipping-methods, then re-save this form\'s ' +
                'document — the options are baked in at save time, not read at render time.',
            }
          : {}),
      });
    },
  );
}
