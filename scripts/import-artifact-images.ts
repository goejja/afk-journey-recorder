import { parseArgs } from 'node:util';
import { openDb } from '../src/db/open.js';
import { createCachedFetcher } from '../src/import/fetch.js';
import { importArtifactImages } from '../src/import/artifact-images.js';

const { values } = parseArgs({ options: { db: { type: 'string' }, refresh: { type: 'boolean' } } });
const dbPath = values.db ?? process.env['AFK_DB'] ?? 'data/afk.db';

const db = openDb(dbPath);
const result = await importArtifactImages(db, createCachedFetcher('cache/afkglobal', values.refresh));
console.log(`Artifact images: ${result.downloaded} downloaded into images/artifacts`);
if (result.missing.length) console.log(`No icon found for: ${result.missing.join(', ')} (upload them in the Images tab)`);
if (result.failed.length) console.warn(`Failed: ${result.failed.join('; ')}`);
db.close();
