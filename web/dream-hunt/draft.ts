import { DREAM_HUNT_FIGHTS, formatDuration, parseDuration } from '../../src/domain/dream-hunt.js';
import { api, type Artifact, type Boss, type BossRule, type DreamHuntAttempt, type GameMap, type Hero, type Rules, type WeeklySetups } from '../backend.js';
import { emptyFormation, formationFromRecord, toPayload, type FormationState } from '../FormationEditor.js';
import { emptyOpponent } from '../arena/OpponentEditor.js';
import { keepOnMap } from '../relocate.js';

export interface Reference {
  defaults: WeeklySetups;
  bosses: Boss[];
  rules: BossRule[];
  maps: GameMap[];
  heroes: Hero[];
  artifacts: Artifact[];
  heroRules: Rules;
}

/** One fight while it is being set up, before it is saved as a record. */
export interface Draft {
  boss: string;
  rule: string;
  mapName: string;
  formation: FormationState;
  outcome: 'Win' | 'Loss';
  time: string;
  note: string;
  tags: string[];
}

const defaultMap = (reference: Reference) => {
  const stageMaps = reference.maps.filter((m) => m.tags.includes('Stage'));
  return stageMaps.find((m) => m.name === 'Open')?.name ?? stageMaps[0]?.name ?? '';
};

/** The team of a draft on another map: where it stands is kept as far as the new map allows (see keepOnMap). */
export const onMap = (reference: Reference, mapName: string, draft: Draft): FormationState => {
  const map = reference.maps.find((m) => m.name === mapName);
  return map ? keepOnMap(map.cells, draft.formation, emptyOpponent()).formation : draft.formation;
};

/** The tags every fight of one day shares. */
export const sharedTags = (d: Draft | undefined) => ({ tags: d?.tags ?? [] });

/** A new fight starts with the week's boss, map and rule of its number, for what still exists; otherwise the number's boss and the usual map. */
export const newDraft = (reference: Reference, index: number): Draft => {
  const slot = reference.defaults['Dream Hunt'].slots[index];
  const boss = slot?.boss && reference.bosses.some((b) => b.name === slot.boss) ? slot.boss : (reference.bosses[index]?.name ?? reference.bosses[0]?.name ?? '');
  const mapName = slot?.mapName && reference.maps.some((m) => m.name === slot.mapName) ? slot.mapName : defaultMap(reference);
  const rule = index === DREAM_HUNT_FIGHTS - 1 && slot?.rule && reference.rules.some((r) => r.name === slot.rule) ? slot.rule : '';
  return blankDraft(boss, rule, mapName);
};

const blankDraft = (boss: string, rule: string, mapName: string): Draft => ({
  boss,
  rule,
  mapName,
  formation: emptyFormation(),
  outcome: 'Win',
  time: '',
  note: '',
  tags: [],
});

export const draftFromFight = (f: DreamHuntAttempt): Draft => ({
  boss: f.boss,
  rule: f.bossRule ?? '',
  mapName: f.mapName,
  formation: formationFromRecord(f.formation),
  outcome: f.outcome,
  time: f.timeSeconds != null ? formatDuration(f.timeSeconds) : '',
  note: f.note ?? '',
  tags: f.tags,
});

/** The fight as the API takes it, or an error naming what is missing. */
export function toFight(d: Draft): { fight: Parameters<typeof api.createDreamHuntAttempt>[0] } | { error: string } {
  let timeSeconds: number | null = null;
  if (d.outcome === 'Win') {
    timeSeconds = parseDuration(d.time);
    if (timeSeconds === null) return { error: 'Enter the clear time in seconds (9.69, 9s69) or minutes (1:10, 1m10)' };
  }
  return { fight: { boss: d.boss, mapName: d.mapName, outcome: d.outcome, timeSeconds, bossRule: d.rule || null, note: d.note, tags: d.tags, formation: toPayload(d.formation) } };
}
