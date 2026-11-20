import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { openDb } from '../src/db/open.js';
import { checkProposal, type ReadAs, type ReaderTally } from '../src/import/rank-learning.js';
import { harvestRankLooks } from '../src/server/reader/rank-harvest.js';
import { lookExamples } from '../src/server/reader/look-examples.js';
import { learnedPicturesRoot } from '../src/server/reader/learned-pictures.js';
import { removeFiles, saveImage } from '../src/server/reader/saved-image.js';

const USAGE = `Proposes Rank Looks from the kept battle report pictures (ADR 0026): each tile is named by the local hero reader and paired with the rank of the saved record, leaving out ranks a roster may have filled in. It reports how the rank reader does on all looks, each read from the others, before and after the proposed looks. Without --apply nothing changes; --apply saves the looks unless the reader would do worse with them.
Usage: npm run learn:ranks -- [--db data/afk.db] [--images images] [--apply]`;

const { values } = parseArgs({ options: { db: { type: 'string', default: 'data/afk.db' }, images: { type: 'string', default: 'images' }, apply: { type: 'boolean', default: false }, help: { type: 'boolean', default: false } } });
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!existsSync(values.db!)) {
  console.error(`No database at ${values.db}`);
  process.exit(1);
}
const db = openDb(values.db!);
const known = await lookExamples(db, values.images!).rankExamples();
const harvest = await harvestRankLooks(db, values.images!, known);
console.log(`${harvest.pictures} report pictures read${harvest.unreadable > 0 ? ` (${harvest.unreadable} files missing)` : ''}, ${harvest.tiles} tiles`);
console.log(`left out: ${[...harvest.skipped].map(([reason, n]) => `${reason} ${n}`).join(', ')}`);
const proposed = harvest.proposed.map((p) => ({ rank: p.rank, features: p.features }));
console.log(`${proposed.length} looks proposed, ${known.length} known`);

const check = checkProposal(known, proposed);
const ranks = [...new Set([...known, ...proposed].map((e) => e.rank))].sort();
const cell = (t: ReaderTally | undefined) => (t ? `${String(t.correct).padStart(3)} right ${String(t.wrong).padStart(3)} wrong ${String(t.unread).padStart(3)} unsure` : '                           -');
console.log(`\n${'rank'.padEnd(11)} ${'looks'.padStart(5)} ${'+new'.padStart(5)}   before (each look read from the others)         after`);
const line = (name: string, looks: number, added: number, before: ReaderTally | undefined, after: ReaderTally | undefined) =>
  console.log(`${name.padEnd(11)} ${String(looks).padStart(5)} ${String(added).padStart(5)}   ${cell(before)}   ${cell(after)}`);
for (const rank of ranks) line(rank, known.filter((e) => e.rank === rank).length, proposed.filter((e) => e.rank === rank).length, check.before.byRank.get(rank), check.after.byRank.get(rank));
line('overall', known.length, proposed.length, check.before.overall, check.after.overall);

// what each rank's looks were read as, with the proposed looks among the others (the reading the guard judges)
const answers = (counts: Map<string | null, number>) =>
  [...counts].sort((a, b) => (a[0] === null ? 1 : b[0] === null ? -1 : b[1] - a[1])).map(([rank, n]) => `${rank ?? 'unsure'} ${n}`).join(', ');
const readAs = (title: string, matrix: ReadAs) => {
  console.log(`\n${title}`);
  for (const rank of ranks) if (matrix.has(rank)) console.log(`  ${rank.padEnd(11)} read as: ${answers(matrix.get(rank)!)}`);
};
readAs('Known looks, read as (with the proposed looks added):', check.after.readAs.known);
readAs('Proposed looks, read as:', check.after.readAs.proposed);
if (check.confused.length > 0) {
  console.log('\nLooks read right now and read wrong with the proposed looks (the number is the look\'s place among the known or the proposed looks):');
  for (const c of check.confused) console.log(`  ${c.group} look ${c.group === 'known' ? c.index : c.index - known.length} filed as ${c.rank}, now read as ${c.readAs}`);
}
if (check.refused) console.log(`\nRefused: ${check.refused}.`);

if (!values.apply) console.log('\nNothing was changed. Add --apply to save the proposed looks.');
else if (check.refused || harvest.proposed.length === 0) console.log(check.refused ? '\nNothing was saved.' : '\nNothing to save.');
else {
  const written: string[] = [];
  try {
    db.transaction(() => {
      for (const look of harvest.proposed) saveImage(db, learnedPicturesRoot(values.images!), 'rank_look', { rank: look.rank }, look.png, written, 'offline');
    })();
    console.log(`\nSaved ${harvest.proposed.length} Rank Looks.`);
  } catch (e) {
    removeFiles(written);
    throw e;
  }
}
db.close();
