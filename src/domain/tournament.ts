/** The stages of a Super League Tournament, in the order they are played. Each Player's Deployment stays fixed within one. */
export const ROUNDS = ['Group stage', 'Swiss stage', 'Top 48', 'Top 16', 'Semi-Finals', 'Finals'] as const;
export type Round = (typeof ROUNDS)[number];

export const isRound = (value: unknown): value is Round => typeof value === 'string' && (ROUNDS as readonly string[]).includes(value);

/** The Tournament and Round a battle body names: both or neither, and only for Super League. `undefined` means the body says nothing. */
export type TournamentRound = { tournamentId: number; round: Round } | { tournamentId: null; round: null } | undefined;

export function checkTournamentRound(mode: string, body: { tournamentId?: unknown; round?: unknown } | null | undefined): TournamentRound | { error: string } {
  const named = body !== null && body !== undefined && ('tournamentId' in body || 'round' in body);
  if (!named) return undefined;
  const { tournamentId, round } = body;
  if ((tournamentId ?? null) === null && (round ?? null) === null) return { tournamentId: null, round: null };
  if (mode !== 'Super League') return { error: 'Only Super League battles have a Tournament and a Round' };
  if (!Number.isInteger(tournamentId) || (tournamentId as number) < 1) return { error: 'The Tournament must be a Tournament id' };
  if (!isRound(round)) return { error: `The Round must be one of ${ROUNDS.join(', ')}` };
  return { tournamentId: tournamentId as number, round };
}

export interface TournamentSummary {
  id: number;
  season: number;
  number: number;
  /** The Rounds that have Battles saved in this Tournament. */
  rounds: Round[];
}

export type RoundWarning =
  | { kind: 'older-tournament'; latest: { id: number; season: number; number: number } }
  | { kind: 'earlier-round'; latest: Round };

const tournamentOrder = (a: TournamentSummary, b: TournamentSummary): number => a.season - b.season || a.number - b.number;

/**
 * What to tell the player before a batch import into a Tournament and Round: it is not the latest Tournament, or its Round comes before
 * one that already has Battles. Both are allowed (a late import of an earlier Round is normal) but a Round Deployment must never
 * come from the wrong place, so the player is asked to look twice.
 */
export function roundWarnings(chosen: { tournamentId: number; round: Round }, tournaments: TournamentSummary[]): RoundWarning[] {
  const picked = tournaments.find((t) => t.id === chosen.tournamentId);
  if (!picked) return [];
  const warnings: RoundWarning[] = [];
  const latest = [...tournaments].sort(tournamentOrder).at(-1)!;
  if (latest.id !== picked.id) warnings.push({ kind: 'older-tournament', latest: { id: latest.id, season: latest.season, number: latest.number } });
  const lastRound = Math.max(-1, ...picked.rounds.map((r) => ROUNDS.indexOf(r)));
  if (ROUNDS.indexOf(chosen.round) < lastRound) warnings.push({ kind: 'earlier-round', latest: ROUNDS[lastRound]! });
  return warnings;
}

/**
 * The saved fights a batch import may take its formations from. In a Tournament and Round, only the Battles of that same Round: the
 * Players update their Deployment between Rounds and between Tournaments. With no Tournament (an old Battle, or another mode), only
 * Battles that have none either, which is how the inferred Known Round worked.
 */
export function reusableIn<T extends { tournamentId: number | null; round: Round | null }>(fights: T[], chosen: { tournamentId: number; round: Round } | null): T[] {
  return fights.filter((f) => (chosen === null ? f.tournamentId === null : f.tournamentId === chosen.tournamentId && f.round === chosen.round));
}
