import type { DreamHuntRun } from '../domain/dream-hunt.js';
import type { Layout } from '../domain/layout.js';

/** The two plans of the Advisor: the lowest total of average clear times, or of best clear times. */
export type PlanKind = 'reliable' | 'fastest';

/** A recorded fight with what the Advisor needs besides the run itself. */
export interface AdvisorRun extends DreamHuntRun {
  /** The Rule the fight was fought under, null for none. */
  rule: string | null;
  /** A hero stood at a higher rank in that fight than in the roster now. */
  weaker: boolean;
  /** The fight was on or after the Update date; absent when no Update date is set. */
  since?: boolean;
}

/** One fight of the day: the boss, the Rule it carries this week (if any) and every recorded fight against that boss. */
export interface AdvisorSlot {
  boss: string;
  rule: string | null;
  runs: AdvisorRun[];
}

/** How a choice stands against the Update date: cleared since it, fought since it without a clear, or not fought since it. */
export type Freshness = 'since' | 'failed since' | 'not fought';

/** Which fights a plan draws on: all of them, with the ones since the Update date taking precedence, or only those. */
export type AdvisorScope = 'all' | 'since';

/** A team the player fixed for a fight: the heroes and the artifact, wherever they stand. */
export interface PinnedTeam {
  heroes: string[];
  artifact: string | null;
}

export interface AdvisorChoice {
  boss: string;
  heroes: string[];
  artifact: string | null;
  attempts: number;
  clears: number;
  failures: number;
  bestSeconds: number;
  meanSeconds: number;
  /** The time the plan counts: the average for the reliable plan, the best for the fastest. */
  seconds: number;
  /** Fewer clears than the minimum asked for. */
  belowMinimum: boolean;
  /** Cleared with a hero at a higher rank than the roster has now. */
  weaker: boolean;
  /** Cleared only under a Rule other than the slot's (the slot's own Rule, or none, did not clear it), so it ranks behind the others. */
  offRule: boolean;
  /** Against the Update date; null when none is set or the plan is of the fights since it. */
  freshness: Freshness | null;
  /** For a choice cleared since the Update date: its best clear over all its fights, when that is faster than the best since. */
  olderBestSeconds: number | null;
  /** The latest fight of this composition. */
  latestAttemptId: number;
  /** Where the heroes stood in the fastest-cleared way this team was fought, and on which map; null when no placement was recorded. */
  placement: { mapName: string; layout: Layout } | null;
  /** The player fixed this team (the Simulator); the plan did not choose it. */
  pinned: boolean;
  /** No clear of this team counts in the scope, so it adds no time to the plan. Only a pinned team can be like this. */
  noHistory: boolean;
  /** The fight that stood that way (the latest of the team when no placement was recorded), to start a new record from. */
  placementAttemptId: number;
}

type GapReason = 'no history' | 'no clear since the update' | 'no choice without a shared hero or artifact';

export interface AdvisorFight {
  boss: string;
  /** The slot has a Rule but no clear under it, so fights under other Rules were used. */
  ruleFallback: boolean;
  choice: AdvisorChoice | null;
  gap: GapReason | null;
}

export interface AdvisorPlan {
  kind: PlanKind;
  minimumClears: number;
  scope: AdvisorScope;
  fights: AdvisorFight[];
  /** Total of the chosen times; the fights without a choice add nothing. */
  totalSeconds: number;
  /** Pinned teams that have no clear to count, so the total leaves them out. */
  unknownFights: number;
}
