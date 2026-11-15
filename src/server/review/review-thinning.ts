import type Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { planThinning, THINNING_FLOOR, type ThinningPicture, type ThinningSource } from '../../domain/thinning.js';
import { distanceTable } from '../../vision/nearest.js';
import { distance as rankDistance, rankFeatures, type Features } from '../../vision/rank-read.js';
import { fileCache } from '../file-cache.js';
import { reviewContract } from '../../shared/contracts/review.js';
import { fail, serve } from '../contract.js';
import { wrongReadings } from '../reader/learned.js';
import { loadThinningSettings } from './thinning-settings.js';

type RankPicture = ThinningPicture & { features: Features };

/** The Thinning of the learnt pictures (ADR 0031): which near-identical ones add nothing to the readers, proposed and never removed here. */
export function reviewThinningRoutes(db: Database.Database, options: { imagesDir?: string } = {}): Hono {
  const app = new Hono();
  const root = join(resolve(options.imagesDir ?? 'images'), 'custom');
  const features = fileCache<Promise<Features>>();

  const rankPictures = async (): Promise<RankPicture[]> => {
    const rows = db.prepare('SELECT id, rank, file, source FROM rank_look ORDER BY id').all() as { id: number; rank: string; file: string; source: ThinningSource }[];
    const pictures: RankPicture[] = [];
    for (const r of rows) {
      const file = join(root, 'rank-look', r.file);
      if (existsSync(file)) pictures.push({ id: r.id, group: r.rank, source: r.source, flagged: false, features: await features(file, rankFeatures) });
    }
    return pictures;
  };

  /** The groups of Rank Looks the review offers to remove, as they are now. */
  const rankProposal = async () => {
    const pictures = await rankPictures();
    const plans = planThinning(pictures, { threshold: loadThinningSettings(db).rank, floor: THINNING_FLOOR, distance: (a, b) => rankDistance(a.features, b.features) });
    // a removal is offered only if the rank reader, reading each look from all the others, names no more wrong ranks without it than without
    // the removals offered before it (ADR 0031); one that does harm stays, and does not hold back the others of its group
    const measure = distanceTable(pictures.map((p) => p.features), rankDistance);
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
    db.transaction(() => {
      for (const r of rows) db.prepare('DELETE FROM rank_look WHERE id = ?').run(r.id);
    })();
    for (const r of rows) {
      try {
        unlinkSync(join(root, 'rank-look', r.file));
      } catch {
        // not there
      }
    }
    return { deleted: rows.length };
  });

  return app;
}
