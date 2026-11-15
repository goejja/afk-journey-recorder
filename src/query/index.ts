/**
 * Read-only questions the formation-suggestion agent asks of the history. Everything here only
 * reads. The numbers are counts of past records, not simulations: small samples say little,
 * so each result carries its sample size.
 */

export { type Filters, type StatFilters, APPEARANCES, whereFor, playerIds, runSelect } from './filters.js';
export { summary, profileIdOf, roster, profiles } from './overview.js';
export { heroStats, pairStats, heroDistribution, trioStats, artifactStats, mapStats, ruleStats, heroRowStats } from './hero-stats.js';
export { formationStats, type GroupHero, type FormationGroup, formationGroups, groupSides, type Archetype, formationArchetypes } from './formations.js';
export { playerStats } from './players.js';
export { stageHistory, dreamHuntBest, stageStats } from './stages.js';
export { scenarios, scenario } from './scenarios.js';
export { heroInfo } from './heroes.js';
export { parseLayout, parseDeployment, formationIds } from './deployments.js';
export { round3 as round } from '../domain/stats.js';
