import type Database from 'better-sqlite3';
import { Hono, type Context } from 'hono';
import type { ArtifactStat, BackCheck, DunlingrCheck, HeroStat, PartnerReport, PositionalPartnerReport, FormationGroupStat, Summary } from '../../shared/api.js';
import { statsContract } from '../../shared/contracts/stats.js';
import { formationProfile, formationReport } from '../../query/formation-profile.js';
import { type HeroSetPaging, artifactStats, groupCounterReport, heroDistribution, heroRowStats, heroStats, mapStats, mapFormations, pairReport, partnerStats, partnerTags, positionalPartners, playerStats, trioReport, summary } from '../../query/index.js';
import { isPartnerRelation, PARTNER_RELATIONS } from '../../domain/partner-relation.js';
import { factionMismatches } from '../../query/faction-mismatches.js';
import { backCheck, dunlingrCheck } from '../../advisor/index.js';
import { fail, serve } from '../contract.js';
import { listParam } from '../params.js';

/** Read-only win-rate views over the recorded history, the same numbers the agent's query CLI gives. */
export function statsRoutes(db: Database.Database): Hono {
  const app = new Hono();
  const number = (text: string | undefined) => (text !== undefined && text !== '' && Number.isFinite(Number(text)) ? Number(text) : undefined);
  /** The filters every view of sides shares: modes, tags, Players (by Player ID) and the seasons records were played in, each matching any of those given. */
  const common = (c: Context) => ({ mode: listParam(c, 'mode'), tag: listParam(c, 'tag'), player: listParam(c, 'player'), playedIn: listParam(c, 'playedIn'), excludeDefault: c.req.query('excludeDefault') === 'true' });
  const withMin = (c: Context) => ({ ...common(c), minGames: number(c.req.query('min')) });
  /** How many hero groups to keep and in which order (the lists of pairs and trios are cut to the best rows). */
  const heroSetPaging = (c: Context): HeroSetPaging => {
    const sort = c.req.query('sort');
    return { limit: number(c.req.query('limit')), sort: sort === 'winRate' || sort === 'games' ? sort : undefined };
  };
  const badSort = (c: Context) => ![undefined, '', 'winRate', 'games'].includes(c.req.query('sort'));
  const BAD_SORT = 'The sort is winRate or games';

  serve(app, statsContract.summary, () => summary(db) as Summary);

  serve(app, statsContract.heroes, (_, c) => heroStats(db, withMin(c)) as HeroStat[]);
  serve(app, statsContract.heroDistribution, ({ params }, c) => heroDistribution(db, params.hero, common(c)));
  serve(app, statsContract.heroRows, ({ params }, c) => heroRowStats(db, params.hero, common(c)));

  serve(app, statsContract.artifacts, (_, c) => artifactStats(db, withMin(c)) as ArtifactStat[]);
  serve(app, statsContract.maps, (_, c) => mapStats(db, withMin(c)));
  serve(app, statsContract.mapFormations, (_, c) => (c.req.query('map') ? (mapFormations(db, { ...common(c), map: c.req.query('map') }) as FormationGroupStat[]) : fail(400, 'A map is required')));
  serve(app, statsContract.formationReport, (_, c) => formationReport(db, { ...withMin(c), hero: listParam(c, 'hero') }));
  serve(app, statsContract.formationProfile, (_, c) => formationProfile(db, listParam(c, 'core') ?? [], common(c)) ?? fail(404, 'No formation group has these core heroes'));
  serve(app, statsContract.groupCounters, (_, c) => groupCounterReport(db, withMin(c)));
  serve(app, statsContract.factionMismatches, () => factionMismatches(db));
  serve(app, statsContract.backCheck, () => backCheck(db) as BackCheck);
  serve(app, statsContract.dunlingrCheck, () => dunlingrCheck(db) as DunlingrCheck);

  serve(app, statsContract.pairs, (_, c) => (badSort(c) ? fail(400, BAD_SORT) : pairReport(db, withMin(c), heroSetPaging(c))));
  serve(app, statsContract.partners, (_, c) => {
    const hero = c.req.query('hero');
    return hero ? (partnerStats(db, hero, withMin(c)) as PartnerReport) : fail(400, 'A hero is required');
  });
  serve(app, statsContract.partnerPositions, (_, c) => {
    const hero = c.req.query('hero');
    const relation = c.req.query('relation') ?? '';
    if (!hero) return fail(400, 'A hero is required');
    if (!isPartnerRelation(relation)) return fail(400, `The relation is one of ${PARTNER_RELATIONS.join(', ')}`);
    return positionalPartners(db, hero, relation, withMin(c)) as PositionalPartnerReport;
  });
  serve(app, statsContract.partnerTags, () => partnerTags(db));
  serve(app, statsContract.trios, (_, c) => (badSort(c) ? fail(400, BAD_SORT) : trioReport(db, withMin(c), heroSetPaging(c))));

  serve(app, statsContract.players, (_, c) => playerStats(db, { mode: listParam(c, 'mode'), playedIn: listParam(c, 'playedIn'), excludeDefault: c.req.query('excludeDefault') === 'true', minGames: number(c.req.query('min')) }));

  return app;
}
