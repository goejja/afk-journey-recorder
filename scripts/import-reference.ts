import { openDb } from '../src/db/open.js';
import { createCachedFetcher } from '../src/import/fetch.js';
import { syncReference } from '../src/import/reference-sync.js';

const refresh = process.argv.includes('--refresh');
const overwrite = process.argv.includes('--overwrite');
const dbPath = process.argv.find((a) => a.endsWith('.db')) ?? 'data/afk.db';

const db = openDb(dbPath);
const { lines, warnings } = await syncReference(db, { yaphalla: createCachedFetcher('cache/yaphalla', refresh), wiki: createCachedFetcher('cache/wiki', refresh), overwrite });
for (const line of lines) console.log(line);
for (const warning of warnings) console.warn(warning);
db.close();
