import type { Migration } from './index.js';

/**
 * 2 -> 3: the part of a hero's unit is called `part`, the word the glossary uses (ADR 0028). The stored rows keep their
 * shape; only the column and the two JSON payloads change name. (This is what ran; the Deployment folding is 3 -> 4,
 * because a migration once applied is never edited.)
 */
export const migration: Migration = (db) => {
  for (const table of ['formation_hero', 'arena_opponent_hero', 'scenario_hero']) db.exec(`ALTER TABLE ${table} RENAME COLUMN unit TO part`);
  const rename = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rename);
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value)) out[key === 'unit' ? 'part' : key] = rename(inner);
      return out;
    }
    return value;
  };
  for (const [table, column] of [
    ['formation_id', 'deployment'],
    ['round_deployment', 'content'],
  ] as const) {
    const rows = db.prepare(`SELECT rowid AS id, ${column} AS body FROM ${table}`).all() as { id: number; body: string }[];
    const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
    for (const row of rows) update.run(JSON.stringify(rename(JSON.parse(row.body))), row.id);
  }
};
