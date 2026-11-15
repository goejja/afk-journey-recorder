import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openDb } from '../src/db/open.js';
import { applyBackfill, planBackfill, type LabelMatch } from '../src/import/picture-backfill.js';

const USAGE = `Matches the pictures named in the notes of saved Battle imports ("Imported from IMG_0001.jpeg: ...") to the files in a folder, and reports what a backfill would do. With --apply it keeps the matched pictures under images/imports and links them to their records (ADR 0016), as saving from the form does; without it nothing changes. With --move it also removes the files from the folder once the stored copy has been read back and found identical (it implies --apply). Run it again safely: a picture already kept is not stored twice.
Usage: npm run backfill:pictures -- [--folder tmp] [--db data/afk.db] [--images images] [--list] [--missing] [--apply] [--move]`;

const { values } = parseArgs({ options: { folder: { type: 'string', default: 'tmp' }, db: { type: 'string', default: 'data/afk.db' }, list: { type: 'boolean', default: false }, missing: { type: 'boolean', default: false }, images: { type: 'string', default: 'images' }, apply: { type: 'boolean', default: false }, move: { type: 'boolean', default: false }, help: { type: 'boolean', default: false } } });
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!existsSync(values.db!)) {
  console.error(`No database at ${values.db}`);
  process.exit(1);
}
const db = openDb(values.db!);
const matches = planBackfill(db, values.folder!);

const by = (status: LabelMatch['status']) => matches.filter((m) => m.status === status);
const records = (list: LabelMatch[]) => list.reduce((sum, m) => sum + m.records.length, 0);
console.log(`${matches.length} pictures named by ${records(matches)} records, searched in ${values.folder}`);
for (const status of ['unique', 'missing', 'ambiguous', 'mode-differs', 'not-a-report'] as const) console.log(`  ${status.padEnd(13)} ${String(by(status).length).padStart(4)} pictures, ${String(records(by(status))).padStart(4)} records`);
const shared = matches.filter((m) => new Set(m.records.map((r) => r.battleId ?? `a${r.attemptId}`)).size > 1);
console.log(`  named by records of more than one battle: ${shared.length} pictures`);
// a picture that is no longer in the folder is counted above and listed only on request: its record is fine without it
for (const m of matches.filter((x) => (x.status !== 'unique' && (x.status !== 'missing' || values.missing)) || values.list)) {
  console.log(`${m.status.padEnd(13)} ${m.label}${m.detail ? ` (${m.detail})` : ''}: records ${m.records.map((r) => `${r.attemptId}/${r.mode}`).join(', ')}${m.files.length > 0 ? `; files ${m.files.map((f) => f.path).join(', ')}` : ''}`);
}
for (const m of shared) console.log(`shared        ${m.label}: battles ${[...new Set(m.records.map((r) => r.battleId))].join(', ')}`);

if (values.apply || values.move) {
  const done = await applyBackfill(db, values.folder!, values.images!, matches, { move: values.move });
  console.log(`Kept ${done.pictures} pictures for ${done.records} records in ${values.images}/imports/report${done.failed.length > 0 ? `; not kept: ${done.failed.join(', ')}` : ''}`);
  if (values.move) console.log(`Removed ${done.removed.length} files from ${values.folder}`);
} else console.log(`Nothing was changed. Add --apply to keep the ${by('unique').length} matched pictures, or --move to also remove them from ${values.folder}.`);
db.close();
