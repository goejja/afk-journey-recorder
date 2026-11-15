import { useCallback, useEffect, useState } from 'react';
import { api } from '../backend.js';
import { BestTeams } from './BestTeams.js';
import { ThisWeek } from './ThisWeek.js';
import { Advisor, Simulator, type RecordPick } from '../advisor/index.js';
import { Finder } from './Finder.js';
import { useSentTeams } from './sentTeams.js';
import { type Reference, type Draft, newDraft, draftFromFight } from './draft.js';
import { Fights } from './FightList.js';

type View = 'week' | 'advisor' | 'simulator' | 'best' | 'finder' | 'fights';

export function DreamHuntPage() {
  const [view, setView] = useState<View>('week');
  const [full, setFull] = useState(false);
  const [reference, setReference] = useState<Reference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ index: number; draft: Draft }[] | null>(null);
  const [version, setVersion] = useState(0); // goes up when records changed, so the views built from them load again
  const patchReference = useCallback((change: Partial<Reference>) => setReference((old) => old && { ...old, ...change }), []);
  // A saved fight can update the roster (the sync offer), so the heroes are read again; the rest of the reference does not change with records.
  const reloadHeroes = useCallback(async () => {
    try {
      patchReference({ heroes: await api.heroes() });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [patchReference]);

  const reload = useCallback(async () => {
    try {
      const [bosses, rules, maps, heroes, artifacts, heroRules, defaults] = await Promise.all([api.bosses(), api.bossRules(), api.maps(), api.heroes(), api.artifacts(), api.rules(), api.defaults()]);
      setReference({ bosses, rules, maps, heroes, artifacts, heroRules, defaults });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // From the Advisor or the Simulator: start a new day from the proposed teams, each in the place of its boss. A team that was fought
  // is copied from the fight that stood that way (without its result, time and note); a pinned one comes from the Simulator as it is.
  const record = useCallback(
    async (picks: RecordPick[]) => {
      if (!reference) return;
      try {
        const seeds = await Promise.all(
          picks.map(async (pick) => {
            const planned = newDraft(reference, pick.index);
            if ('pin' in pick) return { index: pick.index, draft: { ...planned, mapName: pick.pin.mapName, formation: pick.pin.formation } };
            const fight = await api.dreamHuntAttempt(pick.attemptId);
            return { index: pick.index, draft: { ...draftFromFight(fight), rule: planned.rule, outcome: 'Win' as const, time: '', note: '', tags: [] } };
          }),
        );
        setPrefill(seeds);
        setView('fights');
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [reference],
  );
  const prefillUsed = useCallback(() => setPrefill(null), []);

  // Teams sent to the Simulator from Best teams and the Finder wait on its shelf, whichever tab is open.
  const shelf = useSentTeams();
  const toSimulator = {
    send: (boss: string, composition: Parameters<typeof shelf.send>[1], layout?: Parameters<typeof shelf.send>[2]) => {
      shelf.send(boss, composition, layout).then(() => setError(null), (e: Error) => setError(e.message));
    },
    isSent: shelf.has,
  };

  return (
    <div>
      {!full && (
        <div className="tabs" role="tablist">
          {([['week', 'This week'], ['advisor', 'Advisor'], ['simulator', 'Simulator'], ['best', 'Best teams'], ['finder', 'Finder'], ['fights', 'Fights']] as const).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={view === key} className={view === key ? 'active' : undefined} onClick={() => setView(key)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {reference && view === 'week' && <ThisWeek key={version} slots={reference.defaults['Dream Hunt'].slots} />}
      {reference && view === 'advisor' && <Advisor key={version} onRecord={(picks) => void record(picks)} />}
      {reference && view === 'simulator' && <Simulator key={version} reference={reference} onRecord={(picks) => void record(picks)} sent={shelf.sent} onRemoveSent={shelf.remove} />}
      {reference && view === 'best' && <BestTeams key={version} bosses={reference.bosses} rules={reference.rules} send={toSimulator} />}
      {reference && view === 'finder' && <Finder key={version} heroes={reference.heroes} rules={reference.rules} send={toSimulator} />}
      {reference && view === 'fights' && <Fights reference={reference} onChanged={() => (setVersion((v) => v + 1), void reloadHeroes())} onDefaults={(defaults) => patchReference({ defaults })} onForm={setFull} prefill={prefill} onPrefillUsed={prefillUsed} />}
    </div>
  );
}
