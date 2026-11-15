import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { openDb } from '../db/open.js';
import { createApp } from './app.js';

const HOST = '127.0.0.1'; // local only: never listen on a public interface
const PORT = Number(process.env['PORT'] ?? 3000);

const db = openDb(process.env['AFK_DB'] ?? 'data/afk.db');
const root = new Hono();
root.route(
  '/',
  createApp(db, {
    importPersist: true,
    importWorkDir: process.env['AFK_IMPORT_DIR'] || undefined,
  }),
);
root.use('/images/*', serveStatic({ root: './' }));
root.use('/*', serveStatic({ root: './web/dist' }));

serve({ fetch: root.fetch, hostname: HOST, port: PORT }, () => {
  console.log(`AFK Journey Recorder API on http://${HOST}:${PORT}`);
});
