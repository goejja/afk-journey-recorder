/**
 * Read-only questions the formation-suggestion agent asks of the history. Everything here only
 * reads. The numbers are counts of past records, not simulations: small samples say little,
 * so each result carries its sample size.
 */

export { type Filters, type StatFilters, APPEARANCES, whereFor, playerIds, runSelect, modesFor } from './filters.js';
export { summary, profileIdOf, roster, profiles } from './overview.js';
export { partnerStats, partnerTags, positionalPartners } from './partners.js';
export { heroStats, pairReport, heroDistribution, trioReport, artifactStats, mapStats, heroRowStats, type HeroSetPaging, type HeroSetSort } from './hero-stats.js';
export { formationStats, type GroupHero, type FormationGroup, formationGroups, mapFormations, groupSides, type Archetype, formationArchetypes, groupCounters, groupCounterReport, counterRule, counterSummary } from './formations.js';
export { playerStats } from './players.js';
export { stageHistory, dreamHuntBest } from './stages.js';
export { scenarios, scenario } from './scenarios.js';
export { heroInfo } from './heroes.js';
export { parseDeployment, formationIds } from './deployments.js';
export { round3 as round } from '../domain/stats.js';
