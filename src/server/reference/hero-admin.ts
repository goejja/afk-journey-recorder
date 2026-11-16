import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { loadUnitRules } from '../../db/unit-rules.js';
import { missingHeroInfo, type HeroBody } from '../../domain/hero-admin.js';
import { tierVsRecords } from '../../advisor/index.js';
import type { TierCheck } from '../../shared/api.js';
import { heroesContract, type HeroAdmin, type PlacementRule } from '../../shared/contracts/heroes.js';
import { fail, serve } from '../contract.js';
import { deploymentsNaming, takenNames, unitNameProblem } from './unit-names.js';

interface HeroRow {
  name: string;
  tier: 'R' | 'A' | 'S' | null;
  class: HeroAdmin['class'];
  faction: HeroAdmin['faction'];
  damage_type: 'Physical' | 'Magic' | null;
  source: 'import' | 'manual';
  pvp_tier: 'S+' | 'S' | 'A+' | 'A' | 'B' | 'C' | 'D' | null;
  pvp_role: 'Damage dealer' | 'Specialist' | 'Support' | 'Tank' | null;
  pvp_set_on: string | null;
  pvp_source: 'prydwen' | 'manual' | null;
  attr_range: number | null;
  attr_energy: string | null;
  attr_mechanics: string | null;
  attr_season: number | null;
  attr_set_on: string | null;
  attr_source: 'external' | 'manual' | null;
}

const SELECT_HERO = `SELECT h.name, h.tier, h.class, h.faction, h.damage_type, h.source, p.pvp_tier, p.pvp_role, p.set_on AS pvp_set_on, p.source AS pvp_source,
                             a.range AS attr_range, a.energy AS attr_energy, a.mechanics AS attr_mechanics, a.released_season AS attr_season, a.set_on AS attr_set_on, a.source AS attr_source
                      FROM hero h LEFT JOIN hero_pvp_hint p ON p.hero = h.name LEFT JOIN hero_attribute a ON a.hero = h.name`;

/** Routes of Admin > Units > Heroes: the standard heroes' information and the units they bring. Images are the Images tab's. */
export function heroAdminRoutes(db: Database.Database): Hono {
  const app = new Hono();
  const find = (name: string) => db.prepare(`${SELECT_HERO} WHERE h.name = ?`).get(name) as HeroRow | undefined;
  const pairOf = (name: string) => {
    const row = db.prepare('SELECT part1, part2 FROM hero_pair WHERE hero = ?').get(name) as { part1: string; part2: string } | undefined;
    return row ?? null;
  };
  const summonOf = (name: string) => (db.prepare('SELECT part, count FROM hero_summon WHERE hero = ?').get(name) as { part: string; count: number } | undefined) ?? null;
  const toJson = (row: HeroRow): HeroAdmin => ({
    name: row.name,
    tier: row.tier,
    class: row.class,
    faction: row.faction,
    damageType: row.damage_type,
    source: row.source,
    pvpTier: row.pvp_tier,
    pvpRole: row.pvp_role,
    pvpSetOn: row.pvp_set_on,
    pvpSource: row.pvp_source,
    attributes:
      row.attr_set_on === null
        ? null
        : {
            range: row.attr_range,
            energy: JSON.parse(row.attr_energy ?? '[]'),
            mechanics: JSON.parse(row.attr_mechanics ?? '[]'),
            releasedInSeason: row.attr_season,
            setOn: row.attr_set_on,
            source: row.attr_source!,
          },
    pair: pairOf(row.name),
    summon: summonOf(row.name),
  });

  /** What uses a hero: what puts it on a board (and so fixes how it stands), and what only refers to it. */
  function usage(name: string) {
    // every `?` is the hero's name
    const count = (sql: string) => db.prepare(sql).pluck().get(...Array.from({ length: sql.split('?').length - 1 }, () => name)) as number;
    const records = count(
      `SELECT count(*) FROM (SELECT f.attempt_id FROM formation_hero fh JOIN formation f ON f.id = fh.formation_id WHERE fh.hero_name = ?
                             UNION SELECT attempt_id FROM arena_opponent_hero WHERE hero_name = ?)`,
    );
    const scenarios = count('SELECT count(DISTINCT scenario_id) FROM scenario_hero WHERE hero_name = ?');
    const deployments = deploymentsNaming(db, name);
    return {
      records,
      scenarios,
      deployments,
      assists: count('SELECT (SELECT count(*) FROM formation WHERE assist_hero = ?) + (SELECT count(*) FROM arena_attempt WHERE opp_assist_hero = ?)'),
      roster: count('SELECT count(*) FROM roster WHERE hero_name = ?'),
      stageEnemies: count('SELECT count(*) FROM stage_enemy WHERE hero_name = ?'),
      pictures: count('SELECT (SELECT count(*) FROM hero_look WHERE hero_name = ?) + (SELECT count(*) FROM hero_example WHERE hero_name = ?)'),
    };
  }
  const onBoard = (u: ReturnType<typeof usage>) => u.records + u.scenarios + u.deployments;
  const describe = (u: ReturnType<typeof usage>) =>
    [
      [u.roster, 'roster entries'],
      [u.records, 'records'],
      [u.assists, 'records as assist hero'],
      [u.scenarios, 'scenarios'],
      [u.deployments, 'Formation IDs and Round Deployments'],
      [u.stageEnemies, 'stages'],
      [u.pictures, 'reader pictures'],
    ]
      .filter(([n]) => (n as number) > 0)
      .map(([n, what]) => `${n} ${what}`)
      .join(', ');

  /** The problem with the units a hero declares, or null. `except` is the hero whose own declaration is being replaced. */
  function declarationProblem(hero: HeroBody): string | null {
    const taken = takenNames(db, { hero: hero.name });
    const names = hero.pair ? [hero.pair.part1, hero.pair.part2] : hero.summon ? [hero.summon.part] : [];
    for (const name of names) {
      const problem = unitNameProblem(taken, name);
      if (problem) return problem;
    }
    return null;
  }

  function writeDeclaration(hero: HeroBody) {
    db.prepare('DELETE FROM hero_pair WHERE hero = ?').run(hero.name);
    db.prepare('DELETE FROM hero_summon WHERE hero = ?').run(hero.name);
    if (hero.pair) db.prepare('INSERT INTO hero_pair (hero, part1, part2) VALUES (?, ?, ?)').run(hero.name, hero.pair.part1, hero.pair.part2);
    if (hero.summon) db.prepare('INSERT INTO hero_summon (hero, part, count) VALUES (?, ?, ?)').run(hero.name, hero.summon.part, hero.summon.count);
  }

  serve(app, heroesContract.list, () => (db.prepare(`${SELECT_HERO} ORDER BY h.name`).all() as HeroRow[]).map(toJson));

  serve(app, heroesContract.usage, ({ params }) => {
    if (!find(params.name)) return fail(404, 'Unknown hero');
    const u = usage(params.name);
    return { ...u, onBoard: onBoard(u) };
  });

  serve(app, heroesContract.create, ({ body: hero }) => {
    const incomplete = missingHeroInfo(hero);
    if (incomplete) return fail(400, incomplete);
    const taken = takenNames(db);
    const key = hero.name.toLowerCase();
    if (taken.heroes.has(key)) return fail(409, `A hero named "${hero.name}" already exists`);
    if (taken.parts.has(key)) return fail(409, `"${hero.name}" is already the name of another unit`);
    const problem = declarationProblem(hero);
    if (problem) return fail(409, problem);
    db.transaction(() => {
      db.prepare("INSERT INTO hero (name, tier, class, faction, damage_type, image_path, source) VALUES (?, ?, ?, ?, ?, NULL, 'manual')").run(hero.name, hero.tier, hero.class, hero.faction, hero.damageType);
      writeDeclaration(hero);
    })();
    loadUnitRules(db);
    return toJson(find(hero.name)!);
  });

  serve(app, heroesContract.save, ({ params, body }) => {
    const current = find(params.name);
    if (!current) return fail(404, 'Unknown hero');
    const hero = { ...body, name: current.name }; // a hero is never renamed: records, rosters and scenarios name it
    // A row that lacks a value may keep lacking it; a value it has cannot be taken away.
    for (const [label, before, after] of [
      ['tier', current.tier, hero.tier],
      ['class', current.class, hero.class],
      ['faction', current.faction, hero.faction],
      ['damage type', current.damage_type, hero.damageType],
    ] as const) {
      if (before !== null && after === null) return fail(400, `${current.name} has a ${label}; choose one`);
    }
    const declaration = (pair: { part1: string; part2: string } | null, summon: { part: string; count: number } | null) => JSON.stringify([pair, summon]);
    const declarationChanged = declaration(pairOf(current.name), summonOf(current.name)) !== declaration(hero.pair, hero.summon);
    if (declarationChanged) {
      const u = usage(current.name);
      if (onBoard(u) > 0) {
        return fail(409, `${current.name} is on a board in ${describe({ ...u, roster: 0, assists: 0, stageEnemies: 0, pictures: 0 })}, so the units it brings cannot change`);
      }
      const problem = declarationProblem(hero);
      if (problem) return fail(409, problem);
    }
    const infoChanged = hero.tier !== current.tier || hero.class !== current.class || hero.faction !== current.faction || hero.damageType !== current.damage_type;
    if (!infoChanged && !declarationChanged) return toJson(current);
    // Any edit makes it the player's own, so a re-import never overwrites it.
    db.transaction(() => {
      db.prepare("UPDATE hero SET tier = ?, class = ?, faction = ?, damage_type = ?, source = 'manual' WHERE name = ?").run(hero.tier, hero.class, hero.faction, hero.damageType, current.name);
      if (declarationChanged) writeDeclaration(hero);
    })();
    loadUnitRules(db);
    return toJson(find(current.name)!);
  });

  // The Tier hint is the player's opinion, not the game's information: saving it leaves the hero as imported.
  serve(app, heroesContract.savePvpHint, ({ params, body }) => {
    const current = find(params.name);
    if (!current) return fail(404, 'Unknown hero');
    const { pvpTier, pvpRole } = body;
    if (pvpTier === null && pvpRole === null) {
      db.prepare('DELETE FROM hero_pvp_hint WHERE hero = ?').run(current.name);
    } else if (pvpTier !== current.pvp_tier || pvpRole !== current.pvp_role) {
      db.prepare(
        `INSERT INTO hero_pvp_hint (hero, pvp_tier, pvp_role, set_on, source) VALUES (?, ?, ?, date('now', 'localtime'), 'manual')
         ON CONFLICT (hero) DO UPDATE SET pvp_tier = excluded.pvp_tier, pvp_role = excluded.pvp_role, set_on = excluded.set_on, source = 'manual'`,
      ).run(current.name, pvpTier, pvpRole);
    }
    return toJson(find(current.name)!);
  });

  // Range, energy and mechanic tags are information about the hero, kept apart from `hero` so that saving them leaves the hero as imported.
  // Saving makes the values the player's own (`manual`); a row with nothing in it is removed.
  serve(app, heroesContract.saveAttributes, ({ params, body }) => {
    const current = find(params.name);
    if (!current) return fail(404, 'Unknown hero');
    const mechanics = [...new Set(body.mechanics.map((tag) => tag.toLowerCase()))].sort();
    if (body.range === null && body.energy.length === 0 && mechanics.length === 0 && body.releasedInSeason === null) {
      db.prepare('DELETE FROM hero_attribute WHERE hero = ?').run(current.name);
    } else {
      const same = current.attr_set_on !== null && current.attr_range === body.range && current.attr_energy === JSON.stringify(body.energy) && current.attr_mechanics === JSON.stringify(mechanics) && current.attr_season === body.releasedInSeason;
      if (!same) {
        db.prepare(
          `INSERT INTO hero_attribute (hero, range, energy, mechanics, released_season, set_on, source) VALUES (?, ?, ?, ?, ?, date('now', 'localtime'), 'manual')
           ON CONFLICT (hero) DO UPDATE SET range = excluded.range, energy = excluded.energy, mechanics = excluded.mechanics, released_season = excluded.released_season, set_on = excluded.set_on, source = 'manual'`,
        ).run(current.name, body.range, JSON.stringify(body.energy), JSON.stringify(mechanics), body.releasedInSeason);
      }
    }
    return toJson(find(current.name)!);
  });

  // Placement Rules (ADR 0036). Deleting a hero deletes its rules.
  interface RuleRow { id: number; hero: string; relation: PlacementRule['relation']; effect: PlacementRule['effect']; wants_role: PlacementRule['wantsRole']; note: string; source: PlacementRule['source']; enabled: number }
  const ruleJson = (r: RuleRow): PlacementRule => ({ id: r.id, hero: r.hero, relation: r.relation, effect: r.effect, wantsRole: r.wants_role, note: r.note, source: r.source, enabled: r.enabled === 1 });
  const findRule = (id: number) => db.prepare('SELECT id, hero, relation, effect, wants_role, note, source, enabled FROM placement_rule WHERE id = ?').get(id) as RuleRow | undefined;

  // The default profile's own records against each Prydwen tier hint (ADR 0036): a pointer, never a change to the tier.
  serve(app, heroesContract.tierCheck, () => tierVsRecords(db) as TierCheck[]);
  serve(app, heroesContract.placementRules, () => (db.prepare('SELECT id, hero, relation, effect, wants_role, note, source, enabled FROM placement_rule ORDER BY hero, id').all() as RuleRow[]).map(ruleJson));

  serve(app, heroesContract.createPlacementRule, ({ params, body: rule }) => {
    const hero = find(params.name);
    if (!hero) return fail(404, 'Unknown hero');
    if (db.prepare('SELECT 1 FROM placement_rule WHERE hero = ? AND relation = ?').get(hero.name, rule.relation)) {
      return fail(409, `${hero.name} already has a rule for ${rule.relation}; change that one`);
    }
    const id = db
      .prepare("INSERT INTO placement_rule (hero, relation, effect, wants_role, note, source, enabled) VALUES (?, ?, ?, ?, ?, 'manual', ?)")
      .run(hero.name, rule.relation, rule.effect, rule.wantsRole, rule.note, rule.enabled ? 1 : 0).lastInsertRowid as number;
    return ruleJson(findRule(id)!);
  });

  serve(app, heroesContract.savePlacementRule, ({ params, body: rule }) => {
    const current = findRule(Number(params.id));
    if (!current) return fail(404, 'Unknown rule');
    if (rule.relation !== current.relation && db.prepare('SELECT 1 FROM placement_rule WHERE hero = ? AND relation = ? AND id <> ?').get(current.hero, rule.relation, current.id)) {
      return fail(409, `${current.hero} already has a rule for ${rule.relation}`);
    }
    // Switching a rule on or off keeps its source; changing what it says makes it the player's own.
    const said = rule.relation !== current.relation || rule.effect !== current.effect || rule.wantsRole !== current.wants_role || rule.note !== current.note;
    db.prepare('UPDATE placement_rule SET relation = ?, effect = ?, wants_role = ?, note = ?, source = ?, enabled = ? WHERE id = ?').run(
      rule.relation, rule.effect, rule.wantsRole, rule.note, said ? 'manual' : current.source, rule.enabled ? 1 : 0, current.id,
    );
    return ruleJson(findRule(current.id)!);
  });

  serve(app, heroesContract.removePlacementRule, ({ params }) => {
    const id = Number(params.id);
    if (!findRule(id)) return fail(404, 'Unknown rule');
    db.prepare('DELETE FROM placement_rule WHERE id = ?').run(id);
  });

  serve(app, heroesContract.remove, ({ params }) => {
    const name = params.name;
    if (!find(name)) return fail(404, 'Unknown hero');
    const used = describe(usage(name));
    if (used) return fail(409, `${name} is used by ${used}, so it cannot be deleted`);
    db.transaction(() => {
      db.prepare('DELETE FROM hero_pair WHERE hero = ?').run(name);
      db.prepare('DELETE FROM hero_summon WHERE hero = ?').run(name);
      db.prepare('DELETE FROM hero_pvp_hint WHERE hero = ?').run(name);
      db.prepare('DELETE FROM hero_attribute WHERE hero = ?').run(name);
      db.prepare('DELETE FROM placement_rule WHERE hero = ?').run(name);
      db.prepare('DELETE FROM hero WHERE name = ?').run(name);
    })();
    loadUnitRules(db);
  });

  return app;
}
