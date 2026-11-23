import type { ArenaMode, FightDraftSide, FightImportPicture, Profile } from '../backend.js';
import { fightCoverage, pictureKey, type ImportGroup } from './battle-import.js';
import type { Round, RoundWarning } from '../../src/domain/tournament.js';

const EDITS = 'battle-import-edits';
const LAST_CHOICES = 'battle-import-last';

/** What the player changed in the wizard, by the picture's key: fight numbers, the group a picture was moved to, and the profile given to a name in lower case (0 means none). */
export interface Edits {
  numbers: Record<string, number | null>;
  moved: Record<string, string>;
  made: Record<string, number>;
}

export const noEdits = (): Edits => ({ numbers: {}, moved: {}, made: {} });

export function readEdits(): Edits {
  try {
    const found = JSON.parse(localStorage.getItem(EDITS) ?? '{}') as Partial<Edits>;
    return { numbers: found.numbers ?? {}, moved: found.moved ?? {}, made: found.made ?? {} };
  } catch {
    return noEdits();
  }
}

export function writeEdits(edits: Edits): void {
  try {
    localStorage.setItem(EDITS, JSON.stringify(edits));
  } catch {
    // the edits then last until the page is closed
  }
}

/** The edits without those of pictures that left the queue (`keys` are the pictures there now); the same object when nothing goes. */
export function pruneEdits(edits: Edits, keys: ReadonlySet<string>): Edits {
  const keep = <T>(field: Record<string, T>) => Object.fromEntries(Object.entries(field).filter(([key]) => keys.has(key)));
  const numbers = keep(edits.numbers);
  const moved = keep(edits.moved);
  const made = keys.size === 0 ? {} : edits.made;
  const same = Object.keys(numbers).length === Object.keys(edits.numbers).length && Object.keys(moved).length === Object.keys(edits.moved).length && made === edits.made;
  return same ? edits : { numbers, moved, made };
}

const folded = (name: string | null | undefined) => (name ?? '').trim().toLowerCase();

/**
 * The pictures with the player's edits over what was read: the fight number given, and the profile given to a name, which wins over the
 * picture's own match (ADR 0021). A name left alone, or given a profile that no longer exists, keeps its match.
 */
export function applyEdits(queue: FightImportPicture[], edits: Edits, profiles: Profile[]): FightImportPicture[] {
  const give = (side: FightDraftSide): FightDraftSide => {
    const name = folded(side.name);
    if (!name || !(name in edits.made)) return side;
    const id = edits.made[name]!;
    if (id === 0) return { ...side, profile: null };
    const profile = profiles.find((p) => p.id === id);
    return profile ? { ...side, profile: { id: profile.id, name: profile.name, playerId: profile.playerId } } : side;
  };
  return queue.map((q) => {
    if (!q.draft) return q;
    const key = pictureKey(q);
    const number = key in edits.numbers ? edits.numbers[key]! : q.draft.number;
    return { ...q, draft: { ...q.draft, number, sideA: give(q.draft.sideA), sideB: give(q.draft.sideB) } };
  });
}

/** The Tournament and Round a batch of Super League pictures is for. */
export interface ImportRound {
  tournamentId: number;
  round: Round;
  /** The Tournament's name, for the form. */
  label: string;
}

/** What the batch table and its save need to know about the import. */
export interface BatchOptions {
  reuse: boolean;
  round: ImportRound;
  groups: ImportGroup[];
}

/** Where the wizard stands when it is opened again after the form: the choices made, and whether to open the next battle that needs a look. */
export interface ImportStart {
  mode: ArenaMode;
  tournamentId: number | null;
  round: Round | null;
  openNext: boolean;
}

/** The mode, Tournament and Round chosen last time in this browser. */
export interface LastChoices {
  mode?: ArenaMode;
  tournamentId?: number | null;
  round?: Round | null;
}

export function lastChoices(): LastChoices {
  try {
    return JSON.parse(localStorage.getItem(LAST_CHOICES) ?? '{}') as LastChoices;
  } catch {
    return {};
  }
}

export function rememberChoices(choices: LastChoices): void {
  try {
    localStorage.setItem(LAST_CHOICES, JSON.stringify(choices));
  } catch {
    // the choices are then not remembered
  }
}

export const nameOf = (t: { season: number; number: number }) => `Season ${t.season}, Tournament ${t.number}`;

export function warningText(w: RoundWarning): string {
  return w.kind === 'older-tournament'
    ? `${nameOf(w.latest)} is the latest Tournament, not this one: check that these pictures are from this Tournament.`
    : `A later Round (${w.latest}) already has Battles in this Tournament: check that these pictures are from this Round.`;
}

const list = (numbers: number[]) => numbers.join(', ').replace(/, (\d+)$/, ' and $1');

/** What is wrong with the pictures of a battle of several fights (Supreme Arena 3, Guild Duel 3, Super League 5), or null when it has one of each. */
export function coverageNotice(group: ImportGroup): string | null {
  const { expected, missing, duplicated, unnumbered } = fightCoverage(group);
  if (expected === 1) return null;
  const problems: string[] = [];
  if (group.pictures.length !== expected) problems.push(`${group.pictures.length} of ${expected} pictures`);
  if (unnumbered > 0) problems.push(`${unnumbered} without a fight number`);
  else if (missing.length > 0) problems.push(`no picture for fight${missing.length > 1 ? 's' : ''} ${list(missing)}`);
  if (duplicated.length > 0) problems.push(`fight${duplicated.length > 1 ? 's' : ''} ${list(duplicated)} ${duplicated.length > 1 ? 'have' : 'has'} two pictures`);
  return problems.length > 0 ? problems.join(' · ') : null;
}

/** The names each side of a group gave, with the Profile each resolves to now (the picture's match, or the one given by the player). */
export function namesOf(group: ImportGroup, side: 'A' | 'B'): { name: string; given: FightDraftSide['profile'] }[] {
  const sideOf = (p: ImportGroup['pictures'][number]) => (side === 'A' ? p.draft.sideA : p.draft.sideB);
  const found = new Map<string, string>();
  for (const p of group.pictures) {
    const name = sideOf(p).name?.trim();
    if (name && !found.has(name.toLowerCase())) found.set(name.toLowerCase(), name);
  }
  return [...found.values()].map((name) => {
    const sides = group.pictures.map(sideOf).filter((s) => folded(s.name) === name.toLowerCase());
    return { name, given: sides.find((s) => s.profile)?.profile ?? null };
  });
}
