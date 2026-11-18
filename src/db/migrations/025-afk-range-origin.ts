import type { Migration } from './index.js';

/**
 * 24 -> 25: the first stage of an AFK range is the record the formation was set on, not a copy of it, so it loses the `AFK range`
 * tag; the stages after it keep theirs. The attempts of a range were saved together with the same formation, so they are found as
 * the tagged Stage attempts that share a creation time, a stage kind and phase and a formation, and the lowest stage number of each
 * group is the first. A group that is not a run of consecutive stages was merged from two ranges, or one was edited: the migration
 * stops instead of guessing.
 */
export const migration: Migration = (db) => {
  const rows = db
    .prepare(
      `SELECT a.id AS attemptId, a.created_at AS createdAt, s.kind, s.phase, s.number, f.id AS formationId,
              f.artifact, f.phantimal_name, f.phantimal_tile, f.phantimal_partner_tile, f.assist_hero, f.assist_rank,
              f.assist_equipment_level, f.formation_id AS code
       FROM attempt a
       JOIN attempt_tag t ON t.attempt_id = a.id AND t.tag = 'AFK range'
       JOIN stage_attempt sa ON sa.attempt_id = a.id
       JOIN stage s ON s.id = sa.stage_id
       LEFT JOIN formation f ON f.attempt_id = a.id
       WHERE a.mode = 'Stage'`,
    )
    .all() as any[];
  if (rows.length === 0) return; // also keeps a file stamped past an earlier version, whose tables may differ, from being read
  const heroes = db.prepare('SELECT tile, hero_name, part, rank, equipment_level FROM formation_hero WHERE formation_id = ? ORDER BY tile');

  const groups = new Map<string, { attemptId: number; number: number }[]>();
  for (const r of rows) {
    const { attemptId, number, formationId, createdAt, kind, phase, ...formation } = r;
    const placed = formationId === null ? [] : heroes.all(formationId);
    const key = JSON.stringify([createdAt, kind, phase, formation, placed]);
    groups.set(key, [...(groups.get(key) ?? []), { attemptId, number }]);
  }

  const untag = db.prepare("DELETE FROM attempt_tag WHERE attempt_id = ? AND tag = 'AFK range'");
  for (const group of groups.values()) {
    group.sort((a, b) => a.number - b.number);
    group.forEach((g, i) => {
      if (i > 0 && g.number !== group[i - 1]!.number + 1) {
        throw new Error(`Migration 25: the AFK range attempts ${group.map((x) => x.number).join(', ')} are not consecutive stages`);
      }
    });
    untag.run(group[0]!.attemptId);
  }
};
