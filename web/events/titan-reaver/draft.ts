import { type TitanReaverBattle, type TitanReaverBattleInput, type Artifact, type Boss, type GameMap, type Hero, type Phantimal, type Rules } from '../../backend.js';
import { BOSSES_PER_TITAN_PHASE, MAX_LEVEL, SEASON_PHASES, TITAN_FIGHTS, TITAN_MAP, TITAN_PHASES, battleTotal, formatDamage, parseDamage, type TitanPhase } from '../../../src/domain/titan-reaver.js';
import type { TitanReaverView } from '../../../src/shared/contracts/defaults.js';
import { emptyFormation, formationFromRecord, toPayload, withRosterStates, type FormationState } from '../../FormationEditor.js';

/** How many Battles the views that read them all ask for; the server never returns more, newest first. */
export const ALL_BATTLES = 100000;

/** What the Titan Reaver form needs from the rest of the app. */
export interface Reference {
  bosses: Boss[];
  maps: GameMap[];
  heroes: Hero[];
  artifacts: Artifact[];
  phantimals: Phantimal[];
  heroRules: Rules;
  /** The bosses of the current event, from Admin > Weekly default. */
  setup: TitanReaverView;
  /** The current Season Phase, stored (#284): a new record starts on it, and only it has the setup's bosses. */
  seasonPhase: number;
  /** The current Season, which a new record is played in. */
  season: number;
}

/** One fight while it is being set up. */
export interface FightDraft {
  boss: string;
  /** As typed: `1.2B`, `1,234,567`. */
  damage: string;
  formation: FormationState;
}

/** A Battle while it is being set up, before it is saved. */
export interface BattleDraft {
  seasonPhase: number;
  titanPhase: TitanPhase;
  level: string;
  note: string;
  tags: string[];
  formationId: string;
  fights: FightDraft[];
}

/** The Season Phase a new record starts on: the current one. */
const startingSeasonPhase = (reference: Reference): number => Math.min(SEASON_PHASES.length, Math.max(1, reference.seasonPhase));

/** The bosses the setup names for a Titan Reaver Phase (empty text where it names none, or the boss is gone). The setup is the current Season Phase's event, so other Season Phases get none. */
export const bossesFor = (reference: Reference, seasonPhase: number, titanPhase: TitanPhase): string[] => {
  const first = TITAN_PHASES.indexOf(titanPhase) * BOSSES_PER_TITAN_PHASE;
  return Array.from({ length: TITAN_FIGHTS }, (_, i) => {
    const name = seasonPhase === startingSeasonPhase(reference) ? reference.setup.bosses[first + i] : null;
    return name && reference.bosses.some((b) => b.name === name) ? name : '';
  });
};

/** Whether the setup has a boss to start this Season Phase's record from, so the form can say when it has nothing. */
export const hasSetupFor = (reference: Reference, seasonPhase: number): boolean => seasonPhase === startingSeasonPhase(reference) && reference.setup.bosses.some((b) => b !== null);

/** A new Battle: the setup's bosses for its Titan Reaver Phase, the Season Phase's maximum level, and no team yet. */
export function newDraft(reference: Reference): BattleDraft {
  const seasonPhase = startingSeasonPhase(reference);
  const titanPhase: TitanPhase = 'Charge';
  const bosses = bossesFor(reference, seasonPhase, titanPhase);
  return {
    seasonPhase,
    titanPhase,
    level: String(MAX_LEVEL[seasonPhase]),
    note: '',
    tags: [],
    formationId: '',
    fights: bosses.map((boss) => ({ boss, damage: '', formation: emptyFormation() })),
  };
}

/** A Battle to change: what was saved, with the damage written out. */
export const draftFromBattle = (b: TitanReaverBattle): BattleDraft => ({
  seasonPhase: b.seasonPhase,
  titanPhase: b.titanPhase,
  level: String(b.level),
  note: b.note ?? '',
  tags: b.tags,
  formationId: b.formationId ?? '',
  fights: b.fights.map((f) => ({ boss: f.boss, damage: formatDamage(f.damage), formation: formationFromRecord(f.formation) })),
});

/** A new Battle from a saved one: the same teams, bosses, level, Season Phase, Titan Reaver Phase, tags and Formation ID, with no damage and no note. */
export const draftFromClone = (b: TitanReaverBattle): BattleDraft => ({ ...draftFromBattle(b), note: '', fights: draftFromBattle(b).fights.map((f) => ({ ...f, damage: '' })) });

/** What an Advisor plan needs to become a draft: the phase and level it was made for, its bosses, and the saved Battle each fight's team comes from. */
export interface PlanSource {
  seasonPhase: number;
  titanPhase: TitanPhase;
  level: number;
  bosses: (string | null)[];
  picks: ({ battleId: number; boss: string } | null)[];
}

/**
 * A new Battle from an Advisor plan: its phases, level and bosses, and for each fight the team of the saved fight (tiles, Artifact, Phantimal)
 * with the rank and equipment of the roster today. A fight with no team starts empty; a team whose saved fight cannot be found throws, so the page reports it. No damage, note, tags or Formation ID.
 */
export function draftFromPlan(reference: Reference, plan: PlanSource, battles: Map<number, TitanReaverBattle>): BattleDraft {
  const base = withPhases(reference, newDraft(reference), plan.seasonPhase, plan.titanPhase);
  return {
    ...base,
    level: String(plan.level),
    fights: base.fights.map((fight, i) => {
      const pick = plan.picks[i];
      const saved = pick ? battles.get(pick.battleId)?.fights.find((f) => f.boss === pick.boss) : undefined;
      // a team the Advisor chose must come from its saved fight: an empty one would look like a plan that was copied
      if (pick && !saved) throw new Error(`The saved Battle ${pick.battleId} has no fight against ${pick.boss}, so its team cannot be copied.`);
      const boss = plan.bosses[i] ?? pick?.boss ?? fight.boss;
      return { boss, damage: '', formation: saved ? withRosterStates(formationFromRecord(saved.formation), reference.heroes, true) : emptyFormation() };
    }),
  };
}

/** The same Battle with a new Season Phase and/or Titan Reaver Phase: the bosses follow the setup where it names them, and a level that was the old maximum follows the new. */
export function withPhases(reference: Reference, draft: BattleDraft, seasonPhase: number, titanPhase: TitanPhase): BattleDraft {
  const named = bossesFor(reference, seasonPhase, titanPhase);
  const keepsMax = draft.level === '' || draft.level === String(MAX_LEVEL[draft.seasonPhase]);
  return {
    ...draft,
    seasonPhase,
    titanPhase,
    level: keepsMax ? String(MAX_LEVEL[seasonPhase]) : draft.level,
    fights: draft.fights.map((f, i) => (named[i] ? { ...f, boss: named[i]! } : f)),
  };
}

/** The damage of the two fights added up, or null while one of them does not read as a number. */
export function totalOf(draft: BattleDraft): number | null {
  const damages = draft.fights.map((f) => parseDamage(f.damage));
  return damages.every((d) => d !== null) ? battleTotal(damages.map((d) => ({ damage: d! }))) : null;
}

/** The Battle as the API takes it, or what is missing. */
export function toBattle(d: BattleDraft): { battle: TitanReaverBattleInput } | { error: string } {
  const level = Number(d.level);
  if (d.level.trim() === '' || !Number.isInteger(level)) return { error: 'Enter the level as a whole number' };
  const fights: TitanReaverBattleInput['fights'] = [];
  for (const [i, f] of d.fights.entries()) {
    if (!f.boss) return { error: `Fight ${i + 1}: pick a boss` };
    const damage = parseDamage(f.damage);
    if (damage === null) return { error: `Fight ${i + 1}: enter the damage as a number (1234567890, 1,234,567,890) or short (1.2B, 850K)` };
    fights.push({ boss: f.boss, damage, formation: toPayload(f.formation) });
  }
  return { battle: { seasonPhase: d.seasonPhase, titanPhase: d.titanPhase, level, note: d.note, tags: d.tags, formationId: d.formationId || null, fights } };
}

export { TITAN_MAP };
