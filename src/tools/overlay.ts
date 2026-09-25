/**
 * `sb_store action:"overlay_attach"` — PUT A POP-UP ON THE OPEN PAGE, OR POINT
 * A LIST AT A QUICK VIEW PANEL.
 *
 * Two overlay kinds, two different ways a page comes to show one, and the
 * platform's own client (`editor/src/features/overlays/{usePopupOverlay,
 * useQuickviewOverlay}.ts`) is the only place either sequence is written down.
 * This mirrors both write for write.
 *
 * A POP-UP REACHES A PAGE THROUGH AN EDGE (`page_overlay_refs`), and that edge
 * cannot be written by an ordinary page save: the save DERIVES the edge set
 * from the COMPOSED document, and the pop-up is not in that document until
 * something else puts it there. Attachment is its own call
 * (`POST /overlays/{id}/pages/{pageId}`) precisely to break that circle —
 * `attachOverlayToPage`'s own comment names it — so the order is:
 *
 *   1. SAVE the page as it stands. The re-read in step 4 must hand back the
 *      author's own work, not an older draft.
 *   2. CREATE the pop-up if the caller gave no id — `CreateOverlayInput.document`
 *      is REQUIRED, which is why `OVERLAY_SEEDS.popup` exists: an empty pop-up
 *      is a white rectangle nobody can dismiss.
 *   3. ATTACH — write the edge.
 *   4. RE-READ. Until the composer has put the panel into the document this
 *      session holds, the NEXT save derives an edge set without it and takes
 *      the attachment straight back off — `usePopupOverlay`'s own words.
 *   5. Find the composed node, stamped `specials.overlayId`.
 *
 * A QUICK VIEW REACHES A PAGE THROUGH A LIST'S OWN CONFIG, not an edge — there
 * is no `page_overlay_refs` row for one, and there must never be: an edge would
 * make the compose step append it to ROOT, putting a position:static copy of
 * the panel below the footer of every page that uses it
 * (`useQuickviewOverlay.ts`'s own comment). So the dance is shorter:
 *
 *   1. CREATE the panel if the caller gave no id (`OVERLAY_SEEDS.quickview`).
 *   2. WRITE `config.quickviewId` on the list — that IS the attachment — and
 *      SAVE in the same call.
 *   3. RE-READ, so the composer merges the master in and the panel's nodes
 *      exist on this client at all.
 *
 * `config.quickviewId` IS BASE-ONLY, verified by reading the platform rather
 * than assumed from `BASE_ONLY_CONFIG` (which does not name it — this is a gap
 * in that ledger, not a fact this key is responsive). Two independent reads
 * agree: `server/internal/page/quickview.go`'s `nodeQuickviewChoice` decodes
 * the node's raw `config` map directly — no responsive merge — both when
 * deciding which masters to fetch (`QuickviewChoices`) and when composing them
 * in (`ComposeQuickviews`), so a choice written to any breakpoint slot is
 * invisible to compose and the panel never merges, in every environment,
 * always; and the editor's own `useQuickviewOverlay.choose` calls
 * `nodes.setNodeValue(listId, 'config', 'quickviewId', overlayId)` with no `bp`
 * argument, which `setNodeValue` treats as "write to base". This write is
 * therefore sent to base unconditionally rather than gated on
 * `isBaseOnlyConfig`, which currently answers false and would silently break
 * every quick-view attach.
 */
import { request, redact } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import type { ToolContext } from './context.js';
import type { PageSession } from './page.js';
import { setKeys } from '../domains/site/builder.js';
import { OVERLAY_SEEDS } from '../catalog/overlays.generated.js';
import { withFreshIds } from '../domains/site/ids.js';

interface Step {
  step: number;
  what: string;
  method: string;
  path: string;
  body?: unknown;
}

const KIND_NAME: Record<'popup' | 'quickview', string> = {
  popup: 'Pop-up',
  quickview: 'Quick view',
};

/** The node the composer stamped, scanning by the marker each kind carries. */
function findComposed(
  nodes: Record<string, unknown>,
  stampKey: 'overlayId' | 'quickviewId',
  overlayId: string,
): string | undefined {
  for (const [id, raw] of Object.entries(nodes)) {
    const n = raw as { specials?: Record<string, unknown> };
    if (n?.specials?.[stampKey] === overlayId) return id;
  }
  return undefined;
}

export async function attachOverlay(
  ctx: ToolContext,
  session: PageSession,
  siteId: string,
  opts: { kind: 'popup' | 'quickview'; overlayId?: string; name?: string; listId?: string; dryRun: boolean },
): Promise<unknown> {
  const site = encodeURIComponent(siteId);
  // THE PAGE-BOUND HALF COMES FROM THE SESSION, NEVER FROM THE ARGUMENT. Every
  // path below is site-scoped while the page id is whatever `sb_page_open` last
  // read, and a session spanning two sites is a shape this server supports on
  // purpose — an explicit `site_id` beats `SB_SITE`, so "a session spanning two
  // sites works by naming each". Resolving one site while the open page belongs
  // to another would post that page id under the WRONG site's overlay and then
  // reopen the page there, which is a wrong write rather than a failed one.
  // There is no sensible winner to pick between the two, so it is refused.
  const { siteId: openSite, pageId } = session.location();
  if (openSite !== siteId) {
    throw new Error(
      `sbuilder: action:"overlay_attach" resolved site "${siteId}", but the open page ` +
        `"${pageId}" belongs to site "${openSite}" — an overlay is attached to the OPEN page. ` +
        `Open a page on "${siteId}", or pass site_id:"${openSite}".`,
    );
  }
  const post = async <T>(path: string, body?: unknown): Promise<T> =>
    (await request({
      base: ctx.base,
      method: 'POST',
      path,
      token: siteToken(ctx),
      body,
      fetchImpl: ctx.fetchImpl,
    })) as T;

  const steps: Step[] = [];
  let n = 1;
  const name = opts.name ?? KIND_NAME[opts.kind];

  if (opts.kind === 'quickview') {
    if (!opts.listId) {
      throw new Error(
        'sbuilder: action:"overlay_attach" kind:"quickview" needs list_id — the list-dataset ' +
          'node on the open page whose quick view this sets.',
      );
    }
    const doc = session.current();
    const listNode = doc.node(opts.listId);
    if (listNode.data.type !== 'list-dataset') {
      throw new Error(
        `sbuilder: node "${opts.listId}" is a "${listNode.data.type}", not a "list-dataset" — ` +
          'only a list can point at a quick view.',
      );
    }

    // ALREADY ATTACHED — do nothing, the way `useQuickviewOverlay.choose`'s
    // caller (`openForEditing`) does by checking `panelNode(overlayId)` first.
    // Both halves must hold: the list's OWN choice (`config.quickviewId`, at
    // base — never a breakpoint slot, which compose never reads) must already
    // name this overlay, AND the composed panel must already be present on
    // this page. Either alone is not enough — a choice with no composed panel
    // is a page that has not been re-read since the choice was made, and a
    // stray composed node with no matching choice cannot happen but is not
    // the fact this check is answering. Writing again here is not WRONG, only
    // wasted: it would churn the shared master's revision fence for no reason.
    if (opts.overlayId) {
      const alreadyChosen = listNode.config?.quickviewId === opts.overlayId;
      const existingId = alreadyChosen
        ? findComposed(doc.doc.nodes as Record<string, unknown>, 'quickviewId', opts.overlayId)
        : undefined;
      if (alreadyChosen && existingId) {
        return opts.dryRun
          ? {
              dry_run: true,
              already_attached: true,
              overlay_id: opts.overlayId,
              node_id: existingId,
              note: 'Nothing to do — this list already points at this quick view.',
            }
          : { kind: 'quickview', overlay_id: opts.overlayId, created: false, already_attached: true, node_id: existingId };
      }
    }

    let overlayId = opts.overlayId;
    let created = false;
    if (!overlayId) {
      const createBody = { kind: 'quickview', name, document: withFreshIds(OVERLAY_SEEDS.quickview) };
      steps.push({
        step: n++,
        what: `create the quick view "${name}"`,
        method: 'POST',
        path: `/api/sites/${site}/overlays`,
        body: createBody,
      });
      if (!opts.dryRun) {
        const made = await post<{ overlay?: { id?: string } }>(`/api/sites/${site}/overlays`, createBody);
        if (!made.overlay?.id) {
          throw new Error('sbuilder: the platform accepted the overlay create and returned no overlay');
        }
        overlayId = made.overlay.id;
        created = true;
      }
    }

    steps.push({
      step: n++,
      what: `point the list at it — config.quickviewId (base) — and save`,
      method: 'PUT',
      path: `/api/sites/${site}/pages/${encodeURIComponent(pageId)}/source`,
    });
    steps.push({
      step: n++,
      what: 're-read the page so the composer merges the panel in',
      method: 'GET',
      path: `/api/sites/${site}/pages/${encodeURIComponent(pageId)}/source`,
    });

    if (opts.dryRun) {
      return {
        dry_run: true,
        plan: redact(steps),
        ...(created || overlayId ? {} : { would_create: { kind: 'quickview', name } }),
        note: 'Nothing was sent. Re-call with dry_run:false to point the list and re-read the page.',
      };
    }

    const patches = setKeys(doc, opts.listId, { quickviewId: overlayId }, { namespace: 'config', base: true });
    await session.applyAndSave(patches);
    await session.open(siteId, pageId);

    const fresh = session.current();
    const nodeId = findComposed(fresh.doc.nodes as Record<string, unknown>, 'quickviewId', overlayId!);
    if (!nodeId) {
      throw new Error(
        `sbuilder: the choice was saved but no panel came back on re-read for overlay ` +
          `"${overlayId}" — the master may have been deleted.`,
      );
    }

    return { kind: 'quickview', overlay_id: overlayId, created, node_id: nodeId };
  }

  // popup ---------------------------------------------------------------
  // ALREADY ATTACHED — the way `usePopupOverlay.attachToCurrentPage` checks
  // `nodes.findByOverlayId(overlayId)` before doing anything. Only meaningful
  // when the caller NAMED an overlay: a freshly created one cannot already be
  // composed onto this page. Saving and re-attaching anyway would not be
  // wrong, only wasted — it churns the shared master's revision fence
  // (`restampPatches`'s fence) for an edge that already exists.
  if (opts.overlayId) {
    const existingId = findComposed(
      session.current().doc.nodes as Record<string, unknown>,
      'overlayId',
      opts.overlayId,
    );
    if (existingId) {
      return opts.dryRun
        ? {
            dry_run: true,
            already_attached: true,
            overlay_id: opts.overlayId,
            node_id: existingId,
            note: 'Nothing to do — this pop-up is already on the open page.',
          }
        : { kind: 'popup', overlay_id: opts.overlayId, created: false, already_attached: true, node_id: existingId };
    }
  }

  steps.push({
    step: n++,
    what: 'save the page — the edge cannot attach to an unsaved draft',
    method: 'PUT',
    path: `/api/sites/${site}/pages/${encodeURIComponent(pageId)}/source`,
  });
  if (!opts.dryRun) {
    // FORCED, not `session.save()` directly. That method skips the PUT when
    // the document's revision has not moved since the last write — right for
    // `sb_look`, which looks far more often than it edits, and wrong here: the
    // editor's own `saveDraft` before an attach is unconditional, and the
    // circle this step exists to break (the server derives the edge set from
    // the COMPOSED document, and the pop-up cannot be in it until this save
    // lands) does not care whether anything changed, only that the page is
    // stored. `PageDoc.apply` bumps the revision even for an empty patch list,
    // which is what makes an empty `applyAndSave` a real, unconditional save.
    await session.applyAndSave([]);
  }

  let overlayId = opts.overlayId;
  let created = false;
  if (!overlayId) {
    const createBody = { kind: 'popup', name, document: withFreshIds(OVERLAY_SEEDS.popup) };
    steps.push({
      step: n++,
      what: `create the pop-up "${name}"`,
      method: 'POST',
      path: `/api/sites/${site}/overlays`,
      body: createBody,
    });
    if (!opts.dryRun) {
      const made = await post<{ overlay?: { id?: string } }>(`/api/sites/${site}/overlays`, createBody);
      if (!made.overlay?.id) {
        throw new Error('sbuilder: the platform accepted the overlay create and returned no overlay');
      }
      overlayId = made.overlay.id;
      created = true;
    }
  }

  steps.push({
    step: n++,
    what: 'attach it to the open page',
    method: 'POST',
    path: `/api/sites/${site}/overlays/${overlayId ?? '{overlayId}'}/pages/${encodeURIComponent(pageId)}`,
  });
  steps.push({
    step: n++,
    what: 're-read the page — until the composer puts the panel into this document, the next ' +
      'save takes the attachment straight back off',
    method: 'GET',
    path: `/api/sites/${site}/pages/${encodeURIComponent(pageId)}/source`,
  });

  if (opts.dryRun) {
    return {
      dry_run: true,
      plan: redact(steps),
      ...(created || overlayId ? {} : { would_create: { kind: 'popup', name } }),
      note: 'Nothing was sent. Re-call with dry_run:false to save, attach and re-read the page.',
    };
  }

  await post(`/api/sites/${site}/overlays/${encodeURIComponent(overlayId!)}/pages/${encodeURIComponent(pageId)}`);
  await session.open(siteId, pageId);

  const fresh = session.current();
  const nodeId = findComposed(fresh.doc.nodes as Record<string, unknown>, 'overlayId', overlayId!);
  if (!nodeId) {
    throw new Error(
      `sbuilder: the edge was written but this page does not show overlay "${overlayId}" on ` +
        're-read — the re-read may have failed.',
    );
  }

  return { kind: 'popup', overlay_id: overlayId, created, node_id: nodeId };
}
