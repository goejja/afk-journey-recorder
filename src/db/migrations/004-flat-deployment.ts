import type { Migration } from './index.js';

/**
 * 3 -> 4: a stored Deployment is one flat list of Units with the Phantimal's folded in, as `Layout` now is (ADR 0028).
 * Idempotent, so it is safe on a file that already holds the new shape.
 */
export const migration: Migration = (db) => {
  const PAIR_PHANTIMAL: Record<string, string> = { 'Wedge of Matter': 'Wedge of Power' };
  interface Team {
    units?: { kind?: 'hero' | 'phantimal'; hero: string; part?: string; tile: number }[];
    phantimal?: { name: string; tile: number; partnerTile?: number | null } | null;
    artifact?: string | null;
  }
  const foldTeam = (team: Team | null) => {
    if (!team) return team;
    const units = (team.units ?? []).map((u) => ({ kind: u.kind ?? 'hero', hero: u.hero, part: u.part ?? '', tile: u.tile }));
    if (team.phantimal) {
      units.push({ kind: 'phantimal', hero: team.phantimal.name, part: '', tile: team.phantimal.tile });
      if (team.phantimal.partnerTile != null) {
        units.push({ kind: 'phantimal', hero: team.phantimal.name, part: PAIR_PHANTIMAL[team.phantimal.name] ?? '', tile: team.phantimal.partnerTile });
      }
    }
    return { units, artifact: team.artifact ?? null };
  };
  for (const row of db.prepare('SELECT rowid AS id, deployment AS body FROM formation_id').all() as { id: number; body: string }[]) {
    const deployment = JSON.parse(row.body) as { teams: (Team | null)[] };
    db.prepare('UPDATE formation_id SET deployment = ? WHERE rowid = ?').run(JSON.stringify({ teams: deployment.teams.map(foldTeam) }), row.id);
  }
};
