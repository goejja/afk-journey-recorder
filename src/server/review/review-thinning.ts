import type Database from 'better-sqlite3';
import { statSync } from 'node:fs';
import { Hono } from 'hono';
import { planThinning, THINNING_FLOOR, type ThinningPicture, type ThinningSource } from '../../domain/thinning.js';
import type { Features } from '../../vision/rank-read.js';
import { reviewContract } from '../../shared/contracts/review.js';
import { fail, serve } from '../contract.js';
import { wrongReadings } from '../reader/learned.js';
import { learnedPicturesRoot, pictureDir, picturePath, removeLooks } from '../reader/learned-pictures.js';
import { rankFeaturesFor, rankMeasure } from '../reader/rank-looks.js';
import { loadThinningSettings } from './thinning-settings.js';

type RankPicture = ThinningPicture & { features: Features };

/** The Thinning of the learnt pictures (ADR 0031): which near-identical ones add nothing to the readers, proposed and never removed here. */
export function reviewThinningRoutes(db: Database.Database, options: { imagesDir?: string } = {}): Hono {
  const app = new Hono();
  const root = learnedPicturesRoot(options.imagesDir);

  /** The Rank Looks as they are now, with a key that changes when a row or a picture file does. */
  const rankPictures = async (): Promise<{ key: string; pictures: RankPicture[] }> => {
    const rows = db.prepare('SELECT id, rank, file, source FROM rank_look ORDER BY id').all() as { id: number; rank: string; file: string; source: ThinningSource }[];
    const pictures: RankPicture[] = [];
    const stamps: string[] = [];
    // a picture that is missing or cannot be read is left out; the findings of the review name it
    const { features } = await rankFeaturesFor(db, rows, pictureDir(root, 'rank_look'));
    for (const r of rows) {
      const found = features.get(r.id);
      if (!found) continue;
      const { size, mtimeMs } = statSync(picturePath(root, 'rank_look', r.file));
      stamps.push(`${r.id}:${r.rank}:${r.source}:${size}:${mtimeMs}`);
      pictures.push({ id: r.id, group: r.rank, source: r.source, flagged: false, features: found });
    }
    return { key: stamps.join('|'), pictures };
  };

  type Proposal = Awaited<ReturnType<typeof computeProposal>>;

  const computeProposal = (pictures: RankPicture[], threshold: number) => {
    // the table is filled once, and the plan and every pass of the reader below read from it
    const measure = rankMeasure(pictures.map((p) => p.features));
    const plans = planThinning(pictures, { threshold, floor: THINNING_FLOOR, distance: (a, b) => measure(a.features, b.features) });
    // a removal is offered only if the rank reader, reading each look from all the others, names no more wrong ranks without it than without
    // the removals offered before it (ADR 0031); one that does harm stays, and does not hold back the others of its group
    const wrong = (without: Set<number>) => wrongReadings(pictures.filter((p) => !without.has(p.id)).map((p) => ({ rank: p.group, features: p.features })), measure);
    const removed = new Set<number>();
    const baseline = wrong(removed);
    let best = baseline;
    const offered = plans.map((plan) => {
      const remove: RankPicture[] = [];
      for (const picture of plan.remove) {
        const count = wrong(new Set([...removed, picture.id]));
        if (count <= best) {
          removed.add(picture.id);
          best = count;
          remove.push(picture);
        }
      }
      return { group: plan.group, keep: [...plan.keep, ...plan.remove.filter((p) => !remove.includes(p))], remove };
    }).filter((plan) => plan.remove.length > 0);
    return { offered, baseline, wrong, looks: pictures.length };
  };

  /**
   * The groups of Rank Looks the review offers to remove, as they are now. The work grows with the square of the looks and runs on the
   * one thread that serves every page, so the answer is kept while the looks (rows and picture files) and the threshold are the same.
   */
  let kept: { key: string; proposal: Proposal } | null = null;
  const rankProposal = async (): Promise<Proposal> => {
    const { key: looks, pictures } = await rankPictures();
    const key = `${loadThinningSettings(db).rank}#${looks}`;
    if (kept?.key === key) return kept.proposal;
    const proposal = computeProposal(pictures, loadThinningSettings(db).rank);
    kept = { key, proposal };
    return proposal;
  };

  const groupsOf = (offered: { group: string; keep: { id: number }[]; remove: { id: number }[] }[]) => offered.map((p) => ({ group: p.group, keep: p.keep.map((k) => k.id), remove: p.remove.map((r) => r.id) }));

  serve(app, reviewContract.thinning, async () => {
    const proposal = await rankProposal();
    const removed = proposal.offered.flatMap((g) => g.remove.map((r) => r.id));
    const counts = { looks: proposal.looks, looksAfter: proposal.looks - removed.length, wrong: proposal.baseline, wrongAfter: proposal.wrong(new Set(removed)) };
    return { kinds: [{ kind: 'rank' as const, counts, groups: groupsOf(proposal.offered) }] };
  });

  serve(app, reviewContract.applyThinning, async ({ body }) => {
    // only what the proposal offers now can be removed: a stale selection, a kept picture or an unknown id refuses the whole request
    const proposal = await rankProposal();
    const offered = new Set(proposal.offered.flatMap((g) => g.remove.map((r) => r.id)));
    if (!body.ids.every((id) => offered.has(id))) return fail(409, 'The selection no longer matches the proposal. Review again.');
    // the proposal tried the removals in order, so a few of them may be harmless only together: the ticked set must itself leave the reader no worse
    if (proposal.wrong(new Set(body.ids)) > proposal.baseline) return fail(409, 'Removing only these would make the rank reader name more wrong ranks. Tick the whole group.');
    const rows = body.ids.map((id) => db.prepare('SELECT id, file FROM rank_look WHERE id = ?').get(id) as { id: number; file: string });
    removeLooks(db, root, 'rank_look', rows);
    return { deleted: rows.length };
  });

  return app;
}
