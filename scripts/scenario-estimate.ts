import { readFileSync } from 'node:fs';
import { openDb } from '../src/db/open.js';
import { saveEstimate } from '../src/db/scenario-estimate.js';
import { MAX_ESTIMATE_LENGTH } from '../src/domain/scenario.js';

const USAGE = `Writes the agent's answer onto a planning scenario (the only thing the agent writes).
Usage: npm run scenario:estimate -- <scenario id> <file>      text read from the file ("-" for standard input)
       npm run scenario:estimate -- <scenario id> --clear     remove the estimate
Database: data/afk.db, or AFK_DB. The text is at most ${MAX_ESTIMATE_LENGTH} characters.`;

const [idText, source] = process.argv.slice(2);
const id = Number(idText);
if (!Number.isInteger(id) || !source) {
  console.error(USAGE);
  process.exit(1);
}

const text = source === '--clear' ? '' : readFileSync(source === '-' ? 0 : source, 'utf8').trim();
const db = openDb(process.env['AFK_DB'] ?? 'data/afk.db');
const error = saveEstimate(db, id, text);
db.close();
if (error) {
  console.error(error);
  process.exit(1);
}
console.log(text ? `Estimate saved on scenario ${id}` : `Estimate cleared on scenario ${id}`);
