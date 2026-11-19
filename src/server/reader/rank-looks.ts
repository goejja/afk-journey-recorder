import type Database from 'better-sqlite3';
import { distance as rankDistance, type Features } from '../../vision/rank-read.js';
import { distanceTable } from '../../vision/nearest.js';
import { RANK_LOOKS, storedFeaturesFor, type StoredFeatures } from './stored-features.js';

export type RankLookFeatures = StoredFeatures;

/** The features of the pictures of some Rank Looks (`dir` is the folder of the pictures); see `storedFeaturesFor`, which every kind of look shares. */
export const rankFeaturesFor = (db: Database.Database, looks: { id: number; file: string }[], dir: string): Promise<RankLookFeatures> => storedFeaturesFor(db, RANK_LOOKS, looks, dir);

let table: { known: Set<Features>; measure: (a: Features, b: Features) => number } | null = null;

/**
 * The rank distance between looks, from a table filled once: reading each look from all the others compares every pair, which
 * takes seconds for the owner's looks and runs on the one thread that serves every page. The table is kept while the features it
 * holds are the ones asked for, so a review that opens, moves or thins looks again does not fill it again.
 */
export function rankMeasure(all: Features[]): (a: Features, b: Features) => number {
  const kept = table;
  if (kept && all.every((f) => kept.known.has(f))) return kept.measure;
  const fresh = { known: new Set(all), measure: distanceTable(all, rankDistance) };
  table = fresh;
  return fresh.measure;
}
