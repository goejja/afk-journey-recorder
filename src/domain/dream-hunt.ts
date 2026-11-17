import { layoutKey, type Layout } from './layout.js';
const MAX_CLEAR_SECONDS = 3600;
/** A composition with fewer clears than this is flagged: random variation can still dominate its times. */
export const MIN_CLEARS_FOR_CONFIDENCE = 3;

export interface DreamHuntResult {
  outcome: unknown;
  timeSeconds: unknown;
}

/** Returns an error message, or null. A cleared fight needs a time; a failed one has none. */
export function validateDreamHuntResult(result: DreamHuntResult): string | null {
  if (result.outcome !== 'Win' && result.outcome !== 'Loss') return 'The outcome must be Win or Loss';
  if (result.outcome === 'Loss') return result.timeSeconds === null || result.timeSeconds === undefined ? null : 'A failed fight has no clear time';
  const t = result.timeSeconds;
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0 || t > MAX_CLEAR_SECONDS) {
    return `A cleared fight needs a time above 0 seconds and up to ${MAX_CLEAR_SECONDS / 60} minutes`;
  }
  return null;
}

/**
 * Reads a clear time as a number of seconds, hundredths included; null when it is not a time. Seconds are the
 * usual unit, so a bare number is seconds: "9.69", "9.69s", "9s69" (9.69), "83". Minutes: "1:10", "1:09.5", "1m10",
 * "1m10s", "1m". A comma works as the decimal point.
 */
export function parseDuration(text: string): number | null {
  const clean = text.trim().toLowerCase().replace(/\s+/g, '');
  const fraction = (digits: string | undefined) => (digits ? Number(`0.${digits}`) : 0);
  const inMinute = (seconds: number) => seconds < 60;
  let total: number | null = null;

  let match = /^(\d+):(\d{1,2})(?:[.,](\d+))?$/.exec(clean);
  if (match) {
    const seconds = Number(match[2]) + fraction(match[3]);
    total = inMinute(seconds) ? Number(match[1]) * 60 + seconds : null;
  } else if ((match = /^(\d+)m(?:in)?(?:(\d+)(?:[.,](\d+))?s?)?$/.exec(clean))) {
    const seconds = Number(match[2] ?? 0) + fraction(match[3]);
    total = inMinute(seconds) ? Number(match[1]) * 60 + seconds : null;
  } else if ((match = /^(\d+)s(\d+)$/.exec(clean))) {
    total = Number(match[1]) + fraction(match[2]);
  } else if ((match = /^(\d+)(?:[.,](\d+))?s?$/.exec(clean))) {
    total = Number(match[1]) + fraction(match[2]);
  }
  return total === null ? null : Math.round(total * 1000) / 1000;
}

/** A time as the player reads it: "9.69s" under a minute, "1:09.5" from a minute, hundredths only when there are some. */
export function formatDuration(seconds: number): string {
  const hundredths = Math.round(seconds * 100);
  const whole = Math.floor(hundredths / 100);
  const rest = hundredths % 100;
  const fraction = rest === 0 ? '' : `.${String(rest).padStart(2, '0').replace(/0$/, '')}`;
  if (whole < 60) return `${whole}${fraction}s`;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}${fraction}`;
}

/** A time with its hundredths always written, so times line up in a column: "47.70s" under a minute, "1:32.00" from a minute. */
export function formatDurationFixed(seconds: number): string {
  const hundredths = Math.round(seconds * 100);
  const whole = Math.floor(hundredths / 100);
  const fraction = String(hundredths % 100).padStart(2, '0');
  if (whole < 60) return `${whole}.${fraction}s`;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${fraction}`;
}

export interface DreamHuntRun {
  attemptId: number;
  heroes: string[];
  artifact: string | null;
  outcome: 'Win' | 'Loss';
  timeSeconds: number | null;
  /** Where the team stood and on which map; without it the run only counts for its composition. */
  mapName?: string;
  layout?: Layout;
  /** The Rule the fight was played under, if any; it only matters to `summarizeCompositions` when asked to split by Rule. */
  bossRule?: string | null;
}

/** The figures of a team's fights played under a Rule (any Rule, all together): they are shown beside the normal ones, never ranked. */
export interface RuleTimes {
  attempts: number;
  clears: number;
  bestSeconds: number | null;
  medianSeconds: number | null;
  worstSeconds: number | null;
  /** Every clear time, fastest first: each is a dot on the times bar. */
  times: number[];
  /** The distinct Rules these fights were played under. */
  rules: string[];
}

/** One way a composition was set up on a map, with how its fights went. */
export interface LayoutSummary {
  key: string;
  mapName: string;
  layout: Layout;
  attempts: number;
  clears: number;
  bestSeconds: number | null;
  medianSeconds: number | null;
  worstSeconds: number | null;
  lowConfidence: boolean;
  latestAttemptId: number;
  /** The fights under a Rule when the summary is split by Rule (the figures above are then those without a Rule); null when there are none. */
  rule: RuleTimes | null;
}

export interface CompositionSummary {
  key: string;
  heroes: string[];
  artifact: string | null;
  attempts: number;
  clears: number;
  clearRate: number;
  bestSeconds: number | null;
  medianSeconds: number | null;
  meanSeconds: number | null;
  worstSeconds: number | null;
  /** True while the composition has fewer than MIN_CLEARS_FOR_CONFIDENCE clears. */
  lowConfidence: boolean;
  /** The newest attempt of this composition, to look up its placement and hero levels. */
  latestAttemptId: number;
  /** Each distinct map and Layout the team was fought with, fastest first (see summarizeLayouts). */
  layouts: LayoutSummary[];
  /** The fights under a Rule when the summary is split by Rule (the figures above are then those without a Rule); null when there are none. */
  rule: RuleTimes | null;
}

/** A team with no clear without a Rule but a clear under one: it looks as good as its boost, so it ranks behind the others. */
export function isRuleOnly(summary: { clears: number; rule: RuleTimes | null }): boolean {
  return summary.clears === 0 && (summary.rule?.clears ?? 0) > 0;
}

const median = (sorted: number[]) => {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const clearTimes = (runs: DreamHuntRun[]) => runs.filter((r) => r.outcome === 'Win' && r.timeSeconds !== null).map((r) => r.timeSeconds!).sort((a, b) => a - b);

/** The figures of the fights played under a Rule, or null when there are none. */
function ruleTimes(runs: DreamHuntRun[]): RuleTimes | null {
  if (runs.length === 0) return null;
  const times = clearTimes(runs);
  return {
    attempts: runs.length,
    clears: times.length,
    bestSeconds: times[0] ?? null,
    medianSeconds: times.length ? median(times) : null,
    worstSeconds: times.at(-1) ?? null,
    times,
    rules: [...new Set(runs.map((r) => r.bossRule!))].sort(),
  };
}

/** Splits the fights into those with no Rule and those under one; unsplit, every fight counts as a normal one. */
const splitByRule = (runs: DreamHuntRun[], split: boolean) =>
  split ? { normal: runs.filter((r) => !r.bossRule), ruled: runs.filter((r) => r.bossRule) } : { normal: runs, ruled: [] };

/** Which group a summary ranks in: cleared without a Rule, cleared only under one, or never cleared. */
const tier = (s: { clears: number; rule: RuleTimes | null }) => (s.clears > 0 ? 0 : isRuleOnly(s) ? 1 : 2);

/**
 * Splits the fights of one composition by map and Layout. Layouts with clears come first, fastest median first,
 * then the one with more clears; the thinly tested ones are flagged. Layouts cleared only under a Rule follow, then
 * the ones never cleared.
 */
function summarizeLayouts(group: DreamHuntRun[], split: boolean): LayoutSummary[] {
  const byLayout = new Map<string, DreamHuntRun[]>();
  for (const run of group) {
    if (!run.layout) continue;
    const key = `${run.mapName ?? ''}#${layoutKey(run.layout)}`;
    byLayout.set(key, [...(byLayout.get(key) ?? []), run]);
  }
  return [...byLayout.entries()]
    .map(([key, runs]): LayoutSummary => {
      const { normal, ruled } = splitByRule(runs, split);
      const times = clearTimes(normal);
      return {
        key,
        mapName: runs[0]!.mapName ?? '',
        layout: runs[0]!.layout!,
        attempts: normal.length,
        clears: times.length,
        bestSeconds: times[0] ?? null,
        medianSeconds: times.length ? median(times) : null,
        worstSeconds: times.at(-1) ?? null,
        lowConfidence: times.length < MIN_CLEARS_FOR_CONFIDENCE,
        latestAttemptId: Math.max(...runs.map((r) => r.attemptId)),
        rule: ruleTimes(ruled),
      };
    })
    .sort((a, b) => {
      if (tier(a) !== tier(b)) return tier(a) - tier(b);
      if (a.clears > 0) return a.medianSeconds! - b.medianSeconds! || b.clears - a.clears;
      if (tier(a) === 1) return a.rule!.medianSeconds! - b.rule!.medianSeconds!;
      return b.attempts + (b.rule?.attempts ?? 0) - (a.attempts + (a.rule?.attempts ?? 0));
    });
}

/** Whether a team holds every `include` hero and none of the `exclude` heroes (the Include and Exclude filters of Best teams and the Finder). */
export function keepsHeroes(heroes: string[], include: string[], exclude: string[]): boolean {
  const held = new Set(heroes);
  return include.every((hero) => held.has(hero)) && !exclude.some((hero) => held.has(hero));
}

/**
 * Groups fights by composition (the same heroes and artifact, wherever they stand) and summarizes
 * the spread of their clear times, because times vary from fight to fight. Ranking: compositions with
 * enough clears to trust come first, fastest median first, so one lucky run cannot top the list; thinly
 * tested ones follow (still ranked by median, but flagged); never-cleared ones come last.
 *
 * With `splitRules` the figures are those of the fights with no Rule only, and the fights under a Rule go
 * to `rule`: a Rule boosts the player, so it must not decide the ranking, the clear rate or the flag. A composition
 * cleared only under a Rule ranks after the ones cleared without, then the ones never cleared.
 */
export function summarizeCompositions(runs: DreamHuntRun[], { splitRules = false } = {}): CompositionSummary[] {
  const groups = new Map<string, DreamHuntRun[]>();
  for (const run of runs) {
    const key = `${[...run.heroes].sort().join('|')}#${run.artifact ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const summaries = [...groups.entries()].map(([key, group]): CompositionSummary => {
    const { normal, ruled } = splitByRule(group, splitRules);
    const times = clearTimes(normal);
    return {
      key,
      heroes: [...group[0]!.heroes].sort(),
      artifact: group[0]!.artifact,
      attempts: normal.length,
      clears: times.length,
      clearRate: normal.length ? times.length / normal.length : 0,
      bestSeconds: times[0] ?? null,
      medianSeconds: times.length ? median(times) : null,
      meanSeconds: times.length ? times.reduce((sum, t) => sum + t, 0) / times.length : null,
      worstSeconds: times.at(-1) ?? null,
      lowConfidence: times.length < MIN_CLEARS_FOR_CONFIDENCE,
      latestAttemptId: Math.max(...group.map((r) => r.attemptId)),
      layouts: summarizeLayouts(group, splitRules),
      rule: ruleTimes(ruled),
    };
  });
  return summaries.sort((a, b) => {
    if (tier(a) !== tier(b)) return tier(a) - tier(b);
    if (a.clears > 0) {
      if (a.lowConfidence !== b.lowConfidence) return a.lowConfidence ? 1 : -1;
      return a.medianSeconds! - b.medianSeconds! || b.clearRate - a.clearRate || b.attempts - a.attempts;
    }
    if (tier(a) === 1) return a.rule!.medianSeconds! - b.rule!.medianSeconds! || b.rule!.clears - a.rule!.clears;
    return b.attempts + (b.rule?.attempts ?? 0) - (a.attempts + (a.rule?.attempts ?? 0));
  });
}

/** A Dream Hunt day has five boss fights; the heroes of one cannot be used in another. */
export const DREAM_HUNT_FIGHTS = 5;
