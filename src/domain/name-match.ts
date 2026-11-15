/**
 * Matching a player's name as the game shows it to a profile's name. A name typed on a keyboard without the game's alphabet
 * uses look-alike letters ("Mokka" for "Мокка"), so names are compared with the case ignored and look-alike Cyrillic letters folded to Latin.
 */

const LOOK_ALIKES: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's',
};

/** A name for comparing: case, surrounding space and look-alike Cyrillic letters ignored. */
export function foldName(name: string): string {
  return [...name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')].map((letter) => LOOK_ALIKES[letter] ?? letter).join('');
}

export interface NamedProfile {
  id: number;
  name: string;
}

export interface ProfileMatch {
  profile: NamedProfile;
  /** True when the profile's name is not spelled exactly as the game shows it (ignoring case): the review offers to rename the profile. */
  spelledDifferently: boolean;
}

/** The profile a player name belongs to, or null. A name that fits several profiles after folding is not a match: it cannot be told which one. */
export function matchProfile(playerName: string, profiles: NamedProfile[]): ProfileMatch | null {
  const exact = profiles.filter((p) => p.name.trim().toLowerCase() === playerName.trim().toLowerCase());
  if (exact.length === 1) return { profile: exact[0]!, spelledDifferently: false };
  const folded = foldName(playerName);
  const similar = profiles.filter((p) => foldName(p.name) === folded);
  return similar.length === 1 ? { profile: similar[0]!, spelledDifferently: true } : null;
}

/** A player name a picture gave, remembered against the Profile it was resolved to (ADR 0021). */
export interface SeenName {
  folded: string;
  profileId: number;
}

/** The Profile a spelling was resolved to before, or null when it was never seen. */
export function matchSeenName(playerName: string, seen: SeenName[]): number | null {
  const folded = foldName(playerName);
  return seen.find((s) => s.folded === folded)?.profileId ?? null;
}

