import { DEFAULT_MODES } from '../../src/domain/defaults.js';
import { FIXED_MAP, TEAMS_PER_MODE } from '../../src/domain/arena.js';
import { api, type ArenaFight, type ArenaMode, type FightDraftSide, type Artifact, type DefaultMode, type BossRule, type GameMap, type Hero, type Phantimal, type Profile, type RoundDeploymentEntry, type Rules, type WeeklySetups } from '../backend.js';
import { emptyFormation, formationFromRecord, toPayload, type FormationState } from '../FormationEditor.js';
import { keepOnMap } from '../relocate.js';
import { emptyOpponent, opponentFromRecord, toOpponentPayload, type OpponentState } from './OpponentEditor.js';
import { type ImportRound } from '../reader/BattleImport.js';
import { reusableIn } from '../../src/domain/tournament.js';
import type { SavedPlacement } from '../../src/domain/placement-reuse.js';
import { isSummon } from '../../src/domain/units.js';
import { matchTeam, turnTeam, withPlacement, withSeenAs, type ReadSide, type RoundTeam } from '../../src/domain/round-deployment.js';
import { describe as describeChange } from './RoundDeploymentBar.js';
import { applyToOpponent, applyToOwn, deploymentsFromRecords, guessOf, mergeDeployments, pruneGuess, readSideOf, standsOn, teamOfOpponent, teamOfOwn, type GuessTiles } from './round-deployment.js';
import { TILE } from '../../src/domain/map.js';
import { correctHeroes, knownTeams, misfitsMap, placeOpponent, placeOwn, readingOf, reusedSide, savedPlacements, savedSides, unplacedUnit, type ImportedTeam, type ImportGroup, type KnownTeam, type SavedSide } from '../reader/battle-import.js';
import { derivePhantimal } from '../phantimal.js';
import { swapSides } from './swap-sides.js';

export interface Reference {
  defaults: WeeklySetups;
  maps: GameMap[];
  heroes: Hero[];
  artifacts: Artifact[];
  rules: BossRule[];
  heroRules: Rules;
  phantimals: Phantimal[];
  profiles: Profile[];
}

/** How a part of the page's reference is changed: what changes, or a function of the reference as it is when the change is applied (so two quick changes cannot overwrite each other). */
export type PatchReference = (change: Partial<Reference> | ((old: Reference) => Partial<Reference>)) => void;

/** One team's battle while it is being set up, before it is saved as a record. */
export interface Draft {
  mapName: string;
  rule: string;
  outcome: 'Win' | 'Loss';
  note: string;
  tags: string[];
  /** The Player behind each side, by Player ID: the one of the Profile the side was given. */
  playerIdA: string | null;
  playerIdB: string | null;
  /** Guild Duel only: the Union Level of each side as typed, empty when unknown. */
  unionLevel: string;
  opponentUnionLevel: string;
  formation: FormationState;
  opponent: OpponentState;
  /** Set when the team was read from a picture: what was read, kept until the records are saved and the reading is measured against them. */
  imported?: ImportedTeam;
  /** What the picture said of each side, as read and as corrected from other records, to remember with a Round Deployment confirmed from it. */
  seen?: Record<'A' | 'B', ReadSide[]>;
  /** Where the form put each side by itself, on the map it did it on: such tiles are never stored in a Round Deployment (ADR 0021). */
  guess?: Record<'A' | 'B', GuessTiles | undefined>;
}

/** The tiles the form placed by itself, because a picture shows none: a guess, not a placement. */

/** The teams of a draft on another map: where they stand is kept as far as the new map allows (see keepOnMap). */
export const onMap = (reference: Reference, mapName: string, draft: Draft) => {
  const map = reference.maps.find((m) => m.name === mapName);
  return map ? keepOnMap(map.cells, draft.formation, draft.opponent) : { formation: draft.formation, opponent: draft.opponent };
};

/** The draft with its sides exchanged and the units put back on the tiles its map allows (the turned tiles may not all be deployment tiles). */
export const swappedOnMap = (reference: Reference, draft: Draft): Draft => {
  const swapped = swapSides(draft);
  return { ...swapped, ...onMap(reference, swapped.mapName, swapped) };
};

export const newDraft = (reference: Reference): Draft => ({
  mapName: reference.maps.find((m) => m.tags.includes('Arena'))?.name ?? '',
  rule: '',
  outcome: 'Win',
  note: '',
  tags: [],
  playerIdA: null,
  playerIdB: null,
  unionLevel: '',
  opponentUnionLevel: '',
  formation: emptyFormation(),
  opponent: emptyOpponent(),
});

/** The modes with a weekly default (Admin > Weekly default); Arena and Treasure Rush, one team on a map of their own, have none. */
export const weekly = (mode: ArenaMode): DefaultMode | null => ((DEFAULT_MODES as readonly string[]).includes(mode) ? (mode as DefaultMode) : null);

/** A team nobody has set up yet starts with the week's map and rule of its slot, when the map still exists. A mode fought on one map is always on it; the modes of one team have no weekly default. */
export function withDefault(reference: Reference, mode: ArenaMode, draft: Draft, index: number): Draft {
  const fixed = FIXED_MAP[mode];
  if (fixed !== undefined) return draft.mapName === fixed ? draft : { ...draft, mapName: fixed, ...onMap(reference, fixed, draft) };
  const weeklyMode = weekly(mode);
  const slot = weeklyMode === null ? undefined : reference.defaults[weeklyMode].slots[index];
  if (!slot || draft.formation.placed.length > 0) return draft;
  const mapName = slot.mapName && reference.maps.some((m) => m.name === slot.mapName && m.tags.includes('Arena')) ? slot.mapName : draft.mapName;
  const rule = mode === 'Supreme Arena' && slot.rule && reference.rules.some((r) => r.name === slot.rule) ? slot.rule : draft.rule;
  return { ...draft, mapName, rule };
}

export const draftFromFight = (b: ArenaFight): Draft => ({
  mapName: b.mapName,
  rule: b.rule ?? '',
  outcome: b.outcome,
  note: b.note ?? '',
  tags: b.tags,
  playerIdA: b.playerIdA,
  playerIdB: b.playerIdB,
  unionLevel: b.unionLevel == null ? '' : String(b.unionLevel),
  opponentUnionLevel: b.opponentUnionLevel == null ? '' : String(b.opponentUnionLevel),
  formation: formationFromRecord(b.formation),
  opponent: opponentFromRecord(b.opponent),
});

/** The tags every team of one battle shares. */
/** What every team of a battle shares: its tags, and in Guild Duel the Union Level of each side. */
export const sharedTags = (d: Draft | undefined) => ({ tags: d?.tags ?? [], playerIdA: d?.playerIdA ?? null, playerIdB: d?.playerIdB ?? null, unionLevel: d?.unionLevel ?? '', opponentUnionLevel: d?.opponentUnionLevel ?? '' });

export const toInput = (mode: ArenaMode, d: Draft) => ({
  mode,
  mapName: d.mapName,
  rule: mode === 'Supreme Arena' ? d.rule || null : null,
  unionLevel: mode === 'Guild Duel' && d.unionLevel !== '' ? Number(d.unionLevel) : null,
  opponentUnionLevel: mode === 'Guild Duel' && d.opponentUnionLevel !== '' ? Number(d.opponentUnionLevel) : null,
  outcome: d.outcome,
  note: d.note,
  tags: d.tags,
  playerIdA: d.playerIdA,
  playerIdB: d.playerIdB,
  formation: toPayload(d.formation),
  opponent: toOpponentPayload(d.opponent),
});

/** Teams to start a new battle from: a saved fight or battle, with everything but the result and the note. */
export interface Clone {
  mode: ArenaMode;
  /** The saved fights `drafts` were made from, so that a battle being edited does not offer its own layout back. */
  attemptIds?: number[];
  drafts: Draft[];
  /** The Formation ID of each side for the teams of a whole battle, as typed. */
  formationIds: { a: string; b: string };
  /** The profile each side starts with, when it is not found from a Player ID (a Battle import gives the one matched by name). */
  profiles?: Record<Side, number | null>;
  /** The names the pictures gave each side, to offer for a new profile. */
  names?: Record<Side, string | null>;
  /** What the player should know when the form opens: a known formation whose saved placement does not fit the map. */
  notes?: string[];
  /** The Tournament and Round of a Super League battle read from pictures, saved with it (ADR 0020). */
  round?: ImportRound | null;
  /** The Round Deployments of that Round when the form opened. */
  deployments?: RoundDeploymentEntry[];
  /** Why a Super League battle of a Round cannot be saved without a look (the batch table of the import): empty when it can. */
  problems?: string[];
  /** What was taken from a Round Deployment although the picture read otherwise: shown in the batch table, not a reason to look. */
  reused?: string[];
  /** Teams a picture shows differently from the Round Deployment, which the player can confirm as a Team change (ADR 0021). */
  teamChanges?: { side: Side; slot: number; profileId: number; team: RoundTeam; who: string }[];
}

/**
 * Saved fights as the form's teams, each in its own team slot, with the same units, ranks, equipment, artifacts and tags.
 * A clone starts without the result and note; `keepResult` keeps them, to edit the battle as it is.
 */
export function cloneOf(reference: Reference, fights: ArenaFight[], keepResult = false, side?: Side): Clone {
  const mode = fights[0]!.mode;
  const tags = sharedTags(draftFromFight(fights[0]!));
  const blank = newDraft(reference);
  // Only one side: the other starts empty, without its Player and Union Level.
  const onlySide = (d: Draft): Draft =>
    side === 'A' ? { ...d, opponent: blank.opponent, playerIdB: null, opponentUnionLevel: '' } : side === 'B' ? { ...d, formation: blank.formation, playerIdA: null, unionLevel: '' } : d;
  return {
    mode,
    attemptIds: fights.map((f) => f.id),
    formationIds: { a: side === 'B' ? '' : fights[0]!.battleFormationId ?? '', b: side === 'A' ? '' : fights[0]!.battleOpponentFormationId ?? '' },
    drafts: Array.from({ length: TEAMS_PER_MODE[mode] }, (_, i) => {
      const fight = fights.find((f) => (f.battlePosition ?? 1) - 1 === i);
      if (!fight) return onlySide({ ...blank, ...tags });
      return onlySide(keepResult ? { ...draftFromFight(fight), ...tags } : { ...draftFromFight(fight), ...tags, outcome: 'Win' as const, note: '' });
    }),
  };
}

/** A read that fails says what it was reading: an empty answer is "none", so a failure must never be turned into one. */
async function reading<T>(what: string, read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (e) {
    throw new Error(`${what} could not be read: ${(e as Error).message}`);
  }
}

/** The saved fights of a mode (Super League, whose Round is picked where it matters): a Player with none in the Round falls back to these (ADR 0021). */
export const savedOfMode = (mode: ArenaMode = 'Super League'): Promise<ArenaFight[]> => reading(`The saved ${mode} battles`, api.savedFights(mode));

/** The rosters of the Profiles the pictures name, by Profile id: the ranks and equipment a picture could not read come from them (ADR 0021). */
export async function rostersOf(groups: ImportGroup[]): Promise<Map<number, Hero[]>> {
  const profiles = new Map<number, string>();
  for (const group of groups)
    for (const picture of group.pictures)
      for (const side of [picture.draft.sideA, picture.draft.sideB]) if (side.profile) profiles.set(side.profile.id, side.profile.name);
  const rosters = new Map<number, Hero[]>();
  await Promise.all([...profiles].map(async ([id, name]) => rosters.set(id, await reading(`The roster of ${name}`, api.heroes(id)))));
  return rosters;
}

/** The two Players of a group of pictures, in order of Player ID, or null when a side has no Player ID. */
export function pairOf(group: ImportGroup): string | null {
  const first = group.pictures[0]?.draft;
  const ids = [first?.sideA.profile?.playerId, first?.sideB.profile?.playerId].map((id) => id?.toLowerCase());
  return ids[0] && ids[1] ? [...ids].sort().join('|') : null;
}

/**
 * The Round Deployments of a Round: the ones the player confirmed, with the teams the saved Battles of the same Tournament and Round
 * already show for the rest (a Player seen on Side A there and on Side B now has the same Deployment, turned over; ADR 0020).
 */
export async function loadRoundDeployments(round: ImportRound, profiles: Profile[], fights?: ArenaFight[]): Promise<RoundDeploymentEntry[]> {
  const [confirmed, saved] = await Promise.all([
    reading('The Round Deployments', api.roundDeployments(round.tournamentId, round.round)),
    fights ?? reading('The saved Battles of this Round', api.arenaFights({ mode: ['Super League'], tournament: String(round.tournamentId), round: round.round, limit: '1000' })),
  ]);
  return mergeDeployments(confirmed, deploymentsFromRecords(reusableIn(saved, round), profiles));
}

/**
 * After a Battle is saved from the batch: the tiles its teams were placed on go to the confirmed Round Deployment teams that have none
 * yet (ADR 0021). A team that already knows its tiles, and one only a saved Battle shows, is left as it is.
 */
export async function fillSavedDeploymentTiles(round: ImportRound, drafts: Draft[], profiles: Record<Side, number | null>, deployments: RoundDeploymentEntry[]): Promise<void> {
  for (const side of ['A', 'B'] as const) {
    const profileId = profiles[side];
    if (profileId === null) continue;
    const entry = deployments.find((e) => e.profileId === profileId && e.confirmed);
    if (!entry) continue;
    let changed = false;
    const teams = entry.teams.map((deployed, slot) => {
      if (!deployed || entry.recorded?.includes(slot)) return deployed;
      const made = side === 'A' ? teamOfOwn(drafts[slot]!.formation) : teamOfOpponent(drafts[slot]!.opponent);
      const saved = made && side === 'B' ? turnTeam(made) : made;
      const next = saved ? withPlacement(deployed, saved, drafts[slot]!.mapName) : null;
      if (next && JSON.stringify(next) !== JSON.stringify(deployed)) {
        changed = true;
        return next;
      }
      return deployed;
    });
    if (changed) {
      await api.saveRoundDeployment(round.tournamentId, round.round, profileId, teams);
      entry.teams = teams;
    }
  }
}

/**
 * The teams of one battle read from pictures of its fights (a Battle import): each in the slot of its fight number, on the week's map of
 * that slot, with the heroes on the first free tiles. The result, the players and the Union Levels come from the pictures when they gave them.
 */
export function cloneFromImport(reference: Reference, group: ImportGroup, everySaved: ArenaFight[] = [], reuse = true, others: ImportGroup[] = [], round: ImportRound | null = null, deployments: RoundDeploymentEntry[] = [], rosters: Map<number, Hero[]> = new Map()): Clone {
  const mode = group.mode;
  // Super League Players update their Deployment between Rounds and Tournaments: only the saved Battles of this Round are a source (ADR 0020).
  const saved = mode === 'Super League' ? reusableIn(everySaved, round) : everySaved;
  const drafts = Array.from({ length: TEAMS_PER_MODE[mode] }, (_, i) => withDefault(reference, mode, newDraft(reference), i));
  const taken = new Set<number>();
  const profiles: Record<Side, number | null> = { A: null, B: null };
  const names: Record<Side, string | null> = { A: null, B: null };
  const notes: string[] = [];
  const problems: string[] = [];
  const reused: string[] = [];
  const teamChanges: NonNullable<Clone['teamChanges']> = [];
  const shared: Pick<Draft, 'playerIdA' | 'playerIdB' | 'unionLevel' | 'opponentUnionLevel'> = { playerIdA: null, playerIdB: null, unionLevel: '', opponentUnionLevel: '' };
  // The teams the other pictures of this import show for a Player: a hero read the same in two of them outvotes a misreading.
  const sameWho = (a: FightDraftSide, b: FightDraftSide) => (a.profile?.playerId && b.profile?.playerId ? a.profile.playerId.toLowerCase() === b.profile.playerId.toLowerCase() : !!a.name && a.name.trim().toLowerCase() === b.name?.trim().toLowerCase());
  const seenInPictures = (mine: FightDraftSide, number: number | null): KnownTeam[] =>
    others
      .filter((g) => g !== group && g.mode === mode)
      .flatMap((g) => g.pictures)
      .filter((p) => TEAMS_PER_MODE[mode] === 1 || p.draft.number === number)
      .flatMap((p) => [p.draft.sideA, p.draft.sideB])
      .filter((s) => sameWho(s, mine) && (s.unread ?? []).length === 0 && s.heroes.length > 0)
      .map((s) => ({ heroes: [...new Set(s.heroes.map((h) => h.hero))].sort(), from: 'the other pictures of this import' }));
  for (const picture of group.pictures) {
    const { draft } = picture;
    const wanted = draft.number !== null ? draft.number - 1 : -1;
    const slot = wanted >= 0 && wanted < drafts.length && !taken.has(wanted) ? wanted : drafts.findIndex((_, i) => !taken.has(i));
    if (slot < 0) continue;
    taken.add(slot);
    const cells = reference.maps.find((m) => m.name === drafts[slot]!.mapName)?.cells ?? [];
    const sides = { A: draft.sideA, B: draft.sideB } as Record<Side, FightDraftSide>;
    const asRead = { ...sides };
    // what the picture could not read of a hero's rank or equipment comes from the Player's Profile (ADR 0021)
    for (const side of ['A', 'B'] as const) {
      const profile = sides[side].profile;
      const roster = profile ? rosters.get(profile.id) : undefined;
      if (!roster) continue;
      sides[side] = {
        ...sides[side],
        heroes: sides[side].heroes.map((h) => {
          const state = roster.find((r) => r.name === h.hero);
          return state ? { ...h, rank: h.rank ?? state.rank, equipmentLevel: h.equipmentLevel ?? state.equipmentLevel } : h;
        }),
      };
    }
    const corrected: Record<Side, string[]> = { A: [], B: [] };
    const known = { A: [] as SavedPlacement<SavedSide>[], B: [] as SavedPlacement<SavedSide>[] };
    const mapName = drafts[slot]!.mapName;
    if (reuse)
      for (const side of ['A', 'B'] as const) {
        const playerId = sides[side].profile?.playerId;
        const inRound = savedSides(saved, mode, slot + 1, side, playerId, mapName);
        // no record of this team in the Round: the Player's latest sides in any Round or Tournament are the suggestion (ADR 0021)
        const own = inRound.length > 0 || mode !== 'Super League' ? inRound : savedSides(everySaved, mode, slot + 1, side, playerId, mapName);
        // a misread side is corrected from what the same Player fielded in a saved fight or in the other pictures
        const fix = correctHeroes(sides[side], [...knownTeams(own, 'a saved fight of the same Player'), ...seenInPictures(sides[side], draft.number)]);
        if (fix) {
          sides[side] = { ...sides[side], heroes: fix.heroes, unread: fix.unread };
          corrected[side] = fix.corrected.map((c) => c.to);
          // in a Round a correction from the Player's own records is the reuse the player asked for: it is listed, not a reason to look
          (round ? reused : notes).push(`Team ${slot + 1}, Side ${side} (${sides[side].name ?? '?'}): corrected from ${fix.because}: ${fix.corrected.map((c) => (c.from ? `${c.from} to ${c.to}` : `${c.to} added`)).join(', ')}. Check it against the picture.`);
        }
        // where the team stood: the same Player's saved sides first, then any other Player's on the same Map (ADR 0030); the player reviews it before saving.
        // The sides of the Player outside the Round, when the Round holds none, count as the Player's own too.
        const who = playerId?.toLowerCase();
        const inRoundOwn = savedPlacements(saved, mode, slot + 1, side);
        known[side] = who && !inRoundOwn.some((p) => p.playerId?.toLowerCase() === who) && mode === 'Super League'
          ? [...inRoundOwn, ...savedPlacements(everySaved, mode, slot + 1, side).filter((p) => p.playerId?.toLowerCase() === who)]
          : inRoundOwn;
      }
    for (const [side, zone] of [['A', TILE.PLAYER], ['B', TILE.ENEMY]] as const)
      if (misfitsMap(known[side], sides[side].heroes, sides[side], cells, zone, mapName, sides[side].profile?.playerId)) notes.push(`Team ${slot + 1}, Side ${side} (${sides[side].name ?? '?'}): the saved placement does not fit the map ${drafts[slot]!.mapName}, so the heroes are on free tiles.`);
    // A player seen before with the same heroes stands as in the saved fight: the formations of a round-robin do not change.
    const reuseA = reusedSide(known.A, sides.A.heroes, sides.A, cells, TILE.PLAYER, mapName, sides.A.profile?.playerId);
    const reuseB = reusedSide(known.B, sides.B.heroes, sides.B, cells, TILE.ENEMY, mapName, sides.B.profile?.playerId);
    let formation = placeOwn(cells, sides.A.heroes, sides.A, reuseA);
    let opponent = placeOpponent(cells, sides.B.heroes, sides.B, reuseB);
    // The Phantimal of an imported side follows the same rule as one placed by hand: it stands only while the heroes of its faction are there
    // and both of its tiles fit (ADR 0029). A misread Phantimal is therefore dropped whole instead of being left half on the map. This runs
    // after the Round Deployment below, because that too can bring a Phantimal the team cannot field.
    const phantimalOptions = reference.phantimals.map((p) => ({ name: p.name, faction: p.faction }));
    const heroFactions = new Map(reference.heroes.map((h) => [h.name, h.faction]));
    // Where the form put the heroes by itself is a guess a Round Deployment must not keep (ADR 0021); a saved placement is not.
    let guess: Draft['guess'] = {
      A: reuseA ? undefined : guessOf(drafts[slot]!.mapName, formation.placed, formation.phantimal),
      B: reuseB ? undefined : guessOf(drafts[slot]!.mapName, opponent.placed, opponent.phantimal),
    };
    // The Round Deployment of each Player, matched by Player and fight number (ADR 0020): a side that fits it takes its ranks, equipment,
    // artifact and tiles; one that differs stays as read, and the Round Deployment panel of the form flags it.
    if (round)
      for (const side of ['A', 'B'] as const) {
        const entry = deployments.find((e) => e.profileId === sides[side].profile?.id);
        let match = matchTeam(entry?.teams[slot] ?? null, readSideOf(sides[side]), side);
        // a reading the player corrected into this team before is no change, whether or not it was corrected again from other records
        if (match.state === 'changed') {
          const raw = matchTeam(entry?.teams[slot] ?? null, readSideOf(asRead[side]), side);
          if (raw.state === 'fits') match = raw;
        }
        const who = `Team ${slot + 1}, Side ${side} (${sides[side].name ?? sides[side].profile?.name ?? '?'})`;
        // A Player's Deployment is fixed for the Round, so a picture that mostly agrees with it is a misreading: the Deployment's team is
        // used, and the batch table says so. A picture where most heroes differ may be a real change and is left to the player.
        if (match.state === 'changed' && sides[side].profile) {
          const swap = match.changes.find((c) => c.kind === 'hero');
          const size = match.deployment.heroes.filter((h) => !isSummon(h)).length;
          if (!swap || Math.max(swap.gone.length, swap.added.length) <= Math.floor(size / 2)) {
            reused.push(`${who}: the picture reads differently from the Round Deployment (${match.changes.map(describeChange).join('; ')}), so the Deployment’s team is used.`);
            match = { state: 'fits', team: match.deployment };
          }
        }
        if (!sides[side].profile) problems.push(`${who}: no profile`);
        else if (match.state === 'none') problems.push(`${who}: no Round Deployment`);
        else if (match.state === 'changed') {
          problems.push(`${who}: differs from the Round Deployment`);
          // the player can say the change is real: the picture's team, its new heroes without tiles (a picture shows none)
          const changedTeam: RoundTeam = {
            ...match.team,
            heroes: [...match.team.heroes, ...match.unplaced.map((h) => ({ tile: null, hero: h.hero, part: '', rank: h.rank, equipmentLevel: h.equipmentLevel }))],
          };
          const turnedBack = side === 'B' ? turnTeam(changedTeam) : changedTeam;
          teamChanges.push({ side, slot, profileId: sides[side].profile!.id, team: withSeenAs(turnedBack, [readSideOf(sides[side])]), who });
        }
        // unknown tiles are normal: a picture shows none, and the first saved Battle of the Round fills them (ADR 0021)
        if (match.state !== 'fits') continue;
        if (!standsOn(match.team, cells, side === 'A' ? TILE.PLAYER : TILE.ENEMY)) reused.push(`${who}: tiles not placed yet, so this Battle's placement fills them for the Round.`);
        // a team placed on another Map keeps its heroes, ranks and artifact here, but not its tiles (ADR 0021)
        if (side === 'A') {
          formation = applyToOwn(formation, match.team, cells);
          // the Deployment knows every tile: this is a placement, not a guess; partly-known tiles are taken out of the guess
          if (standsOn(match.team, cells, TILE.PLAYER)) guess.A = undefined;
          else if (guess.A) guess.A = pruneGuess(guess.A, match.team);
        } else {
          opponent = applyToOpponent(opponent, match.team, cells);
          if (standsOn(match.team, cells, TILE.ENEMY)) guess.B = undefined;
          else if (guess.B) guess.B = pruneGuess(guess.B, match.team);
        }
      }
    if (round) {
      // The same two Players, in either order, already have this fight number in this Round: the Battle is saved (ADR 0020).
      const [idA, idB] = [sides.A.profile?.playerId?.toLowerCase(), sides.B.profile?.playerId?.toLowerCase()];
      const again = idA && idB ? saved.find((f) => f.battlePosition === slot + 1 && f.playerIdA && f.playerIdB && ((f.playerIdA.toLowerCase() === idA && f.playerIdB.toLowerCase() === idB) || (f.playerIdA.toLowerCase() === idB && f.playerIdB.toLowerCase() === idA))) : undefined;
      if (again) notes.push(`Team ${slot + 1}: ${sides.A.name ?? '?'} against ${sides.B.name ?? '?'} is already saved in this Round (battle ${again.battleId ?? again.id}).`);
      if (draft.number === null) problems.push('a picture has no fight number');
      if (draft.sideA.heroes.length === 0) problems.push(`Team ${slot + 1}, Side A: no hero read`);
      if (draft.sideB.heroes.length === 0) problems.push(`Team ${slot + 1}, Side B: no hero read`);
      if (draft.outcome === null) problems.push(`Team ${slot + 1}: result not read`);
      if (draft.duplicateOf) problems.push(`Team ${slot + 1}: looks like fight ${draft.duplicateOf.id}, already saved`);
    }
    // Now that the Round Deployment is in too, the Phantimal rule has the last word on both sides (ADR 0029): a Phantimal the team cannot
    // field — a misread from the picture, or a stale one in the Round Deployment — is dropped whole, so it can never hold up the save.
    const withDerived = <T extends FormationState | OpponentState>(state: T, zone: number): T =>
      derivePhantimal({ ...state, phantimalChoice: state.phantimal?.name ?? (state.phantimalChoice ?? '') }, cells, zone, phantimalOptions, heroFactions) as T;
    const dropped: string[] = [];
    for (const [side, before] of [['A', formation.phantimal], ['B', opponent.phantimal]] as const) {
      if (!before) continue;
      const after = side === 'A' ? withDerived(formation, TILE.PLAYER) : withDerived(opponent, TILE.ENEMY);
      if (!after.phantimal) dropped.push(`${side}:${before.name}`);
      if (side === 'A') formation = after as FormationState;
      else opponent = after as OpponentState;
    }
    // A guess is a placement only while it stands: a Phantimal the rule dropped is no longer a guessed tile either.
    if (!formation.phantimal && guess.A) guess.A = { ...guess.A, phantimal: null };
    if (!opponent.phantimal && guess.B) guess.B = { ...guess.B, phantimal: null };
    for (const side of dropped) {
      const [letter, name] = side.split(':') as ['A' | 'B', string];
      notes.push(`Team ${slot + 1}, Side ${letter} (${sides[letter].name ?? '?'}): the Phantimal ${name} was left out — a team must field three heroes of its faction, and both tiles of a pair must fit. Pick it from the Phantimal choice if the picture was right.`);
    }
    for (const [side, placed, picked] of [['A', formation.placed, sides.A], ['B', opponent.placed, sides.B]] as const) {
      const left = unplacedUnit(placed, null, null);
      if (left) notes.push(`Team ${slot + 1}, Side ${side} (${picked.name ?? '?'}): no free tile for ${left}, place it by hand.`);
    }
    drafts[slot] = {
      ...drafts[slot]!,
      outcome: draft.outcome ?? 'Win',
      note: `Imported from ${picture.label ?? 'a picture'}: ${draft.sideA.name ?? '?'} against ${draft.sideB.name ?? '?'}`,
      formation,
      opponent,
      seen: { A: [readSideOf(asRead.A), readSideOf(sides.A)], B: [readSideOf(asRead.B), readSideOf(sides.B)] },
      guess,
      imported: {
        A: { read: readingOf(draft.sideA), crops: picture.cropData?.A ?? { artifact: null, phantimal: null }, corrected: corrected.A },
        B: { read: readingOf(draft.sideB), crops: picture.cropData?.B ?? { artifact: null, phantimal: null }, corrected: corrected.B },
        picture: picture.original ? { label: picture.label, data: picture.original } : null,
      },
    };
    profiles.A ??= draft.sideA.profile?.id ?? null;
    profiles.B ??= draft.sideB.profile?.id ?? null;
    names.A ??= draft.sideA.name;
    names.B ??= draft.sideB.name;
    shared.playerIdA ??= draft.sideA.profile?.playerId ?? null;
    shared.playerIdB ??= draft.sideB.profile?.playerId ?? null;
    if (shared.unionLevel === '' && draft.unionLevelA !== null) shared.unionLevel = String(draft.unionLevelA);
    if (shared.opponentUnionLevel === '' && draft.unionLevelB !== null) shared.opponentUnionLevel = String(draft.unionLevelB);
  }
  // The two sides of one Battle are two Players: one Profile on both sides would write one Deployment twice (ADR 0021).
  if (profiles.A !== null && profiles.A === profiles.B) problems.push('Side A and Side B are the same Profile: choose the right Profile for one side');
  if (round) {
    drafts.forEach((_, i) => taken.has(i) || problems.push(`Team ${i + 1}: no picture`));
    problems.push(...notes);
  }
  return { mode, formationIds: { a: '', b: '' }, drafts: drafts.map((d) => ({ ...d, ...shared })), profiles, names, notes: [...notes, ...reused], round: mode === 'Super League' ? round : null, deployments, problems, reused, teamChanges };
}

/** The profile that has this Player ID (ignoring case), or null. */
export function profileByPlayerId(profiles: Profile[], playerId: string | null | undefined): number | null {
  if (!playerId) return null;
  return profiles.find((p) => p.playerId !== null && p.playerId.toLowerCase() === playerId.toLowerCase())?.id ?? null;
}

/** Who plays a side: the name of the Profile with its Player ID, else the Player ID itself, else null (a side nobody is recorded for). */
export const playerName = (profiles: Profile[], playerId: string | null | undefined): string | null =>
  playerId ? (profiles.find((p) => p.playerId !== null && p.playerId.toLowerCase() === playerId.toLowerCase())?.name ?? playerId) : null;

export type Side = 'A' | 'B';
