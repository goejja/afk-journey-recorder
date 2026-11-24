import { z } from 'zod';
import type { ArtifactStat, BackCheck, DunlingrCheck, FactionMismatch, FormationGroupStat, FormationProfileStat, FormationReport, GroupCounterReport, HeroDistribution, HeroStat, MapStat, PairStat, PartnerReport, PartnerTag, PositionalPartnerReport, PlayerStat, RowStat, StatRows, Summary, TrioStat } from '../api.js';
import { PARTNER_RELATIONS } from '../../domain/partner-relation.js';
import { endpoint, queryText as text, queryTexts as texts } from '../contract.js';


/** The filters every view of sides shares: modes, tags, Players (by Player ID) and the seasons records were played in, each matching any of those given. */
const common = { mode: texts, tag: texts, player: texts, playedIn: texts, excludeDefault: text };
const withMin = z.object({ ...common, min: text });
/** The lists of hero groups are cut to the best rows: `limit` rows (500 when absent) after sorting by `sort` (`winRate`, the default, or `games`). */
const paged = withMin.extend({ limit: text, sort: text });

// The answers are typed with the shapes of src/shared/api.ts; the query layer builds them.
const list = <T>() => z.array(z.custom<T>());

export const statsContract = {
  summary: endpoint({ method: 'GET', path: '/api/stats/summary', response: z.custom<Summary>() }),
  heroes: endpoint({ method: 'GET', path: '/api/stats/heroes', query: withMin, response: list<HeroStat>() }),
  heroDistribution: endpoint({ method: 'GET', path: '/api/stats/heroes/:hero/distribution', query: z.object(common), response: z.custom<HeroDistribution>() }),
  heroRows: endpoint({ method: 'GET', path: '/api/stats/heroes/:hero/rows', query: z.object(common), response: list<RowStat>() }),
  artifacts: endpoint({ method: 'GET', path: '/api/stats/artifacts', query: withMin, response: list<ArtifactStat>() }),
  maps: endpoint({ method: 'GET', path: '/api/stats/maps', query: withMin, response: list<MapStat>() }),
  /** The best win-rate Formation groups on one map, from both sides of the PvP records the filters select. */
  mapFormations: endpoint({ method: 'GET', path: '/api/stats/map-formations', query: z.object({ ...common, map: z.string().min(1) }), response: list<FormationGroupStat>() }),
  /** The Formation groups under their Archetype rows with labels; `hero` (repeated) keeps the groups that hold every hero given. */
  formationReport: endpoint({ method: 'GET', path: '/api/stats/formation-report', query: withMin.extend({ hero: texts }), response: z.custom<FormationReport>() }),
  formationProfile: endpoint({ method: 'GET', path: '/api/stats/formation-profile', query: z.object({ ...common, core: texts }), response: z.custom<FormationProfileStat>() }),
  /** Which Formation group beats which, from the PvP battles the filters select (both sides of each); the counter rule is the one saved in Admin. */
  groupCounters: endpoint({ method: 'GET', path: '/api/stats/group-counters', query: withMin, response: z.custom<GroupCounterReport>() }),
  /** Read-only: the stored records whose Phantimal its heroes cannot have brought (ADR 0029). Never changes a record. */
  factionMismatches: endpoint({ method: 'GET', path: '/api/stats/faction-mismatches', response: list<FactionMismatch>() }),
  /** Read-only: the records where a ranged damage dealer is not at the back of its side (#221). Never changes a record. */
  dunlingrCheck: endpoint({ method: 'GET', path: '/api/stats/dunlingr-check', response: z.custom<DunlingrCheck>() }),
  backCheck: endpoint({ method: 'GET', path: '/api/stats/back-check', response: z.custom<BackCheck>() }),
  pairs: endpoint({ method: 'GET', path: '/api/stats/pairs', query: paged, response: z.custom<StatRows<PairStat>>() }),
  /** The heroes fielded on the same side as `hero`, from the sides the filters select. */
  partners: endpoint({ method: 'GET', path: '/api/stats/partners', query: withMin.extend({ hero: z.string().min(1) }), response: z.custom<PartnerReport>() }),
  /** Who stood in a relation (behind, around, in the same game row...) to `hero` at the start of the fight. */
  partnerPositions: endpoint({ method: 'GET', path: '/api/stats/partner-positions', query: withMin.extend({ hero: z.string().min(1), relation: z.enum(PARTNER_RELATIONS) }), response: z.custom<PositionalPartnerReport>() }),
  /** The mechanic tags of the unit info, each with the heroes that carry it. */
  partnerTags: endpoint({ method: 'GET', path: '/api/stats/partner-tags', response: list<PartnerTag>() }),
  trios: endpoint({ method: 'GET', path: '/api/stats/trios', query: paged, response: z.custom<StatRows<TrioStat>>() }),
  players: endpoint({ method: 'GET', path: '/api/stats/players', query: z.object({ mode: texts, playedIn: texts, excludeDefault: text, min: text }), response: list<PlayerStat>() }),
};
