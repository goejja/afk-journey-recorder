import type Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { keepPicture, picturesDir } from '../../import/picture-store.js';
import { DATA_URL, keptPicturesContract } from '../../shared/contracts/reader.js';
import { fail, file, serve } from '../contract.js';

/** A phone screenshot is about 1 MB; this keeps a wrong request from filling the disk. */
const MAX_BYTES = 15 * 1024 * 1024;
const CONTENT_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/**
 * Routes for the originals of saved Battle imports (ADR 0016). The form that opened the import holds the picture, fetched before the server
 * forgot it; saving the records sends it here with the id of the fight it showed. Nothing here changes a record.
 */
export function keptPictureRoutes(db: Database.Database, options: { imagesDir?: string } = {}): Hono {
  const app = new Hono();
  const imagesDir = options.imagesDir ?? 'images';

  serve(app, keptPicturesContract.keep, async ({ body }) => {
    const bytes = Buffer.from(DATA_URL.exec(body.data)![1]!, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return fail(400, 'The picture is empty or too large');
    const kept = await keepPicture(db, imagesDir, bytes, { attemptId: body.attemptId, label: body.label ?? null });
    return kept ? { hash: kept.hash } : fail(422, 'Not a picture, or an unknown fight');
  });

  serve(app, keptPicturesContract.image, ({ params }) => {
    const row = db.prepare('SELECT file, screen FROM import_picture WHERE attempt_id = ?').get(Number(params.attemptId)) as { file: string; screen: string } | undefined;
    const path = row && join(picturesDir(imagesDir, row.screen), row.file);
    if (!row || !path || !existsSync(path)) return fail(404, 'No picture');
    return file(new Uint8Array(readFileSync(path)), CONTENT_TYPES[row.file.split('.').pop()!] ?? 'application/octet-stream', { 'cache-control': 'no-cache' });
  });

  return app;
}
