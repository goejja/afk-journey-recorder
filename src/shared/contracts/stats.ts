import { z } from 'zod';
import type { ArtifactStat, FactionMismatch, FormationProfileStat, FormationReport, HeroDistribution, HeroStat, MapStat, PairStat, PlayerStat, RowStat, RuleStat, StageStat, Summary, TrioStat } from '../api.js';
import { endpoint } from '../contract.js';

const text = z.string().optional();
const texts = z.union([z.string(), z.array(z.string())]).optional();

/** The filters every view of sides shares: modes, tags and Players (by Player ID), each matching any of those given. */
const common = { mode: texts, tag: texts, player: texts, excludeDefault: text };
const withMin = z.object({ ...common, min: text });

// The answers are typed with the shapes of src/shared/api.ts; the query layer builds them.
const list = <T>() => z.array(z.custom<T>());

export const statsContract = {
  summary: endpoint({ method: 'GET', path: '/api/stats/summary', response: z.custom<Summary>() }),
  heroes: endpoint({ method: 'GET', path: '/api/stats/heroes', query: withMin, response: list<HeroStat>() }),
  heroDistribution: endpoint({ method: 'GET', path: '/api/stats/heroes/:hero/distribution', query: z.object(common), response: z.custom<HeroDistribution>() }),
  heroRows: endpoint({ method: 'GET', path: '/api/stats/heroes/:hero/rows', query: z.object(common), response: list<RowStat>() }),
  artifacts: endpoint({ method: 'GET', path: '/api/stats/artifacts', query: withMin, response: list<ArtifactStat>() }),
  maps: endpoint({ method: 'GET', path: '/api/stats/maps', query: withMin, response: list<MapStat>() }),
  rules: endpoint({ method: 'GET', path: '/api/stats/rules', query: withMin, response: list<RuleStat>() }),
  /** The Formation groups under their Archetype rows with labels; `hero` (repeated) keeps the groups that hold every hero given. */
  formationReport: endpoint({ method: 'GET', path: '/api/stats/formation-report', query: withMin.extend({ hero: texts }), response: z.custom<FormationReport>() }),
  formationProfile: endpoint({ method: 'GET', path: '/api/stats/formation-profile', query: z.object({ ...common, core: texts }), response: z.custom<FormationProfileStat>() }),
  /** Read-only: the stored records whose Phantimal its heroes cannot have brought (ADR 0029). Never changes a record. */
  factionMismatches: endpoint({ method: 'GET', path: '/api/stats/faction-mismatches', response: list<FactionMismatch>() }),
  pairs: endpoint({ method: 'GET', path: '/api/stats/pairs', query: withMin, response: list<PairStat>() }),
  trios: endpoint({ method: 'GET', path: '/api/stats/trios', query: withMin, response: list<TrioStat>() }),
  players: endpoint({ method: 'GET', path: '/api/stats/players', query: z.object({ mode: texts, excludeDefault: text, min: text }), response: list<PlayerStat>() }),
  stages: endpoint({ method: 'GET', path: '/api/stats/stages', query: z.object({ kind: texts, season: text, tag: texts, min: text }), response: list<StageStat>() }),
};
