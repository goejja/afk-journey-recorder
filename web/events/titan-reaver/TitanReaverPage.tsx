import { useCallback, useMemo, useState } from 'react';
import { api, type TitanReaverBattle } from '../../backend.js';
import { useReference } from '../../hooks/load.js';
import { useCurrentSeason } from '../../seasons.js';
import { TitanReaverAdvisor, advisorInstalled, type TitanRecordPlan } from '../../advisor/index.js';
import { Notice } from '../../ui/Notice.js';
import { TabbedPage } from '../../ui/Tabs.js';
import type { TitanPhase } from '../../../src/domain/titan-reaver.js';
import { type BattleDraft, type Reference, draftFromPlan } from './draft.js';
import { BestTeams } from './BestTeams.js';
import { Records } from './Records.js';
import { ThisEvent } from './ThisEvent.js';

type View = 'event' | 'best' | 'advisor' | 'records';

const VIEWS: { key: View; label: string }[] = [
  { key: 'event', label: 'This event' },
  { key: 'records', label: 'Records' },
  ...(advisorInstalled ? [{ key: 'advisor' as const, label: 'Advisor' }] : []),
  { key: 'best', label: 'Best teams' },
];

/** The Titan Reaver event: its views: This event (the best runs of each Titan Reaver Phase), the Records, the Advisor (a build with it) and Best teams (the teams against each boss). */
export function TitanReaverPage({ onForm }: { onForm: (open: boolean) => void }) {
  const [view, setView] = useState<View>('event');
  // the filters "Show records" opens the Records with; a new object each time, so the list is rebuilt even for the same filters
  const [shown, setShown] = useState<{ seasonPhase: number; titanPhase: TitanPhase } | null>(null);
  const [prefill, setPrefill] = useState<BattleDraft | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  const season = useCurrentSeason();
  const { patch, ...loaded } = useReference({
    bosses: api.bosses,
    maps: api.maps,
    heroes: api.heroes,
    artifacts: api.artifacts,
    phantimals: api.phantimals,
    heroRules: api.rules,
    setup: api.titanReaverSetup,
    seasons: api.seasons,
  });
  const reference: Reference | null = useMemo(() => (loaded.data ? { ...loaded.data, seasonPhase: loaded.data.seasons.find((s) => s.current)?.phase ?? 1, season } : null), [loaded.data, season]);
  // A saved record can advance the Season Phase and so empty the setup: both are read again, so the next new record starts from them.
  const reload = useCallback(async () => {
    const [seasons, setup] = await Promise.all([api.seasons(), api.titanReaverSetup()]);
    patch({ seasons, setup });
  }, [patch]);
  // From the Advisor: a new record from a plan, each team copied from the saved Battle it was best in.
  const record = useCallback(
    async (plan: TitanRecordPlan) => {
      if (!reference) return;
      try {
        const ids = [...new Set(plan.picks.flatMap((p) => (p ? [p.battleId] : [])))];
        const battles = new Map<number, TitanReaverBattle>((await Promise.all(ids.map((id) => api.titanReaverBattle(id)))).map((b) => [b.id, b]));
        setPrefill(draftFromPlan(reference, plan, battles));
        setRecordError(null);
        setView('records');
      } catch (e) {
        setRecordError((e as Error).message);
      }
    },
    [reference],
  );
  const prefillUsed = useCallback(() => setPrefill(null), []);

  return (
    <TabbedPage id="titan-reaver" label="Titan Reaver views" tabs={VIEWS} value={view} onChange={setView} sticky={false} notice={loaded.error && <Notice kind="error">{loaded.error}</Notice>} onForm={onForm}>
      {(form) => (
        <>
          {reference && view === 'event' && (
            <ThisEvent
              reference={reference}
              onShowRecords={(seasonPhase, titanPhase) => {
                setShown({ seasonPhase, titanPhase });
                setView('records');
              }}
            />
          )}
          {reference && view === 'best' && <BestTeams reference={reference} />}
          {view === 'advisor' && (
            <>
              {recordError && <Notice kind="error">{recordError}</Notice>}
              <TitanReaverAdvisor onRecord={(plan) => void record(plan)} />
            </>
          )}
          {reference && view === 'records' && <Records key={shown ? `${shown.seasonPhase}-${shown.titanPhase}` : 'all'} reference={reference} initial={shown} prefill={prefill} onPrefillUsed={prefillUsed} onChanged={reload} onForm={form} />}
        </>
      )}
    </TabbedPage>
  );
}
