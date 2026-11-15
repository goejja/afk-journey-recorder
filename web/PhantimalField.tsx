import type { Hero, Phantimal } from './backend.js';
import { checkFactionRequirement, PARTNER_PHANTIMALS } from '../src/domain/units.js';
import { Portrait } from './Portrait.js';
import type { PlacedPhantimal, PlacedRow } from './units.js';

interface Props {
  /** The Phantimals the mode and season offer; the pairs are offered once, under their key. */
  phantimals: Phantimal[];
  placed: PlacedRow[];
  /** Every hero, for their factions: the Faction Requirement needs them (ADR 0029). */
  heroes: Hero[];
  choice: string;
  /** The Phantimal as it stands now, to warn when it has no room. */
  shown: PlacedPhantimal | null;
  onChoose: (name: string) => void;
}

/**
 * The Phantimal of one team: a choice of portraits beside the team, not a Unit placed by hand. Every Phantimal the mode
 * and season offer is shown; one whose Faction Requirement the placed heroes do not meet is greyed out, with the reason
 * in its tooltip. The chosen one appears and disappears with the heroes (ADR 0029).
 */
export function PhantimalField({ phantimals, placed, heroes, choice, shown, onChoose }: Props) {
  const options = phantimals.filter((p) => !PARTNER_PHANTIMALS.has(p.name));
  const factions = new Map(heroes.map((h) => [h.name, h.faction]));
  /** Why the team cannot field a Phantimal, or null when it can. */
  const problem = (name: string): string | null => {
    const option = options.find((p) => p.name === name);
    return option ? checkFactionRequirement(placed, name, option.faction, factions) : null;
  };
  const names = options.map((p) => p.name);
  // A choice that stands but is outside the season on show is still listed: it is what the record holds, and it stays selectable.
  const listed = choice !== '' && !names.includes(choice) && shown?.name === choice ? [choice, ...names] : names;
  const noneEligible = listed.every((name) => problem(name) !== null);
  return (
    <>
      <ul className="hero-grid" aria-label="Phantimal">
        <li>
          <button
            className={['hero-icon', choice === '' ? 'active' : ''].filter(Boolean).join(' ')}
            aria-label="No Phantimal"
            aria-pressed={choice === ''}
            title="No Phantimal on this team"
            onClick={() => onChoose('')}
          >
            <span className="phantimal-none" aria-hidden="true">
              ∅
            </span>
            <span>None</span>
          </button>
        </li>
        {listed.map((name) => {
          const reason = problem(name);
          return (
            <li key={name}>
              <button
                className={['hero-icon', choice === name ? 'active' : ''].filter(Boolean).join(' ')}
                aria-label={name}
                aria-pressed={choice === name}
                // The chosen one stays clickable even when the team no longer meets its requirement: clearing it is the None tile.
                disabled={reason !== null && choice !== name}
                title={reason ?? name}
                onClick={() => onChoose(name)}
              >
                <Portrait kind="phantimal" name={name} size={44} />
                <span>{name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {options.length === 0 && <p className="muted">No phantimals are tagged for this season.</p>}
      {options.length > 0 && noneEligible && choice === '' && <p className="muted">Three heroes of one faction bring a Phantimal.</p>}
      {choice !== '' && shown === null && problem(choice) === null && options.some((p) => p.name === choice) && <p className="error">No free tile for {choice}.</p>}
    </>
  );
}