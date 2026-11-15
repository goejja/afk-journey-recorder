/** The cutoffs of the evidence labels. */
const LIMITED_GAMES = 30;
const LIMITED_PLAYERS = 5;
const TOP_PLAYER_SHARE = 0.35;
const TOP_TWO_PLAYERS_SHARE = 0.6;
const HIGH_WIN_RATE = 0.6;
const NARROW_USE_BELOW = 0.5;
const LOOKS_SHIFT = 0.05;
const LOOKS_MIN_GAMES = 10;

export interface LabelInput {
  games: number;
  wins: number;
  /** Games behind each known Player of the group; sides with no known Player are not listed. */
  playerGames: number[];
  /** The enemy groups this group is strong against (at least 5 games, 60% or more), named. */
  strongAgainst: string[];
  /** The expected win rate against an average opponent with equal upgrades, minus the recorded win rate, over the battles with a known upgrade gap; null when there is none. */
  gapAdjustment: { games: number; shift: number } | null;
}

export interface EvidenceLabel {
  name: string;
  /** What the label names, when it names something. */
  detail?: string;
}

/** The labels that hint how to read a group's record. Records have no ties, so every game counts. */
export function evidenceLabels(input: LabelInput): EvidenceLabel[] {
  const { games, wins, playerGames, strongAgainst, gapAdjustment } = input;
  const labels: EvidenceLabel[] = [];
  const winRate = games === 0 ? 0 : wins / games;
  const limited = games < LIMITED_GAMES || playerGames.length < LIMITED_PLAYERS;
  if (limited) labels.push({ name: 'Limited evidence' });

  const [first = 0, second = 0] = [...playerGames].sort((a, b) => b - a);
  if (games > 0 && (first / games >= TOP_PLAYER_SHARE || (first + second) / games >= TOP_TWO_PLAYERS_SHARE)) labels.push({ name: 'Concentrated sample' });

  if (limited && winRate >= HIGH_WIN_RATE) labels.push({ name: 'High win rate' });
  if (winRate < NARROW_USE_BELOW && strongAgainst.length > 0) labels.push({ name: 'Narrow use', detail: strongAgainst.join(', ') });

  if (gapAdjustment && gapAdjustment.games >= LOOKS_MIN_GAMES) {
    if (gapAdjustment.shift <= -LOOKS_SHIFT) labels.push({ name: 'Worse than it looks' });
    else if (gapAdjustment.shift >= LOOKS_SHIFT) labels.push({ name: 'Better than it looks' });
  }
  return labels;
}
