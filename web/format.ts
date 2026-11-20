import { weaponLabel } from '../src/domain/exclusive-weapon.js';

/** A rate from 0 to 1 as a whole percentage: 0.724 becomes "72%". */
export const percent = (rate: number) => `${Math.round(rate * 100)}%`;

/** A difference of rates as signed percentage points: -0.08 becomes "−8 pts". */
export const points = (delta: number) => `${delta < 0 ? '−' : '+'}${Math.round(Math.abs(delta) * 100)} pts`;

/** The wins and losses of a result: "5–2". */
export const record = (r: { games: number; wins: number }) => `${r.wins}–${r.games - r.wins}`;

/** A copy of the set with the item taken out if it was in, put in if it was not. */
export function toggled<T>(set: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(item)) next.add(item);
  return next;
}

/** A hero's rank and equipment for a table cell: "Mythic+ +10", or "no rank" when it has none. */
export const heroStateText = (s: { rank: string | null; equipmentLevel: number | null }) => `${s.rank ?? 'no rank'}${s.equipmentLevel !== null ? ` ${weaponLabel(s.equipmentLevel)}` : ''}`;

/** Where a proposed team comes from: a team the player used, a one-hero variant of it, or one built from the statistics of a formation group. */
export const ORIGIN_LABEL = {
  recorded: 'Played',
  variant: 'Swap of a played team',
  built: 'Built from statistics, never played',
} as const;
