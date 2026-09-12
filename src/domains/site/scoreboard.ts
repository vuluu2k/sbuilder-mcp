/** One page at one width. */
export interface PageScore {
  url: string;
  width: number;
  /** Per cent of pixels that differ from the source. LOWER is better. */
  visual: number;
  /** `coverage` — per cent of the source's non-chrome text kept. HIGHER is better. */
  content: number;
  /** Tree-shape distance from the source's captured tree. LOWER is better. */
  structure: number;
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
      const delta = now[metric] - was[metric];
      if (Math.abs(delta) < tolerance) continue;
      const worse = LOWER_IS_BETTER[metric] ? delta > 0 : delta < 0;
      const move: Move = { url: now.url, width: now.width, metric, was: was[metric], now: now[metric], delta };
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
