import type Database from 'better-sqlite3';

/**
 * Heroes whose name a source changed, old spelling to the spelling the database keeps. Yaphalla wrote "Taichi&Agumon" and
 * "YamatoGabumon" and now writes "Taichi & Agumon" and "Yamato & Gabumon" (#387). Add a hero here when a source renames it.
 */
export const HERO_RENAMES: Record<string, string> = {
  'Taichi&Agumon': 'Taichi & Agumon',
  YamatoGabumon: 'Yamato & Gabumon',
};

/** The name the database keeps for a hero a source may still spell the old way. */
export const canonicalHeroName = (name: string): string => HERO_RENAMES[name] ?? name;

interface Column {
  table: string;
  column: string;
}

/** Every text column of every table: a hero is named by foreign keys, by plain text columns and inside JSON documents. */
function textColumns(db: Database.Database): Column[] {
  return db
    .prepare(
      `SELECT m.name AS "table", p.name AS "column" FROM sqlite_master m, pragma_table_info(m.name) p
       WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name <> 'hero' AND (p.type = '' OR p.type LIKE '%TEXT%' OR p.type LIKE '%CHAR%')`,
    )
    .all() as Column[];
}

/** The better of two roster rows of one hero: the higher rank, then the higher equipment level. */
function mergeRoster(db: Database.Database, from: string, into: string): void {
  const rows = db
    .prepare(
      `SELECT a.profile_id AS profile, a.rank AS aRank, a.equipment_level AS aLevel, b.rank AS bRank, b.equipment_level AS bLevel,
              COALESCE((SELECT position FROM rank WHERE name = a.rank), -1) AS aPos, COALESCE((SELECT position FROM rank WHERE name = b.rank), -1) AS bPos
       FROM roster a JOIN roster b ON b.profile_id = a.profile_id AND b.hero_name = ? WHERE a.hero_name = ?`,
    )
    .all(into, from) as { profile: number; aRank: string | null; aLevel: number | null; bRank: string | null; bLevel: number | null; aPos: number; bPos: number }[];
  for (const r of rows) {
    const newer = r.bPos > r.aPos || (r.bPos === r.aPos && (r.bLevel ?? -1) > (r.aLevel ?? -1));
    if (newer) db.prepare('UPDATE roster SET rank = ?, equipment_level = ? WHERE profile_id = ? AND hero_name = ?').run(r.bRank, r.bLevel, r.profile, from);
    db.prepare('DELETE FROM roster WHERE profile_id = ? AND hero_name = ?').run(r.profile, into);
  }
}

/**
 * Moves the rows that name `to` over to `from`, the old hero that is kept. Where that repeats a row of the old hero (same key), the old row
 * wins, being what the player built, unless the new row was written by hand (`source` = 'manual') and the old one was not.
 */
function moveToKeptHero(db: Database.Database, columns: Column[], from: string, to: string): void {
  for (const { table, column } of columns) {
    const info = db.prepare(`SELECT name, pk FROM pragma_table_info(?)`).all(table) as { name: string; pk: number }[];
    if (info.some((c) => c.name === 'source') && info.some((c) => c.name === column && c.pk > 0)) {
      const others = info.filter((c) => c.pk > 0 && c.name !== column).map((c) => `n."${c.name}" IS "${table}"."${c.name}"`);
      db.prepare(
        `DELETE FROM "${table}" WHERE "${column}" = ? AND source <> 'manual'
         AND EXISTS (SELECT 1 FROM "${table}" n WHERE n."${column}" = ? AND n.source = 'manual'${others.map((o) => ` AND ${o}`).join('')})`,
      ).run(from, to);
    }
    db.prepare(`UPDATE OR IGNORE "${table}" SET "${column}" = ? WHERE "${column}" = ?`).run(from, to);
    db.prepare(`DELETE FROM "${table}" WHERE "${column}" = ?`).run(to);
  }
}

/** Changes a name in place; where that would repeat a row that already exists, the row with the old name is dropped. */
function renameText(db: Database.Database, columns: Column[], from: string, to: string): void {
  for (const { table, column } of columns) {
    db.prepare(`UPDATE OR IGNORE "${table}" SET "${column}" = ? WHERE "${column}" = ?`).run(to, from);
    db.prepare(`DELETE FROM "${table}" WHERE "${column}" = ?`).run(from);
  }
}

/**
 * Makes the heroes that a source renamed (HERO_RENAMES) one hero under the new name: the old hero row is renamed, the new row a sync may
 * have added next to it is dropped, and every roster, record, hint and JSON document that names the old spelling names the new one. Where
 * a profile has both roster rows, the higher rank (then the higher equipment level) is kept; where both heroes have a hint, attribute or other keyed row, the old hero's row is kept, unless only the new one was written by hand (`source` = 'manual'). Safe to run again.
 */
export function mergeRenamedHeroes(db: Database.Database): void {
  db.transaction(() => {
    // the checks wait until the end, when every row names a hero that exists again
    db.pragma('defer_foreign_keys = ON');
    const columns = textColumns(db);
    for (const [from, to] of Object.entries(HERO_RENAMES)) {
      const old = db.prepare('SELECT 1 FROM hero WHERE name = ?').get(from);
      if (old) {
        mergeRoster(db, from, to);
        moveToKeptHero(db, columns, from, to);
        db.prepare('DELETE FROM hero WHERE name = ?').run(to);
        db.prepare('UPDATE hero SET name = ?, image_path = REPLACE(image_path, ?, ?) WHERE name = ?').run(to, from, to, from);
      }
      renameText(db, columns, from, to);
      for (const { table, column } of columns) {
        db.prepare(`UPDATE "${table}" SET "${column}" = REPLACE("${column}", ?, ?) WHERE INSTR("${column}", ?) > 0`).run(`"${from}"`, `"${to}"`, `"${from}"`);
      }
    }
  })();
}
