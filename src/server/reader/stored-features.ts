import type Database from 'better-sqlite3';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HERO_FEATURES_VERSION, heroFeatures } from '../../vision/hero-read.js';
import { FEATURES_VERSION as RANK_FEATURES_VERSION, rankFeatures } from '../../vision/rank-read.js';
import { UNIT_FEATURES_VERSION, unitFeatures } from '../../vision/unit-read.js';

type Features = Float32Array;

/** How many pictures are decoded at once: each is read whole, and the decoding runs on sharp's own threads. */
const DECODING_AT_ONCE = 32;

/**
 * One kind of look whose pictures the readers compare new tiles with: the table of its rows, the version of the extractor that makes
 * its vectors, and the extractor. The vectors are kept in `<looks>_feature` (`look_id`, `version`, `size`, `mtime`, `vector`).
 */
export interface FeatureSpec {
  looks: 'rank_look' | 'hero_example' | 'hero_look' | 'unit_look';
  version: number;
  extract: (picture: Buffer) => Promise<Features>;
}

export const RANK_LOOKS: FeatureSpec = { looks: 'rank_look', version: RANK_FEATURES_VERSION, extract: rankFeatures };
export const HERO_EXAMPLES: FeatureSpec = { looks: 'hero_example', version: HERO_FEATURES_VERSION, extract: heroFeatures };
export const HERO_LOOKS: FeatureSpec = { looks: 'hero_look', version: HERO_FEATURES_VERSION, extract: heroFeatures };
export const UNIT_LOOKS: FeatureSpec = { looks: 'unit_look', version: UNIT_FEATURES_VERSION, extract: unitFeatures };

const inMemory = new Map<string, { stamp: string; features: Features }>();

export interface StoredFeatures {
  /** The features of each look whose picture could be read, by look id. */
  features: Map<number, Features>;
  /** The ids of the looks whose file is there but cannot be decoded. Nothing is kept for them, so the next call tries again. */
  unreadable: number[];
}

/**
 * The features of the pictures of some looks of one kind (`dir` is the folder of the pictures), from the first of these that has them:
 * memory, the stored vector of `<looks>_feature` while its version, file size and modification time are still those of the picture,
 * then the picture itself, whose vector is stored for next time. A look whose file is missing has no entry. Memory keeps the same
 * `Float32Array` for as long as the file is unchanged, which `rankMeasure` relies on.
 */
export async function storedFeaturesFor(db: Database.Database, spec: FeatureSpec, looks: { id: number; file: string }[], dir: string): Promise<StoredFeatures> {
  const features = new Map<number, Features>();
  const unreadable: number[] = [];
  const table = `${spec.looks}_feature`;
  const pending: { id: number; path: string; size: number; mtime: number }[] = [];

  for (const look of looks) {
    const path = join(dir, look.file);
    if (!existsSync(path)) continue;
    const { size, mtimeMs: mtime } = statSync(path);
    const known = inMemory.get(path);
    if (known?.stamp === `${size}:${mtime}`) {
      features.set(look.id, known.features);
      continue;
    }
    pending.push({ id: look.id, path, size, mtime });
  }

  // the stored vectors are read only when something is not in memory, so a call that finds everything there costs a stat per picture
  const toDecode: typeof pending = [];
  if (pending.length > 0) {
    const stored = new Map((db.prepare(`SELECT look_id AS id, version, size, mtime, vector FROM ${table}`).all() as { id: number; version: number; size: number; mtime: number; vector: Buffer }[]).map((r) => [r.id, r]));
    for (const look of pending) {
      const row = stored.get(look.id);
      if (row && row.version === spec.version && row.size === look.size && row.mtime === look.mtime) {
        const found = new Float32Array(row.vector.buffer.slice(row.vector.byteOffset, row.vector.byteOffset + row.vector.byteLength));
        inMemory.set(look.path, { stamp: `${look.size}:${look.mtime}`, features: found });
        features.set(look.id, found);
      } else {
        toDecode.push(look);
      }
    }
  }

  const made: { id: number; size: number; mtime: number; features: Features }[] = [];
  for (let i = 0; i < toDecode.length; i += DECODING_AT_ONCE) {
    await Promise.all(
      toDecode.slice(i, i + DECODING_AT_ONCE).map(async (pending) => {
        try {
          const decoded = await spec.extract(readFileSync(pending.path));
          inMemory.set(pending.path, { stamp: `${pending.size}:${pending.mtime}`, features: decoded });
          features.set(pending.id, decoded);
          made.push({ id: pending.id, size: pending.size, mtime: pending.mtime, features: decoded });
        } catch {
          // a file that is not a picture: it is reported, and never kept as an answer
          unreadable.push(pending.id);
        }
      }),
    );
  }
  if (made.length > 0) {
    // a look deleted while its picture was being read has no row to point at, so its vector is not stored
    const save = db.prepare(`INSERT OR REPLACE INTO ${table} (look_id, version, size, mtime, vector) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM ${spec.looks} WHERE id = ?)`);
    db.transaction(() => {
      for (const m of made) save.run(m.id, spec.version, m.size, m.mtime, Buffer.from(m.features.buffer, m.features.byteOffset, m.features.byteLength), m.id);
    })();
  }
  return { features, unreadable: unreadable.sort((a, b) => a - b) };
}


