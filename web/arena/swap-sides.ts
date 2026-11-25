import { turn } from '../../src/domain/map-geometry.js';
import { isSummon } from '../../src/domain/units.js';
import type { FormationState } from '../FormationEditor.js';
import type { Draft } from './draft.js';
import type { GuessTiles } from './round-deployment.js';
import type { OpponentState } from './OpponentEditor.js';

type Phantimal = FormationState['phantimal'];

const turnPhantimal = (p: Phantimal): Phantimal => (p ? { ...p, tile: turn(p.tile), ...(p.partnerTile != null ? { partnerTile: turn(p.partnerTile) } : {}) } : null);

/** The units of a formation on the turned tiles (placed units, the phantimal and its partner); turning twice gives the formation back. Ranks, equipment, artifact and the rest stay. */
export const turnFormation = (f: FormationState): FormationState => ({ ...f, placed: f.placed.map((p) => ({ ...p, tile: turn(p.tile) })), phantimal: turnPhantimal(f.phantimal) });

/** Side A's editor state as Side B's: the same units on the turned tiles, each with the rank and equipment the record would store. */
export function formationAsOpponent(f: FormationState): OpponentState {
  const stateOf = (hero: string) => {
    const s = f.snapshots[hero];
    return { rank: s?.rank ?? '', equipment: s?.equipmentLevel == null ? '' : String(s.equipmentLevel) };
  };
  return {
    placed: f.placed.map((p) => ({ ...p, tile: turn(p.tile), ...(isSummon(p) ? { rank: '', equipment: '' } : stateOf(p.hero)) })),
    assist: f.assist ? { hero: f.assist, ...stateOf(f.assist) } : { hero: '', rank: '', equipment: '' },
    phantimal: turnPhantimal(f.phantimal),
    phantimalChoice: f.phantimalChoice,
    artifact: f.artifact,
    formationId: f.formationId,
  };
}

/** Side B's editor state as Side A's, the opposite of `formationAsOpponent`. A hero with no state set keeps none (it then takes the roster's). */
export function opponentAsFormation(o: OpponentState): FormationState {
  const snapshots: FormationState['snapshots'] = {};
  const remember = (hero: string, rank: string, equipment: string) => {
    if (hero in snapshots || (rank === '' && equipment === '')) return;
    snapshots[hero] = { rank: rank || null, equipmentLevel: equipment === '' ? null : Number(equipment) };
  };
  for (const p of o.placed) if (!isSummon(p)) remember(p.hero, p.rank, p.equipment);
  if (o.assist.hero) remember(o.assist.hero, o.assist.rank, o.assist.equipment);
  return {
    placed: o.placed.map(({ rank: _rank, equipment: _equipment, ...p }) => ({ ...p, tile: turn(p.tile) })),
    phantimal: turnPhantimal(o.phantimal),
    phantimalChoice: o.phantimalChoice,
    assist: o.assist.hero,
    artifact: o.artifact,
    formationId: o.formationId,
    snapshots,
  };
}

const turnGuess = (g: GuessTiles | undefined): GuessTiles | undefined =>
  g && { ...g, heroes: Object.fromEntries(Object.entries(g.heroes).map(([unit, tiles]) => [unit, tiles.map(turn)])), phantimal: g.phantimal ? { tile: turn(g.phantimal.tile), ...(g.phantimal.partnerTile != null ? { partnerTile: turn(g.phantimal.partnerTile) } : {}) } : null };

/**
 * The draft with its two sides exchanged: what each side owns (its units, now on the turned tiles, ranks, equipment, assist hero,
 * artifact, phantimal, Formation ID, Player and Union Level) goes to the other side, and the result is read from the new Side A.
 * The map, rule, note and tags belong to the fight and stay. The units may not fit the map's tiles: the caller refits them (`onMap`).
 */
export function swapSides(d: Draft): Draft {
  const { seen, guess, imported } = d;
  return {
    ...d,
    outcome: d.outcome === 'Win' ? 'Loss' : 'Win',
    playerIdA: d.playerIdB,
    playerIdB: d.playerIdA,
    unionLevel: d.opponentUnionLevel,
    opponentUnionLevel: d.unionLevel,
    formation: opponentAsFormation(d.opponent),
    opponent: formationAsOpponent(d.formation),
    ...(seen ? { seen: { A: seen.B, B: seen.A } } : {}),
    ...(guess ? { guess: { A: turnGuess(guess.B), B: turnGuess(guess.A) } } : {}),
    ...(imported ? { imported: { ...imported, A: imported.B, B: imported.A } } : {}),
  };
}
