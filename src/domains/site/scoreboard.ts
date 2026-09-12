/**
 * One page at one width.
 *
 * Only `visual` actually varies by width — it comes from a screenshot taken at
 * that width. `content` and `structure` come off ONE capture and ONE tree per
 * page, so both repeat identically across every width row for that `url`; a
 * regression on either is therefore reported once per width, not once per page.
 */
export interface PageScore {
  url: string;
  width: number;
  /**
   * Per cent of pixels that differ from the source. LOWER is better.
   *
   * ABSENT, not zero, on a row an offline run produced — a zero would read as
   * a perfect pixel match, which is a lie: offline mode never rendered
   * anything to diff. `compareBaseline` skips a metric that either side is
   * missing rather than comparing a real number against an invented one.
   */
  visual?: number;
  /** `coverage` — per cent of the source's non-chrome text kept. HIGHER is better. */
  content: number;
  /** Tree-shape distance from the source's captured tree. LOWER is better. */
  structure: number;
  /**
   * Which run produced this row. `offline` scored `content` and `structure`
   * only, from `capture()` alone — no site, no screenshot, no `visual`.
   * `full` also built the page on a live site and diffed the render.
   * Recorded per row so a baseline mixing both is never misread — an
   * `offline` row's absent `visual` is the mode explaining itself, but a
   * reader comparing two runs needs to know which kind either one was.
   */
  mode: 'offline' | 'full';
}

export interface Baseline {
  generated: string;
  scores: PageScore[];
}

export type Metric = 'visual' | 'content' | 'structure';

export interface Move {
  url: string;
  width: number;
  metric: Metric;
  was: number;
  now: number;
  /** Signed, in the metric's own units. */
  delta: number;
}

export interface Comparison {
  regressions: Move[];
  improvements: Move[];
  /** `url @width` for rows the new run has and the baseline does not. */
  added: string[];
  removed: string[];
}

/**
 * DIRECTION IS PER METRIC, and getting it uniform would be the whole bug.
 *
 * `content` is a coverage percentage where higher is better; `visual` and
 * `structure` are distances where lower is better. A comparison that treated
 * them alike would report a run that improved all three as a regression on two.
 */
const LOWER_IS_BETTER: Record<Metric, boolean> = { visual: true, content: false, structure: true };

/**
 * A shot of a LIVE site is not deterministic to the pixel — a carousel is on a
 * different slide, a lazy image resolved a moment later. Without a tolerance
 * every run reports noise, and a scoreboard that cries wolf stops being read,
 * which costs more than having no scoreboard at all.
 */
const DEFAULT_TOLERANCE = 1.5;

const key = (s: PageScore): string => `${s.url} @${s.width}`;

export function compareBaseline(prev: Baseline, next: Baseline, tolerance = DEFAULT_TOLERANCE): Comparison {
  const before = new Map(prev.scores.map((s) => [key(s), s]));
  const after = new Map(next.scores.map((s) => [key(s), s]));

  const regressions: Move[] = [];
  const improvements: Move[] = [];
  for (const [k, now] of after) {
    const was = before.get(k);
    if (!was) continue;
    for (const metric of ['visual', 'content', 'structure'] as Metric[]) {
      const wasVal = was[metric];
      const nowVal = now[metric];
      // ABSENT ON EITHER SIDE IS NOT A MOVE. `visual` is missing on every
      // offline row, and reading a missing value as 0 would report either a
      // fabricated regression (a real `visual` compared against an invented
      // perfect score) or a fabricated improvement (the reverse) — neither
      // run measured anything to compare.
      if (wasVal === undefined || nowVal === undefined) continue;
      const delta = nowVal - wasVal;
      if (Math.abs(delta) < tolerance) continue;
      const worse = LOWER_IS_BETTER[metric] ? delta > 0 : delta < 0;
      const move: Move = { url: now.url, width: now.width, metric, was: wasVal, now: nowVal, delta };
      (worse ? regressions : improvements).push(move);
    }
  }

  return {
    regressions,
    improvements,
    added: [...after.keys()].filter((k) => !before.has(k)),
    removed: [...before.keys()].filter((k) => !after.has(k)),
  };
}
