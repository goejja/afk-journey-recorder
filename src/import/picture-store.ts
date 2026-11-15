import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

/** Where the originals of saved Battle imports live, under the images folder (ADR 0016). */
export const picturesDir = (imagesDir: string, screen = 'report') => join(resolve(imagesDir), 'imports', screen);

const EXTENSIONS: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };

export interface KeptPicture {
  hash: string;
  file: string;
}

/**
 * Keeps the original picture of a Battle import and links it to the saved fight it showed. The file is named by the hash of its bytes,
 * so the same picture kept for two fights is stored once. Returns null for bytes that are not a picture, or when the fight is unknown.
 */
export async function keepPicture(db: Database.Database, imagesDir: string, bytes: Buffer, record: { attemptId: number; label: string | null }, screen = 'report'): Promise<KeptPicture | null> {
  const format = await sharp(bytes).metadata().then((m) => m.format ?? '', () => '');
  const extension = EXTENSIONS[format];
  if (!extension) return null;
  if (!db.prepare('SELECT 1 FROM attempt WHERE id = ?').get(record.attemptId)) return null;
  const hash = createHash('sha256').update(bytes).digest('hex');
  const file = `${hash}.${extension}`;
  const dir = picturesDir(imagesDir, screen);
  if (!existsSync(join(dir, file))) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), bytes);
  }
  db.prepare('INSERT INTO import_picture (attempt_id, hash, screen, label, file) VALUES (?, ?, ?, ?, ?) ON CONFLICT (attempt_id) DO UPDATE SET hash = excluded.hash, screen = excluded.screen, label = excluded.label, file = excluded.file').run(record.attemptId, hash, screen, record.label, file);
  return { hash, file };
}
