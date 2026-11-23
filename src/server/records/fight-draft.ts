import type Database from 'better-sqlite3';
import type { ArenaMode } from '../../domain/arena.js';
import { allowedEquipmentLevels, type HeroStateRules } from '../../domain/hero-state.js';
import { matchProfile, matchSeenName, type SeenName } from '../../domain/name-match.js';
import type { ImportPlayer, ParsedFight, TileReading } from '../../domain/roster-import.js';
import type { FightDraft, FightDraftSide, DraftHero } from '../../shared/api.js';

/** The rank of a tile when the picture is sure of it: the rank reader's, else the Agent's when it said it was sure. */
function sureRank(tile: TileReading): string | null {
  if (tile.rankRead?.confident) return tile.rankRead.rank;
  return tile.rank !== null && tile.rankConfident ? tile.rank : null;
}

function sideOf(db: Database.Database, player: ImportPlayer | undefined, rules: HeroStateRules): FightDraftSide {
  const profiles = db.prepare('SELECT id, name, player_id AS playerId FROM profile').all() as { id: number; name: string; playerId: string | null }[];
  // A spelling resolved to a Profile before wins (ADR 0021): a name matched once, or corrected once, is not asked again.
  const seen = db.prepare('SELECT folded, profile_id AS profileId FROM profile_name').all() as SeenName[];
  const seenId = player?.name ? matchSeenName(player.name, seen) : null;
  const match = player?.name && seenId === null ? matchProfile(player.name, profiles) : null;
  const heroes: DraftHero[] = [];
  for (const tile of player?.tiles ?? []) {
    if (tile.hero === null) continue;
    const rank = sureRank(tile);
    // an equipment level only where the stars were read and the rank allows it
    const read = tile.stars?.state === 'present' ? tile.stars.level : null;
    const equipmentLevel = rank !== null && read !== null && allowedEquipmentLevels(rank, rules).includes(read) ? read : null;
    heroes.push({ tile: tile.key, hero: tile.hero, rank, equipmentLevel, ...(tile.confident === false ? { unsure: true, candidates: tile.candidates } : {}) });
  }
  const profile = seenId !== null ? (profiles.find((p) => p.id === seenId) ?? null) : match ? (profiles.find((p) => p.id === match.profile.id) ?? null) : null;
  const unreadTiles = (player?.tiles ?? []).filter((t) => t.hero === null && !t.blank && !t.notOwned);
  const unread = unreadTiles.map((t) => t.key);
  const guesses = unreadTiles.filter((t) => t.candidates.length > 0);
  return { name: player?.name ?? null, profile, heroes, artifact: player?.artifact ?? null, phantimal: player?.phantimal ?? null, crops: player?.crops ?? null, unread, ...(guesses.length > 0 ? { unreadCandidates: Object.fromEntries(guesses.map((t) => [t.key, t.candidates])) } : {}) };
}

/** A saved fight with the same two sets of heroes in this mode (and the same result, when the picture gave one). */
function duplicateOf(db: Database.Database, mode: ArenaMode, a: string[], b: string[], outcome: 'Win' | 'Loss' | null) {
  const rows = db
    .prepare(
      `SELECT h.attempt_id AS id, h.side, h.hero, t.outcome, t.created_at AS createdAt
       FROM v_side_hero h JOIN attempt t ON t.id = h.attempt_id
       WHERE h.attempt_id IN (SELECT attempt_id FROM arena_attempt WHERE mode = ?)`,
    )
    .all(mode) as { id: number; side: string; hero: string; outcome: string; createdAt: string }[];
  const fights = new Map<number, { A: Set<string>; B: Set<string>; outcome: string; createdAt: string }>();
  for (const r of rows) {
    const fight = fights.get(r.id) ?? { A: new Set(), B: new Set(), outcome: r.outcome, createdAt: r.createdAt };
    (r.side === 'A' ? fight.A : fight.B).add(r.hero);
    fights.set(r.id, fight);
  }
  const same = (x: Set<string>, y: string[]) => x.size === y.length && y.every((h) => x.has(h));
  for (const [id, fight] of [...fights].sort((x, y) => y[0] - x[0])) {
    if (same(fight.A, a) && same(fight.B, b) && (outcome === null || fight.outcome === outcome)) return { id, createdAt: fight.createdAt };
  }
  return null;
}

export function draftOf(db: Database.Database, rules: HeroStateRules, mode: ArenaMode, players: ImportPlayer[], fight: ParsedFight | null): FightDraft {
  const sideA = sideOf(db, players[0], rules);
  const sideB = sideOf(db, players[1], rules);
  const outcome = fight?.allyWon == null ? null : fight.allyWon ? 'Win' : 'Loss';
  return {
    mode,
    number: fight?.number ?? null,
    outcome,
    unionLevelA: mode === 'Guild Duel' ? (fight?.unionLevelAlly ?? null) : null,
    unionLevelB: mode === 'Guild Duel' ? (fight?.unionLevelEnemy ?? null) : null,
    sideA,
    sideB,
    duplicateOf: duplicateOf(db, mode, sideA.heroes.map((h) => h.hero), sideB.heroes.map((h) => h.hero), outcome),
  };
}
