import type { NodeSpec } from './builder.js';
import type { DocLike, NodeLike } from '../../core/tree.js';
import { walk } from '../../core/tree.js';
import { stickySeeds } from './sticky.js';

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
  kind: 'section' | 'group' | 'heading' | 'text' | 'image' | 'button' | 'list';
  /** For a group: the arrangement the source actually used. */
  direction?: 'row' | 'column';
  wrap?: boolean;
  /** For a button: whether the source painted it as a call to action, or it is prose's link. */
  variant?: 'cta' | 'link';
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
 * One captured node as the element that can render it.
 *
 * Returns null for anything with nothing to show — an image with no source, a
 * heading whose text was whitespace. Dropping it here rather than adding an
 * empty node is the difference between an imported page and an imported page
 * plus twenty findings from `sb_review`.
 */
function one(c: Captured, t: PageTokens): NodeSpec | null {
  switch (c.kind) {
    case 'heading': {
      const text = c.text?.trim();
      if (!text) return null;
      return {
        type: 'heading',
        specials: { htmlTag: headingTag(c.level), text },
        style: {
          margin: '0',
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
          ...(t.textColor ? { color: t.textColor } : {}),
          ...(t.textSize ? { fontSize: t.textSize } : {}),
        },
      };
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
      if (kids.length === 1) return kids[0];
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
          flexWrap: c.wrap ? 'wrap' : 'nowrap',
          alignItems: 'flex-start',
          gap: '24px',
        },
        responsive: { mobile: { style: { flexDirection: 'column', gap: '16px' } } },
        children: kids.map((k) => ({
          type: 'flex-block',
          style: { flex: '1 1 280px', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '12px' },
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
