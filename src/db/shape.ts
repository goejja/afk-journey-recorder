import type Database from 'better-sqlite3';

/** What a table is, without how it was written: its columns, indexes and CHECK rules, so that column order and quoting do not matter. */
interface TableShape {
  columns: string[];
  foreignKeys: string[];
  indexes: string[];
  checks: string[];
}

export type Shape = Record<string, TableShape>;

const norm = (text: string) => text.replace(/"/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The text of every `CHECK (...)` in a CREATE TABLE statement, found by balancing the parentheses. */
function checksOf(sql: string): string[] {
  const found: string[] = [];
  const stripped = sql.replace(/--[^\n]*/g, '');
  for (const match of stripped.matchAll(/\bCHECK\s*\(/gi)) {
    let depth = 1;
    let end = match.index! + match[0].length;
    while (end < stripped.length && depth > 0) {
      if (stripped[end] === '(') depth += 1;
      else if (stripped[end] === ')') depth -= 1;
      end += 1;
    }
    found.push(norm(stripped.slice(match.index! + match[0].length, end - 1)));
  }
  return found.sort();
}

/** The shape of the tables and indexes of a database (views and SQLite's own tables are left out). */
export function shapeOf(db: Database.Database): Shape {
  const shape: Shape = {};
  const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string; sql: string }[];
  for (const { name, sql } of tables) {
    const columns = (db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[])
      .map((c) => norm(`${c.name} ${c.type} notnull=${c.notnull} default=${c.dflt_value ?? ''} pk=${c.pk}`))
      .sort();
    const foreignKeys = (db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as { table: string; from: string; to: string | null; on_update: string; on_delete: string }[])
      .map((f) => norm(`${f.from} -> ${f.table}.${f.to ?? ''} update=${f.on_update} delete=${f.on_delete}`))
      .sort();
    const indexes = (db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(name) as { name: string; sql: string }[])
      .map((i) => norm(i.sql.replace(/IF NOT EXISTS/i, '')))
      .sort();
    shape[name] = { columns, foreignKeys, indexes, checks: checksOf(sql) };
  }
  return shape;
}

/** What differs between a database and the shape it should have, as readable lines; empty when they agree. */
export function shapeDifferences(actual: Shape, expected: Shape): string[] {
  const lines: string[] = [];
  for (const table of Object.keys(expected)) {
    if (!(table in actual)) {
      lines.push(`table ${table} is missing`);
      continue;
    }
    for (const part of ['columns', 'foreignKeys', 'indexes', 'checks'] as const) {
      const have = new Set(actual[table]![part]);
      const want = new Set(expected[table]![part]);
      for (const item of want) if (!have.has(item)) lines.push(`${table}: missing ${part.replace(/s$/, '')} ${item}`);
      for (const item of have) if (!want.has(item)) lines.push(`${table}: extra ${part.replace(/s$/, '')} ${item}`);
    }
  }
  for (const table of Object.keys(actual)) if (!(table in expected)) lines.push(`table ${table} is not part of the schema`);
  return lines;
}
