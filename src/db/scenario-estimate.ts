import type Database from 'better-sqlite3';
import { validateEstimate } from '../domain/scenario.js';

/**
 * Writes the estimate of a scenario, or removes it when the text is empty. The one place that checks the length, for
 * the Run button, the `scenario:estimate` script and the estimate route. Returns an error message, or null when saved.
 */
export function saveEstimate(db: Database.Database, id: number, text: string): string | null {
  const trimmed = text.trim();
  const error = validateEstimate(trimmed);
  if (error) return error;
  const changed = db
    .prepare("UPDATE scenario SET estimate = ?, estimate_at = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END WHERE id = ?")
    .run(trimmed || null, trimmed || null, id).changes;
  return changed === 0 ? `No scenario with id ${id}` : null;
}
