export interface EquipmentCap {
  rank: string;
  minLevel: number | null;
  maxLevel: number | null;
}

export interface HeroStateRules {
  ranks: string[];
  equipmentLevels: number[];
  caps: EquipmentCap[];
}

export interface HeroState {
  rank: string | null;
  equipmentLevel: number | null;
}

/** The lowest rank a hero of each tier can have; R heroes are also capped there. */
const MINIMUM_RANK: Record<string, string> = { S: 'Epic', A: 'Elite', R: 'Rare' };

/**
 * The ranks a hero of this tier can have, lowest first: S heroes start at Epic, A heroes at Elite, and R heroes (Chippy and Hammie)
 * can only be Rare. `ranks` is the full rank list, lowest first; an unknown tier allows every rank.
 */
export function allowedRanks(tier: string | null, ranks: string[]): string[] {
  const minimum = tier ? MINIMUM_RANK[tier] : undefined;
  if (!minimum || !ranks.includes(minimum)) return ranks;
  const from = ranks.indexOf(minimum);
  return tier === 'R' ? [minimum] : ranks.slice(from);
}

/** The rank a hero has when it is first added: the lowest one its tier allows, or none when its tier is unknown. */
export function minimumRank(tier: string | null, ranks: string[]): string | null {
  return tier && MINIMUM_RANK[tier] ? (allowedRanks(tier, ranks)[0] ?? null) : null;
}

/**
 * Equipment levels a hero of this rank may have. Only ranks with a cap row (Mythic+ and
 * above) can have equipment; every other rank, and an unset rank, may only have none.
 */
export function allowedEquipmentLevels(rank: string | null, rules: HeroStateRules): number[] {
  const cap = rank ? rules.caps.find((c) => c.rank === rank) : undefined;
  if (!cap) return [];
  return rules.equipmentLevels.filter(
    (level) => (cap.minLevel == null || level >= cap.minLevel) && (cap.maxLevel == null || level <= cap.maxLevel),
  );
}

/**
 * The equipment level a hero should have after its rank changes to `rank`: none where the rank allows no equipment, the lowest level
 * the rank allows when it had none, and otherwise its level moved into what the rank allows (a level above the cap becomes the cap).
 */
export function equipmentForRank(level: number | null, rank: string | null, rules: HeroStateRules): number | null {
  const allowed = allowedEquipmentLevels(rank, rules);
  if (allowed.length === 0) return null;
  if (level === null) return allowed[0]!;
  if (allowed.includes(level)) return level;
  return level > allowed.at(-1)! ? allowed.at(-1)! : allowed[0]!;
}

/** Returns an error message, or null when the state is valid. Pass the hero's tier to also check its rank against it. */
export function validateHeroState(state: HeroState, rules: HeroStateRules, tier: string | null = null): string | null {
  if (state.rank !== null && !rules.ranks.includes(state.rank)) return `Unknown rank "${state.rank}"`;
  if (state.rank !== null && !allowedRanks(tier, rules.ranks).includes(state.rank)) {
    return tier === 'R' ? 'R heroes can only be Rare' : `${tier} heroes start at ${MINIMUM_RANK[tier!]}, not ${state.rank}`;
  }
  if (state.equipmentLevel === null) return null;
  if (!rules.equipmentLevels.includes(state.equipmentLevel)) return `Unknown equipment level +${state.equipmentLevel}`;
  if (!allowedEquipmentLevels(state.rank, rules).includes(state.equipmentLevel)) {
    return `Equipment +${state.equipmentLevel} is not allowed at rank ${state.rank ?? 'unset'}`;
  }
  return null;
}

/** Whether state `a` is stronger than state `b`: a higher rank (`ranks` lists them weakest first), else, at the same rank, more equipment. */
export function isStronger(a: { rank: string | null; equipmentLevel: number | null }, b: { rank: string | null; equipmentLevel: number | null }, ranks: string[]): boolean {
  const rankA = a.rank === null ? -1 : ranks.indexOf(a.rank);
  const rankB = b.rank === null ? -1 : ranks.indexOf(b.rank);
  return rankA !== rankB ? rankA > rankB : (a.equipmentLevel ?? -1) > (b.equipmentLevel ?? -1);
}
