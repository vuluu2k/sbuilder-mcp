import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { composeWarnings, type ComposeWarning } from '../domains/site/findings.js';
import { text } from '../mcp/response.js';
import { loadSource, saveSource } from '../transport/pages.js';
import { previewUrl } from '../vision/preview.js';
import { bandIds, proveLive, type LiveProof } from '../domains/site/liveproof.js';
import { canvasVerdict, driftOf } from '../domains/site/pagestate.js';
import { PageDoc, type OutlineNode } from '../domains/site/document.js';
import {
  addSubtree,
  setKeys,
  setMany,
  baseOnlyKeys,
  moveNode,
  removeNode,
  duplicateNode,
  type NodeSpec,
  type Breakpoint,
  type SetEdit,
} from '../domains/site/builder.js';
import { baseOnlyNote } from '../domains/site/baseonly.js';
import { detachNote, presetIdOf, presetLayer } from '../domains/site/theme.js';
import { inertHintsFor } from '../domains/site/inert.js';
import {
  hasSeed,
  layoutDocument,
  seedDocument,
  seedSummary,
  seededTypes,
} from '../domains/site/storepage.js';
import { PAGE_TYPES } from '../catalog/storepages.generated.js';
import {
  animationNote,
  deadKeyNote,
  unknownValueNote,
  unknownWriteNote,
  preconditionNotes,
  unsupportedSettingNote,
} from '../domains/site/vocabulary.js';
import { skinLevelNote } from '../domains/site/fieldskin.js';
import { siteTheme } from '../domains/site/theme-fetch.js';
import { ensureSiteTheme } from './theme.js';
import { request, redact } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { validateForSave } from '../domains/site/validate.js';
import { reviewDesign, REVIEW_NOTICE } from '../domains/site/review.js';
import { compactFindings } from '../domains/site/findings.js';
import { readinessGaps, READINESS_NOTICE } from '../domains/site/readiness.js';
import { gatherReadiness } from '../domains/site/readiness-fetch.js';
import { globalWarning, restampPatches, RESPONSIVE_NOTICE } from '../domains/site/traps.js';
import { catalogBrowse, catalogMatches, traitsFor } from '../catalog/element-search.js';
import { layoutForPageName, missingUsualPages, type InventoryPage } from '../domains/site/inventory.js';
import {
  LAYOUT_PATTERNS,
  PATTERN_BY_ID,
  THEME_TOKENS,
  type MediaPick,
} from '../domains/site/patterns.js';
import { tokensFromPage } from '../domains/site/importmap.js';
import { middleEnd } from '../domains/site/traps.js';
import { applyPatches, type Patch } from '../core/patch.js';
import type { GuardOpts } from '../domains/site/guard.js';
import { stickyWarning } from '../domains/site/sticky.js';
import { HOVER_STATE, PARENT_HOVER_STATE, hoverHostNote, hoverRoutingNote } from '../domains/site/hover.js';
import type { LiveSession } from '../live/session.js';
import type { Box } from '../vision/shoot.js';
import { siteFor, type ToolContext } from './context.js';
import { projectList, PAGE_FIELDS, TEMPLATE_FIELDS } from './project.js';

/**
 * Findings, in the shape every surface returns them.
 *
 * Spread rather than repeated: three tools attach this, and three hand-written
 * copies of a directive is how one of them quietly loses it. The fix for each
 * KIND is sent once under `fixes`, and the directive once per process.
 */
export function reviewField(ctx: ToolContext, doc: PageDoc): Record<string, unknown> {
  const all = reviewDesign(doc);
  if (all.length === 0) return {};
  const { findings, fixes } = compactFindings(all);
  const notice = ctx.notices.once('review', REVIEW_NOTICE);
  return { findings, fixes, ...(notice ? { findings_notice: notice } : {}) };
}

/**
 * The one open page.
 *
 * The write tools share it rather than each re-fetching: a fetch per edit would
 * discard local work on every call, and would turn one hero section into forty
 * round trips.
 */
export class PageSession {
  private doc: PageDoc | null = null;
  private siteId = '';
  private pageId = '';
  private live: LiveSession | null = null;
  /** Which site's room `live` is in — a page on another site needs another room. */
  private liveSite = '';
  private stale: string | null = null;
  /**
   * The document revision this session last stored, so an unchanged document is
   * not written again. `sb_look` saves before it renders — correctly, a shot of
   * an unsaved edit is a shot of the past — and a vision loop looks far more
   * often than it edits, so the same bytes went back over the wire on every
   * look. A PUT that changes nothing is not free: it costs the round trip, and
   * it BUMPS THE REVISION of every shared master the page carries, which is the
   * fence `restampPatches` exists to keep honest.
   */
  private savedRev = -1;
  /** The open read handed back an empty document and a ROOT was invented for it. */
  private openedSeeded = false;
  private warnings: ComposeWarning[] = [];
  private boxes: Box[] = [];

  constructor(private readonly ctx: ToolContext) {}

  /**
   * ONE ROOM AT A TIME. A second join (sb_live_join again, or a page on another
   * site) used to overwrite `live` and leave the old socket reconnecting for the
   * life of the process — a second robot in the old site's room, forever.
   *
   * And the page is announced HERE as well as on open: `start` was never called
   * anywhere, so every ops/cursor/select frame went out with `pageId: ''` and
   * the editor, which filters by page, dropped all of them.
   */
  attachLive(live: LiveSession, siteId: string): void {
    if (this.live !== live) this.live?.close();
    this.live = live;
    this.liveSite = siteId;
    if (this.pageId && this.siteId === siteId) live.start(this.pageId);
  }

  /** Leave the room, if in one. */
  leaveLive(): void {
    this.live?.close();
    this.live = null;
    this.liveSite = '';
  }

  /**
   * How to open the live-edit room, handed over by `registerLiveTools`.
   *
   * A CALLBACK rather than an import, because `live.ts` already imports this
   * class and the reverse edge would be a cycle. The direction that matters is
   * the one the design has: the room knows about the page session, not the other
   * way round.
   */
  private liveJoiner: ((siteId: string) => void) | null = null;

  setLiveJoiner(fn: (siteId: string) => void): void {
    this.liveJoiner = fn;
  }

  /**
   * JOIN BEFORE THE FIRST EDIT, rather than when an agent remembers to.
   *
   * `sb_live_join` is one call and reads as cheap, which is exactly why it gets
   * skipped: nothing fails without it. The room is simply empty, so a merchant
   * watching their own site being built sees a static canvas and concludes the
   * agent is not working. Measured here — one session built 17 pages and 19
   * products over two hours with an editor open beside it and never joined.
   *
   * Opening a page is where designing starts, so that is where this fires. The
   * room ALWAYS YIELDS to a human (see the yield rule), so joining early costs
   * a socket and risks nothing.
   *
   * FAILURE IS NOT FATAL. No credential, no network, a server without the
   * endpoint — none of those are reasons to refuse to open a page. The caller is
   * told, and goes on designing with nobody watching, which is the old behaviour
   * rather than a new one.
   */
  async ensureLive(siteId: string): Promise<'joined' | 'already' | string> {
    if (this.live && this.liveSite === siteId) return 'already';
    if (!this.liveJoiner) return 'no live transport is registered';
    // Out of the old site's room first, so a failed join below cannot leave
    // this process sitting in a room for a site it is no longer editing.
    this.leaveLive();
    try {
      this.liveJoiner(siteId);
      return this.live ? 'joined' : 'the live transport did not attach';
    } catch (e) {
      return (e as Error).message.replace(/^sbuilder:\s*/, '').slice(0, 160);
    }
  }

  location(): { siteId: string; pageId: string } {
    this.current();
    return { siteId: this.siteId, pageId: this.pageId };
  }

  /** Remember where each node landed, so the presence cursor can be honest. */
  noteBoxes(boxes: Box[]): void {
    this.boxes = boxes;
  }

  /**
   * Apply MY patches and, when joined to a room, put them on the wire.
   *
   * ONE method rather than two calls at every site, because "applied locally and
   * forgot to publish" is invisible: this session's document is right, the save
   * is right, and only the humans watching see nothing happen.
   */
  applyAndPublish(patches: Patch[]): void {
    const d = this.current();
    d.apply(patches);
    this.live?.publish(patches);
    // Move the cursor to what was just touched, but ONLY when a real
    // measurement exists. Presence with a made-up coordinate is theatre;
    // presence with a measured one is information.
    const touched = String(patches[0]?.path[1] ?? '');
    const box = this.boxes.find((b) => b.id === touched);
    if (box && this.live) {
      this.live.select(touched);
      this.live.cursor(box.x + box.w / 2, box.y + box.h / 2);
    }
  }

  /**
   * The only sanctioned way to write: judge, then apply, publish and save.
   *
   * SPLITTING THESE WAS THE BUG. Every tool used to call `applyAndPublish` and
   * then `save()`, and a save the platform would refuse threw with the patches
   * already in the draft — and already broadcast to anyone watching the page
   * live. The refused node then sat there, so the NEXT command was validated
   * against a tree the caller had never asked for and got the same complaint
   * about an id they had never typed. Three `sb_add` calls in a row, three
   * identical refusals, and three copies of the element quietly in the page.
   *
   * The check runs on a COPY (`PageDoc.preview`), so a write that cannot be
   * stored is never applied at all — no rollback to get wrong, and no phantom
   * frame for a peer in the room to have to un-see.
   *
   * IT REFUSES ONLY WHAT THIS WRITE INTRODUCES. A page that arrived broken —
   * damage stored before this session opened it — must not become a page nobody
   * can edit, because the edit that repairs it is also a write. Pre-existing
   * problems are left to `save()`, which names them.
   */
  async applyAndSave(patches: Patch[]): Promise<void> {
    const d = this.current();
    // EVERY WRITE CHECKS THE ROOM, not only the first page open.
    //
    // Joining once at open is right until the once fails. No network for a
    // moment, a credential that arrived late, a server that had not brought the
    // endpoint up yet — any of those leave a session that edits for an hour with
    // nobody watching and no second attempt, which is the same silence this
    // whole path exists to end.
    //
    // FREE WHEN JOINED: `ensureLive` returns on a null check, so the steady state
    // costs one branch per write. A dropped socket is NOT this method's problem —
    // `RealtimeSocket` owns its own reconnect with backoff, and re-attaching a
    // second LiveSession over a live one would be the bug, not the fix.
    await this.ensureLive(this.siteId);
    const before = new Set(validateForSave(d));
    const after = validateForSave(d.preview(patches));
    const introduced = after.filter((p) => !before.has(p));
    if (introduced.length > 0) {
      throw new Error(`sbuilder: refusing to save — ${introduced.join(' ')}`);
    }
    // AND REFUSE BEFORE APPLYING WHEN THE PAGE STILL CANNOT BE STORED.
    //
    // This used to apply, publish, and only then let `save()` discover the
    // inherited damage — which left the patches in the draft AND on the wire,
    // so the next save that did pass committed an edit the caller had been told
    // was refused. MEASURED on a live page: removing an empty section was
    // refused over four orphans it had nothing to do with, and the next
    // successful remove then stored a document missing FIVE nodes — the four it
    // was asked for, plus the section whose removal had been refused.
    //
    // `6980ebb` named this exact defect ("a refused write left its patches in
    // the draft and blamed the next command") and closed half of it: it stopped
    // the pre-check refusing INHERITED damage, and left the inherited damage
    // being discovered one step too late.
    //
    // An edit that REPAIRS the page still passes, which is what keeps a broken
    // page editable: `after` is the state this write would leave behind, so a
    // write that clears the damage leaves it empty and goes through.
    if (after.length > 0) {
      throw new Error(
        `sbuilder: refusing to save — this page already cannot be stored, and this write does ` +
          `not repair it, so nothing was applied: ${after.join(' ')}`,
      );
    }
    this.applyAndPublish(patches);
    await this.save(before);
  }

  applyRemote(patches: Patch[]): void {
    this.doc?.apply(patches);
  }

  /**
   * Does this session hold edits the server has not been given?
   *
   * `savedRev` is the revision this session last STORED, so a difference is
   * exactly "something was applied and not saved" — the same comparison
   * `save()` makes to skip a write that would change nothing.
   */
  hasUnsaved(): boolean {
    return this.doc != null && this.doc.rev !== this.savedRev;
  }

  /** The yield rule's local half: the next save re-pulls instead of overwriting. */
  markStale(reason: string): void {
    this.stale = reason;
  }

  /**
   * RE-READ THE PAGE AND STORE WHAT CAME BACK, unchanged.
   *
   * A no-op save is normally exactly what `save()` refuses to do, and for good
   * reason — it costs a round trip and bumps the revision of every shared
   * master the page carries. This one is not a no-op to the SERVER, and that
   * is the whole point.
   *
   * THE PLATFORM RECORDS A PAGE'S GLOBAL-SECTION EDGES FROM THE COMPOSED STAMP
   * ALONE. `Decompose` (`server/internal/page/decompose.go:312`) builds its
   * `GlobalWrite` list from nodes carrying `specials.globalId`; a node carrying
   * `specials.globalRef` — the STORED form, which is what a client must write
   * to attach one — takes the `if !stamped { continue }` branch and produces no
   * write at all. `SaveDraftComposed` then calls
   * `SetPageRefs(siteID, pageID, refIDs)` with a list that does not include it,
   * and `SetPageRefs` REPLACES the page's whole ref set.
   *
   * So planting a reference and saving once leaves the page composing the
   * section correctly on every read — Compose resolves `globalRef` fine — while
   * `page_global_refs` never hears about it. The visible consequences are
   * `usageCount` and `GET /global-sections/{id}/pages`, which is the list the
   * DELETE dialog shows: a master reported as used by seventeen pages, deleted,
   * and the eighteenth goes blank.
   *
   * MEASURED on a live site rather than reasoned about. Attaching the shared
   * header to a page left `usageCount` at 17 and the page absent from the
   * referencing list; re-reading and storing the composed document back moved
   * it to 18 and the page appeared. The second save is what turns `globalRef`
   * into `globalId` and back again, which is the only path that reaches
   * `SetPageRefs`.
   *
   * Cheaper than the alternative, which was for every caller to remember this.
   */
  async recompose(): Promise<void> {
    await this.open(this.siteId, this.pageId);
    // A READ THAT FAILED OPEN MUST NOT BECOME A WRITE THAT EMPTIES THE PAGE,
    // and this path is the one place that guard could be skipped.
    //
    // `save()` carries it (`openedSeeded`) because a session that seeded its
    // own ROOT is exactly how a 24-node product template got stored bare with
    // its published copy left intact. This function calls `saveSource`
    // DIRECTLY — it has to, since the whole point is a save `save()` would
    // skip as a no-op — so it would have walked straight past that guard and
    // written the invented ROOT over the page. Caught by this repo's own
    // page-create test on the first run, which is the argument for the guard
    // living at every door rather than at the usual one.
    //
    // Nothing to recompose either way: an empty document references no master,
    // so there is no edge for the round trip to record.
    if (this.openedSeeded) return;
    const d = this.current();
    const saved = await saveSource(
      this.ctx,
      this.siteId,
      this.pageId,
      d.doc as unknown as { schema_version?: number; root_node_id: string; nodes: Record<string, unknown> },
    );
    d.apply(restampPatches(d.doc, { globals: saved.globals, overlays: saved.overlays }));
    this.savedRev = d.rev;
  }

  async open(siteId: string, pageId: string): Promise<OutlineNode[]> {
    const src = await loadSource(this.ctx, siteId, pageId);
    this.doc = PageDoc.from(src.document);
    this.siteId = siteId;
    this.pageId = pageId;
    // The platform's own account of what it could not compose. Typed on the
    // response since the transport was written and read by nothing until now.
    this.warnings = composeWarnings(src.warnings);
    // Freshly pulled IS the stored state.
    this.savedRev = this.doc.rev;
    // WHAT THE READ ACTUALLY RETURNED, kept so `save` can tell a page this
    // session emptied from a page that arrived empty because the read failed
    // open. `PageDoc.from` seeds a ROOT for `{ root_node_id: "", nodes: {} }`,
    // which is right for a page just created and catastrophic for one that has
    // content — and the two are identical bytes, so only the save can judge.
    this.openedSeeded = this.doc.seededRoot === true;
    // A PAGE IS NOW ON THE CANVAS, so the room is joined here rather than in the
    // one tool that happens to be the usual way in. `sb_page_create`,
    // `sb_template_use` and `shareChrome` all open pages too, and a join wired to
    // sb_page_open alone leaves every one of those editing unseen.
    this.liveState = await this.ensureLive(siteId);
    // Tell the room this page. A fresh join already did (attachLive); an
    // existing one has only heard of the previous page. Without it the editor
    // drops every frame this session sends.
    if (this.liveState === 'already') this.live?.start(pageId);
    return this.doc.outline();
  }

  /** What the last open's join attempt did, for the tool that reports it. */
  private liveState: 'joined' | 'already' | string = 'already';

  liveStatus(): 'joined' | 'already' | string {
    return this.liveState;
  }

  /** What the server said it could not compose when this page was opened. */
  composeWarnings(): ComposeWarning[] {
    return this.warnings;
  }

  current(): PageDoc {
    if (!this.doc) throw new Error('sbuilder: no page is open — call sb_page_open first');
    return this.doc;
  }

  /**
   * The open document, or null.
   *
   * `current()` throws, correctly: every editing tool needs a page and the
   * message names the call that opens one. A site import is the one caller for
   * which "no page open" is an ordinary answer rather than a mistake — it reads
   * the design tokens off whatever page is open, and falls back to the site's
   * home page when the caller has not opened one.
   */
  peek(): PageDoc | null {
    return this.doc;
  }

  /**
   * Validate, then save.
   *
   * The validation is not belt-and-braces. The platform refuses a band-order
   * violation or a broken tree on EVERY save, and learning that from a 409 one
   * autosave later means the agent has spent the interval editing a tree nobody
   * will ever store.
   */
  async save(inherited: ReadonlySet<string> = new Set()): Promise<void> {
    if (this.stale) {
      // THE YIELD RULE. The room moved in a way this client cannot reconcile, so
      // it must not write its copy over whatever is there now. Re-pull, and make
      // the caller redo the intent against the current tree — loudly, because a
      // silently dropped edit is the outcome this whole rule exists to prevent.
      const reason = this.stale;
      this.stale = null;
      await this.open(this.siteId, this.pageId);
      throw new Error(
        `sbuilder: the page changed under this session (${reason}). It has been re-loaded from ` +
          'the server; re-read it with sb_outline and reapply your change.',
      );
    }
    const d = this.current();
    if (d.rev === this.savedRev) return;
    // THE SAME BASELINE `applyAndSave` USES, and the two gates disagreeing is
    // precisely the defect `6980ebb` named and half-closed.
    //
    // That commit — "a refused write left its patches in the draft and blamed
    // the next command" — taught `applyAndSave` to refuse only what an edit
    // INTRODUCES, so a page that arrived broken can still be edited. It left
    // this gate re-deriving the whole list from scratch, so the order became:
    // applyAndSave passes, `applyAndPublish` APPLIES THE PATCHES LOCALLY, and
    // then this throws over a problem that was already there. The patches stay
    // in the draft, and the next save that does pass commits them.
    //
    // MEASURED ON A LIVE PAGE. Removing an empty section was refused here over
    // four orphans it had nothing to do with; the next successful remove then
    // saved a document missing FIVE nodes — the four it was asked for and the
    // section whose removal had been refused. `rev: 3` after one command is the
    // same fact from the other side.
    //
    // Rolling back after a failed save was the other candidate and is worse:
    // `applyAndPublish` has already broadcast the patches over the live socket,
    // so a local rollback would leave every watching editor showing an edit
    // this session no longer has.
    const problems = validateForSave(d).filter((p) => !inherited.has(p));
    if (problems.length > 0) {
      throw new Error(`sbuilder: refusing to save — ${problems.join(' ')}`);
    }
    // A READ THAT FAILED OPEN MUST NOT BECOME A WRITE THAT EMPTIES THE PAGE.
    //
    // `PageDoc.from` seeds a ROOT when the source comes back
    // `{ root_node_id: "", nodes: {} }`. For a page the caller has just created
    // that is the whole point. For a page that HAS content it is a blank tree
    // this session now believes is the page, and the first save stores it over
    // whatever the server holds — silently, because every later gate agrees a
    // bare ROOT is a valid document.
    //
    // MEASURED, not reasoned about. A product template carrying 24 nodes plus a
    // shared header and footer came back bare to one session and was stored
    // bare. The PUBLISHED copy was untouched, so all 19 product pages kept
    // rendering while the draft the editor opens was blank; the damage was
    // invisible until a person opened the page, and one publish from that draft
    // would have taken every one of those 19 down at once.
    //
    // So when the read was seeded, this asks the server what it actually holds
    // before writing. The round trip is paid ONLY here — a seeded read is the
    // first save of a new page or this bug, and nothing else. A page the server
    // also reports as empty is genuinely new and the write goes through.
    //
    // Refusing rather than re-pulling and merging: the session cannot know which
    // of its edits belong on the real tree, and a merge that guesses is how a
    // caller ends up with a page that is neither what it built nor what was
    // there. The caller re-opens and reapplies, which is the yield rule's answer
    // to every other divergence and is already the reflex these tools teach.
    if (this.openedSeeded) {
      const stored = await loadSource(this.ctx, this.siteId, this.pageId);
      const held = (stored.document ?? {}) as { nodes?: Record<string, unknown> };
      const heldCount = Object.keys(held.nodes ?? {}).length;
      if (heldCount > 0) {
        this.openedSeeded = false;
        await this.open(this.siteId, this.pageId);
        throw new Error(
          `sbuilder: refusing to save — this page was read as EMPTY and a ROOT was invented for ` +
            `it, but the server holds ${heldCount} node(s). Writing would have erased the page. ` +
            'It has been re-loaded from the server; re-read it with sb_outline and reapply your ' +
            'change.',
        );
      }
      // The server agrees the page is empty, so the seeded ROOT is this page's
      // first real tree and every save after this one is an ordinary save.
      this.openedSeeded = false;
    }
    const saved = await saveSource(
      this.ctx,
      this.siteId,
      this.pageId,
      d.doc as unknown as { schema_version?: number; root_node_id: string; nodes: Record<string, unknown> },
    );
    // RE-STAMP THE FENCE, or lose every edit after this one.
    //
    // The save reports each shared master's new revision precisely so the client
    // can carry it into the next save; the platform refuses a stale `expectRev`
    // with a warning and a 200. Applied locally rather than published: these are
    // the server's own numbers coming back, not an edit anybody made, and a peer
    // in the room gets them from its own save.
    d.apply(restampPatches(d.doc, { globals: saved.globals, overlays: saved.overlays }));
    // AFTER the re-stamp, which is itself a revision: the point of comparison is
    // "is the document now different from what the server holds", and the
    // re-stamp wrote the server's own answer back into it.
    this.savedRev = d.rev;
    await ensureSiteTheme(this.ctx, this.siteId);
  }
}

const specSchema: z.ZodType<NodeSpec> = z.lazy(() =>
  z.object({
    type: z.string(),
    name: z.string().optional(),
    style: z.record(z.unknown()).optional(),
    config: z.record(z.unknown()).optional(),
    specials: z.record(z.unknown()).optional(),
    children: z.array(specSchema).optional(),
  }),
);

/**
 * THE SITE'S OWN HEADER AND FOOTER, read off the page that already answers it.
 *
 * A site can hold several globals of each kind — this one holds four headers and
 * two footers, most of them experiments — so "the first header" is a guess and
 * a name is a label nobody promised to keep. The HOME PAGE is the site's own
 * answer: whatever chrome it carries is the chrome this site wears.
 *
 * Silent on anything it cannot read. A page created without its chrome is a page
 * a person can fix; a page created with the WRONG chrome is one nobody notices.
 */
async function siteChrome(
  ctx: ToolContext,
  siteId: string,
): Promise<{ header?: string; footer?: string }> {
  try {
    const listed = (await request({
      base: ctx.base,
      method: 'GET',
      path: `/api/sites/${encodeURIComponent(siteId)}/pages`,
      token: siteToken(ctx),
      fetchImpl: ctx.fetchImpl,
    })) as { pages?: Array<Record<string, unknown>> };
    const home = (listed.pages ?? []).find((p) => p.isHomepage === true);
    if (!home || typeof home.id !== 'string') return {};
    const src = await loadSource(ctx, siteId, home.id);
    const doc = PageDoc.from(src.document);
    const out: { header?: string; footer?: string } = {};
    for (const id of doc.node(doc.doc.root_node_id).data.nodes) {
      const sp = doc.doc.nodes[id]?.specials as Record<string, unknown> | undefined;
      const gid = sp?.globalId;
      const kind = sp?.globalKind;
      if (typeof gid !== 'string') continue;
      if (kind === 'header' && !out.header) out.header = gid;
      if (kind === 'footer' && !out.footer) out.footer = gid;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Plain text, for a field the platform renders AS text.
 *
 * A page name is shown in the pages panel and in the browser tab and is never
 * parsed as markup, so an HTML entity in one is always a mistake: text lifted
 * from a page's source and handed on without being decoded. Measured on a real
 * store, read back through sb_page_list: a page stored as "Chính sách giao hàng
 * &amp; đổi trả" — which is what the merchant then reads in their own editor,
 * and what a browser tab then shows.
 *
 * ONE PASS, and only over what escaping actually produces. "&amp;amp;" decodes to
 * "&amp;" and stops there, because a second pass would be inventing an intent
 * nobody expressed; an unknown entity is left exactly as it arrived. This
 * un-escapes text that was escaped once. It does not interpret markup.
 */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function plainText(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body.startsWith('#x') ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // A code point that is not one is not a reference — leave the text alone
      // rather than writing a replacement character into somebody's page name.
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * The site's own home page, or null when it genuinely has none.
 *
 * THROWS RATHER THAN GUESSES. Answering "none" for a listing that could not be
 * read is the one wrong answer available here: it is indistinguishable from an
 * empty site, and the caller acts on it by creating a home page the site
 * already had. `siteChrome` above may swallow its read because a page created
 * without chrome is a page a person can fix; this one may not, because the page
 * it creates cannot be un-created and takes the star off whichever page held it.
 */
async function existingHomepage(
  ctx: ToolContext,
  siteId: string,
): Promise<{ id: string; name: string } | null> {
  const listed = (await request({
    base: ctx.base,
    method: 'GET',
    path: `/api/sites/${encodeURIComponent(siteId)}/pages`,
    token: siteToken(ctx),
    fetchImpl: ctx.fetchImpl,
  })) as { pages?: Array<Record<string, unknown>> };
  const home = (listed.pages ?? []).find((p) => p.isHomepage === true);
  if (!home || typeof home.id !== 'string' || !home.id) return null;
  return { id: home.id, name: typeof home.name === 'string' ? home.name : '' };
}

export function registerPageTools(server: McpServer, ctx: ToolContext): PageSession {
  const session = new PageSession(ctx);

  server.registerTool(
    'sb_page_open',
    {
      description:
        'Open a page for editing and return its outline. Call before any sb_add / sb_set / ' +
          'sb_move / sb_remove. Find page ids with sb_api_find "list pages".',
      inputSchema: { site_id: z.string().optional(), page_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ site_id: given, page_id }) => {
      const outline = await session.open(siteFor(ctx, given), page_id);
      // `open` joined the room on the way through — this only reports what it did.
      const live = session.liveStatus();
      const doc = session.current();
      // A page whose stored document named its root under the app-block key
      // renders as an empty <body> and says nothing about why. Nobody else can
      // see this, so it is reported on open rather than left for the screenshot.
      const blank_page_repair = doc.adoptedRootKey
        ? `This page's document names its root as "${doc.adoptedRootKey}", not "root_node_id", so ` +
          'the renderer finds no root and publishes an EMPTY BODY. The next save from here writes ' +
          'the canonical key and fixes it; publish afterwards.'
        : undefined;
      // AN EMPTY READ IS REPORTED, because the caller is the only one who knows
      // whether this page is supposed to be empty. A page just created reads
      // this and carries on; a page that was built reads it and stops — which is
      // the whole difference between noticing now and noticing after a publish.
      const seeded_empty = doc.seededRoot
        ? 'This page came back EMPTY and a ROOT was seeded for it. That is expected for a page ' +
          'you just created. If this page HAD content, do not edit or publish it — the draft ' +
          'read is blank, not the page: re-open it, and if it is still blank restore it from ' +
          'GET /api/sites/{siteId}/pages/{pageId}/history.'
        : undefined;
      const warnings = session.composeWarnings();
      return text({
        outline,
        // Said ONLY when it is news. 'already' is the steady state after the
        // first open and repeating it on every page is the shape that drifts.
        ...(live === 'joined'
          ? { live: 'Joined the live-edit room — anyone with this site open sees these edits as they land.' }
          : live === 'already'
            ? {}
            : { live_unavailable: live }),
        ...(blank_page_repair ? { blank_page_repair } : {}),
        ...(seeded_empty ? { seeded_empty } : {}),
        ...(warnings.length ? { compose_warnings: warnings } : {}),
        ...reviewField(ctx, doc),
      });
    },
  );

  server.registerTool(
    'sb_outline',
    {
      description:
        'The open page as a compressed tree — id, type, name, child count, band, and whether a ' +
          'node is a shared global or a site overlay. Never the raw document: a real page is ' +
          'hundreds of KB of JSON.',
      inputSchema: { depth: z.number().int().min(1).max(6).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ depth }) => text(session.current().outline({ depth })),
  );

  server.registerTool(
    'sb_node_read',
    {
      description:
        'One node in full — style, config, specials, per-breakpoint overrides, bindings.',
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const d = session.current();
      const node = d.node(id);
      const warn = globalWarning(d.doc, id);
      // THE STYLE LAYER THIS NODE'S `style` DOES NOT CONTAIN. Nine element types
      // keep their defaults in a theme PRESET rather than in the meta, so an
      // icon's colour and a button's fill are simply absent from what this tool
      // used to return — on a page visibly painting them. Design rule 0 told the
      // agent to read the pattern off what is there, and there was nothing
      // there to read, so it invented one. See domains/site/theme.ts.
      const { theme, from } = await siteTheme(ctx, session.location().siteId);
      const preset = presetLayer(theme, from, node as never);
      return text({ node, ...(preset ? { preset } : {}), ...(warn ? { warning: warn } : {}) });
    },
  );

  server.registerTool(
    'sb_catalog_search',
    {
      description:
        'Find an element type by what it does — or OMIT query to browse every type, the only ' +
          'way to meet one you would not have searched for. detail:true adds the AI hints, as ' +
          'does sb_traits_for.',
      inputSchema: {
      query: z.string().optional(),
      limit: z.number().int().min(1).max(60).optional().describe('Default 8'),
      detail: z.boolean().optional().describe('Include useWhen / avoidWhen / contentTips per match'),
    },
      annotations: { readOnlyHint: true },
    },
    // A SEARCH CANNOT INTRODUCE YOU TO ANYTHING. Omitting the query browses the
    // whole catalogue instead — see catalogBrowse for the measurement that made
    // this necessary: a store built with these tools used 17 element types and
    // hand-assembled what a dozen purpose-built ones already do.
    async ({ query, limit, detail }) =>
      text(
        query && query.trim()
          ? catalogMatches(query, { limit, detail })
          : {
              elements: catalogBrowse(),
              note:
                'Every element type, grouped as the palette groups them. Pass a TYPE as query ' +
                'for the fields to choose by, or a CATEGORY NAME with limit 60 to read that ' +
                "whole group's descriptions at once — which is how you find out what the ones " +
                'you have never used are for. sb_traits_for then has the controls and hints.',
            },
      ),
  );

  server.registerTool(
    'sb_traits_for',
    {
      description:
        "This element's INSPECTOR, as a person sees it: tabs, groups, and every control name — " +
          'with what each DECLARED control writes, and the AI hints for using the element. Read ' +
          'this before styling an element; pass control to read one control in full.',
      inputSchema: {
      type: z.string(),
      control: z.string().optional().describe('Narrow to one control, e.g. "font_size"'),
    },
      annotations: { readOnlyHint: true },
    },
    async ({ type, control }) => text(traitsFor(type, control)),
  );

  server.registerTool(
    'sb_add',
    {
      description:
        'Add an element — or a whole NESTED subtree — under a parent. One call builds a complete ' +
          'section: pass children rather than calling this once per node.',
      inputSchema: {
      parent_id: z.string(),
      spec: specSchema,
      index: z.number().int().min(0).optional(),
      dry_run: z.boolean().optional(),
      force: z.boolean().optional().describe('Override a render-inference guard; reported as forced'),
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ parent_id, spec, index, dry_run, force }) => {
      const d = session.current();
      const guard: GuardOpts = { force, forced: [] };
      const { patches, ids } = addSubtree(d, parent_id, spec, index, guard);
      const forced = guard.forced!.length ? { forced: guard.forced } : {};
      // ELEMENTS THAT RENDER CONVINCINGLY WHILE WIRED TO NOTHING. The add
      // succeeds completely, the tree is correct and the page photographs
      // right, so neither sb_review nor sb_look can see the gap — the moment
      // the element is added is the only cheap place to say it. In the dry run
      // too, so the caller is not told after committing.
      const types: string[] = [];
      const walkSpec = (n: { type: string; children?: unknown[] }): void => {
        types.push(n.type);
        for (const c of n.children ?? []) walkSpec(c as { type: string; children?: unknown[] });
      };
      walkSpec(spec as { type: string; children?: unknown[] });
      const inert = inertHintsFor(types)
        .map((h) => ctx.notices.once(`inert:${h.type}`, h.note))
        .filter((n): n is string => !!n)
        .join(' ');

      if (dry_run !== false) {
        return text({
          dry_run: true,
          would_add: ids.length,
          patches: patches.length,
          ...(inert ? { inert } : {}),
          ...forced,
        });
      }
      await session.applyAndSave(patches);
      return text({ added: ids, rev: d.rev, ...(inert ? { inert } : {}), ...forced });
    },
  );

  server.registerTool(
    'sb_set',
    {
      description:
        'Write style, config or specials keys on one node, or on many through edits (one ' +
          'save, one live frame). Per BREAKPOINT by default; base:true writes the fallback ' +
          'layer, right for a value that should not vary.',
      inputSchema: {
        id: z.string().optional(),
        namespace: z.enum(['style', 'config', 'specials']).optional(),
        keys: z.record(z.unknown()).optional(),
        unset: z
          .array(z.string())
          .optional()
          .describe(
            'Keys to REMOVE from the same slot — the only way to undo a write. Setting null ' +
              'is not the same: null is a stored value, so the override still counts as present.',
          ),
        breakpoint: z.enum(['desktop', 'laptop', 'tablet', 'mobile']).optional(),
        base: z.boolean().optional(),
        state: z
          .string()
          .optional()
          .describe(
            'An interaction state — "hover", or "stuck" for how a pinned element looks once ' +
              'it is stuck (needs a sticky/fixed self-or-ancestor; a descendant styles itself ' +
              'through the host).',
          ),
        edits: z
          .array(
            z.object({
              id: z.string(),
              namespace: z.enum(['style', 'config', 'specials']),
              keys: z.record(z.unknown()),
              breakpoint: z.enum(['desktop', 'laptop', 'tablet', 'mobile']).optional(),
              base: z.boolean().optional(),
              state: z.string().optional(),
              unset: z.array(z.string()).optional(),
            }),
          )
          .optional(),
        dry_run: z.boolean().optional(),
        force: z.boolean().optional().describe('Override a render-inference guard; reported as forced'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, namespace, keys, breakpoint, base, state, unset, edits, dry_run, force }) => {
      const d = session.current();
      // One shape inside: a single edit is a batch of one.
      const batch: SetEdit[] = edits ?? [];
      if (!edits) {
        // `keys` is optional when `unset` carries the work: a pure removal is a
        // legitimate edit, and demanding an empty object alongside it would make
        // the repair `sb_review` names read like a workaround.
        if (!id || !namespace || (!keys && !unset?.length)) {
          throw new Error('sbuilder: sb_set needs id + namespace + keys (or unset), or edits[]');
        }
        batch.push({ id, namespace, keys: keys ?? {}, breakpoint: breakpoint as Breakpoint | undefined, base, state, unset });
      }
      const guard: GuardOpts = { force, forced: [] };
      const { patches, touched } = setMany(d, batch, guard);
      const forced = guard.forced!.length ? { forced: guard.forced } : {};
      // WHERE A HOVER ACTUALLY WENT. Routing it silently would leave a caller
      // who reads the node back looking for keys in a slot they never wrote to.
      //
      // ONCE PER PROCESS PER ELEMENT TYPE, not once per node. A batch repairing
      // every button on a page carried ten copies of the same 300-character
      // paragraph — measured, on this repo's own storefront — which is the shape
      // `ctx.notices` exists to prevent. The type is the whole content of the
      // note, so a second copy tells the caller nothing they were not just told,
      // and the ids it applies to are already in `set`.
      const hoverTypes = new Set<string>();
      for (const e of batch) {
        if (e.state !== HOVER_STATE || e.namespace !== 'style') continue;
        const type = d.doc.nodes[e.id]?.data.type ?? '';
        if (hoverRoutingNote(type)) hoverTypes.add(type);
      }
      // WHICH BOX a parent-hover rule hung off. Per NODE rather than once per
      // process: the answer is about this node's ancestry, so a second node's is
      // genuinely different information.
      const hostNotes: Record<string, string> = {};
      for (const e of batch) {
        if (e.state !== PARENT_HOVER_STATE) continue;
        const n = hoverHostNote(d.doc, e.id);
        if (n) hostNotes[e.id] = n;
      }
      const hoverNote = [...hoverTypes]
        .map((t) => ctx.notices.once(`hover-home:${t}`, hoverRoutingNote(t) as string))
        .filter((n): n is string => !!n)
        .join(' ');
      // CONFIG THAT WENT TO BASE BECAUSE PUBLISH READS IT NOWHERE ELSE. Keyed on
      // the KEY, not the node and not the element type: "iconSize is base-only"
      // is the whole answer, true of every icon on the page, so a batch fixing
      // ten of them must not carry ten copies of it. Same reason the hover note
      // keys on the type.
      const movedToBase = new Set<string>();
      for (const e of batch) {
        for (const k of baseOnlyKeys(d, e.id, e.keys, e)) movedToBase.add(k);
      }
      const baseNote = [...movedToBase]
        .map((k) =>
          ctx.notices.once(`base-only:${k}`, baseOnlyNote([k], batch[0].breakpoint ?? 'desktop')),
        )
        .filter((n): n is string => !!n)
        .join(' ');
      // A LITERAL OVER A PRESET DETACHES THE NODE FROM THE THEME, permanently.
      // The node's own slot outranks its preset, so this is how one button
      // differs from the rest — an ordinary, correct thing to do. What is not
      // ordinary is doing it without knowing: the next palette change moves
      // every other node and not this one, and nothing anywhere says why.
      // Once per PRESET per process, because the answer is about the preset.
      const detachNotes: string[] = [];
      // GATED BEFORE THE FETCH, for the reason `stuck()` below is gated before
      // the clone: sb_set is the hottest write in this server, and `siteTheme`
      // is an HTTP round trip on its first call. Only a plain STYLE write on a
      // node that actually wears a preset can change this answer, and
      // `presetIdOf` decides that from the document alone — no theme needed. A
      // page of flex-blocks, or any config-only write, now pays nothing.
      const wearers = batch.filter((e) => {
        if (e.namespace !== 'style' || e.state) return false;
        const n = d.doc.nodes[e.id];
        return !!n && presetIdOf(n as never) !== null;
      });
      if (wearers.length) {
        const { theme, from } = await siteTheme(ctx, session.location().siteId);
        const seen = new Set<string>();
        for (const e of wearers) {
          const layer = presetLayer(theme, from, d.doc.nodes[e.id] as never);
          if (!layer || seen.has(layer.id)) continue;
          const note = detachNote(layer, Object.keys(e.keys));
          if (!note) continue;
          seen.add(layer.id);
          const once = ctx.notices.once(`preset-detach:${layer.id}`, note);
          if (once) detachNotes.push(once);
        }
      }
      const presetNote = detachNotes.join(' ');
      // A CONFIG VALUE THE RENDERER DOES NOT KNOW. `EffectiveCollectionType` and
      // its two siblings are NORMALISERS, not validators: an unrecognised word
      // collapses to a default, so a repeater set to "bestseller" publishes and
      // renders the whole catalogue under whatever heading is above it. Keyed on
      // key+value, because the answer is about that pair and a batch fixing ten
      // repeaters the same wrong way should say it once.
      const valueNotes: string[] = [];
      for (const e of batch) {
        // THE ELEMENT-SCOPED VOCABULARIES REACH `specials` TOO, and they have to:
        // `specials.part` on a cart-total, `specials.source` on a breadcrumb and
        // `specials.field` on a member-field are words with a fixed list, and a
        // wrong one is the same silent normalisation a config key gets. Scoped
        // by node TYPE because the key is not unique — two controls write
        // `specials.source` with different vocabularies, and only the element
        // says which one this node means.
        const type = d.doc.nodes[e.id]?.data.type ?? '';
        if (type) {
          for (const [k, v] of Object.entries(e.keys)) {
            const n = unknownWriteNote(type, e.namespace, k, v);
            if (!n) continue;
            const once = ctx.notices.once(`value:${type}.${e.namespace}.${k}=${JSON.stringify(v)}`, n);
            if (once) valueNotes.push(once);
          }
          // …AND THE ONE A PER-KEY TABLE CANNOT GIVE: values that are each legal
          // and mean nothing TOGETHER. `filterValueMode: "auto"` with
          // `filterSource: "blog_category"` passed every check above and
          // published a filter that renders nothing.
          //
          // Asked of the node AS IT WILL BE, not of the write: the node may
          // already carry the neighbour this write needs, and the write may
          // supply the neighbour a stored value was missing — so a question
          // about one key alone answers the wrong thing in both directions.
          if (e.namespace === 'specials') {
            const after = { ...(d.doc.nodes[e.id]?.specials ?? {}), ...e.keys };
            for (const [k, v] of Object.entries(e.keys)) {
              const un = unsupportedSettingNote(type, k, v);
              if (!un) continue;
              const once = ctx.notices.once(`unsupported:${type}.${k}=${JSON.stringify(v)}`, un);
              if (once) valueNotes.push(once);
            }
            for (const n of preconditionNotes(type, after)) {
              const once = ctx.notices.once(`precondition:${type}:${n.slice(0, 60)}`, n);
              if (once) valueNotes.push(once);
            }
          }
        }
        // AND THE QUIETER ONE: a key an element SEEDS that no renderer anywhere
        // reads. The vocabularies above answer "this value means something other
        // than you think"; this answers "no value means anything". Keyed on the
        // KEY rather than on key+value, because the answer does not depend on
        // what was written and a caller trying three spellings deserves one
        // reply. Outside the type check, since a dead key is dead on every node.
        for (const k of Object.keys(e.keys)) {
          const n = deadKeyNote(e.namespace, k);
          if (!n) continue;
          const once = ctx.notices.once(`dead-key:${e.namespace}.${k}`, n);
          if (once) valueNotes.push(once);
        }
        if (e.namespace !== 'config') continue;
        for (const [k, v] of Object.entries(e.keys)) {
          // THE ENTRANCE ANIMATION IS ITS OWN QUESTION, because it is an object
          // rather than a word and every way of missing it renders NOTHING
          // rather than a normalised something. Keyed on the whole value: two
          // nodes given the same wrong animation deserve one answer, and two
          // given different wrong ones deserve two.
          const n = k === 'animation' ? animationNote(v) : unknownValueNote(k, v);
          if (!n) continue;
          const once = ctx.notices.once(`config-value:${k}=${JSON.stringify(v)}`, n);
          if (once) valueNotes.push(once);
        }
      }
      const valueNote = valueNotes.join(' ');
      // A FIELD-SKIN KNOB ON THE WRONG NODE renders nowhere. The FORM dresses
      // every field it holds with the input vocabulary; a payment card, choice
      // group, timeslot or file field carries its own, and a knob written on a
      // node whose css.go does not name that group is stored and read by
      // nothing. Once per node TYPE, because the answer is about the type.
      const skinNotes: string[] = [];
      const skinSeen = new Set<string>();
      for (const e of batch) {
        if (e.namespace !== 'config') continue;
        const type = d.doc.nodes[e.id]?.data.type ?? '';
        if (!type || skinSeen.has(type)) continue;
        const n = skinLevelNote(type, Object.keys(e.keys));
        if (!n) continue;
        skinSeen.add(type);
        const once = ctx.notices.once(`field-skin:${type}`, n);
        if (once) skinNotes.push(once);
      }
      const skinNote = skinNotes.join(' ');
      // THE STICKY WARNING IS COMPUTED AGAINST THE DOCUMENT AS IT WILL BE, so
      // the dry run and the real run say the same thing. A caller who is told
      // only after committing has already shipped a header that does not move.
      const stuck = (): Record<string, string> => {
        // Gated on the batch actually being able to change the answer, because
        // a page document is hundreds of KB and sb_set is the hottest write
        // there is: a clone on every call would tax every edit for a warning
        // that fires on almost none. `position` and `overflow*` are the only
        // two keys in the question.
        const relevant = batch.some(
          (e) =>
            e.namespace === 'style' &&
            ('position' in e.keys || 'overflowX' in e.keys || 'overflowY' in e.keys),
        );
        const out: Record<string, string> = {};
        if (!relevant) return out;
        const probe = JSON.parse(JSON.stringify(d.doc)) as typeof d.doc;
        applyPatches(probe as unknown as object, patches);
        for (const e of batch) {
          const w = stickyWarning(probe, e.id, e.base ? undefined : (e.breakpoint ?? 'desktop'));
          if (w) out[e.id] = w;
        }
        return out;
      };
      if (dry_run !== false) {
        const note = ctx.notices.once('responsive', RESPONSIVE_NOTICE);
        const sw = stuck();
        return text({
          dry_run: true,
          patches,
          ...(Object.keys(sw).length ? { warnings: sw } : {}),
          ...(hoverNote ? { hover: hoverNote } : {}),
          ...(baseNote ? { base_only: baseNote } : {}),
          ...(presetNote ? { preset: presetNote } : {}),
          ...(valueNote ? { value: valueNote } : {}),
          ...(skinNote ? { field_skin: skinNote } : {}),
          ...(Object.keys(hostNotes).length ? { hover_host: hostNotes } : {}),
          ...(note ? { note } : {}),
          ...forced,
        });
      }
      const warnings: Record<string, string> = stuck();
      await session.applyAndSave(patches);
      for (const t of touched) {
        const w = globalWarning(d.doc, t.id);
        if (w) warnings[t.id] = warnings[t.id] ? `${warnings[t.id]} ${w}` : w;
      }
      if (!edits) {
        const warn = warnings[batch[0].id];
        return text({
          set: touched[0].keys,
          rev: d.rev,
          ...(warn ? { warning: warn } : {}),
          ...(hoverNote ? { hover: hoverNote } : {}),
          ...(baseNote ? { base_only: baseNote } : {}),
          ...(presetNote ? { preset: presetNote } : {}),
          ...(valueNote ? { value: valueNote } : {}),
          ...(skinNote ? { field_skin: skinNote } : {}),
          ...(hostNotes[batch[0].id] ? { hover_host: hostNotes[batch[0].id] } : {}),
          ...forced,
        });
      }
      return text({
        set: touched,
        rev: d.rev,
        ...(Object.keys(warnings).length ? { warnings } : {}),
        ...(hoverNote ? { hover: hoverNote } : {}),
        ...(baseNote ? { base_only: baseNote } : {}),
        ...(presetNote ? { preset: presetNote } : {}),
        ...(valueNote ? { value: valueNote } : {}),
        ...(skinNote ? { field_skin: skinNote } : {}),
        ...(Object.keys(hostNotes).length ? { hover_host: hostNotes } : {}),
        ...forced,
      });
    },
  );

  server.registerTool(
    'sb_move',
    {
      description:
        'Move a node to another parent at an index.',
      inputSchema: {
      id: z.string(),
      parent_id: z.string(),
      index: z.number().int().min(0),
      dry_run: z.boolean().optional(),
      force: z.boolean().optional().describe('Override a render-inference guard; reported as forced'),
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, parent_id, index, dry_run, force }) => {
      const d = session.current();
      const guard: GuardOpts = { force, forced: [] };
      const patches = moveNode(d, id, parent_id, index, guard);
      const forced = guard.forced!.length ? { forced: guard.forced } : {};
      if (dry_run !== false) return text({ dry_run: true, patches, ...forced });
      await session.applyAndSave(patches);
      return text({ moved: id, rev: d.rev, ...forced });
    },
  );

  server.registerTool(
    'sb_remove',
    {
      description:
        'Remove a node and its whole subtree.',
      inputSchema: {
        id: z.string(),
        dry_run: z.boolean().optional(),
        force: z.boolean().optional().describe('Override a render-inference guard; reported as forced'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id, dry_run, force }) => {
      const d = session.current();
      const guard: GuardOpts = { force, forced: [] };
      const patches = removeNode(d, id, guard);
      const forced = guard.forced!.length ? { forced: guard.forced } : {};
      // NODES, NOT PATCHES — this reported `patches.length` and the field is
      // called `removing` on a tool whose description is "Remove a node and its
      // whole subtree", so every caller reads it as a node count.
      //
      // It is off by one in the ORDINARY case and exact in the rare one, which
      // is the worst arrangement available: `removeNode` emits one `unset` per
      // doomed node PLUS one `remove` that takes the id out of its parent's
      // child list — and that second patch exists only when the parent is still
      // in the document. A childless section under ROOT therefore reported 2,
      // and a four-node subtree whose parent had already been deleted reported
      // 4 and was right. Both numbers were believed here: the 2 was read as
      // evidence of a hidden node attached by `parent` alone, and a page-source
      // dump then proved no such node exists.
      //
      // The doomed set is exactly the `unset` patches that name a node
      // directly; the parent-list patch is an `insert`/`remove` four segments
      // deep, so length is what separates them without re-deriving the walk.
      const nodes = patches.filter((p) => p.op === 'unset' && p.path.length === 2).length;
      if (dry_run !== false) {
        return text({ dry_run: true, removing: nodes, patches: patches.length, ...forced });
      }
      await session.applyAndSave(patches);
      return text({ removed: id, rev: d.rev, ...forced });
    },
  );

  server.registerTool(
    'sb_review',
    {
      description:
        'What a VISITOR would meet on the open page (blank band, placeholder, dead binding) AND ' +
          "what stands between this store and a paid order (checkout page, gateway, delivery, a " +
          'way back to the cart). Run it before calling a page finished.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const doc = session.current();
      const field = reviewField(ctx, doc);
      // THE STORE'S OWN READINESS, which no API exposes and no page document
      // can show. A page can review perfectly clean and still sit on a store
      // with no checkout page, no gateway and no way back to the cart.
      let store: Record<string, unknown> = {};
      try {
        const { siteId } = session.location();
        const gaps = readinessGaps(
          await gatherReadiness(ctx, siteId, Object.values(doc.doc.nodes) as never),
        );
        if (gaps.length > 0) {
          const notice = ctx.notices.once('readiness', READINESS_NOTICE);
          store = { store_gaps: gaps, ...(notice ? { store_notice: notice } : {}) };
        }
      } catch {
        // Readiness is additional information, never the reason a review fails.
      }
      const clean = Object.keys(field).length === 0;
      return text({
        ...(clean ? { findings: [], verdict: 'Nothing a visitor would notice on this page.' } : field),
        ...store,
      });
    },
  );

  server.registerTool(
    'sb_duplicate',
    {
      description:
        'Copy a node and everything under it, under fresh ids, right after the original. The ' +
          'move a designer makes constantly — build one card, duplicate it twice.',
      inputSchema: {
        id: z.string(),
        dry_run: z.boolean().optional(),
        force: z.boolean().optional().describe('Override a render-inference guard; reported as forced'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, dry_run, force }) => {
      const d = session.current();
      const guard: GuardOpts = { force, forced: [] };
      const { patches, ids } = duplicateNode(d, id, guard);
      const forced = guard.forced!.length ? { forced: guard.forced } : {};
      if (dry_run !== false) return text({ dry_run: true, would_copy: ids.length, ...forced });
      await session.applyAndSave(patches);
      return text({ duplicated: id, into: ids[0], nodes: ids.length, rev: d.rev, ...forced });
    },
  );

  server.registerTool(
    'sb_templates',
    {
      description:
        "The store's saved section templates — designed sections a person starts from rather " +
          'than assembling one. Use sb_template_use to drop one into the open page.',
      inputSchema: { site_id: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ site_id: given }) => {
      const listed = projectList(
        await request({
          base: ctx.base,
          method: 'GET',
          path: `/api/sites/${encodeURIComponent(siteFor(ctx, given))}/section-templates`,
          token: siteToken(ctx),
          fetchImpl: ctx.fetchImpl,
        }),
        'sectionTemplates',
        TEMPLATE_FIELDS,
      ) as Record<string, unknown>;
      // THE SITE'S OWN FIRST, ALWAYS. A template a merchant designed is this
      // site's answer; these are defaults for a page that has none. Measured on
      // a live site, the platform's library held TWO — which is why an agent
      // asked for "a hero" was inventing one from flex-blocks every time.
      return text({
        ...listed,
        built_in: LAYOUT_PATTERNS.map((p) => ({ id: p.id, name: p.name, use: p.use })),
      });
    },
  );

  server.registerTool(
    'sb_template_use',
    {
      description:
        'Instantiate a section template into a page — the site\'s own (the server copies it) or ' +
          'one of the BUILT-IN layouts sb_templates lists, which are composed against this ' +
          "page's own tokens rather than copied.",
      inputSchema: {
      site_id: z.string().optional(),
      template_id: z.string(),
      page_id: z.string(),
      dry_run: z.boolean().optional(),
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ site_id: given, template_id, page_id, dry_run }) => {
      const site_id = siteFor(ctx, given);

      // A BUILT-IN IS NOT A SERVER COPY. The platform's own templates are
      // instantiated by the platform, which is why the section arrives exactly
      // as designed; a built-in has no row on the server, so it is composed HERE
      // — against the target page's own tokens, which is the whole point of it
      // being a pattern rather than a snapshot.
      const pattern = PATTERN_BY_ID.get(template_id);
      if (pattern) {
        await session.open(site_id, page_id);
        const doc = session.current();
        const read = tokensFromPage(doc.doc);
        // A BLANK PAGE HAS NO PATTERN TO READ, and the next authority is the
        // site's THEME rather than nothing — every element's style preset
        // resolves from it anyway. Carried as `var(--wb-color-…)`, so the band
        // goes on following the theme instead of freezing today's hex into it.
        const fromTheme = Object.keys(read).length === 0;
        const tokens = fromTheme ? THEME_TOKENS : read;
        // REAL IMAGES, from the site's own library. The instinct a pattern
        // library invites is a placeholder — a grey box or a stock photo keyed
        // off a word — and this repo already records why the second is not a
        // source (`loremflickr` answered "kids,clothing" with a cat statue). The
        // merchant's own uploads are the honest answer, and a failure to read
        // them costs the picture, never the band.
        let pool: MediaPick[] = [];
        try {
          const listed = (await request({
            base: ctx.base,
            method: 'GET',
            path: `/api/sites/${encodeURIComponent(site_id)}/media?limit=50`,
            token: siteToken(ctx),
            fetchImpl: ctx.fetchImpl,
          })) as { media?: Array<Record<string, unknown>>; assets?: Array<Record<string, unknown>> };
          const rows = listed.media ?? listed.assets ?? [];
          pool = rows
            .filter((m) => m.mediaType === 'image' && typeof m.url === 'string' && m.state !== 'deleted')
            .map((m) => ({
              url: String(m.url),
              name: typeof m.name === 'string' ? m.name : undefined,
              width: typeof m.width === 'number' ? m.width : undefined,
              height: typeof m.height === 'number' ? m.height : undefined,
            }));
        } catch {
          // A library that cannot be read leaves the picture slot saying so.
        }
        // WHAT THE PAGE IS ALREADY SHOWING comes out of the pool. Each call
        // starts its own selection, so a hero added first and a gallery added
        // second both reached for the same best landscape — and the page then
        // showed one photo twice, which reads as a mistake because it is one.
        const onPage = new Set(
          Object.values(doc.doc.nodes)
            .map((n) => (n as { specials?: Record<string, unknown> }).specials?.src)
            .filter((v): v is string => typeof v === 'string' && v.length > 0),
        );
        const spec = pattern.build(tokens, pool.filter((m) => !onPage.has(m.url)));
        if (!spec) {
          throw new Error(`sbuilder: the built-in "${template_id}" produced nothing to add.`);
        }
        const { patches, ids } = addSubtree(doc, doc.doc.root_node_id, spec, middleEnd(doc.doc));
        if (dry_run !== false) {
          return text({
            dry_run: true,
            would_add: pattern.name,
            nodes: ids.length,
            into: page_id,
            tokens_from: fromTheme ? "this site's theme — the page has no look of its own yet" : 'this page',
            images_available: pool.length,
            ...(pattern.images ? { pictures_wanted: pattern.images } : {}),
            note:
              'Composed against THIS page\'s tokens, not copied — the same heading ink, button ' +
              'fill and section padding the page already uses. Pass dry_run:false to add it.',
          });
        }
        await session.applyAndSave(patches);
        return text({
          added: pattern.name,
          section: ids[0],
          nodes: ids.length,
          into: page_id,
          rev: doc.rev,
          // A SHORT LIBRARY IS THE ORDINARY STATE OF A SITE THIS SERVER BUILT,
          // not an edge case — nothing has been uploaded yet, so every picture
          // slot in every pattern is a sentence. Saying "there are no images"
          // and stopping leaves the agent to rediscover the fix; saying how
          // many this band wanted and naming the two calls that fill them is
          // the same fact with the next step attached.
          ...(pattern.images && pool.length < pattern.images
            ? {
                pictures:
                  `This band has ${pattern.images} picture slot${pattern.images > 1 ? 's' : ''} and the ` +
                  `library offered ${pool.length}; the rest say so in words rather than showing a grey ` +
                  'box. Fill them: sb_media_upload query:"<what the band should show>" reads back real ' +
                  'photographs with their own descriptions, then pick:[…] uploads the ones you chose in ' +
                  'one call. Re-run this pattern afterwards and it takes them.',
              }
            : {}),
          ...(fromTheme
            ? {
                tokens_from:
                  "this site's theme — the page had no heading, button or section to read a look " +
                  'off, so the band carries var(--wb-color-…) and follows the theme rather than a ' +
                  'frozen colour. Style this first band and every pattern after it reads THAT.',
              }
            : {}),
        });
      }

      const path = `/api/sites/${encodeURIComponent(site_id)}/section-templates/${encodeURIComponent(template_id)}/instantiate`;
      if (dry_run !== false) {
        return text({ dry_run: true, would_post: path, body: { pageId: page_id } });
      }
      const out = await request({
        base: ctx.base,
        method: 'POST',
        path,
        token: siteToken(ctx),
        body: { pageId: page_id },
        fetchImpl: ctx.fetchImpl,
      });
      return text({
        instantiated: template_id,
        into: page_id,
        result: out,
        note: 'Re-open the page with sb_page_open — this session still holds the old tree.',
      });
    },
  );

  server.registerTool(
    'sb_page_list',
    {
      description:
        "Every page on the site, with its slug and whether it is live.",
      inputSchema: { site_id: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ site_id: given }) => {
      const raw = (await request({
        base: ctx.base,
        method: 'GET',
        path: `/api/sites/${encodeURIComponent(siteFor(ctx, given))}/pages`,
        token: siteToken(ctx),
        fetchImpl: ctx.fetchImpl,
      })) as { pages?: InventoryPage[] };
      // WHAT A SITE USUALLY ALSO HAS, said where an agent is orienting rather
      // than after it has finished. sb_review reports the pages the storefront
      // ROUTES BY TYPE; these have no type at all — login, register, forgot,
      // contact, about, the policies are ordinary "page" rows — so nothing else
      // in this server can tell a site that has them from one that does not.
      // See ./inventory.ts: advice, matched by name, and the note says both.
      const missing = missingUsualPages(raw.pages ?? null);
      return text({
        ...(projectList(raw, 'pages', PAGE_FIELDS) as Record<string, unknown>),
        // EVERY TYPE THE PLATFORM HAS, and the address each one answers at.
        //
        // Here rather than in `sb_page_create`'s argument description, because
        // that string rides in `tools/list` and the token budget caps it — the
        // table put the payload over twice while being trimmed. It is also the
        // better home: an agent reads this while ORIENTING, before it has
        // decided what to build, and a type it has never heard of is exactly
        // what it cannot ask for. `sb_page_create` used to name six of twelve
        // from a hand-typed string, so search, account, blog, complete, error
        // and maintain were unreachable to anyone who only read the tool.
        page_types: Object.fromEntries(
          PAGE_TYPES.map((t) => [
            t.type,
            t.routePattern ??
              (t.servedRole ? `served as the site's ${t.servedRole}` : 'an address you choose'),
          ]),
        ),
        // NOT A LIST OF THE PAGES A SITE NEEDS, and this line is here because
        // the table above reads like one. A type is a fixed ADDRESS the
        // storefront routes by; most of a real website has no type at all —
        // login, register, contact, about, the policies, and whatever else this
        // particular shop sells or must say — and every one of those is an
        // ordinary `page`. Twelve is the number of routed types, never the
        // number of pages.
        page_types_note:
          'Types are the storefront\'s fixed addresses, not an inventory of a site. Everything ' +
          'else — login, register, contact, about, policies, and anything this shop needs — is ' +
          'type "page" with an address you choose, and there is no limit to how many. ' +
          'usually_also below lists the ones most sites have; it is a floor, not a ceiling.',
        ...(missing.length
          ? {
              usually_also: Object.fromEntries(missing.map((m) => [m.key, m.why])),
              usually_also_note:
                'Pages most sites have that this one appears not to, found by NAME because they ' +
                'have no type — one you named unusually will show here anyway. Advice, not ' +
                'defects: sb_review reports the pages the storefront routes by type.',
            }
          : {}),
      });
    },
  );

  server.registerTool(
    'sb_page_create',
    {
      description:
        `A store type (${seededTypes().join(', ')}) arrives with the document the editor ` +
          'gives a merchant — product carries the whole bound buy box; seed:false for blank. ' +
          'Any other type is empty and sb_page_open seeds its ROOT. TYPE is the route: ' +
          '/checkout and /products/{slug} need a PUBLISHED page of that type or they 404.',
      inputSchema: {
      site_id: z.string().optional(),
      name: z.string(),
      type: z
        .string()
        .optional()
        .describe('page (default); sb_page_list lists every type and where each is served'),
      slug: z.string().optional(),
      is_homepage: z.boolean().optional(),
      settings: z.record(z.unknown()).optional(),
      seed: z.boolean().optional().describe('Default true; false creates a blank page.'),
      chrome: z.boolean().optional().describe("Carry the site's header and footer, default true"),
      locale: z.string().optional().describe("vi (default) or en — the complete page's wording."),
      headline: z.string().optional().describe("The complete page's thank-you line."),
      dry_run: z.boolean().optional(),
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ site_id: given, name, type, slug, is_homepage, settings, seed, chrome, locale, headline, dry_run }) => {
      const site_id = siteFor(ctx, given);
      const path = `/api/sites/${encodeURIComponent(site_id)}/pages`;
      // The platform stores this verbatim and renders it as text — see plainText.
      name = plainText(name);
      // TYPE IS THE ROUTE for several kinds of page: /checkout and
      // /products/{slug} resolve to the site's PUBLISHED page of that type and
      // fall through to a 404 when there is none. Without this argument the
      // agent could build a shop it could never let anyone buy from, which is
      // exactly the gap sb_review's store_gaps now reports.
      const body = {
        name,
        ...(type ? { type } : {}),
        ...(slug ? { slug } : {}),
        ...(is_homepage !== undefined ? { isHomepage: is_homepage } : {}),
        ...(settings ? { settings } : {}),
      };
      // `settings` is the one free-form object a caller hands this server, so the
      // preview and the echo both go through redact — everything else on this
      // path is built from narrow arguments.
      // WHAT THIS PAGE WILL OPEN WITH. Reported in the dry run too: "it arrives
      // empty" was this tool's own description for as long as the editor has
      // been seeding, so a caller planning a build needs to know before it
      // commits whether it is about to hand-assemble a buy box that already
      // exists.
      // AN ORDINARY PAGE OPENS AS SOMETHING TOO, decided from its NAME.
      //
      // `hasSeed` is keyed by page TYPE, and every content page is type "page",
      // so About, a policy and an FAQ all arrived blank — and were then
      // hand-assembled out of the same three primitives, which is why they all
      // came out looking the same.
      //
      // The name is the signal because it is the only one there is, and reusing
      // the keyword table that already decides a page is MISSING is what stops
      // the two answers drifting apart: a name sb_page_list reads as "the about
      // page" is the name that gets the about layout. `seed:false` opts out, as
      // it always has.
      const layout = seed !== false ? layoutForPageName(name, type) : undefined;
      const willSeed = seed !== false && hasSeed(type);
      const summary = willSeed && type ? seedSummary(type) : null;
      // WHAT MAKES THE NEW PAGE PART OF THE SITE.
      //
      // A page created through the editor carries the site's header and footer;
      // one created here carried NEITHER, so an agent building a site produced
      // pages with no navigation and no footer on a site that has both — and
      // nothing reported it, because `sb_review` reads the page and the page is
      // fine, while `siteChrome` asks whether the SITE has globals and it does.
      // Measured: three pages built with these tools, every one of them bare,
      // beside a store page carrying its header as ROOT's first child.
      // A SITE HAS ONE HOME PAGE, AND BY THE TIME AN AGENT ASKS FOR ONE IT
      // USUALLY EXISTS ALREADY.
      //
      // `isHomepage: true` does not mean "make this the home page" to the
      // platform. It means MOVE THE STAR: CreatePage demotes whoever holds it
      // and promotes this one. An agent building a store reads the flag the
      // first way and asks for it on a site the editor already gave a home page
      // to, so the site ends up with two — the new one on "/", the old one
      // demoted and holding nothing. Measured on a real store: pg_439cb121
      // "Home" and pg_237719d4 "Trang chủ", both slug "", both path "/", the
      // first reachable at no address at all and still listed as a page.
      //
      // So the flag is honoured as what the caller meant — the site's home page
      // — which is the one it already has. Adopted, renamed when the caller
      // named it something else, never duplicated. The same rule sb_import_site
      // already follows when its entry page lands on a site with a home page.
      //
      // REPLACING the home page with a DIFFERENT page stays possible and stays
      // explicit: create it without the flag, build it, then PATCH isHomepage
      // through sb_api_call. That is a decision, and it should read like one.
      const adopt = is_homepage === true ? await existingHomepage(ctx, site_id) : null;
      const rename = adopt && name.trim() !== '' && name !== adopt.name ? name : '';
      // Read AFTER the adopt decision and skipped when it holds: siteChrome
      // reads the header and footer off the home page, so asking it which
      // chrome to dress the home page in is two requests to answer "its own".
      const wear = chrome !== false && !adopt ? await siteChrome(ctx, site_id) : {};
      if (adopt && dry_run !== false) {
        return text({
          dry_run: true,
          into: 'the existing home page',
          page: adopt,
          ...(rename ? { would_rename: { from: adopt.name, to: rename } } : {}),
          note:
            'Nothing would be created. This site already has a home page and a site has ' +
            'exactly one, so a create carrying isHomepage would have taken the star off ' +
            `${JSON.stringify(adopt.name)} and left it with no address. Open ${adopt.id} ` +
            'with sb_page_open and build it.',
        });
      }
      if (adopt) {
        // THE RENAME IS THE ONLY WRITE. Not the seed — this page may already be
        // the site's front door, and overwriting a document nobody asked to
        // replace is the one thing worse than the duplicate this branch exists
        // to prevent. Not the chrome either: siteChrome reads the header and
        // footer OFF the home page, so this page is where they came from.
        let renamed_to: string | undefined;
        let rename_failed: string | undefined;
        if (rename) {
          try {
            await request({
              base: ctx.base,
              method: 'PATCH',
              path: `${path}/${encodeURIComponent(adopt.id)}`,
              token: siteToken(ctx),
              body: { name: rename },
              fetchImpl: ctx.fetchImpl,
            });
            renamed_to = rename;
          } catch (e) {
            // The page is still the right one to build on, so a failed rename
            // is reported, never raised — the caller asked for a home page and
            // this is it, under its old name.
            rename_failed = (e as Error).message.replace(/^sbuilder:\s*/, '').slice(0, 160);
          }
        }
        return text({
          into: 'the existing home page',
          page: { id: adopt.id, name: renamed_to ?? adopt.name },
          ...(renamed_to ? { renamed: { from: adopt.name, to: renamed_to } } : {}),
          ...(rename_failed ? { rename_failed } : {}),
          ...(slug ? { slug_ignored: 'A home page is served at "/" and carries no slug.' } : {}),
          ...(type && type !== 'page' ? { type_ignored: `Kept as it is; adopting does not retype a page to "${type}".` } : {}),
          note:
            'Nothing was created. This site already had a home page and a site has exactly ' +
            'one, so creating another would have taken the star off this page and left it ' +
            `with no address. Open ${adopt.id} with sb_page_open and build it. To hand the ` +
            'home page over to a DIFFERENT page instead, create that page WITHOUT ' +
            'is_homepage and then PATCH isHomepage on it through sb_api_call.',
        });
      }

      if (dry_run !== false) {
        return text({
          dry_run: true,
          would_post: path,
          body: redact(body),
          ...(summary ? { would_seed: { type, ...summary } } : {}),
          ...(layout ? { would_open_as: layout } : {}),
          ...(wear.header || wear.footer
            ? { would_wear: { ...(wear.header ? { header: wear.header } : {}), ...(wear.footer ? { footer: wear.footer } : {}) } }
            : {}),
        });
      }
      const res = redact(
        await request({
          base: ctx.base,
          method: 'POST',
          path,
          token: siteToken(ctx),
          body,
          fetchImpl: ctx.fetchImpl,
        }),
      ) as { page?: Record<string, unknown> };
      // A COLLIDING SLUG IS RENAMED, NOT REFUSED. `uniqueSlug` suffixes -1, -2 …
      // and its own comment says it "never errors"
      // (server/internal/page/service.go:877). ErrSlugConflict exists and maps to
      // 409; this path never reaches it. So the create answers 200 carrying a
      // DIFFERENT slug than the one asked for, and every link the caller then
      // authors to the slug it requested is dead.
      const got = res.page?.slug;
      const renamed = slug && typeof got === 'string' && got !== slug;

      // THE SEED IS A SECOND WRITE, and it must not turn a created page into a
      // failed call. The page EXISTS the moment the POST answered; a refused
      // source PUT leaves it blank, which is exactly what the caller had before
      // and can fix with one sb_page_open. Reporting the failure beats
      // unwinding a page the caller asked for.
      let seeded: Record<string, unknown> | null = null;
      const newId = res.page?.id;
      if ((willSeed || layout) && typeof newId === 'string' && newId) {
        const document = layout ? layoutDocument(layout) : seedDocument(type ?? '', { locale, headline });
        if (document) {
          try {
            await request({
              base: ctx.base,
              method: 'PUT',
              // `{ document, schemaVersion }`, never `{ document }` — the shape
              // the editor's own saveSource sends.
              path: `/api/sites/${encodeURIComponent(site_id)}/pages/${encodeURIComponent(newId)}/source`,
              token: siteToken(ctx),
              body: { document, schemaVersion: document.schema_version },
              fetchImpl: ctx.fetchImpl,
            });
            await ensureSiteTheme(ctx, site_id);
            seeded = layout
              ? { layout, nodes: Object.keys(document.nodes).length }
              : { type, nodes: Object.keys(document.nodes).length };
          } catch (e) {
            seeded = {
              failed: e instanceof Error ? e.message : String(e),
              note:
                'The page was created and is BLANK. Nothing was lost — open it with ' +
                'sb_page_open and build it, or create it again.',
            };
          }
        }
      }

      // THE REFERENCE SHAPE IS THE PLATFORM'S OWN (decompose.go:382): a
      // flex-section carrying `globalRef` + `globalKind`. Header FIRST and
      // footer LAST, because compose turns them into real bands and ROOT's
      // children must read header, middle, footer or every save is refused.
      let wearing: Record<string, unknown> | undefined;
      if ((wear.header || wear.footer) && typeof newId === 'string' && newId) {
        try {
          await session.open(site_id, newId);
          const doc = session.current();
          const patches: Patch[] = [];
          const ids: string[] = [];
          if (wear.header) {
            const made = addSubtree(doc, doc.doc.root_node_id, {
              type: 'flex-section',
              specials: { globalRef: wear.header, globalKind: 'header' },
            }, 0);
            doc.apply(made.patches);
            ids.push('header');
          }
          if (wear.footer) {
            const made = addSubtree(doc, doc.doc.root_node_id, {
              type: 'flex-section',
              specials: { globalRef: wear.footer, globalKind: 'footer' },
            });
            doc.apply(made.patches);
            ids.push('footer');
          }
          void patches;
          await session.save();
          // AND ONCE MORE, because the platform records the edge off the
          // COMPOSED stamp and this save wrote the REFERENCE. Without it every
          // page created here wears the site's chrome and none of them is
          // counted as doing so — which is the list the delete dialog reads.
          // See `PageSession.recompose`.
          await session.recompose();
          wearing = { carries: ids, open: newId };
        } catch (e) {
          wearing = {
            failed: (e as Error).message.replace(/^sbuilder:\s*/, '').slice(0, 160),
            note: 'The page exists. Attach the chrome by hand, or create it again.',
          };
        }
      }

      return text({
        ...res,
        ...(seeded ? { seeded } : {}),
        ...(wearing ? { chrome: wearing } : {}),
        ...(renamed
          ? {
              slug_renamed: `The slug "${slug}" was already taken, so the platform stored ` +
                `"${got}" instead and reported success. Link to "${got}", or free the name and ` +
                'create it again.',
            }
          : {}),
      });
    },
  );

  server.registerTool(
    'sb_publish',
    {
      description:
        'Compile the draft into the live page, and report which revision went live (id, ' +
          'publishedAt, fromVersionId). PUBLISH CASCADES: a page sharing a global section with ' +
          'others republishes them too, because a header edited once must not go live on one ' +
          'page and stay stale on the rest. verify:true then fetches the live page and says ' +
          'whether the origin is serving that revision yet — the storefront caches for 60s, so ' +
          'a reload showing the old page is that, not a failed publish.',
      inputSchema: {
        site_id: z.string().optional(),
        page_id: z.string(),
        dry_run: z.boolean().optional(),
        verify: z
          .boolean()
          .optional()
          .describe('Fetch the live page afterwards and report whether it serves this revision'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ site_id: given, page_id, dry_run, verify }) => {
      const site_id = siteFor(ctx, given);
      // PUBLISH IS A SITE-LEVEL CALL that NAMES pages, not a page-level route.
      // This used to POST /pages/{id}/publish, which the platform answers 404 —
      // it mounts "publish" as its own resource beside "pages"
      // (server/internal/page/rest/rest.go), taking {"pageIds": [...]}. An empty
      // list means the whole site, so the id is always sent: publishing one page
      // must never become publishing every page by accident.
      const path = `/api/sites/${encodeURIComponent(site_id)}/publish`;
      const body = { pageIds: [page_id] };
      if (dry_run !== false) return text({ dry_run: true, would_post: path, body });
      const res = (await request({
        base: ctx.base,
        method: 'POST',
        path,
        token: siteToken(ctx),
        body,
        fetchImpl: ctx.fetchImpl,
      })) as { published?: Array<Record<string, unknown>>; total?: number };
      // A PUBLISHED ROW CARRIES THE WHOLE RENDERED PAGE — document, html and css
      // — and publish CASCADES, so returning the response as it arrives pours
      // every republished page's markup into the reader. Kept: what identifies
      // the row and what a caller would act on.
      // WHAT IDENTIFIES THE LIVE REVISION, which the projection used to throw
      // away along with the markup.
      //
      // `document`, `html` and `css` are dropped for the reason they always
      // were — publish CASCADES, so returning them pours every republished
      // page's markup into the reader. But `id`, `publishedAt` and
      // `fromVersionId` are the three fields that ANSWER "which revision is
      // live", which is the question a caller has immediately after publishing
      // and had no way to ask: `id` is the published row, `fromVersionId` the
      // draft version it was compiled from, and `publishedAt` the moment. They
      // cost one line each and they are the whole point of the response.
      const published = (res.published ?? []).map((p) => ({
        pageId: p.pageId,
        ...(p.slug !== undefined ? { slug: p.slug } : {}),
        ...(p.isHomepage ? { isHomepage: true } : {}),
        ...(p.id !== undefined ? { id: p.id } : {}),
        ...(p.publishedAt !== undefined ? { publishedAt: p.publishedAt } : {}),
        ...(p.fromVersionId ? { fromVersionId: p.fromVersionId } : {}),
      }));
      // PUBLISH SKIPS A PAGE WITH NO SAVED DRAFT and still answers 200 with
      // whatever did publish (`server/internal/page/service.go:650`, a bare
      // `continue`). sb_page_create followed by sb_publish does exactly that:
      // the call succeeds, the page never flips to published, and the URL 404s.
      const landed = published.some((p) => p.pageId === page_id);
      // A 200 PROVES A ROW WAS STORED, NOT THAT A VISITOR IS BEING SERVED IT.
      // The storefront answers `cache-control: public, max-age=60`, so the two
      // legitimately differ for up to a minute — long enough for a caller to
      // reload, see the old page, and go looking for a bug that is not there.
      // Opt-in because it costs a preview mint and a page fetch, and because
      // most publishes are followed by more work rather than by a look.
      let live: LiveProof | undefined;
      if (verify) {
        const row = (res.published ?? []).find((p) => p.pageId === page_id);
        const ids = bandIds((row as { document?: unknown } | undefined)?.document);
        try {
          // The storefront ORIGIN, taken from the page's own preview link
          // rather than guessed: a site may have a custom domain, and this is
          // the one place the platform states where its pages are served from.
          const origin = new URL(await previewUrl(ctx, site_id, page_id)).origin;
          const slug = typeof row?.slug === 'string' ? row.slug : '';
          const path = row?.isHomepage || slug === '' ? '/' : `/${slug}`;
          live = await proveLive(origin + path, ids, ctx.fetchImpl ?? fetch);
        } catch (e) {
          live = {
            url: '',
            status: 0,
            serving: false,
            checked: ids.length,
            note:
              `The live address could not be resolved (${(e as Error).message}). The publish ` +
              'succeeded; only this check did not run.',
          };
        }
      }
      return text({
        published,
        ...(live ? { live } : {}),
        ...(published.length !== (res.total ?? published.length) ? { total: res.total } : {}),
        ...(landed
          ? {}
          : {
              not_published: `Page ${page_id} has no saved draft, so the platform published ` +
                'nothing for it and reported success anyway. Open it with sb_page_open, save an ' +
                'edit, then publish again.',
            }),
      });
    },
  );

  server.registerTool(
    'sb_page_state',
    {
      description:
        'Which of this page\'s three copies is which: the DRAFT the editor canvas shows, the ' +
        'PUBLISHED row the storefront serves, and what this session holds. Says whether the ' +
        'editor will render the canvas BLANK (its hydrate gate discards a document whose root ' +
        'is missing and shows an empty ROOT, silently — the Go renderer has no such gate, ' +
        'which is how "the live page has data but the canvas is empty" happens), whether the ' +
        'draft has changes the live page does not, and where the recovery points are.',
      inputSchema: {
        site_id: z.string().optional(),
        page_id: z.string().optional().describe('Defaults to the open page'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ site_id: given, page_id }) => {
      const site_id = siteFor(ctx, given);
      const here = session.location();
      const pageId = page_id ?? here.pageId;
      if (!pageId) {
        throw new Error('sbuilder: sb_page_state needs page_id, or a page opened with sb_page_open.');
      }
      // THE RAW SOURCE, not `session.current()`. `PageDoc.from` repairs a root
      // alias in memory; the editor reads the STORED bytes, so a report about
      // what the editor will do has to read them too.
      const src = await loadSource(ctx, site_id, pageId);
      const canvas = canvasVerdict(src.document);

      // The live row. Listed rather than fetched per page because the platform
      // offers no per-page published read, and the list is already projected.
      const live = (await request({
        base: ctx.base,
        method: 'GET',
        path: `/api/sites/${encodeURIComponent(site_id)}/published`,
        token: siteToken(ctx),
        fetchImpl: ctx.fetchImpl,
      })) as { published?: Array<Record<string, unknown>> };
      const row = (live.published ?? []).find((p) => p.pageId === pageId);
      const publishedNodes = Object.keys(
        ((row?.document as { nodes?: Record<string, unknown> } | undefined)?.nodes ?? {}),
      ).length;

      const drift = driftOf(src.updatedAt, row?.publishedAt as string | undefined);

      // Projected to id + label + when, never the documents: one version of a
      // two-node page measured 1,690 bytes over the wire, so a realistic page
      // is ~70 KB per version and a listing of twenty is 1.4 MB in one answer.
      // The same projection `sb_api_call` applies to these two operations.
      const points = async (
        kind: 'versions' | 'history',
      ): Promise<Array<Record<string, unknown>>> => {
        try {
          const got = (await request({
            base: ctx.base,
            method: 'GET',
            path: `/api/sites/${encodeURIComponent(site_id)}/pages/${encodeURIComponent(pageId)}/${kind}`,
            token: siteToken(ctx),
            fetchImpl: ctx.fetchImpl,
          })) as Record<string, unknown>;
          const rows = (got[kind] ?? []) as Array<Record<string, unknown>>;
          return rows.slice(0, 5).map((r) => ({
            id: r.id,
            ...(r.versionNo !== undefined ? { versionNo: r.versionNo } : {}),
            ...(r.label ? { label: r.label } : {}),
            ...(r.isLive ? { isLive: true } : {}),
            createdAt: r.createdAt,
          }));
        } catch {
          // A recovery list that cannot be read must not fail a report whose
          // whole purpose is to be readable when something is already wrong.
          return [];
        }
      };
      const [versions, history] = await Promise.all([points('versions'), points('history')]);
      const recovery = {
        versions,
        history,
        note:
          'The platform appends an autosave checkpoint on EVERY draft save and mints a ' +
          'labelled snapshot on demand, and both outlive this process — so a checkpoint ' +
          'before a whole-document PUT is already taken. Restore with sb_api_call ' +
          '"post:/api/sites/{siteId}/pages/{pageId}/versions/{versionId}/restore" or the ' +
          'history twin. A RESTORE CHANGES THE DRAFT ONLY: publish afterwards, or the ' +
          'storefront keeps serving the page you just rolled back from. The platform writes ' +
          'a __pre_restore version of its own first, so a restore is itself undoable.',
      };
      const open = here.pageId === pageId && here.siteId === site_id;
      return text({
        page: pageId,
        draft: {
          updatedAt: src.updatedAt,
          schemaVersion: src.schemaVersion,
          nodes: canvas.nodes,
          ...(src.warnings?.length ? { compose_warnings: src.warnings.length } : {}),
        },
        published: row
          ? {
              id: row.id,
              publishedAt: row.publishedAt,
              fromVersionId: row.fromVersionId,
              nodes: publishedNodes,
            }
          : null,
        canvas: canvas.blank
          ? { blank: true, nodes: canvas.nodes, why: canvas.why, fix: canvas.fix }
          : { blank: false, nodes: canvas.nodes },
        drift,
        session: open
          ? { open: true, rev: session.current().rev, unsaved: session.hasUnsaved() }
          : { open: false },
        // THE EDITOR DOES NOT RE-READ A PAGE IT ALREADY HAS OPEN. A save from
        // here lands on the server and the canvas keeps showing the copy it
        // loaded — which reads as "my edit did nothing" and is the single most
        // common way a session and a person disagree about a page. Nothing
        // here can see the editor, so the honest form is the timestamp and
        // what to do with it.
        editor_note:
          `An editor tab that opened this page before ${src.updatedAt} is holding an older ` +
          'copy: the editor loads the draft once and does not re-read it, so a save made here ' +
          'is invisible there until the tab is reloaded — and that tab\'s next save would ' +
          'store its older copy over this one. Reload the editor before editing there.',
        // THE CHECKPOINT BEFORE A PUT ALREADY EXISTS, and that is worth
        // stating rather than re-implementing: `saveDraftRaw` appends an
        // autosave checkpoint on EVERY draft save, bounded by the service's
        // own keep count, and `SaveVersion` mints a labelled snapshot beside
        // it. What was missing was anyone SAYING so — this repo recorded for
        // three phases that a wrecked draft was unrecoverable, which was true
        // of the OpenAPI document and false of the platform.
        //
        // Listed rather than described, because "there is a way back" is not
        // a way back: a caller in trouble needs the id to restore.
        recovery,
      });
    },
  );

  return session;
}
