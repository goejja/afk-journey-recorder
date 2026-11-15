import type Database from 'better-sqlite3';
import { PlayerIdSchema } from '../../domain/profile.js';

export type PlayerSide = 'A' | 'B';

/**
 * Cleans the Player ID sent for one side: `undefined` leaves the side as it is, `null` or empty text removes the Player.
 * An error message when it is not text or too long.
 */
export function normalizePlayerId(input: unknown): { playerId: string | null | undefined } | { error: string } {
  const result = PlayerIdSchema.safeParse(input);
  return result.success ? { playerId: result.data } : { error: result.error.issues[0]?.message ?? 'The player ID must be text' };
}

/** The Player ID of one side of a record, or null when the side has no Player. */
export const loadPlayerId = (db: Database.Database, attemptId: number, side: PlayerSide): string | null =>
  (db.prepare('SELECT player_id FROM attempt_player WHERE attempt_id = ? AND side = ?').pluck().get(attemptId, side) as string | undefined) ?? null;

/** Sets or removes the Player ID of one side; `undefined` leaves it as it is. The other side is untouched. */
export function savePlayerId(db: Database.Database, attemptId: number, side: PlayerSide, playerId: string | null | undefined): void {
  if (playerId === undefined) return;
  db.prepare('DELETE FROM attempt_player WHERE attempt_id = ? AND side = ?').run(attemptId, side);
  if (playerId !== null) db.prepare('INSERT INTO attempt_player (attempt_id, side, player_id) VALUES (?, ?, ?)').run(attemptId, side, playerId);
}
