import { compareDeployments, deploymentArtifactClash, deploymentFrom, isEmptyDeployment, isFormationId, normalizeFormationId } from '../src/domain/layout.js';
import { api, type FormationIdEntry } from './backend.js';
import { useLoad } from './hooks/load.js';
import { Notice } from './ui/Notice.js';

/** The library of Formation IDs, read when a field appears: it is short, and the matching is done here. */
const NO_ENTRIES: FormationIdEntry[] = [];
function useLibrary(): FormationIdEntry[] {
  return useLoad(() => api.formationIds(), []).data ?? NO_ENTRIES;
}

/** One team as the forms hold it: its placed units, phantimal and artifact (empty when none). */
interface PlacedTeam {
  placed: { tile: number; hero: string; part?: string | null }[];
  phantimal: { tile: number; name: string; partnerTile?: number | null } | null;
  artifact?: string | null;
}

interface Props {
  /** Names the side in a page with two fields, for example "Side A". */
  label?: string;
  value: string;
  onChange: (code: string) => void;
  /** The teams the code covers, team 1 first: one for a fight on its own, all the teams of a battle otherwise. A team without units is not compared. */
  teams: PlacedTeam[];
}

const seen = (e: FormationIdEntry) => e.maps.join(', ');
const teamCount = (e: FormationIdEntry) => e.deployment.teams.filter((t) => t !== null).length;
const artifactsOf = (e: FormationIdEntry) => e.deployment.teams.map((t, k) => (t?.artifact ? `team ${k + 1}: ${t.artifact}` : null)).filter(Boolean).join(', ');

/**
 * The Formation ID of a fight or of a side of a battle: the game's code for its Deployment, the teams with their units,
 * tiles and artifacts. While units are placed, the stored codes that cover the teams placed (as placed or all turned upside
 * down) are offered, and a code stored for other units, tiles or artifacts is flagged.
 */
export function FormationIdField({ label, value, onChange, teams }: Props) {
  const library = useLibrary();
  const code = normalizeFormationId(value);
  const placed = deploymentFrom(teams.map((t) => ({ heroes: t.placed, phantimal: t.phantimal, artifact: t.artifact || null })));
  const hasUnits = !isEmptyDeployment(placed);
  const known = library.find((e) => e.code === code);
  const clash = known && hasUnits ? (compareDeployments(known.deployment, placed, true) === null ? 'units' : deploymentArtifactClash(known.deployment, placed)) : null;
  const suggestions = hasUnits
    ? library.flatMap((e) => {
        const match = compareDeployments(e.deployment, placed);
        return match && e.code !== code ? [{ entry: e, match }] : [];
      })
    : [];
  return (
    <div className="field formation-id">
      <span className="field-caption">Formation ID{label ? ` · ${label}` : ''}</span>
      <div className="tags">
        <input
          className="formation-id-input"
          value={value}
          maxLength={8}
          spellCheck={false}
          placeholder={label ? `Formation ID · ${label}` : 'Formation ID'}
          aria-label={label ? `Formation ID of ${label}` : 'Formation ID'}
          aria-invalid={code !== '' && !isFormationId(code)}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        {code !== '' && !isFormationId(code) && <span className="muted">Digits or capital letters, 8 in all.</span>}
        {clash === 'units' && <Notice kind="error" as="span">{code} is stored with other units or tiles: check the code, or clear it to save without.</Notice>}
        {clash && clash !== 'units' && <Notice kind="error" as="span">{code} is stored with {clash.stored} on team {clash.team}, not {clash.placed}: check the code, or clear it to save without.</Notice>}
        {known && !clash && (
          <span className="muted" title={[seen(known), artifactsOf(known)].filter(Boolean).join(' · ')}>
            Known{teamCount(known) > 1 ? `: ${teamCount(known)} teams` : ''}
            {known.maps.length > 0 ? `${teamCount(known) > 1 ? ', ' : ': '}seen on ${known.maps.join(', ')}` : ''}
          </span>
        )}
        {suggestions.length > 0 && (
          <>
            <span className="muted">{teams.filter((t) => t.placed.length > 0 || t.phantimal).length > 1 ? 'Same teams, same tiles:' : 'Same units, same tiles:'}</span>
            {suggestions.map(({ entry, match }) => (
              <button
                key={entry.code}
                type="button"
                className="formation-suggestion"
                title={[seen(entry) || 'no map yet', artifactsOf(entry), match === 'rotated' ? 'the map turned upside down' : ''].filter(Boolean).join(' · ')}
                onClick={() => onChange(entry.code)}
              >
                {entry.code}
                {teamCount(entry) > 1 ? ` (${teamCount(entry)} teams)` : ''}
                {match === 'rotated' ? ' (turned)' : ''}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** A record's Formation ID, small, in a list. */
export function FormationIdBadge({ code, side }: { code: string | null | undefined; side?: 'A' | 'B' }) {
  return code ? (
    <span className="badge formation-id-badge" title={`Formation ID${side ? ` of Side ${side}` : ''}`}>
      {side ? `${side}: ` : ''}
      {code}
    </span>
  ) : null;
}
