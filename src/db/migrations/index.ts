import type Database from 'better-sqlite3';
import { migration as m2 } from './002-learned-picture-source.js';
import { migration as m3 } from './003-part-column.js';
import { migration as m4 } from './004-flat-deployment.js';
import { migration as m5 } from './005-stage-enemy-parts.js';
import { migration as m6 } from './006-look-similarity.js';
import { migration as m7 } from './007-review-runs.js';
import { migration as m8 } from './008-review-dismissals.js';
import { migration as m9 } from './009-review-explanation.js';
import { migration as m10 } from './010-record-tags.js';
import { migration as m11 } from './011-stage-enemy-counts.js';
import { migration as m12 } from './012-unit-tables.js';
import { migration as m13 } from './013-pvp-hints.js';
import { migration as m14 } from './014-hero-rules.js';
import { migration as m15 } from './015-placement-rules.js';
import { migration as m16 } from './016-placement-rule-same-row.js';
import { migration as m17 } from './017-tournament-semi-finals.js';
import { migration as m18 } from './018-placement-rule-farthest.js';
import { migration as m19 } from './019-hero-attributes.js';
import { migration as m20 } from './020-attempt-season.js';
import { migration as m21 } from './021-counter-setting.js';
import { migration as m22 } from './022-placement-rule-relations.js';
import { migration as m23 } from './023-placement-rule-adjacent-frontmost.js';
import { migration as m24 } from './024-starting-heroes.js';
import { migration as m25 } from './025-afk-range-origin.js';
import { migration as m26 } from './026-rank-look-feature.js';
import { migration as m27 } from './027-lookup-indexes.js';
import { migration as m28 } from './028-look-features.js';
import { migration as m29 } from './029-parked-readings.js';
import { migration as m30 } from './030-clear-stage-hero-state.js';
import { migration as m31 } from './031-hero-back-mark.js';
import { migration as m32 } from './032-map-boost-tiles.js';
import { migration as m33 } from './033-titan-reaver-setup.js';
import { migration as m34 } from './034-titan-reaver-battles.js';
import { migration as m35 } from './035-season-phase.js';
import { migration as m36 } from './036-hand-made-units.js';
import { migration as m37 } from './037-titan-reaver-default-updated-at.js';
import { migration as m38 } from './038-enemy-kind.js';
import { migration as m39 } from './039-ideas.js';
import { migration as m40 } from './040-advisor-setting.js';
import { migration as m41 } from './041-idea-drop-title.js';
import { migration as m42 } from './042-idea-season.js';
import { migration as m43 } from './043-sync-runs.js';
import { migration as m44 } from './044-merge-renamed-heroes.js';

/**
 * A change to the tables of an existing database, run once in a transaction. `schema.sql` is the baseline (version 1) and is
 * never edited to change a table; a change is a new file here that takes the database from version n to n + 1, and the
 * baseline is left alone (ADR 0023). A fresh database gets the baseline and then every migration. Files are named by the
 * version they produce; a migration once applied is never edited.
 */
export type Migration = (db: Database.Database) => void;

export const migrations: Migration[] = [m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15, m16, m17, m18, m19, m20, m21, m22, m23, m24, m25, m26, m27, m28, m29, m30, m31, m32, m33, m34, m35, m36, m37, m38, m39, m40, m41, m42, m43, m44];
