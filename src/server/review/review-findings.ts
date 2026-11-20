import type Database from 'better-sqlite3';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { loadReviewRun, latestReviewRunId } from '../../query/review-run.js';
import { factionMismatches } from '../../query/faction-mismatches.js';
import { MIN_EXAMPLES, readRank, type Features } from '../../vision/rank-read.js';
import { rankFeaturesFor, rankMeasure } from '../reader/rank-looks.js';
import { reviewContract } from '../../shared/contracts/review.js';
import { fail, serve } from '../contract.js';

/** How many Review runs are kept (ADR 0032); a new run deletes the older ones. */
const RUNS_KEPT = 10;

/** One thing the Reader review found: `subject` is what it is about (a rank, a hero, a file) and `message` says it in words. */
/** What a category of pictures kept for a purpose holds: shown for the player to judge, never offered for removal. */
interface KeptCategory {
  category: string;
  files: number;
  bytes: number;
  /** The date of the oldest file, as YYYY-MM-DD. */
  oldest: string;
}

type ReviewFindings = { wrong: Finding[]; obsolete: Finding[]; improve: Finding[]; kept: KeptCategory[] };

interface Finding {
  code: string;
  subject: string;
  message: string;
  /** In a stored run: the run before it did not have this finding (ADR 0032). */
  new?: boolean;
  /** The record the finding links to, when it is about one; a record is history and is never changed by the review. */
  recordId?: number;
  /** For a Rank Look: the rank it is filed under and the rank the others read it as, to offer moving it. */
  filedUnder?: string;
  readAs?: string;
}

/** The Reader review's findings (ADR 0031), found by code from the readers' data and never fixed here. */
export function reviewFindingsRoutes(db: Database.Database, options: { imagesDir?: string } = {}): Hono {
  const app = new Hono();
  const root = join(resolve(options.imagesDir ?? 'images'), 'custom');

  // the folders of learned pictures and the table whose rows reference their files; other folders hold pictures kept for a purpose
  const LEARNED_FOLDERS = [
    { folder: 'rank-look', table: 'rank_look' },
    { folder: 'hero-example', table: 'hero_example' },
    { folder: 'look', table: 'hero_look' },
    { folder: 'unit-look', table: 'unit_look' },
  ] as const;

  const unreferencedFiles = (): Finding[] =>
    LEARNED_FOLDERS.flatMap(({ folder, table }) => {
      const dir = join(root, folder);
      if (!existsSync(dir)) return [];
      const referenced = new Set(db.prepare(`SELECT file FROM ${table}`).pluck().all() as string[]);
      return readdirSync(dir)
        .filter((name) => !name.startsWith('.') && !referenced.has(name))
        .sort()
        .map((name) => ({ code: 'unreferenced-file', subject: `${folder}/${name}`, message: `${folder}/${name} is used by no row: nothing reads it.` }));
    });

  const rankFewLooks = (): Finding[] =>
    (db.prepare('SELECT rank, count(*) AS looks FROM rank_look GROUP BY rank HAVING count(*) < ? ORDER BY rank').all(MIN_EXAMPLES) as { rank: string; looks: number }[]).map((r) => ({
      code: 'rank-few-looks',
      subject: r.rank,
      message: `${r.rank} has ${r.looks} Rank Looks: the rank reader names a rank only after ${MIN_EXAMPLES}.`,
    }));

  const heroNoExample = (): Finding[] =>
    (
      db
        .prepare('SELECT name FROM hero WHERE name NOT IN (SELECT hero_name FROM hero_example) AND name NOT IN (SELECT hero_name FROM hero_look) ORDER BY name')
        .pluck()
        .all() as string[]
    ).map((name) => ({ code: 'hero-no-example', subject: name, message: `${name} has no picture the hero reader can compare a tile with.` }));

  /** The size and age of the pictures kept for a purpose: the originals of Battle imports (ADR 0016) and the Hero Looks. */
  const keptCategories = (): KeptCategory[] => {
    const importsDir = join(root, '..', 'imports');
    const screens = existsSync(importsDir) ? readdirSync(importsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(importsDir, e.name)) : [];
    const categories = [
      { category: 'Kept pictures', dirs: screens },
      { category: 'Hero Looks', dirs: [join(root, 'look')] },
    ];
    return categories.flatMap(({ category, dirs }) => {
      const stats = dirs.filter((dir) => existsSync(dir)).flatMap((dir) => readdirSync(dir).filter((name) => !name.startsWith('.')).map((name) => statSync(join(dir, name))));
      if (stats.length === 0) return [];
      const oldest = new Date(Math.min(...stats.map((st) => st.mtimeMs)));
      return [{ category, files: stats.length, bytes: stats.reduce((sum, st) => sum + st.size, 0), oldest: oldest.toISOString().slice(0, 10) }];
    });
  };

  /** The Rank Looks the others would read as another rank: the reader's own measure of ADR 0012, as Admin > Reader marks them. */
  const rankLookMisread = async (): Promise<Finding[]> => {
    const rows = db.prepare('SELECT id, rank, file FROM rank_look ORDER BY id').all() as { id: number; rank: string; file: string }[];
    const { features, unreadable } = await rankFeaturesFor(db, rows, join(root, 'rank-look'));
    const looks: { id: number; rank: string; features: Features }[] = rows.flatMap((r) => (features.has(r.id) ? [{ id: r.id, rank: r.rank, features: features.get(r.id)! }] : []));
    const measure = rankMeasure(looks.map((l) => l.features));
    // a file that is not a picture cannot be judged: it is named, and the review goes on without it
    const unreadableLooks: Finding[] = unreadable.map((id) => ({ code: 'rank-look-unreadable', subject: String(id), message: `Rank Look ${id}: the picture cannot be read. Delete the look, or put a picture back.` }));
    return [...unreadableLooks, ...looks.flatMap((look, i) => {
      const reading = readRank(look.features, looks.filter((_, j) => j !== i), measure);
      if (!reading?.confident || reading.rank === look.rank) return [];
      return [{ code: 'rank-look-misread', subject: String(look.id), filedUnder: look.rank, readAs: reading.rank, message: `Rank Look ${look.id}, filed under ${look.rank}, is read as ${reading.rank} by the others: check which rank it shows.` }];
    })];
  };

  /** The stored records whose Phantimal the game could not have put on the field (ADR 0029): only linked, a record is history and never changed here. */
  const recordPhantimalFaction = (): Finding[] =>
    factionMismatches(db).map((m) => ({
      code: 'record-phantimal-faction',
      subject: String(m.attemptId),
      message: `Record ${m.attemptId} (${m.mode}, side ${m.side}): ${m.problem}. Check the Phantimal in the record.`,
    }));

  /**
   * A hero whose rank on the roster is below its rank in the owner's latest record of it. The roster is current state and a recorded rank is
   * a snapshot, so this is "check this" and never a correction: the roster may be out of date, or the record misread. Only the owner's sides
   * count: Stage and Dream Hunt, and the Arena sides behind the default profile's Player ID.
   */
  const rosterBelowRecord = (): Finding[] => {
    const position = new Map((db.prepare('SELECT name, position FROM rank').all() as { name: string; position: number }[]).map((r) => [r.name, r.position]));
    const rosterRank = new Map(
      (db.prepare('SELECT hero_name AS hero, rank FROM roster WHERE profile_id = (SELECT id FROM profile WHERE is_default = 1) AND rank IS NOT NULL').all() as { hero: string; rank: string }[]).map((r) => [r.hero, r.rank]),
    );
    const records = db
      .prepare(
        `SELECT fh.hero_name AS hero, fh.rank AS rank, a.id AS recordId
         FROM attempt a JOIN formation f ON f.attempt_id = a.id JOIN formation_hero fh ON fh.formation_id = f.id
         WHERE fh.rank IS NOT NULL
           AND (a.mode != 'Arena' OR EXISTS (SELECT 1 FROM attempt_player ap WHERE ap.attempt_id = a.id AND ap.side = 'A' AND ap.player_id = (SELECT player_id FROM profile WHERE is_default = 1)))
         ORDER BY a.created_at, a.id`,
      )
      .all() as { hero: string; rank: string; recordId: number }[];
    const latest = new Map(records.map((r) => [r.hero, r]));
    return [...latest.values()].flatMap((r) => {
      const now = rosterRank.get(r.hero);
      if (now === undefined || (position.get(now) ?? Infinity) >= (position.get(r.rank) ?? -Infinity)) return [];
      return [{ code: 'roster-below-record', subject: r.hero, recordId: r.recordId, message: `The roster has ${r.hero} at ${now}, but its latest record (${r.recordId}) shows ${r.rank}: check which is current.` }];
    });
  };

  serve(app, reviewContract.deleteFiles, ({ body }) => {
    // only a file the scan offers now can be deleted: a referenced file, another folder, a path with .. or an unknown name refuses the whole request
    const offered = new Set(unreferencedFiles().map((f) => f.subject));
    if (!body.files.every((file) => offered.has(file))) return fail(409, 'The selection no longer matches the findings. Review again.');
    const files = [...new Set(body.files)];
    // every file is tried: one that cannot be removed must not leave the others standing, and one that is gone already is as good as removed
    const kept: string[] = [];
    for (const file of files) {
      try {
        unlinkSync(join(root, file));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') kept.push(file);
      }
    }
    if (kept.length > 0) return fail(500, `Removed ${files.length - kept.length} of ${files.length} files. Could not remove: ${kept.join(', ')}`);
    return { deleted: files.length };
  });

  const findAll = async (): Promise<ReviewFindings> => ({
    wrong: [...(await rankLookMisread()), ...recordPhantimalFaction(), ...rosterBelowRecord()],
    obsolete: unreferencedFiles(),
    improve: [...rankFewLooks(), ...heroNoExample()],
    kept: keptCategories(),
  });

  serve(app, reviewContract.dismiss, ({ body: { code, subject, message } }) => {
    db.prepare('INSERT OR IGNORE INTO review_dismissal (code, subject, message) VALUES (?, ?, ?)').run(code, subject, message);
    return { code, subject, message };
  });

  serve(app, reviewContract.restore, ({ body: { code, subject, message } }) => {
    db.prepare('DELETE FROM review_dismissal WHERE code = ? AND subject = ? AND message = ?').run(code, subject, message);
    return { code, subject, message };
  });

  /** Looks again at everything and keeps the result as a Review run (ADR 0032). */
  serve(app, reviewContract.startRun, async () => {
    const findings = await findAll();
    const id = Number(db.prepare('INSERT INTO review_run (findings) VALUES (?)').run(JSON.stringify(findings)).lastInsertRowid);
    db.prepare('DELETE FROM review_run WHERE id NOT IN (SELECT id FROM review_run ORDER BY id DESC LIMIT ?)').run(RUNS_KEPT);
    return loadReviewRun(db, id)!;
  });

  serve(app, reviewContract.latestRun, () => {
    const id = latestReviewRunId(db);
    return id === null ? null : loadReviewRun(db, id);
  });

  return app;
}
