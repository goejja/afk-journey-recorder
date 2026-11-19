import { safeFileName } from '../../domain/file-name.js';
import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import { PAIR_HEROES, UNIT_OWNERS } from '../../domain/units.js';
import { hasName } from '../db-helpers.js';
import { imageType, type ImageType } from '../image-type.js';
import { imagesContract } from '../../shared/contracts/images.js';
import { fail, Failure, file, readUpload, serve } from '../contract.js';

const IMAGE_KINDS = ['hero', 'enemy', 'phantimal', 'boss', 'artifact'] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

const ICON_KINDS = { class: 'class', faction: 'factions' } as const;

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<ImageType, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const EXTENSION_BY_MIME = new Map(Object.entries(MIME_BY_EXTENSION).map(([extension, mime]) => [mime, extension as ImageType]));

const isKind = (value: string): value is ImageKind => (IMAGE_KINDS as readonly string[]).includes(value);

interface ResolvedImage {
  file: string;
  source: 'custom' | 'imported';
}

const customDirOf = (root: string, kind: ImageKind) => join(root, 'custom', kind);

/** Imported images are stored as paths like images/heroes/Evie.png relative to the project. */
function importedFile(db: Database.Database, root: string, kind: ImageKind, name: string): string | null {
  const storedPath = (table: ImageKind, unit: string) => db.prepare(`SELECT image_path FROM ${table} WHERE name = ?`).pluck().get(unit) as string | null | undefined;
  const candidates: string[] = [];
  if (kind === 'phantimal') {
    candidates.push(join(root, 'bosses', `${safeFileName(name)}.png`), join(root, 'heroes', `${safeFileName(name)}.png`));
  } else {
    const stored = storedPath(kind, name);
    if (stored) candidates.push(resolve(root, '..', stored));
    // Parts of a pair and summons keep their default image next to the hero images, named after the unit.
    const owner = kind === 'hero' ? UNIT_OWNERS[name] : undefined;
    if (owner) candidates.unshift(join(root, 'heroes', `${safeFileName(name)}.png`));
    // A part of a pair looks like its pair until it gets an image of its own; a summon has no stand-in.
    if (owner && PAIR_HEROES[owner]) {
      const ownerStored = storedPath('hero', owner);
      if (ownerStored) candidates.push(resolve(root, '..', ownerStored));
    }
  }
  return candidates.find((file) => file.startsWith(root + sep) && existsSync(file)) ?? null;
}

/** The uploaded images of a kind by file name without extension; read once for a whole list. */
function customFilesOf(root: string, kind: ImageKind): Map<string, string> {
  const dir = customDirOf(root, kind);
  const files = new Map<string, string>();
  if (!existsSync(dir)) return files;
  for (const file of readdirSync(dir)) {
    const stem = file.slice(0, file.lastIndexOf('.'));
    if (!files.has(stem)) files.set(stem, join(dir, file));
  }
  return files;
}

const customFileOf = (root: string, kind: ImageKind, name: string): string | null => customFilesOf(root, kind).get(safeFileName(name)) ?? null;

/** The file of the best image for a unit: an uploaded one, else the imported one. */
export function portraitFile(db: Database.Database, imagesDir: string, kind: ImageKind, name: string): string | null {
  const root = resolve(imagesDir);
  return customFileOf(root, kind, name) ?? importedFile(db, root, kind, name);
}

/** Portrait routes: serve the best image for a unit, list what is missing, and take uploads. */
export function imageRoutes(db: Database.Database, imagesDir: string): Hono {
  const app = new Hono();
  const root = resolve(imagesDir);
  const customDir = (kind: ImageKind) => customDirOf(root, kind);
  const customFile = (kind: ImageKind, name: string) => customFileOf(root, kind, name);

  const resolveImage = (kind: ImageKind, name: string, customFiles?: Map<string, string>): ResolvedImage | null => {
    const custom = customFiles ? (customFiles.get(safeFileName(name)) ?? null) : customFile(kind, name);
    if (custom) return { file: custom, source: 'custom' };
    const imported = importedFile(db, root, kind, name);
    return imported ? { file: imported, source: 'imported' } : null;
  };

  /** Units that are not heroes of their own (a pair's parts, summons) can have images too, when their hero exists. */
  const unitNames = (kind: ImageKind): string[] =>
    kind === 'hero' ? Object.entries(UNIT_OWNERS).filter(([, owner]) => hasName(db, 'hero', owner)).map(([unit]) => unit) : [];

  const exists = (kind: ImageKind, name: string) =>
    db.prepare(`SELECT 1 FROM ${kind} WHERE name = ?`).get(name) !== undefined || unitNames(kind).includes(name);

  serve(app, imagesContract.portrait, ({ params }) => {
    if (!isKind(params.kind)) return fail(404, 'Unknown image kind');
    const image = resolveImage(params.kind, params.name);
    if (!image) return fail(404, 'No image');
    const extension = image.file.slice(image.file.lastIndexOf('.') + 1).toLowerCase();
    return file(readFileSync(image.file), MIME_BY_EXTENSION[extension as ImageType] ?? 'application/octet-stream', { 'cache-control': 'no-cache' });
  });

  serve(app, imagesContract.icon, ({ params }) => {
    const folder = ICON_KINDS[params.kind as keyof typeof ICON_KINDS];
    if (!folder) return fail(404, 'Unknown icon kind');
    const path = join(root, 'icons', folder, `${safeFileName(params.name).toLowerCase()}.png`);
    if (!existsSync(path)) return fail(404, 'No icon');
    return file(readFileSync(path), 'image/png', { 'cache-control': 'no-cache' });
  });

  serve(app, imagesContract.list, ({ params }) => {
    const kind = params.kind;
    if (!isKind(kind)) return fail(404, 'Unknown image kind');
    const names = [...(db.prepare(`SELECT name FROM ${kind} ORDER BY name`).pluck().all() as string[]), ...unitNames(kind)];
    const customFiles = customFilesOf(root, kind);
    return names.map((name) => ({ name, source: resolveImage(kind, name, customFiles)?.source ?? ('none' as const) }));
  });

  serve(app, imagesContract.upload, async ({ params }, c) => {
    const { kind, name } = params;
    if (!isKind(kind) || !exists(kind, name)) return fail(404, 'Unknown unit');
    const extension = EXTENSION_BY_MIME.get((c.req.header('content-type') ?? '').split(';')[0]!.trim());
    if (!extension) return fail(415, 'Upload a PNG, JPEG, WebP or GIF image');
    const bytes = await readUpload(c, MAX_UPLOAD_BYTES, 'Images can be at most 2 MB');
    if (bytes instanceof Failure) return bytes;
    if (bytes.length === 0) return fail(400, 'The file is empty');
    if (imageType(bytes) !== extension) return fail(400, `The file is not really a ${extension.toUpperCase()} image`);

    const dir = customDir(kind);
    mkdirSync(dir, { recursive: true });
    const previous = customFile(kind, name);
    const written = join(dir, `${safeFileName(name)}.${extension}`);
    writeFileSync(written, bytes); // the earlier image goes only once the new one is saved
    if (previous && previous !== written) rmSync(previous);
    return { name, source: 'custom' as const };
  });

  serve(app, imagesContract.remove, ({ params }) => {
    if (!isKind(params.kind)) return fail(404, 'Unknown image kind');
    const previous = customFile(params.kind, params.name);
    if (previous) rmSync(previous);
  });

  return app;
}
