import type Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { fileCache } from '../file-cache.js';
import { join, resolve } from 'node:path';
import { heroFeatures, type Features as HeroFeatures, type HeroExample } from '../../vision/hero-read.js';
import { unitFeatures, type UnitExample, type UnitFeatures } from '../../vision/unit-read.js';
import { rankFeatures, type Features as RankFeatures, type RankExample } from '../../vision/rank-read.js';

/** Frame tops closer than this are the same tile seen again: a second look of it would teach the reader nothing. */
export const SAME_TILE_DISTANCE = 0.015;

/** The tiles the player confirmed, as the features the hero and rank readers compare new tiles with. */
export function lookExamples(db: Database.Database, imagesDir: string) {
  /** The features of an example file, computed once while the file is unchanged. */
  const cachedFeatures = fileCache<Promise<RankFeatures | HeroFeatures | UnitFeatures>>() as <T extends RankFeatures | HeroFeatures | UnitFeatures>(file: string, compute: (bytes: Buffer) => Promise<T>) => Promise<T>;
  const root = join(resolve(imagesDir), 'custom');

  /** The Rank Looks the player confirmed before: tiles whose rank is known, as frame-top features. */
  const rankExamples = async (): Promise<RankExample[]> => {
    const examples: RankExample[] = [];
    for (const look of db.prepare('SELECT rank, file FROM rank_look ORDER BY id').all() as { rank: string; file: string }[]) {
      const file = join(root, 'rank-look', look.file);
      if (existsSync(file)) examples.push({ rank: look.rank, features: await cachedFeatures(file, rankFeatures) });
    }
    return examples;
  };

  /** The tiles whose hero the player confirmed (applied rows and Hero Looks), as art features. */
  const heroExamples = async (): Promise<HeroExample[]> => {
    const examples: HeroExample[] = [];
    const files = [
      ...(db.prepare('SELECT hero_name AS hero, file FROM hero_example ORDER BY id').all() as { hero: string; file: string }[]).map((r) => ({ hero: r.hero, file: join(root, 'hero-example', r.file) })),
      ...(db.prepare('SELECT hero_name AS hero, file FROM hero_look ORDER BY id').all() as { hero: string; file: string }[]).map((r) => ({ hero: r.hero, file: join(root, 'look', r.file) })),
    ];
    for (const { hero, file } of files) if (existsSync(file)) examples.push({ hero, features: await cachedFeatures(file, heroFeatures) });
    return examples;
  };

  /** The artifact crops the player kept when saving a Battle import (Unit Looks), as features. */
  const artifactExamples = async (): Promise<UnitExample[]> => {
    const examples: UnitExample[] = [];
    for (const look of db.prepare("SELECT name, file FROM unit_look WHERE kind = 'artifact' ORDER BY id").all() as { name: string; file: string }[]) {
      const file = join(root, 'unit-look', look.file);
      if (existsSync(file)) examples.push({ name: look.name, features: await cachedFeatures(file, unitFeatures) });
    }
    return examples;
  };

  return { rankExamples, heroExamples, artifactExamples };
}
