import type { FormationState } from '../FormationEditor.js';
import type { ArenaMode, Artifact, GameMap, Hero, Phantimal, Rules, WeeklySetups } from '../backend.js';
import type { SentTeam } from '../dream-hunt/sentTeams.js';

/**
 * Stand-in for the Advisor screens, which are not part of this build. Each screen says so; the editors of the Advisor's own
 * settings show nothing.
 */

/** A team to start a new fight from: a fight of the record, or a team the player placed by hand. */
export type RecordPick = { index: number; attemptId: number } | { index: number; pin: { mapName: string; formation: FormationState } };

/** A Titan Reaver plan to start a new record from. */
export interface TitanRecordPlan {
  seasonPhase: number;
  titanPhase: 'Charge' | 'Clash' | 'Conquer';
  level: number;
  bosses: (string | null)[];
  picks: ({ battleId: number; boss: string } | null)[];
}

const Missing = ({ name }: { name: string }) => (
  <p className="muted">
    The {name} is not part of this build.
  </p>
);

export const Advisor = (_props: { onRecord: (picks: RecordPick[]) => void }) => <Missing name="Advisor" />;

export const Ideas = (_props: { reference: { maps: GameMap[]; heroes: Hero[]; artifacts: Artifact[]; phantimals: Phantimal[] }; onForm: (open: boolean) => void }) => <Missing name="Ideas tab" />;

export const Simulator = (_props: {
  reference: { defaults: WeeklySetups; maps: GameMap[]; heroes: Hero[]; artifacts: Artifact[]; heroRules: Rules };
  onRecord: (picks: RecordPick[]) => void;
  sent?: SentTeam[];
  onRemoveSent?: (key: string) => void;
}) => <Missing name="Simulator" />;

export const CounterAdvisor = () => <Missing name="Counter Advisor" />;

export const KnownAdvisor = (_props: { reference: { maps: GameMap[]; heroes: Hero[]; defaults: WeeklySetups; heroRules: Rules } }) => <Missing name="Advisor" />;

/** The known-layout selector of the editors; there are no known layouts in this build. */
export const KnownLayoutControl = <T extends { placed: { tile: number; hero: string; part?: string }[]; phantimal: { tile: number; name: string; partnerTile?: number | null } | null }>(_props: {
  mode: ArenaMode;
  map: Pick<GameMap, 'name' | 'rowLengths' | 'cells'> | null;
  placement: T;
  turned?: boolean;
  drawTurned?: boolean;
  excludeAttempts?: number[];
  excludeIdea?: number | null;
  onChange: (next: T) => void;
}) => null;

export const PlacementRulesAdmin = (_props: { hero: string }) => null;

export const ScoreSettingsAdmin = () => null;
export const IdeaStandingsAdmin = () => null;

export const TitanReaverAdvisor = (_props: { onRecord: (plan: TitanRecordPlan) => void }) => <Missing name="Advisor" />;

/** Whether the Advisor screens are part of this build. */
export const advisorInstalled = false;
