import { parseArgs } from 'node:util';
import { openReadonly } from '../src/db/open.js';
import { formationProfile, formationReport } from '../src/query/formation-profile.js';
import { factionMismatches } from '../src/query/faction-mismatches.js';
import { reviewRun } from '../src/query/review-run.js';
import { dreamHuntBest, formationIds, parseDeployment, profiles, heroInfo, heroStats, pairStats, artifactStats, formationGroups, formationStats, heroDistribution, heroRowStats, mapStats, ruleStats, playerIds, playerStats, roster, trioStats, runSelect, scenario, scenarios, stageHistory, stageStats, summary } from '../src/query/index.js';
import { cliCommands, cliUsage } from '../src/advisor/index.js';

const USAGE = `Read-only queries on the AFK Journey history. Usage: npm run query -- <command> [options]

  summary                                     records per mode and per tag
  roster        [--profile NAME]              the heroes you own, with rank and equipment (the default profile unless told)
  profiles                                    the profiles: name, player ID, default, number of heroes
  hero-stats    [--mode M[,M]] [--tag T ...] [--min N]   win rate per hero (several modes comma-separated, --tag repeated)
  pair-stats    [--mode M[,M]] [--tag T ...] [--min N]   win rate per pair of heroes on one side
  artifact-stats [--mode M[,M]] [--tag T ...] [--min N]   win rate per artifact, from the side that used it
  map-stats     [--mode M[,M]] [--tag T ...] [--min N]   win rate of Side A per map (both sides share the map, so Side A only)
  rule-stats    [--mode M[,M]] [--tag T ...] [--min N]   win rate of Side A per rule
  faction-check                               stored records whose Phantimal its heroes cannot have brought (read only)
  review [--run N]                            the findings of the last Reader review run (or run N) in Admin > Review: new ones marked, dismissed ones counted
  hero-rows     --name HERO [--mode M[,M]] [--tag T ...]   win rate of a hero by game row (the diagonal rows of ADR 0036) from its own back edge (1 = back, 15 = front)
  formation-stats [--mode M[,M]] [--tag T ...] [--player P ...] [--min N]   most used formations (the set of heroes on a side, nothing else) with win rate
  formation-groups [--mode M[,M]] [--tag T ...] [--player P ...] [--min N]   formations that differ by one hero grouped: core heroes, games, win rate, and each variant
  formation-report [--mode M[,M]] [--tag T ...] [--player P ...] [--hero H ...]   the Formation groups under Archetype rows: core and flex heroes with shares, games, win rate against the average of all sides, players, labels
  formation-profile --core "A,B,C" [--mode M[,M]] [--tag T ...] [--player P ...]   one group: artifacts, variations, hero impact, enemy groups it is strong or weak against, results by upgrade gap
  trio-stats    [--mode M[,M]] [--tag T ...] [--min N]   win rate per trio of heroes on one side
  hero-distribution --name HERO [--mode M[,M]] [--tag T ...]   how many Players fielded a hero at each rank and equipment level (latest record of each Player)
  player-stats  [--mode M[,M]] [--min N]   win rate per Player (Player ID on a side of a PvP record), with their most used formations
  stage-stats   [--kind K[,K]] [--season N] [--tag T ...] [--min N]   win rate per stage
  stage         --season N --kind K --number N [--phase P]    attempts on one stage
  dream-hunt    --boss NAME [--rule any|none|NAME] [--tag T]  team comparison for a boss
  formation-ids [--units "Alna@31,Rolan@27|Mira@30"] [--phantimal "Orson@30|"]
                                              the player's Formation IDs (the game's codes for a Deployment of 1 to 5 teams); with units,
                                              those covering every team given with the same units on the same tiles, as placed or all
                                              turned upside down (tile i is tile 44 - i). Teams are separated by "|", team 1 first, and
                                              so are their phantimals. A part of a pair is "Elijah & Lailah/Elijah@30"; a phantimal on
                                              two tiles is "Name@30+31"
  hero-info     --name HERO                   hero attributes and mechanic tags (outside data when synced)
  scenarios                                   the planning scenarios
  scenario      --id N [--profile NAME]       one scenario: pinned heroes, enemy teams, free roster heroes
${cliUsage}
  sql           "SELECT ..."                  one read-only SELECT

The statistics (hero-stats, pair-stats, trio-stats, formation-stats, formation-groups, artifact-stats, map-stats, rule-stats, hero-rows, hero-distribution) also take --player ID_OR_PROFILE_NAME, repeated: only the sides of those Players. They and player-stats also take --exclude-default: leave out the sides of the default profile's Player ID.

Modes: Stage, Dream Hunt, Arena, Supreme Arena, Super League, Guild Duel, Treasure Rush. Database: data/afk.db, or --db PATH or AFK_DB.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    db: { type: 'string' }, mode: { type: 'string' }, tag: { type: 'string', multiple: true }, player: { type: 'string', multiple: true }, 'exclude-default': { type: 'boolean' }, 'no-gap': { type: 'boolean' }, 'archetype-similarity': { type: 'string' }, min: { type: 'string' },
    enemy: { type: 'string' }, core: { type: 'string' }, hero: { type: 'string', multiple: true }, team: { type: 'string' }, 'min-similarity': { type: 'string' }, limit: { type: 'string' },
    run: { type: 'string' }, season: { type: 'string' }, kind: { type: 'string' }, number: { type: 'string' }, phase: { type: 'string' },
    boss: { type: 'string' }, profile: { type: 'string' }, against: { type: 'string' }, 'min-sample': { type: 'string' }, 'prior-strength': { type: 'string' }, 'stronger-weight': { type: 'string' }, rule: { type: 'string' }, id: { type: 'string' }, scenario: { type: 'string' }, name: { type: 'string' }, units: { type: 'string' }, phantimal: { type: 'string' },
  },
});

const [command, ...rest] = positionals;
if (!command || command === 'help') {
  console.log(USAGE);
  process.exit(command ? 0 : 1);
}

const need = (name: keyof typeof values) => {
  const value = values[name];
  if (value === undefined) throw new Error(`--${name} is required for "${command}"`);
  return value as string;
};
const num = (text: string | undefined) => (text === undefined ? undefined : Number(text));

const dbPath = values.db ?? process.env['AFK_DB'] ?? 'data/afk.db';
// Never migrates: a database that is not at the current version is opened by the app (or `npm run db:init`) first.
const db = openReadonly(dbPath);
try {
  // Commands that compare one enemy or team take one mode and tag; the statistics take several (modes comma-separated, --tag repeated).
  const filters = { mode: values.mode, tag: values.tag?.at(-1) };
  const statFilters = { mode: values.mode?.split(',').map((m) => m.trim()), tag: values.tag, player: values.player && playerIds(db, values.player), excludeDefault: values['exclude-default'] };
  const result = (() => {
    switch (command) {
      case 'summary': return summary(db);
      case 'roster': return roster(db, values.profile);
      case 'profiles': return profiles(db);
      case 'hero-stats': return heroStats(db, { ...statFilters, minGames: num(values.min) });
      case 'pair-stats': return pairStats(db, { ...statFilters, minGames: num(values.min) });
      case 'artifact-stats': return artifactStats(db, { ...statFilters, minGames: num(values.min) });
      case 'map-stats': return mapStats(db, { ...statFilters, minGames: num(values.min) });
      case 'rule-stats': return ruleStats(db, { ...statFilters, minGames: num(values.min) });
      case 'faction-check': return factionMismatches(db);
      case 'review': return reviewRun(db, values.run === undefined ? undefined : num(values.run));
      case 'hero-rows': return heroRowStats(db, need('name'), statFilters);
      case 'formation-stats': return formationStats(db, { ...statFilters, minGames: num(values.min) });
      case 'formation-groups': return formationGroups(db, { ...statFilters, minGames: num(values.min) });
      case 'formation-report': return formationReport(db, { ...statFilters, hero: values.hero });
      case 'formation-profile': return formationProfile(db, need('core').split(',').map((s) => s.trim()).filter(Boolean), statFilters) ?? { error: 'No formation group has these core heroes' };
      case 'trio-stats': return trioStats(db, { ...statFilters, minGames: num(values.min) });
      case 'hero-distribution': return heroDistribution(db, need('name'), statFilters);
      case 'player-stats': return playerStats(db, { mode: statFilters.mode, excludeDefault: statFilters.excludeDefault, minGames: num(values.min) });
      case 'stage':
        return stageHistory(db, { season: Number(need('season')), kind: need('kind'), number: Number(need('number')), phase: num(values.phase) });
      case 'dream-hunt': return dreamHuntBest(db, need('boss'), { rule: values.rule, tag: values.tag?.at(-1) });
      case 'stage-stats': return stageStats(db, { kind: values.kind?.split(',').map((k) => k.trim()), season: num(values.season), tag: values.tag, minGames: num(values.min) });
      case 'formation-ids': return formationIds(db, values.units === undefined && values.phantimal === undefined ? undefined : parseDeployment(values.units ?? '', values.phantimal));
      case 'hero-info': return heroInfo(db, need('name')) ?? (() => { throw new Error('Unknown hero'); })();
      case 'scenarios': return scenarios(db);
      case 'scenario': return scenario(db, Number(need('id')), values.profile) ?? (() => { throw new Error('Unknown scenario'); })();
      case 'sql': return runSelect(db, rest.join(' '));
      default: {
        const advisorCommand = cliCommands[command!];
        if (!advisorCommand) throw new Error(`Unknown command "${command}". Run: npm run query -- help`);
        return advisorCommand({ db, filters, statFilters, option: (name: string) => (typeof (values as Record<string, unknown>)[name] === 'string' ? ((values as Record<string, unknown>)[name] as string) : undefined), flag: (name: string) => (values as Record<string, unknown>)[name] === true, required: (name: string) => need(name as keyof typeof values) });
      }
    }
  })();
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
