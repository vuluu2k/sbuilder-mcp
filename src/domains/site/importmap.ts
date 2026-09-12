import type { NodeSpec } from './builder.js';
import type { DocLike, NodeLike } from '../../core/tree.js';
import { walk } from '../../core/tree.js';
import { stickySeeds } from './sticky.js';
import { TEXT_STYLE_KEYS } from '../../catalog/elements.generated.js';
import { normalizeUrl } from './discover.js';
import { ICON_NAMES } from '../../catalog/icons.generated.js';

/**
 * What the SOURCE painted, as computed values — raw observations, not decisions.
 *
 * Read so the extractor in `sourcetokens.ts` can recover the page's design
 * system. `toSpecs` deliberately ignores every one of these: a colour stamped
 * onto a node OUTRANKS the theme preset beneath it permanently, which is the
 * detachment `THEME_VERSION` 6 was bumped to fix. What the source painted
 * becomes theme TOKENS, and the nodes follow the theme.
 */
export interface StyleSample {
  color?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  borderRadius?: string;
  padding?: string;
  gap?: string;
}

/**
 * A page read off SOMEBODY ELSE'S SITE, reduced to the six things this platform
 * can actually render.
 *
 * Deliberately NOT a DOM: the browser hands back arbitrary markup and this
 * platform renders a fixed catalog of 108 elements, so the translation has to
 * happen somewhere. Doing it in the page (see `vision/capture.ts`) keeps the
 * data that crosses the boundary small and keeps THIS file pure, which is the
 * half worth testing — a mapper with no browser in it can be tested offline,
 * and the extraction rules can then be argued about separately from the
 * element choices.
 */
export interface Captured {
  kind:
    | 'section'
    | 'group'
    | 'heading'
    | 'text'
    | 'image'
    | 'button'
    | 'list'
    /** A `<video>` with a file behind it — `src`, and `poster` when the page gave one. */
    | 'video'
    /** A provider this platform has an element for: youtube, vimeo, soundcloud, map. */
    | 'embed'
    /** An `<hr>`. One node, and a design decision. */
    | 'divider'
    /** An `<svg>` this platform may have an icon for. `name` is a CANDIDATE, not a verdict. */
    | 'icon'
    /** One or more consecutive `<details>`, which is what this platform's accordion is. */
    | 'accordion'
    /** One `<details>`: `text` is its `<summary>`, `children` the body. */
    | 'accordion-item'
    /**
     * A set of panels with a button row, which is what this platform's `tab` is.
     *
     * Produced ONLY when every panel's label could be READ off the page —
     * `tab` synthesizes its whole button row from each child's
     * `specials.label`, so a tab without them is a stack of panels wearing a
     * control nobody can use.
     */
    | 'tab'
    /** One panel: `text` is its button's label, `children` the panel body. */
    | 'tab-item';
  /** For a group: the arrangement the source actually used. */
  direction?: 'row' | 'column';
  wrap?: boolean;
  /**
   * How a row lines its columns up on the cross axis.
   *
   * `flex-start` is the right default for a row of equal-weight columns — three
   * feature blurbs of different lengths should share a top edge. It is the
   * WRONG default for a row of unequal ones: MEASURED on a hero built by these
   * tools, a 154px text column sat beside a 420px photograph with 266px of dead
   * space under it, because the row top-aligned them both.
   */
  align?: 'start' | 'center' | 'end' | 'stretch';
  /**
   * How the WORDS line up inside a heading, a paragraph or a button label.
   *
   * It has to be written on the NODE, and inheritance is why. A centred band
   * sets `textAlign: center` on its section, which every descendant would
   * inherit — except `heading-default` declares `textAlign: left` in the theme
   * preset, and a class rule beats an inherited value. MEASURED on a centred
   * call-to-action band: the heading and the sentence sat hard left at x=120
   * while the button, being `width: fit-content` under `alignItems: center`,
   * sat in the middle. One band, two alignments, and nothing reported it.
   *
   * Carried off the SOURCE on an import for the same reason `align` and
   * `pinned` are: a hero that centres its copy is making a decision, and a copy
   * that left-aligns it is not the same band.
   */
  textAlign?: 'left' | 'center' | 'right';
  /** Computed values read off the source node — see `StyleSample`. */
  sample?: StyleSample;
  /**
   * For an image: the frame it should fill, as a CSS `aspect-ratio`.
   *
   * Rule 6 says match a frame's ratio to the ASSET, and warns what happens when
   * you do not — `4 / 5` over 900x1100 artwork cropped the garment out of its
   * own product photo. A WALL of photographs is the case that rule does not
   * cover: there is no single asset, and leaving every tile its own shape gives
   * a grid whose rows are different heights, which reads as unfinished.
   *
   * So the ratio is not invented, it is MEASURED — the median of the pictures
   * actually being shown, so most of them crop by nothing and the outliers
   * crop least. Absent means what it has always meant: the image keeps its own
   * shape.
   */
  ratio?: string;
  /**
   * For a row: its columns take their CONTENT width instead of an equal share.
   *
   * The two are different shapes and the difference is visible. A feature trio
   * wants equal columns; a NAV wants its links packed against each other with a
   * gap. Measured on a shared header built from three pages: the links landed at
   * x=120, x=428 and x=735, each in its own third of a 1200px row, because the
   * row mapping had one answer and it was the content answer.
   */
  pack?: boolean;
  /** For a button: whether the source painted it as a call to action, or it is prose's link. */
  variant?: 'cta' | 'link';
  /** For an embed: which of the platform's own media elements renders it. */
  provider?: 'youtube' | 'vimeo' | 'soundcloud' | 'map';
  /** For a youtube or vimeo embed: the id its element stores, never the whole URL. */
  videoId?: string;
  /** For a video: the still the page showed before playback. */
  poster?: string;
  /**
   * For an icon: the words the source page called it, before any lookup.
   *
   * Raw on purpose. The browser half knows what the page SAYS — a
   * `<use href="#ri-search-line">`, an `aria-label`, a `ri-search-line` class —
   * and this side owns the question of whether this platform has an icon by
   * that name. `ICON_NAMES` is the only answer to that, and it does not exist
   * inside the page.
   */
  name?: string;
  /** For a section the source kept in view while the page scrolled. */
  pinned?: 'sticky' | 'fixed';
  /** 1-6 for a heading, so `htmlTag` survives the trip. */
  level?: number;
  text?: string;
  src?: string;
  alt?: string;
  href?: string;
  items?: string[];
  children?: Captured[];
}

/**
 * The look of the page being imported INTO, lifted off what is already there.
 *
 * Rule 0 of the design skill, done literally: "read the page's pattern before
 * you add to it, and obey it". An imported section that answers the accent, the
 * ink and the radius differently does not read as a new section, it reads as a
 * different website — which is exactly what importing from elsewhere threatens
 * to produce.
 *
 * Every field is optional and every one falls back to the element's own
 * `meta.defaults`, because an EMPTY page is a legitimate import target and
 * inventing a palette for it would be the invention rule 0 exists to prevent.
 */
export interface PageTokens {
  headingColor?: string;
  headingWeight?: string;
  textColor?: string;
  textSize?: string;
  buttonBg?: string;
  buttonColor?: string;
  buttonRadius?: string;
  sectionPadding?: string;
  sectionMaxWidth?: string;
}

/** Style keys read off a node, ignoring anything unset. */
function styleOf(n: NodeLike | undefined): Record<string, unknown> {
  return ((n as unknown as { style?: Record<string, unknown> })?.style ?? {}) as Record<
    string,
    unknown
  >;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined;

/**
 * Read the target page's own tokens.
 *
 * FIRST OF EACH KIND, in document order, which is the same thing a person does
 * when they open a page and look at what a heading is. Nothing is averaged: an
 * average of two accents is a third colour that appears nowhere on the site.
 */
export function tokensFromPage(doc: DocLike): PageTokens {
  let heading: NodeLike | undefined;
  let text: NodeLike | undefined;
  let button: NodeLike | undefined;
  let section: NodeLike | undefined;
  let block: NodeLike | undefined;

  walk(doc, doc.root_node_id, (n) => {
    const t = n.data.type;
    if (!heading && t === 'heading') heading = n;
    else if (!text && t === 'text') text = n;
    // A TRANSPARENT button is a nav link, not the page's primary control, and
    // taking its "fill" would give every imported button no fill at all.
    else if (!button && t === 'button' && str(styleOf(n).backgroundColor) !== 'transparent') {
      button = n;
    } else if (!section && t === 'flex-section') section = n;
    else if (!block && t === 'flex-block') block = n;
  });

  const h = styleOf(heading);
  const p = styleOf(text);
  const b = styleOf(button);
  const s = styleOf(section);
  const bl = styleOf(block);
  return {
    ...(str(h.color) ? { headingColor: str(h.color) } : {}),
    ...(str(h.fontWeight) ? { headingWeight: str(h.fontWeight) } : {}),
    ...(str(p.color) ? { textColor: str(p.color) } : {}),
    ...(str(p.fontSize) ? { textSize: str(p.fontSize) } : {}),
    ...(str(b.backgroundColor) ? { buttonBg: str(b.backgroundColor) } : {}),
    ...(str(b.color) ? { buttonColor: str(b.color) } : {}),
    ...(str(b.borderRadius) ? { buttonRadius: str(b.borderRadius) } : {}),
    ...(str(s.padding) ? { sectionPadding: str(s.padding) } : {}),
    ...(str(bl.maxWidth) ? { sectionMaxWidth: str(bl.maxWidth) } : {}),
  };
}

/** A heading's tag, clamped to what HTML has. */
function headingTag(level: number | undefined): string {
  const n = Math.min(6, Math.max(1, Math.round(level ?? 2)));
  return `h${n}`;
}

/**
 * This platform's own spelling of an icon the source page named, or null.
 *
 * A LOOKUP, NOT A GUESS. `specials.name` is a PascalCase RemixIcon id and the
 * catalog holds 3,227 of them; a name outside that set renders nothing. So the
 * words the page used are normalised and TRIED — exactly, then as the `Line`
 * and `Fill` variants every icon in the set comes in — and anything that does
 * not land is skipped.
 *
 * Deliberately no last-word fallback. "Open main menu" resolving to `MenuLine`
 * would be right, and "Acme Store" resolving to `StoreLine` would put a shop
 * glyph where a wordmark was — a WRONG icon, which is worse than none, and
 * indistinguishable from a right one to everything downstream.
 */
function iconFor(raw: string): string | null {
  if (raw.length > 40) return null;
  const words = raw
    .replace(/^(?:ri|fa[srlbd]?|lucide|bi|feather|icon|icons|material|mdi|ion|hero)[-_]/i, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!words.length) return null;
  const base = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  for (const candidate of [base, `${base}Line`, `${base}Fill`]) {
    if (ICON_NAMES.has(candidate)) return candidate;
  }
  // A source that already writes the id lowercase — `ri-shopping-cart-line`
  // arrives as words, but `shoppingcartline` as one — cannot be split back, so
  // the exact form is all there is to try.
  return null;
}

/**
 * One captured node as the element that can render it.
 *
 * Returns null for anything with nothing to show — an image with no source, a
 * heading whose text was whitespace. Dropping it here rather than adding an
 * empty node is the difference between an imported page and an imported page
 * plus twenty findings from `sb_review`.
 */
/**
 * THE SITE'S OWN TYPE SCALE, worn by reference.
 *
 * The theme ships `heading-1` (48px) through `heading-6` (16px) and `text-1`..
 * `text-3`, and every page these tools built ignored all of it: the mapper
 * wrote `htmlTag` and nothing else, so a heading took the `heading-default`
 * preset, which pins `fontSize: 48px` FLAT. MEASURED on a real build — a
 * section title and the three item titles beneath it came out identical, on a
 * page whose document correctly said h2 and h3. "About four type sizes" is the
 * checklist item; the page had one.
 *
 * BY REFERENCE, NEVER BY LITERAL — `var(--wb-ts-<slug>-<prop>)` is what the
 * editor's own picker stamps. A literal `36px` would outrank the preset beneath
 * it permanently and stop the node following the theme, which is the detachment
 * this repo already records for imported icons.
 *
 * SIZE AND LINE HEIGHT ONLY, of the eight keys a style controls. Colour and
 * weight are already answered by the tokens read off the target page (rule 0),
 * and overwriting those here would make an imported band stop matching the page
 * it landed on — which is the one thing the token pass exists to prevent. The
 * editor supports exactly this partial state: the pick is recorded so the
 * picker shows it, and it can also show that the style has drifted.
 *
 * A theme with no such style leaves the var undefined, so every ref carries the
 * element's own former answer as its CSS fallback: a site on a slimmer theme
 * renders exactly as it did before this existed.
 */
function textScale(slug: string, fallback: Record<string, string>): {
  style: Record<string, string>;
  config: Record<string, string>;
} {
  const style: Record<string, string> = {};
  for (const [key, prop] of TEXT_STYLE_KEYS) {
    if (key !== 'fontSize' && key !== 'lineHeight') continue;
    const fb = fallback[key];
    style[key] = `var(--wb-ts-${slug}-${prop}${fb ? `, ${fb}` : ''})`;
  }
  return { style, config: { textGlobalStyle: slug } };
}

function one(c: Captured, t: PageTokens): NodeSpec | null {
  switch (c.kind) {
    case 'heading': {
      const text = c.text?.trim();
      if (!text) return null;
      // The level is already decided and already correct in the document; it
      // simply reached no CSS. heading-1..6 are the theme's own slugs.
      const scale = textScale(`heading-${Math.min(6, Math.max(1, c.level ?? 2))}`, {});
      return {
        type: 'heading',
        specials: { htmlTag: headingTag(c.level), text },
        config: scale.config,
        style: {
          margin: '0',
          ...scale.style,
          // ON THE NODE, never left to inheritance: the theme's heading preset
          // declares its own textAlign, and a class rule beats an inherited
          // value.
          ...(c.textAlign ? { textAlign: c.textAlign } : {}),
          ...(t.headingColor ? { color: t.headingColor } : {}),
          ...(t.headingWeight ? { fontWeight: t.headingWeight } : {}),
        },
      };
    }
    case 'text': {
      const text = c.text?.trim();
      if (!text) return null;
      return {
        type: 'text',
        specials: { htmlTag: 'p', text },
        style: {
          lineHeight: '1.7',
          ...(c.textAlign ? { textAlign: c.textAlign } : {}),
          ...(t.textColor ? { color: t.textColor } : {}),
          ...(t.textSize ? { fontSize: t.textSize } : {}),
        },
      };
    }
    case 'icon': {
      const name = c.name ? iconFor(c.name) : null;
      // NO NAME, NO NODE. An `icon` whose `specials.name` this platform does not
      // hold renders nothing, so the page carries an empty box where the source
      // had a glyph — worse than the `<svg>` being skipped, because nobody put
      // it there on purpose. The COLOUR is deliberately not set either: it lives
      // in the `icon-default` style preset, and a literal here would detach
      // every imported icon from the theme permanently.
      if (!name) return null;
      return { type: 'icon', specials: { name } };
    }
    case 'accordion': {
      const items = (c.children ?? [])
        .map((item) => one(item, t))
        .filter((n): n is NodeSpec => n !== null);
      if (!items.length) return null;
      return { type: 'accordion', children: items };
    }
    case 'accordion-item': {
      const label = c.text?.trim();
      const body = (c.children ?? [])
        .map((k) => one(k, t))
        .filter((n): n is NodeSpec => n !== null);
      if (!label && !body.length) return null;
      // The label is omitted rather than defaulted when the source had no
      // `<summary>`: `accordion-content` seeds its own, and inventing one here
      // would ship English copy into a store that is not in English.
      return {
        type: 'accordion-content',
        ...(label ? { specials: { label } } : {}),
        children: body,
      };
    }
    case 'tab': {
      const items = (c.children ?? [])
        .map((item) => one(item, t))
        .filter((n): n is NodeSpec => n !== null);
      // Two is the floor for a tab: one panel with a button over it is a
      // heading the visitor cannot dismiss.
      if (items.length < 2) return null;
      return { type: 'tab', children: items };
    }
    case 'tab-item': {
      const label = c.text?.trim();
      const body = (c.children ?? [])
        .map((k) => one(k, t))
        .filter((n): n is NodeSpec => n !== null);
      // NO LABEL, NO PANEL — and this is stricter than the accordion beside it
      // on purpose. `accordion-content` seeds its own summary, so an unlabelled
      // one still opens; `tab` builds its BUTTON ROW from these labels, so an
      // unlabelled panel is one the visitor has no way to reach.
      if (!label || !body.length) return null;
      return { type: 'tab-content', specials: { label }, children: body };
    }
    case 'divider': {
      return { type: 'divider', style: { width: '100%' } };
    }
    case 'video': {
      if (!c.src) return null;
      // NO STYLE OF OUR OWN. Every media element here already seeds
      // `width: 100%` + `height: fit-content` and `google-map` seeds a height
      // per breakpoint; writing a literal over that detaches the node from the
      // element's own responsive answer to be less correct than it.
      //
      // `videoRatio` is seeded 16 / 9, which is right for almost every file a
      // page embeds — and markup that does not state the real ratio is not
      // something to guess a crop from.
      return {
        type: 'video',
        specials: { videoSrc: c.src, ...(c.poster ? { poster: c.poster } : {}) },
      };
    }
    case 'embed': {
      // AN EMBED IS A PROVIDER, NOT A URL. `youtube` and `vimeo` store the ID
      // alone — handing them a whole watch URL renders nothing — while
      // `google-map` takes the embed URL its own hint asks for and `soundcloud`
      // takes a track URL under a different key again.
      if (c.provider === 'youtube' || c.provider === 'vimeo') {
        if (!c.videoId) return null;
        return { type: c.provider, specials: { videoId: c.videoId } };
      }
      if (!c.src) return null;
      if (c.provider === 'map') {
        return { type: 'google-map', specials: { src: c.src, mapType: 'location' } };
      }
      if (c.provider === 'soundcloud') {
        return { type: 'soundcloud', specials: { trackUrl: c.src } };
      }
      return null;
    }
    case 'image': {
      if (!c.src) return null;
      // `alt` is carried even when empty: an empty alt is a DECISION (decorative)
      // and dropping the key turns it back into an omission.
      //
      // AN IMPORTED IMAGE HAS NO KNOWN SIZE, so it needs a bound in BOTH axes.
      // `maxWidth: 100%` alone was not one: an SVG has no intrinsic pixel size,
      // so it took the container's full 1200px and about as much height again.
      // Measured on a real import — four such images turned one section into a
      // 5,564px column of mostly whitespace.
      //
      // `height: auto` for the same reason the platform's own media CSS needs it:
      // a width/height ATTRIBUTE is a used height, and without this the cap below
      // would be the thing ignored. `contain` because the source's crop is not
      // ours to guess.
      // A FRAME, WHEN THE CALLER MEASURED ONE. `height: auto` is what makes
      // `aspect-ratio` work here at all — the platform writes the intrinsic
      // width/height ATTRIBUTES onto every <img>, and a presentational height is
      // a USED height, so the ratio would otherwise be ignored. That is the same
      // fix the platform applied to its own media CSS.
      //
      // `cover` only inside a frame: filling one means cropping, which is the
      // trade a wall of tiles makes on purpose. With no frame the answer stays
      // `contain` — the source's crop is not ours to guess.
      if (c.ratio) {
        return {
          type: 'image',
          specials: { src: c.src, alt: c.alt ?? '' },
          style: {
            width: '100%',
            height: 'auto',
            aspectRatio: c.ratio,
            objectFit: 'cover',
          },
        };
      }
      return {
        type: 'image',
        specials: { src: c.src, alt: c.alt ?? '' },
        style: {
          width: 'auto',
          height: 'auto',
          maxWidth: '100%',
          maxHeight: '420px',
          objectFit: 'contain',
        },
      };
    }
    case 'button': {
      const text = c.text?.trim();
      if (!text) return null;
      // TWO KINDS OF LINK, and giving them one look was wrong in both
      // directions. Painting every link produced 38 pink pills out of a
      // documentation sidebar; dropping the unpainted ones lost a whole page of
      // story titles. A call to action takes the target's FILL; a link takes its
      // accent as INK and nothing else, which is the platform's own idiom for a
      // link (a button carrying href, styled flat).
      if (c.variant === 'link') {
        return {
          type: 'button',
          specials: { text, ...(c.href ? { href: c.href } : {}) },
          style: {
            width: 'fit-content',
            backgroundColor: 'transparent',
            border: 'none',
            padding: '0',
            fontWeight: '500',
            ...(t.buttonBg ? { color: t.buttonBg } : {}),
          },
        };
      }
      return {
        type: 'button',
        specials: { text, ...(c.href ? { href: c.href } : {}) },
        style: {
          width: 'fit-content',
          ...(t.buttonBg ? { backgroundColor: t.buttonBg } : {}),
          ...(t.buttonColor ? { color: t.buttonColor } : {}),
          ...(t.buttonRadius ? { borderRadius: t.buttonRadius } : {}),
        },
      };
    }
    case 'list': {
      const items = (c.items ?? []).map((s) => s.trim()).filter(Boolean);
      if (items.length === 0) return null;
      // A stack of text rather than the `list` element: `list` renders through
      // `list-item` children with their own contract, and a bullet list of plain
      // sentences is the one shape a column of text reproduces exactly.
      return {
        type: 'flex-block',
        style: { width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' },
        children: items.map((text) => ({
          type: 'text',
          specials: { htmlTag: 'p', text: `• ${text}` },
          style: {
            lineHeight: '1.7',
            ...(t.textColor ? { color: t.textColor } : {}),
            ...(t.textSize ? { fontSize: t.textSize } : {}),
          },
        })),
      };
    }
    case 'group': {
      const kids = (c.children ?? []).map((k) => one(k, t)).filter((n): n is NodeSpec => n !== null);
      if (kids.length === 0) return null;
      // A COLUMN IS A STACK, NOT A ROW, and this was read by nothing.
      //
      // The capture never emits one — a column is what a page already is, so it
      // is flattened in the browser — and `direction` sat in `Captured` unread
      // for exactly that reason. The moment a caller composes a tree by hand
      // (a layout pattern, a design ported out of Figma or Stitch) that stops
      // being true, and every column it asked for came back as a row: a hero's
      // heading, its sentence and its button side by side instead of stacked.
      if (c.direction === 'column') {
        if (kids.length === 1) return kids[0];
        return {
          type: 'flex-block',
          style: { width: '100%', display: 'flex', flexDirection: 'column', gap: '12px' },
          children: kids,
        };
      }
      if (kids.length === 1) return kids[0];
      // A WRAPPING ROW IS A GRID, because flex cannot wrap into EQUAL CELLS.
      //
      // `flex: 1 1 <basis>` lets every item absorb the free space on ITS OWN
      // LINE, so a short last line is a disaster: MEASURED on a page built by
      // these tools, a gallery of five photographs came out as four cells of
      // 330x220 and a fifth of 1392x420 — the same picture, four times the size,
      // under the others. Nothing reported it, because no box overflowed and no
      // two boxes overlapped; `measure` cannot see a cell that is merely wrong.
      //
      // Dropping the grow factor instead (`0 1 280px`) fixes the blow-up and
      // buys a ragged right edge on every full line. `repeat(auto-fill,
      // minmax(280px, 1fr))` is the thing actually wanted and the platform
      // renders it — verified against a live server before this was written:
      // as many cells as fit, all equal, the last line cell-sized like the rest.
      //
      // Mobile gets one column by name. The flex path's `flexDirection: column`
      // says nothing to a grid, and a mobile answer that silently does nothing
      // is rule 3 failing with a value in the document to prove it tried.
      // A PACKED ROW IS NOT A GRID AND NOT AN EQUAL-SHARE ROW. It wraps, so it
      // needs no stack breakpoint of its own — a menu that runs out of width
      // starts a second line, which is what a menu should do.
      if (c.pack) {
        return {
          type: 'flex-block',
          style: {
            width: '100%',
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '24px',
            ...(c.align === 'center' ? { justifyContent: 'center' } : {}),
          },
          // `width: auto` IS THE LOAD-BEARING HALF, and leaving it out looked
          // like the whole idea had failed. `flex-block` seeds `width: 100%`
          // from its element defaults, and `flex: 0 0 auto` only says "do not
          // grow or shrink from the BASIS" — the basis being `auto`, which
          // reads the width. So every packed cell stayed 100% wide and the
          // menu came out as a vertical list: measured, three links stacked in
          // a 140px header where the equal-share version had been 52.
          children: kids.map((k) => ({
            type: 'flex-block',
            style: { flex: '0 0 auto', width: 'auto', display: 'flex', flexDirection: 'column' },
            children: [k],
          })),
        };
      }
      if (c.wrap) {
        return {
          type: 'flex-block',
          style: {
            width: '100%',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '24px',
          },
          responsive: { mobile: { style: { gridTemplateColumns: '1fr', gap: '16px' } } },
          children: kids.map((k) => ({
            type: 'flex-block',
            style: { width: '100%', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '12px' },
            children: [k],
          })),
        };
      }
      // A ROW OF TWO OR MORE COLUMNS NEEDS AN EXPLICIT STACK BREAKPOINT, and
      // nothing catches it for you: the columns SHRINK to fit, so no box
      // overflows and `measure` stays silent while a photo becomes a sliver and
      // a label truncates mid-word. Rule 3 of the design skill, and an import is
      // the one place a row arrives without anybody having thought about 390.
      //
      // The wide answer is said out loud at base too, because the cascade
      // resolves narrower slots LAST but does consult them: a `column` written
      // only at mobile would otherwise reach desktop whenever base declares
      // nothing.
      return {
        type: 'flex-block',
        style: {
          width: '100%',
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'nowrap',
          alignItems: c.align && c.align !== 'start' ? c.align : 'flex-start',
          gap: '24px',
        },
        responsive: { mobile: { style: { flexDirection: 'column', gap: '16px' } } },
        // A COLUMN'S BASIS BECOMES ITS HEIGHT THE MOMENT THE ROW STACKS, and that
        // is the whole reason this needs a mobile answer of its own.
        //
        // `flex: 1 1 280px` sizes the MAIN axis; the row's own mobile override
        // turns the main axis from width into height, so every stacked column
        // came out 280px tall whatever was in it. Measured at 390 on a real
        // import: a paragraph of two lines sat in a 280px box, and the page ran
        // 6,009px with most of it empty — and NOTHING reported it, because no box
        // overflowed and no two boxes overlapped. `measure` cannot see air.
        //
        // Mobile only, and base keeps the wide answer, which is the cascade's
        // tail rule the right way round: the row is still a row at tablet.
        children: kids.map((k) => ({
          type: 'flex-block',
          style: { flex: '1 1 280px', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '12px' },
          responsive: { mobile: { style: { flex: '0 1 auto' } } },
          children: [k],
        })),
      };
    }
    case 'section': {
      const kids = (c.children ?? []).map((k) => one(k, t)).filter((n): n is NodeSpec => n !== null);
      if (kids.length === 0) return null;
      // flex-section is isRootOnly, so a section always arrives as one, and its
      // inner block is what carries the page's own measure — an imported band
      // that runs the full window width on a page whose sections are 1200 reads
      // as a different site even when every colour matches.
      // A PINNED SECTION ARRIVES WITH ALL THREE KEYS, never just `position`.
      // The offset and the layer order are not decoration: measured in Chromium
      // by the platform, a pinned section with no z-index is painted OVER by any
      // `position: relative` element in a later section the moment it scrolls
      // past, which reads as the import having produced a broken band rather
      // than as a stacking question nobody answered. `stickySeeds` is the one
      // place that says what they are, so this cannot drift from `sb_set`.
      //
      // `fixed` is carried as the source declared it, seeds and all — a fixed
      // bar with no offset would sit wherever the flow left it, which on an
      // imported page is not where the source had it.
      const pin = c.pinned
        ? { position: c.pinned, ...stickySeeds(undefined, { position: 'sticky' }) }
        : {};
      return {
        type: 'flex-section',
        style: {
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          ...(t.sectionPadding ? { padding: t.sectionPadding } : { padding: '64px 24px' }),
          ...pin,
        },
        children: [
          {
            type: 'flex-block',
            style: {
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              ...(t.sectionMaxWidth ? { maxWidth: t.sectionMaxWidth } : {}),
            },
            children: kids,
          },
        ],
      };
    }
  }
}

/**
 * The captured page as sections this platform can add.
 *
 * Anything that reduced to nothing is dropped rather than represented, so the
 * count in the result is what actually arrived — a caller told "12 sections"
 * that then sees four is a caller who stops trusting the number.
 */
export function toSpecs(captured: Captured[], tokens: PageTokens): NodeSpec[] {
  return captured
    .map((c) => one(c.kind === 'section' ? c : { kind: 'section', children: [c] }, tokens))
    .filter((n): n is NodeSpec => n !== null);
}

/** Every image source in the captured tree, in order, deduplicated. */
export function imageSources(captured: Captured[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (c: Captured): void => {
    if (c.kind === 'image' && c.src && !seen.has(c.src)) {
      seen.add(c.src);
      out.push(c.src);
    }
    for (const k of c.children ?? []) visit(k);
  };
  for (const c of captured) visit(c);
  return out;
}

/**
 * Rewrite every image source through a map of original → uploaded URL.
 *
 * A hotlinked image is a page that breaks when somebody else's site changes,
 * and on a storefront that is a product photo going missing. Sources with no
 * entry are left alone rather than blanked: an upload that failed should leave
 * a visible image behind, not an empty frame.
 */
export function rehostImages(captured: Captured[], map: Map<string, string>): Captured[] {
  const visit = (c: Captured): Captured => ({
    ...c,
    ...(c.kind === 'image' && c.src && map.has(c.src) ? { src: map.get(c.src) } : {}),
    ...(c.children ? { children: c.children.map(visit) } : {}),
  });
  return captured.map(visit);
}

/**
 * POINT THE IMPORTED LINKS AT THE IMPORTED PAGES.
 *
 * A captured link keeps the SOURCE's absolute URL, so a site brought over with
 * `sb_import_site` had a menu that sent every visitor back to the website it was
 * copied from — twelve pages built here and not one way to reach any of them.
 * The most basic feature a website has, and the import was quietly working
 * against it.
 *
 * Only the links whose target was ACTUALLY IMPORTED are rewritten. A same-origin
 * link to a page the cap left out is counted rather than pointed at a slug that
 * does not exist here: an off-site link that works beats a local one that 404s,
 * and the count is what tells the caller to raise `max_pages`. A genuinely
 * external link is left alone and is not interesting.
 */
export function relink(
  captured: Captured[],
  local: Map<string, string>,
  origin: string,
): { sections: Captured[]; rewritten: number; unimported: number } {
  let rewritten = 0;
  let unimported = 0;
  const one = (c: Captured): Captured => {
    let href = c.href;
    if (href) {
      const norm = normalizeUrl(href);
      const to = norm ? local.get(norm) : undefined;
      if (to) {
        // THE FRAGMENT SURVIVES. `normalizeUrl` drops it because it is not part
        // of a page's IDENTITY — that is what folds `/a` and `/a#top` into one
        // page — but it is very much part of the link, and a source page's
        // "jump to the forums" section link would otherwise land at the top of
        // the page and look broken. Measured on a real import: six of them on
        // one page.
        const hash = href.indexOf('#');
        href = hash >= 0 ? `${to}${href.slice(hash)}` : to;
        rewritten += 1;
      } else if (norm && norm.indexOf(origin) === 0) {
        unimported += 1;
      }
    }
    const kids = c.children ? c.children.map(one) : undefined;
    return { ...c, ...(href ? { href } : {}), ...(kids ? { children: kids } : {}) };
  };
  return { sections: captured.map(one), rewritten, unimported };
}

/**
 * A menu label from a page's own `<title>`.
 *
 * A title is written for a browser tab and a search result — "Example Servers —
 * Model Context Protocol" — and a menu row of those wraps to three lines. The
 * part before the first separator is what the page calls itself; the cap is
 * what keeps one long name from owning the row.
 */
export function menuLabel(name: string): string {
  const head = name.split(/\s+[|—–·:]\s+/)[0].trim() || name.trim();
  return head.length > 28 ? `${head.slice(0, 27).trimEnd()}…` : head;
}

/**
 * THE SHARED HEADER, built from the pages that were actually created.
 *
 * NOT from the source's own nav, deliberately. Its links point at the site it
 * was copied from, half of them at pages the cap left out, and its structure is
 * somebody else's — three reasons the capture skips page chrome in the first
 * place. What the merchant needs is a way to reach THESE pages, and that list is
 * already known exactly.
 *
 * Built through `toSpecs` rather than hand-assembled so it wears the same tokens
 * every imported section does — a header that answers the accent differently is
 * rule 0 broken on the one band that appears on every page. Only the padding is
 * overridden: a section's 64px is right for a band of content and absurd for a
 * menu.
 */
export function navSpec(
  links: Array<{ text: string; href: string }>,
  t: PageTokens,
): NodeSpec | null {
  if (links.length === 0) return null;
  const [section] = toSpecs(
    [
      {
        kind: 'section',
        children: [
          {
            kind: 'group',
            direction: 'row',
            // PACKED, not an equal share: a menu's links sit against each other.
            pack: true,
            children: links.map((l) => ({
              kind: 'button' as const,
              variant: 'link' as const,
              text: l.text,
              href: l.href,
            })),
          },
        ],
      },
    ],
    t,
  );
  if (!section) return null;
  return {
    ...section,
    style: { ...section.style, padding: '16px 24px' },
  };
}
