import { useState } from 'react';
import { api } from '../backend.js';
import { useLoad } from '../hooks/load.js';
import { LearnedRanks } from './LearnedRanks.js';
import { LearnedSummary } from './LearnedSummary.js';
import { LearnedUnits } from './LearnedUnits.js';
import { ParkedReadings } from './ParkedReadings.js';
import { ReaderHeroes } from './ReaderHeroes.js';
import { TabPanel, Tabs } from '../ui/Tabs.js';
import { Notice } from '../ui/Notice.js';

const PARTS = [
  { key: 'confirm', label: 'To confirm' },
  { key: 'heroes', label: 'Heroes' },
  { key: 'ranks', label: 'Ranks' },
  { key: 'units', label: 'Artifacts and phantimals' },
] as const;

/** What the application and the Agent learnt from the pictures the player confirmed, to review and to fix when a picture was filed wrongly. */
export function ReaderPage() {
  const loaded = useLoad(() => api.learned(), []);
  const view = loaded.data ?? null;
  const error = loaded.error;
  const [part, setPart] = useState<(typeof PARTS)[number]['key']>('confirm');
  // how many readings wait for the player (ADR 0040), known once the first tab has read them; shown in its label
  const [waiting, setWaiting] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);

  const reload = loaded.reload;

  // a change in one part (a source deleted) can touch another, so the hero list is read again too
  const changed = () => {
    setRevision((n) => n + 1);
    void reload();
  };

  return (
    <div>
      {error && (
        <Notice kind="error">
          {error}
        </Notice>
      )}
      {view && <LearnedSummary view={view} onChanged={changed} />}
      <Tabs id="learned" label="Learned" tabs={PARTS.map(({ key, label }) => ({ key, label: key === 'confirm' && waiting !== null ? `${label} (${waiting})` : label }))} value={part} onChange={setPart} />
      <TabPanel id="learned" value={part}>
        {part === 'confirm' && <ParkedReadings onWaiting={setWaiting} onChanged={changed} />}
        {part === 'heroes' && <ReaderHeroes key={revision} heroNames={view?.choices.heroes ?? []} onChanged={() => void reload()} />}
        {part === 'ranks' && view && <LearnedRanks view={view} onChanged={changed} />}
        {part === 'units' && view && <LearnedUnits view={view} onChanged={changed} />}
      </TabPanel>
    </div>
  );
}
