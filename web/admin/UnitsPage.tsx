import { useState } from 'react';
import { HeroAdminPage } from './HeroAdminPage.js';
import { BossesPage } from './BossesPage.js';
import { PhantimalsPage } from './PhantimalsPage.js';
import { TabPanel, Tabs } from '../ui/Tabs.js';

const VIEWS = [
  { key: 'heroes', label: 'Heroes', component: HeroAdminPage },
  { key: 'phantimals', label: 'Phantimals', component: PhantimalsPage },
  { key: 'bosses', label: 'Bosses', component: BossesPage },
] as const;

/** Admin > Units: what the game has, kept by the player: the standard heroes, the phantimals and the bosses, with the units they bring. Images are on the Images tab. */
export function UnitsPage() {
  const [view, setView] = useState<(typeof VIEWS)[number]['key']>('heroes');
  const View = VIEWS.find((v) => v.key === view)!.component;
  return (
    <>
      <Tabs id="units" label="Units" tabs={VIEWS} value={view} onChange={setView} />
      <TabPanel id="units" value={view}>
        <View />
      </TabPanel>
    </>
  );
}
