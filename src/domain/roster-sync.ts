/**
 * Roster sync: after a record is saved, which heroes of a Profile's Roster differ from the Hero State the record
 * stored for them. A higher recorded state is an upgrade, which the Roster probably missed; a lower one is
 * probably an older fight recorded late, so it is only offered, never assumed. A hero the Profile does not own yet is
 * offered as new when the record gives its rank: for another player's Profile, a hero is only ever discovered in a battle.
 */
import { isStronger } from './hero-state.js';

export interface HeroStateValue {
  rank: string | null;
  equipmentLevel: number | null;
}

export interface RecordedHero extends HeroStateValue {
  name: string;
}

export interface RosterChange {
  hero: string;
  /** The Roster's state now. */
  from: HeroStateValue;
  /** The Roster's state after the change: the recorded rank and equipment replace the Roster's where the record has them. */
  to: HeroStateValue;
  /** `new` is a hero the Roster does not have yet. */
  direction: 'upgrade' | 'downgrade' | 'new';
}

/**
 * The differences between recorded heroes and a Roster (hero name to state), in the order the heroes were recorded.
 * `ranks` is the full rank list, lowest first. A rank or equipment level the record leaves empty says nothing, so the
 * Roster's value stands; a hero counts once, by its first appearance. A hero missing from the Roster is new, but only
 * when the record gives its rank.
 */
export function rosterChanges(recorded: RecordedHero[], roster: Map<string, HeroStateValue>, ranks: string[]): RosterChange[] {
  const changes: RosterChange[] = [];
  const seen = new Set<string>();
  for (const hero of recorded) {
    if (seen.has(hero.name)) continue;
    seen.add(hero.name);
    const from = roster.get(hero.name);
    if (!from) {
      if (hero.rank !== null) changes.push({ hero: hero.name, from: { rank: null, equipmentLevel: null }, to: { rank: hero.rank, equipmentLevel: hero.equipmentLevel }, direction: 'new' });
      continue;
    }
    const to: HeroStateValue = {
      rank: hero.rank ?? from.rank,
      equipmentLevel: hero.equipmentLevel ?? from.equipmentLevel,
    };
    if (to.rank === from.rank && to.equipmentLevel === from.equipmentLevel) continue;
    changes.push({ hero: hero.name, from, to, direction: isStronger(to, from, ranks) ? 'upgrade' : 'downgrade' });
  }
  return changes;
}
