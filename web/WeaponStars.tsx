import { weaponLabel, weaponStars } from '../src/domain/exclusive-weapon.js';

/** The stars the game draws for a weapon level: grey up to +25, then purple, yellow, red and rainbow for R1 to R4. */
export function WeaponStars({ level }: { level: number | null }) {
  if (level === null) return null;
  const { count, color } = weaponStars(level);
  return (
    <span className={`weapon-stars weapon-stars-${color}`} role="img" aria-label={`${weaponLabel(level)}, ${count} ${color} stars`}>
      {'★'.repeat(count)}
    </span>
  );
}

/** A level as an option of a select, which cannot hold colours: its label and its stars (the colour shows next to the select). */
export const weaponOptionText = (level: number): string => `${weaponLabel(level)} ${'★'.repeat(weaponStars(level).count)}`;
