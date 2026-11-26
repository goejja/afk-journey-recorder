import { mergeRenamedHeroes } from '../hero-renames.js';
import type { Migration } from './index.js';

/**
 * 43 -> 44: Yaphalla renamed "Taichi&Agumon" and "YamatoGabumon" to "Taichi & Agumon" and "Yamato & Gabumon" (#387). The old hero rows are
 * renamed and every roster and record follows, so no second hero is left beside the first.
 */
export const migration: Migration = (db) => {
  mergeRenamedHeroes(db);
};
