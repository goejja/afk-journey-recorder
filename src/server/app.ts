import type Database from 'better-sqlite3';
import { Hono, type Context } from 'hono';
import { findProfile } from '../db/profiles.js';
import { isStartingHero, STARTING_TIER } from '../db/starting-heroes.js';
import { minimumRank, validateHeroState, type HeroStateRules } from '../domain/hero-state.js';
import { arenaRoutes } from './records/arena.js';
import { battleRoutes } from './records/battles.js';
import { tournamentRoutes } from './records/tournaments.js';
import { roundDeploymentRoutes } from './records/round-deployments.js';
import { adminRoutes } from './admin.js';
import { systemProbe, type AgentProbe } from './agent/agent-probe.js';
import { agentSettingsRoutes } from './agent/agent-settings.js';
import { cleanupRoutes } from './review/cleanup.js';
import { FormationIdError } from '../db/formation-ids.js';
import { formationIdRoutes } from './records/formation-id-routes.js';
import * as advisor from '../advisor/index.js';
import { defaultsRoutes } from './reference/defaults.js';
import { dreamHuntRoutes } from './records/dream-hunt.js';
import { imageRoutes } from './reference/images.js';
import { mapRoutes } from './reference/maps.js';
import { artifactRoutes } from './reference/artifacts.js';
import { phantimalRoutes } from './reference/phantimals.js';
import { heroAdminRoutes } from './reference/hero-admin.js';
import { unitRuleRoutes } from './reference/unit-rules.js';
import { profileRoutes } from './reference/profiles.js';
import { recordStateRoutes } from './records/record-states.js';
import { statsSettingsRoutes } from './stats/stats-settings.js';
import { updateSettingRoutes } from './reference/update-setting.js';
import { seasonRoutes } from './reference/seasons.js';
import { scenarioRoutes } from './scenarios.js';
import { newAgentSlot } from './agent/agent-slot.js';
import { importFeedbackRoutes } from './reader/import-feedback.js';
import { keptPictureRoutes } from './reader/kept-pictures.js';
import { learnedRoutes } from './reader/learned.js';
import { reviewExplainRoutes } from './agent/review-explain.js';
import { reviewFindingsRoutes } from './review/review-findings.js';
import { reviewThinningRoutes } from './review/review-thinning.js';
import { thinningSettingsRoutes } from './review/thinning-settings.js';
import { readerExampleRoutes } from './reader/reader-examples.js';
import { rosterImportRoutes } from './reader/roster-import.js';
import { scenarioRunRoutes, type AgentRunner } from './agent/scenario-run.js';
import { spawnAgent } from './agent/spawn-agent.js';
import { statsRoutes } from './stats/stats.js';
import { stageRoutes } from './records/stages.js';
import { requestGuard } from './request-guard.js';
import { tagRoutes } from './records/tags.js';
import type { Rules } from '../shared/api.js';
import { rosterContract } from '../shared/contracts/roster.js';
import { fail, serve } from './contract.js';
import { hasName } from './db-helpers.js';

interface HeroRow {
  name: string;
  tier: 'R' | 'A' | 'S' | null;
  class: string | null;
  faction: string | null;
  damage_type: string | null;
  image_path: string | null;
  owned: number;
  rank: string | null;
  equipment_level: number | null;
}

export function loadRules(db: Database.Database): HeroStateRules {
  return {
    ranks: db.prepare('SELECT name FROM rank ORDER BY position').pluck().all() as string[],
    equipmentLevels: db.prepare('SELECT level FROM equipment_level ORDER BY level').pluck().all() as number[],
    caps: db
      .prepare('SELECT rank, min_level AS minLevel, max_level AS maxLevel FROM rank_equipment_cap')
      .all() as HeroStateRules['caps'],
  };
}

/** The local JSON API. Pure over its database, so tests can run it in memory. */
export function createApp(db: Database.Database, options: { imagesDir?: string; agentRunner?: AgentRunner; agentProbe?: AgentProbe; importWorkDir?: string; importConcurrency?: number; importMaxBytes?: number; importPersist?: boolean } = {}): Hono {
  const app = new Hono();
  app.use('*', requestGuard);
  app.onError((error, c) => (error instanceof FormationIdError ? c.json({ error: error.message }, 400) : (console.error(error), c.json({ error: 'Internal error' }, 500))));
  app.route('/', formationIdRoutes(db));
  app.route('/', mapRoutes(db));
  app.route('/', imageRoutes(db, options.imagesDir ?? 'images'));
  app.route('/', phantimalRoutes(db));
  app.route('/', unitRuleRoutes(db));
  app.route('/', heroAdminRoutes(db));
  app.route('/', artifactRoutes(db));
  app.route('/', stageRoutes(db, () => loadRules(db)));
  app.route('/', tagRoutes(db));
  app.route('/', battleRoutes(db));
  app.route('/', tournamentRoutes(db));
  app.route('/', roundDeploymentRoutes(db));
  app.route('/', seasonRoutes(db));
  app.route('/', defaultsRoutes(db));
  app.route('/', profileRoutes(db));
  app.route('/', statsSettingsRoutes(db));
  app.route('/', updateSettingRoutes(db));
  app.route('/', statsRoutes(db));
  app.route('/', scenarioRoutes(db, () => loadRules(db)));
  // one agent runs at a time, whether it answers a scenario or reads a picture
  const agentSlot = newAgentSlot();
  app.route('/', scenarioRunRoutes(db, options.agentRunner ?? spawnAgent, agentSlot));
  app.route('/', rosterImportRoutes(db, options.agentRunner ?? spawnAgent, () => loadRules(db), { imagesDir: options.imagesDir, workDir: options.importWorkDir, slot: agentSlot, concurrency: options.importConcurrency, maxQueuedBytes: options.importMaxBytes, persistQueue: options.importPersist }));
  app.route('/', reviewExplainRoutes(db, options.agentRunner ?? spawnAgent, agentSlot));
  app.route('/', importFeedbackRoutes(db, { imagesDir: options.imagesDir }));
  app.route('/', keptPictureRoutes(db, { imagesDir: options.imagesDir }));
  app.route('/', readerExampleRoutes(db, { imagesDir: options.imagesDir }));
  app.route('/', learnedRoutes(db, { imagesDir: options.imagesDir }));
  app.route('/', reviewThinningRoutes(db, { imagesDir: options.imagesDir }));
  app.route('/', thinningSettingsRoutes(db));
  app.route('/', reviewFindingsRoutes(db, { imagesDir: options.imagesDir }));
  app.route('/', cleanupRoutes(db));
  app.route('/', adminRoutes(db));
  app.route('/', agentSettingsRoutes(db, options.agentProbe ?? systemProbe));
  app.route('/', dreamHuntRoutes(db, () => loadRules(db)));
  // the Advisor is the only part of the app that estimates a chance; a build without it mounts nothing here
  advisor.mountAdvisorRoutes(app, db, () => loadRules(db));
  app.route('/', arenaRoutes(db, () => loadRules(db)));
  app.route('/', recordStateRoutes(db, () => loadRules(db)));

  serve(app, rosterContract.rules, () => loadRules(db) as Rules);

  /** The profile a roster request is about: the one named by `?profile=` (id or name), else the default. */
  const profileOf = (c: Context) => findProfile(db, c.req.query('profile'));

  serve(app, rosterContract.heroes, (_, c) => {
    const profile = profileOf(c);
    if (!profile) return fail(404, 'Unknown profile');
    const rows = db
      .prepare(
        `SELECT h.name, h.tier, h.class, h.faction, h.damage_type, h.image_path,
                r.hero_name IS NOT NULL AS owned, r.rank, r.equipment_level
         FROM hero h LEFT JOIN roster r ON r.hero_name = h.name AND r.profile_id = ?
         ORDER BY h.name`,
      )
      .all(profile.id) as HeroRow[];
    return rows.map((row) => ({
      name: row.name,
      tier: row.tier,
      class: row.class,
      faction: row.faction,
      damageType: row.damage_type,
      imagePath: row.image_path,
      owned: row.owned === 1,
      rank: row.rank,
      equipmentLevel: row.equipment_level,
    }));
  });

  serve(app, rosterContract.save, ({ params, body }, c) => {
    const profile = profileOf(c);
    if (!profile) return fail(404, 'Unknown profile');
    const name = params.name;
    if (!hasName(db, 'hero', name)) return fail(404, `Unknown hero "${name}"`);
    const requestedRank = body.rank ?? null;
    const equipmentLevel = body.equipmentLevel ?? null;
    // A hero added without a rank starts at the lowest rank its tier allows.
    const rules = loadRules(db);
    const tier = db.prepare('SELECT tier FROM hero WHERE name = ?').pluck().get(name) as string | null;
    const rank: string | null = requestedRank ?? minimumRank(tier, rules.ranks);
    const error = validateHeroState({ rank, equipmentLevel }, rules, tier);
    if (error) return fail(400, error);
    db.prepare(
      `INSERT INTO roster (profile_id, hero_name, rank, equipment_level) VALUES (?, ?, ?, ?)
       ON CONFLICT (profile_id, hero_name) DO UPDATE SET rank = excluded.rank, equipment_level = excluded.equipment_level`,
    ).run(profile.id, name, rank, equipmentLevel);
    return { name, owned: true as const, rank, equipmentLevel };
  });

  serve(app, rosterContract.remove, ({ params }, c) => {
    const profile = profileOf(c);
    if (!profile) return fail(404, 'Unknown profile');
    if (isStartingHero(db, params.name)) return fail(409, `${params.name} is a starting hero and stays on every roster`);
    db.prepare('DELETE FROM roster WHERE profile_id = ? AND hero_name = ?').run(profile.id, params.name);
  });

  // Wipes the roster of one profile (the default unless told otherwise) except its starting heroes; the UI asks for confirmation before calling this.
  serve(app, rosterContract.reset, (_, c) => {
    const profile = profileOf(c);
    if (!profile) return fail(404, 'Unknown profile');
    db.prepare('DELETE FROM roster WHERE profile_id = ? AND hero_name NOT IN (SELECT name FROM hero WHERE tier = ?)').run(profile.id, STARTING_TIER);
  });

  return app;
}
