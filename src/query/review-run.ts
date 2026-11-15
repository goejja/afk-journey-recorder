import type Database from 'better-sqlite3';
import type { ReviewFinding, ReviewFindings } from '../shared/api.js';

/** A finding is the same one in two runs when its code, subject and message are (ADR 0032). */
const identity = (f: ReviewFinding) => JSON.stringify([f.code, f.subject, f.message]);

/**
 * A stored Review run with each finding marked `new` when the run before it did not have it (the first run has none that is new). What the player
 * dismissed is taken out of the lists and returned apart, whatever run it is in.
 */
export function loadReviewRun(db: Database.Database, id: number) {
  const row = db.prepare('SELECT id, created_at AS createdAt, findings, explanation, explained_at AS explainedAt FROM review_run WHERE id = ?').get(id) as
    | { id: number; createdAt: string; findings: string; explanation: string | null; explainedAt: string | null }
    | undefined;
  if (!row) return null;
  const previous = db.prepare('SELECT findings FROM review_run WHERE id < ? ORDER BY id DESC LIMIT 1').pluck().get(id) as string | undefined;
  const findings = JSON.parse(row.findings) as ReviewFindings;
  const before = previous ? (JSON.parse(previous) as ReviewFindings) : null;
  const known = before ? new Set([...before.wrong, ...before.obsolete, ...before.improve].map(identity)) : null;
  const mark = (list: ReviewFinding[]) => list.map((f) => ({ ...f, new: known !== null && !known.has(identity(f)) }));
  const marked = { ...findings, wrong: mark(findings.wrong), obsolete: mark(findings.obsolete), improve: mark(findings.improve) };
  const dismissals = new Set((db.prepare('SELECT code, subject, message FROM review_dismissal').all() as ReviewFinding[]).map(identity));
  const shown = (list: ReviewFinding[]) => list.filter((f) => !dismissals.has(identity(f)));
  const dismissed = [...marked.wrong, ...marked.obsolete, ...marked.improve].filter((f) => dismissals.has(identity(f)));
  return {
    id: row.id,
    createdAt: row.createdAt,
    findings: { ...marked, wrong: shown(marked.wrong), obsolete: shown(marked.obsolete), improve: shown(marked.improve) },
    dismissed,
    explanation: row.explanation ? { text: row.explanation, at: row.explainedAt } : null,
  };
}

/** The id of the last Review run, or null when none was run. */
export const latestReviewRunId = (db: Database.Database): number | null => db.prepare('SELECT max(id) FROM review_run').pluck().get() as number | null;

/** What the Agent reads to explain a Review run: the last one, or the one asked for. The dismissed findings are counted, not listed. */
export function reviewRun(db: Database.Database, id?: number): { run: { id: number; createdAt: string } | null; note?: string; findings?: ReviewFindings; dismissed?: number } {
  const wanted = id ?? latestReviewRunId(db);
  if (wanted === null) return { run: null, note: 'No review has been run yet: start one in Admin > Review.' };
  const run = loadReviewRun(db, wanted);
  if (!run) return { run: null, note: `Unknown review run ${wanted}` };
  return { run: { id: run.id, createdAt: run.createdAt }, findings: run.findings, dismissed: run.dismissed.length };
}
