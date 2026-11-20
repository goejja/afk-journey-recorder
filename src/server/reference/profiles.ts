import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { findProfile, listProfiles, setDefaultProfile } from '../../db/profiles.js';
import { ensureStartingHeroes } from '../../db/starting-heroes.js';
import { foldName } from '../../domain/name-match.js';
import { profilesContract, type Profile } from '../../shared/contracts/profiles.js';
import { fail, serve } from '../contract.js';
import { isStronger } from '../../domain/hero-state.js';

/** Routes for profiles: named rosters, one of which is the default. The heroes of a profile are edited through /api/roster. */
export function profileRoutes(db: Database.Database): Hono {
  const app = new Hono();

  const namesOf = (id: number) =>
    db.prepare('SELECT name FROM profile_name WHERE profile_id = ? ORDER BY name COLLATE NOCASE').pluck().all(id) as string[];
  const seenOwner = (folded: string) =>
    db.prepare('SELECT profile_id AS profileId, name FROM profile_name WHERE folded = ?').get(folded) as { profileId: number; name: string } | undefined;
  const list = (): Profile[] =>
    listProfiles(db).map((p) => ({ ...p, seenNames: namesOf(p.id) }));
  const nameTaken = (name: string, exceptId?: number) =>
    db.prepare('SELECT 1 FROM profile WHERE name = ? AND id IS NOT ?').get(name, exceptId ?? null) !== undefined;

  const playerIdTaken = (playerId: string, exceptId?: number) =>
    db.prepare('SELECT 1 FROM profile WHERE player_id = ? COLLATE NOCASE AND id IS NOT ?').get(playerId, exceptId ?? null) !== undefined;

  serve(app, profilesContract.list, () => list());

  serve(app, profilesContract.create, ({ body }) => {
    const name = { name: body.name };
    const playerId = { playerId: body.playerId };
    if (nameTaken(name.name)) return fail(409, `A profile named "${name.name}" exists already`);
    const shadow = seenOwner(foldName(name.name));
    if (shadow) return fail(409, `"${name.name}" is already a Seen name of the profile "${shadow.name}"`);
    if (playerId.playerId && playerIdTaken(playerId.playerId)) return fail(409, `Player ID ${playerId.playerId} belongs to another profile`);
    const source = body.copyFrom === undefined || body.copyFrom === null ? undefined : findProfile(db, body.copyFrom);
    if (body.copyFrom !== undefined && body.copyFrom !== null && !source) return fail(404, 'Unknown profile to copy from');
    const id = db.transaction(() => {
      const created = Number(db.prepare('INSERT INTO profile (name, player_id) VALUES (?, ?)').run(name.name, playerId.playerId).lastInsertRowid);
      if (source) db.prepare('INSERT INTO roster (profile_id, hero_name, rank, equipment_level) SELECT ?, hero_name, rank, equipment_level FROM roster WHERE profile_id = ?').run(created, source.id);
      ensureStartingHeroes(db, created); // a copy of a roster without them still starts with them
      return created;
    })();
    return list().find((p) => p.id === id)!;
  });

  serve(app, profilesContract.update, ({ params, body }) => {
    const profile = findProfile(db, Number(params.id));
    if (!profile) return fail(404, 'Unknown profile');
    const name = { name: body.name ?? profile.name };
    const playerId = { playerId: body.playerId === undefined ? profile.playerId : body.playerId };
    if (nameTaken(name.name, profile.id)) return fail(409, `A profile named "${name.name}" exists already`);
    if (name.name !== profile.name) {
      const shadow = seenOwner(foldName(name.name));
      if (shadow && shadow.profileId !== profile.id) return fail(409, `"${name.name}" is already a Seen name of the profile "${shadow.name}"`);
    }
    if (playerId.playerId && playerIdTaken(playerId.playerId, profile.id)) return fail(409, `Player ID ${playerId.playerId} belongs to another profile`);
    db.prepare('UPDATE profile SET name = ?, player_id = ? WHERE id = ?').run(name.name, playerId.playerId, profile.id);
    return list().find((p) => p.id === profile.id)!;
  });

  // The spellings a picture gave this Profile (ADR 0021): one folded spelling resolves to one Profile, so it is refused when another
  // Profile has it already.
  serve(app, profilesContract.addName, ({ params, body }) => {
    const profile = findProfile(db, Number(params.id));
    if (!profile) return fail(404, 'Unknown profile');
    const name = { name: body.name };
    const folded = foldName(name.name);
    const owner = seenOwner(folded);
    if (owner && owner.profileId !== profile.id) return fail(409, `"${name.name}" is already a Seen name of the profile "${owner.name}"`);
    const otherName = db.prepare('SELECT id FROM profile WHERE name = ? COLLATE NOCASE AND id IS NOT ?').get(name.name, profile.id);
    if (otherName) return fail(409, `"${name.name}" is another profile's name`);
    db.prepare('INSERT INTO profile_name (folded, profile_id, name) VALUES (?, ?, ?) ON CONFLICT (folded) DO UPDATE SET name = excluded.name, profile_id = excluded.profile_id').run(folded, profile.id, name.name);
    return namesOf(profile.id);
  });

  // Moves the default to this profile; there is always exactly one.
  serve(app, profilesContract.setDefault, ({ params }) => {
    const profile = findProfile(db, Number(params.id));
    if (!profile) return fail(404, 'Unknown profile');
    setDefaultProfile(db, profile.id);
    return list();
  });

  // Merges this profile into another (`into`: id or name): the heroes of both end up on the other profile, each at the stronger of its two
  // states (a higher rank, else more equipment), and this profile is deleted. The other keeps its name; it takes this profile's Player ID
  // when it has none, and the default when this one held it. Its Round Deployments move over; the older of two sets for one Round is dropped.
  serve(app, profilesContract.merge, ({ params, body }) => {
    const source = findProfile(db, Number(params.id));
    if (!source) return fail(404, 'Unknown profile');
    const target = body.into === undefined || body.into === null ? undefined : findProfile(db, body.into);
    if (!target) return fail(404, 'Unknown profile to merge into');
    if (target.id === source.id) return fail(400, 'Choose another profile to merge into');
    const ranks = db.prepare('SELECT name FROM rank ORDER BY position').pluck().all() as string[];
    const heroesOf = (id: number) => db.prepare('SELECT hero_name AS hero, rank, equipment_level AS equipmentLevel FROM roster WHERE profile_id = ?').all(id) as { hero: string; rank: string | null; equipmentLevel: number | null }[];
    db.transaction(() => {
      const mine = new Map(heroesOf(target.id).map((h) => [h.hero, h]));
      for (const hero of heroesOf(source.id)) {
        const there = mine.get(hero.hero);
        if (there && !isStronger(hero, there, ranks)) continue;
        db.prepare('INSERT INTO roster (profile_id, hero_name, rank, equipment_level) VALUES (?, ?, ?, ?) ON CONFLICT (profile_id, hero_name) DO UPDATE SET rank = excluded.rank, equipment_level = excluded.equipment_level').run(target.id, hero.hero, hero.rank, hero.equipmentLevel);
      }
      db.prepare('DELETE FROM roster WHERE profile_id = ?').run(source.id);
      // the Seen names go with the player, so a spelling resolved to the old Profile keeps resolving
      db.prepare('UPDATE profile_name SET profile_id = ? WHERE profile_id = ?').run(target.id, source.id);
      db.prepare('INSERT OR IGNORE INTO profile_name (folded, profile_id, name) VALUES (?, ?, ?)').run(foldName(source.name), target.id, source.name);
      // A Round Deployment is a whole set of teams (a hero is on one team only), so teams of the two profiles are never mixed: a Round only
      // this profile has moves over, and for a Round both have the set confirmed last wins whole (the other's, on a tie).
      const latest = db.prepare('SELECT max(updated_at) FROM round_deployment WHERE profile_id = ? AND tournament_id = ? AND round = ?').pluck();
      const rounds = db.prepare('SELECT tournament_id AS tournament, round, max(updated_at) AS at FROM round_deployment WHERE profile_id = ? GROUP BY tournament_id, round').all(source.id) as { tournament: number; round: string; at: string }[];
      for (const { tournament, round, at } of rounds) {
        const there = latest.get(target.id, tournament, round) as string | null;
        if (there !== null && there >= at) continue;
        db.prepare('DELETE FROM round_deployment WHERE profile_id = ? AND tournament_id = ? AND round = ?').run(target.id, tournament, round);
        db.prepare('UPDATE round_deployment SET profile_id = ? WHERE profile_id = ? AND tournament_id = ? AND round = ?').run(target.id, source.id, tournament, round);
      }
      db.prepare('DELETE FROM profile WHERE id = ?').run(source.id);
      // after the delete, so the Player ID and the default are free to move
      if (!target.playerId && source.playerId) db.prepare('UPDATE profile SET player_id = ? WHERE id = ?').run(source.playerId, target.id);
      if (source.isDefault) setDefaultProfile(db, target.id);
    })();
    return list();
  });

  // Removes a profile, its heroes and its Round Deployments. Saved records keep their own copy of every hero's state, so they are untouched.
  serve(app, profilesContract.remove, ({ params }) => {
    const profile = findProfile(db, Number(params.id));
    if (!profile) return fail(404, 'Unknown profile');
    if (profile.isDefault) return fail(409, 'The default profile cannot be deleted: make another profile the default first');
    db.transaction(() => {
      db.prepare('DELETE FROM roster WHERE profile_id = ?').run(profile.id);
      db.prepare('DELETE FROM profile WHERE id = ?').run(profile.id);
    })();
  });

  return app;
}
