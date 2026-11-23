import type { FormationState } from '../FormationEditor.js';
import type { Artifact, GameMap, Hero, Rules, WeeklySetups } from '../backend.js';
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

export const Simulator = (_props: {
  reference: { defaults: WeeklySetups; maps: GameMap[]; heroes: Hero[]; artifacts: Artifact[]; heroRules: Rules };
  onRecord: (picks: RecordPick[]) => void;
  sent?: SentTeam[];
  onRemoveSent?: (key: string) => void;
}) => <Missing name="Simulator" />;

export const CounterAdvisor = () => <Missing name="Counter Advisor" />;

export const TeamGenerator = () => <Missing name="Team generator" />;

export const PlacementRulesAdmin = (_props: { hero: string }) => null;

export const ScoreSettingsAdmin = () => null;

export const TitanReaverAdvisor = (_props: { onRecord: (plan: TitanRecordPlan) => void }) => <Missing name="Advisor" />;

/** Whether the Advisor screens are part of this build. */
export const advisorInstalled = false;
