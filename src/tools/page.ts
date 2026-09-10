import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { composeWarnings, type ComposeWarning } from '../domains/site/findings.js';
import { text } from '../mcp/response.js';
import { loadSource, saveSource } from '../transport/pages.js';
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
import { hasSeed, seedDocument, seedSummary, seededTypes } from '../domains/site/storepage.js';
import { unknownValueNote } from '../domains/site/vocabulary.js';
import { skinLevelNote } from '../domains/site/fieldskin.js';
import { siteTheme } from '../domains/site/theme-fetch.js';
import { request, redact } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { validateForSave } from '../domains/site/validate.js';
import { reviewDesign, REVIEW_NOTICE } from '../domains/site/review.js';
import { compactFindings } from '../domains/site/findings.js';
import { readinessGaps, READINESS_NOTICE } from '../domains/site/readiness.js';
import { gatherReadiness } from '../domains/site/readiness-fetch.js';
import { globalWarning, restampPatches, RESPONSIVE_NOTICE } from '../domains/site/traps.js';
import { catalogMatches, traitsFor } from '../catalog/element-search.js';
import {
  LAYOUT_PATTERNS,
  PATTERN_BY_ID,
  THEME_TOKENS,
  type MediaPick,
} from '../domains/site/patterns.js';
import { tokensFromPage } from '../domains/site/importmap.js';
import { middleEnd } from '../domains/site/traps.js';
import { applyPatches, type Patch } from '../core/patch.js';
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
  private warnings: ComposeWarning[] = [];
  private boxes: Box[] = [];

  constructor(private readonly ctx: ToolContext) {}

  attachLive(live: LiveSession): void {
    this.live = live;
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
    const before = new Set(validateForSave(d));
    const introduced = validateForSave(d.preview(patches)).filter((p) => !before.has(p));
    if (introduced.length > 0) {
      throw new Error(`sbuilder: refusing to save — ${introduced.join(' ')}`);
    }
    this.applyAndPublish(patches);
    await this.save();
  }

  applyRemote(patches: Patch[]): void {
    this.doc?.apply(patches);
  }

  /** The yield rule's local half: the next save re-pulls instead of overwriting. */
  markStale(reason: string): void {
    this.stale = reason;
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
    return this.doc.outline();
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
  async save(): Promise<void> {
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
    const problems = validateForSave(d);
    if (problems.length > 0) {
      throw new Error(`sbuilder: refusing to save — ${problems.join(' ')}`);
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
      const doc = session.current();
      // A page whose stored document named its root under the app-block key
      // renders as an empty <body> and says nothing about why. Nobody else can
      // see this, so it is reported on open rather than left for the screenshot.
      const blank_page_repair = doc.adoptedRootKey
        ? `This page's document names its root as "${doc.adoptedRootKey}", not "root_node_id", so ` +
          'the renderer finds no root and publishes an EMPTY BODY. The next save from here writes ' +
          'the canonical key and fixes it; publish afterwards.'
        : undefined;
      const warnings = session.composeWarnings();
      return text({
        outline,
        ...(blank_page_repair ? { blank_page_repair } : {}),
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
        'Find an element type by what you want it to do. Four fields per match; pass detail:true ' +
          "for the platform's AI hints, or read them with sb_traits_for once you have chosen.",
      inputSchema: {
      query: z.string(),
      limit: z.number().int().min(1).max(30).optional().describe('Default 8'),
      detail: z.boolean().optional().describe('Include useWhen / avoidWhen / contentTips per match'),
    },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit, detail }) => text(catalogMatches(query, { limit, detail })),
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
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ parent_id, spec, index, dry_run }) => {
      const d = session.current();
      const { patches, ids } = addSubtree(d, parent_id, spec, index);
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
        });
      }
      await session.applyAndSave(patches);
      return text({ added: ids, rev: d.rev, ...(inert ? { inert } : {}) });
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
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, namespace, keys, breakpoint, base, state, unset, edits, dry_run }) => {
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
      const { patches, touched } = setMany(d, batch);
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
        if (e.namespace !== 'config') continue;
        for (const [k, v] of Object.entries(e.keys)) {
          const n = unknownValueNote(k, v);
          if (!n) continue;
          const once = ctx.notices.once(`config-value:${k}=${String(v)}`, n);
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
    },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, parent_id, index, dry_run }) => {
      const d = session.current();
      const patches = moveNode(d, id, parent_id, index);
      if (dry_run !== false) return text({ dry_run: true, patches });
      await session.applyAndSave(patches);
      return text({ moved: id, rev: d.rev });
    },
  );

  server.registerTool(
    'sb_remove',
    {
      description:
        'Remove a node and its whole subtree.',
      inputSchema: { id: z.string(), dry_run: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id, dry_run }) => {
      const d = session.current();
      const patches = removeNode(d, id);
      if (dry_run !== false) return text({ dry_run: true, removing: patches.length });
      await session.applyAndSave(patches);
      return text({ removed: id, rev: d.rev });
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
      inputSchema: { id: z.string(), dry_run: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ id, dry_run }) => {
      const d = session.current();
      const { patches, ids } = duplicateNode(d, id);
      if (dry_run !== false) return text({ dry_run: true, would_copy: ids.length });
      await session.applyAndSave(patches);
      return text({ duplicated: id, into: ids[0], nodes: ids.length, rev: d.rev });
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
          ...(pool.length === 0
            ? {
                images:
                  'This site has no images in its library, so any picture slot in this band says ' +
                  'so in words rather than showing a grey box. sb_media_upload takes a URL and ' +
                  'the platform fetches it server-side.',
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
    async ({ site_id: given }) =>
      text(
        projectList(
          await request({
          base: ctx.base,
          method: 'GET',
          path: `/api/sites/${encodeURIComponent(siteFor(ctx, given))}/pages`,
          token: siteToken(ctx),
          fetchImpl: ctx.fetchImpl,
        }),
          'pages',
          PAGE_FIELDS,
        ),
      ),
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
      type: z.string().optional().describe('page (default), checkout, product, category, post, course'),
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
      const wear = chrome !== false ? await siteChrome(ctx, site_id) : {};
      if (dry_run !== false) {
        return text({
          dry_run: true,
          would_post: path,
          body: redact(body),
          ...(summary ? { would_seed: { type, ...summary } } : {}),
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
      if (willSeed && type && typeof newId === 'string' && newId) {
        const document = seedDocument(type, { locale, headline });
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
            seeded = { type, nodes: Object.keys(document.nodes).length };
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
        'Compile the draft into the live page. PUBLISH CASCADES: a page sharing a global ' +
          'section with others republishes them too, because a header edited once must not go ' +
          'live on one page and stay stale on the rest.',
      inputSchema: { site_id: z.string().optional(), page_id: z.string(), dry_run: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ site_id: given, page_id, dry_run }) => {
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
      const published = (res.published ?? []).map((p) => ({
        pageId: p.pageId,
        ...(p.slug !== undefined ? { slug: p.slug } : {}),
        ...(p.isHomepage ? { isHomepage: true } : {}),
      }));
      // PUBLISH SKIPS A PAGE WITH NO SAVED DRAFT and still answers 200 with
      // whatever did publish (`server/internal/page/service.go:650`, a bare
      // `continue`). sb_page_create followed by sb_publish does exactly that:
      // the call succeeds, the page never flips to published, and the URL 404s.
      const landed = published.some((p) => p.pageId === page_id);
      return text({
        published,
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

  return session;
}
