/**
 * WHICH OF THIS PAGE'S THREE COPIES IS WHICH.
 *
 * A page is not one document. It is three, read by three different consumers,
 * and every tool here answered for one of them while a caller was asking about
 * another:
 *
 *   - the DRAFT  — `GET /pages/{id}/source`. What the EDITOR CANVAS shows.
 *   - the PUBLISHED row — compiled at publish time. What the STOREFRONT serves.
 *   - this SESSION's copy — read once into memory and edited since.
 *
 * "The render has data but the canvas is blank" is the shape this exists for,
 * and it is not a cache: it is the draft having been emptied while the
 * published row kept the good copy. This repo has the measured incident — a
 * product template of 24 nodes read back bare, stored bare; the published copy
 * untouched, so all 19 product pages went on rendering; invisible until a
 * person opened the editor. `PageSession.save` guards the session that CAUSES
 * that, and nothing reported a draft that was already in that state.
 *
 * THE CANVAS GATE IS SIMULATED RATHER THAN DESCRIBED, because the editor's
 * rule is three lines and nothing else can answer it
 * (`editor/src/stores/node.ts`, `hydrate`):
 *
 *     const nodes = doc?.nodes ?? {};
 *     const rootId = doc?.root_node_id ?? '';
 *     if (!rootId || !nodes[rootId]) { this.seedRoot(opts?.pageId); return; }
 *
 * A document failing it is SILENTLY REPLACED by an empty ROOT — blank canvas,
 * no error anywhere — and the editor's next save stores that blank. The Go
 * renderer has no such gate, so a document can fail this and still publish
 * markup, which is exactly how the two copies come apart.
 *
 * READ AGAINST THE RAW DOCUMENT, never against a `PageDoc`. `PageDoc.from`
 * ADOPTS a `rootId`/`rootNodeId` alias and repairs it in memory, which is the
 * right thing for a tool that is about to edit the page and the wrong thing
 * for a report about what the editor will do: the editor reads the stored
 * bytes, and the stored bytes still carry the alias.
 */

import { PAGE_ROOT_ID } from './ids.js';

/** What the editor's own hydrate gate will do with this document. */
export interface CanvasVerdict {
  /** True when the editor will discard this document and show an empty ROOT. */
  blank: boolean;
  /** How many nodes the document holds, which is what the canvas would mount. */
  nodes: number;
  /** The root's id when it is not `ROOT` — a page an older editor paints white. */
  minted_root?: string;
  why?: string;
  fix?: string;
}

export function canvasVerdict(document: unknown): CanvasVerdict {
  const d = (document ?? {}) as {
    root_node_id?: unknown;
    rootId?: unknown;
    rootNodeId?: unknown;
    nodes?: Record<string, unknown>;
  };
  const nodes = (d.nodes ?? {}) as Record<string, unknown>;
  const count = Object.keys(nodes).length;
  const root = typeof d.root_node_id === 'string' ? d.root_node_id : '';
  if (root && nodes[root]) {
    if (root === PAGE_ROOT_ID) return { blank: false, nodes: count };
    // NOT BLANK TO THIS GATE, AND NOT FINE. The current editor follows
    // root_node_id; one built before web_builder `7322af49a` renders a
    // hard-coded node-id="ROOT", paints white, and may autosave the page blank.
    return {
      blank: false,
      nodes: count,
      minted_root: root,
      why:
        `The root is "${root}", not "ROOT". The storefront and a current editor draw it; an editor ` +
        'built before web_builder 7322af49a paints the canvas WHITE and may autosave the page blank.',
      fix: 'Run sb_page_repair on this page (then sb_publish it) before anyone opens it in the editor.',
    };
  }
  // THE ALIAS IS WORTH NAMING SEPARATELY, because the repair is one save and
  // the reader otherwise has no idea why a document with plenty of nodes is
  // about to vanish. `rootId` is the key an app block and a section template
  // use for the same idea, and the editor's own completion-page seed shipped
  // it (`element/completionPage.ts:91`, fixed upstream in 8e40bbab) — so pages
  // created from that seed still carry it today.
  const alias = ['rootId', 'rootNodeId'].find(
    (k) => typeof (d as Record<string, unknown>)[k] === 'string' && nodes[(d as Record<string, string>)[k]],
  );
  if (alias) {
    return {
      blank: true,
      nodes: count,
      why:
        `The document names its root under "${alias}" instead of root_node_id, so the editor ` +
        `discards all ${count} nodes and shows an empty canvas, and the Go renderer publishes ` +
        'an empty <body> with a 200.',
      fix:
        'sb_page_open adopts the alias and the next save writes the canonical key: open the ' +
        'page, make any edit (or none — sb_page_open reports blank_page_repair), save, publish.',
    };
  }
  if (count === 0) {
    return {
      blank: true,
      nodes: 0,
      why: 'The document holds no nodes at all. For a page just created this is normal.',
      fix: 'Build it — sb_template_use for a designed band, or sb_add from ROOT.',
    };
  }
  return {
    blank: true,
    nodes: count,
    why:
      `root_node_id is ${JSON.stringify(d.root_node_id ?? null)}, which names none of the ` +
      `${count} nodes present. The editor discards the whole document and shows an empty ` +
      'canvas; its next save would store that blank over these nodes.',
    fix:
      'Do NOT open and save this page in the editor until it is repaired — that save is what ' +
      'makes the loss permanent. Recover the draft from a page version or from the published ' +
      'copy (sb_page_version).',
  };
}

/** How the draft and the published copy stand relative to each other. */
export interface Drift {
  state: 'in_step' | 'draft_ahead' | 'never_published';
  note: string;
}

export function driftOf(
  draftUpdatedAt: string | undefined,
  publishedAt: string | undefined,
): Drift {
  if (!publishedAt) {
    return {
      state: 'never_published',
      note: 'This page has no published copy, so nothing is served for it — the URL 404s.',
    };
  }
  if (!draftUpdatedAt) {
    return { state: 'in_step', note: 'The draft reports no timestamp to compare.' };
  }
  const draft = Date.parse(draftUpdatedAt);
  const live = Date.parse(publishedAt);
  if (!Number.isFinite(draft) || !Number.isFinite(live)) {
    return { state: 'in_step', note: 'One of the timestamps could not be read.' };
  }
  // A SECOND of slack. Publish writes its own row after reading the draft, so
  // the two are legitimately microseconds apart on an untouched page and
  // reporting that as "unpublished changes" would cry wolf on every check.
  if (draft > live + 1000) {
    return {
      state: 'draft_ahead',
      note:
        'The draft has changes the live page does not. The editor canvas and the storefront ' +
        'will disagree until this page is published.',
    };
  }
  // LIVE LATER THAN THE DRAFT IS EVERY ORDINARY PUBLISH (TTG gap #75): the
  // publish read the last saved draft, so the live page holds it. This used to
  // read `published_ahead` and blame a cascade; a cascade that left a draft
  // behind is remembered by sb_publish, never inferred from these timestamps.
  if (live > draft + 1000) {
    return { state: 'in_step', note: 'Published after its last draft save — the live page is this draft.' };
  }
  return { state: 'in_step', note: 'The draft and the live page are the same revision.' };
}

/** A shared master as its list row reports it. */
export interface Master {
  id: string;
  name?: string;
  kind?: string;
  rev?: number;
  updatedAt?: string;
}

/**
 * WHAT A PUBLISH WOULD CASCADE TO, computed the platform's own way (TTG gap
 * #66): `globalCascadeTargets` takes the globals the PUBLISHED page shows and
 * adds every other live page whose LIVE document stamps one of them
 * (`specials.globalRev`) behind the master's `rev`; `sitewideCascadeTargets`
 * adds every live page whose overlay stamp (`overlayRev`) is behind, whatever
 * page is published. App blocks moving with an install are not modelled. A
 * master behind on any live page it will reach is an edit going live now —
 * possibly someone else's, unreviewed (a footer saved at 13:10:58 shipped on 19
 * pages behind a throwaway post template).
 */
export function cascadePreview(input: {
  explicit: ReadonlySet<string>;
  targetGlobals: ReadonlySet<string>;
  globals: Master[];
  overlays: Master[];
  published: Array<{ pageId?: unknown; document?: unknown }>;
  names: Readonly<Record<string, string>>;
}): {
  would_cascade: Array<{ pageId: string; name: string; because: string[] }>;
  shared_unpublished: Array<{ id: string; kind?: string; name?: string; updatedAt?: string; behind_on: number }>;
} {
  const masters = new Map<string, Master>();
  for (const m of [...input.globals, ...input.overlays]) masters.set(m.id, m);
  const would: Array<{ pageId: string; name: string; because: string[] }> = [];
  const behind = new Map<string, number>();
  for (const row of input.published) {
    const pageId = String(row.pageId ?? '');
    const nodes = (row.document as { nodes?: Record<string, { specials?: Record<string, unknown> }> } | undefined)?.nodes ?? {};
    const because: string[] = [];
    const hits: string[] = [];
    for (const n of Object.values(nodes)) {
      const sp = n?.specials ?? {};
      for (const [idKey, revKey, global] of [['globalId', 'globalRev', true], ['overlayId', 'overlayRev', false]] as const) {
        const id = sp[idKey];
        if (typeof id !== 'string') continue;
        const m = masters.get(id);
        const stamp = Number(sp[revKey] ?? 0);
        if (!m || typeof m.rev !== 'number' || stamp >= m.rev) continue;
        const reaches = input.explicit.has(pageId) || !global || input.targetGlobals.has(id);
        if (!reaches) continue;
        hits.push(id);
        because.push(`${m.kind ?? (global ? 'global' : 'overlay')} ${id}${m.name ? ` "${m.name}"` : ''} rev ${stamp} → ${m.rev}${m.updatedAt ? `, saved ${m.updatedAt}` : ''}`);
      }
    }
    for (const id of new Set(hits)) behind.set(id, (behind.get(id) ?? 0) + 1);
    if (because.length && !input.explicit.has(pageId)) {
      would.push({ pageId, name: input.names[pageId] ?? '', because });
    }
  }
  const shared = [...behind].map(([id, n]) => {
    const m = masters.get(id)!;
    return { id, ...(m.kind ? { kind: m.kind } : {}), ...(m.name ? { name: m.name } : {}), ...(m.updatedAt ? { updatedAt: m.updatedAt } : {}), behind_on: n };
  });
  return { would_cascade: would, shared_unpublished: shared };
}
