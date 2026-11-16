import { weaponLabel } from '../../src/domain/exclusive-weapon.js';
import { MAX_STANDARD_HEROES } from '../../src/domain/formation.js';
import { isSummon, PAIR_PHANTIMALS } from '../../src/domain/units.js';
import { Portrait } from '../Portrait.js';
import { ArtifactBadge } from '../SelectedHero.js';

interface Props {
  heroes: { name: string; part?: string; rank: string | null; equipmentLevel: number | null }[];
  phantimal?: { name: string } | null;
  artifact?: string | null;
  /** The assist hero of a stage or Dream Hunt record; it is not one of the five units, so it comes last. */
  assist?: { name: string } | null;
  /** What is written under each hero: its name, or its rank and equipment; `none` writes nothing, so the row is only as tall as the portraits and the details stay in the tooltips. */
  meta?: 'name' | 'state' | 'none';
  size?: number;
  side?: 'a' | 'b';
  label?: string;
  /** Draws a box around the team: green when it won the battle, plain when it lost. Leave out where there is no winner to show. */
  outcome?: 'won' | 'lost';
}

/**
 * A team as the game shows it: the phantimal, then the artifact, then the heroes. A hero that stands on several
 * tiles (a pair, a hero with summons) appears once. Every position has its place even when empty (no phantimal, no
 * artifact, fewer than five heroes, no assist hero), so rows of teams line up; pass `assist` (null when there is none)
 * only where the record has an assist hero.
 */
export function TeamOverview({ heroes, phantimal, artifact, assist, meta = 'name', size = 32, side = 'a', label, outcome }: Props) {
  const slot = { width: size + 12 }; // every slot has the same width, so the same unit sits in the same place on every row
  const blank = (key: string) => <span key={key} className="unit-blank" aria-hidden="true" style={{ width: size + 12, height: size + (meta === 'none' ? 0 : 14) }} />;
  // A summon's row can come before its hero's (the tiles decide the order), so drop the summons first and then keep one row per hero.
  const own = heroes.filter((h) => !isSummon({ hero: h.name, part: h.part }));
  const once = own.filter((h, i) => own.findIndex((x) => x.name === h.name) === i);
  return (
    <span className={`team${outcome ? ` team-box team-${outcome}` : ''}`} aria-label={label && outcome ? `${label} (${outcome})` : label}>
      {phantimal ? (
        <span className="unit" style={slot} title={`Phantimal ${PAIR_PHANTIMALS[phantimal.name] ? `${phantimal.name} and ${PAIR_PHANTIMALS[phantimal.name]}` : phantimal.name}`}>
          <Portrait kind="phantimal" name={phantimal.name} size={size} />
          {meta !== 'none' && <span className="unit-meta">phantimal</span>}
        </span>
      ) : (
        blank('phantimal')
      )}
      {artifact ? (
        <span className="unit" style={slot} title={artifact}>
          <ArtifactBadge name={artifact} side={side} size={size} />
          {meta !== 'none' && <span className="unit-meta">{artifact}</span>}
        </span>
      ) : (
        blank('artifact')
      )}
      {once.map((h) => (
        <span key={h.name} className="unit" style={slot} title={`${h.name} · ${h.rank ?? 'rank unknown'}${h.equipmentLevel != null ? ` · ${weaponLabel(h.equipmentLevel)}` : ''}`}>
          <Portrait kind="hero" name={h.name} size={size} />
          {meta !== 'none' && (
            <span className="unit-meta">
              {meta === 'name' ? h.name : `${h.rank ?? '–'}${h.equipmentLevel != null ? ` ${weaponLabel(h.equipmentLevel)}` : ''}`}
            </span>
          )}
        </span>
      ))}
      {Array.from({ length: Math.max(0, MAX_STANDARD_HEROES - once.length) }, (_, i) => blank(`hero${i}`))}
      {assist === undefined ? null : assist ? (
        <span className="unit" style={slot} title={`Assist ${assist.name}`}>
          <Portrait kind="hero" name={assist.name} size={size} />
          {meta !== 'none' && <span className="unit-meta">assist</span>}
        </span>
      ) : (
        blank('assist')
      )}
    </span>
  );
}
