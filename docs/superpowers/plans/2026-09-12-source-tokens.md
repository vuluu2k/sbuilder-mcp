# Source Tokens Implementation Plan (Phase 9, P2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the design system off the page being imported — its colours and its type
scale — and write it into the target site's theme, so an imported page wears the source's
look through theme tokens rather than through literals stamped on every node.

**Architecture:** `capture` collects a small set of computed values per node. A pure module
clusters those samples into the vocabulary the platform's theme actually has: five colour
roles and nine text styles. `sb_import_site` reads them ONCE per site and patches the theme
through the existing `sb_theme` surface before it builds any page.

**Tech Stack:** TypeScript (ESM / Node16), `playwright-core` with `channel: 'chrome'`,
vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-12-crawl-fidelity-design.md`, section P2.

## Two corrections to the spec, made before writing this plan

The spec was written without reading the theme document's real shape. I read it. Both
corrections are recorded here rather than silently applied.

**1. Radius and spacing do NOT go into the theme, because the theme has no token for
either.** `STARTER_THEME`'s top-level keys are `version`, `colors`, `textStyles`, `schemes`,
`lightSchemeId`, `presets`. `colors` is five entries — `heading`, `text`, `primary`, `muted`,
`background`. Radius lives inside `presets[].base.borderRadius` (25 of 58 presets carry one)
and padding inside `presets[].base.padding`. And `sb_theme` accepts exactly two arguments,
`colors` and `text_styles` — **it cannot write a preset at all**. So the spec's "radius into
at most three" and "spacing into at most six steps" have nowhere to land on this surface.

They are still worth extracting. They ride out of this phase as extended `PageTokens`, which
is what `toSpecs` already consumes, and P3 decides what to do with them. Rewriting 58 presets
is a far larger and riskier surface than this phase should open.

**2. "At most six steps" is the wrong target for type.** The theme ships NINE text styles —
`heading-1` through `heading-6` and `text-1` through `text-3` — each with `fontFamily`,
`fontSize`, `fontWeight`, `lineHeight` and a `responsive.mobile` override. Clustering into an
invented six-step scale and then mapping it onto nine slots adds a lossy step for nothing.
Cluster to the slots the theme has.

## The honest limit of this phase, stated up front

**The harness cannot confirm that this phase helped.** `content` counts characters and
`structure` compares tree shapes; neither can see a colour or a font size. Only `visual`
can, and `visual` needs a rendered page, which needs the live-site run that the permission
layer refuses in this environment.

So P2 lands as a change whose benefit is argued and not measured. Do not paper over that:
the `CLAUDE.md` entry must say it, and the first person who gets an online run must check
`visual` before and after. Every other claim in this plan is verifiable offline and must be
verified.

## Global Constraints

Copied from `CLAUDE.md`; every task inherits them. In every commit message below, the
`Co-Authored-By` trailer names the model that actually did the work — this branch already
carries a mix, and a line that is true of the commit it signs is worth more than a uniform
one that is not.

- **Node ≥22.** ESM / Node16: **every relative import ends in `.js`**, including from a `.ts`
  source.
- **stdout is the MCP channel.** Every log line is `console.error`. One stray `console.log`
  corrupts the protocol for every client.
- **`playwright-core` + `channel: 'chrome'`** — the system browser. **No new dependency.**
- **A function passed to `page.evaluate` is SERIALIZED.** Everything it uses is declared
  INSIDE it or passed as an argument. This repo has paid for that twice: once through a
  module-scope constant (`ReferenceError: HEADINGS is not defined`), once through a
  transpiler injecting `__name`. Anything added to `capturePage` is subject to both.
- **Browser tests are opt-in** behind `SB_BROWSER_TEST=1`, and the default suite skips them.
  Run `SB_BROWSER_TEST=1 npx vitest run` after touching anything under `src/vision/`.
- **Secrets come from env only.** This repo is PUBLIC.
- **Never hand-edit `src/catalog/*.generated.ts`.**
- **`test/token-budget.test.ts` caps tool descriptions and results.** This phase adds a field
  to `sb_import_site`'s result and prose to two tool descriptions — check it.
- **The gate is `npm run build && npm test && npm run smoke`**, and smoke MUST print
  `ALL GOOD`. `build` also typechecks `test/fidelity/**` through `tsconfig.fidelity.run.json`.
- **Mutating tools take `dry_run` and default it to `true`.**

---

### Task 1: `capture` collects the computed values a design system is made of

**Files:**
- Modify: `src/vision/capture.ts`
- Modify: `src/domains/site/importmap.ts` (the `Captured` interface only)
- Test: `test/import.test.ts` (add to the browser-gated describe blocks)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Captured.sample?: StyleSample` where
  `export interface StyleSample { color?: string; backgroundColor?: string; fontFamily?: string; fontSize?: string; fontWeight?: string; lineHeight?: string; borderRadius?: string; padding?: string; gap?: string }`

Why a separate optional field rather than folding these into the existing `direction` /
`align` / `textAlign` group: those are ARRANGEMENT and the mapper acts on every one of them.
These are RAW OBSERVATIONS that only Task 2 reads, and `toSpecs` must go on ignoring them —
stamping a source colour onto a node is P3's decision, not this phase's.

- [ ] **Step 1: Write the failing test**

Add to `test/import.test.ts`, inside a `describe.runIf(process.env.SB_BROWSER_TEST === '1')`
block.

```ts
describe.runIf(process.env.SB_BROWSER_TEST === '1')('capture() sampling the source design', () => {
  const page = (body: string) => `data:text/html;charset=utf-8,${encodeURIComponent(body)}`;

  it('samples the computed colour, size and weight of a heading', async () => {
    const got = await capture(
      page(
        '<body style="background:#fffaf5"><main><section>' +
          '<h1 style="color:#b3123a;font-size:44px;font-weight:800">Tiêu đề</h1>' +
          '<p style="color:#4b5563;font-size:17px">Một đoạn văn để đo.</p>' +
          '</section></main></body>',
      ),
      { maxImages: 5, maxNodes: 200 },
    );
    const flat: Captured[] = [];
    const walk = (c: Captured): void => {
      flat.push(c);
      for (const k of c.children ?? []) walk(k);
    };
    got.sections.forEach(walk);

    const heading = flat.find((c) => c.kind === 'heading');
    expect(heading?.sample?.color).toBe('rgb(179, 18, 58)');
    expect(heading?.sample?.fontSize).toBe('44px');
    expect(heading?.sample?.fontWeight).toBe('800');

    const text = flat.find((c) => c.kind === 'text');
    expect(text?.sample?.color).toBe('rgb(75, 85, 99)');
    expect(text?.sample?.fontSize).toBe('17px');
  }, BROWSER_TIMEOUT);

  it('samples a painted button\'s fill and radius', async () => {
    const got = await capture(
      page(
        '<body><main><section>' +
          '<a href="/x" style="display:block;background:#b3123a;color:#fff;border-radius:999px;padding:12px 28px">Mua ngay</a>' +
          '</section></main></body>',
      ),
      { maxImages: 5, maxNodes: 200 },
    );
    const flat: Captured[] = [];
    const walk = (c: Captured): void => {
      flat.push(c);
      for (const k of c.children ?? []) walk(k);
    };
    got.sections.forEach(walk);
    const button = flat.find((c) => c.kind === 'button');
    expect(button?.sample?.backgroundColor).toBe('rgb(179, 18, 58)');
    expect(button?.sample?.borderRadius).toBe('999px');
  }, BROWSER_TIMEOUT);

  it('DOES NOT change what the mapper produces', async () => {
    // The samples are observations for Task 2. `toSpecs` must go on ignoring
    // them: stamping a source colour onto a node is P3's decision, and if it
    // leaked in here every imported node would silently detach from its preset.
    const got = await capture(
      page('<body><main><section><h1 style="color:#b3123a">Tiêu đề</h1></section></main></body>'),
      { maxImages: 5, maxNodes: 200 },
    );
    const specs = toSpecs(got.sections, {});
    expect(JSON.stringify(specs)).not.toContain('b3123a');
    expect(JSON.stringify(specs)).not.toContain('179, 18, 58');
  }, BROWSER_TIMEOUT);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `SB_BROWSER_TEST=1 npx vitest run test/import.test.ts -t "samples the computed colour"`
Expected: FAIL — `sample` is undefined.

- [ ] **Step 3: Add the field to `Captured`**

In `src/domains/site/importmap.ts`, above the `Captured` interface, add:

```ts
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
```

and inside `Captured`, beside `textAlign`:

```ts
  /** Computed values read off the source node — see `StyleSample`. */
  sample?: StyleSample;
```

- [ ] **Step 4: Collect the sample inside `capturePage`**

In `src/vision/capture.ts`, inside `capturePage`, add a helper DECLARED INSIDE the serialized
function — it must close over nothing at module scope:

```ts
  // EVERY value here is computed in-page. This function is serialized; a
  // module-scope constant it closed over would not exist on the other side.
  const sampleOf = (el: El): Record<string, string> => {
    const cs = getComputedStyle(el);
    const out: Record<string, string> = {};
    const put = (k: string, v: string): void => {
      // `transparent` and the UA's own zero values say nothing about the
      // design, and carrying them would put a fake sample into the clustering.
      if (v && v !== 'none' && v !== 'normal' && v !== 'rgba(0, 0, 0, 0)' && v !== '0px') out[k] = v;
    };
    put('color', cs.color);
    put('backgroundColor', cs.backgroundColor);
    put('fontFamily', cs.fontFamily);
    put('fontSize', cs.fontSize);
    put('fontWeight', cs.fontWeight);
    put('lineHeight', cs.lineHeight);
    put('borderRadius', cs.borderRadius);
    put('padding', cs.padding);
    put('gap', cs.gap);
    return out;
  };
```

Attach it where each kind is built — heading, text, button, section and group — as
`sample: sampleOf(el)`, and only when the object is non-empty, so a node that painted nothing
carries no key rather than an empty object.

Do NOT attach it to `image`, `divider`, `icon`, `embed` or `video`: none contributes to a
design system, and every extra sample is bytes in a result that `test/token-budget.test.ts`
measures.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `SB_BROWSER_TEST=1 npx vitest run test/import.test.ts`
Expected: PASS, including the three new tests and every pre-existing one.

The third test is the one that matters most — if `toSpecs` started emitting the source's
colour, every imported node would detach from its preset permanently and the whole point of
this phase would be inverted.

- [ ] **Step 6: Check the budget**

Run: `npx vitest run test/token-budget.test.ts`
Expected: PASS. If it fails, the samples are reaching a tool RESULT — they should not; they
are consumed by Task 3 and never printed. Find the leak rather than raising the ceiling.

- [ ] **Step 7: Run the gate and commit**

```bash
npm run build && npm test && npm run smoke
git add src/vision/capture.ts src/domains/site/importmap.ts test/import.test.ts
git commit -m "feat(import): read what the source actually painted

Co-Authored-By: Claude <MODEL NAME> <noreply@anthropic.com>"
```

---

### Task 2: `sourcetokens.ts` — cluster the samples into the theme's own vocabulary

**Files:**
- Create: `src/domains/site/sourcetokens.ts`
- Test: `test/sourcetokens.test.ts`

**Interfaces:**
- Consumes: `Captured` and `StyleSample` from Task 1.
- Produces:
  - `export interface SourceTokens { colors: Partial<Record<'heading' | 'text' | 'primary' | 'muted' | 'background', string>>; textStyles: Record<string, { fontSize?: string; fontWeight?: string; lineHeight?: string; fontFamily?: string }>; radii: string[]; spacings: string[] }`
  - `export function sourceTokens(sections: Captured[]): SourceTokens`

Pure. No network, no browser, no I/O. Tests run in the DEFAULT suite.

**The role assignment mirrors `tokensFromPage`, which is deliberate.** That function reads
the TARGET page by taking the first of each kind in document order — "the same thing a person
does when they open a page and look at what a heading is" — and explicitly does not average,
because an average of two accents is a third colour that appears nowhere. Apply the same rule
to the source. The one place to depart from it is `background`, where the most COMMON section
background is a better answer than the first, because a page often opens with a hero band that
is not its ground.

`muted` has no first-of-kind to read. Take the second-most-common text colour when one exists
and is distinct from `text`; otherwise leave it unset. An unset role must be OMITTED, never
guessed — `sb_theme` patches only the fields it is given, so an omitted role keeps whatever
the site already had, and that is the right outcome for a role the source did not express.

**Colours arrive as `rgb(...)` from `getComputedStyle` and the theme stores hex.** Convert.
`rgba()` with an alpha below 1 is not a token — skip it rather than flattening it onto an
unknown backdrop.

- [ ] **Step 1: Write the failing test**

Create `test/sourcetokens.test.ts`.

```ts
import { describe, it, expect } from 'vitest';
import { sourceTokens } from '../src/domains/site/sourcetokens.js';
import type { Captured } from '../src/domains/site/importmap.js';

const section = (...children: Captured[]): Captured => ({ kind: 'section', children });

describe('sourceTokens — colours', () => {
  it('takes the FIRST heading and the FIRST body line, not an average', () => {
    const got = sourceTokens([
      section(
        { kind: 'heading', level: 1, text: 'A', sample: { color: 'rgb(179, 18, 58)' } },
        { kind: 'text', text: 'body', sample: { color: 'rgb(75, 85, 99)' } },
        { kind: 'heading', level: 2, text: 'B', sample: { color: 'rgb(0, 0, 0)' } },
      ),
    ]);
    expect(got.colors.heading).toBe('#b3123a');
    expect(got.colors.text).toBe('#4b5563');
  });

  it('takes the accent from the first PAINTED button, never an unpainted one', () => {
    // An unpainted link is navigation. Taking its fill would leave the accent
    // unset on every site whose first button is a nav link — the same reason
    // the importer already refuses to paint one.
    const got = sourceTokens([
      section(
        { kind: 'button', text: 'Trang chủ', variant: 'link', sample: {} },
        { kind: 'button', text: 'Mua ngay', sample: { backgroundColor: 'rgb(179, 18, 58)' } },
      ),
    ]);
    expect(got.colors.primary).toBe('#b3123a');
  });

  it('takes the MOST COMMON section background as the page ground', () => {
    // Not the first: a page often opens with a hero band that is not its ground.
    const got = sourceTokens([
      { kind: 'section', sample: { backgroundColor: 'rgb(17, 17, 17)' }, children: [] },
      { kind: 'section', sample: { backgroundColor: 'rgb(255, 250, 245)' }, children: [] },
      { kind: 'section', sample: { backgroundColor: 'rgb(255, 250, 245)' }, children: [] },
    ]);
    expect(got.colors.background).toBe('#fffaf5');
  });

  it('OMITS a role the source did not express rather than guessing one', () => {
    const got = sourceTokens([section({ kind: 'text', text: 'x', sample: { color: 'rgb(0,0,0)' } })]);
    expect(got.colors.heading).toBeUndefined();
    expect(got.colors.primary).toBeUndefined();
    expect('heading' in got.colors).toBe(false);
  });

  it('skips a translucent colour rather than flattening it', () => {
    const got = sourceTokens([
      section({ kind: 'heading', level: 1, text: 'A', sample: { color: 'rgba(179, 18, 58, 0.6)' } }),
    ]);
    expect(got.colors.heading).toBeUndefined();
  });
});

describe('sourceTokens — the type scale', () => {
  it('maps the largest heading to heading-1 and descends', () => {
    const got = sourceTokens([
      section(
        { kind: 'heading', level: 1, text: 'A', sample: { fontSize: '44px', fontWeight: '800' } },
        { kind: 'heading', level: 2, text: 'B', sample: { fontSize: '28px', fontWeight: '700' } },
        { kind: 'text', text: 'c', sample: { fontSize: '17px' } },
      ),
    ]);
    expect(got.textStyles['heading-1'].fontSize).toBe('44px');
    expect(got.textStyles['heading-1'].fontWeight).toBe('800');
    expect(got.textStyles['heading-2'].fontSize).toBe('28px');
    expect(got.textStyles['text-1'].fontSize).toBe('17px');
  });

  it('collapses two headings of the same size into ONE slot', () => {
    // A source with six heading levels that render at three sizes has three
    // type sizes, not six. Emitting six slots with duplicate values would
    // manufacture a scale the source does not have.
    const got = sourceTokens([
      section(
        { kind: 'heading', level: 1, text: 'A', sample: { fontSize: '32px' } },
        { kind: 'heading', level: 2, text: 'B', sample: { fontSize: '32px' } },
        { kind: 'heading', level: 3, text: 'C', sample: { fontSize: '20px' } },
      ),
    ]);
    expect(got.textStyles['heading-1'].fontSize).toBe('32px');
    expect(got.textStyles['heading-2'].fontSize).toBe('20px');
    expect(got.textStyles['heading-3']).toBeUndefined();
  });

  it('never emits more than the theme has slots for', () => {
    const headings: Captured[] = [];
    for (let i = 0; i < 12; i += 1) {
      headings.push({ kind: 'heading', level: 1, text: `h${i}`, sample: { fontSize: `${60 - i * 3}px` } });
    }
    const got = sourceTokens([section(...headings)]);
    expect(Object.keys(got.textStyles).filter((s) => s.startsWith('heading-')).length).toBeLessThanOrEqual(6);
  });
});

describe('sourceTokens — radii and spacings', () => {
  it('returns them sorted and deduplicated, for P3 rather than for the theme', () => {
    const got = sourceTokens([
      section(
        { kind: 'button', text: 'a', sample: { backgroundColor: 'rgb(1,1,1)', borderRadius: '8px' } },
        { kind: 'button', text: 'b', sample: { backgroundColor: 'rgb(1,1,1)', borderRadius: '8px' } },
        { kind: 'button', text: 'c', sample: { backgroundColor: 'rgb(1,1,1)', borderRadius: '999px' } },
      ),
    ]);
    expect(got.radii).toEqual(['8px', '999px']);
  });

  it('answers empty structures for an empty page rather than throwing', () => {
    const got = sourceTokens([]);
    expect(got.colors).toEqual({});
    expect(got.textStyles).toEqual({});
    expect(got.radii).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/sourcetokens.test.ts`
Expected: FAIL — `Cannot find module '../src/domains/site/sourcetokens.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/domains/site/sourcetokens.ts`. The module's own doc comment must record why role
assignment is first-of-kind rather than averaged, and why `background` departs from that.

The pieces, in order:

1. `hex(value: string): string | undefined` — `rgb(r, g, b)` → `#rrggbb`; `rgba(...)` with
   alpha < 1 → `undefined`; an already-hex value passes through lowercased.
2. A flattening walk over `Captured[]` that yields `{ kind, level, sample }` in document
   order, satellite-free (a `Captured` tree has only `children`).
3. Role assignment: first heading with a usable `color`; first text with a usable `color`;
   first `button` whose `sample.backgroundColor` converts AND whose `variant` is not `'link'`;
   most common section `backgroundColor`; `muted` from the second-most-common text colour when
   distinct.
4. Type scale: collect `{fontSize, fontWeight, lineHeight, fontFamily}` from headings and from
   texts separately, dedupe by `fontSize`, sort descending by pixel value, take at most 6
   heading slots and at most 3 text slots, assign to `heading-1…` and `text-1…` in order.
5. `radii` and `spacings`: dedupe, sort ascending by pixel value, cap at 6 each.

Every omitted value is ABSENT from the object, never `undefined` as a present key — the
consumer patches a theme, and a present key with no value would clear a token the site
already has.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/sourcetokens.test.ts`
Expected: PASS, all 10.

- [ ] **Step 5: Run the gate and commit**

```bash
npm run build && npm test && npm run smoke
git add src/domains/site/sourcetokens.ts test/sourcetokens.test.ts
git commit -m "feat(import): recover the source's design system from what it painted

Co-Authored-By: Claude <MODEL NAME> <noreply@anthropic.com>"
```

---

### Task 3: `sb_import_site` reads the tokens once and patches the theme

**Files:**
- Modify: `src/tools/importpage.ts` (the `sb_import_site` handler)
- Modify: `src/domains/site/theme.ts` or a small new helper, if a theme-patch function is
  cleaner than inlining the call
- Test: `test/import.test.ts`

**Interfaces:**
- Consumes: `sourceTokens` (Task 2), the existing `siteTheme` fetch in
  `src/domains/site/theme-fetch.ts`, and whatever `sb_theme` uses to PUT the theme.
- Produces: a `theme` block on `sb_import_site`'s result naming what was changed.

**The write is a READ-MODIFY-WRITE against a replace-only endpoint with no history.** Patch
named fields onto the fetched theme and send the whole document back. There must be no
argument anywhere in this path that can express "drop everything else". A site that has never
saved a theme answers `200 {"theme": null}` — the platform calls that the normal first-visit
state — so the patch is built on `STARTER_THEME` in that case and stores a complete theme
rather than a palette with one token in it.

**Read ONCE for the site, before any page is built.** Per-page reading gives the first page
element defaults and every later page the defaults of the blank page before it, which is rule
0 failing on every page at once. The entry page is the one to read, because the caller typed
it.

- [ ] **Step 1: Write the failing test**

Add to `test/import.test.ts`. This one is a pure unit test over the plan step, not a browser
test — build the `Captured` tree by hand and assert the patch that would be sent.

```ts
// Import both from where you implement them, alongside the file's existing imports:
//   import { sourceTokens } from '../src/domains/site/sourcetokens.js';
//   import { themePatchFor } from '../src/tools/importpage.js';   // or wherever it lands
describe('sb_import_site — the theme patch', () => {
  it('names only the roles the source expressed', () => {
    const patch = themePatchFor(
      sourceTokens([
        {
          kind: 'section',
          children: [
            { kind: 'heading', level: 1, text: 'A', sample: { color: 'rgb(179, 18, 58)', fontSize: '44px' } },
            { kind: 'text', text: 'b', sample: { color: 'rgb(75, 85, 99)', fontSize: '17px' } },
          ],
        },
      ]),
    );
    expect(patch).not.toBeNull();
    expect(patch!.colors).toEqual({ heading: '#b3123a', text: '#4b5563' });
    expect('primary' in patch!.colors).toBe(false);
    expect(patch!.text_styles['heading-1'].fontSize).toBe('44px');
  });

  it('sends nothing at all when the source expressed no design', () => {
    // A patch of `{}` against a replace-only endpoint is the shape that once
    // let a site lose its whole palette. Sending no request is the right answer.
    const patch = themePatchFor(sourceTokens([]));
    expect(patch).toBeNull();
  });
});
```

Export `themePatchFor` from wherever you implement it so the test can reach it without going
through the tool.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/import.test.ts -t "the theme patch"`
Expected: FAIL — `themePatchFor` is not defined.

- [ ] **Step 3: Implement**

- `themePatchFor(tokens: SourceTokens): { colors: Record<string,string>; text_styles: Record<string, object> } | null` — returns `null` when both halves are empty.
- In the `sb_import_site` handler, after the page plan is chosen and before the first page is
  built: capture the ENTRY url once, run `sourceTokens`, build the patch, and apply it.
- On `dry_run` (the default) report the patch and change nothing.
- Report it on the real run too, as a `theme` block: which roles moved, from what to what.
- A failed theme write must NOT abort the import. The pages are the deliverable; a theme that
  did not take is a reported line, not a lost run. This mirrors the existing rule that a
  failed image upload keeps the original URL rather than failing the page.

- [ ] **Step 4: Run the tests and the budget**

```bash
npx vitest run test/import.test.ts
npx vitest run test/token-budget.test.ts
```
Expected: both PASS. The `theme` block is new output on `sb_import_site` — if the budget test
goes red, shorten the block rather than raising the ceiling; the roles that moved are the
information, the prose around them is not.

- [ ] **Step 5: Documentation**

`docs/tools.md` and `docs/tools.vi.md`, in the `sb_import_site` section: the tool now reads
the source's colours and type scale off the entry page and patches the target site's theme
before building. Say that it patches named fields and never replaces the document, that a role
the source did not express is left alone, and that the nodes themselves carry no colour — they
follow the theme, which is what keeps an imported site re-themable.

`CLAUDE.md`, in the same entry region as the import work: the fact worth recording is the
reason, not the feature — a literal on a node outranks its preset permanently, so the only way
to make an imported page look like its source AND stay re-themable is to move the source's
design into the theme and leave the nodes referring to it.

**And record the limit:** `content` and `structure` cannot see a colour, so the harness cannot
show this phase helped. Only `visual` can, and no online run has been possible here. Say that
plainly and say what would settle it.

- [ ] **Step 6: Run the gate and commit**

```bash
npm run build && npm test && npm run smoke
git add -A
git commit -m "feat(import): an imported site wears the source's palette through the theme

Co-Authored-By: Claude <MODEL NAME> <noreply@anthropic.com>"
```

---

### Task 4: Measure what can be measured, and say what cannot

**Files:**
- Modify: `test/fidelity/fixtures.json` (only if a fixture needs adding)
- Modify: `test/fidelity/baseline.json` (regenerated)

- [ ] **Step 1: Re-run the offline harness**

Run: `SB_FIDELITY_OFFLINE=1 npm run fidelity`

- [ ] **Step 2: Compare against the committed baseline and read the result**

The expectation is that `content` and `structure` are **unchanged**, because this phase
changes neither what text is kept nor how the tree is shaped. If either moves, that is a
finding: something in Task 1 leaked into the mapper, and the third test of Task 1 should have
caught it. Investigate before committing anything.

Remember the known noise: `modelcontextprotocol.io/` is bimodal between `content 71 /
structure 9.6` and `content 73 / structure 11.9`, measured across 13 runs (7 and 6). A move on
that fixture alone is not evidence. The other four were byte-identical across all 13.

- [ ] **Step 3: Commit the baseline only if it genuinely moved**

If the only difference is the `generated` timestamp, or the only movement is the known bimodal
fixture, do not commit a new baseline — a no-op commit on a measurement file teaches the next
reader that the file churns for no reason.

- [ ] **Step 4: Record the unmeasured claim**

In the report and in `CLAUDE.md`: this phase's benefit is not demonstrated. The check that
would demonstrate it is a full (non-offline) run before and after, reading `visual`. Name it
so the first person with a working online run knows exactly what to look at.

---

## What this plan deliberately does NOT do

- **It does not write presets.** Radius and padding live there, `sb_theme` cannot reach them,
  and rewriting 58 presets tied to element kinds is a bigger and riskier surface than this
  phase should open.
- **It does not stamp anything on a node.** Every colour and size this phase recovers goes
  into the theme. A literal on a node outranks its preset permanently, and an import that
  wrote literals everywhere would produce a site that can never be re-themed — a worse dead
  end than `custom-code`, because it looks fine.
- **It does not touch `sb_import`** (the single-page tool). That one imports into an open page
  on a site whose theme is already the merchant's, and repainting their palette because they
  imported one page would be a site-wide change from a page-level action.
- **It does not claim a measured improvement.** See the limit stated at the top.
