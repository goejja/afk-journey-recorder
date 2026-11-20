import type Database from 'better-sqlite3';
import type { HeroExample } from '../../vision/hero-read.js';
import type { UnitExample } from '../../vision/unit-read.js';
import type { RankExample } from '../../vision/rank-read.js';
import { learnedPicturesRoot, pictureDir, type PictureTable } from './learned-pictures.js';
import { HERO_EXAMPLES, HERO_LOOKS, RANK_LOOKS, storedFeaturesFor, UNIT_LOOKS, type FeatureSpec } from './stored-features.js';

/** Frame tops closer than this are the same tile seen again: a second look of it would teach the reader nothing. */
export const SAME_TILE_DISTANCE = 0.015;

/** The tiles the player confirmed, as the features the hero and rank readers compare new tiles with. */
export function lookExamples(db: Database.Database, imagesDir: string) {
  const root = learnedPicturesRoot(imagesDir);

  /**
   * The rows of one kind of look with the features of their pictures, in the order of their ids. Each kind keeps its vectors (`storedFeaturesFor`),
   * so a picture is decoded only when it is new or changed; a row whose picture is missing or cannot be decoded is left out.
   */
  const withFeatures = async <Row extends { id: number; file: string }>(spec: FeatureSpec, rows: Row[], table: PictureTable) => {
    const { features } = await storedFeaturesFor(db, spec, rows, pictureDir(root, table));
    return rows.flatMap((row) => (features.has(row.id) ? [{ row, features: features.get(row.id)! }] : []));
  };

  /** The Rank Looks the player confirmed before: tiles whose rank is known, as frame-top features. */
  const rankExamples = async (): Promise<RankExample[]> => {
    const rows = db.prepare('SELECT id, rank, file FROM rank_look ORDER BY id').all() as { id: number; rank: string; file: string }[];
    return (await withFeatures(RANK_LOOKS, rows, 'rank_look')).map(({ row, features }) => ({ rank: row.rank, features }));
  };

  /** The tiles whose hero the player confirmed (applied rows and Hero Looks), as art features. */
  const heroExamples = async (): Promise<HeroExample[]> => {
    const applied = db.prepare('SELECT id, hero_name AS hero, file FROM hero_example ORDER BY id').all() as { id: number; hero: string; file: string }[];
    const looks = db.prepare('SELECT id, hero_name AS hero, file FROM hero_look ORDER BY id').all() as { id: number; hero: string; file: string }[];
    const [fromApplied, fromLooks] = await Promise.all([withFeatures(HERO_EXAMPLES, applied, 'hero_example'), withFeatures(HERO_LOOKS, looks, 'hero_look')]);
    return [...fromApplied, ...fromLooks].map(({ row, features }) => ({ hero: row.hero, features }));
  };

  /** The artifact crops the player kept when saving a Battle import (Unit Looks), as features. */
  const artifactExamples = async (): Promise<UnitExample[]> => {
    const rows = db.prepare("SELECT id, name, file FROM unit_look WHERE kind = 'artifact' ORDER BY id").all() as { id: number; name: string; file: string }[];
    return (await withFeatures(UNIT_LOOKS, rows, 'unit_look')).map(({ row, features }) => ({ name: row.name, features }));
  };

  return { rankExamples, heroExamples, artifactExamples };
}
