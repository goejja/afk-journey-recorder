import { isSummon } from '../../src/domain/units.js';
import type { FormationState } from '../FormationEditor.js';
import { resolveUnit } from '../units.js';

/**
 * What an editor needs to let a unit be taken from another team of the same contest (the fights of a Dream Hunt day,
 * the teams of a Supreme Arena battle): where it stands now, and how to take it out of there. The editor asks the
 * player first, then releases it and places it in its own team.
 */
export interface Borrow {
  /** What the teams are called in the question: "fight" or "team". */
  noun: string;
  /** Where a hero is held ("fight 2"), or null when no other team has it. */
  heroHolder: (hero: string) => string | null;
  artifactHolder: (artifact: string) => string | null;
  /** Takes the hero, with all its units, out of the team that holds it. */
  releaseHero: (hero: string) => void;
  releaseArtifact: (artifact: string) => void;
}

/** The question put to the player before a unit is taken from another team. */
export const moveQuestion = (what: string, holder: string, noun: string): string => `${what} is in ${holder}. Move it to this ${noun}? It is removed from ${holder}.`;

/** The formation without a hero: every unit of it (both parts of a pair, its summons), its rank and equipment, and its place as assist hero. */
export function withoutHero(formation: FormationState, hero: string): FormationState {
  if (!formation.placed.some((p) => p.hero === hero) && formation.assist !== hero && !(hero in formation.snapshots)) return formation;
  const { [hero]: _state, ...snapshots } = formation.snapshots;
  return { ...formation, placed: formation.placed.filter((p) => p.hero !== hero), assist: formation.assist === hero ? '' : formation.assist, snapshots };
}

/** The formation without the artifact, when it holds that one. */
export const withoutArtifact = (formation: FormationState, artifact: string): FormationState =>
  formation.artifact === artifact ? { ...formation, artifact: '' } : formation;

/**
 * Lets the team at `current` take heroes (and, when `artifacts` is set, artifacts) from the other teams of `drafts`.
 * `setDrafts` takes an update function, so a release and the editor's own change both apply.
 */
export function formationBorrow<D extends { formation: FormationState }>(
  drafts: D[],
  current: number,
  noun: string,
  setDrafts: (update: (old: D[]) => D[]) => void,
  artifacts: boolean,
): Borrow {
  const holder = (holds: (f: FormationState) => boolean): string | null => {
    const index = drafts.findIndex((d, i) => i !== current && holds(d.formation));
    return index < 0 ? null : `${noun} ${index + 1}`;
  };
  const release = (take: (f: FormationState) => FormationState) =>
    setDrafts((old) =>
      old.map((d, i) => {
        const formation = i === current ? d.formation : take(d.formation);
        return formation === d.formation ? d : { ...d, formation };
      }),
    );
  return {
    noun,
    heroHolder: (hero) => holder((f) => f.placed.some((p) => p.hero === hero) || f.assist === hero),
    artifactHolder: (artifact) => (artifacts ? holder((f) => f.artifact === artifact) : null),
    releaseHero: (hero) => release((f) => withoutHero(f, hero)),
    releaseArtifact: (artifact) => release((f) => withoutArtifact(f, artifact)),
  };
}

/** The icons of a selector that another team holds and the player may take: not already unavailable, not a summon (it follows its hero). */
export function heldIcons(icons: { name: string }[], disabled: Map<string, string>, borrow: Borrow): Map<string, string> {
  const held = new Map<string, string>();
  for (const { name } of icons) {
    const unit = resolveUnit(name);
    const holder = disabled.has(name) || isSummon(unit) ? null : borrow.heroHolder(unit.hero);
    if (holder) held.set(name, holder);
  }
  return held;
}
