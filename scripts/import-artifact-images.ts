import { parseArgs } from 'node:util';
import { openDb } from '../src/db/open.js';
import { createCachedFetcher } from '../src/import/fetch.js';
import { syncArtifactImages } from '../src/import/artifact-images.js';

const { values } = parseArgs({ options: { db: { type: 'string' }, refresh: { type: 'boolean' } } });
const dbPath = values.db ?? process.env['AFK_DB'] ?? 'data/afk.db';

const db = openDb(dbPath);
const { lines, warnings } = await syncArtifactImages(db, createCachedFetcher('cache/afkglobal', values.refresh));
for (const line of lines) console.log(line);
for (const warning of warnings) console.warn(warning);
db.close();
