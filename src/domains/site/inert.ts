/**
 * ELEMENTS THAT RENDER CONVINCINGLY WHILE DOING NOTHING.
 *
 * The ordinary silent failure in this platform is a value stored where nothing
 * reads it. This is the other shape: the element renders, looks finished, and is
 * wired to nothing — so neither `sb_review` (which reads the tree, and the tree
 * is correct) nor `sb_look` (which photographs the page, and the page looks
 * right) can see it. The only moment the fact is cheap to deliver is the moment
 * the element is ADDED, which is what this table is for.
 *
 * Each entry names the SECOND write the element needs, because in every case the
 * first one — dropping the element on the page — succeeds completely.
 */
export interface InertHint {
  /** Said once per process per element type. */
  note: string;
}

export const INERT_ON_ADD: Record<string, InertHint> = {
  // `localeSwitchPayload` returns "" below two languages, and the renderer's
  // fallback is a FABRICATED chip — `sample = {Code: "VI", Name: "Tiếng Việt",
  // Currency: "VND", Flag: "🌐"}` — chosen deliberately "so the element is never
  // an empty box". So a single-language store gets a language switcher that
  // looks live, names a language, and switches nothing. The globe is the tell,
  // and it is not one an agent photographing the page would read as a warning.
  'locale-switcher': {
    note:
      'A locale-switcher paints a FABRICATED chip until the site actually has two or more ' +
      'locales: below that the payload is empty and the renderer falls back to a sample ' +
      '("🌐 Tiếng Việt / VND") so the element is never an empty box. It looks live and ' +
      'switches nothing, and neither sb_review nor sb_look can tell the difference. Configure ' +
      'the site locales first (site settings: locales, defaultLocale, localeUrlMode), or leave ' +
      'the element off a single-language store.',
  },

  // The trail IS derived and the root label IS authorable — `Steps(n, page.Trail)`
  // plus `specials.homeLabel`. What is not automatic is the LANGUAGE of that one
  // word: the resolver supplies every entity's own label and leaves the root
  // empty precisely so the node can fill it, defaulting to the English "Home".
  // Same class as the seeded empty-state copy `default_seed_copy` reports, in a
  // place that check cannot see because it is not seeded content.
  breadcrumb: {
    note:
      "A breadcrumb derives its trail from the page, but the ROOT crumb's word comes from the " +
      'node: specials.homeLabel, defaulting to the English "Home". The resolver leaves that step ' +
      'empty on purpose so it can be authored, which is the only way it is translatable. On a ' +
      'store that is not in English, set it (e.g. "Trang chủ") or the trail reads half-translated ' +
      'on every product page.',
  },

  // THE SHARPEST OF THE THREE, because the placeholder is not a placeholder: it
  // is a REAL scene on Spline's own servers, and it loads, renders and responds
  // to the mouse. The other two entries here describe an element that looks
  // finished; this one looks finished AND is somebody else's work, published on
  // the merchant's domain. `sb_review` reads a correct tree, `sb_look`
  // photographs a convincing 3D hero, and nothing anywhere says whose it is.
  'spline-scene': {
    note:
      "A spline-scene is born pointing at SPLINE'S OWN DEMO SCENE (specials.sceneUrl defaults to " +
      'a real prod.spline.design link), so an unset one publishes a 3D hero that loads, moves, ' +
      "and belongs to somebody else — it looks finished, so no check can flag it. Set sceneUrl " +
      'to the merchant\'s own export (Spline: Export → Viewer → the …/scene.splinecode link), and ' +
      'set specials.posterUrl too or the box is blank until the engine chunk arrives.',
  },
};

/** The hint for a type, or null. */
export function inertHint(type: string): string | null {
  return INERT_ON_ADD[type]?.note ?? null;
}

/** Every distinct hint for the types in a subtree spec, deduped, in add order. */
export function inertHintsFor(types: readonly string[]): Array<{ type: string; note: string }> {
  const seen = new Set<string>();
  const out: Array<{ type: string; note: string }> = [];
  for (const t of types) {
    if (seen.has(t)) continue;
    const note = inertHint(t);
    if (!note) continue;
    seen.add(t);
    out.push({ type: t, note });
  }
  return out;
}
