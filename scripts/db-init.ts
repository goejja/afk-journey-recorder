import { openDb } from '../src/db/open.js';

const path = process.argv[2] ?? process.env['AFK_DB'] ?? 'data/afk.db';
openDb(path).close();
console.log(`Database ready at ${path}`);
