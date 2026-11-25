import { useState } from 'react';
import { useReference } from '../hooks/load.js';
import { advisorInstalled, CounterAdvisor, Ideas, KnownAdvisor } from '../advisor/index.js';
import { api } from '../backend.js';
import { type PatchReference } from './draft.js';
import { Battles } from './FightList.js';
import { Notice } from '../ui/Notice.js';
import { TabbedPage } from '../ui/Tabs.js';

type View = 'records' | 'ideas' | 'advisor' | 'counter' | 'planner';

// The Advisor tools are part of a private build only; the public build keeps Records and the Planner.
const VIEWS: { key: View; label: string }[] = [
  { key: 'records', label: 'Records' },
  ...(advisorInstalled ? [{ key: 'ideas' as const, label: 'Ideas' }, { key: 'advisor' as const, label: 'Advisor' }, { key: 'counter' as const, label: 'Counter advisor' }] : []),
  { key: 'planner', label: 'Planner' },
];

/** The PvP page: its Records, the Ideas (a private build), the Advisor of known formations, the Counter advisor and the Planner (paused, #331). */
export function ArenaPage() {
  const [view, setView] = useState<View>('records');
  const loaded = useReference({
    maps: api.maps,
    heroes: api.heroes,
    artifacts: api.artifacts,
    rules: api.bossRules,
    heroRules: api.rules,
    phantimals: api.phantimals,
    defaults: api.defaults,
    profiles: api.profiles,
  });
  const patchReference: PatchReference = loaded.patch;

  return (
    <TabbedPage id="arena" label="PvP views" tabs={VIEWS} value={view} onChange={setView}>
      {(onForm) => (
        <>
          {view === 'records' && loaded.error && <Notice kind="error">{loaded.error}</Notice>}
          {view === 'records' && loaded.data && <Battles reference={loaded.data} patchReference={patchReference} onForm={onForm} />}
          {view === 'ideas' && loaded.data && <Ideas reference={loaded.data} onForm={onForm} />}
          {view === 'advisor' && loaded.data && <KnownAdvisor reference={loaded.data} />}
          {view === 'counter' && <CounterAdvisor />}
          {view === 'planner' && <p className="muted">The Scenario planner is paused while it is re-evaluated.</p>}
        </>
      )}
    </TabbedPage>
  );
}
